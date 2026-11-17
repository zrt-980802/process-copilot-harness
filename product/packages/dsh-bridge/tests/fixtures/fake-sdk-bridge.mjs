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

function response(id, result) {
  process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
}

function failure(id, error) {
  process.stdout.write(`${JSON.stringify({ id, ok: false, error })}\n`);
}

const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  try {
    if (method === "start") {
      response(id, { started: true });
      return;
    }
    if (method === "resume") {
      if (readSession(params.session_id) === undefined) {
        throw new Error("session not found");
      }
      response(id, { resumed: true });
      return;
    }
    if (method === "run") {
      const state = readSession(params.session_id) ?? { nextSeq: 0, prompts: [] };
      const turn = state.prompts.length;
      const history = state.prompts.join("|");
      const answer = `turn=${turn + 1};history=${history};prompt=${params.prompt}`;
      const now = Date.now();
      const events = [
        {
          type: "agent/inbox/spliced",
          seq: state.nextSeq++,
          time: now,
          data: {
            target: "next-turn",
            start: turn,
            inserted: [{ id: `user-${turn}`, role: "user" }]
          }
        },
        {
          type: "turn/start",
          seq: state.nextSeq++,
          time: now,
          data: { turn }
        },
        {
          type: "assistant/message",
          seq: state.nextSeq++,
          time: now,
          data: {
            turn,
            step: 0,
            message: {
              id: `assistant-${turn}`,
              role: "assistant",
              content: [{ type: "text", text: answer }],
              source: { provider: "fake", model: "fake" }
            }
          }
        },
        {
          type: "turn/end",
          seq: state.nextSeq++,
          time: now,
          data: { turn, reason: { kind: "completed" } }
        }
      ];
      state.prompts.push(params.prompt);
      writeSession(params.session_id, state);
      response(id, {
        session_id: params.session_id,
        final_response: answer,
        events,
        notification_count: events.length + 2
      });
      return;
    }
    if (method === "close") {
      response(id, { closed: true });
      setImmediate(() => process.exit(0));
      return;
    }
    throw new Error(`unsupported method: ${method}`);
  } catch (error) {
    failure(id, error instanceof Error ? error.message : String(error));
  }
});
