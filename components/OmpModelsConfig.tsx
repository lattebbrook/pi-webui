"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AddProviderPicker, ModelDetail, OAuthDetail, ProviderDetail, type ModelEntry, type OAuthProvider, type ProviderEntry } from "./ModelsConfig";
import { ConfigButton, ConfigDetail, ConfigDetailStack, ConfigEmptyState, ConfigFooter, ConfigListAction, ConfigPanelShell, ConfigSidebar, ConfigSidebarItem, ConfigSidebarList, ConfigSidebarText, ConfigSplitView } from "./SettingsUi";
import { ProviderIcon } from "./ProviderIcon";
import { OmpSettingsEditor } from "./OmpSettingsEditor";
import { OMP_PROVIDER_PRESETS } from "@/lib/omp/provider-presets";

interface Snapshot { path: string; revision: string; providers: Record<string, ProviderEntry> }
interface RuntimeModel { id: string; name: string; provider: string }
type Selection = { kind: "provider"; id: string; index?: number } | { kind: "oauth" | "runtime"; id: string } | { kind: "roles" };

export function OmpModelsConfig() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ProviderEntry>>({});
  const [oauth, setOauth] = useState<OAuthProvider[]>([]);
  const [models, setModels] = useState<RuntimeModel[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const refreshRuntime = useCallback(async () => {
    try {
      const res = await fetch("/api/omp/providers", { cache: "no-store" }); const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load OMP providers");
      setOauth(data.oauthProviders); setModels(data.models);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/omp/models-config", { cache: "no-store" }); const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load providers");
      setSnapshot(data); setDrafts(data.providers); setNameDraft(null); setStatus("");
      setSelected((current) => current ?? (Object.keys(data.providers)[0] ? { kind: "provider", id: Object.keys(data.providers)[0] } : { kind: "roles" }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); void refreshRuntime(); }, [load, refreshRuntime]);
  const dirty = snapshot && JSON.stringify(snapshot.providers) !== JSON.stringify(drafts);
  const update = (id: string, provider: ProviderEntry) => { setDrafts((p) => ({ ...p, [id]: provider })); setStatus(""); };
  function add(id?: string) {
    const preset = OMP_PROVIDER_PRESETS.find((p) => p.id === id);
    let name = id ?? "new-provider"; let n = 1;
    while (drafts[name]) name = `${id ?? "new-provider"}-${n++}`;
    update(name, { api: preset?.api ?? "openai-completions", baseUrl: preset?.baseUrl, auth: preset?.auth ?? "none", models: [] });
    setSelected({ kind: "provider", id: name });
  }
  async function save() {
    if (!snapshot || busy) return;
    if (nameDraft && nameDraft.value !== nameDraft.id) { setError("Apply the provider ID with Rename before saving, or restore its original ID."); return; }
    setError(""); setStatus(""); setBusy(true);
    try {
      const res = await fetch("/api/omp/models-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: snapshot.revision, providers: drafts }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "Could not save providers");
      setSnapshot(data); setDrafts(data.providers);
      setStatus("Saved to OMP. New chats use these providers; reload an idle chat to refresh it.");
      window.dispatchEvent(new Event("pi-webui:models-changed"));
      void refreshRuntime();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const runtimeProviders = [...new Set(models.map((m) => m.provider))].filter((id) => !drafts[id] && !oauth.some((p) => p.id === id && p.loggedIn));
  const provider = selected?.kind === "provider" ? drafts[selected.id] : undefined;
  const model = selected?.kind === "provider" && selected.index !== undefined ? provider?.models?.[selected.index] : undefined;
  const login = selected?.kind === "oauth" ? oauth.find((p) => p.id === selected.id) : undefined;
  const rename = (name: string) => {
    if (selected?.kind !== "provider" || name === selected.id) return;
    if (snapshot?.providers[selected.id]) { setError("Saved provider IDs are fixed to preserve credentials and model roles. Add a new provider to use a different ID."); return; }
    if (!/^[\w.-]{1,100}$/.test(name) || drafts[name]) { setError("Choose a unique provider ID using letters, numbers, dots, dashes or underscores."); return; }
    const next = { ...drafts }; next[name] = next[selected.id]; delete next[selected.id]; setDrafts(next); setSelected({ kind: "provider", id: name }); setNameDraft(null);
  };
  return <>
    <ConfigPanelShell embedded title="OMP Models" subtitle={snapshot?.path} onClose={() => {}}>
      <fieldset disabled={busy} className="omp-models-fields"><ConfigSplitView>
        <ConfigSidebar><ConfigSidebarList>
          <ConfigSidebarItem active={selected?.kind === "roles"} onClick={() => setSelected({ kind: "roles" })}><ConfigSidebarText>Model roles &amp; defaults</ConfigSidebarText></ConfigSidebarItem>
          {oauth.filter((p) => p.loggedIn || (selected?.kind === "oauth" && selected.id === p.id)).map((p) => <ConfigSidebarItem key={`oauth-${p.id}`} active={selected?.kind === "oauth" && selected.id === p.id} onClick={() => setSelected({ kind: "oauth", id: p.id })}><ProviderIcon id={p.id} size={16} /><ConfigSidebarText>{p.name}</ConfigSidebarText></ConfigSidebarItem>)}
          {runtimeProviders.map((id) => <ConfigSidebarItem key={`runtime-${id}`} active={selected?.kind === "runtime" && selected.id === id} onClick={() => setSelected({ kind: "runtime", id })}><ProviderIcon id={id} size={16} /><ConfigSidebarText>{id}</ConfigSidebarText></ConfigSidebarItem>)}
          {Object.entries(drafts).map(([id, p]) => <Fragment key={id}>
            <ConfigSidebarItem active={selected?.kind === "provider" && selected.id === id && selected.index === undefined} onClick={() => setSelected({ kind: "provider", id })}><ProviderIcon id={id} size={16} /><ConfigSidebarText className="is-grow">{id}</ConfigSidebarText><span className="models-sidebar-badge">{p.models?.length ?? 0}</span></ConfigSidebarItem>
            {p.models?.map((m, index) => <ConfigSidebarItem key={index} className="models-sidebar-indented-item" active={selected?.kind === "provider" && selected.id === id && selected.index === index} onClick={() => setSelected({ kind: "provider", id, index })}><ConfigSidebarText>{m.id || "New model"}</ConfigSidebarText></ConfigSidebarItem>)}
            <ConfigSidebarItem className="models-sidebar-indented-item models-sidebar-add-item" disabled={busy} onClick={() => { update(id, { ...p, models: [...(p.models ?? []), { id: "" }] }); setSelected({ kind: "provider", id, index: p.models?.length ?? 0 }); }}><ConfigSidebarText>+ Model</ConfigSidebarText></ConfigSidebarItem>
          </Fragment>)}
        </ConfigSidebarList><ConfigListAction disabled={!snapshot || busy} onClick={() => setPickerOpen(true)}>Add provider</ConfigListAction></ConfigSidebar>
        <ConfigDetail><ConfigDetailStack className="is-fill">
          {!snapshot && !error && <ConfigEmptyState>Loading OMP providers…</ConfigEmptyState>}
          {selected?.kind === "roles" && <OmpSettingsEditor group="models" />}
          {login && <OAuthDetail key={login.id} provider={login} authBase="/api/omp/auth" onRefresh={() => { void refreshRuntime(); window.dispatchEvent(new Event("pi-webui:models-changed")); }} />}
          {selected && (selected.kind === "runtime" || selected.kind === "oauth") && <><p className="settings-general-description">Models supplied by OMP’s native provider registry. Choose one in the chat model selector or assign it under Model roles &amp; defaults.</p>{selected.kind === "runtime" && <p className="settings-general-description">Credentials are managed by OMP. Use omp /login, or add this provider with an API key below.</p>}<ul className="omp-runtime-models">{models.filter((m) => m.provider === selected.id).map((m) => <li key={m.id}><strong>{m.name}</strong><code>{m.id}</code></li>)}</ul></>}
          {selected?.kind === "provider" && provider && !model && <>
            <ProviderDetail key={selected.id} name={selected.id} nameLocked={Boolean(snapshot?.providers[selected.id])} editingName={nameDraft?.id === selected.id ? nameDraft.value : selected.id} provider={provider} apiBase="/api/omp/models-config" onChange={(p) => update(selected.id, p)} onEditingNameChange={(value) => setNameDraft({ id: selected.id, value })} onRename={rename} onDelete={() => { if (window.confirm(`Remove ${selected.id}? Save applies this change and creates a backup.`)) { const next = { ...drafts }; delete next[selected.id]; setDrafts(next); setSelected({ kind: "roles" }); } }} onAddModels={(found) => { const known = new Set(provider.models?.map((m) => m.id)); update(selected.id, { ...provider, models: [...(provider.models ?? []), ...found.filter((m) => !known.has(m.id))] }); }} />
            <label className="omp-config-field">Authentication<select aria-label="OMP authentication" value={provider.auth ?? "apiKey"} onChange={(e) => update(selected.id, { ...provider, auth: e.target.value as ProviderEntry["auth"] })}><option value="none">None (local server)</option><option value="apiKey">API key / environment variable</option><option value="oauth">OMP login</option></select></label>
            <p className="settings-general-description">Stored credentials are masked; leave the marker unchanged to keep them. Environment names are resolved on this device. Command references run only inside OMP, not when discovering models.</p>
          </>}
          {selected?.kind === "provider" && provider && model && <ModelDetail key={`${selected.id}-${selected.index}`} providerName={selected.id} provider={provider} model={model} apiBase="/api/omp/models-config" onChange={(m: ModelEntry) => update(selected.id, { ...provider, models: provider.models!.map((old, i) => i === selected.index ? m : old) })} onDelete={() => { update(selected.id, { ...provider, models: provider.models!.filter((_, i) => i !== selected.index) }); setSelected({ kind: "provider", id: selected.id }); }} />}
        </ConfigDetailStack></ConfigDetail>
      </ConfigSplitView></fieldset>
      <ConfigFooter status={<span role={error ? "alert" : "status"} className={error ? "settings-general-error" : "settings-general-description"}>{error || status || (dirty ? "Unsaved provider changes" : "OMP providers and credentials are separate from Pi.")}</span>}>
        <ConfigButton variant="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved provider changes and reload?")) { void load(); void refreshRuntime(); } }}>Reload</ConfigButton>
        <ConfigButton disabled={!snapshot || busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</ConfigButton>
      </ConfigFooter>
    </ConfigPanelShell>
    {pickerOpen && <AddProviderPicker nativeLogin oauthProviders={oauth} apiKeyProviders={OMP_PROVIDER_PRESETS.map((p) => ({ id: p.id, displayName: p.name, configured: Boolean(drafts[p.id]), modelCount: models.filter((m) => m.provider === p.id).length }))} onSelectOAuth={(id) => setSelected({ kind: "oauth", id })} onSelectApiKey={add} onAddCustom={() => add()} onClose={() => setPickerOpen(false)} />}
  </>;
}
