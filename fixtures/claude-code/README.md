# Claude Code fixture (synthetic)

Fully invented data in the real record shape, observed on Claude Code 2.1.296 to 2.1.301
(see `docs/verification/claude-code.md`). No real session content. Paths, ids and text are
made up. Fixture files:

- `session.jsonl` (17 lines): the main session.
- `subagents/agent-a1b2c3d4e5f6a7b8c.jsonl` (4 lines) and `.meta.json`: the sub-agent run.
  Real Claude Code writes sub-agents to `<session-id>/subagents/`, next to the session file
  (here the session file is named `session.jsonl` instead of `<session-id>.jsonl`).

The task: fix an off-by-one in `paginate()`. Included on purpose: a user turn, a thinking
block (empty text plus signature, as in most real records), a Read, a failing Bash call
(`is_error: true`) that the model ignores, the identical Read repeated, an Edit, an `Agent`
tool call that runs a sidechain, token usage on every assistant record, ISO timestamps.

## Fields that matter

- Every record: `type`, `uuid`, `parentUuid` (null for the first), `sessionId`, `timestamp`
  (UTC ISO, ms), `version`, `isSidechain`, `cwd`, `gitBranch`, `entrypoint`, `userType`.
- `assistant`: ONE content block per record. Blocks of one API response share
  `message.id`, `requestId`, `message.usage` (identical copy on each) and chain through
  `parentUuid`. Count tokens once per `message.id`.
- `user` with `message.content` as a string is a prompt. With a list it holds one
  `tool_result` (`tool_use_id`, `content`, optional `is_error`). Its `parentUuid` and
  `sourceToolAssistantUUID` point at the assistant record holding the `tool_use`.
- `toolUseResult` carries a tool-specific structured result (shape varies per tool).
- Non-conversation records (`permission-mode`, `ai-title`, `last-prompt`, `system` with
  `subtype: turn_duration`) have no `message`. Real files have many more kinds (attachment,
  file-history-snapshot, queue-operation, cost-state, api-request...); ignore unknown types.

## Mapping to spans

| Source | Span |
|---|---|
| Group of assistant records with one `message.id` | `llm` span. Start = previous record's timestamp (inferred), end = last block timestamp. Usage, model, stop_reason from the record. |
| `tool_use` block + `tool_result` with matching id | `tool` span. Start = tool_use record timestamp, end = tool_result record timestamp. `is_error` gives error status. |
| `Agent` tool_use whose id equals a `subagents/*.meta.json` `toolUseId` | `agent` span (replaces the plain tool span); the sidechain file's records become its children (same rules). |
| User prompt record up to the `turn_duration` system record | `agent` / turn root. `durationMs` is authoritative. |

Findings the fixture should trigger: tool error ignored (`toolu_syn_02`), repeated identical
Read (`toolu_syn_01` and `toolu_syn_03`).
