# Verification: OpenInference, OTel GenAI, collector file export

Roadmap step 1.2, part A. Verified 2026-10-16 against primary sources and by running the real packages.
Fixtures: `fixtures/openinference/`, `fixtures/otel-genai/`, `fixtures/otel-sdk-console/`.

Versions tested: `openinference-instrumentation-openai` 0.1.65, `openinference-semantic-conventions` 0.1.41,
`opentelemetry-sdk` 1.45.1, `opentelemetry-instrumentation-openai-v2` 2.4b0 (+ `opentelemetry-util-genai`
0.4b0), `opentelemetry-instrumentation-openai` (OpenLLMetry) 0.29.2 and latest, `otelcol-contrib` 0.162.0.
All traces came from a scripted local mock of the OpenAI API (no real model). Except where stated in
the fixture READMEs, nothing was hand-written.

## Sources

- OpenInference spec: https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
- OTel GenAI conventions **moved** out of the main semantic-conventions repo (the old
  `open-telemetry/semantic-conventions/docs/gen-ai/*.md` pages are now stubs). New home:
  https://github.com/open-telemetry/semantic-conventions-genai (docs/gen-ai/*.md, model/gen-ai/*.json,
  non-normative/examples-llm-calls.md). Everything is still **Status: Development**.
- Collector file exporter: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/fileexporter/README.md
- Collector GenAI normaliser: https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/genainormalizerprocessor/README.md

## 1. Collector file exporter (confirmed)

- README: JSON without `encoding` and compression is "Newline-delimited OTLP JSON, one line per batch."
  `format` is `json` (default) or `proto`; `proto` records are length-prefixed (4-byte big-endian). The
  README explicitly warns that exact field names may not stay stable and does not define the schema.
- Observed: each line is `{"resourceSpans":[{"resource":{"attributes":[...]},"scopeSpans":[{"scope":{"name","version"},"spans":[...]}]}]}`.
  - A whole 16-span trace was ONE line (67 KB); a run with a small batch size gave 6 lines. So never
    assume one line per trace or per span. Spans from different scopes sit in different `scopeSpans`
    entries (e.g. the instrumentation scope vs the manual tracer scope).
  - Standard OTLP/JSON: camelCase (`traceId`, `spanId`, `parentSpanId`, `startTimeUnixNano`), ids are
    lowercase hex strings (not base64), nano timestamps and `intValue` are **strings**, `kind` is an int
    (1 INTERNAL, 3 CLIENT), `status` is `{}` when UNSET, `{"code":2,"message":..}` on error, root span has no
    `parentSpanId`, `flags: 256` present.
  - Attributes are `[{"key": k, "value": {"stringValue"|"intValue"|"doubleValue"|"boolValue"|"arrayValue": ...}}]`.
    Arrays are `{"arrayValue":{"values":[{"stringValue":..}]}}`.
  - Span events (exceptions) are `events:[{"name":"exception","timeUnixNano":..,"attributes":[...]}]`.
- Rotation (`rotation:`) is opt-in and size based; rotated files get a timestamp in the name. `compression: zstd`
  per-message output is not readable by `zstd -d` unless the alpha gate `exporter.file.nativeCompression` is on.
- Not verified: the OTLP logs/metrics file layout (only traces were run), and the other-than-contrib
  distributions (the `file` exporter is contrib-only; the core collector does not include it).

## 2. OTel SDK ConsoleSpanExporter, Python (confirmed)

Default output is **not** JSONL: pretty-printed objects (indent 4) concatenated back to back, in span END order.
Keys: `name`, `context{trace_id,span_id,trace_state}`, `kind` ("SpanKind.INTERNAL"), `parent_id` (null for root),
`start_time`/`end_time` (ISO-8601 with Z), `status{status_code}` ("UNSET"/"OK"/"ERROR", plus `description` on error),
`attributes` (plain object, arrays stay arrays), `events`, `links`, `resource{attributes,schema_url}`. Ids are `0x`
prefixed hex. Passing `formatter=lambda s: s.to_json(indent=None)+"\n"` gives true JSONL with the same keys.
Not verified: JS/Java/Go/.NET console exporters (different shapes, e.g. JS `ConsoleSpanExporter` prints JS objects).

## 3. OpenInference (confirmed)

