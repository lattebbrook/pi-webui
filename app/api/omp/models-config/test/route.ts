import { discoverOmpModels } from "@/lib/omp/model-discovery";
import { ompConfigFailure } from "@/lib/omp/config-api";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const started = Date.now();
  try {
    const { models, requestedModel } = await discoverOmpModels(req);
    const found = models.some((model) => model.id === requestedModel);
    return Response.json({ ok: found, latencyMs: Date.now() - started, ...(found ? { responseText: "Endpoint lists this model. Inference has not been tested." } : { error: "Endpoint does not list this model ID" }) });
  } catch (error) { return ompConfigFailure(error); }
}
