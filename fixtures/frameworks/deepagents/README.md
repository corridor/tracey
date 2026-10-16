# DeepAgents fixtures

Packages tested: `deepagents 0.7.26` (on `langgraph 1.2.15`, `langchain 1.4.6`), `openinference-instrumentation-langchain 0.1.79`,
`opentelemetry-sdk 1.45.1`, `opentelemetry-exporter-otlp-proto-http 1.45.1`.

`generate.py`: `create_deep_agent(model=<fake>, tools=[add])`, instrumented with `LangChainInstrumentor` exactly as for LangGraph.

- `otlp-openinference.json`: **OpenInference**. Same shape as LangGraph plus middleware spans (e.g. `PatchToolCallsMiddleware.before_agent`, kind AGENT);
  metadata carries `ls_integration: deepagents` and `lc_versions.deepagents`.
- `console-exporter.txt`: console exporter output.

A trivial run does not exercise DeepAgents planning/todos/filesystem/subagent tools, so those span shapes are not captured.
