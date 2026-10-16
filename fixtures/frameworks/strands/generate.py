import os, sys, json
os.environ.setdefault("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318")
from strands import Agent, tool
from strands.models import Model
from strands.telemetry import StrandsTelemetry

mode = sys.argv[1]  # console | otlp
t = StrandsTelemetry()
if mode == "console": t.setup_console_exporter()
else: t.setup_otlp_exporter()

@tool
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

class Mock(Model):
    def __init__(self): self.n = 0
    def update_config(self, **k): pass
    def get_config(self): return {"model_id": "mock-model"}
    async def structured_output(self, *a, **k):
        raise NotImplementedError
        yield
    async def stream(self, messages, tool_specs=None, system_prompt=None, **kw):
        self.n += 1
        yield {"messageStart": {"role": "assistant"}}
        if self.n == 1:
            yield {"contentBlockStart": {"start": {"toolUse": {"toolUseId": "t1", "name": "add"}}}}
            yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps({"a": 2, "b": 3})}}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "tool_use"}}
        else:
            yield {"contentBlockStart": {"start": {}}}
            yield {"contentBlockDelta": {"delta": {"text": "2 + 3 = 5"}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15}, "metrics": {"latencyMs": 1}}}

agent = Agent(model=Mock(), tools=[add], system_prompt="You add numbers.", name="adder")
print(agent("What is 2 + 3?"))
t.tracer_provider.force_flush()
