# OTLP protobuf fixture

`sample.pb` is a real `ExportTraceServiceRequest` in protobuf wire format, made by the Python
OpenTelemetry SDK (`opentelemetry-sdk` 1.41.1) and `opentelemetry-exporter-otlp-proto-http`'s
`encode_spans`, the same bytes an OTLP/HTTP exporter POSTs with `Content-Type: application/x-protobuf`.

Five spans in one trace: an OpenInference `planner` agent, one `ChatCompletion` LLM span (with token counts
and non-ASCII output), and three failing `search_flights` tool spans. Attributes cover string, int (including
one above 2^32), double, bool and array values. `expected.json` lists the span names and error count.
Generated from invented data; no real content.
