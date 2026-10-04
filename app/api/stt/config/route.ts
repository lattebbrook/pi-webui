import { NextResponse } from "next/server";
import { readSttConfig } from "@/lib/stt";

export const dynamic = "force-dynamic";

/** GET /api/stt/config — whether voice dictation is configured (PI_WEBUI_STT_ENDPOINT). Never returns the key. */
export async function GET() {
  return NextResponse.json({ enabled: readSttConfig() !== null });
}
