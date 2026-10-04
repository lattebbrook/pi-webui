import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolveOmpBin, wrapWindowsScript } from "./omp-cli";
import { getAgentDir, getSettingsPath } from "./paths";
import { isRecord, OmpConfigError, readOmpDocument, updateOmpDocument } from "./config-store";
import { sanitizeProjectCommandEnvironment } from "../project-command-env";

// Reviewed keys only. Never expose the CLI's complete config (credential
// settings, remote execution endpoints, and shell commands live there too).
export const OMP_SETTING_CHOICES: Record<string, readonly string[]> = {
  defaultThinkingLevel: ["auto", "minimal", "low", "medium", "high", "xhigh", "max"],
  "tools.approvalMode": ["always-ask", "write", "yolo"],
};
export const OMP_EDITABLE_KEYS = [
  "defaultThinkingLevel", "modelRoles", "enabledModels", "disabledProviders",
  "bash.enabled", "glob.enabled", "grep.enabled", "astGrep.enabled", "astEdit.enabled",
  "fetch.enabled", "web_search.enabled", "browser.enabled", "computer.enabled",
  "lsp.enabled", "eval.py", "eval.js", "tools.approvalMode", "tools.approval",
  "advisor.enabled", "retry.enabled", "retry.maxRetries", "compaction.enabled",
  "compaction.keepRecentTokens", "hideThinkingBlock", "externalThinking",
] as const;

export interface OmpSetting {
  key: string;
  type: string;
  value: unknown;
  description: string;
  choices?: readonly string[];
}

export async function readOmpSettingsSchema(): Promise<OmpSetting[]> {
  const bin = resolveOmpBin();
  if (!bin) throw new OmpConfigError("OMP is not installed", 503);
  const env = sanitizeProjectCommandEnvironment({ ...process.env, PI_CODING_AGENT_DIR: getAgentDir() });
  delete env.OMP_PROFILE; delete env.PI_PROFILE; delete env.PI_CONFIG_DIR;
  const target = wrapWindowsScript(bin, ["config", "list", "--json"]);
  const source = await new Promise<string>((resolve, reject) => {
    execFile(target.file, target.args, { cwd: homedir(), env, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(new OmpConfigError("Could not read the installed OMP settings schema", 503));
      else resolve(stdout);
    });
  });
  let schema: unknown;
  try { schema = JSON.parse(source); } catch { throw new OmpConfigError("OMP returned an invalid settings schema", 503); }
  if (!isRecord(schema)) throw new OmpConfigError("OMP returned an invalid settings schema", 503);
  return OMP_EDITABLE_KEYS.flatMap((key) => {
    const entry = schema[key];
    if (!isRecord(entry) || entry.redacted || typeof entry.type !== "string") return [];
    return [{ key, type: entry.type, value: entry.value, description: typeof entry.description === "string" ? entry.description : "", choices: OMP_SETTING_CHOICES[key] }];
  });
}

export async function readOmpSettings() {
  const path = getSettingsPath();
  const file = readOmpDocument(path);
  return { path, revision: file.revision, settings: await readOmpSettingsSchema() };
}

function validateSetting(setting: OmpSetting, value: unknown) {
  const key = setting.key;
  if (value === null) return; // reset to OMP's default
  if (setting.type === "boolean" && typeof value !== "boolean") throw new OmpConfigError(`${key} must be a boolean`);
  if (setting.type === "number" && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000000)) throw new OmpConfigError(`${key} must be a non-negative whole number`);
  if (setting.choices && (typeof value !== "string" || !setting.choices.includes(value))) throw new OmpConfigError(`Invalid ${key}`);
  if (key === "modelRoles") {
    if (!isRecord(value) || Object.entries(value).some(([role, model]) => !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(role) || typeof model !== "string" || model.length > 500 || /[\r\n\0]/.test(model))) throw new OmpConfigError("Model roles must map role names to model selectors");
  }
  if (["enabledModels", "disabledProviders"].includes(key) && (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length > 500))) throw new OmpConfigError(`${key} must be an array of strings; scoped entries must be edited in OMP`);
  if (key === "tools.approval" && (!isRecord(value) || Object.entries(value).some(([name, policy]) => !/^[\w.-]+$/.test(name) || !["allow", "prompt", "deny"].includes(policy as string)))) throw new OmpConfigError("Tool policies must map tool names to allow, prompt or deny");
}

export async function writeOmpSettings(changes: unknown, expected: string) {
  if (!isRecord(changes) || !Object.keys(changes).length) throw new OmpConfigError("Expected settings changes");
  const schema = await readOmpSettingsSchema();
  for (const [key, value] of Object.entries(changes)) {
    const setting = schema.find((s) => s.key === key);
    if (!setting) throw new OmpConfigError(`Setting is not editable: ${key}`);
    validateSetting(setting, value);
  }
  return updateOmpDocument(getSettingsPath(), expected, (doc) => {
    for (const [key, value] of Object.entries(changes)) {
      const path = key.split(".");
      // OMP accepts old dotted keys. Remove that representation when replacing
      // it, so reset cannot resurrect an earlier value.
      if (path.length > 1) doc.delete(key);
      if (value === null) doc.deleteIn(path);
      else doc.setIn(path, value);
    }
  });
}
