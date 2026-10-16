# Format detection (proposal)

Goal: the user drops in or pastes a trace and tracey figures out where it came from, with no
dropdown required. It says what it detected, why, and how sure it is, and lets the user
override.

> Detection signals below come from search results and prior knowledge, not from real
> exports. **Every row needs a real fixture before we trust it.** Items marked **(verify)**
> are the shakiest.

## Supported sources (initial target list, to confirm)

| Source | Typical container | Strong fingerprint |
|---|---|---|
| **OTLP JSON** (any OpenTelemetry) | `resourceSpans[].scopeSpans[].spans[]` | That container shape itself. Then classify the *flavour* by attributes below. |
| **OpenInference** (Arize Phoenix, Arize AX) | OTLP spans | `openinference.span.kind` (1.0, required by spec; values LLM, AGENT, TOOL, CHAIN, ...). Prefixes `llm.input_messages.`, `llm.output_messages.`, `llm.tools.`, `retrieval.documents.` (0.5). Scope name `openinference.instrumentation.*` (hint). Wins over `gen_ai.*` on the same span. Verified. |
| **OTel GenAI conventions** (Dynatrace, Honeycomb, Grafana, Strands, etc.) | OTLP spans | `gen_ai.operation.name` (0.8), `gen_ai.provider.name` (0.6, replaced `gen_ai.system`), `gen_ai.input.messages`/`gen_ai.output.messages` as span attributes holding a JSON string with `parts[]` (0.5; older layouts use span events such as `gen_ai.user.message`), `gen_ai.usage.*`. Agent operations: `invoke_agent`, `create_agent`, `execute_tool`, `invoke_workflow`, `plan`. Verified with the Python SDK and Strands; full weights in `docs/verification/otel-openinference.md`. |
| **OpenLLMetry / Traceloop** | OTLP spans | Legacy: indexed `gen_ai.prompt.N.*` / `gen_ai.completion.N.*` (0.9), `gen_ai.system`, `llm.request.type`. The latest release was reported to emit the new GenAI shape, so this is a version difference. `traceloop.*` keys **(unverified)**. |
| **LangSmith OTel mode** | OTLP spans | `langsmith.*` attributes plus `gen_ai.prompt`; neither OpenInference nor clean GenAI (enable with `LANGSMITH_TRACING_MODE=otel`). See `docs/verification/frameworks.md`. |
| **Datadog LLM Observability** (ddtrace) | Datadog LLMObs span JSON | Span `kind` in {agent, workflow, llm, tool, task, embedding, retrieval}; separate `input`, `output`, `error`, `metadata` fields; `metadata.model_name`, `metadata.model_provider`. Exact export file shape **(verify)**. Plain APM ddtrace spans carry no LLM payloads and are lower value. |
| **Langfuse** | JSON with observations | Observation `type` in {SPAN, GENERATION, EVENT} (newer versions may add more **(verify)**); `parent_observation_id`; trace-level fields. |
| **LangSmith** | Run records | `run_type` (llm, chain, tool, ...), `inputs`, `outputs`, `start_time`, `end_time`, `parent_run_id`/`dotted_order` **(verify)**. |
| **OpenAI Agents SDK** native traces | trace + span objects | Span data types such as agent, generation, function, handoff, guardrail **(verify)**. |
| **Vercel AI SDK** telemetry | OTLP spans | `ai.*` attributes such as `ai.operationId` **(verify)**. |
| **Claude Code OTel traces** | OTLP spans | Span names starting `claude_code.` with `claude_code.*` attributes (not `gen_ai.*`). Beta, opt-in; sub-agent nesting untested. See `docs/verification/claude-code.md`. |
| **Claude Code transcript** | JSONL, one record per line | Verified on 2.1.296 to 2.1.301 (see `docs/verification/claude-code.md`). Over the first ~50 lines: `sessionId`+`uuid`+`parentUuid`+`timestamp`+`version` (semver) on user/assistant records; assistant `message.id` starting `msg_` with `usage`; `tool_result` blocks with `sourceToolAssistantUUID`; types such as `permission-mode`, `last-prompt`, `ai-title`. Do not require the first line to be a user record. One content block per assistant record; count tokens once per `message.id`. Sub-agents are separate files (`<session>/subagents/agent-<id>.jsonl` + `.meta.json`). A lone sub-agent file is reported as such. |
| **Codex CLI rollout** | JSONL | **(not yet researched)** |
| **Zed thread** | SQLite DB with zstd JSON payloads | SQLite header + thread table; zstd frames **(verify)** |
| **VS Code Copilot Chat session** | JSON | Chat session JSON with requests/responses **(verify)**. The Agent Debug Log export is OTLP JSON, so it is detected as OTLP first. |
| **Vapi call** | Call object JSON; pipeline logs as JSONL | Call fields such as `transcript`, `messages`, `artifact`; log lines with categories (incl. Tool) **(verify)** |
| **Salesforce Agentforce** | **(not yet researched)** | |
| **HAR capture** | HAR JSON | Top-level `log.entries[]` with LLM-API-looking requests (OpenAI/Anthropic/Gemini style bodies). Universal fallback for third-party apps. |
| **OTel SDK console output** | Concatenated pretty-printed JSON objects (not JSONL, not valid JSON as a whole) | Python `ConsoleSpanExporter`: snake_case keys, `"context": {` with `"trace_id": "0x..."` ids, `"kind": "SpanKind.INTERNAL"`. Needs a string-aware brace-depth splitter. Other languages' console exporters not checked. Fixtures in `fixtures/otel-sdk-console/`. |
| **tracey native** | tracey model JSON | A `tracey` version marker. Always the lossless fallback. |

