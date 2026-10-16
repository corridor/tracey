# I have an agent, but no tracing

> Step 2 snippets were run end to end on 2026-10-16 against fake models (versions and findings:
> [verification/frameworks.md](../verification/frameworks.md); captured output: `fixtures/frameworks/`). Step 1 (the
> collector file) was not checked here. Items still marked **(verify)** were not run.

**The idea:** turn on OpenTelemetry in your framework, send spans to a local collector that
writes a file, drop the file into tracey. No account, no server in the cloud, nothing leaves
your machine.

## Step 1: a local file writer (same for every framework)

Use the collector config from [already-tracing.md](already-tracing.md#any-opentelemetry-source-works-for-most-of-the-below)
and run it locally. Your app will send to `http://localhost:4318`.

Set once in your shell:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Step 2: turn tracing on for your framework

Pick one. Each is "install, add a few lines, run the agent once". Every snippet below was run
and produced spans at the versions listed.

### LangGraph / LangChain / DeepAgents

Tested with `langgraph 1.2.15`, `langchain 1.4.6`, `deepagents 0.7.26`,
`openinference-instrumentation-langchain 0.1.79`. DeepAgents is built on LangGraph; the same
instrumentor works unchanged.

```python
# pip install openinference-instrumentation-langchain opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.langchain import LangChainInstrumentor

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces")))
LangChainInstrumentor().instrument(tracer_provider=provider)  # call before building the agent

# ... build and run your agent (`create_agent` and `create_deep_agent` were tested) ...

provider.shutdown()  # flush before the process exits
```

Output is OpenInference. Prompts and completions are captured by default.

**LangSmith's OTel mode** also works, with no instrumentor code, but its spans are LangSmith's own
shape (`langsmith.*` attributes with `gen_ai.prompt` / `gen_ai.completion`), not OpenInference:

```bash
export LANGSMITH_TRACING=true
export LANGSMITH_TRACING_MODE=otel      # otel = OTLP only; hybrid = OTLP and LangSmith cloud
export LANGSMITH_API_KEY=anything       # a placeholder was accepted in otel mode
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

`LANGSMITH_OTEL_ENABLED` (plus `LANGSMITH_OTEL_ONLY`) is the legacy spelling; current `langsmith`
prefers `LANGSMITH_TRACING_MODE` and falls back to the legacy names (read from source; legacy names not run).
Whether tracey detects the LangSmith shape is a tracey question; prefer OpenInference.
(verify: the `langsmith[otel]` extra was not tested in a clean environment.)

### OpenAI Agents SDK

Tested with `openai-agents 0.24.0`, `openinference-instrumentation-openai-agents 2.5.3`.

```python
# pip install openinference-instrumentation-openai-agents opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces")))
OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)

# ... Runner.run_sync(agent, "...") ...

provider.shutdown()
```

The SDK's built-in tracing is not OpenTelemetry; it uploads to OpenAI's dashboard. By default
the instrumentor replaces the SDK's trace processors (`exclusive_processor` defaults to true), so
nothing is sent to OpenAI while it is on. Pass `exclusive_processor=False` to keep both.
`OPENAI_AGENTS_DISABLE_TRACING=1` disables the SDK's tracing (exists in the source; whether it also silences the instrumentor was not tested).

### Strands Agents

Built in; no instrumentor package. Tested with `strands-agents 1.61.1`.

```python
# pip install 'strands-agents[otel]'
from strands.telemetry import StrandsTelemetry

telemetry = StrandsTelemetry()
telemetry.setup_otlp_exporter()      # reads OTEL_EXPORTER_OTLP_ENDPOINT, posts to <endpoint>/v1/traces
# telemetry.setup_console_exporter() # or: print spans to stdout

# ... agent = Agent(...); agent("...") ...

telemetry.tracer_provider.force_flush()  # flush before the process exits
```

Output is OpenTelemetry GenAI (older event-based flavour): `gen_ai.*` attributes, messages as span
events. Set `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` for the newer layout
(`gen_ai.provider.name`, `gen_ai.input.messages`). Strands captures message content by default.

### Claude Agent SDK

The SDK runs the Claude Code CLI, and the CLI exports the telemetry. Tracing is **beta** and off
by default. Tested with `claude-agent-sdk 0.2.168` and Claude Code `2.1.301`.

```python
from claude_agent_sdk import query, ClaudeAgentOptions

env = {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",   # required for traces
    "OTEL_TRACES_EXPORTER": "otlp",               # not "console": stdout is the SDK's message channel
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
    "OTEL_TRACES_EXPORT_INTERVAL": "1000",        # default 5000 ms; lower it for short runs
}
async for msg in query(prompt="...", options=ClaudeAgentOptions(env=env)):
    ...
```

Or export the same variables in your shell and change no code. Spans are `claude_code.interaction`,
`claude_code.llm_request`, `claude_code.tool` (Claude Code's own names, with some `gen_ai.*`
attributes). Prompts are redacted by default: add `OTEL_LOG_USER_PROMPTS=1`, `OTEL_LOG_TOOL_DETAILS=1`
and `OTEL_LOG_TOOL_CONTENT=1` to include prompt text, tool inputs and tool output. Export errors are
silent unless `CLAUDE_CODE_OTEL_DIAG_STDERR=1`. (verify: whether tracey recognises these spans.)

### Something else

Any OpenAI or Anthropic client call can be traced with an OpenInference or OpenLLMetry
instrumentor for that client. Same pattern: instrument with the provider above.
**(verify: not run.)**

## Step 3: run the agent once, then drop in the file

`traces.json` appears next to the collector. Drop it in tracey. Expect *Detected OpenInference*
(or OTel GenAI) and your spans.

## Faster: skip the collector with `tracey listen`

With the CLI or desktop app you won't need the collector or a file. Run `tracey listen`
(or flip "Listen" in the desktop app), point your agent at it, and watch spans arrive live:

```bash
tracey listen                      # receiver on http://localhost:4318, local only
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
python my_agent.py                 # your LangGraph / DeepAgents / Strands / OpenAI Agents app
```

Step 2 is unchanged: you still enable OpenTelemetry in your framework. `tracey listen` accepts OTLP over HTTP
(protobuf, which Python exporters send by default, or JSON, optionally gzipped) on `/v1/traces`, shows the
runs as they arrive, and when you press Ctrl-C prints a report per run. Add `--save run.jsonl` to keep what it
received; `tracey run.jsonl` (or the website) opens it later. It binds to `127.0.0.1` only unless you pass
`--host`, keeps everything in memory, and never forwards anything. It is verified with the Python SDK's
`OTLPSpanExporter` (protobuf); other exporters should work since the wire format is standard, but only that one
has been tried. Use the collector route above on the website, which cannot open a port.

## It didn't work

- No file: check the collector is running and the endpoint env var is set in the same
  process as the agent.
- Empty prompts: OpenInference and Strands capture content by default (OpenInference can be silenced with
  `OPENINFERENCE_HIDE_INPUTS` / `OPENINFERENCE_HIDE_OUTPUTS`); Claude Code redacts by default, see the
  Claude Agent SDK section for the `OTEL_LOG_*` flags.
- Spans missing at the end: flush the exporter before the process exits (call the provider's
  `shutdown()` or `force_flush()`). With the Claude Agent SDK the CLI batches every 5 s by default.
- `service.name` shows `unknown_service:python`: set `OTEL_SERVICE_NAME=my-agent`.
