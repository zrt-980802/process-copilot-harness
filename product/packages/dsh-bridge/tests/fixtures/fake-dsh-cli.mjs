#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const home = process.env.DSH_HOME;
if (home === undefined || home === "") {
  process.stderr.write("DSH_HOME is required\n");
  process.exit(2);
}

const root = join(home, "fake-sessions");
mkdirSync(root, { recursive: true });

function sessionPath(sessionId) {
  return join(root, `${Buffer.from(sessionId).toString("hex")}.json`);
}

function readSession(sessionId) {
  try {
    return JSON.parse(readFileSync(sessionPath(sessionId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function writeSession(sessionId, state) {
  writeFileSync(sessionPath(sessionId), `${JSON.stringify(state)}\n`, "utf8");
}

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function textStream(text) {
  return [
    { type: "chunk", time: Date.now(), chunk: { type: "block-start", index: 0, blockType: "text" } },
    { type: "text-chunks", time0: Date.now(), index: 0, dt: [], texts: [text] },
    {
      type: "chunk",
      time: Date.now(),
      chunk: { type: "block-end", index: 0, block: { type: "text", text } }
    },
    { type: "chunk", time: Date.now(), chunk: { type: "finish", reason: { kind: "stop" } } }
  ];
}

function promptText(params) {
  const blocks = Array.isArray(params?.contentBlocks) ? params.contentBlocks : [];
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function emitEvent(sessionId, state, type, data) {
  notify("session.event", {
    sessionId,
    event: {
      type,
      seq: state.nextSeq++,
      time: Date.now(),
      data
    }
  });
}

const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  if (line.trim() === "") return;
  const frame = JSON.parse(line);
  if (frame.id === undefined || typeof frame.method !== "string") return;

  switch (frame.method) {
    case "initialize":
      respond(frame.id, {
        serverInfo: {
          name: "deepseek-harness-sdk-runtime",
          version: "0.2.1-rc.3"
        }
      });
      return;
    case "session/resume": {
      const sessionId = frame.params?.sessionId;
      if (typeof sessionId !== "string" || readSession(sessionId) === undefined) {
        fail(frame.id, -32603, "session not found");
        return;
      }
      respond(frame.id, {});
      return;
    }
    case "session/prompt": {
      const sessionId = frame.params?.sessionId;
      if (typeof sessionId !== "string") {
        fail(frame.id, -32602, "sessionId is required");
        return;
      }
      const state = readSession(sessionId) ?? { nextSeq: 0, prompts: [] };
      const prompt = promptText(frame.params);
      const turn = state.prompts.length;
      const messageId = `user-${turn}`;
      const history = state.prompts.join("|");
      const answer = `turn=${turn + 1};history=${history};prompt=${prompt}`;

      emitEvent(sessionId, state, "agent/inbox/spliced", {
        target: "next-turn",
        start: turn,
        inserted: [{
          id: messageId,
          role: "user",
          content: [{ type: "text", text: prompt }],
          source: { kind: "user" }
        }]
      });
      notify("session.status", { sessionId, status: "running" });
      emitEvent(sessionId, state, "turn/start", { turn });
      emitEvent(sessionId, state, "assistant/message", {
        turn,
        step: 0,
        message: {
          id: `assistant-${turn}`,
          role: "assistant",
          content: [{ type: "text", text: answer }],
          source: { kind: "model", provider: "fake", model: "fake" }
        },
        stream: textStream(answer)
      });
      emitEvent(sessionId, state, "turn/end", {
        turn,
        reason: { kind: "completed" }
      });
      state.prompts.push(prompt);
      writeSession(sessionId, state);
      notify("session.status", { sessionId, status: "idle" });
      respond(frame.id, { messageId });
      return;
    }
    case "session/wait":
      respond(frame.id, {});
      return;
    case "shutdown":
      respond(frame.id, {});
      setImmediate(() => process.exit(0));
      return;
    default:
      fail(frame.id, -32601, `unknown method: ${frame.method}`);
  }
});