## How detection works

Three layers, cheapest first. Detection must be fast enough to be invisible (target well
under 50 ms for typical files; only sample, don't scan all spans).

1. **Container sniff.** (Verified shapes: collector file exporter = one OTLP batch per line, so a trace can span several lines; SDK console = concatenated pretty JSON objects.) Look at the top-level shape only: array vs object, `resourceSpans`,
   `observations`, `run_type`, `spans` with `kind`, JSONL vs JSON, protobuf vs JSON.
   Decides which parser reads the file.
2. **Attribute fingerprint.** Sample the first N spans (and a few random ones). Each known
   source has a set of signature keys with weights. Score every candidate.
3. **Disambiguate.** OTLP is a transport, not a vendor. A single OTLP file can be
   OpenInference, GenAI conventions, OpenLLMetry, or a mix. The Dynatrace docs show mixed old/new
   naming from one source, and the OTel Collector has a GenAI normaliser processor that
   rewrites OpenInference/OpenLLMetry into GenAI conventions. So detection is **per span**,
   with a trace-level majority vote.

Output **(proposal)**:

```ts
type Detection = {
  container: 'otlp-json' | 'otlp-proto' | 'jsonl' | 'json' | 'unknown'
  candidates: { source: SourceId; score: number; evidence: string[] }[]  // best first
  confidence: 'high' | 'medium' | 'low'
  mixed: boolean   // more than one convention present
}
```

## Rules

- **Never silently guess wrong.** Low confidence shows the candidates and asks.
- **Show the evidence.** "Detected OpenInference: found `openinference.span.kind` on 142/142
  spans." This builds trust and helps people debug their own instrumentation.
- **Detection is pure and headless**: lives in the adapters package, runs in a worker, works
  in Node and CI.
- **Unknown is a valid answer.** Fall back to a generic span view (names, timings, raw
  attributes) and a "map fields" escape hatch so the viewer is still useful.
- **Adapters are small and one-way.** `source format -> tracey model`. Keep raw attributes
  attached so nothing is lost.
- **Tests come from real exports.** One fixture per source and version, including ugly ones
  (mixed conventions, truncated, huge).

## Special cases

- **Binary/compressed inputs** (Zed's zstd, OTLP protobuf, gzip logs) need decoders. Keep
  decoders optional and lazy-loaded so the core stays small.
- **Transcripts are not traces.** Harness and third-party sources often lack real span
  structure or timing. The adapter synthesises spans from turns and tool calls and marks
  what was inferred; the Overview shows a coverage note.
- **Detection runs in the CLI too**: `tracey detect <file>`.

## Open questions

- Do we read protobuf OTLP directly, or only JSON? (Protobuf adds a dependency and size.)
- How do we version fixtures as the OTel GenAI conventions (still Development status) change?
- How should the UI show "the trace came from a pipeline that normalised it"?
