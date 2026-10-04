import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { startBtw, listBtwRecords, cancelBtw } = await jiti.import("./btw-service.ts");

const MODEL = { id: "m", provider: "p", api: "openai-completions", reasoning: false };

/** A fake AgentSession whose model streams `chunks`, pausing `delayMs` between them. */
function fakeSession({ chunks = ["Hello", " world"], delayMs = 0, toolCallAfter, seen = [] } = {}) {
  const agent = {
    state: { model: MODEL, messages: [{ role: "user", content: [{ type: "text", text: "earlier prompt" }], timestamp: 1 }] },
    convertToLlm: async (messages) => messages,
    getApiKey: async () => "key",
    streamFunction: async (_model, context, options) => {
      seen.push(context);
      let text = "";
      return {
        async *[Symbol.asyncIterator]() {
          for (const [index, chunk] of chunks.entries()) {
            if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (options.signal?.aborted) throw new Error("aborted");
            if (toolCallAfter === index) {
              yield { type: "toolcall_start", contentIndex: 1 };
              continue;
            }
            text += chunk;
            yield { type: "text_delta", contentIndex: 0, delta: chunk };
          }
        },
        result: async () => ({ stopReason: "stop", content: [{ type: "text", text }] }),
      };
    },
  };
  return { agent };
}

async function settled(sessionId) {
  for (let i = 0; i < 200; i++) {
    const [record] = listBtwRecords(sessionId);
    const latest = record?.followUps?.at(-1) ?? record;
    if (latest && latest.status !== "running") return record;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("side question never settled");
}

test("a side question streams its answer from the session's own context", async () => {
  const seen = [];
  const record = startBtw("s-stream", fakeSession({ seen }), "what did I ask?");
  assert.equal(record.status, "running");
  const done = await settled("s-stream");
  assert.equal(done.status, "complete");
  assert.equal(done.answer, "Hello world");
  const messages = seen[0].messages;
  assert.equal(messages[0].content[0].text, "earlier prompt", "the session transcript leads the request");
  assert.match(messages.at(-1).content[0].text, /what did I ask\?$/);
});

test("a follow-up carries the earlier turns of its topic", async () => {
  const seen = [];
  const session = fakeSession({ seen, chunks: ["first"] });
  const record = startBtw("s-follow", session, "q1");
  await settled("s-follow");
  startBtw("s-follow", session, "q2", record.id);
  const done = await settled("s-follow");
  assert.equal(done.followUps.length, 1);
  assert.equal(done.followUps[0].answer, "first");
  assert.match(seen[1].messages.at(-1).content[0].text, /Q: q1\nA: first[\s\S]*Follow-up: q2/);
});

test("a running topic refuses another follow-up, and cancel stops it", async () => {
  const session = fakeSession({ chunks: ["a", "b", "c", "d"], delayMs: 20 });
  const record = startBtw("s-cancel", session, "slow");
  assert.throws(() => startBtw("s-cancel", session, "again", record.id), /still answering/);
  assert.equal(cancelBtw("s-cancel", record.id), true);
  const done = await settled("s-cancel");
  assert.equal(done.status, "cancelled");
  assert.equal(cancelBtw("s-cancel", record.id), false, "nothing left to cancel");
});

test("a tool call ends the answer with the text so far", async () => {
  startBtw("s-tool", fakeSession({ chunks: ["partial", "ignored"], toolCallAfter: 1 }), "use a tool?");
  const done = await settled("s-tool");
  assert.equal(done.status, "complete");
  assert.equal(done.answer, "partial");
});

test("empty questions are refused", () => {
  assert.throws(() => startBtw("s-empty", fakeSession(), "   "), /needs some text/);
});
