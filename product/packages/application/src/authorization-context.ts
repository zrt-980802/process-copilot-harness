import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface AuthorizationRequestContext {
  readonly logical_request_id: string;
  pc_session_id?: string;
  principal_id?: string;
  last_decision?: { decision_id: string; decision_mode: string; decision: string; reason_codes: readonly string[];
    principal_id: string; pc_session_id: string; resource_ref: string };
}

const requests = new AsyncLocalStorage<AuthorizationRequestContext>();

export function authorizationRequestContext() { return requests.getStore(); }

export function runAuthorizationRequest<T>(action: () => T): T {
  return requests.run({ logical_request_id: `request:${randomUUID()}` }, action);
}
