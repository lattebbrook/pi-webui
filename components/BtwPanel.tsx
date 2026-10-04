"use client";

// Side-question panel (`/btw`), adapted from ompweb's BtwPanel (MIT) to pi-web's
// styling: the active topic's turns with the latest answer streaming, plus
// cancel / copy / follow-up. Callers key it by record id so each topic starts fresh.

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { btwTurns, latestBtwAnswer, latestBtwTurn, type BtwRecord, type BtwStatus, type BtwTurn } from "@/lib/btw";
import { copyText } from "@/lib/clipboard";
import { MarkdownBody } from "./MarkdownBody";
import { Loader2, Square, X } from "./DictationIcons";

const STATUS_KEYS: Record<BtwStatus, string> = {
  running: "btw.statusRunning",
  complete: "btw.statusComplete",
  cancelled: "btw.statusCancelled",
  error: "btw.statusError",
  interrupted: "btw.statusInterrupted",
};

const actionStyle: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "4px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
};

function BtwStatusLabel({ status }: { status: BtwStatus }) {
  const { t } = useI18n();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, fontSize: 11, color: status === "error" ? "var(--status-error)" : "var(--text-dim)" }}>
      {status === "running" && <Loader2 size={11} className="animate-spin" />}
      {t(STATUS_KEYS[status] ?? "btw.statusError")}
    </span>
  );
}

/** One exchange. Memoized: only the streaming turn changes per poll, so earlier answers are not re-parsed. */
const BtwTurnView = memo(function BtwTurnView({ turn, live, cwd, onOpenFile }: { turn: BtwTurn; live: boolean; cwd?: string | null; onOpenFile?: (filePath: string) => void }) {
  const { t } = useI18n();
  const running = turn.status === "running";
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: "var(--text-muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.question}</p>
      <div aria-live={live ? "polite" : undefined} aria-busy={live && running ? true : undefined} style={{ minWidth: 0, fontSize: 14, color: "var(--text)" }}>
        {turn.answer
          ? <MarkdownBody isStreaming={running} cwd={cwd ?? undefined} onOpenFile={onOpenFile}>{turn.answer}</MarkdownBody>
          : running ? <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("btw.waiting")}</span> : null}
        {turn.error && <p style={{ margin: 0, fontSize: 12, color: "var(--status-error)", overflowWrap: "anywhere" }}>{turn.error}</p>}
      </div>
    </div>
  );
});

export interface BtwPanelProps {
  record: BtwRecord;
  error?: string | null;
  cwd?: string | null;
  onOpenFile?: (filePath: string) => void;
  onCancel: () => void;
  /** Resolves false when the server refused the follow-up. */
  onFollowUp: (question: string) => Promise<boolean>;
  onClose: () => void;
}

export function BtwPanel({ record, error, cwd, onOpenFile, onCancel, onFollowUp, onClose }: BtwPanelProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const turns = btwTurns(record);
  const latest = latestBtwTurn(record);
  const running = latest.status === "running";
  const answer = latestBtwAnswer(record);

  // Follow the streaming tail like the chat does, until the user scrolls up.
  const turnsRef = useRef<HTMLDivElement>(null);
  const followTailRef = useRef(true);
  useLayoutEffect(() => {
    const el = turnsRef.current;
    if (el && followTailRef.current) el.scrollTop = el.scrollHeight;
  }, [latest.answer, turns.length, collapsed]);

  // Cancel and the follow-up form swap places when a turn starts or settles;
  // keep keyboard focus in that row instead of dropping it to <body>.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInActionsRef = useRef(false);
  useEffect(() => {
    if (!focusInActionsRef.current || document.activeElement !== document.body) return;
    (running ? cancelRef.current : inputRef.current)?.focus();
  }, [running]);

  const submitFollowUp = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || running || sending) return;
    setSending(true);
    followTailRef.current = true;
    if (await onFollowUp(question)) setDraft("");
    setSending(false);
  };

  return (
    <section
      aria-label={t("btw.panelTitle")}
      style={{ overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg-subtle)", borderRadius: 10, marginBottom: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", borderBottom: collapsed ? "none" : "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, padding: "7px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 12, color: "var(--text-muted)", fontFamily: "inherit" }}
        >
          <strong style={{ flexShrink: 0, fontWeight: 600, color: "var(--text)" }}>{t("btw.panelTitle")}</strong>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.question}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex" }}><BtwStatusLabel status={latest.status} /></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ flexShrink: 0, color: "var(--text-dim)", transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("btw.close")}
          title={t("btw.close")}
          style={{ display: "inline-flex", flexShrink: 0, marginRight: 6, padding: 4, background: "none", border: "none", borderRadius: 6, cursor: "pointer", color: "var(--text-dim)" }}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
      {!collapsed && (
        <div style={{ display: "grid", gap: 8, padding: "10px 12px" }}>
          <div
            ref={turnsRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              followTailRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            style={{ display: "grid", gap: 10, maxHeight: "min(36vh, 320px)", overflowY: "auto" }}
          >
            {turns.map((turn, index) => (
              <BtwTurnView key={`${turn.createdAt}:${index}`} turn={turn} live={index === turns.length - 1} cwd={cwd} onOpenFile={onOpenFile} />
            ))}
          </div>
          {error && <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--status-error)" }}>{error}</p>}
          <div
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}
            onFocus={() => { focusInActionsRef.current = true; }}
            onBlur={(event) => { if (event.relatedTarget) focusInActionsRef.current = event.currentTarget.contains(event.relatedTarget); }}
          >
            {running ? (
              <button ref={cancelRef} type="button" style={actionStyle} onClick={onCancel}>
                <Square size={11} strokeWidth={2} />
                {t("btw.cancel")}
              </button>
            ) : (
              <form onSubmit={submitFollowUp} style={{ display: "flex", flex: 1, alignItems: "center", gap: 6, minWidth: "min(100%, 220px)" }}>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  // The Enter that commits an IME composition must not submit.
                  onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}
                  aria-label={t("btw.followUpLabel")}
                  placeholder={t("btw.followUpPlaceholder")}
                  disabled={sending}
                  style={{ flex: 1, minWidth: 0, padding: "4px 8px", fontSize: 13, color: "var(--text)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "inherit" }}
                />
                <button type="submit" style={actionStyle} disabled={sending || !draft.trim()}>
                  {t("btw.ask")}
                </button>
              </form>
            )}
            {answer && (
              <button
                type="button"
                style={actionStyle}
                onClick={() => void copyText(answer).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }).catch(() => undefined)}
              >
                {copied ? t("btw.copied") : t("btw.copy")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
