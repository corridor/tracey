import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions
env = {"CLAUDE_CODE_ENABLE_TELEMETRY":"1","CLAUDE_CODE_ENHANCED_TELEMETRY_BETA":"1","OTEL_TRACES_EXPORTER":"otlp",
 "OTEL_EXPORTER_OTLP_PROTOCOL":"http/protobuf","OTEL_EXPORTER_OTLP_ENDPOINT":"http://127.0.0.1:4318","OTEL_TRACES_EXPORT_INTERVAL":"500",
 "ANTHROPIC_BASE_URL":"http://127.0.0.1:9912","ANTHROPIC_API_KEY":"sk-mock","OTEL_SERVICE_NAME":"my-agent"}
async def main():
    async for m in query(prompt="say hi", options=ClaudeAgentOptions(env=env)): print(type(m).__name__)
asyncio.run(main())
