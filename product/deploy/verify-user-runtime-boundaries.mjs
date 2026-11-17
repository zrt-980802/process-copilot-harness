import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 }).trim();
const names = () => docker("ps", "--filter", "label=pc.demo.project=pc-workbench-demo", "--format", "{{.Names}}").split("\n").filter(Boolean).sort();
const before = names();
assert(before.length >= 3);
const statuses = JSON.parse(docker("exec", "pc-workbench-demo-pc-api-1", "node", "-e", `
const url = 'http://user-runtime-manager:3200/v1/user-runtimes/ensure';
const owner = {tenant_id:'tenant_acceptance',principal_id:'00000000-0000-0000-0000-000000000001'};
const cases = [
  {body:owner,secret:false},
  {body:{...owner,tenant_id:'foreign'},secret:true},
  {body:{...owner,principal_id:'../../escape'},secret:true},
  {body:{...owner,image:'caller-image',mounts:['/']},secret:true}
];
const statuses=[];
for(const input of cases) {
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(input.secret?{'x-pc-runtime-secret':process.env.PC_RUNTIME_SERVICE_SECRET}:{})},body:JSON.stringify(input.body)});
 statuses.push(r.status);
}
console.log(JSON.stringify(statuses));`));
assert.deepEqual(statuses, [401, 400, 400, 400]);
assert.deepEqual(names(), before);
const checks = [];
const volumes = [];
for (const name of before) {
  const labels = JSON.parse(docker("inspect", "--format", "{{json .Config.Labels}}", name));
  const actual = JSON.parse(docker("exec", name, "node", "--input-type=module", "-e", `
import fs from 'node:fs';
const owner=process.env.PC_RUNTIME_OWNER_USER_ID;
const response=await fetch('http://127.0.0.1:3100/capabilities');
const command={contract_name:'pc.runtime-command/1',contract_version:1,command_id:'boundary-'+crypto.randomUUID(),
command_type:'ASSIGN_SESSION',runtime_id:process.env.PC_RUNTIME_ID,runtime_epoch:1,
pc_session_id:'boundary-foreign-user',assignment_generation:1,fencing_token:'boundary',expected_state_version:'0',
deadline:new Date(Date.now()+60000).toISOString(),payload:{user_id:'another-user',tenant_id:process.env.PC_RUNTIME_TENANT_ID}};
const rejected=await (await fetch('http://127.0.0.1:3100/v1/runtime/commands',{method:'POST',headers:{'content-type':'application/json','x-pc-runtime-secret':process.env.PC_RUNTIME_SERVICE_SECRET},body:JSON.stringify(command)})).json();
console.log(JSON.stringify({owner,capabilities_without_service_secret:response.status,
users_on_filesystem:fs.readdirSync('/data/workspaces/tenant_acceptance'),blob_access:fs.existsSync('/data/blobs'),
socket_access:fs.existsSync('/var/run/docker.sock'),assignment_accepted:rejected.accepted,assignment_error:rejected.adapter_error?.code}));`));
  assert.equal(actual.owner, labels["pc.demo.owner"]);
  assert.deepEqual(actual.users_on_filesystem, [actual.owner]);
  assert.equal(actual.blob_access, false);
  assert.equal(actual.socket_access, false);
  assert.equal(actual.capabilities_without_service_secret, 401);
  assert.equal(actual.assignment_accepted, false);
  assert.equal(actual.assignment_error, "PC_RUNTIME_OWNER_SCOPE_DENIED");
  const mounts = JSON.parse(docker("inspect", "--format", "{{json .Mounts}}", name));
  volumes.push(mounts.find(m => m.Destination === "/runtime-state").Name);
  checks.push({ runtime: name, ...actual });
}
assert.equal(new Set(volumes).size, before.length);
const result = { status: "PASS", manager_negative_statuses: statuses, distinct_state_volumes: volumes.length, checks };
await writeFile(`${process.env.PC_TEST_EVIDENCE_DIR ?? "reports/multi-user-conversation"}/runtime-boundaries.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
