"use client";

// Which agent the browser is working with: omp (default when installed) or pi.
// The choice is per browser (localStorage) and switches instantly: both
// runtimes are always live on the server, so nothing restarts.

import { useEffect, useSyncExternalStore } from "react";
import type { AgentRuntime } from "./types";

const STORAGE_KEY = "pi-webui:runtime";
const CHANGE_EVENT = "pi-webui:runtime-change";

interface RuntimeInfo {
  available: Record<AgentRuntime, boolean>;
  versions: Partial<Record<AgentRuntime, string | null>>;
  default: AgentRuntime;
}

let current: AgentRuntime | null = null;
let info: RuntimeInfo | null = null;
let infoRequest: Promise<RuntimeInfo | null> | null = null;

function readStored(): AgentRuntime | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "pi" || value === "omp" ? value : null;
  } catch {
    return null;
  }
}

/** The active runtime. Before the server answers, a stored choice wins, else omp. */
export function getRuntime(): AgentRuntime {
  if (typeof window === "undefined") return "omp";
  current ??= readStored() ?? "omp";
  return current;
}

export function setRuntime(next: AgentRuntime): void {
  if (info && !info.available[next]) return;
  if (getRuntime() === next) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable: the choice lasts for this page
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Ask the server once which runtimes exist; fall back to pi when omp is not installed. */
export function loadRuntimeInfo(): Promise<RuntimeInfo | null> {
  infoRequest ??= fetch("/api/runtime", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<RuntimeInfo>) : null))
    .then((data) => {
      info = data;
      if (data) {
        const stored = readStored();
        const wanted = stored && data.available[stored] ? stored : data.default;
        if (wanted !== getRuntime()) {
          current = wanted;
          window.dispatchEvent(new Event(CHANGE_EVENT));
        }
      }
      return data;
    })
    .catch(() => {
      infoRequest = null;
      return null;
    });
  return infoRequest;
}

export function getRuntimeInfo(): RuntimeInfo | null {
  return info;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

export function useRuntime(): AgentRuntime {
  const runtime = useSyncExternalStore(subscribe, getRuntime, () => "omp" as AgentRuntime);
  useEffect(() => {
    void loadRuntimeInfo();
  }, []);
  return runtime;
}

/** `url` with the runtime query parameter set (for /api/sessions and /api/models). */
export function withRuntime(url: string, runtime: AgentRuntime = getRuntime()): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}runtime=${runtime}`;
}

// A session created in this tab is known to the browser before the server's
// session list reports its runtime; remember it so its models load correctly.
const sessionRuntimes = new Map<string, AgentRuntime>();

export function rememberSessionRuntime(sessionId: string, runtime: AgentRuntime): void {
  sessionRuntimes.set(sessionId, runtime);
}

/** The runtime of `session` (list metadata first, then what this tab created). Pi when unknown. */
export function runtimeOfSession(session: { id: string; runtime?: AgentRuntime } | null | undefined): AgentRuntime | null {
  if (!session) return null;
  return session.runtime ?? sessionRuntimes.get(session.id) ?? "pi";
}
