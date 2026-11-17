"""Local Docker integration: real EE fixture + production PC API + PostgreSQL."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import unquote

import httpx
import pytest
import yaml


config_path = Path(os.environ["DEV09A_MYSQL_TEST_CONFIG"])
config = yaml.safe_load(config_path.read_text())["mysql"]
assert config["host"] == "mysql" and config["port"] == 3306
assert config["mode"] == "isolated" and config["user"] == "root"
assert "@postgres:5432/pc_dev09a3" in os.environ["DATABASE_URL"]

source = Path("/ee/backend/tests/process_copilot_mcp/test_mcp_adapter_mysql.py")
spec = importlib.util.spec_from_file_location("ee_real_mcp_fixture", source)
ee = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ee)
original_scenario = ee._mcp_scenario
evidence = Path("/evidence")
evidence.mkdir(exist_ok=True)
(evidence / "result.json").write_text(json.dumps({"phase": "DEV-09A-3", "status": "RUNNING"}))


class VerifiedMySQLContext(ee.IsolatedMySQLTestContext):
    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                state = json.loads((evidence / "state.json").read_text())
                setup = json.loads((evidence / "setup.json").read_text())
                session = state["envelope"]["principal_envelope"]["pc_session_id"]
                with self.get_conn() as conn:
                    rows = conn.execute("""
                        SELECT trace_id, root_trace_id, caller_type, caller_id,
                               capability_id, span_type, status, input_summary, output_summary
                        FROM eea_governance_trace WHERE session_id = ?
                    """, (session,)).fetchall()
                refs = {unquote(ref.rsplit("/", 1)[-1]) for ref in setup["ledger"]["evidence_refs"]}
                assert refs <= {row["trace_id"] for row in rows}
                assert {row["caller_id"] for row in rows} == {str(desktop_scenario.account_id)}
                assert any(row["capability_id"] == "eea.functions.eea_list_functions" for row in rows)
                serialized = json.dumps(rows, indent=2)
                assert ee.MCP_SECRET not in serialized and ee.EE_ADAPTER_SECRET not in serialized
                (evidence / "ee-traces.json").write_text(serialized)
        finally:
            super().__exit__(exc_type, exc, tb)


ee.IsolatedMySQLTestContext = VerifiedMySQLContext


async def desktop_scenario(mcp_url, *, account_id, project_code, revoke):
    # The EE fixture owns the real authorization URL used to construct the Adapter.
    ee_url = desktop_scenario.ee_url
    desktop_scenario.account_id = account_id
    env = dict(os.environ, HOST="127.0.0.1", PORT="3000",
        PC_RUNTIME_REGISTRY_STORE="postgres", PC_IDENTITY_STORE="postgres",
        PC_PROFILE_STORE="postgres", PC_RESOURCE_STORE="postgres",
        PC_GATEWAY_STORE="postgres", PC_EVENT_STORE="postgres",
        PC_GATEWAY_PROVIDER="ee_mcp", PC_SSTS_STORE="disabled",
        PC_BLOB_ROOT="/evidence/blobs", PC_MATERIALIZATION_ROOT="/evidence/workspaces",
        PC_ENVELOPE_SIGNING_KEY="local-dev09a3-signing-key-00000000000000",
        PC_PILOT_TENANT_ID="tenant-dev09a3", PC_PILOT_ACCOUNT_KEY="pilot-dev09a3",
        PC_PILOT_ACCOUNT_SECRET="LocalDev09a3Pilot123",
        PC_PILOT_EECLAW_ACCOUNT_ID=str(account_id),
        EECLAW_ADAPTER_URL=ee_url, EECLAW_ADAPTER_SECRET=ee.EE_ADAPTER_SECRET,
        EE_MCP_ADAPTER_URL=f"{mcp_url}/mcp", EE_MCP_ADAPTER_SECRET=ee.MCP_SECRET)
    api = None
    with (evidence / "api.log").open("w") as log:
        def stop():
            nonlocal api
            if api is not None:
                api.terminate()
                try:
                    api.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    api.kill()
                    api.wait(timeout=5)
                api = None

        def start():
            nonlocal api
            api = subprocess.Popen(["node", "main.mjs"], env=env, stdout=log, stderr=log)
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if api.poll() is not None:
                    raise RuntimeError("PC API stopped; inspect /evidence/api.log")
                try:
                    if httpx.get("http://127.0.0.1:3000/ready", timeout=1).status_code == 200:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(0.2)
            raise RuntimeError("PC API did not become ready")

        def verify(mode):
            result = subprocess.run(["node", "verify.mjs", mode], env=env,
                text=True, capture_output=True, timeout=90)
            (evidence / f"{mode}.log").write_text(result.stdout + result.stderr)
            if result.returncode:
                raise RuntimeError(f"PC {mode} failed; inspect /evidence/{mode}.log")
            print(result.stdout, flush=True)

        try:
            start()
            verify("setup")
            stop()
            start()
            verify("recover")
            await original_scenario(mcp_url, account_id=account_id,
                project_code=project_code, revoke=revoke)
            verify("revoked")
        finally:
            stop()
    secrets = (ee.MCP_SECRET, ee.EE_ADAPTER_SECRET)
    for path in evidence.glob("*.log"):
        assert all(secret not in path.read_text() for secret in secrets), path.name


original_flask_server = ee._flask_server
from contextlib import contextmanager


@contextmanager
def captured_flask_server(app):
    with original_flask_server(app) as url:
        desktop_scenario.ee_url = url
        yield url


ee._flask_server = captured_flask_server
ee._mcp_scenario = desktop_scenario
try:
    with pytest.MonkeyPatch.context() as patch:
        ee.test_real_mcp_streamable_http_project_filter_trace_and_revoke(patch)
except BaseException:
    (evidence / "result.json").write_text(json.dumps({"phase": "DEV-09A-3", "status": "FAIL"}))
    raise
(evidence / "result.json").write_text(json.dumps({
    "phase": "DEV-09A-3", "status": "PASS", "pc_api_restart": True,
    "real_ee_mysql": True, "pc_postgres": True, "secrets_in_logs": False,
    "runtime_assignment": "registry fixture; no DSH or model execution claimed"
}, indent=2))
print("DEV-09A-3 real EE + PC integration PASS", flush=True)
