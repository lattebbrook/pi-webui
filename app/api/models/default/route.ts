import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isThinkingLevel,
  projectSettingsPath,
  shadowingProjectKeys,
  writeDefaultPreferences,
  type DefaultPreferencesEdit,
} from "@/lib/default-preferences";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { resolveVisibleModels } from "@/lib/model-scope";
import { invalidateModelsCache } from "@/lib/models-cache";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { loadOmpModels, disposeOmpUtility } from "@/lib/omp/omp-models";
import { readOmpSettings, writeOmpSettings } from "@/lib/omp/settings-config";
import { readOmpDocument, isRecord, OmpConfigError } from "@/lib/omp/config-store";
import { ompConfigFailure } from "@/lib/omp/config-api";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { join } from "path";

export const dynamic = "force-dynamic";

interface DefaultPreferencesRequest {
  cwd?: unknown;
  provider?: unknown;
  modelId?: unknown;
  thinkingLevel?: unknown;
}

function parseEdit(body: DefaultPreferencesRequest): DefaultPreferencesEdit | null {
  const edit: DefaultPreferencesEdit = {};
  if (body.provider !== undefined || body.modelId !== undefined) {
    if (typeof body.provider !== "string" || !body.provider) return null;
    if (typeof body.modelId !== "string" || !body.modelId) return null;
    edit.model = { provider: body.provider, modelId: body.modelId };
  }
  if (body.thinkingLevel !== undefined) {
    if (!isThinkingLevel(body.thinkingLevel)) return null;
    edit.thinkingLevel = body.thinkingLevel;
  }
  return edit.model || edit.thinkingLevel ? edit : null;
}

/**
 * Save the model and/or reasoning level new sessions start with.
 *
 * Picking a model for one chat is session-scoped, as in the TUI; this is the
 * explicit "save as default" behind the selectors' star. The cwd decides which
 * project settings could shadow the global value and which models are in scope,
 * so it goes through the same allow-list as `/api/models`.
 */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body: DefaultPreferencesRequest;
  try {
    body = await req.json() as DefaultPreferencesRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const edit = parseEdit(body);
  if (!edit) {
    return Response.json({ error: "Expected provider and modelId, or a valid thinkingLevel" }, { status: 400 });
  }

  const cwd = resolve(typeof body.cwd === "string" && body.cwd ? body.cwd : process.cwd());
  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  if (new URL(req.url).searchParams.get("runtime") === "omp") {
    try {
      // Native OMP project layers replace global defaults. Refuse a misleading
      // star save when that project already supplies the setting being edited.
      const yaml = readOmpDocument(join(cwd, ".omp", "config.yml")).value;
      let legacy: Record<string, unknown> = {};
      const { readRegularFileText } = await import("@/lib/regular-file");
      const text = readRegularFileText(join(cwd, ".omp", "settings.json"), 1024 * 1024);
      if (text) { const value: unknown = JSON.parse(text); if (isRecord(value)) legacy = value; }
      if ([legacy, yaml].some((config) => (edit.model && isRecord(config.modelRoles) && Object.hasOwn(config.modelRoles, "default")) || (edit.thinkingLevel && Object.hasOwn(config, "defaultThinkingLevel")))) {
        throw new OmpConfigError("This project sets an OMP default. Edit its .omp configuration instead.", 409);
      }
      const current = await readOmpSettings();
      const changes: Record<string, unknown> = {};
      if (edit.model) {
        const models = await loadOmpModels();
        if (!models.modelList.some((m) => m.provider === edit.model!.provider && m.id === edit.model!.modelId)) throw new OmpConfigError("Model is not available in OMP", 404);
        const roles = current.settings.find((s) => s.key === "modelRoles")?.value;
        changes.modelRoles = { ...(isRecord(roles) ? roles : {}), default: `${edit.model.provider}/${edit.model.modelId}` };
      }
      if (edit.thinkingLevel) changes.defaultThinkingLevel = edit.thinkingLevel;
      await writeOmpSettings(changes, current.revision);
      disposeOmpUtility();
      invalidateModelsCache();
      return Response.json({ ok: true, ...(edit.model ? { defaultModel: edit.model } : {}), ...(edit.thinkingLevel ? { defaultThinkingLevel: edit.thinkingLevel } : {}) });
    } catch (error) { return ompConfigFailure(error); }
  }

  try {
    const agentDir = getAgentDir();
    const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const { settingsManager } = services;

    const shadowed = shadowingProjectKeys(settingsManager, edit);
    if (shadowed.length > 0) {
      const settingsPath = projectSettingsPath(cwd);
      return Response.json({
        error: `${settingsPath} sets ${shadowed.join(", ")} for this project, so a global default would not apply here.`,
        reason: "project-scope",
        settingsPath,
        keys: shadowed,
      }, { status: 409 });
    }

    if (edit.model) {
      // Only a model the selector can offer is a default that actually takes
      // effect: startup falls back to the first scoped model otherwise.
      const scope = await resolveVisibleModels(services.modelRuntime, settingsManager.getEnabledModels());
      const { provider, modelId } = edit.model;
      if (!scope.visible.some((model) => model.provider === provider && model.id === modelId)) {
        return Response.json({ error: `Model not available: ${provider}/${modelId}` }, { status: 404 });
      }
    }

    await writeDefaultPreferences(settingsManager, edit);
    invalidateModelsCache();
    return Response.json({
      ok: true,
      ...(edit.model ? { defaultModel: edit.model } : {}),
      ...(edit.thinkingLevel ? { defaultThinkingLevel: edit.thinkingLevel } : {}),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
