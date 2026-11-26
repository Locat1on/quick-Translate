mod config;
mod hotkey;
mod selection;
mod translator;
mod tray;
mod window;

use config::{AppConfig, ConfigState, ProviderProfile};
use hotkey::{register_shortcuts, HotkeyState};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use translator::{TranslateMode, TranslationManager};

#[tauri::command]
fn get_config(state: State<ConfigState>) -> AppConfig {
    state.get()
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    state: State<ConfigState>,
    new_config: AppConfig,
) -> Result<(), String> {
    let old_config = state.get();
    if old_config.shortcut != new_config.shortcut
        || old_config.open_shortcut != new_config.open_shortcut
    {
        register_shortcuts(&app, &new_config.shortcut, &new_config.open_shortcut)?;
    }
    if old_config.autostart != new_config.autostart {
        let autostart = app.autolaunch();
        if new_config.autostart {
            let _ = autostart.enable();
        } else {
            let _ = autostart.disable();
        }
    }
    let theme = new_config.theme.clone();
    let font_size = new_config.font_size.clone();
    state.save(new_config)?;
    let _ = app.emit("theme-changed", theme);
    let _ = app.emit("font-size-changed", font_size);
    Ok(())
}

#[tauri::command]
async fn retranslate(
    app: AppHandle,
    config_state: State<'_, ConfigState>,
    translator: State<'_, TranslationManager>,
    source_text: String,
    mode: TranslateMode,
) -> Result<(), String> {
    let cfg = config_state.get();
    let provider = config_state
        .active_provider()
        .ok_or_else(|| "未找到可用的模型提供方".to_string())?;
    translator
        .start_translation(
            app,
            provider,
            source_text,
            cfg.target_lang,
            cfg.proxy_url,
            mode,
        )
        .await;
    Ok(())
}

#[tauri::command]
async fn test_provider(
    translator: State<'_, TranslationManager>,
    provider: ProviderProfile,
    proxy_url: String,
) -> Result<String, String> {
    translator.test_provider(provider, proxy_url).await
}

#[tauri::command]
async fn open_settings(app: AppHandle) {
    if let Some(win) = app.get_webview_window("translator") {
        let _ = win.hide();
    }
    window::open_settings_window(&app);
}

#[tauri::command]
fn hide_translator(app: AppHandle) {
    if let Some(win) = app.get_webview_window("translator") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn set_translator_pinned(pinned: bool) {
    window::set_translator_pinned(pinned);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(HotkeyState::new())
        .manage(TranslationManager::new())
        .setup(|app| {
            let handle = app.handle();
            eprintln!("[setup] loading config...");
            let config_state = ConfigState::load(handle);
            let initial_cfg = config_state.get();
            app.manage(config_state);

            eprintln!("[setup] creating translator window...");
            match window::create_translator_window(handle) {
                Ok(win) => {
                    let win_clone = win.clone();
                    win.on_window_event(move |event| {
                        if let WindowEvent::Focused(false) = event {
                            window::hide_translator_if_unfocused(&win_clone);
                        }
                    });
                }
                Err(e) => eprintln!("[setup] {e}"),
            }

            eprintln!("[setup] setting up tray...");
            if let Err(e) = tray::setup_tray(handle) {
                eprintln!("[setup] tray setup failed: {e}");
            }

            eprintln!("[setup] registering shortcuts {} / {}...", initial_cfg.shortcut, initial_cfg.open_shortcut);
            if let Err(e) = register_shortcuts(handle, &initial_cfg.shortcut, &initial_cfg.open_shortcut) {
                eprintln!("[setup] shortcut registration failed: {e}");
            }

            let show_settings_on_start = initial_cfg
                .providers
                .iter()
                .all(|p| p.api_key.trim().is_empty());
            eprintln!("[setup] creating settings window (visible={show_settings_on_start})...");
            window::create_settings_window(handle, show_settings_on_start);

            eprintln!("[setup] done.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            retranslate,
            test_provider,
            open_settings,
            hide_translator,
            set_translator_pinned
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
