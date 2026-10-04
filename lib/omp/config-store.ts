import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import { readRegularFileText } from "../regular-file";

export class OmpConfigError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function revision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function readOmpDocument(path: string) {
  const source = readRegularFileText(path, 1024 * 1024) ?? "";
  const doc = parseDocument(source);
  // Do not include parser diagnostics: they can quote a credential line.
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) {
    throw new OmpConfigError("The OMP configuration must be a valid YAML mapping. Repair the file before saving.", 422);
  }
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  return { source, doc, value: isRecord(value) ? value : {}, revision: revision(source) };
}

/** AST merge adapted from kahme247/ompweb (MIT). Match model arrays by id so
 * deleting/reordering a model does not attach its comments to its neighbour. */
export function mergeYamlNode(doc: Document, node: unknown, value: unknown): unknown {
  if (isMap(node) && isRecord(value)) {
    node.items = node.items.filter((pair) => isScalar(pair.key) && Object.hasOwn(value, String(pair.key.value)));
    for (const [key, next] of Object.entries(value)) {
      const pair = node.items.find((p) => isScalar(p.key) && p.key.value === key);
      if (pair) pair.value = mergeYamlNode(doc, pair.value, next);
      else node.set(key, doc.createNode(next));
    }
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    const old = [...node.items];
    node.items = value.map((item, i) => {
      const previous = isRecord(item) && typeof item.id === "string"
        ? old.find((n) => isMap(n) && n.get("id") === item.id)
        : old[i];
      return mergeYamlNode(doc, previous, item);
    }) as typeof node.items;
    return node;
  }
  if (isScalar(node) && typeof node.value === typeof value && !isRecord(value) && !Array.isArray(value)) {
    node.value = value;
    return node;
  }
  const created = doc.createNode(value);
  if (created && node && typeof node === "object") {
    const comments = node as { comment?: string | null; commentBefore?: string | null; spaceBefore?: boolean };
    Object.assign(created, { comment: comments.comment, commentBefore: comments.commentBefore, spaceBefore: comments.spaceBefore });
  }
  return created;
}

/** Locked, revision-checked, atomic writes, with owner-only adjacent backups.
 * Resolve a file symlink before replacing its target; keep the link itself. */
export async function updateOmpDocument(path: string, expected: string, edit: (doc: Document, value: Record<string, unknown>) => void) {
  mkdirSync(dirname(path), { recursive: true });
  const target = existsSync(path) ? realpathSync(path) : path;
  if (!existsSync(path)) {
    try { if (lstatSync(path).isSymbolicLink()) throw new OmpConfigError("Configuration symlink target is missing", 409); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const release = await lockfile.lock(target, { realpath: false, retries: { retries: 5, minTimeout: 30, maxTimeout: 200 } });
  let temp: string | undefined;
  try {
    const current = readOmpDocument(target);
    if (current.revision !== expected) throw new OmpConfigError("OMP configuration changed elsewhere. Reload this panel before saving.", 409);
    edit(current.doc, current.value);
    const text = current.doc.toString();
    if (text === current.source) return { revision: current.revision, backupPath: null };
    if (revision(readRegularFileText(target, 1024 * 1024) ?? "") !== expected) {
      throw new OmpConfigError("OMP configuration changed during this save. Reload before saving.", 409);
    }
    const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const backupPath = existsSync(target) ? `${target}.backup-webui-${stamp}` : null;
    if (backupPath) writeFileSync(backupPath, current.source, { flag: "wx", mode: 0o600 });
    temp = `${target}.webui-${randomUUID()}.tmp`;
    writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    renameSync(temp, target);
    return { revision: revision(text), backupPath };
  } finally {
    if (temp) rmSync(temp, { force: true });
    await release();
  }
}
