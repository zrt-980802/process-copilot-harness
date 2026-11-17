import type { DshSessionEvent } from "./types.js";

export interface ConversationMessage {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  sequence: number;
  occurred_at: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// This read projection leaves the immutable C25 event payloads and identities intact.
export function projectConversation(events: DshSessionEvent[]): ConversationMessage[] {
  const messages = new Map<string, ConversationMessage>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type !== "user/message" && event.type !== "assistant/message") continue;
    const data = record(event.data);
    const message = event.type === "assistant/message" ? record(data.message) : data;
    const content = Array.isArray(message.content) ? message.content.flatMap((part) => {
      const entry = record(part);
      return entry.type === "text" && typeof entry.text === "string" ? [entry.text] : [];
    }).join("\n\n") : "";
    if (!content.trim()) continue;
    const id = typeof message.id === "string" ? message.id : `event-${event.seq}`;
    messages.set(id, { message_id: id, role: event.type === "user/message" ? "user" : "assistant",
      content, sequence: event.seq, occurred_at: new Date(event.time).toISOString() });
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}
