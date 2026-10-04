import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Isolate both agent dirs before the modules read them.
const root = mkdtempSync(join(tmpdir(), "pi-webui-omp-sessions-"));
process.env.PI_WEBUI_OMP_AGENT_DIR = join(root, "omp-agent");
process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const omp = await jiti.import("./omp-sessions.ts");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");

test.after(() => rmSync(root, { recursive: true, force: true }));

const sessionId = "01a1aaaa-0000-7000-8000-000000000001";
const project = join(process.env.PI_WEBUI_OMP_AGENT_DIR, "sessions", "-project");
const file = join(project, `2026-10-04T00-00-00-000Z_${sessionId}.jsonl`);
const blobHash = "a".repeat(64);

function writeSession() {
  mkdirSync(project, { recursive: true });
  mkdirSync(join(process.env.PI_WEBUI_OMP_AGENT_DIR, "blobs"), { recursive: true });
  writeFileSync(join(process.env.PI_WEBUI_OMP_AGENT_DIR, "blobs", blobHash), Buffer.from("PNGDATA"));
  const lines = [
    { type: "title", v: 1, title: "Fix the build", source: "auto", updatedAt: "2026-10-04T00:00:05.000Z", pad: "   " },
    { type: "session", version: 3, id: sessionId, timestamp: "2026-10-04T00:00:00.000Z", cwd: "/project" },
    { type: "model_change", id: "m1", parentId: null, timestamp: "2026-10-04T00:00:00.100Z", model: "splash/unsloth/Qwen" },
    { type: "message", id: "u1", parentId: "m1", timestamp: "2026-10-04T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "why is the build red?" }, { type: "image", data: `blob:sha256:${blobHash}`, mimeType: "image/png" }], timestamp: 1 } },
    { type: "title_change", id: "t1", parentId: "u1", timestamp: "2026-10-04T00:00:02.000Z", title: "Fix the build" },
    { type: "message", id: "a1", parentId: "t1", timestamp: "2026-10-04T00:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "A missing import." }], provider: "splash", model: "unsloth/Qwen", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 } },
  ];
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

test("omp-only lines become what pi reads", () => {
  assert.equal(omp.toPiLine(JSON.stringify({ type: "title", title: "x" })), null);
  assert.deepEqual(JSON.parse(omp.toPiLine(JSON.stringify({ type: "title_change", id: "t", parentId: "p", timestamp: "now", title: "New name" }))), {
    type: "session_info", id: "t", parentId: "p", timestamp: "now", name: "New name",
  });
  const model = JSON.parse(omp.toPiLine(JSON.stringify({ type: "model_change", id: "m", parentId: null, model: "lm-studio/google/gemma" })));
  assert.equal(model.provider, "lm-studio");
  assert.equal(model.modelId, "google/gemma");
  const plain = JSON.stringify({ type: "message", id: "x", message: { role: "user", content: "hi" } });
  assert.equal(omp.toPiLine(plain), plain, "ordinary lines pass through untouched");
});

test("a shadow opens in pi's SessionManager with the tree, title and images intact; the source is never touched", () => {
  writeSession();
  const before = readFileSync(file, "utf8");
  const mtime = statSync(file).mtimeMs;

  assert.equal(omp.isOmpSessionPath(file), true);
  assert.equal(omp.readOmpSessionHeader(file)?.title, "Fix the build");
  const shadow = omp.ensureOmpShadow(file);
  assert.equal(omp.isOmpSessionPath(shadow), false);

  const sm = SessionManager.open(shadow, undefined);
  const entries = sm.getEntries();
  assert.deepEqual(entries.map((entry) => entry.type), ["model_change", "message", "session_info", "message"]);
  assert.equal(sm.getSessionName(), "Fix the build");
  const image = entries[1].message.content[1];
  assert.equal(image.data, Buffer.from("PNGDATA").toString("base64"), "blob refs are inlined");
  assert.equal(entries[3].parentId, "t1", "the rename keeps its place in the id/parentId chain");

  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(statSync(file).mtimeMs, mtime);
});

test("a shadow is rebuilt after omp appends to the source", () => {
  writeSession();
  const first = omp.ensureOmpShadow(file);
  writeFileSync(file, `${readFileSync(file, "utf8")}${JSON.stringify({ type: "message", id: "u2", parentId: "a1", timestamp: "2026-10-04T00:00:04.000Z", message: { role: "user", content: [{ type: "text", text: "thanks" }], timestamp: 3 } })}\n`);
  const second = omp.ensureOmpShadow(file);
  assert.equal(second, first, "one shadow per source path");
  assert.equal(SessionManager.open(second, undefined).getEntries().filter((entry) => entry.type === "message").length, 3);
});

test("omp sessions are listed and found by id", async () => {
  writeSession();
  const sessions = await omp.listOmpSessions();
  assert.equal(sessions.length, 1);
  assert.deepEqual(
    { id: sessions[0].id, cwd: sessions[0].cwd, name: sessions[0].name, runtime: sessions[0].runtime, firstMessage: sessions[0].firstMessage },
    { id: sessionId, cwd: "/project", name: "Fix the build", runtime: "omp", firstMessage: "why is the build red?" },
  );
  assert.equal(await omp.findOmpSessionPathById(sessionId), file);
  assert.equal(await omp.findOmpSessionPathById("01a1aaaa-0000-7000-8000-00000000dead"), null);
  assert.equal(await omp.findOmpSessionPathById("../escape"), null);
});
