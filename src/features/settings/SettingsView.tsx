import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Eye, EyeOff, Plus, Trash2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { GlassSurface } from "../../components/liquid-glass/GlassSurface";
import { GlassButton } from "../../components/liquid-glass/GlassButton";
import { GlassSegmentedControl } from "../../components/liquid-glass/GlassSegmentedControl";
import { HotkeyRecorder } from "../../components/liquid-glass/HotkeyRecorder";
import { SpotlightCard } from "../../components/reactbits/SpotlightCard";
import { applyFontSize, applyTheme } from "../../main";
import {
  tauriApi,
  type AppConfig,
  type FontSizePreset,
  type ProviderProfile,
  type ProviderProtocol,
  type ThemeMode,
} from "../../lib/tauri";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const FONT_SIZE_OPTIONS: Array<{ value: FontSizePreset; label: string }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "标准" },
  { value: "large", label: "大" },
];

const PROTOCOL_DEFAULTS: Record<
  ProviderProtocol,
  { label: string; baseUrl: string; model: string }
> = {
  gemini: {
    label: "Google AI Studio (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash",
  },
  openai_compatible: {
    label: "OpenAI 兼容 (DeepSeek / Ollama 等)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-haiku-latest",
  },
};

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [editingId, setEditingId] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    tauriApi.getConfig().then((cfg) => {
      setConfig(cfg);
      setEditingId(cfg.activeProviderId || cfg.providers[0]?.id || "");
    });
  }, []);

  if (!config) {
    return null;
  }

  const editingProvider =
    config.providers.find((p) => p.id === editingId) || config.providers[0];

  const updateProvider = (patch: Partial<ProviderProfile>) => {
    if (!editingProvider) return;
    setConfig({
      ...config,
      providers: config.providers.map((p) =>
        p.id === editingProvider.id ? { ...p, ...patch } : p
      ),
    });
  };

  const handleAddProvider = () => {
    const id = `custom-${Date.now()}`;
    const next: ProviderProfile = {
      id,
      name: "新建自定义提供方",
      protocol: "openai_compatible",
      baseUrl: PROTOCOL_DEFAULTS.openai_compatible.baseUrl,
      apiKey: "",
      model: PROTOCOL_DEFAULTS.openai_compatible.model,
    };
    setConfig({
      ...config,
      activeProviderId: id,
      providers: [...config.providers, next],
    });
    setEditingId(id);
    setStatusMsg(null);
  };

  const handleDeleteProvider = (id: string) => {
    if (config.providers.length <= 1) return;
    const remaining = config.providers.filter((p) => p.id !== id);
    const nextActive =
      config.activeProviderId === id ? remaining[0].id : config.activeProviderId;
    setConfig({
      ...config,
      activeProviderId: nextActive,
      providers: remaining,
    });
    if (editingId === id) {
      setEditingId(remaining[0].id);
    }
  };

  const handleProtocolChange = (protocol: ProviderProtocol) => {
    const defaults = PROTOCOL_DEFAULTS[protocol];
    updateProvider({
      protocol,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    });
  };

  const handleTest = async () => {
    if (!editingProvider) return;
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await tauriApi.testProvider(editingProvider, config.proxyUrl || "");
      setStatusMsg({ ok: true, text: res });
    } catch (err) {
      setStatusMsg({ ok: false, text: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleShortcutUpdate = async (patch: Partial<AppConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      await tauriApi.saveConfig(next);
      setStatusMsg({ ok: true, text: "快捷键已保存并生效" });
    } catch (err) {
      setStatusMsg({ ok: false, text: String(err) });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      await tauriApi.saveConfig(config);
      setStatusMsg({ ok: true, text: "设置已保存并生效" });
    } catch (err) {
      setStatusMsg({ ok: false, text: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lg-window-shell">
      <GlassSurface
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "16px 18px",
          gap: "14px",
        }}
      >
        {/* macOS-style title bar */}
        <div
          data-tauri-drag-region
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "grab",
          }}
        >
          <div>
            <div style={{ fontSize: "17px", fontWeight: 600, letterSpacing: "-0.02em" }}>
              Quick Translate
            </div>
            <div style={{ fontSize: "13px", color: "var(--lg-text-secondary)", marginTop: "2px" }}>
              自定义模型提供方 · 快捷键 {config.shortcut}
            </div>
          </div>
          <GlassButton
            iconOnly
            title="关闭设置"
            onClick={() => {
              if ("__TAURI_INTERNALS__" in window) {
                void getCurrentWindow().hide();
              }
            }}
          >
            <X size={15} />
          </GlassButton>
        </div>

        {/* Scrollable inset grouped sections */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            paddingRight: "2px",
            paddingBottom: "4px",
          }}
        >
          {/* Provider Pills Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--lg-text-secondary)" }}>
                模型提供方
              </span>
              <GlassButton onClick={handleAddProvider} style={{ height: "30px", padding: "0 12px", fontSize: "13px" }}>
                <Plus size={14} />
                <span>新增</span>
              </GlassButton>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {config.providers.map((p) => {
                const isEditing = p.id === editingProvider?.id;
                return (
                  <GlassButton
                    key={p.id}
                    variant={isEditing ? "primary" : "default"}
                    onClick={() => {
                      setEditingId(p.id);
                      setConfig({ ...config, activeProviderId: p.id });
                      setStatusMsg(null);
                    }}
                    style={{ height: "30px", fontSize: "13px" }}
                  >
                    <span>{p.name || "未命名"}</span>
                  </GlassButton>
                );
              })}
            </div>
          </div>

          {/* Inset Grouped Provider Form with React Bits SpotlightCard */}
          {editingProvider && (
            <SpotlightCard>
              <div className="lg-row">
                <span className="lg-row-label">名称</span>
                <div className="lg-row-control" style={{ maxWidth: "290px" }}>
                  <input
                    className="lg-input"
                    value={editingProvider.name}
                    onChange={(e) => updateProvider({ name: e.target.value })}
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">接口协议</span>
                <div className="lg-row-control" style={{ maxWidth: "290px" }}>
                  <select
                    className="lg-select"
                    value={editingProvider.protocol}
                    onChange={(e) => handleProtocolChange(e.target.value as ProviderProtocol)}
                  >
                    {Object.entries(PROTOCOL_DEFAULTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">Base URL</span>
                <div className="lg-row-control" style={{ maxWidth: "290px" }}>
                  <input
                    className="lg-input"
                    value={editingProvider.baseUrl}
                    onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                    placeholder="https://generativelanguage.googleapis.com"
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">API Key</span>
                <div className="lg-row-control" style={{ maxWidth: "290px", position: "relative" }}>
                  <input
                    className="lg-input"
                    type={showKey ? "text" : "password"}
                    value={editingProvider.apiKey}
                    onChange={(e) => updateProvider({ apiKey: e.target.value })}
                    placeholder="本地模型可留空"
                    style={{ paddingRight: "32px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    style={{
                      position: "absolute",
                      right: "8px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "var(--lg-text-secondary)",
                      cursor: "pointer",
                      display: "flex",
                    }}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">模型 ID</span>
                <div className="lg-row-control" style={{ maxWidth: "290px" }}>
                  <input
                    className="lg-input"
                    value={editingProvider.model}
                    onChange={(e) => updateProvider({ model: e.target.value })}
                    placeholder="gemini-2.5-flash"
                  />
                </div>
              </div>

              <div className="lg-row">
                <GlassButton onClick={handleTest} disabled={testing} style={{ height: "30px", fontSize: "13px" }}>
                  {testing ? "测试中..." : "测试连通性"}
                </GlassButton>
                {config.providers.length > 1 && (
                  <GlassButton
                    variant="danger"
                    onClick={() => handleDeleteProvider(editingProvider.id)}
                    style={{ height: "30px", fontSize: "13px" }}
                  >
                    <Trash2 size={13} />
                    <span>删除</span>
                  </GlassButton>
                )}
              </div>
            </SpotlightCard>
          )}

          {/* Inset Grouped General Settings */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--lg-text-secondary)", padding: "0 4px" }}>
              通用与快捷键
            </span>
            <SpotlightCard>
              <div className="lg-row">
                <span className="lg-row-label">全局划词快捷键</span>
                <div className="lg-row-control" style={{ maxWidth: "220px" }}>
                  <HotkeyRecorder
                    value={config.shortcut}
                    onChange={(shortcut) => void handleShortcutUpdate({ shortcut })}
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">呼出/隐藏翻译窗口</span>
                <div className="lg-row-control" style={{ maxWidth: "220px" }}>
                  <HotkeyRecorder
                    value={config.openShortcut || ""}
                    onChange={(openShortcut) => void handleShortcutUpdate({ openShortcut })}
                    allowClear
                    placeholder="未设置（点击录制）"
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">目标语言偏好</span>
                <div className="lg-row-control" style={{ maxWidth: "220px" }}>
                  <select
                    className="lg-select"
                    value={config.targetLang}
                    onChange={(e) => setConfig({ ...config, targetLang: e.target.value })}
                  >
                    <option value="自动中英互译">自动中英互译</option>
                    <option value="简体中文">始终译为简体中文</option>
                    <option value="English">始终译为英文</option>
                    <option value="日本語">始终译为日文</option>
                  </select>
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">网络代理 (可选)</span>
                <div className="lg-row-control" style={{ maxWidth: "220px" }}>
                  <input
                    className="lg-input"
                    value={config.proxyUrl || ""}
                    onChange={(e) => setConfig({ ...config, proxyUrl: e.target.value })}
                    placeholder="如 http://127.0.0.1:7897"
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">外观主题</span>
                <div className="lg-row-control">
                  <GlassSegmentedControl
                    options={THEME_OPTIONS}
                    value={config.theme || "system"}
                    onChange={(theme) => {
                      setConfig({ ...config, theme });
                      applyTheme(theme);
                    }}
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">翻译字号</span>
                <div className="lg-row-control">
                  <GlassSegmentedControl
                    options={FONT_SIZE_OPTIONS}
                    value={config.fontSize || "medium"}
                    onChange={(fontSize) => {
                      setConfig({ ...config, fontSize });
                      applyFontSize(fontSize);
                    }}
                  />
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">暂停全局划词</span>
                <div className="lg-row-control">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.paused}
                    data-checked={config.paused}
                    className="lg-switch"
                    onClick={() => setConfig({ ...config, paused: !config.paused })}
                  >
                    <span className="lg-switch-thumb" />
                  </button>
                </div>
              </div>

              <div className="lg-row">
                <span className="lg-row-label">开机自动启动并常驻托盘</span>
                <div className="lg-row-control">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.autostart}
                    data-checked={config.autostart}
                    className="lg-switch"
                    onClick={() => setConfig({ ...config, autostart: !config.autostart })}
                  >
                    <span className="lg-switch-thumb" />
                  </button>
                </div>
              </div>
            </SpotlightCard>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", minHeight: "22px" }}>
            {statusMsg && (
              <>
                {statusMsg.ok ? (
                  <CheckCircle2 size={14} color="var(--lg-success)" />
                ) : (
                  <AlertCircle size={14} color="var(--lg-danger)" />
                )}
                <span
                  style={{
                    color: statusMsg.ok ? "var(--lg-success)" : "var(--lg-danger)",
                    maxWidth: "330px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={statusMsg.text}
                >
                  {statusMsg.text}
                </span>
              </>
            )}
          </div>

          <GlassButton variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </GlassButton>
        </div>
      </GlassSurface>
    </div>
  );
}
