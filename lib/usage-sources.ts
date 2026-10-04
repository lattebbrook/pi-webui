// pi-side sources for the usage dashboard (ported from ompweb's lib/omp/*,
// MIT, kahme247/ompweb). Same on-disk shape as omp: `<agentDir>/sessions/<project>/*.jsonl`,
// with subagent transcripts in a sibling directory named after the session file.

import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, type Dirent } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseJsonc } from "./jsonc";

export { getAgentDir };

const READ_CHUNK_BYTES = 1024 * 1024;

export interface UsageSessionHeader {
  type: "session";
  id: string;
  cwd: string;
  timestamp: string;
}

/** `models.json` providers; only `models[].id` and `models[].cost` matter for usage pricing. */
export interface ModelsFileConfig {
  providers?: Record<string, {
    models?: { id: string; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }[];
    modelOverrides?: Record<string, { cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

/** pi's custom model config; an unreadable or invalid file prices nothing. */
export function readModelsConfig(): ModelsFileConfig {
  try {
    const parsed = parseJsonc(readFileSync(join(getAgentDir(), "models.json"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ModelsFileConfig) : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

/** Line-by-line read over a byte buffer, so very large transcripts never become one JS string. */
export function forEachFileLineSync(filePath: string, onLine: (line: string) => void): void {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    const decoder = new StringDecoder("utf8");
    const fragments: string[] = [];
    let pending = false;
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      let start = 0;
      while (start < bytesRead) {
        const newline = buffer.indexOf(10, start);
        const end = newline >= 0 && newline < bytesRead ? newline : bytesRead;
        fragments.push(decoder.write(buffer.subarray(start, end)));
        pending = true;
        if (end < bytesRead) {
          fragments.push(decoder.end());
          onLine(fragments.join(""));
          fragments.length = 0;
          pending = false;
        }
        start = end + 1;
      }
    }
    if (pending) {
      fragments.push(decoder.end());
      onLine(fragments.join(""));
    }
  } finally {
    closeSync(fd);
  }
}

/** First-line session header, read without loading the transcript. */
export function readSessionHeaderSync(filePath: string): UsageSessionHeader | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  let head: string;
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    head = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
  } finally {
    closeSync(fd);
  }
  const end = head.indexOf("\n");
  try {
    const header = JSON.parse((end === -1 ? head : head.slice(0, end)).trim()) as UsageSessionHeader;
    return header?.type === "session" ? header : null;
  } catch {
    return null;
  }
}

declare global {
  var __piUsageSessionFileList: { key: string; files: string[] } | undefined;
}

export function invalidateSessionFileListCache(): void {
  globalThis.__piUsageSessionFileList = undefined;
}

/** Top-level session transcripts: `<sessionsRoot>/<project>/*.jsonl`. Cached on root + project dir mtimes. */
export async function listSessionFiles(sessionsRoot: string): Promise<string[]> {
  let projects: Dirent[];
  try {
    projects = readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = projects.filter((d) => d.isDirectory()).map((d) => join(sessionsRoot, d.name));
  let key = `${sessionsRoot}:${statSync(sessionsRoot).mtimeMs}`;
  for (const dir of dirs) {
    try {
      key += `|${statSync(dir).mtimeMs}`;
    } catch {
      key += "|?";
    }
  }
  const cached = globalThis.__piUsageSessionFileList;
  if (cached?.key === key) return cached.files;

  const files: string[] = [];
  for (const dir of dirs) {
    try {
      for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith(".jsonl")) files.push(join(dir, file.name));
      }
    } catch {
      // unreadable project directory: skip it
    }
  }
  globalThis.__piUsageSessionFileList = { key, files };
  return files;
}

/**
 * Transcripts owned by a session: every `.jsonl` under the directory named after the
 * session file (pi-subagents children, nested runs). Each records its own model usage.
 */
export function listSessionArtifactTranscripts(sessionFile: string): string[] {
  if (!sessionFile.endsWith(".jsonl")) return [];
  const root = sessionFile.slice(0, -".jsonl".length);
  const transcripts: string[] = [];
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // A top-level `local/` is scratch space (omp's `local://`), never transcripts.
        if (dir !== root || entry.name !== "local") pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) transcripts.push(entryPath);
    }
  }
  return transcripts;
}
