import { createHash } from "node:crypto";
import type {
  CredentialIssuerPort,
  GatewayProviderPort
} from "./types.js";
import { GatewayProviderError } from "./types.js";

export class EphemeralCredentialIssuer implements CredentialIssuerPort {
  issue(
    input: Parameters<CredentialIssuerPort["issue"]>[0]
  ): Promise<{
    access_token: string;
    credential_subject: string;
    binding_mode: "bearer";
  }> {
    const material = [
      input.connector.connector_id,
      input.account.external_account_binding_id,
      input.account.credential_generation,
      input.expires_at
    ].join(":");
    return Promise.resolve({
      access_token: `ephemeral.${createHash("sha256")
        .update(material)
        .digest("base64url")}`,
      credential_subject: input.account.credential_subject,
      binding_mode: "bearer"
    });
  }
}

export class DeterministicGatewayProvider implements GatewayProviderPort {
  readonly dispatches: Array<{
    operation_id: string;
    access_token_digest: string;
  }> = [];

  dispatch(
    input: Parameters<GatewayProviderPort["dispatch"]>[0]
  ): Promise<{
    provider_operation_id: string;
    result: Record<string, unknown>;
    external_evidence_refs: string[];
  }> {
    this.dispatches.push({
      operation_id: input.operation_id,
      access_token_digest: createHash("sha256")
        .update(input.access_token)
        .digest("hex")
    });
    const providerOperationId = `provider:${input.operation_id}`;
    if (input.arguments.simulate === "unknown") {
      throw new GatewayProviderError(
        "PC_PROVIDER_TRANSPORT_LOST",
        "Provider transport was lost after dispatch",
        true,
        false,
        providerOperationId
      );
    }
    if (input.arguments.simulate === "failure") {
      throw new GatewayProviderError(
        "PC_PROVIDER_REJECTED",
        "Provider rejected the operation before applying it",
        false,
        false,
        providerOperationId
      );
    }
    return Promise.resolve({
      provider_operation_id: providerOperationId,
      result: {
        accepted: true,
        operation_id: input.operation_id,
        connector_id: input.connector.connector_id,
        protocol_session_id:
          input.mcp_binding.protocol_session_id ?? null
      },
      external_evidence_refs: [`provider-evidence:${input.operation_id}`]
    });
  }

  reconcile(
    input: Parameters<GatewayProviderPort["reconcile"]>[0]
  ): ReturnType<GatewayProviderPort["reconcile"]> {
    if (input.operation.provider_operation_id === undefined) {
      return Promise.resolve({
        outcome: "OUTCOME_UNKNOWN",
        evidence_refs: ["provider-reconciliation:no-reference"]
      });
    }
    return Promise.resolve({
      outcome: "KNOWN_SUCCESS",
      provider_operation_id: input.operation.provider_operation_id,
      result: {
        reconciled: true,
        operation_id: input.operation.operation_id
      },
      evidence_refs: [
        `provider-reconciliation:${input.operation.provider_operation_id}`
      ]
    });
  }
}
