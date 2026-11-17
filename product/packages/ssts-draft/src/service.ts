import { createHash, randomUUID } from "node:crypto";
import type {
  SstsBusinessTask,
  SstsBusinessStatePort,
  SstsCitation,
  SstsConversationMessage,
  SstsDraftAuditEntry,
  SstsDraftEnginePort,
  SstsExecutionContext,
  SstsDraftGeneration,
  SstsDraftRepository,
  SstsDraftRevision,
  SstsDraftReview,
  SstsInputSlot,
  SstsProfilePort,
  SstsResourcePort,
  SstsTaskInput,
  SstsTaskWorkspace,
  SstsValidationCheck,
  SstsValidationReport
} from "./types.js";
import { SstsDraftError } from "./types.js";

const FIXED_PROFILE_RELEASE_ID = "profile:fo-ssts-draft:1";
const REQUIRED_SLOTS: readonly SstsInputSlot[] = ["PRD", "ARCHITECTURE"];

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SstsDraftError(
        "PC_SSTS_NON_JSON_VALUE",
        "SSTS data contains a non-finite number"
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  throw new SstsDraftError(
    "PC_SSTS_NON_JSON_VALUE",
    "SSTS data must be JSON-compatible"
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(
    value instanceof Uint8Array ? value : canonical(value)
  ).digest("hex")}`;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new SstsDraftError(
      "PC_SSTS_INVALID_ARGUMENT",
      `${field} is required`,
      false,
      { field }
    );
  }
  return normalized;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SstsDraftService {
  constructor(
    private readonly repository: SstsDraftRepository,
    private readonly profiles: SstsProfilePort,
    private readonly resources: SstsResourcePort,
    private readonly businessState: SstsBusinessStatePort,
    private readonly engine: SstsDraftEnginePort,
    private readonly now: () => Date = () => new Date()
  ) {}

  async initialize(): Promise<void> {
    await this.repository.initialize();
    // The local API is a single executor; persisted active work belongs to its previous process.
    for (const generation of await this.repository.listInProgressGenerations()) {
      await this.repository.updateGeneration({ ...generation, state: "FAILED",
        failure_code: "PC_SSTS_EXECUTOR_RESTARTED", updated_at: this.now().toISOString() }, "IN_PROGRESS");
      const workspace = await this.repository.getWorkspace(generation.workspace_id);
      if (!workspace) continue;
      await this.businessState.transitionOperation({ operation_id: generation.business_operation_id,
        tenant_id: workspace.tenant_id, principal_id: workspace.owner_principal_id,
        state: "FAILED", evidence_refs: ["executor-restart:read-only-generation"] }).catch(() => undefined);
      await this.businessState.transitionTask({ business_task_id: workspace.business_task_id,
        tenant_id: workspace.tenant_id, principal_id: workspace.owner_principal_id,
        state: "FAILED", reason_codes: ["ssts_executor_restarted"] }).catch(() => undefined);
      if (workspace.state === "GENERATING") await this.updateWorkspace(workspace, { state: "GENERATION_FAILED" });
    }
  }

  close(): Promise<void> {
    return this.repository.close();
  }

  async createWorkspace(input: {
    tenant_id: string;
    principal_id: string;
    title: string;
    source_session_ids?: string[];
    profile_release_id?: string;
    project_code?: string;
    function_code?: string;
  }): Promise<SstsTaskWorkspace> {
    const profile = await this.requireFixedProfile(input.profile_release_id);
    const task = await this.businessState.createTask({
      tenant_id: required(input.tenant_id, "tenant_id"),
      owner_principal_id: required(input.principal_id, "principal_id"),
      profile_release_id: profile.profile_release_id,
      ...(input.source_session_ids === undefined
        ? {}
        : { source_session_ids: input.source_session_ids })
    });
    const now = this.now().toISOString();
    const workspace: SstsTaskWorkspace = {
      workspace_id: `ssts_workspace_${randomUUID()}`,
      business_task_id: task.business_task_id,
      tenant_id: task.tenant_id,
      owner_principal_id: task.owner_principal_id,
      title: required(input.title, "title"),
      profile_release_id: profile.profile_release_id,
      profile_release_digest: profile.release_digest,
      ...(input.project_code === undefined ? {} : { project_code: input.project_code }),
      ...(input.function_code === undefined ? {} : { function_code: input.function_code }),
      state: "CREATED",
      created_at: now,
      updated_at: now,
      version: 1
    };
    await this.repository.createWorkspace(workspace);
    await this.audit(workspace, input.principal_id, "SSTS_WORKSPACE_CREATED", [], [
      profile.release_digest,
      task.business_task_id
    ]);
    return clone(workspace);
  }

  listWorkspaces(
    tenantId: string,
    principalId: string
  ): Promise<SstsTaskWorkspace[]> {
    return this.repository.listWorkspaces(tenantId, principalId);
  }

  async getWorkspace(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
  }): Promise<{
    workspace: SstsTaskWorkspace;
    inputs: SstsTaskInput[];
    messages: SstsConversationMessage[];
    drafts: SstsDraftRevision[];
    reviews: SstsDraftReview[];
    audit: SstsDraftAuditEntry[];
  }> {
    const workspace = await this.requireOwnedWorkspace(input);
    const [inputs, messages, drafts, audit] = await Promise.all([
      this.repository.listInputs(workspace.workspace_id),
      this.repository.listMessages(workspace.workspace_id),
      this.repository.listDrafts(workspace.workspace_id),
      this.repository.listAudit(workspace.workspace_id)
    ]);
    const reviews = (
      await Promise.all(drafts.map((draft) => this.repository.getReview(draft.draft_id)))
    ).filter((review): review is SstsDraftReview => review !== undefined);
    return { workspace, inputs, messages, drafts, reviews, audit };
  }

  async attachInput(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
    slot: SstsInputSlot;
    resource_id: string;
    resource_version_id: string;
  }): Promise<SstsTaskInput> {
    const workspace = await this.requireOwnedWorkspace(input);
    this.assertMutable(workspace);
    const resolved = await this.resources.readResourceVersion({
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      resource_id: input.resource_id,
      resource_version_id: input.resource_version_id
    });
    const current = (await this.repository.listInputs(workspace.workspace_id))
      .find((candidate) => candidate.slot === input.slot);
    const attached: SstsTaskInput = {
      input_id: current?.input_id ?? `ssts_input_${randomUUID()}`,
      workspace_id: workspace.workspace_id,
      slot: input.slot,
      resource_ref: resolved.resource_ref,
      attached_by: input.principal_id,
      attached_at: this.now().toISOString(),
      revision: (current?.revision ?? 0) + 1
    };
    const saved = await this.repository.putInput(attached);
    if (workspace.state !== "CREATED" && workspace.state !== "INPUT_INCOMPLETE") {
      await this.updateWorkspace(workspace, {
        state: "INPUT_INCOMPLETE",
        current_draft_id: undefined
      });
    }
    await this.audit(workspace, input.principal_id, "SSTS_INPUT_ATTACHED", [{
      resource_id: resolved.resource_ref.resource_id,
      resource_version_id: resolved.resource_ref.resource_version_id
    }], [resolved.resource_ref.content_digest, input.slot]);
    return saved;
  }

  async checkInputs(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
  }): Promise<{
    complete: boolean;
    missing_slots: SstsInputSlot[];
    inputs: SstsTaskInput[];
    workspace: SstsTaskWorkspace;
  }> {
    const workspace = await this.requireOwnedWorkspace(input);
    const inputs = await this.repository.listInputs(workspace.workspace_id);
    const slots = new Set(inputs.map((candidate) => candidate.slot));
    const missing = REQUIRED_SLOTS.filter((slot) => !slots.has(slot));
    const targetState = missing.length === 0 ? "READY" : "INPUT_INCOMPLETE";
    const updated = workspace.state === targetState
      ? workspace
      : await this.updateWorkspace(workspace, { state: targetState });
    if (missing.length === 0) {
      const task = await this.requireTask(workspace);
      if (task.state === "DRAFT") {
        await this.businessState.transitionTask({
          business_task_id: task.business_task_id,
          tenant_id: workspace.tenant_id,
          principal_id: workspace.owner_principal_id,
          state: "READY",
          reason_codes: ["ssts_inputs_complete"]
        });
      }
    }
    await this.audit(workspace, input.principal_id, "SSTS_INPUTS_CHECKED", [], [
      missing.length === 0 ? "complete" : `missing:${missing.join(",")}`
    ]);
    return {
      complete: missing.length === 0,
      missing_slots: missing,
      inputs,
      workspace: updated
    };
  }

  async appendMessage(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
    content: string;
  }): Promise<SstsConversationMessage> {
    const workspace = await this.requireOwnedWorkspace(input);
    this.assertMutable(workspace);
    const messages = await this.repository.listMessages(workspace.workspace_id);
    const message: SstsConversationMessage = {
      message_id: `ssts_message_${randomUUID()}`,
      workspace_id: workspace.workspace_id,
      role: "USER",
      content: required(input.content, "content"),
      created_by: input.principal_id,
      created_at: this.now().toISOString(),
      sequence: messages.length + 1
    };
    await this.repository.appendMessage(message);
    if (
      workspace.state !== "GENERATING"
      && workspace.state !== "HUMAN_REVIEW"
      && workspace.state !== "ACCEPTED"
    ) {
      await this.updateWorkspace(workspace, { state: "CONVERSING" });
    }
    await this.audit(workspace, input.principal_id, "SSTS_MESSAGE_APPENDED", [], [
      digest(message.content)
    ]);
    return clone(message);
  }

  async generateDraft(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
    idempotency_key: string;
    execution?: SstsExecutionContext;
  }): Promise<{
    generation: SstsDraftGeneration;
    draft: SstsDraftRevision;
    workspace: SstsTaskWorkspace;
  }> {
    let workspace = await this.requireOwnedWorkspace(input);
    this.assertMutable(workspace);
    const idempotencyKey = required(input.idempotency_key, "idempotency_key");
    const existing = await this.repository.findGeneration(
      workspace.workspace_id,
      idempotencyKey
    );
    if (existing !== undefined) {
      if (existing.state === "SUCCEEDED" && existing.draft_id !== undefined) {
        const draft = await this.repository.getDraft(existing.draft_id);
        if (draft !== undefined) {
          return { generation: existing, draft, workspace };
        }
      }
      throw new SstsDraftError(
        existing.state === "IN_PROGRESS"
          ? "PC_SSTS_GENERATION_IN_PROGRESS"
          : "PC_SSTS_GENERATION_PREVIOUSLY_FAILED",
        "Idempotent generation request is not available for a new execution",
        existing.state === "IN_PROGRESS"
      );
    }

    const checked = await this.checkInputs(input);
    if (!checked.complete) {
      throw new SstsDraftError(
        "PC_SSTS_INPUTS_INCOMPLETE",
        "Required SSTS inputs are missing",
        false,
        { missing_slots: checked.missing_slots }
      );
    }
    workspace = checked.workspace;
    const profile = await this.requireFixedProfile(workspace.profile_release_id);
    if (
      workspace.profile_release_id !== profile.profile_release_id
      || workspace.profile_release_digest !== profile.release_digest
    ) {
      throw new SstsDraftError(
        "PC_SSTS_PROFILE_MISMATCH",
        "Workspace Profile Release no longer matches its immutable digest"
      );
    }
    const sourceInputs = await Promise.all(checked.inputs.map(async (source) => {
      const resolved = await this.resources.readResourceVersion({
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        resource_id: source.resource_ref.resource_id,
        resource_version_id: source.resource_ref.resource_version_id
      });
      if (resolved.resource_ref.content_digest !== source.resource_ref.content_digest) {
        throw new SstsDraftError(
          "PC_SSTS_RESOURCE_DIGEST_MISMATCH",
          "Attached ResourceVersion content digest changed"
        );
      }
      return {
        slot: source.slot,
        resource_ref: source.resource_ref,
        content: Buffer.from(resolved.content).toString("utf8")
      };
    }));
    const inputDigest = digest({
      profile_release_id: profile.profile_release_id,
      profile_release_digest: profile.release_digest,
      sources: sourceInputs.map((source) => ({
        slot: source.slot,
        resource_version_id: source.resource_ref.resource_version_id,
        content_digest: source.resource_ref.content_digest
      }))
    });
    const generationId = `ssts_generation_${randomUUID()}`;
    const operationId = `ssts_operation_${randomUUID()}`;
    const now = this.now().toISOString();
    let generation: SstsDraftGeneration = {
      generation_id: generationId,
      workspace_id: workspace.workspace_id,
      business_operation_id: operationId,
      idempotency_key: idempotencyKey,
      input_digest: inputDigest,
      state: "IN_PROGRESS",
      created_at: now,
      updated_at: now
    };
    await this.repository.createGeneration(generation);
    const task = await this.ensureTaskRunning(workspace);
    await this.businessState.planOperation({
      operation_id: operationId,
      business_task_id: task.business_task_id,
      tenant_id: workspace.tenant_id,
      principal_id: workspace.owner_principal_id,
      operation_kind: "READ",
      recovery_class: "REPLAY_SAFE",
      input_digest: inputDigest,
      evidence_refs: sourceInputs.map(
        (source) => source.resource_ref.resource_version_id
      )
    });
    await this.businessState.transitionOperation({
      operation_id: operationId,
      tenant_id: workspace.tenant_id,
      principal_id: workspace.owner_principal_id,
      state: "DISPATCHING",
      evidence_refs: [profile.release_digest]
    });
    await this.businessState.transitionOperation({
      operation_id: operationId,
      tenant_id: workspace.tenant_id,
      principal_id: workspace.owner_principal_id,
      state: "DISPATCHED",
      evidence_refs: [inputDigest]
    });
    workspace = await this.updateWorkspace(workspace, { state: "GENERATING" });

    try {
      const messages = await this.repository.listMessages(workspace.workspace_id);
      const output = await this.engine.generate({
        workspace,
        profile,
        inputs: sourceInputs,
        messages
      }, input.execution);
      const content = Buffer.from(output.content, "utf8");
      const contentDigest = digest(content);
      const artifact = await this.resources.createArtifactResource({
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        display_name: `${workspace.title}-ssts-draft.md`,
        classification: "INTERNAL",
        media_type: "text/markdown",
        content,
        derived_from: [...sourceInputs.map((source) => ({
          resource_id: source.resource_ref.resource_id,
          resource_version_id: source.resource_ref.resource_version_id
        })), ...(output.evidence_refs ?? [])],
        acquisition_operation: operationId,
        request_id: generationId
      });
      const priorDrafts = await this.repository.listDrafts(workspace.workspace_id);
      const citations: SstsCitation[] = output.citations.map((citation) => ({
        citation_id: `ssts_citation_${randomUUID()}`,
        ...clone(citation)
      }));
      const validation = this.validateDraft(
        output.content,
        sourceInputs.map((source) => source.slot),
        citations
      );
      if (validation.status !== "PASSED") {
        throw new SstsDraftError(
          "PC_SSTS_VALIDATION_FAILED",
          "Generated SSTS Draft failed validation",
          false,
          { report: validation }
        );
      }
      const draft: SstsDraftRevision = {
        draft_id: `ssts_draft_${randomUUID()}`,
        workspace_id: workspace.workspace_id,
        generation_id: generationId,
        revision: priorDrafts.length + 1,
        profile_release_id: profile.profile_release_id,
        profile_release_digest: profile.release_digest,
        source_refs: [...sourceInputs.map((source) => clone(source.resource_ref)), ...(output.evidence_refs ?? [])],
        artifact_ref: artifact.resource_ref,
        citations,
        validation,
        content_digest: contentDigest,
        media_type: "text/markdown",
        created_by: workspace.owner_principal_id,
        created_at: this.now().toISOString()
      };
      await this.repository.saveDraft(draft);
      generation = {
        ...generation,
        state: "SUCCEEDED",
        draft_id: draft.draft_id,
        updated_at: this.now().toISOString()
      };
      await this.repository.updateGeneration(generation, "IN_PROGRESS");
      await this.businessState.transitionOperation({
        operation_id: operationId,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "VERIFYING",
        result_digest: contentDigest,
        evidence_refs: [validation.report_digest]
      });
      await this.businessState.transitionOperation({
        operation_id: operationId,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "SUCCEEDED",
        result_digest: contentDigest,
        evidence_refs: [
          validation.report_digest,
          artifact.resource_ref.resource_version_id
        ]
      });
      await this.businessState.transitionTask({
        business_task_id: workspace.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "WAITING_USER",
        reason_codes: ["ssts_draft_ready_for_human_review"]
      });
      workspace = await this.updateWorkspace(workspace, {
        state: "HUMAN_REVIEW",
        current_draft_id: draft.draft_id
      });
      await this.audit(workspace, input.principal_id, "SSTS_DRAFT_GENERATED", [{
        resource_id: artifact.resource_ref.resource_id,
        resource_version_id: artifact.resource_ref.resource_version_id
      }], [
        generation.generation_id,
        operationId,
        validation.report_digest
      ]);
      return { generation, draft, workspace };
    } catch (error) {
      const failureCode = error instanceof SstsDraftError
        ? error.code
        : "PC_SSTS_GENERATION_FAILED";
      generation = {
        ...generation,
        state: "FAILED",
        failure_code: failureCode,
        updated_at: this.now().toISOString()
      };
      await this.repository.updateGeneration(generation, "IN_PROGRESS");
      await this.businessState.transitionOperation({
        operation_id: operationId,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "FAILED",
        evidence_refs: [failureCode]
      }).catch(() => undefined);
      await this.businessState.transitionTask({
        business_task_id: workspace.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "FAILED",
        reason_codes: [failureCode]
      }).catch(() => undefined);
      await this.updateWorkspace(workspace, { state: "GENERATION_FAILED" });
      throw error;
    }
  }

  async reviewDraft(input: {
    workspace_id: string;
    draft_id: string;
    tenant_id: string;
    principal_id: string;
    decision: "ACCEPTED" | "REJECTED";
    comment?: string;
  }): Promise<{
    review: SstsDraftReview;
    workspace: SstsTaskWorkspace;
  }> {
    let workspace = await this.requireOwnedWorkspace(input);
    if (
      workspace.state !== "HUMAN_REVIEW"
      || workspace.current_draft_id !== input.draft_id
    ) {
      throw new SstsDraftError(
        "PC_SSTS_REVIEW_STATE_CONFLICT",
        "Only the current Draft in human review can be reviewed"
      );
    }
    const draft = await this.repository.getDraft(input.draft_id);
    if (draft === undefined || draft.workspace_id !== workspace.workspace_id) {
      throw new SstsDraftError("PC_SSTS_DRAFT_NOT_FOUND", "SSTS Draft was not found");
    }
    const review: SstsDraftReview = {
      review_id: `ssts_review_${randomUUID()}`,
      workspace_id: workspace.workspace_id,
      draft_id: draft.draft_id,
      decision: input.decision,
      ...(input.comment === undefined
        ? {}
        : { comment: required(input.comment, "comment") }),
      reviewed_by: input.principal_id,
      reviewed_at: this.now().toISOString()
    };
    await this.repository.saveReview(review);
    await this.businessState.transitionTask({
      business_task_id: workspace.business_task_id,
      tenant_id: workspace.tenant_id,
      principal_id: workspace.owner_principal_id,
      state: "RUNNING",
      reason_codes: [`ssts_draft_${input.decision.toLowerCase()}`]
    });
    if (input.decision === "ACCEPTED") {
      await this.businessState.transitionTask({
        business_task_id: workspace.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "COMPLETED",
        reason_codes: ["ssts_human_review_accepted"]
      });
    }
    workspace = await this.updateWorkspace(workspace, {
      state: input.decision
    });
    await this.audit(workspace, input.principal_id, "SSTS_DRAFT_REVIEWED", [{
      resource_id: draft.artifact_ref.resource_id,
      resource_version_id: draft.artifact_ref.resource_version_id
    }], [review.review_id, review.decision]);
    return { review, workspace };
  }

  async downloadDraft(input: {
    workspace_id: string;
    draft_id: string;
    tenant_id: string;
    principal_id: string;
  }): Promise<{
    filename: string;
    media_type: string;
    content: Uint8Array;
    content_digest: string;
  }> {
    const workspace = await this.requireOwnedWorkspace(input);
    const draft = await this.repository.getDraft(input.draft_id);
    if (draft === undefined || draft.workspace_id !== workspace.workspace_id) {
      throw new SstsDraftError("PC_SSTS_DRAFT_NOT_FOUND", "SSTS Draft was not found");
    }
    const resolved = await this.resources.readResourceVersion({
      tenant_id: input.tenant_id,
      principal_id: input.principal_id,
      resource_id: draft.artifact_ref.resource_id,
      resource_version_id: draft.artifact_ref.resource_version_id
    });
    if (resolved.resource_ref.content_digest !== draft.content_digest) {
      throw new SstsDraftError(
        "PC_SSTS_ARTIFACT_DIGEST_MISMATCH",
        "Draft artifact digest does not match the immutable Draft revision"
      );
    }
    await this.audit(workspace, input.principal_id, "SSTS_DRAFT_DOWNLOADED", [{
      resource_id: draft.artifact_ref.resource_id,
      resource_version_id: draft.artifact_ref.resource_version_id
    }], [draft.content_digest]);
    return {
      filename: `${workspace.title}-r${draft.revision}.md`,
      media_type: draft.media_type,
      content: resolved.content,
      content_digest: draft.content_digest
    };
  }

  async archiveWorkspace(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
  }): Promise<SstsTaskWorkspace> {
    const workspace = await this.requireOwnedWorkspace(input);
    if (workspace.state === "ARCHIVED") return workspace;
    const task = await this.requireTask(workspace);
    if (!["COMPLETED", "CANCELLED"].includes(task.state)) {
      await this.businessState.transitionTask({
        business_task_id: workspace.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "CANCELLED",
        reason_codes: ["ssts_workspace_archived"]
      });
    }
    const updated = await this.updateWorkspace(workspace, { state: "ARCHIVED" });
    await this.audit(workspace, input.principal_id, "SSTS_WORKSPACE_ARCHIVED", [], []);
    return updated;
  }

  private async ensureTaskRunning(
    workspace: SstsTaskWorkspace
  ): Promise<SstsBusinessTask> {
    let task = await this.requireTask(workspace);
    if (task.state === "FAILED") {
      task = await this.businessState.transitionTask({ business_task_id: task.business_task_id,
        tenant_id: workspace.tenant_id, principal_id: workspace.owner_principal_id,
        state: "RECOVERING", reason_codes: ["explicit_ssts_read_retry"] });
    }
    if (task.state === "DRAFT") {
      task = await this.businessState.transitionTask({
        business_task_id: task.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "READY",
        reason_codes: ["ssts_generation_inputs_complete"]
      });
    }
    if (["READY", "WAITING_USER", "RECOVERING"].includes(task.state)) {
      task = await this.businessState.transitionTask({
        business_task_id: task.business_task_id,
        tenant_id: workspace.tenant_id,
        principal_id: workspace.owner_principal_id,
        state: "RUNNING",
        reason_codes: ["ssts_generation_started"]
      });
    }
    if (task.state !== "RUNNING") {
      throw new SstsDraftError(
        "PC_SSTS_TASK_STATE_CONFLICT",
        `BusinessTask cannot generate from state ${task.state}`
      );
    }
    return task;
  }

  private validateDraft(
    content: string,
    slots: SstsInputSlot[],
    citations: SstsCitation[]
  ): SstsValidationReport {
    const checks: SstsValidationCheck[] = [
      {
        code: "AI_DRAFT_LABEL",
        status: content.includes("AI DRAFT") ? "PASS" : "FAIL",
        message: "Draft must remain visibly marked as AI DRAFT.",
        evidence_refs: [digest(content.slice(0, 256))]
      },
      {
        code: "REQUIRED_INPUTS_BOUND",
        status: REQUIRED_SLOTS.every((slot) => slots.includes(slot))
          ? "PASS"
          : "FAIL",
        message: "Every required input slot must be bound.",
        evidence_refs: slots
      },
      {
        code: "EXACT_CITATIONS",
        status: REQUIRED_SLOTS.every((slot) =>
          citations.some((citation) => citation.slot === slot)
        ) ? "PASS" : "FAIL",
        message: "Every required input must have an exact ResourceVersion citation.",
        evidence_refs: citations.map(
          (citation) => citation.resource_ref.resource_version_id
        )
      },
      {
        code: "NO_ENTERPRISE_WRITE",
        status: "PASS",
        message: "Draft generation and local review do not perform enterprise writes.",
        evidence_refs: ["operation-kind:READ", "recovery-class:REPLAY_SAFE"]
      }
    ];
    const createdAt = this.now().toISOString();
    const semantic = { checks, created_at: createdAt };
    return {
      report_id: `ssts_validation_${randomUUID()}`,
      status: checks.some((check) => check.status === "FAIL")
        ? "FAILED"
        : "PASSED",
      checks,
      created_at: createdAt,
      report_digest: digest(semantic)
    };
  }

  private async requireFixedProfile(profileId = FIXED_PROFILE_RELEASE_ID) {
    const profile = await this.profiles.getProfileRelease(
      profileId
    );
    if (
      profile === undefined
      || profile.status !== "PUBLISHED"
      || profile.output_contract.enterprise_write !== false
    ) {
      throw new SstsDraftError(
        "PC_SSTS_PROFILE_UNAVAILABLE",
        "Fixed FO SSTS Draft Profile is not published or is not read-only"
      );
    }
    return profile;
  }

  private async requireOwnedWorkspace(input: {
    workspace_id: string;
    tenant_id: string;
    principal_id: string;
  }): Promise<SstsTaskWorkspace> {
    const workspace = await this.repository.getWorkspace(input.workspace_id);
    if (workspace === undefined) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_NOT_FOUND",
        "SSTS Task Workspace was not found"
      );
    }
    if (
      workspace.tenant_id !== input.tenant_id
      || workspace.owner_principal_id !== input.principal_id
    ) {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_SCOPE_DENIED",
        "SSTS Task Workspace belongs to another Principal"
      );
    }
    return workspace;
  }

  private async requireTask(
    workspace: SstsTaskWorkspace
  ): Promise<SstsBusinessTask> {
    const task = await this.businessState.getTask(workspace.business_task_id);
    if (
      task === undefined
      || task.tenant_id !== workspace.tenant_id
      || task.owner_principal_id !== workspace.owner_principal_id
    ) {
      throw new SstsDraftError(
        "PC_SSTS_BUSINESS_TASK_MISMATCH",
        "SSTS Workspace BusinessTask is missing or outside its authority"
      );
    }
    return task;
  }

  private assertMutable(workspace: SstsTaskWorkspace): void {
    if (workspace.state === "ARCHIVED" || workspace.state === "ACCEPTED") {
      throw new SstsDraftError(
        "PC_SSTS_WORKSPACE_IMMUTABLE",
        "Accepted or archived SSTS Workspaces cannot be changed"
      );
    }
  }

  private updateWorkspace(
    workspace: SstsTaskWorkspace,
    patch: {
      state?: SstsTaskWorkspace["state"];
      current_draft_id?: string | undefined;
    }
  ): Promise<SstsTaskWorkspace> {
    const updated: SstsTaskWorkspace = {
      ...workspace,
      ...(patch.state === undefined ? {} : { state: patch.state }),
      updated_at: this.now().toISOString(),
      version: workspace.version + 1
    };
    if (Object.hasOwn(patch, "current_draft_id")) {
      if (patch.current_draft_id === undefined) {
        delete updated.current_draft_id;
      } else {
        updated.current_draft_id = patch.current_draft_id;
      }
    }
    return this.repository.updateWorkspace(updated, workspace.version);
  }

  private audit(
    workspace: SstsTaskWorkspace,
    principalId: string,
    eventType: string,
    resourceRefs: SstsDraftAuditEntry["resource_refs"],
    evidenceRefs: string[]
  ): Promise<void> {
    const unsigned = {
      audit_id: `ssts_audit_${randomUUID()}`,
      workspace_id: workspace.workspace_id,
      tenant_id: workspace.tenant_id,
      actor_principal_id: principalId,
      event_type: eventType,
      resource_refs: clone(resourceRefs),
      evidence_refs: [...evidenceRefs],
      occurred_at: this.now().toISOString()
    };
    return this.repository.appendAudit({
      ...unsigned,
      entry_digest: digest(unsigned)
    });
  }
}
