# Verification: Claude Code transcripts (roadmap 1.2, part B)

Method: structure-only scan (key paths, types, enum values, counts) of 87 real JSONL files
(22 sessions, 65 sub-agent files, 26,000+ records) under the config dir on one machine,
plus Anthropic's docs. No content was copied. The sample is narrow: **one user, one
machine, four close versions (2.1.296, 2.1.299, 2.1.300, 2.1.301)**. Older versions were
not available, so anything about them below is unconfirmed.

Fixture: `fixtures/claude-code/` (synthetic).

## Location

- Observed: `<config dir>/projects/<project-folder>/<session-id>.jsonl`. Here the config dir
  is `~/.claude_ali/`, not `~/.claude/`. The Claude Code docs say `CLAUDE_CONFIG_DIR`
  relocates the config dir (and `CLAUDE_CODE_PROJECT_DIR_NAME`, used with it, picks the
  `projects/` subfolder name). So the location varies; "Find sessions" must check
  `$CLAUDE_CONFIG_DIR`, then `~/.claude`, and let the user point at a folder.
- Project folder name: the working directory with every non-alphanumeric turned into `-`
  (observed; leading `-`). Not reversible, so show `cwd` from records instead.
- Per session, siblings: `<session-id>/subagents/agent-<agentId>.jsonl` plus
  `agent-<agentId>.meta.json`, and `<session-id>/tool-results/*.txt|png` (large tool output
  offloaded; the `tool_result.content` string then starts with a persisted-output marker
  and refers to the file).
- Retention: `cleanupPeriodDays` is believed to govern deletion **(unconfirmed, the settings
  page text I could read did not show it)**.

## Schema summary (keys only)

One JSON object per line. Common envelope on conversational records: `type`, `uuid`,
`parentUuid` (string or null), `sessionId`, `timestamp` (`YYYY-MM-DDTHH:MM:SS.mmmZ`),
`version`, `isSidechain` (bool), `userType` ("external"), `entrypoint` ("cli"), `cwd`,
`gitBranch`, optional `slug`, `sessionKind` ("bg" in the sample), `session_id` (snake case
duplicate, appears in newer records).

