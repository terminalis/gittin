//! Webview settings a host app is meant to make, so the window behaves like a browser tab.

/// Windows: no browser keys (F5 and Ctrl+R would reload Gittin; Linux's webview has none), and the
/// window follows the page's full-screen requests, which WebView2 leaves to the app.
#[cfg(windows)]
pub fn configure(window: &tauri::WebviewWindow) {
    let follow = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::ContainsFullScreenElementChangedEventHandler;
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::{Interface, BOOL};
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        if let Ok(settings) = core
            .Settings()
            .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
        {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
        let mut token = Default::default();
        let _ = core.add_ContainsFullScreenElementChanged(
            &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut full = BOOL::default();
                    sender.ContainsFullScreenElement(&mut full)?;
                    let _ = follow.set_fullscreen(full.as_bool());
                }
                Ok(())
            })),
            &mut token,
        );
    });
}

/// Linux: WebKitGTK starts with spellcheck off. On, in the user's languages, it serves the Spellcheck
/// preference as a browser's spellchecker does.
#[cfg(target_os = "linux")]
pub fn configure(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{WebContextExt, WebViewExt};
        let Some(context) = webview.inner().context() else {
            return;
        };
        let languages: Vec<String> = gtk::glib::language_names()
            .iter()
            .map(|name| name.to_string())
            .filter(|name| name != "C" && !name.contains(['.', '@']))
            .collect();
        context.set_spell_checking_languages(
            &languages.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        context.set_spell_checking_enabled(true);
    });
}
