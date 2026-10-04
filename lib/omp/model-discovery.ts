import { buildModelsListUrl, parseDiscoveredModels } from "../model-discovery";
import { isRecord, OmpConfigError, readOmpDocument } from "./config-store";
import { getModelsConfigPath } from "./paths";
import { restoreModelSecrets, STORED_SECRET } from "./models-config";
import { hasJsonContentType, isApiRequestAllowed } from "../request-security";

function resolveReference(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new OmpConfigError("Credential and header values must be text");
  if (value.startsWith("!")) throw new OmpConfigError("Command credentials are evaluated only by OMP. Use an environment variable or a key for endpoint discovery.");
  if (/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    if (!process.env[value]) throw new OmpConfigError("A configured environment variable is not set on this device");
    return process.env[value];
  }
  return value;
}

export async function discoverOmpModels(req: Request) {
  if (!isApiRequestAllowed(req)) throw new OmpConfigError("Untrusted API request", 403);
  if (!hasJsonContentType(req)) throw new OmpConfigError("Content-Type must be application/json", 415);
  const text = await req.text();
  if (text.length > 1024 * 1024) throw new OmpConfigError("Request is too large", 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new OmpConfigError("Invalid JSON body"); }
  if (!isRecord(body) || typeof body.providerName !== "string" || !isRecord(body.provider)) throw new OmpConfigError("Provider name and configuration are required");
  const stored = readOmpDocument(getModelsConfigPath()).value.providers;
  const original = isRecord(stored) ? stored[body.providerName] : undefined;
  const provider = restoreModelSecrets(body.provider, original) as Record<string, unknown>;
  // Never forward a masked stored key to a newly edited endpoint.
  if (JSON.stringify(body.provider).includes(STORED_SECRET) && (!isRecord(original) || provider.baseUrl !== original.baseUrl || provider.api !== original.api)) throw new OmpConfigError("Save the changed endpoint before using its stored credentials for discovery");
  if (typeof provider.baseUrl !== "string" || !provider.baseUrl.trim()) throw new OmpConfigError("Base URL is required");
  const api = typeof provider.api === "string" ? provider.api : "openai-completions";
  let endpoint: URL;
  try { endpoint = buildModelsListUrl(provider.baseUrl, api); } catch { throw new OmpConfigError("Invalid Base URL"); }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new OmpConfigError("Use an HTTP(S) endpoint without embedded credentials");
  const headers = new Headers({ Accept: "application/json" });
  if (isRecord(provider.headers)) for (const [name, value] of Object.entries(provider.headers)) {
    const resolved = resolveReference(value); if (resolved !== undefined) headers.set(name, resolved);
  }
  const key = provider.auth === "none" ? undefined : resolveReference(provider.apiKey);
  if (key) {
    const name = api === "anthropic-messages" ? "x-api-key" : api === "google-generative-ai" ? "x-goog-api-key" : "authorization";
    if (!headers.has(name)) headers.set(name, name === "authorization" ? `Bearer ${key}` : key);
  }
  if (api === "anthropic-messages" && !headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  let response: Response;
  try { response = await fetch(endpoint, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]) }); }
  catch { throw new OmpConfigError("Could not reach the model endpoint. Check its address and that the server is running.", 502); }
  if (!response.ok) throw new OmpConfigError(`Model endpoint returned HTTP ${response.status}`, 502);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new OmpConfigError("Model endpoint returned invalid JSON", 502); }
  const models = parseDiscoveredModels(payload);
  if (!models.length) throw new OmpConfigError("No models found at this endpoint", 502);
  // Do not return an authenticated URL or upstream error bodies to the browser.
  return { models, endpoint: `${endpoint.origin}${endpoint.pathname}`, requestedModel: isRecord(body.model) ? body.model.id : undefined };
}
