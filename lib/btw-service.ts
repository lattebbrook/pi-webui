import { randomUUID } from "node:crypto";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { btwTurns, latestBtwTurn, type BtwRecord, type BtwTurn } from "./btw";
import { resolveTitleThinkingLevel } from "./session-title";

/**
 * Side questions (`/btw`) for pi sessions. omp answers these inside its agent
 * runtime; here the server makes one tool-free request with the session's own
 * model, credentials and transcript, so the answer sees everything the session
 * has seen but never enters it. Reusing the transcript verbatim keeps the
 * request prefix identical to the main conversation's, which lets a local
 * server (llama.cpp, LM Studio) reuse its prompt cache instead of re-reading
 * the whole session.
 *
 * Records live in memory per session id (they survive page reloads, not server
 * restarts) and the browser polls them while an answer streams.
 */

const BTW_TIMEOUT_MS = 5 * 60_000;
const BTW_MAX_TOKENS = 4096;
const MAX_RECORDS_PER_SESSION = 30;
const MAX_QUESTION_CHARS = 4000;

const SIDE_QUESTION_PREAMBLE = `[Side question from the user — answer it directly from what you already know about this session.
Do not call tools, do not continue or change the task, and keep the answer focused and concise.]`;

interface SessionBtwState {
  records: BtwRecord[];
  running: Map<string, AbortController>;
}

declare global {
  // Shared by every route bundle and kept across dev hot reloads.
  var __piWebuiBtw: Map<string, SessionBtwState> | undefined;
}

const sessions = (globalThis.__piWebuiBtw ??= new Map<string, SessionBtwState>());

function stateFor(sessionId: string): SessionBtwState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { records: [], running: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

/** Newest first, as the history and the panel expect. */
export function listBtwRecords(sessionId: string): BtwRecord[] {
  return [...(sessions.get(sessionId)?.records ?? [])].reverse();
}

export function cancelBtw(sessionId: string, recordId: string): boolean {
  const controller = sessions.get(sessionId)?.running.get(recordId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** The side question as sent: earlier turns of the same topic first, so a follow-up keeps its thread. */
function sideQuestionText(question: string, priorTurns: BtwTurn[]): string {
  const thread = priorTurns
    .filter((turn) => turn.answer.trim())
    .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
    .join("\n\n");
  return thread
    ? `${SIDE_QUESTION_PREAMBLE}\n\nEarlier in this side thread:\n\n${thread}\n\nFollow-up: ${question}`
    : `${SIDE_QUESTION_PREAMBLE}\n\n${question}`;
}

async function streamAnswer(agent: Agent, turn: BtwTurn, priorTurns: BtwTurn[], signal: AbortSignal): Promise<void> {
  // Same context the next main turn would send, minus nothing: transformContext
  // and convertToLlm are the agent's own, so system prompt + tool declarations
  // (pi keeps them as transcript system messages) and history match exactly.
  let history: AgentMessage[] = [...agent.state.messages];
  if (agent.transformContext) history = await agent.transformContext(history, signal);
  const llmMessages = await agent.convertToLlm(history);

  const model = agent.state.model;
  const thinkingLevel = resolveTitleThinkingLevel(model);
  const apiKey = await agent.getApiKey?.(model.provider);
  const options: SimpleStreamOptions = {
    maxTokens: BTW_MAX_TOKENS,
    sessionId: randomUUID(),
    signal,
    ...(apiKey ? { apiKey } : {}),
    ...(thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {}),
  };
  const context = normalizeContext({
    messages: [
      ...llmMessages,
      { role: "user", content: [{ type: "text", text: sideQuestionText(turn.question, priorTurns) }], timestamp: Date.now() },
    ],
  });

  const stream = await agent.streamFunction(model, context, options);
  for await (const event of stream) {
    if (event.type === "text_delta") {
      turn.answer += event.delta;
      turn.updatedAt = Date.now();
    } else if (event.type === "toolcall_start") {
      // The model reached for a tool despite the instruction: stop here and keep the text so far.
      break;
    }
  }
  const final = await stream.result().catch(() => null);
  if (final?.stopReason === "error") throw new Error(final.errorMessage || "The model request failed");
  if (!turn.answer.trim()) {
    const text = final?.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") ?? "";
    turn.answer = text;
  }
}

/**
 * Starts a side question (or a follow-up on `recordId`'s topic) and returns the
 * record at once; the answer streams into it. Throws when the topic is busy.
 */
export function startBtw(sessionId: string, session: AgentSession, question: string, recordId?: string): BtwRecord {
  const text = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (!text) throw new Error("A side question needs some text");
  const state = stateFor(sessionId);
  const now = Date.now();
  const turn: BtwTurn = { question: text, answer: "", status: "running", createdAt: now, updatedAt: now };

  let record: BtwRecord | undefined;
  let priorTurns: BtwTurn[] = [];
  if (recordId) {
    record = state.records.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error("That side question no longer exists");
    if (latestBtwTurn(record).status === "running") throw new Error("This side question is still answering");
    priorTurns = btwTurns(record);
    record.followUps = [...(record.followUps ?? []), turn];
  } else {
    record = { id: randomUUID(), leafId: null, ...turn };
    state.records.push(record);
    if (state.records.length > MAX_RECORDS_PER_SESSION) state.records.splice(0, state.records.length - MAX_RECORDS_PER_SESSION);
  }
  // The turn object the stream writes into: the record itself for a new topic.
  const liveTurn = recordId ? turn : record;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BTW_TIMEOUT_MS);
  state.running.set(record.id, controller);
  const recordKey = record.id;
  const settle = (status: BtwTurn["status"], error?: string) => {
    liveTurn.status = status;
    if (error) liveTurn.error = error;
    liveTurn.updatedAt = Date.now();
    clearTimeout(timeout);
    state.running.delete(recordKey);
  };
  void streamAnswer(session.agent, liveTurn, priorTurns, controller.signal).then(
    () => {
      if (timedOut) settle("error", "Timed out");
      else settle(controller.signal.aborted ? "cancelled" : "complete");
    },
    (error: unknown) => {
      if (timedOut) settle("error", "Timed out");
      else if (controller.signal.aborted) settle("cancelled");
      else settle("error", error instanceof Error ? error.message : String(error));
    },
  );
  return record;
}
