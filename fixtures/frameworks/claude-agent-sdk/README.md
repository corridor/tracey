# Claude Agent SDK / Claude Code fixtures

Packages tested: `claude-agent-sdk 0.2.168` (Python), Claude Code CLI `2.1.301` (the SDK spawns it; the CLI does the telemetry).

`mock_anthropic_server.py` is a tiny fake `/v1/messages` streaming endpoint (`ANTHROPIC_BASE_URL`), so no key is needed.
No tool call is in this run; only a text answer.

- `otlp-agent-sdk-python.json` (`generate.py`): telemetry env passed through `ClaudeAgentOptions(env=...)`:
  `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`, `OTEL_TRACES_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`. **Convention: neither; Claude Code custom spans with some GenAI attributes.** Spans `claude_code.interaction` (root),
  `claude_code.llm_request`; attributes `gen_ai.system=anthropic`, `gen_ai.request.model`, `gen_ai.operation.name=invoke_agent` (interaction), `input_tokens`, `output_tokens`, `session.id`.
  Scope `com.anthropic.claude_code.tracing`.
- `otlp-claude-code-cli.json`: same via plain `claude -p`.

Prompts are redacted by default (`user_prompt` = `<REDACTED>`); `user.id` scrubbed.
