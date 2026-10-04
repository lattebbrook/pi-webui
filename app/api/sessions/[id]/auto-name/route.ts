import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { getPiRpcSession, getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { isOmpSessionPath, scanOmpSession } from "@/lib/omp/omp-sessions";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // omp titles its own sessions (the title slot); return that, or derive one
    // from the first message and set it through omp, never by editing omp's file.
    if (isOmpSessionPath(filePath)) {
      const live = getRpcSession(id);
      const stored = scanOmpSession(filePath);
      let title = stored?.name?.trim() ?? "";
      if (!title) {
        title = (stored?.firstMessage && stored.firstMessage !== "(no messages)" ? stored.firstMessage : "")
          .split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim().slice(0, 80);
        if (!title) {
          return NextResponse.json({ error: "The session has no user messages to name" }, { status: 409 });
        }
        const { session: omp } = live?.isAlive() ? { session: live } : await startRpcSession(id, filePath, undefined);
        await omp.send({ type: "set_session_name", name: title });
      }
      invalidateSessionListCache();
      return NextResponse.json({ title, usage: null });
    }

    const existing = getPiRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined) as { session: AgentSessionWrapper };

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();
    const result = await generateSessionTitle(session.inner as unknown as AgentSession);

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
