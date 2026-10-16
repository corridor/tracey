//! Find agent sessions already on this machine. Mirrors `@ggx/trace-discover` (the CLI's scanner): the
//! same folders, the same rules, so the picker shows the same list in both.
//!
//! Reads folder listings and file stats, plus the first 32 KB of the newest files for a title and a
//! project path. Never the conversation.

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub source: &'static str,
    pub path: String,
    pub title: Option<String>,
    pub project: Option<String>,
    pub mtime_ms: f64,
    pub size: u64,
}

/// `$CLAUDE_CONFIG_DIR`, `~/.claude` and any other `~/.claude*` folder that has a `projects/` dir.
pub fn claude_config_dirs(home: &Path, env_dir: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(d) = env_dir.filter(|d| !d.is_empty()) {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(rd) = fs::read_dir(home) {
        let mut names: Vec<_> = rd
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(".claude"))
            .map(|e| e.path())
            .collect();
        names.sort();
        for p in names {
            if !dirs.contains(&p) {
                dirs.push(p);
            }
        }
    }
    dirs.into_iter().filter(|d| d.join("projects").is_dir()).collect()
}

/// Value of the first `"key":"..."` string in `head`, decoded as JSON.
fn string_field(head: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let at = head.find(&needle)? + needle.len();
    let rest = head[at..].trim_start().strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let mut end = None;
    let mut escaped = false;
    for (i, c) in rest.char_indices() {
        if escaped {
            escaped = false;
        } else if c == '\\' {
            escaped = true;
        } else if c == '"' {
            end = Some(i);
            break;
        }
    }
    let literal = format!("\"{}\"", &rest[..end?]);
    serde_json::from_str::<String>(&literal).ok().filter(|s| !s.is_empty())
}

fn read_head(path: &Path) -> (Option<String>, Option<String>) {
    let mut buf = vec![0u8; 32 * 1024];
    let n = match fs::File::open(path).and_then(|mut f| f.read(&mut buf)) {
        Ok(n) => n,
        Err(_) => return (None, None),
    };
    // A cut in the middle of a multi-byte character is fine: lossy decoding only affects the tail.
    let head = String::from_utf8_lossy(&buf[..n]);
    (string_field(&head, "aiTitle"), string_field(&head, "cwd"))
}

/// Newest-first sessions found under the Claude config folders.
pub fn discover(home: &Path, env_dir: Option<&str>, limit: usize) -> Vec<SessionInfo> {
    let mut found: Vec<SessionInfo> = Vec::new();
    for dir in claude_config_dirs(home, env_dir) {
        let Ok(projects) = fs::read_dir(dir.join("projects")) else { continue };
        for project in projects.flatten() {
            let Ok(files) = fs::read_dir(project.path()) else { continue }; // not a directory
            for f in files.flatten() {
                let path = f.path();
                // Sub-agent files live one level deeper, with their session, and are not listed.
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(meta) = f.metadata() else { continue };
                if !meta.is_file() || meta.len() == 0 {
                    continue;
                }
                let mtime_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);
                found.push(SessionInfo {
                    source: "claude-code",
                    path: path.to_string_lossy().into_owned(),
                    title: None,
                    project: None,
                    mtime_ms,
                    size: meta.len(),
                });
            }
        }
    }
    found.sort_by(|a, b| b.mtime_ms.partial_cmp(&a.mtime_ms).unwrap_or(std::cmp::Ordering::Equal));
    found.truncate(limit);
    for s in &mut found {
        let (title, project) = read_head(Path::new(&s.path));
        s.title = title;
        s.project = project;
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn write(path: &Path, body: &str, age_secs: u64) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
        let t = SystemTime::now() - Duration::from_secs(age_secs);
        fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn finds_sessions_across_claude_folders_newest_first_with_title_and_project() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        write(&h.join(".claude/projects/-work-shop/s1.jsonl"), "{\"type\":\"ai-title\",\"aiTitle\":\"Fix login test\"}\n{\"cwd\":\"/work/shop\"}\n", 600);
        write(&h.join(".claude_work/projects/-work-api/s2.jsonl"), "{\"cwd\":\"/work/api\"}\n", 10);
        let found = discover(h, None, 200);
        assert_eq!(found.len(), 2);
        assert!(found[0].path.ends_with("s2.jsonl"), "newest first");
        assert_eq!(found[0].project.as_deref(), Some("/work/api"));
        assert_eq!(found[1].title.as_deref(), Some("Fix login test"));
        assert_eq!(found[1].project.as_deref(), Some("/work/shop"));
        assert_eq!(found[1].source, "claude-code");
    }

    #[test]
    fn honours_the_env_dir_and_skips_empty_files_subagents_and_other_files() {
        let home = tempfile::tempdir().unwrap();
        let custom = home.path().join("elsewhere");
        write(&custom.join("projects/p/real.jsonl"), "{\"cwd\":\"/x\"}\n", 0);
        write(&custom.join("projects/p/empty.jsonl"), "", 0);
        write(&custom.join("projects/p/notes.txt"), "x", 0);
        write(&custom.join("projects/p/real/subagents/agent-1.jsonl"), "{}\n", 0);
        fs::create_dir_all(home.path().join(".claude-empty")).unwrap();
        let found = discover(home.path(), custom.to_str(), 200);
        assert_eq!(found.len(), 1);
        assert!(found[0].path.ends_with("real.jsonl"));
    }

    #[test]
    fn empty_and_missing_homes_give_empty_lists_and_limits_apply() {
        let home = tempfile::tempdir().unwrap();
        assert!(discover(home.path(), None, 200).is_empty());
        assert!(discover(&home.path().join("missing"), None, 200).is_empty());
        for i in 0..5 {
            write(&home.path().join(format!(".claude/projects/p/s{i}.jsonl")), &format!("{{\"aiTitle\":\"t{i}\"}}\n"), i * 100);
        }
        let found = discover(home.path(), None, 2);
        let titles: Vec<_> = found.iter().map(|s| s.title.clone().unwrap()).collect();
        assert_eq!(titles, vec!["t0", "t1"]);
    }

    #[test]
    fn decodes_escaped_titles() {
        assert_eq!(string_field(r#"{"aiTitle":"say \"hi\" é"}"#, "aiTitle").as_deref(), Some("say \"hi\" é"));
        assert_eq!(string_field(r#"{"cwd": ""}"#, "cwd"), None);
        assert_eq!(string_field("{}", "cwd"), None);
    }
}
