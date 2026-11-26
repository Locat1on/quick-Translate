import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/liquid-glass.css";
import { TranslatorView } from "./features/translator/TranslatorView";
import { SettingsView } from "./features/settings/SettingsView";
import { tauriApi, type FontSizePreset, type ThemeMode } from "./lib/tauri";

export function applyTheme(theme: ThemeMode) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

const FONT_SIZE_MAP: Record<FontSizePreset, string> = {
  small: "14px",
  medium: "15.5px",
  large: "17.5px",
};

export function applyFontSize(preset: FontSizePreset) {
  const size = FONT_SIZE_MAP[preset] || FONT_SIZE_MAP.medium;
  document.documentElement.style.setProperty("--lg-body-font-size", size);
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash || "#/translator");

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || "#/translator");
    window.addEventListener("hashchange", onHashChange);

    const params = new URLSearchParams(window.location.search);
    const queryTheme = params.get("theme") as ThemeMode | null;
    const queryFontSize = params.get("fontSize") as FontSizePreset | null;

    tauriApi.getConfig().then((cfg) => {
      applyTheme(queryTheme || cfg.theme || "system");
      applyFontSize(queryFontSize || cfg.fontSize || "medium");
    });

    let cancelled = false;
    let unlistenTheme: (() => void) | undefined;
    let unlistenFontSize: (() => void) | undefined;

    tauriApi.onThemeChanged((theme) => {
      if (!cancelled) applyTheme(theme);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenTheme = fn;
    });
    tauriApi.onFontSizeChanged((fontSize) => {
      if (!cancelled) applyFontSize(fontSize);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFontSize = fn;
    });

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
      unlistenTheme?.();
      unlistenFontSize?.();
    };
  }, []);

  return hash.startsWith("#/settings") ? <SettingsView /> : <TranslatorView />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
