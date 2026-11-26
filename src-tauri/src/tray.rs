use crate::config::ConfigState;
use crate::window::open_settings_window;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, "settings", "设置与模型配置...", true, None::<&str>)?;
    let pause_item = MenuItem::with_id(app, "toggle_pause", "暂停划词快捷键", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Quick Translate", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&settings_item, &pause_item, &sep, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Quick Translate")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "settings" => open_settings_window(app),
            "toggle_pause" => {
                let state = app.state::<ConfigState>();
                let mut cfg = state.get();
                cfg.paused = !cfg.paused;
                let paused = cfg.paused;
                let _ = state.save(cfg);
                let _ = pause_item.set_text(if paused {
                    "恢复划词快捷键"
                } else {
                    "暂停划词快捷键"
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_settings_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}
