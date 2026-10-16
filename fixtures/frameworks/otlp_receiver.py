"""Tiny OTLP/HTTP receiver: saves each POST /v1/traces body (protobuf) and a JSON rendering."""
import sys, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from google.protobuf.json_format import MessageToDict
out = sys.argv[1]; port = int(sys.argv[2])
n = 0
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        global n
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        ct = self.headers.get('content-type')
        n += 1
        open(f"{out}.{n}.pb", "wb").write(body)
        req = ExportTraceServiceRequest(); req.ParseFromString(body)
        json.dump(MessageToDict(req), open(f"{out}.{n}.json", "w"), indent=1)
        print("got", self.path, ct, len(body), flush=True)
        self.send_response(200); self.send_header('content-type','application/x-protobuf'); self.end_headers()
        self.wfile.write(b"")
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1", port), H).serve_forever()
