# LangGraph / LangChain fixtures

Packages tested: `langgraph 1.2.15`, `langchain 1.4.6`, `langchain-core 1.6.11`, `langsmith 0.14.11`,
`openinference-instrumentation-langchain 0.1.79`, `opentelemetry-sdk 1.45.1`, `opentelemetry-exporter-otlp-proto-http 1.45.1`.

Agent: `langchain.agents.create_agent(model, tools=[add])` (a LangGraph graph) with a `FakeMessagesListChatModel` subclass (`bind_tools` returns self).

- `otlp-openinference.json` (`generate.py otlp`): **OpenInference** via `LangChainInstrumentor().instrument(tracer_provider=provider)`.
  Spans `LangGraph` (root, CHAIN) > `model` (CHAIN) > fake model name (LLM) ; `tools` (CHAIN) > `add` (TOOL). Fingerprint: scope
  `openinference.instrumentation.langchain`, `openinference.span.kind`, `llm.input_messages.*`, `metadata` JSON including `langgraph_node` / `langgraph_step`.
- `otlp-langsmith-otel.json` (`generate_langsmith_otel.py`, run with
  `LANGSMITH_TRACING=true LANGSMITH_TRACING_MODE=otel LANGSMITH_API_KEY=<any> OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`): LangSmith's own OTel export,
  no instrumentor code. **Neither OpenInference nor clean GenAI**: resource `service.name=langsmith`, scope `langsmith`, `langsmith.span.kind` (chain/llm/tool),
  `langsmith.metadata.*`, plus `gen_ai.operation.name`, `gen_ai.system=langchain`, and `gen_ai.prompt` / `gen_ai.completion` JSON blobs.
- `console-exporter.txt`: console exporter for the OpenInference run.
