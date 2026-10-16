# Verification: "no tracing" guide, framework step 2

Date 2026-10-16, macOS, Python 3.12, throwaway venvs outside the repo. Every framework was run end to end against a fake
model (no API keys), exporting with the OTel SDK to a console exporter and to a local OTLP/HTTP receiver that saved the body.
Fixtures and generator scripts: `fixtures/frameworks/<framework>/`. Guide: `docs/guides/no-tracing.md`.

Common: `opentelemetry-sdk 1.45.1`, `opentelemetry-exporter-otlp-proto-http 1.45.1`. `OTLPSpanExporter(endpoint=...)` needs the full
`/v1/traces` path; the env var `OTEL_EXPORTER_OTLP_ENDPOINT` is the base and `/v1/traces` is appended (seen with Strands and LangSmith).

## Strands Agents (`strands-agents 1.61.1`)
- Was wrong: "Configure its telemetry helper ... **(verify exact helper names)**". Names are right: `strands.telemetry.StrandsTelemetry`,
  `.setup_otlp_exporter(**kwargs)` (kwargs go to `OTLPSpanExporter`), `.setup_console_exporter()`, plus `.setup_meter()`, `.setup_baggage_processor()`. Chained returns self.
- Snippet: `StrandsTelemetry().setup_otlp_exporter()` then run the agent; `telemetry.tracer_provider.force_flush()` before exit.
  Uses a `BatchSpanProcessor`. Install `strands-agents[otel]`.
- Convention: OTel GenAI. Fingerprint: scope `strands.telemetry.tracer`, `service.name=strands-agents`, `gen_ai.system=strands-agents`,
  `gen_ai.operation.name` of `invoke_agent` / `execute_event_loop_cycle` / `chat` / `execute_tool`, `gen_ai.agent.name`, `gen_ai.tool.name`,
  span events `gen_ai.user.message` / `gen_ai.choice`, `gen_ai.usage.*`. With `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`:
  `gen_ai.provider.name` and event `gen_ai.client.inference.operation.details` with `gen_ai.input.messages`. Note `execute_event_loop_cycle` is not an official GenAI operation.
- Gotchas: content captured by default; flush before exit; tracey must handle both layouts. Not tested: `OTEL_EXPORTER_OTLP_HEADERS`, Bedrock/real providers, the metrics path.

## OpenAI Agents SDK (`openai-agents 0.24.0`, `openinference-instrumentation-openai-agents 2.5.3`)
- Was wrong: nothing in the snippet; confirmed imports `OpenAIAgentsInstrumentor().instrument(tracer_provider=...)`. The guide's "built-in tracing goes to OpenAI's dashboard"
  is right but incomplete: the instrumentor defaults to `exclusive_processor=True` (`set_trace_processors`), replacing the default exporter. Built-in API names exist:
  `add_trace_processor`, `set_trace_processors`, `set_tracing_disabled`, env `OPENAI_AGENTS_DISABLE_TRACING`.
- Run via a local fake chat.completions server (`set_default_openai_client`, `set_default_openai_api("chat_completions")`).
- Convention: OpenInference. Fingerprint: scope `openinference.instrumentation.openai_agents`, `openinference.span.kind` AGENT/CHAIN/LLM/TOOL, `llm.model_name`,
  `llm.input_messages.N.message.role`, `llm.token_count.*`, `tool.name`, `input.value`. Span names: `Agent workflow`, agent name, `turn`, `generation`, tool name.
- Gotchas: `service.name=unknown_service:python` unless `OTEL_SERVICE_NAME`; `SimpleSpanProcessor` sends one POST per span (the collector file then holds many small batches); content on by default (`OPENINFERENCE_HIDE_*` flags).
  Not tested: Responses API path (default model API), the SDK's `trace()` workflow wrapper, handoffs, guardrails.

