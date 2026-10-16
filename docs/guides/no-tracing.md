# I have an agent, but no tracing

> Draft, untested. Code is from memory of current APIs. **(verify)** every snippet by running
> it before release.

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

Pick one. Each is "install, add a few lines, run the agent once".

### LangGraph / LangChain / DeepAgents

Use an OpenInference instrumentor (DeepAgents is built on LangGraph, so the same applies):

```python
# pip install openinference-instrumentation-langchain opentelemetry-sdk opentelemetry-exporter-otlp
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.langchain import LangChainInstrumentor

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter()))
LangChainInstrumentor().instrument(tracer_provider=provider)
```

LangSmith also has an OpenTelemetry mode (`LANGSMITH_OTEL_ENABLED`) **(verify)**.

### OpenAI Agents SDK

```python
# pip install openinference-instrumentation-openai-agents  (plus the OTel packages above)
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)  # provider as above
```

The SDK also has built-in tracing that goes to OpenAI's dashboard by default; you want the
OTel route to get a local file. **(verify)**

### Strands Agents

Strands has built-in OpenTelemetry tracing. Configure its telemetry helper with an OTLP
exporter pointing at the collector, or with its console exporter. **(verify exact helper
names)**

### Claude Agent SDK

Reported to need telemetry environment flags plus a traces beta flag, and an OTLP exporter.
**(verify against Anthropic's docs before writing this up; third-party sources disagree)**

### Something else

Any OpenAI or Anthropic client call can be traced with an OpenInference or OpenLLMetry
instrumentor for that client. Same pattern: instrument with the provider above.

## Step 3: run the agent once, then drop in the file

`traces.json` appears next to the collector. Drop it in tracey. Expect *Detected OpenInference*
(or OTel GenAI) and your spans.

## Faster: skip the collector with `tracey listen` (planned)

With the CLI or desktop app you won't need the collector or a file. Run `tracey listen`
(or flip "Listen" in the desktop app), point your agent at it, and watch spans arrive live:

```bash
tracey listen                      # receiver on http://localhost:4318, local only
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
python my_agent.py                 # your LangGraph / DeepAgents / Strands / OpenAI Agents app
```

Steps 2 and 3 are unchanged: you still enable OpenTelemetry in your framework. Not built yet;
see the roadmap. Use the collector route above until then, and on the website.

## It didn't work

- No file: check the collector is running and the endpoint env var is set in the same
  process as the agent.
- Empty prompts: content capture is off in your instrumentor; enable it.
- Spans missing at the end: flush the exporter before the process exits (call the provider's
  `shutdown()` or `force_flush()`).
