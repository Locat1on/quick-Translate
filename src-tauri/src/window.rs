use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};

static LAST_SHOW_MS: AtomicI64 = AtomicI64::new(0);
static TRANSLATOR_PINNED: AtomicBool = AtomicBool::new(false);

pub fn set_translator_pinned(pinned: bool) {
    TRANSLATOR_PINNED.store(pinned, Ordering::SeqCst);
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn apply_liquid_backdrop(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let pref = DWMWCP_ROUND as i32;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0 as HWND,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &pref as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
}

pub fn create_translator_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("translator") {
        return Ok(win);
    }

    let data_dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("quick-translate-wv2"));
    let _ = std::fs::create_dir_all(&data_dir);

    let win = WebviewWindowBuilder::new(app, "translator", WebviewUrl::App("/#/translator".into()))
        .title("Quick Translate")
        .data_directory(data_dir)
        .inner_size(460.0, 380.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(false)
        .build()
        .map_err(|e| format!("创建翻译浮窗失败: {e}"))?;

    apply_liquid_backdrop(&win);
    Ok(win)
}

pub fn show_translator_at_cursor(app: &AppHandle, cursor_x: i32, cursor_y: i32) {
    let Some(window) = app.get_webview_window("translator") else {
        return;
    };

    let (win_w, win_h) = window
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((400, 300));

    let mut target_x = cursor_x + 14;
    let mut target_y = cursor_y + 18;

    // Clamp to the monitor containing the cursor
    if let Ok(monitors) = window.available_monitors() {
        for m in monitors {
            let pos = m.position();
            let size = m.size();
            let left = pos.x;
            let top = pos.y;
            let right = left + size.width as i32;
            let bottom = top + size.height as i32;

            if cursor_x >= left && cursor_x < right && cursor_y >= top && cursor_y < bottom {
                let margin = 16;
                if target_x + win_w + margin > right {
                    target_x = (cursor_x - win_w - 14).max(left + margin);
                }
                if target_y + win_h + margin > bottom {
                    target_y = (cursor_y - win_h - 14).max(top + margin);
                }
                break;
            }
        }
    }

    LAST_SHOW_MS.store(now_ms(), Ordering::SeqCst);
    let _ = window.set_position(PhysicalPosition::new(target_x, target_y));
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn toggle_translator_at_cursor(app: &AppHandle, cursor_x: i32, cursor_y: i32) {
    if let Some(win) = app.get_webview_window("translator") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    show_translator_at_cursor(app, cursor_x, cursor_y);
}

pub fn hide_translator_if_unfocused(window: &WebviewWindow) {
    if TRANSLATOR_PINNED.load(Ordering::SeqCst) {
        return;
    }
    // Ignore transient blur events within 250ms of showing the popover
    let elapsed = now_ms() - LAST_SHOW_MS.load(Ordering::SeqCst);
    if elapsed < 250 {
        return;
    }
    let _ = window.hide();
}

pub fn create_settings_window(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window("settings") {
        if visible {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        return;
    }

    let data_dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("quick-translate-wv2"));
    let _ = std::fs::create_dir_all(&data_dir);

    match WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("/#/settings".into()))
        .title("Quick Translate 设置")
        .data_directory(data_dir)
        .inner_size(580.0, 720.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .visible(visible)
        .shadow(false)
        .center()
        .build()
    {
        Ok(win) => {
            apply_liquid_backdrop(&win);
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            });
        }
        Err(e) => eprintln!("[window] 创建设置窗口失败: {e}"),
    }
}

pub fn open_settings_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    } else {
        create_settings_window(app, true);
    }
}
