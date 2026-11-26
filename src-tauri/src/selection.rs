use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    VK_CONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

pub fn get_cursor_pos() -> (i32, i32) {
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut pt) != 0 {
            return (pt.x, pt.y);
        }
    }
    (400, 300)
}

fn key_input(vk: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn is_any_modifier_down() -> bool {
    const MODS: [u16; 4] = [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN];
    unsafe { MODS.iter().any(|&vk| (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0) }
}

fn send_ctrl_c() {
    // Only release modifier keys & wait if a modifier is actually held (skips 25ms on mouse triggers)
    if is_any_modifier_down() {
        let release_modifiers = [
            key_input(VK_MENU, KEYEVENTF_KEYUP),
            key_input(VK_LMENU, KEYEVENTF_KEYUP),
            key_input(VK_RMENU, KEYEVENTF_KEYUP),
            key_input(VK_SHIFT, KEYEVENTF_KEYUP),
            key_input(VK_LSHIFT, KEYEVENTF_KEYUP),
            key_input(VK_RSHIFT, KEYEVENTF_KEYUP),
            key_input(VK_LWIN, KEYEVENTF_KEYUP),
            key_input(VK_RWIN, KEYEVENTF_KEYUP),
        ];
        unsafe {
            SendInput(
                release_modifiers.len() as u32,
                release_modifiers.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
        thread::sleep(Duration::from_millis(20));
    }

    // Send Ctrl + C
    let vk_c: u16 = 0x43;
    let copy_seq = [
        key_input(VK_CONTROL, 0),
        key_input(vk_c, 0),
        key_input(vk_c, KEYEVENTF_KEYUP),
        key_input(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    unsafe {
        SendInput(
            copy_seq.len() as u32,
            copy_seq.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

/// Captures currently selected text by backing up the clipboard, sending Ctrl+C,
/// polling briefly for the copied text, and restoring the previous clipboard text.
pub fn capture_selection(app: &AppHandle) -> Option<String> {
    let clipboard = app.clipboard();
    let previous = clipboard.read_text().ok();

    let _ = clipboard.write_text(String::new());
    thread::sleep(Duration::from_millis(8));

    send_ctrl_c();

    let mut captured = None;
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(10));
        if let Ok(text) = clipboard.read_text() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                captured = Some(trimmed.to_string());
                break;
            }
        }
    }

    if let Some(prev) = previous {
        let _ = clipboard.write_text(prev);
    }

    captured
}
