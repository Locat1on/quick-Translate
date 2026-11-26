import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Pencil, Pin, PinOff, RotateCw, Settings, Volume2, X } from "lucide-react";
import { GlassSurface } from "../../components/liquid-glass/GlassSurface";
import { GlassButton } from "../../components/liquid-glass/GlassButton";
import { GlassSegmentedControl } from "../../components/liquid-glass/GlassSegmentedControl";
import { BlurText } from "../../components/reactbits/BlurText";
import { tauriApi, type TranslateMode } from "../../lib/tauri";
import { useTranslationStream, type TranslationState } from "./useTranslationStream";

const MODE_OPTIONS: Array<{ value: TranslateMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "word", label: "词典" },
  { value: "paragraph", label: "段落" },
];

const PREVIEW_SAMPLE: TranslationState = {
  requestId: 0,
  sourceText: "Serendipity",
  translatedText:
    "**音标**: /ˌser.ənˈdɪp.ə.tɪ/\n**词性**: n.\n\n**释义**: 意外发现珍奇事物的运气；机缘巧合\n\n**例句**: Meeting her at that tiny bookstore was pure **serendipity**.",
  mode: "word",
  providerName: "Google Gemini",
  model: "gemini-2.5-flash",
  loading: false,
  error: null,
};

function renderFormattedText(text: string) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function TranslatorView() {
  const state = useTranslationStream();
  const [selectedMode, setSelectedMode] = useState<TranslateMode>("auto");
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // In-memory translation history (up to 10 items)
  const [history, setHistory] = useState<TranslationState[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  // Inline source text editing
  const [editingSource, setEditingSource] = useState(false);
  const [draftSource, setDraftSource] = useState("");
  const sourceInputRef = useRef<HTMLInputElement>(null);

  const isBrowserPreview = useMemo(
    () => typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window),
    []
  );

  // Sync mode & exit history view when a new translation starts
  useEffect(() => {
    setSelectedMode(state.mode);
    if (state.loading) {
      setHistoryIndex(null);
      setEditingSource(false);
    }
  }, [state.requestId, state.mode, state.loading]);

  // Record finished translation into in-memory history
  useEffect(() => {
    if (state.requestId <= 0 || state.loading) return;
    if (!state.translatedText && !state.error) return;

    setHistory((prev) => {
      const idx = prev.findIndex((item) => item.requestId === state.requestId);
      const next =
        idx >= 0
          ? prev.map((item, i) => (i === idx ? state : item))
          : [...prev, state].slice(-10);
      return next;
    });
    setHistoryIndex(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.requestId, state.loading]);

  const activeEntry: TranslationState = useMemo(() => {
    if (historyIndex !== null && history[historyIndex]) {
      return history[historyIndex];
    }
    if (state.requestId === 0 && isBrowserPreview) {
      return PREVIEW_SAMPLE;
    }
    return state;
  }, [history, historyIndex, state, isBrowserPreview]);

  const formattedTranslation = useMemo(
    () => (activeEntry.translatedText ? renderFormattedText(activeEntry.translatedText) : null),
    [activeEntry.translatedText]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingSource) {
          setEditingSource(false);
          return;
        }
        window.speechSynthesis?.cancel();
        setSpeaking(false);
        void tauriApi.hideTranslator();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !editingSource) {
        const selected = window.getSelection()?.toString();
        if (!selected && activeEntry.translatedText) {
          e.preventDefault();
          void navigator.clipboard.writeText(activeEntry.translatedText);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingSource, activeEntry.translatedText]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (editingSource) {
      sourceInputRef.current?.focus();
      sourceInputRef.current?.select();
    }
  }, [editingSource]);

  const handleModeChange = (mode: TranslateMode) => {
    setSelectedMode(mode);
    if (activeEntry.sourceText) {
      void tauriApi.retranslate(activeEntry.sourceText, mode);
    }
  };

  const handleCopy = async () => {
    if (!activeEntry.translatedText) return;
    await navigator.clipboard.writeText(activeEntry.translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startEditingSource = () => {
    if (activeEntry.loading) return;
    setDraftSource(activeEntry.sourceText || "");
    setEditingSource(true);
  };

  const submitEditedSource = () => {
    const trimmed = draftSource.trim();
    setEditingSource(false);
    if (trimmed) {
      void tauriApi.retranslate(trimmed, selectedMode);
    }
  };

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    void tauriApi.setTranslatorPinned(next);
  };

  const handleSpeakSource = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = activeEntry.sourceText?.trim();
    if (!text || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (/[\u3040-\u30ff]/.test(text)) {
      utter.lang = "ja-JP";
    } else if (/[\u4e00-\u9fff]/.test(text)) {
      utter.lang = "zh-CN";
    } else {
      utter.lang = "en-US";
    }
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  const currentHistoryPos =
    historyIndex !== null ? historyIndex : history.length > 0 ? history.length - 1 : -1;
  const canGoPrev = history.length > 1 && currentHistoryPos > 0;
  const canGoNext = history.length > 1 && currentHistoryPos < history.length - 1;

  return (
    <div className="lg-window-shell">
      <GlassSurface
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "12px 14px",
          gap: "10px",
        }}
      >
        {/* Top Liquid Glass control bar */}
        <div
          data-tauri-drag-region
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            cursor: "grab",
          }}
        >
          <GlassSegmentedControl
            options={MODE_OPTIONS}
            value={historyIndex !== null ? activeEntry.mode : selectedMode}
            onChange={handleModeChange}
          />

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <GlassButton
              iconOnly
              variant={pinned ? "primary" : "default"}
              title={pinned ? "取消固定（失焦自动隐藏）" : "固定窗口（失焦不自动隐藏）"}
              onClick={handleTogglePin}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </GlassButton>
            <GlassButton
              iconOnly
              title="重新翻译"
              disabled={!activeEntry.sourceText || activeEntry.loading}
              onClick={() => tauriApi.retranslate(activeEntry.sourceText, selectedMode)}
            >
              <RotateCw size={15} />
            </GlassButton>
            <GlassButton
              iconOnly
              title="设置"
              onClick={() => tauriApi.openSettings()}
            >
              <Settings size={15} />
            </GlassButton>
            <GlassButton
              iconOnly
              title="关闭 (Esc)"
              onClick={() => tauriApi.hideTranslator()}
            >
              <X size={15} />
            </GlassButton>
          </div>
        </div>

        {/* Source snippet / inline editor */}
        {(activeEntry.sourceText || editingSource) && (
          <div style={{ padding: "0 4px" }}>
            {editingSource ? (
              <input
                ref={sourceInputRef}
                className="lg-input"
                value={draftSource}
                onChange={(e) => setDraftSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitEditedSource();
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditingSource(false);
                  }
                }}
                onBlur={() => setEditingSource(false)}
                placeholder="输入或修改原文后按 Enter 翻译..."
                style={{ height: "30px", fontSize: "13px" }}
              />
            ) : (
              <div
                onClick={startEditingSource}
                title="点击编辑原文并按 Enter 重新翻译"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--lg-text-secondary)",
                  cursor: "text",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {activeEntry.sourceText}
                </span>
                <button
                  type="button"
                  onClick={handleSpeakSource}
                  title={speaking ? "停止朗读" : "朗读原文"}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "2px",
                    color: speaking ? "var(--lg-accent)" : "var(--lg-text-secondary)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <Volume2 size={13} />
                </button>
                <Pencil size={12} style={{ opacity: 0.65, flexShrink: 0 }} />
              </div>
            )}
          </div>
        )}

        {/* Crisp reading content layer */}
        <div
          key={activeEntry.requestId}
          className="lg-content-well lg-spring-enter"
          style={{
            flex: 1,
            padding: "12px 14px",
            overflowY: "auto",
            fontSize: "var(--lg-body-font-size, 15.5px)",
            lineHeight: 1.58,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {activeEntry.error ? (
            <span style={{ color: "var(--lg-danger)", fontSize: "14px" }}>
              {activeEntry.error}
            </span>
          ) : formattedTranslation ? (
            formattedTranslation
          ) : activeEntry.loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <BlurText
                text="正在思考并翻译..."
                style={{ color: "var(--lg-text-secondary)", fontSize: "14px", fontWeight: 500 }}
              />
              <div className="lg-shimmer-bar" style={{ width: "86%" }} />
              <div className="lg-shimmer-bar" style={{ width: "68%" }} />
              <div className="lg-shimmer-bar" style={{ width: "48%" }} />
            </div>
          ) : (
            <div
              onClick={startEditingSource}
              style={{ cursor: "text", height: "100%" }}
              title="点击直接输入文本翻译"
            >
              <BlurText
                text="选中文本后按快捷键，或点击此处直接输入翻译"
                style={{ color: "var(--lg-text-secondary)", fontSize: "14px" }}
              />
            </div>
          )}
        </div>

        {/* Bottom status & action capsule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "0 2px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12.5px",
              color: "var(--lg-text-muted)",
              maxWidth: "190px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeEntry.loading && <span className="lg-dot-live" />}
            <span>{activeEntry.model || "Quick Translate"}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {history.length > 1 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <GlassButton
                  iconOnly
                  title="上一条记录"
                  disabled={!canGoPrev}
                  onClick={() => setHistoryIndex(currentHistoryPos - 1)}
                  style={{ width: "26px", height: "26px" }}
                >
                  <ChevronLeft size={14} />
                </GlassButton>
                <span style={{ fontSize: "12px", color: "var(--lg-text-muted)", minWidth: "28px", textAlign: "center" }}>
                  {currentHistoryPos + 1}/{history.length}
                </span>
                <GlassButton
                  iconOnly
                  title="下一条记录"
                  disabled={!canGoNext}
                  onClick={() =>
                    setHistoryIndex(
                      currentHistoryPos + 1 >= history.length - 1 ? null : currentHistoryPos + 1
                    )
                  }
                  style={{ width: "26px", height: "26px" }}
                >
                  <ChevronRight size={14} />
                </GlassButton>
              </div>
            )}

            <GlassButton
              onClick={handleCopy}
              disabled={!activeEntry.translatedText}
              style={{ height: "28px", padding: "0 12px", fontSize: "13px" }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "已复制" : "复制"}</span>
            </GlassButton>
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}
