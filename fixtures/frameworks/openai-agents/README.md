# OpenAI Agents SDK fixtures

Packages tested: `openai-agents 0.24.0`, `openai 3.31.0`, `openinference-instrumentation-openai-agents 2.5.3`,
`openinference-semantic-conventions 0.1.41`, `opentelemetry-sdk 1.45.1`, `opentelemetry-exporter-otlp-proto-http 1.45.1`.

`generate.py` points an `AsyncOpenAI` client at `mock_openai_server.py` (a local fake chat.completions endpoint), then runs
`Runner.run_sync` with `OpenAIAgentsInstrumentor().instrument(tracer_provider=...)`.

- `otlp-openinference.json`: **Convention: OpenInference.** Scope `openinference.instrumentation.openai_agents`; `openinference.span.kind`
  AGENT / CHAIN / LLM / TOOL; `llm.model_name`, `llm.input_messages.N.message.*`, `llm.token_count.*`, `tool.name`, `input.value`/`output.value`.
  Eight spans were merged from eight POSTs (the script used `SimpleSpanProcessor`, one request per span).
- `console-exporter.txt`: `ConsoleSpanExporter` output.

Resource has `service.name=unknown_service:python` unless `OTEL_SERVICE_NAME` is set. The SDK's own built-in trace upload is replaced by
the instrumentor by default (`exclusive_processor` defaults to True); nothing was sent to OpenAI.
