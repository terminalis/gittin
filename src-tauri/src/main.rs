// Gittin's desktop app: one window showing the desktop page (src/native/), with Tauri's plugins for
// file dialogs and file access.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![opened_files])
        .setup(|app| {
            // The files Gittin was started with.
            hand_over(app.handle(), std::env::args());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("src/native/index.html".into()))
                .title("Gittin")
                .inner_size(1200.0, 800.0)
                .min_inner_size(360.0, 480.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gittin");
}
