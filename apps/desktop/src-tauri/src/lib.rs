use std::path::Path;
use std::sync::Mutex;
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
        .invoke_handler(tauri::generate_handler![take_pending_open])
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
