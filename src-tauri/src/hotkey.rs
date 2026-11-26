use crate::config::ConfigState;
use crate::selection::{capture_selection, get_cursor_pos};
use crate::translator::{TranslateMode, TranslationManager};
use crate::window::{show_translator_at_cursor, toggle_translator_at_cursor};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG,
    MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_MBUTTONDOWN, WM_XBUTTONDOWN,
};

#[derive(Debug, Clone, PartialEq, Eq)]
enum MouseButtonKind {
    Middle,
    X1,
    X2,
}

#[derive(Debug, Clone)]
struct MouseTrigger {
    button: MouseButtonKind,
    ctrl: bool,
    alt: bool,
    shift: bool,
}

pub struct HotkeyState {
    translate: Mutex<Option<Shortcut>>,
    open: Mutex<Option<Shortcut>>,
}

impl HotkeyState {
    pub fn new() -> Self {
        Self {
            translate: Mutex::new(None),
            open: Mutex::new(None),
        }
    }
}

static TRANSLATE_MOUSE_TRIGGER: Mutex<Option<MouseTrigger>> = Mutex::new(None);
static OPEN_MOUSE_TRIGGER: Mutex<Option<MouseTrigger>> = Mutex::new(None);
static HOOK_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static HOOK_STARTED: AtomicBool = AtomicBool::new(false);

fn trigger_open_window(app_handle: AppHandle) {
    let (cx, cy) = get_cursor_pos();
    let app_for_ui = app_handle.clone();
    if let Err(e) = app_handle.run_on_main_thread(move || {
        toggle_translator_at_cursor(&app_for_ui, cx, cy);
    }) {
        eprintln!("[hotkey] run_on_main_thread failed: {e}");
    }
}

fn trigger_translation(app_handle: AppHandle) {
    let Some((provider, target_lang, proxy_url)) =
        app_handle.state::<ConfigState>().translation_context()
    else {
        return;
    };

    std::thread::spawn(move || {
        let (cx, cy) = get_cursor_pos();
        if let Some(text) = capture_selection(&app_handle) {
            show_translator_at_cursor(&app_handle, cx, cy);
            let app_async = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let translator = app_async.state::<TranslationManager>();
                translator
                    .start_translation(
                        app_async.clone(),
                        provider,
                        text,
                        target_lang,
                        proxy_url,
                        TranslateMode::Auto,
                    )
                    .await;
            });
        }
    });
}

fn parse_mouse_trigger(shortcut_str: &str) -> Option<MouseTrigger> {
    let parts: Vec<&str> = shortcut_str.split('+').map(|s| s.trim()).collect();
    let last = *parts.last()?;
    let button = match last {
        "MouseMiddle" => MouseButtonKind::Middle,
        "Mouse4" => MouseButtonKind::X1,
        "Mouse5" => MouseButtonKind::X2,
        _ => return None,
    };

    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    for &p in &parts[..parts.len() - 1] {
        match p.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            _ => {}
        }
    }

    Some(MouseTrigger {
        button,
        ctrl,
        alt,
        shift,
    })
}

fn is_key_down(vk: u16) -> bool {
    unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 }
}

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let msg = wparam as u32;
        let clicked = if msg == WM_MBUTTONDOWN {
            Some(MouseButtonKind::Middle)
        } else if msg == WM_XBUTTONDOWN {
            let info = &*(lparam as *const MSLLHOOKSTRUCT);
            let xbutton = ((info.mouseData >> 16) & 0xffff) as u16;
            match xbutton {
                1 => Some(MouseButtonKind::X1),
                2 => Some(MouseButtonKind::X2),
                _ => None,
            }
        } else {
            None
        };

        if let Some(btn) = clicked {
            let matches_trigger = |slot: &Mutex<Option<MouseTrigger>>| -> bool {
                if let Ok(guard) = slot.try_lock() {
                    if let Some(ref trigger) = *guard {
                        return trigger.button == btn
                            && (!trigger.ctrl || is_key_down(VK_CONTROL))
                            && (!trigger.alt || is_key_down(VK_MENU))
                            && (!trigger.shift || is_key_down(VK_SHIFT));
                    }
                }
                false
            };

            if let Some(app) = HOOK_APP_HANDLE.get() {
                if matches_trigger(&TRANSLATE_MOUSE_TRIGGER) {
                    trigger_translation(app.clone());
                } else if matches_trigger(&OPEN_MOUSE_TRIGGER) {
                    trigger_open_window(app.clone());
                }
            }
        }
    }

    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

fn ensure_mouse_hook(app: &AppHandle) {
    let _ = HOOK_APP_HANDLE.set(app.clone());
    if HOOK_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), std::ptr::null_mut(), 0);
            if hook.is_null() {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

fn register_single_shortcut<F>(
    app: &AppHandle,
    shortcut_str: &str,
    mouse_slot: &Mutex<Option<MouseTrigger>>,
    kb_slot: Option<&Mutex<Option<Shortcut>>>,
    on_trigger: F,
) -> Result<(), String>
where
    F: Fn(AppHandle) + Send + Sync + 'static,
{
    let trimmed = shortcut_str.trim();
    if trimmed.is_empty() {
        *mouse_slot.lock().unwrap() = None;
        return Ok(());
    }

    if let Some(mouse_trigger) = parse_mouse_trigger(trimmed) {
        *mouse_slot.lock().unwrap() = Some(mouse_trigger);
        ensure_mouse_hook(app);
        return Ok(());
    }

    *mouse_slot.lock().unwrap() = None;

    let shortcut: Shortcut = trimmed
        .parse()
        .map_err(|e| format!("快捷键格式无效 ({trimmed}): {e}"))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            on_trigger(app_handle.clone());
        })
        .map_err(|e| format!("注册全局快捷键失败 ({trimmed}): {e}"))?;

    if let Some(slot) = kb_slot {
        *slot.lock().unwrap() = Some(shortcut);
    }

    Ok(())
}

pub fn register_shortcuts(
    app: &AppHandle,
    translate_shortcut: &str,
    open_shortcut: &str,
) -> Result<(), String> {
    let t_trimmed = translate_shortcut.trim();
    let o_trimmed = open_shortcut.trim();
    if !o_trimmed.is_empty() && o_trimmed.eq_ignore_ascii_case(t_trimmed) {
        return Err("呼出窗口快捷键不能与划词翻译快捷键相同".to_string());
    }

    let manager = app.global_shortcut();
    let state = app.try_state::<HotkeyState>();

    // Unregister previous keyboard shortcuts before applying new bindings
    if let Some(ref st) = state {
        if let Some(prev) = st.translate.lock().unwrap().take() {
            let _ = manager.unregister(prev);
        }
        if let Some(prev) = st.open.lock().unwrap().take() {
            let _ = manager.unregister(prev);
        }
    }

    register_single_shortcut(
        app,
        t_trimmed,
        &TRANSLATE_MOUSE_TRIGGER,
        state.as_ref().map(|s| &s.translate),
        trigger_translation,
    )?;

    register_single_shortcut(
        app,
        o_trimmed,
        &OPEN_MOUSE_TRIGGER,
        state.as_ref().map(|s| &s.open),
        trigger_open_window,
    )?;

    Ok(())
}
