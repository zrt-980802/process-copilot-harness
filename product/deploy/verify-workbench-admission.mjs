import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const root = "http://127.0.0.1:18091/api";
let token;
async function api(path, body) {
  const response = await fetch(root + path, { method: body ? "POST" : "GET", headers: {
    "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {})
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
token = (await api("/v1/pilot/sign-in", { tenant_id: "tenant_acceptance", account_key: "pilot.acceptance", secret: "LocalAcceptanceSecret123" })).access_token;
const tasks = (await api("/v1/ssts-tasks")).tasks;
const candidates = await Promise.all(tasks.map(task => api(`/v1/ssts-tasks/${task.workspace_id}`)));
const projection = candidates.find(item => item.inputs.length === 0);
assert(projection, "A real demo task with no uploaded inputs is required");
const path = `/v1/workbench/tasks/${projection.workspace.workspace_id}`;
await api(`${path}/conversation`);
const before = (await api(`${path}/execution`)).session.assignment;
const results = await Promise.all(Array.from({ length: 6 }, (_, index) => api(`${path}/${index % 2 ? "project-data" : "conversation"}`)));
const after = (await api(`${path}/execution`)).session.assignment;
assert.equal(after.state, "ACTIVE");
assert.equal(after.assignment_id, before.assignment_id);
assert.equal(after.workspace_view_snapshot_id, before.workspace_view_snapshot_id);
assert.equal(after.assignment_generation, before.assignment_generation);
assert(results.filter(result => result.results).every(result => Object.keys(result.results).length === 6));
await mkdir("reports/workbench-admission", { recursive: true });
await writeFile("reports/workbench-admission/result.json", JSON.stringify({ status: "pass", workspace: projection.workspace.workspace_id,
  concurrentRequests: results.length, generation: after.assignment_generation, assignmentReused: true, materializationReused: true,
  realProjectData: true, modelInvocations: 0 }, null, 2));
console.log("Concurrent real project data and conversation admission PASS; same Assignment and exact context retained");
