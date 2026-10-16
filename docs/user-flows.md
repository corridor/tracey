# User flows

tracey is UI only. It does not collect traces. So every flow below has the same shape:

**get a trace out of wherever it lives, load it into tracey, read the findings, dig in.**

> Per-tool export steps are from search results and prior knowledge, not tested by us.
> Items marked **(verify)** must be confirmed against the vendor's current docs and a real
> run before we publish them as instructions. Flag names in particular change often.

## How a trace gets into tracey (all flows)

| Way in | Notes |
|---|---|
| Drag and drop a file | OTLP JSON, JSONL, vendor JSON. Default path. |
| Paste | Raw JSON from a clipboard or log line. |
| Open from URL | Only if the host serves it with CORS. **(proposal)** |
| Embedded component | A host app passes the data in; this is how the `@ggx/*` packages are used. |

On load tracey runs [format detection](format-detection.md), shows "Detected X (evidence)",
and goes straight to the **Overview**.

## What the user sees first: the Overview

Answers "is this run healthy?" before showing detail.

1. **Verdict strip:** status, total duration, total tokens and cost, number of LLM calls,
   tool calls, retries, sub-agents.
2. **Findings list**, worst first. Each finding: severity icon, one-line title, the span(s)
   it points to. Click jumps to the span in the timeline and opens the inspector.
3. **Timeline** (waterfall) and **graph** toggle, with failing spans marked.
4. **Inspector** on the right for the selected span.

## The debug playbook (what we tell users to do)

Shown as a short checklist in-product and in docs. Same for every source.

1. **Read the findings top to bottom.** Start with errors, then loops/retries, then outliers.
2. **Find the first thing that went wrong, not the last.** Agents often hide an early failure
   (a tool error the model ignored) and fail much later. Use "first error" jump.
3. **Open the span's input.** Was the prompt or tool argument what you expected? Bad input is
   the most common cause. Check the system prompt, retrieved context, and truncated messages.
4. **Open the span's output.** Empty, truncated (`max_tokens`/`length` finish reason), refusal,
   malformed JSON, or wrong tool chosen?
5. **Check the decision points.** For each LLM span that chose a tool: why that one? Compare
   with the tools offered.
6. **Look at the shape.** Repeated identical calls = a loop. Many sequential calls that could
   be parallel = latency. One huge span = where the time or tokens went.
7. **Diff against a good run.** Load a run that worked and use run-vs-run diff to find where
   they diverge.
8. **Fix, re-run, diff again.** Confirm the finding is gone.

## Flow A: "I already have tracing"

The user has traces in some tool and wants a better view.

### A1. OpenInference (Arize Phoenix / Arize AX, or `openinference-instrumentation-*`)

1. In Phoenix/AX, export the trace(s) as JSON, or have your OTLP exporter also write spans to
   a file. **(verify exact export route)**
2. Drop the file in tracey. Expected detection: *OpenInference*, evidence
   `openinference.span.kind`.
3. Follow the debug playbook.

### A2. OpenTelemetry GenAI / OpenLLMetry (Traceloop) / Dynatrace

Dynatrace accepts OTLP and documents OpenLLMetry as an instrumentation path, so Dynatrace
users usually have OTel GenAI spans.

1. Easiest: add a **file/console OTLP exporter** next to your existing exporter so the same
   spans are also written locally. No change to what Dynatrace receives. **(verify per
   language)**
2. Or export from the Dynatrace UI/API as JSON **(verify availability and shape)**.
3. Drop in tracey. Expected detection: *OTel GenAI* (modern `gen_ai.*`) and/or *OpenLLMetry*
   (indexed `gen_ai.prompt.N.*`). Mixed is normal; tracey handles it per span.

### A3. Datadog (ddtrace / LLM Observability)

1. Make sure LLM Observability is enabled so spans carry kind (agent, workflow, llm, tool,
   task, embedding, retrieval) and input/output. Plain APM spans have timing but not prompts.
2. Export the trace via Datadog's UI/API **(verify: shape and API)**, or capture locally in
   development.
