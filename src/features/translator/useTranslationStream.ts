import { useEffect, useRef, useState } from "react";
import { tauriApi, type TranslateMode } from "../../lib/tauri";

export interface TranslationState {
  requestId: number;
  sourceText: string;
  translatedText: string;
  mode: TranslateMode;
  providerName: string;
  model: string;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: TranslationState = {
  requestId: 0,
  sourceText: "",
  translatedText: "",
  mode: "auto",
  providerName: "",
  model: "",
  loading: false,
  error: null,
};

export function useTranslationStream() {
  const [state, setState] = useState<TranslationState>(INITIAL_STATE);
  const activeIdRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    Promise.all([
      tauriApi.onTranslationStart((p) => {
        if (cancelled) return;
        activeIdRef.current = p.requestId;
        setState({
          requestId: p.requestId,
          sourceText: p.sourceText,
          translatedText: "",
          mode: p.mode,
          providerName: p.providerName,
          model: p.model,
          loading: true,
          error: null,
        });
      }),
      tauriApi.onTranslationChunk((p) => {
        if (cancelled || p.requestId !== activeIdRef.current) return;
        setState((prev) => ({
          ...prev,
          translatedText: prev.translatedText + p.delta,
        }));
      }),
      tauriApi.onTranslationDone((p) => {
        if (cancelled || p.requestId !== activeIdRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
        }));
      }),
      tauriApi.onTranslationError((p) => {
        if (cancelled || p.requestId !== activeIdRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: p.message,
        }));
      }),
    ]).then((fns) => {
      if (cancelled) {
        fns.forEach((fn) => fn());
        return;
      }
      unlisteners.push(...fns);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  return state;
}
