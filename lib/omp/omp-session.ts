// omp (oh-my-pi) sessions for Pi WebUI.
//
// pi sessions run in-process (lib/rpc-manager.ts AgentSessionWrapper). omp is a
// Bun binary, so an omp session runs as `omp --mode rpc-ui` (lib/omp/rpc-process.ts)
// and OmpSessionWrapper presents it through the same surface the API routes and
// the SSE stream use: send(command), onEvent(listener), isAlive/isRunning,
// streamingMessage, and inner.sessionManager for reading the transcript.
//
// Frame handling follows ompweb's omp-backed wrapper (MIT, kahme247/ompweb),
// translated to the event names pi-web's browser code already handles.

import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "../models-cache";
import { invalidateSessionListCache, openSessionManager } from "../session-reader";
import type { SessionInfo } from "../types";
import { applyBtwEvent, isBtwRecord, upsertBtwRecord, type BtwRecord } from "../btw";
import { findOmpSessionPathById, scanOmpSession } from "./omp-sessions";
import { RpcCommandTimeoutError, RpcProcess, type RpcFrame } from "./rpc-process";

const READY_TIMEOUT_MS = 60_000;
const PROMPT_ACK_TIMEOUT_MS = 60_000;
const STATE_TIMEOUT_MS = 15_000;
const IDLE_SHUTDOWN_MS = 10 * 60_000;

/** Events pi-web's browser code understands; anything else omp sends stays server-side. */
const FORWARDED_EVENTS = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_compaction_start",
  "auto_compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "queue_update",
  "extension_error",
]);

/** Extension dialogs pi-web can render; omp's widget/status/title calls are dropped. */
const FORWARDED_UI_METHODS = new Set(["select", "confirm", "input", "editor", "notify"]);

const UNSUPPORTED_COMMANDS: Record<string, string> = {
  navigate_tree: "Branch navigation is not available for omp sessions",
  fork_branch: "In-session branches are not available for omp sessions; use New session from here",
  clone: "Cloning is not available for omp sessions",
  clear_queue: "Recalling queued messages is not available for omp sessions",
  set_tools: "Tools of a running omp session cannot be changed; tool presets apply to new sessions",
  extension_ui_input: "Extension custom UI is not available for omp sessions",
};

// omp names "find" glob and has no "ls"; translate pi-web's preset names for --tools.
const TOOL_NAME_ALIASES: Record<string, string> = { find: "glob", search: "grep" };
const DROPPED_TOOL_NAMES = new Set(["ls"]);

export interface OmpStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: string;
}

type Listener = (event: { type: string; [key: string]: unknown }) => void;

interface OmpState {
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  autoRetryEnabled?: boolean;
  model?: { id: string; provider: string; name?: string };
  thinkingLevel?: string;
  messageCount?: number;
  queuedMessageCount?: number;
  queuedMessages?: { steering: string[]; followUp: string[] };
  contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
  systemPrompt?: string[] | string;
  dumpTools?: Array<{ name: string; description?: string }>;
}

function spawnArgs(sessionFile: string, options: OmpStartOptions): string[] {
  if (sessionFile) return ["--resume", sessionFile];
  const args: string[] = [];
  if (options.initialModel) args.push("--model", `${options.initialModel.provider}/${options.initialModel.modelId}`);
  if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
  if (options.toolNames !== undefined) {
    if (options.toolNames.length === 0) {
      args.push("--no-tools");
    } else {
      const mapped: string[] = [];
      for (const raw of options.toolNames) {
        const name = raw.toLowerCase();
        if (DROPPED_TOOL_NAMES.has(name)) continue;
        const alias = TOOL_NAME_ALIASES[name] ?? name;
        if (!mapped.includes(alias)) mapped.push(alias);
      }
      // pi-web's "full" preset is pi's built-ins; omp's own default set is larger, so keep it.
      const piBuiltins = ["read", "bash", "edit", "write", "grep", "glob"];
      const isFullPreset = piBuiltins.every((name) => mapped.includes(name));
      if (!isFullPreset && mapped.length) args.push("--tools", mapped.join(","));
    }
  }
  return args;
}

