// Gittin's desktop app: one window showing the desktop page (src/native/), with Tauri's plugins for
// file dialogs and file access.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod webview;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::webview::NewWindowResponse;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

/// Files handed to Gittin that the page hasn't taken yet.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

/// Files the system asked Gittin to open ("Open with"): the arguments after the program's own path.
/// The page may read and write each one, as it may a file picked in a dialog, and takes them once it's
/// ready, so files handed over while Gittin starts aren't lost.
fn hand_over(app: &tauri::AppHandle, args: impl IntoIterator<Item = String>) {
    let files: Vec<String> = args.into_iter().skip(1).collect();
    for file in &files {
        let _ = app.fs_scope().allow_file(file);
    }
    app.state::<Opened>().0.lock().unwrap().extend(files);
}

/// Takes the files handed to Gittin since the page last asked.
#[tauri::command]
fn opened_files(opened: tauri::State<Opened>) -> Vec<String> {
    std::mem::take(&mut *opened.0.lock().unwrap())
}

/// The window frame follows Gittin's appearance where the system lets an app choose it. Not through
/// Tauri's window theme, which would also change the page's own light-or-dark preference.
#[tauri::command]
fn set_frame(window: tauri::WebviewWindow, dark: bool, background: String, text: String) {
    webview::colour_frame(&window, dark, &background, &text);
}

fn refusal(path: &Path) -> String {
    format!("Gittin can't reach {}.", path.display())
}

/// `path` as given, when its real path is somewhere the page may reach: inside a folder or file the writer
/// opened. A path that doesn't exist is refused, as `..` could take it anywhere.
fn reach(allowed: impl Fn(&Path) -> bool, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if std::fs::canonicalize(&path).is_ok_and(|real| allowed(&real)) {
        Ok(path)
    } else {
        Err(refusal(&path))
    }
}

/// What the file plugin's scope allows.
fn in_scope(app: &tauri::AppHandle) -> impl Fn(&Path) -> bool {
    let scope = app.fs_scope();
    move |path| scope.is_allowed(path)
}

fn reach_in(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    reach(in_scope(app), path)
}

/// The repository at `root`, when the page may reach `root` and the repository works on it with all its git
/// data where the page may reach.
fn repository_in(app: &tauri::AppHandle, root: &str) -> Result<git2::Repository, String> {
    let root = reach_in(app, root)?;
    git::open(&root, in_scope(app)).ok_or_else(|| refusal(&root))
}

fn text(error: git2::Error) -> String {
    error.message().to_string()
}

// The git commands run off the window's thread, so a long history doesn't freeze it.
#[tauri::command(async)]
fn git_repositories(app: tauri::AppHandle, folder: String) -> Result<Vec<String>, String> {
    git::repositories(&reach_in(&app, &folder)?, in_scope(&app)).map_err(|error| error.to_string())
}

#[tauri::command(async)]
fn git_init(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    git::init(&reach_in(&app, &folder)?).map_err(text)
}

#[tauri::command(async)]
fn git_commit(
    app: tauri::AppHandle,
    root: String,
    paths: Vec<String>,
    message: String,
    author: Option<git::Author>,
) -> Result<git::Outcome, String> {
    git::commit(
        &repository_in(&app, &root)?,
        &paths,
        &message,
        author.as_ref(),
    )
    .map_err(text)
}

#[tauri::command(async)]
fn git_log(
    app: tauri::AppHandle,
    root: String,
    path: String,
    skip: usize,
    take: usize,
) -> Result<Vec<git::Entry>, String> {
    git::log(&repository_in(&app, &root)?, &path, skip, take).map_err(text)
}

/// The file's bytes as they are, for the page to decode as it decodes files on disk.
#[tauri::command(async)]
fn git_show(
    app: tauri::AppHandle,
    root: String,
    commit: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    git::show(&repository_in(&app, &root)?, &commit, &path)
        .map(tauri::ipc::Response::new)
        .map_err(text)
}

/// Gittin's own pages: the bundled app, or the development server under `tauri dev`.
fn own(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(dev) && url.host_str() == Some("127.0.0.1"))
}

fn main() {
    tauri::Builder::default()
        .manage(Opened::default())
        // A second launch, such as "Open with" while Gittin runs, hands its files to this window. Opening
        // several files in Explorer starts one launch per file at once.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            hand_over(app, args);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
                // Tells a ready page that more files are waiting.
                let _ = window.emit("open-files", ());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Keeps access to picked files and folders after a restart; after the file plugin.
        .plugin(tauri_plugin_persisted_scope::init())
        // Links are opened by the window's own handlers below.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            opened_files,
            set_frame,
            git_repositories,
            git_init,
            git_commit,
            git_log,
            git_show
        ])
        .setup(|app| {
            // The files Gittin was started with.
            hand_over(app.handle(), std::env::args());
            let (links, popups) = (app.handle().clone(), app.handle().clone());
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("src/native/index.html".into()),
            )
            .title("Gittin")
            .inner_size(1200.0, 800.0)
            .min_inner_size(360.0, 480.0)
            // Edit › Paste reads the clipboard, as the browser lets it.
            .enable_clipboard_access()
            // Tauri's own file-drop handling stops text being dragged within the editor on Windows.
            .disable_drag_drop_handler()
            // Links open in the browser or mail app; only Gittin's own pages load in the window.
            .on_navigation(move |url| {
                own(url) || {
                    let _ = links.opener().open_url(url.as_str(), None::<&str>);
                    false
                }
            })
            .on_new_window(move |url, _| {
                let _ = popups.opener().open_url(url.as_str(), None::<&str>);
                NewWindowResponse::Deny
            })
            .build()?;
            webview::configure(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gittin");
}

#[cfg(test)]
mod tests {
    use super::reach;
    use std::path::Path;

    #[test]
    fn git_commands_reach_only_folders_the_writer_opened() {
        let folder = std::env::temp_dir().join(format!("gittin-reach-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let real = std::fs::canonicalize(&folder).unwrap();
        let inside = |path: &Path| path.starts_with(&real);
        let given = folder.to_str().unwrap();
        assert_eq!(reach(inside, given).unwrap(), folder);
        let refused = |path: &str| reach(inside, path).unwrap_err();
        let around = format!("{given}/../missing/deep");
        assert_eq!(refused(&around), format!("Gittin can't reach {around}."));
        let missing = format!("{given}/missing");
        assert_eq!(refused(&missing), format!("Gittin can't reach {missing}."));
        let outside = format!("{given}/..");
        assert_eq!(refused(&outside), format!("Gittin can't reach {outside}."));
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
