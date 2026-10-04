import { readOmpSettings, writeOmpSettings } from "@/lib/omp/settings-config";
import { ompConfigFailure, ompConfigRequest } from "@/lib/omp/config-api";
import { disposeOmpUtility } from "@/lib/omp/omp-models";
import { isApiRequestAllowed } from "@/lib/request-security";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  try { return Response.json(await readOmpSettings()); } catch (error) { return ompConfigFailure(error); }
}
export async function PUT(req: Request) {
  try {
    const body = await ompConfigRequest(req);
    const saved = await writeOmpSettings(body.changes, body.revision as string);
    disposeOmpUtility();
    invalidateModelsCache();
    return Response.json({ ok: true, ...saved, ...(await readOmpSettings()) });
  } catch (error) { return ompConfigFailure(error); }
}
