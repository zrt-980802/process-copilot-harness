import { IdentityAuthorizationService } from "../../packages/application/src/index.js";
import { PostgresIdentityAuthorizationRepository, PostgresGatewayRepository } from "../../packages/persistence/src/index.js";
import { buildApiServer } from "../../apps/api/src/server.js";
import { installAuthorizationMvp } from "../../apps/api/src/authorization-mvp.js";

const identity = new IdentityAuthorizationService(new PostgresIdentityAuthorizationRepository(process.env.DATABASE_URL!),
  process.env.PC_ENVELOPE_SIGNING_KEY!);
const audit = new PostgresGatewayRepository(process.env.DATABASE_URL!);
await identity.initialize(); await audit.initialize();
installAuthorizationMvp({ identity, audit });
const server = buildApiServer({ identityAuthorization: identity, databaseConfigured: true });
server.addHook("onClose", async () => { await identity.close(); await audit.close(); });
const url = new URL(await server.listen({ host: "127.0.0.1", port: 0 }));
console.log(JSON.stringify({ authorization_mvp_api_port: Number(url.port), pid: process.pid }));
process.once("SIGTERM", () => { void server.close(); });
