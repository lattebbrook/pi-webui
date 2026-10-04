// Models for omp mode, as omp itself reports them (adapted from ompweb's
// rpc-utility + models route, MIT). A shared helper `omp --mode rpc-ui
// --no-session` answers get_available_models / get_state, so the list, the
// default model and thinking levels follow omp's own models.yml, config.yml
// and logins rather than pi's.

import { homedir } from "os";
import type { ModelsData } from "../models-cache";
import { readFileSync } from "fs";
import { load as parseYaml } from "js-yaml";
import { getSettingsPath } from "./paths";
import { RpcProcess } from "./rpc-process";

/** omp's config.yml `defaultThinkingLevel`, which get_state leaves out until a session sets one. */
function readOmpDefaultThinkingLevel(): string | null {
  try {
    const config = parseYaml(readFileSync(getSettingsPath(), "utf8")) as { defaultThinkingLevel?: unknown } | null;
    return typeof config?.defaultThinkingLevel === "string" ? config.defaultThinkingLevel : null;
  } catch {
    return null;
  }
}

const IDLE_KILL_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 60_000;

interface OmpModel {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  thinking?: { efforts?: string[]; effortMap?: Record<string, string> };
}

interface UtilityState {
  proc: RpcProcess | null;
  ready: Promise<void> | null;
  idle: NodeJS.Timeout | null;
}

declare global {
  var __piWebuiOmpUtility: UtilityState | undefined;
}

function utility(): UtilityState {
  return (globalThis.__piWebuiOmpUtility ??= { proc: null, ready: null, idle: null });
}

export function disposeOmpUtility(): void {
  const state = utility();
  if (state.idle) clearTimeout(state.idle);
  const proc = state.proc;
  state.proc = null;
  state.ready = null;
  void proc?.dispose().catch(() => undefined);
}

/** Run one command on the shared helper omp process, starting it if needed. */
export async function runOmpUtilityCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T> {
  const state = utility();
  if (!state.proc || !state.proc.isAlive) {
    const proc = new RpcProcess({ cwd: homedir(), extraArgs: ["--no-session"] });
    state.proc = proc;
    state.ready = proc.waitReady(COMMAND_TIMEOUT_MS).then((ready) => proc.negotiateProtocol(ready)).then(() => undefined);
  }
  await state.ready;
  if (state.idle) clearTimeout(state.idle);
  state.idle = setTimeout(disposeOmpUtility, IDLE_KILL_MS);
  state.idle.unref?.();
  return state.proc!.sendCommand<T>(command, COMMAND_TIMEOUT_MS);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** pi-web's ModelsData, filled from omp. */
export async function loadOmpModels(): Promise<ModelsData> {
  const [available, state] = await Promise.all([
    runOmpUtilityCommand<{ models?: OmpModel[] } | OmpModel[]>({ type: "get_available_models" }),
    runOmpUtilityCommand<{ model?: { id: string; provider: string }; thinkingLevel?: string }>({ type: "get_state" }).catch(() => null),
  ]);
  const models: OmpModel[] = Array.isArray(available) ? available : Array.isArray(available?.models) ? available.models : [];

  const names: Record<string, string> = {};
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  const modelList = models
    .filter((model) => typeof model?.id === "string" && typeof model?.provider === "string")
    .map((model) => {
      const key = `${model.provider}:${model.id}`;
      names[key] = model.name || model.id;
      thinkingLevels[key] = model.reasoning ? ["off", ...(model.thinking?.efforts ?? ["low", "medium", "high"])] : ["off"];
      if (model.thinking?.effortMap) thinkingLevelMaps[key] = model.thinking.effortMap;
      return { id: model.id, name: model.name || model.id, provider: model.provider, ...(model.input ? { input: model.input } : {}) };
    })
    .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.provider, b.provider));

  return {
    models: names,
    modelList,
    defaultModel: state?.model ? { provider: state.model.provider, modelId: state.model.id } : null,
    defaultThinkingLevel: state?.thinkingLevel ?? readOmpDefaultThinkingLevel(),
    savedDefaultThinkingLevel: readOmpDefaultThinkingLevel(),
    thinkingLevels,
    thinkingLevelMaps,
    thinkingLevelPins: {},
  };
}
