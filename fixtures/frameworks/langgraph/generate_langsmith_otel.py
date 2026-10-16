from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langchain.agents import create_agent
@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b
class Fake(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kw): return self
model = Fake(responses=[AIMessage(content="", tool_calls=[{"name":"add","args":{"a":2,"b":3},"id":"call_1"}]), AIMessage(content="2 + 3 = 5")])
agent = create_agent(model, tools=[add], system_prompt="You add numbers.")
print(agent.invoke({"messages":[("user","What is 2 + 3?")]})["messages"][-1].content)
import time; time.sleep(3)
