import { EventProjectionError, type EventProjectionService } from "@pc/event-projection";
import { mcpDigest, toolExecutionResultDigest, type GatewayRepository } from "@pc/gateway";

export const READ_VERIFIER_VERSION = "1.0.0";
const verifierRef = `verifier:pc-read-operation:${READ_VERIFIER_VERSION}`;

export class ReadOperationVerifier {
  constructor(private readonly events: EventProjectionService,
    private readonly gateway: Pick<GatewayRepository, "getOperation">) {}

  async verify(input: { operation_id: string; tenant_id: string; principal_id: string; business_task_id?: string }) {
    const reject = (reason: string): never => {
      throw new EventProjectionError(`PC_READ_VERIFICATION_${reason}`, "Persisted READ verification rejected", false,
        { reason_codes: [`read_verification:${reason.toLowerCase()}`] });
    };
    let business = await this.events.getOperation(input.operation_id);
    if (!business) return reject("NOT_FOUND");
    if (business.tenant_id !== input.tenant_id || business.owner_principal_id !== input.principal_id
      || (input.business_task_id !== undefined && business.business_task_id !== input.business_task_id)) return reject("SCOPE_DENIED");
    if (business.operation_kind !== "READ") return reject("UNSUPPORTED_KIND");
    const before = business.state;
    if (!["DISPATCHED", "VERIFYING", "SUCCEEDED"].includes(before)) return reject("STATE_CONFLICT");
    const task = await this.events.getTask(business.business_task_id);
    const external = await this.gateway.getOperation(input.operation_id);
    if (!task || task.tenant_id !== input.tenant_id || task.owner_principal_id !== input.principal_id
      || !business.projection_complete || !task.projection_complete) return reject("SCOPE_DENIED");
    if (!external || external.operation_id !== input.operation_id || external.business_task_id !== business.business_task_id
      || external.tenant_id !== input.tenant_id || external.principal_id !== input.principal_id
      || business.external_operation_record_id !== external.operation_id || external.operation_kind !== "READ") return reject("RECORD_MISMATCH");
    const result = external.result;
    if (external.dispatch_state !== "COMPLETED" || external.outcome_state !== "KNOWN_SUCCESS"
      || !result || result.status !== "SUCCEEDED" || result.outcome_state !== "KNOWN_SUCCESS"
      || result.reconciliation_required || result.retryable) return reject("RESULT_STATE_CONFLICT");
    if (result.operation_id !== external.operation_id || result.contract_name !== "pc.tool-execution-result/1"
      || result.contract_version !== 1 || external.contract_name !== "pc.external-operation-record/1" || external.contract_version !== 1) return reject("RECORD_MISMATCH");
    let digest: string;
    let argumentDigest: string;
    if (!Array.isArray(external.evidence_refs) || !Array.isArray(result.external_evidence_refs)
      || !external.evidence_refs.every(ref => typeof ref === "string")
      || !result.external_evidence_refs.every(ref => typeof ref === "string")) return reject("EVIDENCE_MISMATCH");
    if (!Number.isFinite(Date.parse(result.completed_at)) || !Number.isFinite(Date.parse(external.updated_at))) return reject("RESULT_STATE_CONFLICT");
    try {
      digest = toolExecutionResultDigest(result);
      argumentDigest = mcpDigest(external.arguments);
    }
    catch { return reject("DIGEST_MISMATCH"); }
    if (result.result_digest !== digest || (before !== "DISPATCHED" && business.result_digest !== digest)
      || (before === "DISPATCHED" && business.result_digest !== undefined && business.result_digest !== digest)
      || !external.arguments || argumentDigest !== external.argument_digest
      || business.input_digest !== external.argument_digest) return reject("DIGEST_MISMATCH");
    const providerId = external.provider_operation_id;
    const stableTrace = providerId ? `eea://traces/${encodeURIComponent(providerId)}` : "";
    if (!providerId || result.provider_operation_id !== providerId || !stableTrace
      || external.evidence_refs.some(ref => !/^eea:\/\/(traces|operations)\/[A-Za-z0-9_.~%-]{1,256}$/u.test(ref))
      || !external.evidence_refs.includes(stableTrace) || !result.external_evidence_refs.includes(stableTrace)
      || mcpDigest(external.evidence_refs) !== mcpDigest(result.external_evidence_refs)
      || (before !== "DISPATCHED" && external.evidence_refs.some(ref => !business!.evidence_refs.includes(ref)))) return reject("EVIDENCE_MISMATCH");
    const evidence = [verifierRef, `gateway-operation:${external.operation_id}`, ...external.evidence_refs];
    if (before === "DISPATCHED") business = await this.events.recordReadVerification({ operation: business, state: "VERIFYING",
      result_digest: digest, evidence_refs: external.evidence_refs, verifier_version: READ_VERIFIER_VERSION, occurred_at: external.updated_at });
    if (business.state === "VERIFYING") business = await this.events.recordReadVerification({ operation: business, state: "SUCCEEDED",
      result_digest: digest, evidence_refs: evidence, verifier_version: READ_VERIFIER_VERSION, occurred_at: external.updated_at });
    const cursor = await this.events.getCursor({ producer: "pc-read-verifier", stream_kind: "OPERATION", stream_id: business.operation_id });
    if (business.state !== "SUCCEEDED" || business.result_digest !== digest || !business.evidence_refs.includes(verifierRef)
      || cursor?.last_event_id !== business.last_event_id || cursor.state !== "COMPLETE") return reject("EVIDENCE_MISMATCH");
    return { operation_id: business.operation_id, before_state: before, after_state: business.state,
      result_digest: digest, verifier_version: READ_VERIFIER_VERSION, reason_codes: [before === "SUCCEEDED" ? "read_already_verified" : "persisted_read_verified"],
      evidence_refs: evidence };
  }
}