3. Drop in tracey. Expected detection: *Datadog LLM Observability*. If only APM spans are
   present, tracey says so and explains what is missing and how to enable it.

### A4. Langfuse or LangSmith

1. Langfuse: export observations as JSON from the UI/API. LangSmith: export runs as JSON via
   API/SDK (bulk export is Parquet to S3 on paid plans, which tracey won't read directly).
   **(verify)**
2. Drop in tracey. Expected detection: *Langfuse* or *LangSmith*.

### A5. A trace file exists but tracey can't identify it

Low confidence: show candidates and evidence, let the user pick or map fields. Generic span
view is still shown. Offer "copy a bug report with the detection evidence". **(proposal)**

## Flow B: "I'm not tracing yet"

The user has an agent (LangGraph, DeepAgents, Strands, OpenAI Agents SDK, Claude Agent SDK,
etc.) and just wants to understand it. tracey will not instrument for them, but must give a
**short, copy-paste path** to a trace file.

Common recipe: **turn on OpenTelemetry tracing in the framework, export spans to a local
file in OTLP JSON, drop the file into tracey.** No account, no server, nothing leaves the
machine.

Guide structure per framework (one short page each, tested):
install → 3-5 lines to enable → run the agent once → find the file → drop it in.

| Framework | Route to a trace (all **(verify)**) |
|---|---|
| **LangGraph / LangChain** | Native tracing is built around LangSmith. A LangSmith OTel mode exists (`LANGSMITH_OTEL_ENABLED`). Alternatively an OpenInference or OpenLLMetry LangChain instrumentor with a file exporter. DeepAgents is built on LangGraph, so the same applies. |
| **Strands Agents** | Built-in OpenTelemetry tracing; configure the SDK's telemetry helper with a file/console exporter. |
| **OpenAI Agents SDK** | Built-in tracing (sends to OpenAI's traces dashboard by default). To get a local file: register a custom trace processor, or use an OpenInference/OTel instrumentor with a file exporter. |
| **Claude Agent SDK** | Reported to need telemetry env flags and a traces beta flag, with an OTLP exporter. Confirm against Anthropic docs. |
| **Other / custom** | Any OpenAI/Anthropic client instrumented with OpenInference or OpenLLMetry. |

Open question: tracey is UI-only, but we need a tiny "write spans to a file as OTLP JSON"
exporter snippet per language. Publish as documentation snippets (no SDK, no package) or as
a separate optional `@ggx/` helper? **(open)**

After the file is loaded the user follows the **debug playbook** above. For first-timers the
Overview adds a one-time "what am I looking at" tour: timeline, graph, inspector, findings.

## Flow F: "What is my coding-agent harness doing?" (Claude Code, Codex, Zed, Copilot)

The user is curious, not instrumenting. These tools already keep local session records, so
the flow is "find the file, open it". tracey builds a trace out of the transcript: each
model turn is an LLM span, each tool call a tool span, sub-agents nest, timestamps give
durations, token usage gives cost where recorded.

| Harness | Where the data is (all **(verify)** on current versions) |
|---|---|
| **Claude Code** | JSONL transcripts, one file per session, under `~/.claude/projects/<project>/<session-id>.jsonl`. Anthropic's docs say the record format is internal and changes between versions, so the adapter must be tolerant and versioned. Docs also point to `/export`. |
| **Codex CLI** | Session "rollout" JSONL under `~/.codex/sessions/` **(not yet researched)**. |
| **Zed** | Agent threads in a local SQLite database, payloads reported as zstd-compressed JSON. Needs a zstd decoder and SQLite reader. Older sources said LMDB; likely outdated. |
| **VS Code Copilot Chat** | Chat sessions exportable as JSON ("Chat: Export Session"); session files under a `chatSessions` folder in workspace storage. Newer VS Code has an **Agent Debug Log** that can be exported as OTLP JSON (setting `github.copilot.chat.agentDebugLog.fileLogging.enabled`). Prefer the OTLP export when available. |
| **GitHub Copilot coding agent (cloud)** | Session logs viewable on GitHub; no export route found yet. See Flow G. |

Steps for the user:

1. `tracey` surfaces a **"Find sessions"** helper: on desktop/CLI/VS Code it can list known
   session locations on this machine (with permission) and offer the most recent. On the
   website the user drags the file in.
2. Open a session. Detection says e.g. "Claude Code transcript, version X".
3. The Overview adds harness-specific findings: a tool call that errored and the model kept
   going, repeated reads of the same file, a very long context, a retry loop, a subagent that
   returned nothing, a permission denial.
4. Debug playbook applies, with an added step: "check what the model was *told* (system prompt,
   instructions, tool list) against what it *did*."

Privacy note: transcripts contain code and secrets. All processing is local, and the UI
offers one-click redaction for sharing a screenshot or an exported file. **(guess)**

## Flow G: "Debug a third-party app I don't control" (Vapi, Salesforce, GitHub Copilot, ...)

No SDK, no source access. The developer configures or uses a product and needs to see what it
did. Three routes, best first:

1. **Vendor export.** Use whatever the product gives you.
   - **Vapi**: call object (transcript, messages, artifacts) from the dashboard/API, plus
     per-call pipeline logs downloadable as compressed JSONL (log URLs are authenticated and
     redirect to short-lived downloads). Tool calls appear in the logs. **(verify)**
   - **Salesforce (Agentforce)**: session tracing / audit data **(not yet researched; do
     this before promising anything)**.
   - **GitHub Copilot (cloud coding agent)**: logs shown on GitHub; export unknown. **(verify)**
   - Pattern: each gets a small adapter and a one-page "how to get your export" guide.
2. **Capture at the network edge.** When the product calls an LLM API, a local proxy or a
   browser HAR file records the requests/responses. tracey reads **HAR** and
   proxy-style captures and rebuilds the conversation as a trace (request = LLM span,
   tool results from follow-up messages). Universal but lossy. **(proposal)**
3. **Log/webhook drains.** Products with webhooks (voice platforms often post call events) can
   post to a local file or endpoint the user controls; tracey reads the saved result.

What tracey must do well here: be honest about what's missing. Show a **"coverage" note** on
the Overview, e.g. "no timing data in this export, durations are estimated from message
timestamps" or "no tool inputs captured". Findings that need missing data are skipped, not
faked.

## Flow C: "Compare two runs" (diffchecker feel)

1. Load run A and run B (two files, or two drops).
2. tracey aligns the two span trees and shows added, removed, changed, slower, costlier steps.
3. Click a step to see an input/output text diff.
4. Typical use: good run vs bad run, before vs after a prompt change.

## Flow D: "Just look at the JSON" (jsonviewer feel)

Any span payload or the whole file can be opened in the JSON explorer: collapse, search by
key or value, copy path, copy value. Works even when detection fails.

## Flow E: Embedded in someone's app

The host app imports one or more `@ggx/` packages, feeds in spans (already in a source
format or tracey model) and renders views. Detection is optional here, since the host knows
its format.

## Flows by surface

| Flow | Web | VS Code | CLI | Desktop |
|---|---|---|---|---|
| A. Already tracing | drop file | open file | `tracey file` | open file |
| B. No tracing yet | drop file | open file, watch workspace | `tracey --watch dir` | watch folder |
| F. Harness sessions | drop file | "Find sessions" | `tracey sessions` | "Find sessions" |
| G. Third-party apps | drop export/HAR | open export/HAR | `tracey file` | open export/HAR |
| C. Compare | two drops | "Diff two traces" | `tracey diff a b` | two files |

## Open questions

- Which flows are v1? Suggested: A1, A2, B (two frameworks), F (Claude Code first), then C, D, G.
- Do we want sample traces bundled for a "try it now" experience? (Recommended: yes, it
  doubles as test fixtures.)
- How far do we go on automatic discovery of local session files, given the privacy
  sensitivity? (Suggested: explicit permission, per surface.)

Decided earlier: a hosted static website is in scope (see [surfaces.md](surfaces.md)).
