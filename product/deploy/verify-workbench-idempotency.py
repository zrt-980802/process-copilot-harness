"""Compare actual durable business records before and after both real seeds."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

root = Path(__file__).resolve().parents[1]
evidence = root / "reports" / "workbench-demo"
evidence.mkdir(parents=True, exist_ok=True)
snapshot_code = """
import hashlib,json
from session.db import get_conn
tables = ('eea_projects','eea_requirements','eea_functions','eea_requirement_functions',
          'eea_function_ssts_links','eea_ssts_document','eea_spec_section','eea_spec_review',
          'eea_harness_project_member','platform_accounts','platform_roles',
          'platform_account_roles','platform_role_permissions')
with get_conn() as conn:
    records = {name: sorted([dict(row) for row in conn.execute('SELECT * FROM '+name).fetchall()],
               key=lambda row: json.dumps(row,sort_keys=True,default=str)) for name in tables}
print(json.dumps({'counts':{name:len(rows) for name,rows in records.items()},
    'digest':hashlib.sha256(json.dumps(records,sort_keys=True,default=str).encode()).hexdigest()}))
"""


def ee_snapshot():
    output = subprocess.run(["docker", "exec", "pc-workbench-demo-ee-api-1", "python", "-c", snapshot_code],
                             capture_output=True, text=True, check=True)
    return json.loads(output.stdout)


def pc_snapshot():
    def request(path, token=None, data=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        call = urllib.request.Request("http://127.0.0.1:18091/api" + path, headers=headers,
                                      data=json.dumps(data).encode() if data is not None else None)
        with urllib.request.urlopen(call, timeout=30) as response:
            return json.load(response)
    token = request("/v1/pilot/sign-in", data={"tenant_id": "tenant_acceptance", "account_key": "pilot.acceptance", "secret": "LocalAcceptanceSecret123"})["access_token"]
    principal = request("/v1/identity/me", token)["principal"]
    tasks = request("/v1/ssts-tasks", token)["tasks"]
    projections = [request(f"/v1/ssts-tasks/{task['workspace_id']}", token) for task in tasks]
    digest = hashlib.sha256(json.dumps({"principal": principal, "tasks": projections}, sort_keys=True).encode()).hexdigest()
    return {"tasks": len(tasks), "drafts": sum(len(item["drafts"]) for item in projections), "digest": digest}


before = {"ee": ee_snapshot(), "pc": pc_snapshot()}
subprocess.run(["docker", "exec", "pc-workbench-demo-ee-api-1", "python", "-c",
                "from ee_mcp_adapter.demo import initialize; initialize()"], capture_output=True, text=True, check=True)
result = subprocess.run([sys.executable, "deploy/start-workbench-demo.py", "run", "--rm", "--no-deps", "seed"],
                         cwd=root, capture_output=True, text=True)
if result.returncode:
    raise RuntimeError("PC seed failed: " + result.stderr[-1000:])
after = {"ee": ee_snapshot(), "pc": pc_snapshot()}
assert before == after, json.dumps({"before": before, "after": after})
(evidence / "seed-idempotency.json").write_text(json.dumps({"status": "PASS", "before": before, "after": after}, indent=2))
print("Actual EE rows, permissions, reviews and PC tasks/inputs/draft hashes survive both repeated seeds: PASS")
