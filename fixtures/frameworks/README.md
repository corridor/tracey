# Framework fixtures

Real OTLP trace exports from minimal agents (one tool call, `add(2, 3)`, then a final answer) run against **fake models**
(no API keys). Produced 2026-10-16 on macOS, Python 3.12. See `docs/verification/frameworks.md` for versions and findings.

- `*.json` files are `ExportTraceServiceRequest` in OTLP/JSON (converted from the OTLP/HTTP protobuf body that a local
  receiver captured, `otlp_receiver.py`). For frameworks whose exporter sent one POST per span the requests are merged.
- `generate*.py` and `mock_*_server.py` are the scripts that produced them (fixture generators, not product code).
- `console-exporter.txt` is the OTel SDK `ConsoleSpanExporter` (or Strands console exporter) output of the same run.
- Model/tool content is real text produced by the stubs; no personal data. The Claude Code `user.id` hash was scrubbed.
