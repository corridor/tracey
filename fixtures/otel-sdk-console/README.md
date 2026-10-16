# OpenTelemetry SDK ConsoleSpanExporter fixtures

Raw stdout of `opentelemetry.sdk.trace.export.ConsoleSpanExporter` (SDK 1.45.1, default formatter) for the
same scripted runs as `../openinference/` and `../otel-genai/`.

- `openinference.console.txt` - 16 spans, OpenInference attributes.
- `genai.console.txt` - 16 spans, OTel GenAI attributes (same hand-created agent/tool spans as `../otel-genai/`).

This is NOT OTLP and NOT valid JSON as a whole: it is a stream of pretty-printed (indent 4) JSON objects,
one per span, back to back (`}\n{`), in span END order. Differences from OTLP: snake_case keys
(`parent_id`, `start_time`), ISO-8601 timestamps, ids as `0x`-prefixed hex, `kind` as `"SpanKind.INTERNAL"`,
`status.status_code` as a string, attributes as a plain object, `resource` embedded in each span.
Paths in stack traces scrubbed. Produced by running the real SDK; nothing hand-edited.