## LangGraph / LangChain (`langgraph 1.2.15`, `langchain 1.4.6`, `langchain-core 1.6.11`, `openinference-instrumentation-langchain 0.1.79`, `langsmith 0.14.11`)
- Was imprecise: `LANGSMITH_OTEL_ENABLED` **(verify)**. Current `langsmith` prefers `LANGSMITH_TRACING_MODE` = `langsmith` | `hybrid` | `otel` (tested: `otel`), and falls back to legacy `OTEL_ENABLED` / `OTEL_ONLY` (read from source with the LANGSMITH_ prefix; not run).
  The `opentelemetry-exporter-otlp` pip hint in the guide pulls grpc too; `opentelemetry-exporter-otlp-proto-http` is sufficient for the HTTP exporter used.
- Snippet verified with `create_agent` and a fake chat model. Spans: `LangGraph` root > `model` > `<ModelClass>` (LLM); `tools` > `<tool>` (TOOL).
- Convention (instrumentor): OpenInference; fingerprint scope `openinference.instrumentation.langchain`, `openinference.span.kind`, `llm.input_messages.*`, `metadata` JSON with `langgraph_node`.
- Convention (LangSmith otel mode): neither; `service.name=langsmith`, scope `langsmith`, `langsmith.span.kind`, `langsmith.metadata.*`, `gen_ai.operation.name`, `gen_ai.system=langchain`, `gen_ai.prompt` / `gen_ai.completion`. Worked with placeholder key, exports to `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Gotchas: instrument before building the agent; `provider.shutdown()` before exit. Unverified: whether `langsmith[otel]` extra is needed in a clean env (the venv already had the OTel packages); real providers' `llm.token_count`/model names.

## DeepAgents (`deepagents 0.7.26`)
- Was wrong: nothing; the "same instrumentor" claim holds. `create_deep_agent(model=..., tools=[...])` with `LangChainInstrumentor` produced OpenInference spans.
  Extra middleware spans (`PatchToolCallsMiddleware.before_agent`, kind AGENT). `metadata.ls_integration=deepagents`, `lc_versions.deepagents` are a usable fingerprint.
- Not tested: planning/todo tools, virtual filesystem, subagents (`task`), so those span shapes are unknown.

## Claude Agent SDK (`claude-agent-sdk 0.2.168`, Claude Code `2.1.301`)
- Was wrong: "Reported to need telemetry environment flags plus a traces beta flag ... third-party sources disagree". Anthropic docs (code.claude.com/docs/en/agent-sdk/observability and /monitoring-usage) and a run agree:
  `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` (alias `ENABLE_ENHANCED_TELEMETRY_BETA`), `OTEL_TRACES_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL` (no default; `http/protobuf` worked), endpoint. Set via shell or `ClaudeAgentOptions(env=...)`
  (Python merges onto inherited env; TypeScript `env` replaces it, spread `process.env`). Do not use the `console` exporter in the SDK (stdout is the message channel).
- Verified by a real SDK run against a local fake Anthropic `/v1/messages` stream (`ANTHROPIC_BASE_URL`): spans `claude_code.interaction` > `claude_code.llm_request`; scope `com.anthropic.claude_code.tracing`, `service.name=claude-code` (override `OTEL_SERVICE_NAME`).
- Convention: custom Claude Code spans carrying some GenAI attributes (`gen_ai.system=anthropic`, `gen_ai.request.model`, `gen_ai.operation.name=invoke_agent`, `gen_ai.provider.name`, `gen_ai.conversation.id`) plus `input_tokens`/`output_tokens`, `session.id`.
- Gotchas: prompts redacted by default (`user_prompt=<REDACTED>`); content flags `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` (docs, not run); export interval 5 s default, set `OTEL_TRACES_EXPORT_INTERVAL`; failures are silent without `CLAUDE_CODE_OTEL_DIAG_STDERR=1`;
  a `user.id` hash attribute is present (scrubbed in fixtures). Beta: names may change. Tool spans (`claude_code.tool*`) were documented but not captured (the stub made no tool call).

## Not verified
Real model providers; streaming variants; collector file route (Step 1); `tracey` detection of any of these; Strands without the `[otel]` extra; TypeScript SDKs.
