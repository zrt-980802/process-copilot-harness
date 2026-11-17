"""Verify service replacement without restarting Web or losing demo artifacts."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
evidence = root / "reports" / "workbench-demo"


def state():
    records = {}
    for name in ("web", "pc-api", "ee-mcp-adapter", "ee-api", "pc-runtime"):
        value = subprocess.run(["docker", "inspect", "--format", "{{.Id}}|{{json .NetworkSettings.Networks}}",
                                f"pc-workbench-demo-{name}-1"], capture_output=True, text=True, check=True).stdout.strip()
        container_id, networks = value.split("|", 1)
        records[name] = {"container_id": container_id, "control_ip": json.loads(networks)["pc-workbench-demo_control"]["IPAddress"]}
    return records


before = state()
subprocess.run([sys.executable, "deploy/start-workbench-demo.py", "restart", "ee-api", "ee-mcp-adapter", "pc-api", "pc-runtime"], cwd=root, check=True)
deadline = time.monotonic() + 120
while True:
    try:
        with urllib.request.urlopen("http://127.0.0.1:18091/api/ready", timeout=3) as response:
            assert response.status == 200
        break
    except (urllib.error.URLError, TimeoutError):
        if time.monotonic() >= deadline:
            raise RuntimeError("Web proxy did not recover after service restart")
        time.sleep(1)
after = state()
assert before["web"]["container_id"] == after["web"]["container_id"], "Web must not restart to recover DNS"
credentials = json.dumps({"tenant_id": "tenant_acceptance", "account_key": "pilot.acceptance", "secret": "LocalAcceptanceSecret123"}).encode()
with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:18091/api/v1/pilot/sign-in", data=credentials,
    headers={"Content-Type": "application/json"}), timeout=10) as response:
    token = json.load(response)["access_token"]
draft = json.loads((evidence / "real-model-draft.json").read_text())
with urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:18091/api/v1/ssts-tasks/{draft['workspace_id']}",
    headers={"Authorization": f"Bearer {token}"}), timeout=10) as response:
    task = json.load(response)
assert any(item["content_digest"] == draft["content_digest"] for item in task["drafts"])
(evidence / "restart-persistence.json").write_text(json.dumps({"status": "PASS", "before": before, "after": after,
    "api_ip_changed": before["pc-api"]["control_ip"] != after["pc-api"]["control_ip"], "web_restarted": False,
    "login": "PASS", "draft_digest_preserved": draft["content_digest"]}, indent=2))
print("API/EE/MCP/Runtime restarted; unchanged Web recovered, login and actual model draft persistence PASS")