export class OmpSessionWrapper {
  readonly runtime = "omp" as const;
  private proc!: RpcProcess;
  private listeners = new Set<Listener>();
  private alive = false;
  private ready: Promise<void>;
  private streaming = false;
  private promptRunning = false;
  private compacting = false;
  private bashRunning = false;
  private streamingAssistant: unknown = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private commandList: unknown[] = [];
  /** omp's own /btw side questions for this session, newest first (btw_record / btw_delta frames). */
  private btwRecords: BtwRecord[] = [];
  private _sessionId: string;
  private _sessionFile: string;
  private _cwd: string;

  constructor(registryKey: string, sessionFile: string, cwd: string, private readonly options: OmpStartOptions = {}) {
    this._sessionId = registryKey;
    this._sessionFile = sessionFile;
    this._cwd = cwd;
    this.ready = this.start();
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  get cwd(): string {
    return this._cwd;
  }

  get isStreaming(): boolean {
    return this.streaming;
  }

  get streamingMessage(): unknown {
    return this.streamingAssistant;
  }

  /** Read side for routes that show a live session's transcript (omp writes it to disk as it runs). */
  get inner(): { sessionManager: SessionManager } {
    const file = this._sessionFile;
    return {
      get sessionManager(): SessionManager {
        if (!file) throw new Error("This omp session has no transcript yet");
        return openSessionManager(file);
      },
    };
  }

  isAlive(): boolean {
    return this.alive && this.proc?.isAlive === true;
  }

  isRunning(): boolean {
    return this.isAlive() && (this.streaming || this.promptRunning || this.compacting || this.bashRunning);
  }

  /** pi-web asks live pi sessions whether the file moved on under them; omp owns its file. */
  evictIfDiskAhead(): boolean {
    return false;
  }

  hasSuppressedCompletionNotifications(): boolean {
    return false;
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: { type: string; [key: string]: unknown }): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // a broken subscriber must not stop the others
      }
    }
  }

  private async start(): Promise<void> {
    this.proc = new RpcProcess({
      cwd: this._cwd,
      extraArgs: spawnArgs(this._sessionFile, this.options),
      onFrame: (frame) => this.handleFrame(frame),
      onExit: () => this.handleExit(),
    });
    this.alive = true;
    const readyFrame = await this.proc.waitReady(READY_TIMEOUT_MS);
    await this.proc.negotiateProtocol(readyFrame);
    const state = await this.proc.sendCommand<OmpState>({ type: "get_state" }, STATE_TIMEOUT_MS);
    this.applyIdentity(state);
    this.resetIdleTimer();
  }

  private applyIdentity(state: OmpState | undefined): void {
    if (!state) return;
    if (state.sessionFile) this._sessionFile = state.sessionFile;
  }

  /** The id omp gave the session; for a new session it replaces the temporary registry key. */
  async realSessionId(): Promise<string> {
    await this.ready;
    const state = await this.proc.sendCommand<OmpState>({ type: "get_state" }, STATE_TIMEOUT_MS);
    this.applyIdentity(state);
    return state?.sessionId ?? this._sessionId;
  }

  rekey(sessionId: string): void {
    this._sessionId = sessionId;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning() || this.listeners.size > 0) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown();
    }, IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  private settleSessionFile(): void {
    // A new session's file lands on omp's first write; pick it up for transcript reads.
    if (this._sessionFile) return;
    void findOmpSessionPathById(this._sessionId).then((found) => {
      if (found) this._sessionFile = found;
    });
  }

  private handleFrame(frame: RpcFrame): void {
    this.resetIdleTimer();
    switch (frame.type) {
      case "agent_start":
        this.streaming = true;
        this.promptRunning = true;
        invalidateSessionListCache();
        this.settleSessionFile();
        break;
      case "agent_end":
        // A non-terminal agent_end means omp continues on its own (follow-ups, yields).
        if (frame.isTerminal === false) return;
        this.streaming = false;
        this.streamingAssistant = null;
        invalidateSessionListCache();
        break;
      case "message_start":
      case "message_update": {
        const message = frame.message as { role?: string } | undefined;
        if (message?.role === "assistant") this.streamingAssistant = message;
        break;
      }
      case "message_end":
        this.streamingAssistant = null;
        break;
      case "auto_compaction_start":
        this.compacting = true;
        break;
      case "auto_compaction_end":
        this.compacting = false;
        break;
      case "prompt_result":
        // omp's end of a prompt: after the run, or at once for a local slash command.
        this.promptRunning = false;
        this.emit({ type: "prompt_done" });
        invalidateSessionListCache();
        return;
      case "session_settled":
        this.promptRunning = false;
        this.emit({ type: "agent_settled" });
        return;
      case "btw_record":
      case "btw_delta":
        this.btwRecords = applyBtwEvent(this.btwRecords, frame);
        return;
      case "available_commands_update":
        if (Array.isArray(frame.commands)) this.commandList = frame.commands;
        return;
      case "session_info_update":
        invalidateSessionListCache();
        return;
      case "response":
        // An unsolicited failed response is how omp reports an async prompt failure.
        if (frame.success === false && (frame.command === "prompt" || (!frame.command && (this.promptRunning || this.streaming)))) {
          this.promptRunning = false;
          this.streaming = false;
          const message = typeof frame.error === "string" ? frame.error : "The prompt failed";
          this.emit({ type: "prompt_error", errorMessage: message, error: message });
          this.emit({ type: "prompt_done" });
        }
        return;
      case "extension_ui_request":
        if (FORWARDED_UI_METHODS.has(String(frame.method))) this.emit(frame);
        return;
      default:
        if (!FORWARDED_EVENTS.has(frame.type)) return;
    }
    if (FORWARDED_EVENTS.has(frame.type)) this.emit(frame);
  }

  private handleExit(): void {
    const wasRunning = this.isRunning();
    this.alive = false;
    this.streaming = false;
    this.promptRunning = false;
    this.streamingAssistant = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (wasRunning) {
      const tail = this.proc?.exitDetails?.stderrTail?.trim().split("\n").slice(-3).join("\n");
      this.emit({ type: "prompt_error", errorMessage: `omp stopped unexpectedly${tail ? `: ${tail}` : ""}` });
      this.emit({ type: "prompt_done" });
    }
    removeOmpSession(this);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (!this.isAlive()) throw new Error("The omp session is no longer running");
    this.resetIdleTimer();
    const type = String(command.type);
    const unsupported = UNSUPPORTED_COMMANDS[type];
    if (unsupported) throw new Error(unsupported);

    switch (type) {
      case "prompt": {
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        if (!streamingBehavior) this.promptRunning = true;
        try {
          const ack = await this.proc.sendCommand<{ agentInvoked?: boolean } | null>({
            type: "prompt",
            message: String(command.message ?? ""),
            ...(Array.isArray(command.images) && command.images.length ? { images: command.images } : {}),
            ...(streamingBehavior ? { streamingBehavior } : {}),
          }, PROMPT_ACK_TIMEOUT_MS);
          if (ack?.agentInvoked === false && !streamingBehavior) {
            this.promptRunning = false;
            this.emit({ type: "prompt_done" });
          }
        } catch (error) {
          this.promptRunning = false;
          if (error instanceof RpcCommandTimeoutError) {
            await this.shutdown();
            throw new Error("The omp session stopped responding and was reset.");
          }
          throw error;
        }
        this.settleSessionFile();
        return null;
      }
      case "steer":
      case "follow_up":
        await this.proc.sendCommand({
          type,
          message: String(command.message ?? ""),
          ...(Array.isArray(command.images) && command.images.length ? { images: command.images } : {}),
        });
        return null;
      case "abort":
      case "abort_compaction":
        await this.proc.sendCommand({ type: "abort" });
        this.promptRunning = false;
        return null;
      case "get_state":
        return this.webState(await this.proc.sendCommand<OmpState>({ type: "get_state" }, STATE_TIMEOUT_MS));
      case "set_model": {
        const model = await this.proc.sendCommand<{ id: string; provider: string }>({
          type: "set_model",
          provider: command.provider,
          modelId: command.modelId,
        });
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model?.id ?? command.modelId, provider: model?.provider ?? command.provider };
      }
      case "set_thinking_level":
        await this.proc.sendCommand({ type: "set_thinking_level", level: command.level });
        return null;
      case "compact": {
        this.compacting = true;
        try {
          return await this.proc.sendCommand({
            type: "compact",
            ...(command.customInstructions ? { customInstructions: command.customInstructions } : {}),
          });
        } finally {
          this.compacting = false;
          invalidateSessionListCache();
        }
      }
      case "set_session_name": {
        const name = String(command.name ?? "").trim();
        if (!name) throw new Error("Session name cannot be empty");
        await this.proc.sendCommand({ type: "set_session_name", name });
        invalidateSessionListCache();
        return null;
      }
      case "get_session_stats":
        return this.proc.sendCommand({ type: "get_session_stats" });
      case "get_last_assistant_text": {
        const data = await this.proc.sendCommand<{ text?: string | null }>({ type: "get_last_assistant_text" });
        return { text: data?.text ?? "" };
      }
      case "get_commands": {
        const data = await this.proc.sendCommand<{ commands?: unknown[] }>({ type: "get_available_commands" }).catch(() => null);
        const raw = Array.isArray(data?.commands) ? data!.commands : this.commandList;
        const commands = raw.flatMap((entry) => {
          const item = entry as { name?: unknown; description?: unknown; source?: unknown };
          if (typeof item.name !== "string") return [];
          const source = item.source === "skill" || item.source === "prompt" ? item.source : "extension";
          return [{ name: item.name.replace(/^\//, ""), description: typeof item.description === "string" ? item.description : undefined, source }];
        });
        return { commands };
      }
      case "get_tools": {
        const state = await this.proc.sendCommand<OmpState>({ type: "get_state" }, STATE_TIMEOUT_MS);
        return (state?.dumpTools ?? []).map((tool) => ({ name: tool.name, description: tool.description ?? "", active: true }));
      }
      case "set_auto_compaction":
        await this.proc.sendCommand({ type: "set_auto_compaction", enabled: command.enabled === true });
        return null;
      case "set_auto_retry":
        await this.proc.sendCommand({ type: "set_auto_retry", enabled: command.enabled === true }).catch(() => undefined);
        return null;
      case "bash": {
        this.bashRunning = true;
        try {
          return await this.proc.sendCommand({ type: "bash", command: command.command, ...(command.excludeFromContext ? { excludeFromContext: true } : {}) });
        } finally {
          this.bashRunning = false;
        }
      }
      case "abort_bash":
        await this.proc.sendCommand({ type: "abort_bash" });
        return null;
      case "extension_ui_response":
        this.proc.sendFrame(command as { type: string; [key: string]: unknown });
        return null;
      case "fork": {
        // omp's `branch` writes the fork and moves this process onto it.
        const result = await this.proc.sendCommand<{ text?: string; cancelled?: boolean }>({ type: "branch", entryId: command.entryId });
        if (result?.cancelled) return { cancelled: true };
        const previous = this._sessionId;
        const newSessionId = await this.realSessionId();
        moveOmpSession(previous, newSessionId, this);
        invalidateSessionListCache();
        return { cancelled: false, newSessionId, text: result?.text ?? "" };
      }
      case "reload":
        if (this.isRunning()) throw new Error("Wait for the OMP chat to finish before reloading its settings");
        await this.restart();
        return { success: true };
      default:
        // omp speaks pi's RPC vocabulary; pass anything else through unchanged.
        return this.proc.sendCommand(command as { type: string; [key: string]: unknown });
    }
  }

  private webState(state: OmpState) {
    this.applyIdentity(state);
    if (state?.isStreaming === false && state.isCompacting === false) {
      this.streaming = false;
      if (!this.listeners.size) this.promptRunning = false;
    }
    return {
      sessionId: state?.sessionId ?? this._sessionId,
      sessionFile: state?.sessionFile ?? this._sessionFile,
      isStreaming: state?.isStreaming ?? this.streaming,
      isPromptRunning: this.promptRunning,
      isBashRunning: this.bashRunning,
      isCompacting: state?.isCompacting ?? this.compacting,
      autoCompactionEnabled: state?.autoCompactionEnabled ?? true,
      autoRetryEnabled: state?.autoRetryEnabled ?? true,
      model: state?.model ? { id: state.model.id, provider: state.model.provider } : undefined,
      messageCount: state?.messageCount ?? 0,
      pendingMessageCount: state?.queuedMessageCount ?? 0,
      queuedMessages: state?.queuedMessages ?? { steering: [], followUp: [] },
      contextUsage: state?.contextUsage ?? null,
      systemPrompt: Array.isArray(state?.systemPrompt) ? state.systemPrompt.join("\n\n") : state?.systemPrompt ?? "",
      thinkingLevel: state?.thinkingLevel ?? "off",
      extensionStatuses: [],
      extensionWidgets: [],
      runtime: "omp" as const,
    };
  }

  private async restart(): Promise<void> {
    const file = this._sessionFile;
    await this.proc.dispose();
    this.alive = false;
    this._sessionFile = file;
    this.ready = this.start();
    await this.ready;
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.alive = false;
    removeOmpSession(this);
    await this.proc?.dispose().catch(() => undefined);
  }

  /** Side questions answered by omp itself (omp's native /btw), newest first. */
  listBtw(): BtwRecord[] {
    return this.btwRecords;
  }

  async askBtw(question: string, recordId?: string): Promise<BtwRecord> {
    const data = await this.send({ type: "btw", question, ...(recordId ? { recordId } : {}) }) as { record?: unknown } | null;
    if (!isBtwRecord(data?.record)) throw new Error("omp did not accept the side question");
    this.btwRecords = upsertBtwRecord(this.btwRecords, data.record);
    return data.record;
  }

  async cancelBtw(recordId: string): Promise<boolean> {
    const data = await this.send({ type: "btw_cancel", recordId }) as { cancelled?: boolean } | null;
    return data?.cancelled !== false;
  }

  /** Sidebar row for a live session whose file may not be on disk yet. */
  info(): SessionInfo | null {
    if (!this._sessionFile) return null;
    try {
      return scanOmpSession(this._sessionFile);
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Registry
// ============================================================================

declare global {
  var __piWebuiOmpSessions: Map<string, OmpSessionWrapper> | undefined;
  var __piWebuiOmpStarting: Map<string, Promise<{ session: OmpSessionWrapper; realSessionId: string }>> | undefined;
}

function registry(): Map<string, OmpSessionWrapper> {
  if (!globalThis.__piWebuiOmpSessions) {
    globalThis.__piWebuiOmpSessions = new Map();
    // Close omp children with the server, like lib/rpc-manager.ts does for pi sessions.
    const shutdown = () => void shutdownAllOmpSessions();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return globalThis.__piWebuiOmpSessions;
}

function starting(): Map<string, Promise<{ session: OmpSessionWrapper; realSessionId: string }>> {
  return (globalThis.__piWebuiOmpStarting ??= new Map());
}

function removeOmpSession(session: OmpSessionWrapper): void {
  const map = registry();
  for (const [key, value] of map) if (value === session) map.delete(key);
}

function moveOmpSession(from: string, to: string, session: OmpSessionWrapper): void {
  const map = registry();
  if (map.get(from) === session) map.delete(from);
  session.rekey(to);
  map.set(to, session);
}

export function getOmpSession(sessionId: string): OmpSessionWrapper | undefined {
  const session = registry().get(sessionId);
  return session?.isAlive() ? session : undefined;
}

/** Start (or reuse) an omp session. `sessionFile` empty starts a new one in `cwd`. */
export async function startOmpSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: OmpStartOptions = {},
): Promise<{ session: OmpSessionWrapper; realSessionId: string }> {
  const existing = getOmpSession(sessionId);
  if (existing) return { session: existing, realSessionId: existing.sessionId };
  const inflight = starting().get(sessionId);
  if (inflight) return inflight;

  const run = (async () => {
    let spawnCwd = cwd;
    if (sessionFile) {
      const info = scanOmpSession(sessionFile);
      spawnCwd = info?.cwd || cwd;
    }
    if (!spawnCwd) throw new Error("cwd is required for a new omp session");
    const session = new OmpSessionWrapper(sessionId, sessionFile, spawnCwd, options);
    registry().set(sessionId, session);
    try {
      await session.waitUntilReady();
    } catch (error) {
      removeOmpSession(session);
      await session.shutdown();
      throw error;
    }
    const realSessionId = await session.realSessionId();
    if (realSessionId !== sessionId) moveOmpSession(sessionId, realSessionId, session);
    return { session, realSessionId };
  })();
  starting().set(sessionId, run);
  try {
    return await run;
  } finally {
    starting().delete(sessionId);
  }
}

export function getRunningOmpSessionIds(): string[] {
  return [...registry().values()].filter((session) => session.isRunning()).map((session) => session.sessionId);
}

export function getLiveOmpSessionInfos(): SessionInfo[] {
  return [...registry().values()].flatMap((session) => {
    const info = session.isAlive() ? session.info() : null;
    return info ? [info] : [];
  });
}

export async function shutdownAllOmpSessions(): Promise<void> {
  await Promise.all([...registry().values()].map((session) => session.shutdown()));
}
