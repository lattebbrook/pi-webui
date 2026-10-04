"use client";

// Settings › OMP: native tools and agent settings, plus installation details.

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { OmpSettingsEditor } from "./OmpSettingsEditor";
import { ConfigButton } from "./SettingsUi";
import { sendAgentCommand } from "@/lib/agent-client";

interface OmpConfigResponse {
  installed: boolean;
  bin: string | null;
  version: string | null;
  paths: { agentDir: string; settings: string; models: string; sessions: string };
  defaultThinkingLevel: string | null;
  roles: { role: string; model: string }[];
  providers: { name: string; baseUrl: string | null; api: string | null; models: number; discovery: string | null }[];
}

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--border)", textAlign: "left" as const, verticalAlign: "top" as const };

export function OmpConfig({ sessionId, onReloaded }: { sessionId: string | null; onReloaded: () => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<OmpConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const reloadChat = async () => {
    if (!sessionId) return;
    setReloading(true); setError(null);
    try { await sendAgentCommand(sessionId, { type: "reload" }); onReloaded(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setReloading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/omp/config", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<OmpConfigResponse>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setConfig)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(String(err));
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">OMP</h2>
      <p className="settings-general-description" style={{ marginTop: 6 }}>{t("ompConfig.description")}</p>
      {sessionId && <ConfigButton variant="secondary" disabled={reloading} onClick={() => void reloadChat()}>Reload current OMP chat</ConfigButton>}
      {error && <p className="settings-general-error">{error}</p>}
      {!config && !error && <p className="settings-general-description">{t("ompConfig.loading")}</p>}
      {config && !config.installed && <p className="settings-general-error">{t("ompConfig.notInstalled")}</p>}
      {config?.installed && (
        <>
          <OmpSettingsEditor group="tools" />
          <details className="settings-general-section">
            <summary className="settings-general-heading">{t("ompConfig.install")}</summary>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500, width: 150 }}>{t("ompConfig.version")}</th><td style={cell} className="tabular-nums">{config.version ?? "—"}</td></tr>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500 }}>{t("ompConfig.binary")}</th><td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{config.bin}</td></tr>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500 }}>config.yml</th><td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{config.paths.settings}</td></tr>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500 }}>models.yml</th><td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{config.paths.models}</td></tr>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500 }}>{t("ompConfig.sessions")}</th><td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{config.paths.sessions}</td></tr>
                <tr><th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500 }}>{t("ompConfig.thinking")}</th><td style={cell}>{config.defaultThinkingLevel ?? "—"}</td></tr>
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}
