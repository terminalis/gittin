// Gittin's desktop app: one window showing the desktop page (src/native/), with Tauri's plugins for
// file dialogs and file access.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Keeps access to picked files and folders after a restart; after the file plugin.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
