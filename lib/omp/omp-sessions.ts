// omp (oh-my-pi) session files, read through pi's own reader.
//
// omp writes the same v3 JSONL layout as pi with a few additions: a fixed-width
// `{"type":"title"}` slot before the header, `title_change` entries, model
// changes recorded as one "provider/id" string, and images moved into a
// content-addressed blob store ("blob:sha256:<hex>"). pi's SessionManager
// rejects the title slot, so every omp file is read through a *shadow*: a
// sanitized copy under ~/.pi/agent/pi-webui/omp-shadow, rebuilt whenever the
// source changes. The shadow is read-only by contract; omp's real file is only
// ever changed by omp itself (lib/omp/omp-session.ts talks to it over RPC).

import { createHash } from "crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync, type Stats } from "fs";
import { readdir } from "fs/promises";
import { basename, isAbsolute, join, relative, resolve as resolvePath, sep } from "path";
import { getAgentDir as getPiAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionHeader, SessionInfo } from "../types";
import { getBlobsDir, getSessionsDir as getOmpSessionsDir } from "./paths";

export { getOmpSessionsDir };

const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const HEADER_PROBE_BYTES = 64 * 1024 + 512;
const BLOB_PREFIX = "blob:sha256:";
const BLOB_HASH_RE = /^[a-f0-9]{64}$/;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `filePath` lives inside omp's sessions directory. */
export function isOmpSessionPath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  const rel = relative(resolvePath(getOmpSessionsDir()), resolvePath(filePath));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ============================================================================
// Header + title slot
// ============================================================================

function readHead(filePath: string): string {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(HEADER_PROBE_BYTES);
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Session header of an omp file, with the title slot folded in as `title`. */
export function readOmpSessionHeader(filePath: string): (SessionHeader & { title?: string }) | null {
  let head: string;
  try {
    head = readHead(filePath);
  } catch {
    return null;
  }
  let title: string | undefined;
  for (const line of head.split("\n").slice(0, 2)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    if (parsed.type === "title") {
      if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();
      continue;
    }
    if (parsed.type !== "session") return null;
    return { ...(parsed as unknown as SessionHeader), ...(title ? { title } : {}) };
  }
  return null;
}

// ============================================================================
// Shadow copies
// ============================================================================

function shadowDir(): string {
  return join(getPiAgentDir(), "pi-webui", "omp-shadow");
}

function fingerprint(stats: Stats): string {
  return `${stats.size}:${stats.mtimeMs}:${stats.ino}`;
}

function resolveBlob(data: string): Buffer | null {
  if (!data.startsWith(BLOB_PREFIX)) return null;
  const hash = data.slice(BLOB_PREFIX.length);
  if (!BLOB_HASH_RE.test(hash)) return null;
  try {
    return readFileSync(join(getBlobsDir(), hash));
  } catch {
    return null;
  }
}

/** Inline omp's blob-store images (ported from ompweb's resolveBlobsInValue). */
function inlineBlobs(value: unknown, key?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) inlineBlobs(item, key);
    return;
  }
  if (!isRecord(value)) return;
  const isImage = typeof value.data === "string"
    && (value.type === "image" || (typeof value.mimeType === "string" && value.mimeType.startsWith("image/")));
  if (isImage && (key === "content" || key === "images") && (value.data as string).startsWith(BLOB_PREFIX)) {
    const blob = resolveBlob(value.data as string);
    if (blob) {
      value.data = blob.toString("base64");
    } else {
      value.type = "text";
      value.text = "[image unavailable: blob not found]";
      delete value.data;
      delete value.mimeType;
    }
    return;
  }
  if (typeof value.image_url === "string" && value.image_url.startsWith(BLOB_PREFIX)) {
    const blob = resolveBlob(value.image_url);
    if (blob) value.image_url = blob.toString("utf8");
  }
  for (const [childKey, child] of Object.entries(value)) inlineBlobs(child, childKey);
}

/** One omp JSONL line as pi reads it, or null to drop it. */
export function toPiLine(line: string): string | null {
  if (!line.trim()) return null;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(entry)) return null;
  switch (entry.type) {
    case "title":
      return null;
    case "title_change":
      // Keep the entry (and its place in the id/parentId tree) as pi's rename entry.
      return JSON.stringify({
        type: "session_info",
        id: entry.id,
        parentId: entry.parentId ?? null,
        timestamp: entry.timestamp,
        name: typeof entry.title === "string" ? entry.title : "",
      });
    case "model_change":
      if (typeof entry.model === "string" && typeof entry.provider !== "string") {
        const slash = entry.model.indexOf("/");
        if (slash > 0) {
          entry.provider = entry.model.slice(0, slash);
          entry.modelId = entry.model.slice(slash + 1);
        } else {
          entry.modelId = entry.model;
        }
      }
      return JSON.stringify(entry);
    default:
      if (line.includes(BLOB_PREFIX)) {
        inlineBlobs(entry);
        return JSON.stringify(entry);
      }
      return line;
  }
}

