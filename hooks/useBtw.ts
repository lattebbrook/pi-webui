"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isBtwRecord, latestBtwTurn, type BtwRecord } from "@/lib/btw";

const POLL_MS = 300;

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`;
}

/**
 * Side questions (`/btw`) for one chat, adapted from ompweb's useBtw: the server
 * keeps the records (lib/btw-service.ts) and this hook polls them while an
 * answer streams. Never touches the main transcript.
 */
export function useBtw(sessionId: string | null) {
  const [records, setRecords] = useState<BtwRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const refresh = useCallback(async (sid: string) => {
    const res = await fetch(`/api/btw/${encodeURIComponent(sid)}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok || sessionRef.current !== sid) return;
    const data = await res.json() as { records?: unknown[] };
    setRecords((data.records ?? []).filter(isBtwRecord));
  }, []);

  // A different chat has its own side questions.
  useEffect(() => {
    setRecords([]);
    setActiveId(null);
    setError(null);
    if (sessionId) void refresh(sessionId);
  }, [sessionId, refresh]);

  const running = records.some((record) => latestBtwTurn(record).status === "running");
  useEffect(() => {
    if (!running || !sessionId) return;
    const timer = window.setInterval(() => void refresh(sessionId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, sessionId, refresh]);

  /** Ask (or follow up on `recordId`). Resolves to null once accepted, or to why the server refused (also kept in `error`). */
  const ask = useCallback(async (sid: string, question: string, recordId?: string): Promise<string | null> => {
    setError(null);
    const res = await fetch(`/api/btw/${encodeURIComponent(sid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, ...(recordId ? { recordId } : {}) }),
    }).catch(() => null);
    const refused = !res ? "Could not reach the server" : !res.ok ? await readError(res) : null;
    if (refused || !res) {
      setError(refused);
      return refused;
    }
    const data = await res.json() as { record?: unknown };
    if (sessionRef.current !== sid || !isBtwRecord(data.record)) return null;
    const record = data.record;
    setRecords((prev) => [record, ...prev.filter((candidate) => candidate.id !== record.id)]);
    setActiveId(record.id);
    return null;
  }, []);

  const cancel = useCallback(async (recordId: string) => {
    const sid = sessionRef.current;
    if (!sid) return;
    await fetch(`/api/btw/${encodeURIComponent(sid)}?recordId=${encodeURIComponent(recordId)}`, { method: "DELETE" }).catch(() => null);
    await refresh(sid);
  }, [refresh]);

  /** `/btw` alone: reopen the newest side question, if there is one. */
  const openLatest = useCallback(() => {
    setActiveId((current) => current ?? records[0]?.id ?? null);
    return records.length > 0;
  }, [records]);

  const active = records.find((record) => record.id === activeId) ?? null;
  return { records, active, activeId, setActiveId, error, setError, ask, cancel, openLatest };
}
