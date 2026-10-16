# Strands Agents fixtures

Packages tested: `strands-agents 1.61.1`, `opentelemetry-sdk 1.45.1`, `opentelemetry-exporter-otlp-proto-http 1.45.1`
(installed via `pip install 'strands-agents[otel]'`).

Produced by `generate.py` (`console` or `otlp` arg): a custom `strands.models.Model` subclass streams a tool call to `add`,
then a final text. `StrandsTelemetry().setup_otlp_exporter()` (endpoint from `OTEL_EXPORTER_OTLP_ENDPOINT`) or `.setup_console_exporter()`.

- `otlp-default.json`: default output. **Convention: OTel GenAI (older "event" flavour).** Fingerprint: scope
  `strands.telemetry.tracer`, `gen_ai.system=strands-agents`, `gen_ai.operation.name` in `invoke_agent | execute_event_loop_cycle | chat | execute_tool`,
  content as span *events* `gen_ai.user.message`, `gen_ai.choice`, `gen_ai.tool.message`... Both `gen_ai.usage.prompt_tokens` and `input_tokens` are set.
- `otlp-gen_ai_latest_experimental.json`: same run with `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`. Uses `gen_ai.provider.name`
  instead of `gen_ai.system`, and one event `gen_ai.client.inference.operation.details` carrying `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions` (JSON parts), plus `gen_ai.tool.call.arguments/result` attributes on tool spans.
- `console-exporter.txt`: Strands console exporter.

Note: the mock model reports no model id, so `gen_ai.request.model` is absent; a real provider sets it.
