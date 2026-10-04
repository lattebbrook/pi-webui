import { NextResponse } from "next/server";
import { getOmpVersion, resolveOmpBin } from "@/lib/omp/omp-cli";

export const dynamic = "force-dynamic";

/**
 * GET /api/runtime — which agents this server can drive. omp is the default
 * when its binary is installed; pi (bundled) is always available.
 */
export async function GET() {
  const ompBin = resolveOmpBin();
  const ompVersion = ompBin ? await getOmpVersion().catch(() => null) : null;
  return NextResponse.json({
    available: { pi: true, omp: Boolean(ompBin) },
    versions: { omp: ompVersion, pi: process.env.NEXT_PUBLIC_PI_VERSION ?? null },
    default: ompBin ? "omp" : "pi",
  });
}
