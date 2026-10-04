"use client";

// ⌘K / Ctrl+K command palette: jump to a session, start a chat, open a Settings
// section, or switch theme. Modeled on ompweb's CommandPalette (MIT), written
// without cmdk so pi-web keeps its no-UI-library footprint.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import type { SettingsSection } from "@/lib/settings-navigation";
import type { SessionInfo } from "@/lib/types";
import { paletteScore } from "@/lib/command-palette";
import { setRuntime, useRuntime, withRuntime } from "@/lib/runtime-client";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  /** Extra text matched by the filter but not shown. */
  keywords?: string;
  run: () => void;
}

interface Props {
  onSelectSession: (session: SessionInfo) => void;
  /** Null when no project is open, so there is nowhere to start a chat. */
  onNewSession: (() => void) | null;
  onOpenSettings: (section: SettingsSection) => void;
}

const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "settings.general" },
  { id: "models", label: "common.models" },
  { id: "usage", label: "settings.usage" },
  { id: "mcp", label: "settings.mcp" },
  { id: "skills", label: "common.skills" },
  { id: "agents", label: "common.agents" },
  { id: "plugins", label: "common.plugins" },
];

const MAX_SESSIONS = 40;


function relativeTime(iso: string, locale: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  if (!Number.isFinite(diff)) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 3600) return format.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return format.format(Math.round(diff / 3600), "hour");
  return format.format(Math.round(diff / 86400), "day");
}

export function CommandPalette({ onSelectSession, onNewSession, onOpenSettings }: Props) {
  const { t, locale } = useI18n();
  const { setThemePreference, preference } = useTheme();
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    restoreFocusRef.current?.focus?.();
  }, []);

  // ⌘K on macOS, Ctrl+K elsewhere; toggles so the same chord closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((wasOpen) => {
        if (!wasOpen) restoreFocusRef.current = document.activeElement as HTMLElement | null;
        return !wasOpen;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    let active = true;
    void fetch(withRuntime("/api/sessions"), { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ sessions?: SessionInfo[] }>) : null))
      .then((data) => {
        if (!active || !data?.sessions) return;
        const topLevel = data.sessions.filter((session) => session.relation?.kind !== "subagent");
        setSessions(topLevel.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, runtime]);

  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [];
    if (onNewSession) actions.push({ id: "new", group: t("commandPalette.actions"), label: t("commandPalette.newSession"), keywords: "new chat session", run: onNewSession });
    for (const section of SETTINGS_SECTIONS) {
      actions.push({
        id: `settings:${section.id}`,
        group: t("commandPalette.settings"),
        label: `${t("settings.title")}: ${t(section.label)}`,
        keywords: `settings preferences ${section.id}`,
        run: () => onOpenSettings(section.id),
      });
    }
    for (const option of [{ id: "omp" as const, label: "OMP" }, { id: "pi" as const, label: "Pi" }]) {
      if (option.id === runtime) continue;
      actions.push({
        id: `runtime:${option.id}`,
        group: t("commandPalette.runtime"),
        label: t("commandPalette.switchRuntime", { name: option.label }),
        keywords: `agent runtime switch omp pi ${option.id}`,
        run: () => setRuntime(option.id),
      });
    }
    for (const option of THEME_OPTIONS) {
      actions.push({
        id: `theme:${option.id}`,
        group: t("commandPalette.themes"),
        label: `${t("commandPalette.theme")}: ${t(option.label)}`,
        hint: preference === option.id ? t("commandPalette.current") : undefined,
        keywords: `theme appearance color ${option.id}`,
        run: () => setThemePreference(option.id as ThemePreference),
      });
    }
    const sessionItems: PaletteItem[] = sessions.map((session) => ({
      id: `session:${session.id}`,
      group: t("commandPalette.sessions"),
      label: session.name || session.firstMessage || session.id,
      hint: `${session.cwd.split("/").filter(Boolean).pop() ?? session.cwd} · ${relativeTime(session.modified, locale)}`,
      keywords: `${session.cwd} ${session.firstMessage}`,
      run: () => onSelectSession(session),
    }));
    return [...sessionItems, ...actions];
  }, [sessions, onNewSession, onOpenSettings, onSelectSession, preference, setThemePreference, locale, t, runtime]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      // Without a query: recent sessions first, then every action.
      const recent = items.filter((item) => item.id.startsWith("session:")).slice(0, 8);
      return [...recent, ...items.filter((item) => !item.id.startsWith("session:"))];
    }
    const ranked = items
      .map((item, index) => ({ item, index, rank: paletteScore(item, words) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, MAX_SESSIONS);
    // Keep each group together (one heading each), groups ordered by their best match.
    const groupOrder = [...new Set(ranked.map((entry) => entry.item.group))];
    return groupOrder.flatMap((group) => ranked.filter((entry) => entry.item.group === group).map((entry) => entry.item));
  }, [items, query]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  if (!open) return null;

  let lastGroup = "";
  const rows: ReactNode[] = [];
  visible.forEach((item, index) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      rows.push(
        <div key={`group:${item.group}`} role="presentation" style={{ padding: "8px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          {item.group}
        </div>,
      );
    }
    const isSelected = index === selected;
    rows.push(
      <div
        key={item.id}
        id={`command-palette-${index}`}
        role="option"
        aria-selected={isSelected}
        data-index={index}
        onMouseMove={() => setSelected(index)}
        onMouseDown={(event) => {
          event.preventDefault();
          choose(item);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 10px", borderRadius: 7, cursor: "pointer",
          background: isSelected ? "var(--bg-selected)" : "transparent",
          color: "var(--text)", fontSize: 13,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
        {item.hint && <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>{item.hint}</span>}
      </div>,
    );
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("commandPalette.label")}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
      className="ui-backdrop"
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "color-mix(in srgb, var(--text) 18%, transparent)", paddingTop: "18vh" }}
    >
      <div className="ui-popover" style={{ width: "min(92vw, 560px)", margin: "0 auto", overflow: "hidden", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 24px 64px -16px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(index + 1, visible.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                choose(visible[selected]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={visible.length ? `command-palette-${selected}` : undefined}
            placeholder={t("commandPalette.placeholder")}
            style={{ width: "100%", border: 0, outline: 0, background: "transparent", color: "var(--text)", fontSize: 15, fontFamily: "inherit" }}
          />
        </div>
        <div ref={listRef} id="command-palette-list" role="listbox" style={{ maxHeight: "min(56vh, 440px)", overflowY: "auto", padding: 6 }}>
          {rows.length ? rows : <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>{t("commandPalette.empty")}</div>}
        </div>
        <div style={{ borderTop: "1px solid var(--border)", padding: "7px 14px", fontSize: 11, color: "var(--text-dim)" }}>{t("commandPalette.hints")}</div>
      </div>
    </div>
  );
}
