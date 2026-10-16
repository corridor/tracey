# OpenInference fixture

`travel-planner.collector-file.jsonl` - one agent run (16 spans, one trace) in the exact format the
OpenTelemetry Collector contrib `file` exporter writes (see `docs/verification/otel-openinference.md`).

How it was produced (not hand-written): a Python script ran a "planner" agent (with a "researcher"
sub-agent) against a local scripted mock of the OpenAI chat completions API. LLM spans came from the real
`openinference-instrumentation-openai` 0.1.65 (semantic conventions 0.1.41). Agent and tool spans were
created with the real `openinference-instrumentation` `OITracer` (`openinference_span_kind="agent"`/`"tool"`).
The app exported OTLP/HTTP via `opentelemetry-sdk` 1.45.1 to `otelcol-contrib` 0.162.0, whose `file`
exporter wrote this file. Paths in stack traces were rewritten to `/app`. No real model, data or keys.

Use it to test:
- OTLP container sniff (`resourceSpans`, camelCase, `intValue` as strings, ids as hex strings, `kind` as int).
- OpenInference fingerprint: `openinference.span.kind` on 16/16 spans (AGENT x2, LLM x8, TOOL x6).
- Flattened lists: `llm.input_messages.N.message.role`, `llm.output_messages.N.message.tool_calls.M.tool_call.*`, `llm.tools.N.tool.json_schema`.
- Findings: failing tool (`search_flights`, status code 2 plus `exception` event), repeated-call loop
  (`search_flights` called 3 times with identical args), slow LLM call (about 3.2 s while others take about 2 ms),
  nested agent (planner -> delegate_research tool -> researcher agent).
- Note: this OpenInference instrumentation sets `status` to `OK` on LLM spans and leaves tool/agent spans UNSET.
