# GGX platform span export

`smoke.jsonl` is a real export from the GGX platform (three spans of a local smoke test: a CHAIN with two LLM
calls, content "What is GGX?"), one JSON object per line. Each record has flat columns (`trace_id`, `span_id`,
`parent_span_id`, `name`, `kind`, `status`, `status_message`, `start_time`, `end_time` (ISO, no time zone),
`duration_ms`, `session_id`, `model`, `provider`, `input_tokens`, `output_tokens`, `cache_read_tokens`, ...)
and a `document` with the OpenInference `attributes`, the OpenTelemetry `resource`, and `events`.
Contains no secrets; ids are random.
