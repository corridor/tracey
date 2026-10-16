import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
def sse(ev, d): return f"event: {ev}\ndata: {json.dumps(d)}\n\n".encode()
class H(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get('content-length',0))) or b"{}")
        print(self.path, req.get("model"), req.get("stream"), flush=True)
        if "messages" not in self.path: 
            b=b"{}"; self.send_response(200); self.send_header("content-length",str(len(b))); self.end_headers(); self.wfile.write(b); return
        msg={"id":"msg_1","type":"message","role":"assistant","model":req.get("model","m"),"content":[{"type":"text","text":"Hello from mock"}],"stop_reason":"end_turn","stop_sequence":None,"usage":{"input_tokens":10,"output_tokens":5}}
        if req.get("stream"):
            out=sse("message_start",{"type":"message_start","message":{**msg,"content":[],"stop_reason":None}})
            out+=sse("content_block_start",{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})
            out+=sse("content_block_delta",{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from mock"}})
            out+=sse("content_block_stop",{"type":"content_block_stop","index":0})
            out+=sse("message_delta",{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":None},"usage":{"output_tokens":5}})
            out+=sse("message_stop",{"type":"message_stop"})
            self.send_response(200); self.send_header("content-type","text/event-stream"); self.send_header("content-length",str(len(out))); self.end_headers(); self.wfile.write(out)
        else:
            b=json.dumps(msg).encode(); self.send_response(200); self.send_header("content-type","application/json"); self.send_header("content-length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self,*a): pass
ThreadingHTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
