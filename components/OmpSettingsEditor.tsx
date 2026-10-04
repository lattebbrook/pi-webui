"use client";

import { useCallback, useEffect, useState } from "react";
import type { OmpSetting } from "@/lib/omp/settings-config";
import { ConfigButton, ConfigScopeTag, ConfigSwitch } from "./SettingsUi";

interface Snapshot { path: string; revision: string; settings: OmpSetting[] }
const roleNames = ["default", "smol", "slow", "vision", "plan", "commit", "advisor"];

export function OmpSettingsEditor({ group }: { group: "models" | "tools" }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [models, setModels] = useState<{ provider: string; id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/omp/settings", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load OMP settings");
      setSnapshot(data);
      setDrafts(Object.fromEntries((data.settings as OmpSetting[]).map((s) => [s.key, JSON.stringify(s.value, null, 2)])));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (group !== "models") return;
    const abort = new AbortController();
    fetch("/api/models?runtime=omp", { signal: abort.signal }).then((r) => r.ok ? r.json() : null).then((d) => setModels(d?.modelList ?? [])).catch(() => {});
    return () => abort.abort();
  }, [group]);

  async function save(key: string, value: unknown) {
    if (!snapshot || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const res = await fetch("/api/omp/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: snapshot.revision, changes: { [key]: value } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save OMP settings");
      setSnapshot(data);
      setDrafts((current) => ({ ...current, [key]: JSON.stringify((data.settings as OmpSetting[]).find((s) => s.key === key)?.value, null, 2) }));
      setStatus("Saved. New chats use these settings. Reload an idle chat to apply tool changes there.");
      window.dispatchEvent(new Event("pi-webui:models-changed"));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const parseAndSave = (setting: OmpSetting) => {
    try { void save(setting.key, JSON.parse(drafts[setting.key])); }
    catch { setError(`Invalid JSON for ${setting.key}`); }
  };
  const fields = snapshot?.settings.filter((s) => group === "models"
    ? ["modelRoles", "defaultThinkingLevel", "enabledModels", "disabledProviders"].includes(s.key)
    : !["modelRoles", "defaultThinkingLevel", "enabledModels", "disabledProviders"].includes(s.key)) ?? [];

  return <section className="settings-general-section omp-settings-editor">
    <div className="omp-config-heading"><h3 className="settings-general-heading">{group === "models" ? "Model defaults and scope" : "Tools and agent settings"}</h3><ConfigScopeTag scope="global">Global</ConfigScopeTag><ConfigButton variant="secondary" size="small" disabled={busy} onClick={() => void load()}>Reload settings</ConfigButton></div>
    {snapshot && <p className="settings-general-description omp-config-path">{snapshot.path}</p>}
    <p className="settings-general-description">These are global settings. Project configuration and environment variables can override them.</p>
    {error && <p role="alert" className="settings-general-error">{error}</p>}
    {status && <p role="status" className="settings-general-description">{status}</p>}
    {!snapshot && !error && <p className="settings-general-description">Loading OMP settings…</p>}
    <datalist id="omp-role-models">{models.map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name}</option>)}</datalist>
    {fields.map((setting) => {
      if (setting.key === "modelRoles") {
        const roles = (() => { try { return JSON.parse(drafts.modelRoles) as Record<string, string>; } catch { return {}; } })();
        const names = [...new Set([...roleNames, ...Object.keys(roles)])];
        return <div className="omp-config-field" key={setting.key}>
          <h4>Model roles</h4><p className="settings-general-description">Choose provider/model-id, optionally followed by :thinking-level. Empty roles use OMP’s fallback.</p>
          {names.map((role) => <label className="omp-config-role" key={role}><span>{role}</span><input list="omp-role-models" aria-label={`OMP ${role} model`} value={roles[role] ?? ""} disabled={busy} placeholder="provider/model-id" onChange={(e) => { const next = { ...roles }; if (e.target.value) next[role] = e.target.value; else delete next[role]; setDrafts((d) => ({ ...d, modelRoles: JSON.stringify(next, null, 2) })); }} /></label>)}
          <ConfigButton disabled={busy} onClick={() => parseAndSave(setting)}>Save model roles</ConfigButton>
        </div>;
      }
      if (setting.type === "boolean") return <div className="omp-config-field omp-config-toggle" key={setting.key}><div><strong>{setting.key}</strong><p className="settings-general-description">{setting.description}</p></div><ConfigSwitch checked={setting.value === true} disabled={busy} label={`OMP ${setting.key}`} onChange={(v) => void save(setting.key, v)} /></div>;
      if (setting.choices) return <label className="omp-config-field" key={setting.key}><strong>{setting.key}</strong><p className="settings-general-description">{setting.description}</p><select aria-label={`OMP ${setting.key}`} value={String(setting.value ?? "")} disabled={busy} onChange={(e) => void save(setting.key, e.target.value)}>{!setting.choices.includes(String(setting.value)) && <option value={String(setting.value ?? "")}>{String(setting.value ?? "Default")}</option>}{setting.choices.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>;
      const scoped = ["enabledModels", "disabledProviders"].includes(setting.key) && Array.isArray(setting.value) && setting.value.some((v) => typeof v !== "string");
      return <div className="omp-config-field" key={setting.key}><label><strong>{setting.key}</strong><p className="settings-general-description">{setting.description || (setting.key === "enabledModels" ? "Model selector patterns. An empty list includes all available models." : setting.key === "disabledProviders" ? "Providers excluded from the model registry. Credentials are kept." : setting.key === "compaction.keepRecentTokens" ? "Tokens to retain from recent messages during compaction." : "")}</p><textarea aria-label={`OMP ${setting.key}`} rows={setting.type === "number" ? 1 : 4} disabled={busy || scoped} value={drafts[setting.key] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))} /></label>{scoped && <p className="settings-general-description">This setting contains project scopes. Edit it in OMP to preserve those scopes.</p>}<div className="omp-config-actions"><ConfigButton disabled={busy || scoped} onClick={() => parseAndSave(setting)}>Save {setting.key}</ConfigButton><ConfigButton variant="secondary" disabled={busy || scoped} onClick={() => void save(setting.key, null)}>Use OMP default</ConfigButton></div></div>;
    })}
  </section>;
}
