import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ProviderProtocol = "gemini" | "openai_compatible" | "anthropic";
export type TranslateMode = "auto" | "word" | "paragraph";
export type ThemeMode = "system" | "light" | "dark";
export type FontSizePreset = "small" | "medium" | "large";

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppConfig {
  shortcut: string;
  openShortcut: string;
  targetLang: string;
  activeProviderId: string;
  providers: ProviderProfile[];
  autostart: boolean;
  paused: boolean;
  theme: ThemeMode;
  fontSize: FontSizePreset;
  proxyUrl: string;
}

export interface TranslationStartPayload {
  requestId: number;
  sourceText: string;
  mode: TranslateMode;
  providerName: string;
  model: string;
}

export interface TranslationChunkPayload {
  requestId: number;
  delta: string;
}

export interface TranslationDonePayload {
  requestId: number;
}

export interface TranslationErrorPayload {
  requestId: number;
  message: string;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MOCK_CONFIG: AppConfig = {
  shortcut: "Ctrl+Shift+T",
  openShortcut: "",
  targetLang: "自动中英互译",
  activeProviderId: "gemini-default",
  providers: [
    {
      id: "gemini-default",
      name: "Google Gemini",
      protocol: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "",
      model: "gemini-2.5-flash",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai_compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-chat",
    },
  ],
  autostart: false,
  paused: false,
  theme: "system",
  fontSize: "medium",
  proxyUrl: "",
};

const noopUnlisten: UnlistenFn = () => {};

export const tauriApi = {
  getConfig: async () =>
    isTauri() ? invoke<AppConfig>("get_config") : MOCK_CONFIG,
  saveConfig: async (newConfig: AppConfig) => {
    if (isTauri()) return invoke<void>("save_config", { newConfig });
  },
  retranslate: async (sourceText: string, mode: TranslateMode) => {
    if (isTauri()) return invoke<void>("retranslate", { sourceText, mode });
  },
  testProvider: async (provider: ProviderProfile, proxyUrl: string) =>
    isTauri()
      ? invoke<string>("test_provider", { provider, proxyUrl })
      : "连接成功（浏览器预览模式）",
  openSettings: async () => {
    if (isTauri()) return invoke<void>("open_settings");
  },
  hideTranslator: async () => {
    if (isTauri()) return invoke<void>("hide_translator");
  },
  setTranslatorPinned: async (pinned: boolean) => {
    if (isTauri()) return invoke<void>("set_translator_pinned", { pinned });
  },

  onTranslationStart: (cb: (p: TranslationStartPayload) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<TranslationStartPayload>("translation-start", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onTranslationChunk: (cb: (p: TranslationChunkPayload) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<TranslationChunkPayload>("translation-chunk", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onTranslationDone: (cb: (p: TranslationDonePayload) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<TranslationDonePayload>("translation-done", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onTranslationError: (cb: (p: TranslationErrorPayload) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<TranslationErrorPayload>("translation-error", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onThemeChanged: (cb: (theme: ThemeMode) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<ThemeMode>("theme-changed", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
  onFontSizeChanged: (cb: (fontSize: FontSizePreset) => void): Promise<UnlistenFn> =>
    isTauri()
      ? listen<FontSizePreset>("font-size-changed", (e) => cb(e.payload))
      : Promise.resolve(noopUnlisten),
};
