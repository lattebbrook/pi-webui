import { getModelsConfigPath } from "./paths";
import { isRecord, mergeYamlNode, OmpConfigError, readOmpDocument, updateOmpDocument } from "./config-store";

export const STORED_SECRET = "<stored: unchanged>";
const SECRET_KEY = /api.?key|token|secret|password|authorization|credential/i;

/** No key evaluation: !commands and environment references stay server-side. */
export function redactModelSecrets(value: unknown, privateField = false): unknown {
  if (typeof value === "string") {
    let privateUrl = false;
    try {
      const url = new URL(value);
      privateUrl = Boolean(url.username || url.password) || [...url.searchParams.keys()].some((key) => SECRET_KEY.test(key));
    } catch { /* Most config strings are not URLs. */ }
    return privateField || privateUrl ? STORED_SECRET : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactModelSecrets(v, privateField));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactModelSecrets(v, privateField || SECRET_KEY.test(k) || k === "headers")]));
  return value;
}

export function restoreModelSecrets(value: unknown, original: unknown): unknown {
  if (value === STORED_SECRET) {
    if (typeof original !== "string") throw new OmpConfigError("A stored credential cannot be moved to a new field. Enter a credential reference for that field.");
    return original;
  }
  if (Array.isArray(value)) return value.map((item, i) => {
    const old = Array.isArray(original) ? original : [];
    const match = isRecord(item) && typeof item.id === "string" ? old.find((v) => isRecord(v) && v.id === item.id) : old[i];
    return restoreModelSecrets(item, match);
  });
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreModelSecrets(v, isRecord(original) ? original[k] : undefined)]));
  return value;
}

export function validateOmpProvider(value: unknown) {
  if (!isRecord(value)) throw new OmpConfigError("Provider must be an object");
  for (const key of ["baseUrl", "api", "apiKey", "auth"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new OmpConfigError(`${key} must be text`);
  }
  if (value.auth !== undefined && !["none", "apiKey", "oauth"].includes(value.auth as string)) throw new OmpConfigError("Invalid provider auth mode");
  if (value.models !== undefined && !Array.isArray(value.models)) throw new OmpConfigError("Models must be an array");
  const models = Array.isArray(value.models) ? value.models : [];
  if (models.length && !value.baseUrl) throw new OmpConfigError("Custom models require a base URL");
  if (models.length && !value.apiKey && value.auth !== "none" && value.auth !== "oauth") throw new OmpConfigError("Set an API key/reference, or use auth: none for a local unauthenticated server");
  const ids = new Set<string>();
  for (const model of models) {
    if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim() || ids.has(model.id)) throw new OmpConfigError("Each model needs a unique id");
    ids.add(model.id);
    if (typeof (model.api ?? value.api) !== "string" || !(model.api ?? value.api)) throw new OmpConfigError("Each model needs an API at model or provider level");
    for (const key of ["contextWindow", "maxTokens"]) {
      if (model[key] !== undefined && (typeof model[key] !== "number" || !Number.isSafeInteger(model[key]) || (model[key] as number) <= 0)) throw new OmpConfigError(`${key} must be a positive whole number`);
    }
    if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") throw new OmpConfigError("reasoning must be a boolean");
    if (model.input !== undefined && (!Array.isArray(model.input) || !model.input.length || model.input.some((s) => !["text", "image"].includes(s)))) throw new OmpConfigError("Model input must list text and/or image");
    if (model.cost !== undefined && (!isRecord(model.cost) || ["input", "output", "cacheRead", "cacheWrite"].some((k) => typeof (model.cost as Record<string, unknown>)[k] !== "number" || !Number.isFinite((model.cost as Record<string, unknown>)[k])))) throw new OmpConfigError("Costs require input, output, cacheRead and cacheWrite numbers");
  }
}

export function readOmpModelsConfig() {
  const path = getModelsConfigPath();
  const file = readOmpDocument(path);
  if (file.value.providers !== undefined && !isRecord(file.value.providers)) throw new OmpConfigError("OMP providers must be a mapping", 422);
  if (isRecord(file.value.providers) && Object.values(file.value.providers).some((provider) => !isRecord(provider))) throw new OmpConfigError("Each OMP provider must be a mapping", 422);
  return { path, revision: file.revision, providers: redactModelSecrets(file.value.providers ?? {}) as Record<string, Record<string, unknown>> };
}

export async function writeOmpProvider(name: unknown, provider: unknown, expected: string) {
  if (typeof name !== "string" || !/^[\w.-]{1,100}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new OmpConfigError("Invalid provider name");
  return updateOmpDocument(getModelsConfigPath(), expected, (doc, value) => {
    if (value.providers !== undefined && !isRecord(value.providers)) throw new OmpConfigError("OMP providers must be a mapping", 422);
    const providers = isRecord(value.providers) ? value.providers : {};
    if (provider === null) { doc.deleteIn(["providers", name]); return; }
    const restored = restoreModelSecrets(provider, providers[name]);
    validateOmpProvider(restored);
    const merged = mergeYamlNode(doc, doc.getIn(["providers", name], true), restored);
    doc.setIn(["providers", name], merged);
  });
}

/** One revision and atomic write for the complete editor draft. */
export async function writeOmpProviders(next: unknown, expected: string) {
  if (!isRecord(next)) throw new OmpConfigError("Providers must be a mapping");
  return updateOmpDocument(getModelsConfigPath(), expected, (doc, value) => {
    const old = isRecord(value.providers) ? value.providers : {};
    const restored: Record<string, unknown> = {};
    for (const [name, provider] of Object.entries(next)) {
      if (!/^[\w.-]{1,100}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new OmpConfigError("Invalid provider name");
      restored[name] = restoreModelSecrets(provider, old[name]);
      validateOmpProvider(restored[name]);
    }
    doc.set("providers", mergeYamlNode(doc, doc.get("providers", true), restored));
  });
}
