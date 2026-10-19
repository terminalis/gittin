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

/// Windows: the frame is light or dark with Gittin, and on Windows 11 the title bar and border take
/// its background and text colours (`#rrggbb`) instead of the system accent, as browsers' own frames
/// do. Windows 10 ignores the colours.
#[cfg(windows)]
pub fn colour_frame(window: &tauri::WebviewWindow, dark: bool, background: &str, text: &str) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };
    // A COLORREF is 0x00bbggrr.
    let colorref = |css: &str| {
        let rgb = u32::from_str_radix(css.trim().strip_prefix('#')?, 16).ok()?;
        Some((rgb & 0xff) << 16 | (rgb & 0xff00) | rgb >> 16 & 0xff)
    };
    let Ok(hwnd) = window.hwnd() else { return };
    // Dark mode gives the window buttons light symbols.
    for (attribute, value) in [
        (DWMWA_USE_IMMERSIVE_DARK_MODE, Some(dark as u32)),
        (DWMWA_CAPTION_COLOR, colorref(background)),
        (DWMWA_BORDER_COLOR, colorref(background)),
        (DWMWA_TEXT_COLOR, colorref(text)),
    ] {
        if let Some(value) = value {
            let _ = unsafe {
                DwmSetWindowAttribute(hwnd, attribute, &value as *const u32 as *const _, 4)
            };
        }
    }
}

/// Linux: the header bar follows the system's GTK theme.
#[cfg(target_os = "linux")]
pub fn colour_frame(_window: &tauri::WebviewWindow, _dark: bool, _background: &str, _text: &str) {}

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
