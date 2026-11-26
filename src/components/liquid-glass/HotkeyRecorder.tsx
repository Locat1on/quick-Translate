import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface HotkeyRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
  allowClear?: boolean;
  placeholder?: string;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

function mapKeyCode(e: KeyboardEvent): string | null {
  const { code, key } = e;
  if (MODIFIER_KEYS.has(key)) return null;

  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3).toUpperCase();
  }
  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code;
  }

  const specialMap: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };

  return specialMap[code] ?? null;
}

function formatShortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "MouseMiddle") return "鼠标中键";
      if (part === "Mouse4") return "鼠标侧键1";
      if (part === "Mouse5") return "鼠标侧键2";
      return part;
    })
    .join(" + ");
}

export function HotkeyRecorder({
  value,
  onChange,
  allowClear = false,
  placeholder = "未设置（点击录制）",
}: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [previewMods, setPreviewMods] = useState<string[]>([]);

  useEffect(() => {
    if (!recording) {
      setPreviewMods([]);
      return;
    }

    const getMods = (e: KeyboardEvent | MouseEvent) => {
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      return mods;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setRecording(false);
        return;
      }

      const mods = getMods(e);
      setPreviewMods(mods);

      const mainKey = mapKeyCode(e);
      if (!mainKey) return;

      const isFunctionKey = /^F([1-9]|1[0-2])$/.test(mainKey);
      if (mods.length === 0 && !isFunctionKey) {
        return;
      }

      onChange([...mods, mainKey].join("+"));
      setRecording(false);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      setPreviewMods(getMods(e));
    };

    const onMouseDown = (e: MouseEvent) => {
      let mouseKey: string | null = null;
      if (e.button === 1) mouseKey = "MouseMiddle";
      else if (e.button === 3) mouseKey = "Mouse4";
      else if (e.button === 4) mouseKey = "Mouse5";

      if (!mouseKey) return;

      e.preventDefault();
      e.stopPropagation();
      const mods = getMods(e);
      onChange([...mods, mouseKey].join("+"));
      setRecording(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [recording, onChange]);

  const displayText = recording
    ? previewMods.length > 0
      ? `${previewMods.join(" + ")} + ...`
      : "请按组合键或鼠标侧键/中键"
    : value
      ? formatShortcutLabel(value)
      : placeholder;

  return (
    <div style={{ position: "relative", width: "100%", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        className="lg-input"
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        title="点击后按下键盘组合键，或鼠标中键/侧键（Esc 取消）"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          paddingRight: allowClear && value && !recording ? "28px" : undefined,
          fontFamily: recording || !value ? "inherit" : "var(--font-mono)",
          fontSize: "12.5px",
          fontWeight: 500,
          letterSpacing: recording || !value ? "0" : "0.02em",
          color: recording
            ? "var(--lg-accent)"
            : value
              ? "var(--lg-text-primary)"
              : "var(--lg-text-muted)",
          borderColor: recording ? "var(--lg-accent)" : "transparent",
          boxShadow: recording ? "0 0 0 3px var(--lg-accent-soft)" : "none",
        }}
      >
        {displayText}
      </button>
      {allowClear && value && !recording && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
          }}
          title="清除快捷键"
          style={{
            position: "absolute",
            right: "8px",
            background: "none",
            border: "none",
            color: "var(--lg-text-muted)",
            cursor: "pointer",
            display: "inline-flex",
            padding: "2px",
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
