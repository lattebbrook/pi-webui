import { discoverOmpModels } from "@/lib/omp/model-discovery";
import { ompConfigFailure } from "@/lib/omp/config-api";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try { const { models, endpoint } = await discoverOmpModels(req); return Response.json({ models, endpoint }); }
  catch (error) { return ompConfigFailure(error); }
}
