import { createHash } from "node:crypto";
import type {
  SstsDraftEngineInput,
  SstsDraftEngineOutput,
  SstsDraftEnginePort
} from "./types.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function summary(content: string): string {
  return content
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

export class DeterministicSstsDraftEngine implements SstsDraftEnginePort {
  generate(input: SstsDraftEngineInput): Promise<SstsDraftEngineOutput> {
    const citations = input.inputs.map((source) => ({
      slot: source.slot,
      resource_ref: structuredClone(source.resource_ref),
      locator: `resource-version:${source.resource_ref.resource_version_id}`,
      evidence_digest: digest(source.content)
    }));
    const sourceSections = input.inputs.map((source, index) =>
      `### ${source.slot}\n\n${summary(source.content)} [S${index + 1}]`
    );
    const conversation = input.messages
      .filter((message) => message.role === "USER")
      .map((message) => `- ${summary(message.content)}`)
      .join("\n");
    const references = citations.map((citation, index) =>
      `[S${index + 1}] ${citation.slot}: `
      + `${citation.resource_ref.display_name} `
      + `(${citation.resource_ref.resource_version_id})`
    );
    const content = [
      "# AI DRAFT - SSTS",
      "",
      `Task: ${input.workspace.title}`,
      `Profile: ${input.profile.profile_release_id}`,
      "",
      "## Scope",
      "",
      "This draft is generated from the exact source versions listed below. "
      + "It is not an enterprise baseline and has no publishing side effect.",
      "",
      "## Source Analysis",
      "",
      ...sourceSections,
      "",
      "## Conversation Context",
      "",
      conversation === "" ? "No user guidance was supplied." : conversation,
      "",
      "## Proposed Technical Specification",
      "",
      "### Functional Intent",
      "",
      "Implement the capabilities and constraints described by the PRD while "
      + "preserving the architecture boundaries in the supplied architecture source.",
      "",
      "### Architecture Constraints",
      "",
      "The implementation must retain explicit ownership, versioned inputs, "
      + "recoverable state, auditable decisions, and fail-closed authorization.",
      "",
      "### Verification",
      "",
      "- Verify every required source is bound to an immutable ResourceVersion.",
      "- Verify generated output remains marked as AI DRAFT.",
      "- Verify human review does not publish or mutate an enterprise baseline.",
      "",
      "## References",
      "",
      ...references
    ].join("\n");
    return Promise.resolve({ content, citations });
  }
}