Record `type` values seen (count in sample): `attachment` 14012, `assistant` 7006, `user`
4013, `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `ai-title`, `queue-operation`
(`operation`: enqueue/dequeue/remove/popAll), `file-history-snapshot`, `file-history-delta`,
`api-request`, `api-request-blob`, `api-request-shape` (debug-ish request digests), `cost-state`,
`agent-name`, `continued-in`, `system` with `subtype` in {`turn_duration`, `stop_hook_summary`,
`away_summary`, `compact_boundary`, `informational`, `local_command`, `scheduled_task_fire`}.
Only `user`, `assistant`, `system`, `attachment` carry `uuid`/`parentUuid`.

**assistant**: `message` {`id`, `type`="message", `role`, `model`, `content[]`, `stop_reason`
(tool_use / end_turn / stop_sequence / null), `stop_sequence`, `usage`, `container`,
`context_management`, `diagnostics`, `stop_details`, `input_transformations[]`}; plus
`requestId`, `apiBlockIndex`, `requestedModel`, `advisorModel`, `effort`, `perTurnEffort`,
`thinkingDisplay`, `thinkingDurationMs`, `agentId` and `attributionAgent` (sidechain only),
`attributionMcpServer/Tool`, `attributionSkill/Plugin`, `requestRef` (replaces `requestId` in
2.1.299+/2.1.301 samples). Errors: `isApiErrorMessage`, `error` (rate_limit, server_error),
`apiError`, `apiErrorStatus`, `apiErrorParams`; such records have `message.model` =
`<synthetic>` and null usage fields.
- **One content block per record** (thinking | text | tool_use). Blocks from one API
  response share `message.id`, `requestId` and an identical `usage` copy, and chain via
  `parentUuid`. Verified in all 1478 multi-block messages. **Sum tokens once per message.id.**
- `tool_use` block: `id`, `name`, `input`, `caller.type` ("direct").
- `thinking` block: `thinking` (empty string in 80% of cases), `signature`.
- `usage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens`,
  `service_tier`, `speed`, `inference_geo`, `server_tool_use.{web_search,web_fetch}_requests`,
  `output_tokens_details.thinking_tokens`, `iterations[]`, `fallback_credit`.
- Models in sample: three `claude-*` ids plus `<synthetic>`. Don't hard-code names.

**user**: `message.role`="user", `message.content` is a string (prompt) or a list of blocks
(`tool_result`, `text`, `image`). `tool_result` block: `tool_use_id`, `content` (string or
list), optional `is_error` (bool). One tool_result per record, even for parallel calls; its
`parentUuid` equals `sourceToolAssistantUUID` (the assistant record with the tool_use).
Extras: `toolUseResult` (tool-specific, shape varies by tool, may be a plain string on
errors), `permissionDecision` {`decision` accept/reject/cancelled, `reasonType`, `source`},
`toolDenialKind`, `promptId`, `promptSource` (typed/system/queued), `turnOrigin`
(human/peer/task_notification/scheduled), `origin.kind`, `isMeta`, `isCompactSummary`,
`agentId`, `interruptedMessageId`.

**Sub-agents (sidechains)**: in this version they live in **separate files**
(`subagents/agent-<agentId>.jsonl`), all records `isSidechain: true`, `agentId` = file name
id, first record `parentUuid: null`, no dangling parents (65/65). The `.meta.json` has
`agentType`, `description`, `model`, `spawnDepth`, `requestShape`, `requestNonInteractive`,
`toolUseId` (the parent session's `Agent` tool_use id). The parent's tool_result for it has
`toolUseResult` {`agentId`, `status`, `description`, `prompt`, `resolvedModel`, `isAsync`,
`outputFile`, ...}. No main file in the sample had `isSidechain: true`.

**system/turn_duration**: `durationMs`, `messageCount`, optional `pendingBackgroundAgentCount`
(one per user turn; best source of turn wall time). **system/compact_boundary**: `content`,
`level`, `logicalParentUuid`, `compactMetadata` {`trigger`, `preTokens`, `postTokens`,
`durationMs`, `cumulativeDroppedTokens`, `preservedSegment`, `preservedMessages`}; the
following user record has `isCompactSummary: true`. **cost-state**: `modelUsage.<model>`
{tokens, `costUSD`, `thinkingTokens`}, `totalCostUSD`, `totalDuration`, `totalAPIDuration`,
`totalToolDuration`, lines added/removed (session totals, handy for cross-checking).

## Timing

Only `timestamp` per record (ms, UTC). There is no per-tool or per-LLM duration field.
Infer: tool span = tool_use record to its tool_result record; LLM span end = last block's
timestamp, start = the preceding record (inferred, flag it). Assistant blocks of one message
are written as they stream, so timestamps are close together. `thinkingDurationMs` and
`turn_duration.durationMs` are the only explicit durations.

## Version differences (within 2.1.296 to 2.1.301)

- `requestId` (2.1.296/299) vs `requestRef` (2.1.300/301).
- `slug`, `attributionMcp*` and API error fields absent in 2.1.300/301 samples (may be only
  because those sessions were short).
- `usage.speed`, `usage.iterations`, `fallback_credit`, `output_tokens_details`,
  `server_tool_use`, `advisorModel`, `apiBlockIndex`, `effort`: on all four.
- Older shapes (**unconfirmed, from memory, not in the sample**): `type: "summary"` records
  with `leafUuid`, sidechains inlined in the main file, fewer envelope fields.

## Stable vs risky

- Stable enough: JSONL; `type`; `uuid`/`parentUuid`; `timestamp`; `message.role`;
  `content[]` block types text/thinking/tool_use/tool_result; `tool_use.id` to
  `tool_result.tool_use_id`; `usage.input_tokens/output_tokens/cache_*`; `isSidechain`;
  `version`.
- Risky: sub-agent location (file vs inline), `requestId`/`requestRef`, `toolUseResult`
  shapes (per tool), the long tail of record types, `stop_reason: null` on streaming
  partials, `<synthetic>` messages, `thinking` text empty, large results offloaded to
  `tool-results/`, per-block usage duplication, parent chain being a tree after
  compaction/resume (`logicalParentUuid`, `preservedSegment`).
- Anthropic's docs I could read do not document the transcript record format at all (I did
  not find a statement either way that it is "internal"; treat it as undocumented).

## Detection fingerprints

Container: JSONL, every line a JSON object with a string `type`. Then, over the first ~50
lines, score:
1. `sessionId` + `uuid` + `parentUuid` + `timestamp` + `version` (matching `^\d+\.\d+\.\d+`)
   on `user`/`assistant` records (strong).
2. `assistant` records with `message.id` starting `msg_`, `message.usage.input_tokens`,
   content blocks of type thinking/text/tool_use (strong).
3. `user` records with `tool_result` blocks and `sourceToolAssistantUUID` (strong).
4. `entrypoint` and `userType` (supporting).
5. Any of `permission-mode`, `last-prompt`, `ai-title`, `file-history-snapshot` as `type`
   (supporting). Do NOT require the first line to be `user`: real files start with
   `last-prompt`/`ai-title` (main) or `user` (sub-agent).
Report `version` from the records and warn on versions outside the tested range. A
sub-agent file alone (all `isSidechain: true`, has `agentId`) should say "sub-agent of
session X", and ask for the parent file.

## OpenTelemetry route (documented)

Source: https://code.claude.com/docs/en/monitoring-usage (read first 100k of 152k chars;
rest unread).
- `CLAUDE_CODE_ENABLE_TELEMETRY=1` (required), `OTEL_METRICS_EXPORTER`,
  `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER` (otlp|console|none; traces are **beta**),
  `OTEL_EXPORTER_OTLP_PROTOCOL` (grpc|http/json|http/protobuf),
  `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, per-signal
  `OTEL_EXPORTER_OTLP_{METRICS,LOGS,TRACES}_{ENDPOINT,PROTOCOL,HEADERS}`.