declare global {
  var __piWebuiOmpShadows: Map<string, string> | undefined;
}

/**
 * Path of a pi-readable copy of an omp session, rebuilt when the source changed.
 * Throws when the source is missing or is not an omp session.
 */
export function ensureOmpShadow(filePath: string): string {
  const stats = statSync(filePath);
  const fp = fingerprint(stats);
  const id = createHash("sha1").update(resolvePath(filePath)).digest("hex").slice(0, 20);
  const dir = shadowDir();
  const target = join(dir, `${id}.jsonl`);
  const memo = (globalThis.__piWebuiOmpShadows ??= new Map());
  if (memo.get(target) === fp && existsSync(target)) return target;

  const marker = `${target}.fp`;
  try {
    if (readFileSync(marker, "utf8") === fp && existsSync(target)) {
      memo.set(target, fp);
      return target;
    }
  } catch {
    // no marker yet
  }

  const source = readFileSync(filePath, "utf8");
  const out: string[] = [];
  let sawHeader = false;
  let title: string | undefined;
  for (const line of source.split("\n")) {
    if (!sawHeader) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRecord(parsed) && parsed.type === "title") {
        if (typeof parsed.title === "string") title = parsed.title;
        continue;
      }
      if (!isRecord(parsed) || parsed.type !== "session") throw new Error(`Not an omp session file: ${filePath}`);
      sawHeader = true;
      out.push(JSON.stringify({ ...parsed, ...(title ? { title } : {}) }));
      continue;
    }
    const converted = toPiLine(line);
    if (converted !== null) out.push(converted);
  }
  if (!sawHeader) throw new Error(`Not an omp session file: ${filePath}`);

  mkdirSync(dir, { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${out.join("\n")}\n`);
  renameSync(tmp, target);
  writeFileSync(marker, fp);
  memo.set(target, fp);
  return target;
}

// ============================================================================
// Listing + lookup
// ============================================================================

interface ListCacheEntry {
  fp: string;
  info: SessionInfo;
}

declare global {
  var __piWebuiOmpListCache: Map<string, ListCacheEntry> | undefined;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Sidebar metadata for one omp session file, or null when it is not one. */
export function scanOmpSession(filePath: string, stats = statSync(filePath)): SessionInfo | null {
  const cache = (globalThis.__piWebuiOmpListCache ??= new Map());
  const fp = fingerprint(stats);
  const hit = cache.get(filePath);
  if (hit?.fp === fp) return hit.info;

  let header: Json | null = null;
  let title: string | undefined;
  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  let lastActivity = 0;
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  for (const line of source.split("\n")) {
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (!header) {
      if (entry.type === "title") {
        if (typeof entry.title === "string" && entry.title.trim()) title = entry.title.trim();
        continue;
      }
      if (entry.type !== "session") return null;
      header = entry;
      continue;
    }
    if (entry.type === "title_change" && typeof entry.title === "string" && entry.title.trim()) name = entry.title.trim();
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    messageCount++;
    const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    if (Number.isFinite(timestamp)) lastActivity = Math.max(lastActivity, timestamp);
    if (!firstMessage && entry.message.role === "user") firstMessage = textOf(entry.message.content);
  }
  if (!header || typeof header.id !== "string") return null;

  const created = typeof header.timestamp === "string" ? header.timestamp : new Date(stats.birthtimeMs).toISOString();
  const info: SessionInfo = {
    path: filePath,
    id: header.id,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    ...(title ?? name ? { name: title ?? name } : {}),
    created,
    modified: new Date(Math.max(lastActivity, Date.parse(created) || 0) || stats.mtimeMs).toISOString(),
    messageCount,
    firstMessage: firstMessage || "(no messages)",
    transient: false,
    runtime: "omp",
  };
  cache.set(filePath, { fp, info });
  return info;
}

/** Every top-level omp session (subagent transcripts in artifact folders are skipped). */
export async function listOmpSessions(): Promise<SessionInfo[]> {
  const root = getOmpSessionsDir();
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const sessions: SessionInfo[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    let files;
    try {
      files = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const filePath = join(dir, file.name);
      try {
        const info = scanOmpSession(filePath);
        if (info) sessions.push(info);
      } catch {
        // unreadable or vanished mid-scan: skip
      }
    }
  }
  return sessions;
}

/** Find an omp session file by id (file names end in `_<id>.jsonl`). */
export async function findOmpSessionPathById(sessionId: string): Promise<string | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;
  const root = getOmpSessionsDir();
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const suffix = `_${sessionId}.jsonl`;
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(root, project.name);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(suffix)) continue;
      const candidate = join(dir, file);
      if (readOmpSessionHeader(candidate)?.id === sessionId) return candidate;
    }
  }
  return null;
}

/** Display name for a shadow path's source, for error messages. */
export function ompSessionLabel(filePath: string): string {
  return basename(filePath, ".jsonl");
}
