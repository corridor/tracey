mod receiver;
mod sessions;

use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, RunEvent};

/// A file the OS asked us to open before the page was ready to hear about it.
#[derive(Default)]
struct PendingOpen(Mutex<Option<String>>);

/// First command-line argument that is an existing file (Windows and Linux pass the opened file
/// this way; flags and unknown paths are ignored).
pub fn file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

/// The running OTLP receiver, if the user turned Listen on.
#[derive(Default)]
struct Listener(Mutex<Option<receiver::Receiver>>);

/// Sessions already on this machine (Claude Code), newest first.
#[tauri::command]
fn scan_sessions() -> Vec<sessions::SessionInfo> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(std::path::PathBuf::from);
    match home {
        Some(h) => sessions::discover(&h, std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref(), 200),
        None => Vec::new(),
    }
}

/// Start the local receiver on 127.0.0.1 and return the port. Batches reach the page as `tracey://otlp` events.
#[tauri::command]
fn listen_start(app: tauri::AppHandle, state: tauri::State<Listener>, port: u16) -> Result<u16, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(r) = slot.as_ref() {
        return Ok(r.port);
    }
    let handle = app.clone();
    let r = receiver::start("127.0.0.1", port, Arc::new(move |b| {
        let _ = handle.emit("tracey://otlp", b);
    }))
    .map_err(|e| if e.contains("in use") { format!("port {port} is already in use") } else { e })?;
    let chosen = r.port;
    *slot = Some(r);
    Ok(chosen)
}

#[tauri::command]
fn listen_stop(state: tauri::State<Listener>) {
    if let Some(r) = state.0.lock().ok().and_then(|mut s| s.take()) {
        r.stop();
    }
}

/// The page calls this once at startup to pick up a file it was launched with.
#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().ok().and_then(|mut p| p.take())
}

fn open_path(app: &tauri::AppHandle, path: String) {
    // If the page is already running it hears the event; otherwise it will ask for the pending path.
    if let Ok(mut p) = app.state::<PendingOpen>().0.lock() {
        *p = Some(path.clone());
    }
    let _ = app.emit("tracey://open", path);
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingOpen::default())
        .manage(Listener::default())
        .invoke_handler(tauri::generate_handler![take_pending_open, scan_sessions, listen_start, listen_stop])
        .setup(|app| {
            if let Some(path) = file_arg(std::env::args()) {
                open_path(app.handle(), path);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tracey");

    app.run(|handle, event| {
        // macOS delivers "Open with tracey" and double-clicks as an Opened event.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = &event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    open_path(handle, path.to_string_lossy().into_owned());
                }
            }
        }
        let _ = (handle, event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str) -> String {
        let p = std::env::temp_dir().join(format!("tracey-test-{}-{}", std::process::id(), name));
        std::fs::File::create(&p).unwrap().write_all(b"{}").unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn picks_the_first_existing_file_and_skips_flags() {
        let f = temp_file("a.jsonl");
        let args = vec!["tracey".into(), "--flag".into(), "/no/such/file".into(), f.clone()];
        assert_eq!(file_arg(args), Some(f));
    }

    #[test]
    fn ignores_the_program_name_and_returns_none_without_a_file() {
        let f = temp_file("b.jsonl");
        assert_eq!(file_arg(vec![f]), None); // argv[0] is the program, never a file to open
        assert_eq!(file_arg(vec!["tracey".into()]), None);
    }
}
