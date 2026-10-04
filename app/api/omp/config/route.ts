import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { load as parseYaml } from "js-yaml";
import { getOmpVersion, resolveOmpBin } from "@/lib/omp/omp-cli";
import { getAgentDir, getModelsConfigPath, getSessionsDir, getSettingsPath } from "@/lib/omp/paths";

export const dynamic = "force-dynamic";

function readYaml(path: string): Record<string, unknown> | null {
  try {
    const value = parseYaml(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/omp/config — a read-only summary of omp's own configuration
 * (~/.omp/agent/config.yml and models.yml). In omp mode Pi WebUI follows these;
 * change them with omp itself (`omp config`, or by editing the files).
 * Provider API keys are never returned.
 */
export async function GET() {
  const bin = resolveOmpBin();
  const settingsPath = getSettingsPath();
  const modelsPath = getModelsConfigPath();
  const settings = readYaml(settingsPath);
  const models = readYaml(modelsPath);

  const roles = settings?.modelRoles && typeof settings.modelRoles === "object"
    ? Object.entries(settings.modelRoles as Record<string, unknown>).flatMap(([role, model]) => typeof model === "string" ? [{ role, model }] : [])
    : [];
  const providers = models?.providers && typeof models.providers === "object"
    ? Object.entries(models.providers as Record<string, Record<string, unknown>>).map(([name, provider]) => ({
        name,
        baseUrl: typeof provider?.baseUrl === "string" ? provider.baseUrl : null,
        api: typeof provider?.api === "string" ? provider.api : null,
        models: Array.isArray(provider?.models) ? provider.models.length : 0,
        discovery: provider?.discovery && typeof provider.discovery === "object" ? String((provider.discovery as { type?: unknown }).type ?? "") || null : null,
      }))
    : [];

  return NextResponse.json({
    installed: Boolean(bin),
    bin,
    version: bin ? await getOmpVersion().catch(() => null) : null,
    paths: { agentDir: getAgentDir(), settings: settingsPath, models: modelsPath, sessions: getSessionsDir() },
    defaultThinkingLevel: typeof settings?.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : null,
    roles,
    providers,
  });
}
