import { createRuntimeHostServiceFromEnvironment } from "./bootstrap.js";
import { buildRuntimeHostServer } from "./server.js";

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "127.0.0.1";
const service = createRuntimeHostServiceFromEnvironment();
await service.initialize();
const server = buildRuntimeHostServer(service, process.env.PC_RUNTIME_SERVICE_SECRET);

await server.listen({ host, port });
