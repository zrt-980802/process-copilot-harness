import type {
  SstsConversationMessage,
  SstsDraftAuditEntry,
  SstsDraftGeneration,
  SstsDraftRepository,
  SstsDraftRevision,
  SstsDraftReview,
  SstsGenerationState,
  SstsTaskInput,
  SstsTaskWorkspace
} from "@pc/ssts-draft";
import { SstsDraftError } from "@pc/ssts-draft";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

export class MemorySstsDraftRepository implements SstsDraftRepository {
  private readonly workspaces = new Map<string, SstsTaskWorkspace>();
  private readonly inputs = new Map<string, SstsTaskInput>();
  private readonly messages = new Map<string, SstsConversationMessage>();
  private readonly generations = new Map<string, SstsDraftGeneration>();
  private readonly generationKeys = new Map<string, string>();
  private readonly drafts = new Map<string, SstsDraftRevision>();
  private readonly reviews = new Map<string, SstsDraftReview>();
  private readonly audit = new Map<string, SstsDraftAuditEntry>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  createWorkspace(workspace: SstsTaskWorkspace): Promise<void> {
    if (this.workspaces.has(workspace.workspace_id)) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_CONFLICT",
        "SSTS Task Workspace already exists"
      );
    }
    this.workspaces.set(workspace.workspace_id, clone(workspace));
    return Promise.resolve();
  }

  getWorkspace(workspaceId: string): Promise<SstsTaskWorkspace | undefined> {
    const workspace = this.workspaces.get(workspaceId);
    return Promise.resolve(workspace === undefined ? undefined : clone(workspace));
  }

  listWorkspaces(
    tenantId: string,
    ownerPrincipalId: string
  ): Promise<SstsTaskWorkspace[]> {
    return Promise.resolve(
      [...this.workspaces.values()]
        .filter((workspace) =>
          workspace.tenant_id === tenantId
          && workspace.owner_principal_id === ownerPrincipalId
        )
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(clone)
    );
  }

  updateWorkspace(
    workspace: SstsTaskWorkspace,
    expectedVersion: number
  ): Promise<SstsTaskWorkspace> {
    const current = this.workspaces.get(workspace.workspace_id);
    if (current === undefined) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_NOT_FOUND",
        "SSTS Task Workspace was not found"
      );
    }
    if (current.version !== expectedVersion) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_CAS_CONFLICT",
        "SSTS Task Workspace version changed",
        true
      );
    }
    this.workspaces.set(workspace.workspace_id, clone(workspace));
    return Promise.resolve(clone(workspace));
  }

  putInput(input: SstsTaskInput): Promise<SstsTaskInput> {
    const inputKey = key(input.workspace_id, input.slot);
    const current = this.inputs.get(inputKey);
    if (current !== undefined && input.revision !== current.revision + 1) {
      throw new SstsDraftError(
        "PC_SSTS_INPUT_CAS_CONFLICT",
        "SSTS input revision changed",
        true
      );
    }
    if (current === undefined && input.revision !== 1) {
      throw new SstsDraftError(
        "PC_SSTS_INPUT_CAS_CONFLICT",
        "First SSTS input revision must be one"
      );
    }
    this.inputs.set(inputKey, clone(input));
    return Promise.resolve(clone(input));
  }

  listInputs(workspaceId: string): Promise<SstsTaskInput[]> {
    return Promise.resolve(
      [...this.inputs.values()]
        .filter((input) => input.workspace_id === workspaceId)
        .sort((left, right) => left.slot.localeCompare(right.slot))
        .map(clone)
    );
  }

  appendMessage(message: SstsConversationMessage): Promise<void> {
    const messageKey = key(message.workspace_id, String(message.sequence));
    if (this.messages.has(messageKey)) {
      throw new SstsDraftError(
        "PC_SSTS_MESSAGE_SEQUENCE_CONFLICT",
        "SSTS message sequence already exists",
        true
      );
    }
    this.messages.set(messageKey, clone(message));
    return Promise.resolve();
  }

  listMessages(workspaceId: string): Promise<SstsConversationMessage[]> {
    return Promise.resolve(
      [...this.messages.values()]
        .filter((message) => message.workspace_id === workspaceId)
        .sort((left, right) => left.sequence - right.sequence)
        .map(clone)
    );
  }

  createGeneration(generation: SstsDraftGeneration): Promise<void> {
    const idempotencyKey = key(
      generation.workspace_id,
      generation.idempotency_key
    );
    if (
      this.generations.has(generation.generation_id)
      || this.generationKeys.has(idempotencyKey)
    ) {
      throw new SstsDraftError(
        "PC_SSTS_GENERATION_CONFLICT",
        "SSTS generation or idempotency key already exists"
      );
    }
    this.generations.set(generation.generation_id, clone(generation));
    this.generationKeys.set(idempotencyKey, generation.generation_id);
    return Promise.resolve();
  }

  listInProgressGenerations(): Promise<SstsDraftGeneration[]> {
    return Promise.resolve([...this.generations.values()].filter((entry) => entry.state === "IN_PROGRESS").map(clone));
  }

  updateGeneration(
    generation: SstsDraftGeneration,
    expectedState: SstsGenerationState
  ): Promise<void> {
    const current = this.generations.get(generation.generation_id);
    if (current === undefined) {
      throw new SstsDraftError(
        "PC_SSTS_GENERATION_NOT_FOUND",
        "SSTS generation was not found"
      );
    }
    if (current.state !== expectedState) {
      throw new SstsDraftError(
        "PC_SSTS_GENERATION_CAS_CONFLICT",
        "SSTS generation state changed",
        true
      );
    }
    this.generations.set(generation.generation_id, clone(generation));
    return Promise.resolve();
  }

  findGeneration(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<SstsDraftGeneration | undefined> {
    const generationId = this.generationKeys.get(key(workspaceId, idempotencyKey));
    const generation = generationId === undefined
      ? undefined
      : this.generations.get(generationId);
    return Promise.resolve(generation === undefined ? undefined : clone(generation));
  }

  saveDraft(draft: SstsDraftRevision): Promise<void> {
    if (this.drafts.has(draft.draft_id)) {
      throw new SstsDraftError(
        "PC_SSTS_DRAFT_CONFLICT",
        "SSTS Draft already exists"
      );
    }
    this.drafts.set(draft.draft_id, clone(draft));
    return Promise.resolve();
  }

  getDraft(draftId: string): Promise<SstsDraftRevision | undefined> {
    const draft = this.drafts.get(draftId);
    return Promise.resolve(draft === undefined ? undefined : clone(draft));
  }

  listDrafts(workspaceId: string): Promise<SstsDraftRevision[]> {
    return Promise.resolve(
      [...this.drafts.values()]
        .filter((draft) => draft.workspace_id === workspaceId)
        .sort((left, right) => left.revision - right.revision)
        .map(clone)
    );
  }

  saveReview(review: SstsDraftReview): Promise<void> {
    if (this.reviews.has(review.draft_id)) {
      throw new SstsDraftError(
        "PC_SSTS_REVIEW_CONFLICT",
        "SSTS Draft already has a human review"
      );
    }
    this.reviews.set(review.draft_id, clone(review));
    return Promise.resolve();
  }

  getReview(draftId: string): Promise<SstsDraftReview | undefined> {
    const review = this.reviews.get(draftId);
    return Promise.resolve(review === undefined ? undefined : clone(review));
  }

  appendAudit(entry: SstsDraftAuditEntry): Promise<void> {
    if (this.audit.has(entry.audit_id)) {
      throw new SstsDraftError(
        "PC_SSTS_AUDIT_CONFLICT",
        "SSTS audit entry already exists"
      );
    }
    this.audit.set(entry.audit_id, clone(entry));
    return Promise.resolve();
  }

  listAudit(workspaceId: string): Promise<SstsDraftAuditEntry[]> {
    return Promise.resolve(
      [...this.audit.values()]
        .filter((entry) => entry.workspace_id === workspaceId)
        .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
        .map(clone)
    );
  }
}
