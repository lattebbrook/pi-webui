"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isDarkTheme, isThemePreference, type ThemePreference, type ResolvedTheme } from "@/lib/theme";

export type { ThemePreference, ResolvedTheme } from "@/lib/theme";

type ThemeState = {
  preference: ThemePreference;
  theme: ResolvedTheme;
};


const STORAGE_KEY = "pi-theme";
const SERVER_SNAPSHOT: ThemeState = { preference: "auto", theme: "light" };

const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let systemListening = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(value)) return value;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "auto";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "auto" ? getSystemTheme() : preference;
}

function applyDomTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", isDarkTheme(theme));
}

function ensureState(): ThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;

  const preference = readStoredPreference();
  const theme = resolveTheme(preference);
  applyDomTheme(theme);
  state = { preference, theme };
  return state;
}

function setThemeState(preference: ThemePreference, theme: ResolvedTheme, persist: boolean): void {
  applyDomTheme(theme);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  state = { preference, theme };
  emit();
}

function syncAutoThemeFromSystem(): void {
  const current = ensureState();
  if (current.preference !== "auto") return;
  const theme = getSystemTheme();
  if (theme === current.theme) return;
  setThemeState("auto", theme, false);
}

function ensureSystemListener(): void {
  if (systemListening || typeof window === "undefined" || !window.matchMedia) return;

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", syncAutoThemeFromSystem);
  // Some browsers delay or miss scheme events while backgrounded.
  window.addEventListener("focus", syncAutoThemeFromSystem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAutoThemeFromSystem();
  });
  systemListening = true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureState();
  ensureSystemListener();
  syncAutoThemeFromSystem();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeState {
  return ensureState();
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setThemePreference = useCallback((nextPreference: ThemePreference) => {
    const current = ensureState();
    if (current.preference === nextPreference) return;
    const nextTheme = resolveTheme(nextPreference);

    const apply = () => {
      setThemeState(nextPreference, nextTheme, true);
    };

    // A short cross-fade (styled in globals.css) where View Transitions exist.
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof document.startViewTransition !== "function" || reduceMotion) {
      apply();
      return;
    }
    document.startViewTransition(apply);
  }, []);

  return {
    theme: snapshot.theme,
    preference: snapshot.preference,
    setThemePreference,
    isDark: isDarkTheme(snapshot.theme),
  };
}