- `openinference.span.kind` is **required** on all spans (spec). Values: `LLM`, `EMBEDDING`, `CHAIN`, `RETRIEVER`,
  `RERANKER`, `TOOL`, `AGENT`, `GUARDRAIL`, `EVALUATOR`, `PROMPT`, `DECISION`. Upper case. (Our doc listed no values; `DECISION` is recent.)
- Flattening rule: lists of objects become `<prefix>.<index>.<suffix>` with zero-based indices, applied recursively.
  Observed in real output:
  - `llm.input_messages.0.message.role`, `.message.content`; `llm.output_messages.0.message.tool_calls.0.tool_call.id`,
    `.tool_call.function.name`, `.tool_call.function.arguments` (JSON string).
  - Tool result messages in input: `llm.input_messages.N.message.role = "tool"` with `message.tool_call_id`.
  - `llm.tools.N.tool.json_schema` (JSON string). Multimodal: `message.contents.N.message_content.type|text|image...`.
  - Retrieval: `retrieval.documents.N.document.id|content|score|metadata`.
- Other keys seen: `input.value`, `input.mime_type` (`text/plain` or `application/json`), `output.value`, `output.mime_type`,
  `llm.system`, `llm.provider` (spec), `llm.model_name`, `llm.invocation_parameters` (JSON string),
  `llm.finish_reason`, `llm.token_count.prompt|completion|total`, `llm.token_count.prompt_details.cache_read` etc.,
  `llm.cost.*`; TOOL spans: `tool.name`, `tool.description`, `tool.parameters` (the OITracer helper wrote a JSON string);
  AGENT: `agent.name`; context: `session.id`, `user.id`, `metadata` (JSON string), `tag.tags`.
- Span names are NOT standardised: the OpenAI instrumentor names LLM spans `ChatCompletion`; agent/tool spans use
  whatever the app passes. Do not use names for detection. Kind is INTERNAL (1) for all spans in our run.
- Status: the instrumentor sets LLM spans to OK, tool/agent UNSET; failing tool = status code 2 + `exception` event
  (`exception.type`, `exception.message`, `exception.stacktrace`).
- `input.value` on LLM spans from this instrumentor holds the whole request body as JSON, `output.value` the whole
  response body: large and redundant with the flattened keys. Prefer flattened keys, fall back to `input.value`.

## 4. OTel GenAI conventions (confirmed, with big corrections)

- All Development status; names change. Operation names (`gen_ai.operation.name`) in the current registry:
  `chat`, `generate_content`, `text_completion`, `embeddings`, `retrieval`, `execute_tool`, `create_agent`,
  `invoke_agent`, `invoke_workflow`, `plan`, `fetch_response`, `create_memory`, `create_memory_store`, `search_memory`,
  `update_memory`, `upsert_memory`, `delete_memory`, `delete_memory_store`.
- Span names: inference `{operation} {request.model}` (observed `chat gpt-4o-mini`); `invoke_agent {gen_ai.agent.name}`;
  `create_agent {name}`; `execute_tool {gen_ai.tool.name}`; `invoke_workflow {gen_ai.workflow.name}`; `plan {agent}`.
  Kinds: inference CLIENT (may be INTERNAL), `invoke_agent` has a CLIENT variant (remote agents) and an INTERNAL
  variant (in-process), `execute_tool` INTERNAL.
