import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("persisted OMP projects are accessible without selecting their directory again", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-webui-omp-access-")));
  const previousPiDir = process.env.PI_CODING_AGENT_DIR;
  const previousOmpDir = process.env.PI_WEBUI_OMP_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  process.env.PI_WEBUI_OMP_AGENT_DIR = join(root, "omp-agent");
  t.after(() => {
    if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousPiDir;
    if (previousOmpDir === undefined) delete process.env.PI_WEBUI_OMP_AGENT_DIR;
    else process.env.PI_WEBUI_OMP_AGENT_DIR = previousOmpDir;
    delete globalThis.__piAllowedRootsCache;
    delete globalThis.__piAdditionalAllowedRoots;
    rmSync(root, { recursive: true, force: true });
  });

  const cwd = join(root, "omp-project");
  const outside = join(root, "outside");
  const sessions = join(process.env.PI_WEBUI_OMP_AGENT_DIR, "sessions", "-project");
  mkdirSync(cwd);
  mkdirSync(outside);
  mkdirSync(sessions, { recursive: true });
  const id = "01a1aaaa-0000-7000-8000-000000000001";
  writeFileSync(join(sessions, `2026-10-04T00-00-00-000Z_${id}.jsonl`),
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-04T00:00:00.000Z", cwd }) + "\n");
  symlinkSync(outside, join(cwd, "outside-link"), process.platform === "win32" ? "junction" : "dir");

  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const { getAllowedFileRoots, isExistingFilePathAllowed } = await jiti.import("./file-access.ts");
  const { validateMcpProject } = await jiti.import("./mcp-entry-request.ts");
  delete globalThis.__piAllowedRootsCache;
  delete globalThis.__piAdditionalAllowedRoots;
  const roots = await getAllowedFileRoots();
  assert.equal(isExistingFilePathAllowed(cwd, roots), true);
  assert.equal(isExistingFilePathAllowed(outside, roots), false);
  assert.equal(isExistingFilePathAllowed(join(cwd, "outside-link"), roots), false);
  assert.equal((await validateMcpProject(cwd)).cwd, cwd);
  assert.equal((await validateMcpProject(outside)).body.reason, "cwd-denied");
});
