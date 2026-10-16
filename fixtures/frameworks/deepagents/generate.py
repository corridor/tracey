import sys
mode = sys.argv[1]  # console | otlp
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter, BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from openinference.instrumentation.langchain import LangChainInstrumentor
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from deepagents import create_deep_agent

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter() if mode == "console" else OTLPSpanExporter(endpoint="http://127.0.0.1:4318/v1/traces")))
LangChainInstrumentor().instrument(tracer_provider=provider)

@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

class Fake(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kw): return self

model = Fake(responses=[
    AIMessage(content="", tool_calls=[{"name": "add", "args": {"a": 2, "b": 3}, "id": "call_1"}]),
    AIMessage(content="2 + 3 = 5")])
agent = create_deep_agent(model=model, tools=[add], system_prompt="You add numbers.")
out = agent.invoke({"messages": [("user", "What is 2 + 3?")]})
print(out["messages"][-1].content)
provider.shutdown()
