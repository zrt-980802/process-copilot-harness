import type { EventProjectionService } from "@pc/event-projection";
import type { GatewayEventPublisherPort, GatewayRepository } from "@pc/gateway";
import { ReadOperationVerifier } from "./read-operation-verifier.js";

export function gatewayEventPublisher(events: EventProjectionService, repository: Pick<GatewayRepository, "getOperation">): GatewayEventPublisherPort {
  const verifier = new ReadOperationVerifier(events, repository);
  return {
    verifyReadOperation: async input => { await verifier.verify(input); },
    approvalState: async input => {
      const operation = await events.getOperation(input.operation_id);
      if (!operation || operation.state === input.state) return;
      await events.transitionOperation({ ...input, producer: "pc-gateway" });
    },
    operationState: async input => {
      const operation = await events.getOperation(input.operation_id);
      if (!operation || operation.state === input.state) return;
      await events.transitionOperation({ ...input, producer: "pc-gateway" });
    }
  };
}
