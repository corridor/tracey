# I already have tracing

> Draft, untested. **(verify)** marks the shakiest steps.

You only need to get one trace out as a file. tracey detects the source itself.

## Any OpenTelemetry source (works for most of the below)

The most reliable route is to run a local OpenTelemetry Collector that **also** writes spans to a
file, next to wherever they already go. Your existing backend is unaffected.

```yaml
# collector.yaml  (uses the contrib distribution's file exporter)
receivers:
  otlp:
    protocols:
      http: {}
exporters:
  file:
    path: ./traces.json
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file]
```

Point your app at it: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, run the agent
once, then drop `traces.json` into tracey. Stop the collector (or wait a few seconds) so the
last batch is flushed.

What the file looks like (verified against collector-contrib 0.162.0, see
`docs/verification/otel-openinference.md`): newline-delimited OTLP JSON, **one line per exported
batch** (not per span). Each line is a full `{"resourceSpans":[...]}` object, so one trace can span
several lines and a small trace can be a single long line. Keys are camelCase, ids are hex strings,
timestamps are nanosecond strings, attributes are `[{"key":..,"value":{"stringValue":..}}]` arrays.
If you add a `rotation:` block, rotated files are renamed with a timestamp; `format: proto` and
`compression: zstd` produce files tracey does not read directly, so leave them at the defaults.

Quick alternative: the OpenTelemetry Python SDK's `ConsoleSpanExporter` prints spans to stdout.
This is **not** OTLP: it is a stream of pretty-printed JSON objects back to back (not valid JSON as a
whole, not one per line), with snake_case keys, `0x` ids and `"kind": "SpanKind.INTERNAL"`. Redirect
to a file and drop it in; tracey accepts this "SDK console" shape (fixtures in
`fixtures/otel-sdk-console/`). Other languages' console exporters were not checked.

## OpenInference (Arize Phoenix / Arize AX)

1. Phoenix: open the trace, use its export/download option, or query spans via its client
   and save to JSON. **(verify: Phoenix export shape not checked)**
2. Or use the collector route above if your app exports OTLP. OpenInference spans are ordinary
   OTLP spans, so the collector file is verified to work (`fixtures/openinference/`).
3. Drop it in. Expect: *Detected OpenInference* (`openinference.span.kind` is required on every
   OpenInference span, values `LLM`, `AGENT`, `TOOL`, `CHAIN`, ...).

## Dynatrace and OpenLLMetry / Traceloop

Dynatrace takes OpenTelemetry GenAI spans over OTLP, so use the collector route above and add
the file exporter alongside your Dynatrace exporter. **(verify)** You can also export spans
from Dynatrace itself; availability and shape not yet confirmed.
Expect: *OTel GenAI* and/or *OpenLLMetry*; mixed naming is normal.

## Datadog (ddtrace / LLM Observability)

1. Make sure LLM Observability is enabled; plain APM spans have timings but no prompts or
   outputs.
2. Export the trace JSON from the Datadog UI or API. **(verify route and shape)**
3. Drop it in. Expect: *Datadog LLM Observability*. If only APM spans, tracey tells you what
   is missing.

## Langfuse

1. Open the trace, export observations as JSON from the UI, or fetch via the API. **(verify)**
2. Drop it in. Expect: *Langfuse*.

## LangSmith

1. Export runs as JSON via the SDK/API. (Bulk export is Parquet to S3 on paid plans; tracey
   doesn't read that directly.) **(verify)**
2. Drop it in. Expect: *LangSmith*.

## It didn't work

- "Unrecognised": tracey shows what it tried and a generic view. Use "report this" to copy
  the detection evidence.
- Spans but no prompts: your instrumentation isn't capturing content (often disabled by
  default for privacy). Enable content capture in your instrumentation.
- Only one span: the trace was cut off; export again after the run finishes.