- Provider: **`gen_ai.provider.name`** (replaced `gen_ai.system`). Observed from real instrumentation: `openai`.
- Usage: `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, plus `gen_ai.usage.cache_read.input_tokens`,
  `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens` (older docs had
  `...cache_read_input_tokens`; older still `prompt_tokens`/`completion_tokens`).
- Request/response: `gen_ai.request.model|temperature|top_p|top_k|max_tokens|seed|stop_sequences|stream|...`,
  `gen_ai.response.id|model|finish_reasons` (array of strings), `gen_ai.conversation.id`, `gen_ai.output.type`.
- Agents: `gen_ai.agent.id|name|description|version`. Tools: `gen_ai.tool.name|type|description`, and on execute_tool
  spans `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` (Opt-In, any/JSON).
  `gen_ai.tool.definitions` on inference spans.
- **Messages are no longer events.** Current spec: `gen_ai.system_instructions`, `gen_ai.input.messages`,
  `gen_ai.output.messages`, `gen_ai.tool.definitions` are (Opt-In) **span attributes**; "SHOULD be recorded in structured form,
  MAY be a JSON string". Real Python output used a JSON **string**. Events remain only as an alternative
  (`gen_ai.client.inference.operation.details`) and for `gen_ai.evaluation.result`. The old
  `gen_ai.user.message` / `gen_ai.choice` / `gen_ai.assistant.message` events are gone from the spec.
- Message JSON shape (from schemas and real output): `[{"role":"user|assistant|system|tool","parts":[...],"finish_reason":"tool_calls"}]`
  where a part is `{"type":"text","content":..}`, `{"type":"tool_call","id","name","arguments":{...}}` (arguments an object),
  `{"type":"tool_call_response","id","response":..}`; also `reasoning`, `uri`, `blob`, `file`, generic parts.
  Tool results live in a separate message with `role:"tool"`.
- Content capture is opt-in via `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` (python: `NO_CONTENT|SPAN_ONLY|EVENT_ONLY|SPAN_AND_EVENT`,
  `true` is rejected by this version). Without it spans have usage and model but no messages: tracey must say so.
- Python instrumentation 2.4b0 does NOT emit `gen_ai.tool.definitions` nor `gen_ai.system_instructions` (system prompt is a `role:"system"` input message) and
  emits no agent/tool spans for a bare OpenAI-SDK loop. Agent/tool spans come from frameworks or hand instrumentation.
- Collector `genai_normalizer` processor exists (contrib 0.162.0, alpha): built-in sources `openinference` and `openllmetry`
  rewrite attributes into GenAI conventions, set the scope `schema_url`, and can leave originals (`remove_originals: false`).
  So a collector-normalised file can carry both vocabularies on one span: treat as mixed.

## 5. OpenLLMetry / Traceloop (partly confirmed)

- Legacy (package 0.29.2) real output: span `openai.chat` (CLIENT), `gen_ai.system = "OpenAI"` (capitalised),
  `llm.request.type = chat`, `gen_ai.prompt.0.role|content`, `gen_ai.completion.0.role|finish_reason`,
  `gen_ai.completion.0.tool_calls.0.id|name|arguments`, `gen_ai.usage.prompt_tokens|completion_tokens`, `llm.usage.total_tokens`,
  `llm.request.functions.0.name|description|parameters`. This confirms the `gen_ai.prompt.N.*` claim.
- Latest package already emits the NEW shape: `gen_ai.provider.name`, `gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.tool.definitions`, `gen_ai.usage.input_tokens` (still span name `openai.chat`). So "old indexed attrs" are a
  version axis, not a vendor axis.
- NOT verified: any `traceloop.*` keys (none were emitted by the openai instrumentation in either version; they
  come from the Traceloop SDK decorators, e.g. `traceloop.span.kind`, not tested). No OpenLLMetry fixture was kept.

## 6. What was wrong in our docs

| Doc | Quoted line | Verdict |
|---|---|---|
| `docs/guides/already-tracing.md` (fixed) | "The file exporter writes OTLP JSON. **(verify exact output shape; it may be one JSON object per line)**" | Right in spirit, now verified: one JSON object per **batch** per line. Rewritten. |
| `docs/guides/already-tracing.md` (fixed) | "the OpenTelemetry SDK's console exporter prints spans as JSON to stdout ... tracey should accept this "SDK console" shape too" | Misleading: it is concatenated pretty-printed objects, not NDJSON, not OTLP. Rewritten. |
| `docs/format-detection.md` | "`gen_ai.operation.name`, `gen_ai.provider.name`, ... `gen_ai.usage.input_tokens`; operation names like `invoke_agent`, `execute_tool`, `chat`" | Correct. Add that messages are `gen_ai.input.messages` JSON-string attributes, and that the spec repo moved. |
| `docs/format-detection.md` | "Older indexed attrs `gen_ai.prompt.0.content`, `gen_ai.completion.0.content`; `traceloop.*` keys **(verify)**" | Indexed attrs confirmed (use `gen_ai.prompt.N.role/content`, `gen_ai.completion.N.*`, `gen_ai.system`). `traceloop.*` unverified. Latest OpenLLMetry emits the new shape, so it is a version, not a source. |
| `docs/format-detection.md` | "`openinference.span.kind` (required by the spec). Flattened lists like `llm.input_messages.0.message.role`" | Correct. |
| `docs/format-detection.md` | "the OTel Collector has a GenAI normaliser processor that rewrites OpenInference/OpenLLMetry into GenAI conventions" | Correct (`genai_normalizer`, alpha, contrib). Originals are kept unless `remove_originals: true`. |
| `docs/format-detection.md` | "Dynatrace docs show both old and new naming appearing together" | Not checked here. |
| `docs/format-detection.md` | "**OTel SDK console output** ... JSON per span" | Wrong: pretty-printed objects back to back; the parser must stream-split top-level `{...}`, or accept JSONL if the user set a formatter. |
| `docs/format-detection.md` | "The OTel GenAI conventions ... (still Development status)" | Correct, and they moved to `semantic-conventions-genai`; update links. |

(Only `already-tracing.md` was edited; other docs listed for the lead to merge.)

## 7. Recommended detection fingerprints

Container sniff, in order: (a) text starts with `{"resourceSpans"` after trimming; split on newlines, each line one
OTLP batch (also accept a single pretty-printed object and an array of batches). (b) first non-space chars `{` followed by
a newline and `    "name"` and the doc contains `"context": {` and `"trace_id": "0x` : SDK console stream; split top-level objects with a
brace-depth scanner (strings aware) or regex `}\n{`. (c) otherwise other formats.

Attribute fingerprints (score per span, then trace-level vote; weights are proposals, 1.0 = decisive):

| Source | Key | Weight | Notes |
|---|---|---|---|
| OpenInference | `openinference.span.kind` | 1.0 | required by spec |
| OpenInference | key prefix `llm.input_messages.` / `llm.output_messages.` / `llm.tools.` / `retrieval.documents.` | 0.5 | |
| OpenInference | `input.value` + `output.value` (alone) | 0.1 | generic, also in other libs |
| OpenInference | `llm.token_count.prompt` / `llm.model_name` / `tool.name` | 0.3 | |
| OTel GenAI | `gen_ai.operation.name` | 0.8 | present on every conforming span (Required) |
| OTel GenAI | `gen_ai.provider.name` | 0.6 | replaced `gen_ai.system` |
| OTel GenAI | `gen_ai.input.messages` / `gen_ai.output.messages` | 0.5 | JSON string or structured |
| OTel GenAI | `gen_ai.usage.input_tokens` / `gen_ai.request.model` | 0.3 | |
| OTel GenAI agent | `gen_ai.operation.name` in {`invoke_agent`,`create_agent`,`execute_tool`,`invoke_workflow`,`plan`} or span name prefix `invoke_agent ` / `execute_tool ` | +0.2 | |
| OpenLLMetry (legacy) | prefix `gen_ai.prompt.` or `gen_ai.completion.` followed by digit | 0.9 | |
| OpenLLMetry (legacy) | `gen_ai.system` (no `provider.name`) or `llm.request.type` or `llm.usage.total_tokens` | 0.5 | |
| OpenLLMetry | span name `openai.chat` style (`<vendor>.chat`) | 0.2 | weak |
| OpenLLMetry | `traceloop.*` | 0.7 | UNVERIFIED |
| Mixed flag | OpenInference score and GenAI score both above 0.5 on one span, or GenAI + legacy indexed on the same trace | | normaliser output or dual-instrumented app |

Rules of thumb: a span with `openinference.span.kind` is OpenInference even if `gen_ai.*` also present (normaliser
leaves originals); scope name `openinference.instrumentation.*` is a confirming hint (0.3); scope `opentelemetry.util.genai.handler` or
`opentelemetry.instrumentation.openai_v2` hints GenAI. Do not rely on span names. Handle absent content gracefully
(content capture is off by default in GenAI instrumentation).

## 8. Unverified

- Phoenix/Arize export shapes (UI download, `px.Client().get_spans_dataframe()`), Dynatrace export, Datadog, Langfuse, LangSmith (other parts of 1.2).
- `traceloop.*` keys; Vercel AI SDK `ai.*`; JS/Java SDK console exporters; collector OTLP-proto input.
- The event-based GenAI path (`EVENT_ONLY`) output: events go to the logs signal, not exercised.
- OpenInference instrumentors for agent frameworks (LangChain, OpenAI Agents, ...): only the OpenAI instrumentor plus
  manual OITracer agent/tool spans were run, so framework-specific span names and `graph.node.*` keys are unseen.
- Anthropic/Gemini-flavoured GenAI messages; streaming spans (`time_to_first_chunk`); `gen_ai.tool.definitions` in
  real output of this Python package (not emitted).
