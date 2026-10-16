"""Mock OpenAI chat.completions server: 1st call -> tool call, 2nd -> final text."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['content-length'])))
        has_tool = any(m.get("role") == "tool" for m in req["messages"])
        if has_tool:
            msg = {"role": "assistant", "content": "2 + 3 = 5"}; fr = "stop"
        else:
            msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "add", "arguments": "{\"a\": 2, \"b\": 3}"}}]}; fr = "tool_calls"
        body = json.dumps({"id": "chatcmpl-mock", "object": "chat.completion", "created": 1, "model": req.get("model", "mock"),
            "choices": [{"index": 0, "message": msg, "finish_reason": fr}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
