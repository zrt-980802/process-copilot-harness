import { describe, expect, it } from "vitest";
import { projectConversation } from "../src/conversation.js";

describe("DSH conversation read projection", () => {
  it("restores ordered user and assistant text without internal messages, thinking or tools", () => {
    const user = { type: "user/message", seq: 4, time: 1700000000000,
      data: { id: "u1", content: [{ type: "text", text: "Project question" }] } };
    const answer = { type: "assistant/message", seq: 8, time: 1700000001000,
      data: { message: { id: "a1", content: [{ type: "thinking", text: "private" },
        { type: "text", text: "Actual answer" }, { type: "tool_call", arguments: "private" }] } } };
    const events = [answer, { type: "system/message", seq: 0, time: user.time,
      data: { content: [{ type: "text", text: "internal instruction" }] } }, user, answer];
    const messages = projectConversation(events);
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Project question" }, { role: "assistant", content: "Actual answer" }
    ]);
    expect(events[0]).toBe(answer);
  });
});
