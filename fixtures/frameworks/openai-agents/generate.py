import os, sys
mode = sys.argv[1]  # console | otlp
os.environ["OPENAI_API_KEY"] = "sk-mock"
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
from agents import Agent, Runner, function_tool, set_default_openai_client, set_default_openai_api, set_tracing_disabled
from openai import AsyncOpenAI

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter() if mode == "console" else OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces")))
OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)

set_default_openai_client(AsyncOpenAI(base_url="http://127.0.0.1:9911/v1", api_key="sk-mock"))
set_default_openai_api("chat_completions")

@function_tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

agent = Agent(name="adder", instructions="You add numbers.", tools=[add], model="gpt-4o-mini")
print(Runner.run_sync(agent, "What is 2 + 3?").final_output)
provider.shutdown()
