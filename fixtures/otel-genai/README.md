# OpenTelemetry GenAI fixtures

Same scenario as `../openinference/` (planner agent, researcher sub-agent, failing `search_flights` tool
called 3 times with identical arguments, one slow LLM call), expressed in OTel GenAI semantic conventions.

- `travel-planner.collector-file.jsonl` - 16 spans in one line (one exported batch).
- `travel-planner-batched.collector-file.jsonl` - a separate run of the same script with a small batch
  size, so the file has 6 lines (one OTLP batch per line). Proves a single trace spans several lines.

How they were produced: `chat` spans come from the real `opentelemetry-instrumentation-openai-v2` 2.4b0
(with `opentelemetry-util-genai` 0.4b0) with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY`
and `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`, against a scripted mock OpenAI server.
The `invoke_agent` and `execute_tool` spans are HAND-CREATED with the real OTel SDK (1.45.1) following the
GenAI agent-span spec, because no instrumentation library for this toy agent emits them. Exported via
`otelcol-contrib` 0.162.0 `file` exporter. Paths in stack traces scrubbed. No real model, data or keys.

Things to test: `gen_ai.operation.name` in {chat, invoke_agent, execute_tool}; span names
`chat gpt-4o-mini`, `invoke_agent planner`, `execute_tool get_weather`; messages stored as JSON STRINGS in
`gen_ai.input.messages` / `gen_ai.output.messages` with `parts[]` (`text`, `tool_call`, `tool_call_response`);
`error.type` plus status code 2 on failed tools; `kind` 3 (CLIENT) for chat, 1 (INTERNAL) for agent/tool.
This version does not emit `gen_ai.tool.definitions` or `gen_ai.system_instructions`.
