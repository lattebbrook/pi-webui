import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { cancelBtw, listBtwRecords, startBtw } from "@/lib/btw-service";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { getOmpSession, OmpSessionWrapper } from "@/lib/omp/omp-session";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/btw/[id] — this session's side questions, newest first. Never starts the session. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  // omp answers /btw natively; its records live on the omp session.
  const omp = getOmpSession(id);
  return NextResponse.json({ records: omp ? omp.listBtw() : listBtwRecords(id) });
}

/**
 * POST /api/btw/[id] { question, recordId? } — ask a side question (or follow up on
 * `recordId`). Answers with the record at once; the answer streams into it (poll GET).
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { question?: unknown; recordId?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (body.recordId !== undefined && typeof body.recordId !== "string") {
    return NextResponse.json({ error: "recordId must be a string" }, { status: 400 });
  }
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const existing = getRpcSession(id);
    const { session } = existing?.isAlive() ? { session: existing } : await startRpcSession(id, filePath, undefined);
    await session.waitUntilReady?.();
    const record = session instanceof OmpSessionWrapper
      ? await session.askBtw(body.question, body.recordId)
      : startBtw(id, session.inner as unknown as AgentSession, body.question, body.recordId);
    return NextResponse.json({ record }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

/** DELETE /api/btw/[id]?recordId= — cancel a running answer. */
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const recordId = new URL(req.url).searchParams.get("recordId");
  if (!recordId) return NextResponse.json({ error: "recordId is required" }, { status: 400 });
  const omp = getOmpSession(id);
  return NextResponse.json({ cancelled: omp ? await omp.cancelBtw(recordId) : cancelBtw(id, recordId) });
}
