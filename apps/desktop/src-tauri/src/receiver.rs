//! A deliberately dumb local OTLP/HTTP receiver. It accepts POSTs to /v1/traces and hands the raw body to
//! the page, which decodes it with the same TypeScript decoder the CLI and website use. Loopback only by
//! default; nothing is stored here and nothing is forwarded.

use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

/// One accepted request, ready to cross to the page.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub content_type: String,
    pub encoding: String,
    /// The raw request body, base64.
    pub body_b64: String,
}

pub struct Receiver {
    pub port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

const MAX_BODY: u64 = 64 * 1024 * 1024;

fn header(req: &tiny_http::Request, name: &str) -> String {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default()
}

fn handle(mut req: tiny_http::Request, on_batch: &(dyn Fn(Batch) + Send + Sync)) {
    let url = req.url().split('?').next().unwrap_or("/").to_string();
    let is_json = header(&req, "content-type").contains("json");
    let ok = |is_json: bool| {
        let (body, ct) = if is_json { ("{}", "application/json") } else { ("", "application/x-protobuf") };
        tiny_http::Response::from_string(body)
            .with_header(tiny_http::Header::from_bytes("content-type", ct).unwrap())
    };
    let text = |status: u16, msg: &str| tiny_http::Response::from_string(msg.to_string()).with_status_code(status);

    if req.method() == &tiny_http::Method::Get && url == "/" {
        let _ = req.respond(text(200, "tracey is listening for OTLP traces on /v1/traces\n"));
        return;
    }
    if req.method() != &tiny_http::Method::Post {
        let _ = req.respond(text(405, "method not allowed\n"));
        return;
    }
    if url != "/v1/traces" && url != "/v1/metrics" && url != "/v1/logs" {
        let _ = req.respond(text(404, "only /v1/traces is served\n"));
        return;
    }
    let mut body = Vec::new();
    if req.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY {
        let _ = req.respond(text(413, "request body too large\n"));
        return;
    }
    // Metrics and logs are accepted and ignored so exporters of other signals do not error.
    if url == "/v1/traces" {
        on_batch(Batch {
            content_type: header(&req, "content-type"),
            encoding: header(&req, "content-encoding"),
            body_b64: base64::engine::general_purpose::STANDARD.encode(&body),
        });
    }
    let _ = req.respond(ok(is_json));
}

/// Start listening. `port` 0 picks a free one; the chosen port is in the result.
pub fn start(host: &str, port: u16, on_batch: Arc<dyn Fn(Batch) + Send + Sync>) -> Result<Receiver, String> {
    let server = tiny_http::Server::http((host, port)).map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::spawn(move || {
        while !flag.load(Ordering::Relaxed) {
            match server.recv_timeout(Duration::from_millis(100)) {
                Ok(Some(req)) => handle(req, on_batch.as_ref()),
                Ok(None) => {}
                Err(_) => break,
            }
        }
    });
    Ok(Receiver { port, stop, thread: Some(thread) })
}

impl Receiver {
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;
    use std::sync::Mutex;

    fn request(port: u16, method: &str, path: &str, headers: &str, body: &[u8]) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let head = format!("{method} {path} HTTP/1.1\r\nHost: x\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        s.write_all(head.as_bytes()).unwrap();
        s.write_all(body).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    fn collecting() -> (Arc<Mutex<Vec<Batch>>>, Arc<dyn Fn(Batch) + Send + Sync>) {
        let got = Arc::new(Mutex::new(Vec::new()));
        let g = got.clone();
        (got, Arc::new(move |b| g.lock().unwrap().push(b)))
    }

    #[test]
    fn hands_trace_bodies_to_the_page_with_their_headers() {
        let (got, cb) = collecting();
        let r = start("127.0.0.1", 0, cb).unwrap();
        let out = request(r.port, "POST", "/v1/traces", "Content-Type: application/x-protobuf\r\nContent-Encoding: gzip\r\n", &[1, 2, 3, 250]);
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        let got = got.lock().unwrap().clone();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].content_type, "application/x-protobuf");
        assert_eq!(got[0].encoding, "gzip");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(&got[0].body_b64).unwrap(), vec![1, 2, 3, 250]);
        r.stop();
    }

    #[test]
    fn answers_json_with_json_and_ignores_metrics_logs_and_unknown_routes() {
        let (got, cb) = collecting();
        let r = start("127.0.0.1", 0, cb).unwrap();
        let json = request(r.port, "POST", "/v1/traces", "Content-Type: application/json\r\n", b"{}");
        assert!(json.contains("application/json") && json.ends_with("{}"), "{json}");
        assert!(request(r.port, "POST", "/v1/metrics", "Content-Type: application/json\r\n", b"{}").starts_with("HTTP/1.1 200"));
        assert!(request(r.port, "POST", "/v1/logs", "Content-Type: application/x-protobuf\r\n", b"").starts_with("HTTP/1.1 200"));
        assert!(request(r.port, "POST", "/other", "", b"x").starts_with("HTTP/1.1 404"));
        assert!(request(r.port, "PUT", "/v1/traces", "", b"x").starts_with("HTTP/1.1 405"));
        assert!(request(r.port, "GET", "/", "", b"").contains("tracey is listening"));
        assert_eq!(got.lock().unwrap().len(), 1, "only /v1/traces reaches the page");
        r.stop();
    }

    #[test]
    fn reports_a_port_in_use_and_frees_the_port_on_stop() {
        let (_, cb) = collecting();
        let a = start("127.0.0.1", 0, cb.clone()).unwrap();
        assert!(start("127.0.0.1", a.port, cb.clone()).is_err());
        let port = a.port;
        a.stop();
        let again = start("127.0.0.1", port, cb).unwrap();
        again.stop();
    }
}
