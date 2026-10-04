import { readOmpModelsConfig, writeOmpProvider, writeOmpProviders } from "@/lib/omp/models-config";
import { ompConfigFailure, ompConfigRequest } from "@/lib/omp/config-api";
import { disposeOmpUtility } from "@/lib/omp/omp-models";
import { isApiRequestAllowed } from "@/lib/request-security";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  try { return Response.json(readOmpModelsConfig()); } catch (error) { return ompConfigFailure(error); }
}
export async function PUT(req: Request) {
  try {
    const body = await ompConfigRequest(req);
    const saved = body.providers !== undefined
      ? await writeOmpProviders(body.providers, body.revision as string)
      : await writeOmpProvider(body.name, body.provider, body.revision as string);
    disposeOmpUtility();
    invalidateModelsCache();
    return Response.json({ ok: true, ...saved, ...readOmpModelsConfig() });
  } catch (error) { return ompConfigFailure(error); }
}