- Traces additionally need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`. Detailed tracing:
  `ENABLE_BETA_TRACING_DETAILED=1` + `BETA_TRACING_ENDPOINT` (org allowlisting for
  interactive CLI). `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1` for proxies.
- Content is off by default: `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
  `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` (`tool.output` span event, needs tracing),
  `OTEL_LOG_RAW_API_BODIES`, `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH`.
- Spans: `claude_code.interaction` (root per prompt), `claude_code.llm_request`,
  `claude_code.tool` (+ `.blocked_on_user`, `.execution`), `claude_code.hook` (detailed beta).
  `llm_request` attrs: `gen_ai.request.model`, `input_tokens`, `output_tokens`,
  `cache_read_tokens`, `cache_creation_tokens`, `ttft_ms`, `stop_reason`, `request_id`.
  Events (logs): `claude_code.user_prompt`, `api_request`, `tool_result`, ... correlated by
  `prompt.id`, `tool_use_id`. Metrics: `claude_code.token.usage`, `claude_code.cost.usage`.
- Detection fingerprint for that route: span names starting `claude_code.`. These are
  `claude_code.*` attributes, not `gen_ai.operation.name`, so OTel GenAI detection will not
  claim them. **Unconfirmed by me:** whether sub-agent spans nest under `claude_code.tool`;
  not tested with a real OTLP export. Telemetry only affects future sessions; transcripts
  exist for past ones.

## What was wrong or missing in our docs

- `guides/harness-sessions.md`, `user-flows.md` Flow F: path hard-coded to `~/.claude/`;
  must say config dir can differ (`CLAUDE_CONFIG_DIR`; this machine uses `~/.claude_ali/`).
- Same files: sub-agents are separate files, so "drop in one file" loses them; the adapter
  needs the session folder (or a file plus sibling `<session-id>/subagents/`).
- `format-detection.md`: "records with a `type` and `message.content` blocks" is wrong or too
  weak: most record types have no `message`, and every `assistant` record holds exactly one
  block. Needs the fingerprints above. Also missing: token double counting per `message.id`,
  no explicit tool/LLM durations, `version` is on every record.
- `/export` is unverified, and I believe it writes readable text, not JSONL **(unconfirmed)**.
  The guide's "use `/export`" advice may mislead.
- The "Anthropic docs say the format is internal" claim could not be confirmed from the pages
  I read; reword to "not documented".
- Flow F says "token usage gives cost where recorded": cost is not recorded per message
  (only `cost-state` session totals); price must be computed from usage, with
  `<synthetic>` rows excluded.
- OTel route missing from the guide; added below and in the guide.
