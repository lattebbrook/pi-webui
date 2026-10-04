"use client";

// Settings › OMP: what omp itself is configured with. In omp mode Pi WebUI
// follows omp's config.yml and models.yml; this page shows them read-only and
// says where to change them.

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

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

export function OmpConfig() {
  const { t } = useI18n();
  const [config, setConfig] = useState<OmpConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      {error && <p className="settings-general-error">{error}</p>}
      {!config && !error && <p className="settings-general-description">{t("ompConfig.loading")}</p>}
      {config && !config.installed && <p className="settings-general-error">{t("ompConfig.notInstalled")}</p>}
      {config?.installed && (
        <>
          <section className="settings-general-section">
            <h3 className="settings-general-heading">{t("ompConfig.install")}</h3>
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
          </section>

          <section className="settings-general-section">
            <h3 className="settings-general-heading">{t("ompConfig.roles")}</h3>
            <p className="settings-general-description">{t("ompConfig.rolesDescription")}</p>
            {config.roles.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {config.roles.map((entry) => (
                    <tr key={entry.role}>
                      <th style={{ ...cell, color: "var(--text-muted)", fontWeight: 500, width: 150 }}>{entry.role}</th>
                      <td style={{ ...cell, fontFamily: "var(--font-mono)" }}>{entry.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="settings-general-description">—</p>}
          </section>

          <section className="settings-general-section">
            <h3 className="settings-general-heading">{t("ompConfig.providers")}</h3>
            <p className="settings-general-description">{t("ompConfig.providersDescription")}</p>
            {config.providers.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {config.providers.map((provider) => (
                    <tr key={provider.name}>
                      <th style={{ ...cell, fontWeight: 600, width: 150 }}>{provider.name}</th>
                      <td style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{provider.baseUrl ?? "—"}</td>
                      <td style={{ ...cell, color: "var(--text-dim)", whiteSpace: "nowrap" }} className="tabular-nums">
                        {provider.discovery ? t("ompConfig.discovered", { type: provider.discovery }) : t("ompConfig.modelCount", { count: provider.models })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="settings-general-description">—</p>}
          </section>
        </>
      )}
    </div>
  );
}
