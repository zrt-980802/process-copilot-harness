import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { pathToFileURL } from "node:url";

const product = path.resolve(import.meta.dirname, "../../..");
const ee = process.env.FE_DEMO_EE_ROOT ?? "E:/shanzi_workspace/feishu-ee-agents-dev09a";
process.env.VITE_PROCESS_COPILOT_URL = process.env.VITE_PROCESS_COPILOT_URL ?? "http://127.0.0.1:18191/";
const eeVite = await import(pathToFileURL(path.join(ee, "frontend/node_modules/vite/dist/node/index.js")));
const pcServer = await createServer({ root: path.join(product, "apps/web"), configFile: false, plugins: [vue()],
  server: { host: "127.0.0.1", port: 18191, strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:18091", changeOrigin: false } } } });
await pcServer.listen();
const eeServer = await eeVite.createServer({ root: path.join(ee, "frontend"),
  configFile: path.join(ee, "frontend/vite.config.js"),
  server: { host: "127.0.0.1", port: 18192, strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:18092", changeOrigin: false } } } });
await eeServer.listen();
console.log("FE-DEMO-01 previews: PC http://127.0.0.1:18191 / EE http://127.0.0.1:18192");
async function close() { await Promise.all([pcServer.close(), eeServer.close()]); process.exit(0); }
process.on("SIGINT", close);
process.on("SIGTERM", close);
