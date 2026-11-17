"""Isolated real EE/MySQL, PC/Postgres, DSH and configured model acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import threading
from uuid import uuid4
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import contextmanager

import httpx
import pytest

evidence = Path("/evidence")
evidence.mkdir(exist_ok=True)
(evidence / "stop.request").unlink(missing_ok=True)
spec = importlib.util.spec_from_file_location("ee_fixture", "/ee/backend/tests/process_copilot_mcp/test_mcp_adapter_mysql.py")
ee = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ee)
original_context = ee.IsolatedMySQLTestContext
original_flask = ee._flask_server
original_scenario = ee._mcp_scenario


class LocalContext(original_context):
    def __enter__(self):
        value = super().__enter__()
        scenario.db = self
        return value


@contextmanager
def captured_flask(app):
    with original_flask(app) as url:
        scenario.ee_url = url
        yield url


async def scenario(mcp_url, *, account_id, project_code, revoke):
    await original_scenario(mcp_url, account_id=account_id, project_code=project_code, revoke=revoke)
    db = scenario.db
    with db.get_conn() as conn:
        for table in ("eea_spec_section", "eea_spec_review"):
            conn.execute(next(sql for sql in ee._ARCHITECTURE_SCHEMA
                              if f"CREATE TABLE IF NOT EXISTS {table} " in sql))
        conn.execute("UPDATE eea_harness_project_member SET role='editor', revision=revision+1 WHERE account_id=? AND project_code='EP37'", (account_id,))
        now = int(time.time())
        conn.execute("INSERT INTO eea_requirements (code,title,content,project_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            ("REQ-000001", "Power system monitoring", "Report power-state transitions and diagnose invalid voltage within 100ms.", "EP37", "new", now, now))
        conn.execute("INSERT INTO eea_ssts_document (ssts_code,ssts_title,project_code,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            ("SSTS-EP37-001", "Power monitoring technical specification", "EP37", "draft", now, now))
        conn.execute("INSERT INTO eea_spec_section (doc_type,doc_code,section_number,section_title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            ("SSTS", "SSTS-EP37-001", "1", "Scope", "FN-EP37-001 monitors voltage and power transitions; diagnostic latency must be <=100ms.", now, now))
    reviewer = ee.AuthStore(db.get_conn).create_account(username="mcp.reviewer", display_name="MCP Reviewer",
        email=None, password_hash="isolated-test-only-hash")
    ee.HarnessStore(db.get_conn).grant("EP37", int(reviewer["id"]), "reviewer", 0, account_id)
    store = ee.AuthStore(db.get_conn)
    role = store.create_role(role_key="pc_local_editor", name="PC local review", description="Isolated acceptance only", created_by=account_id)
    store.replace_role_permissions(int(role["id"]), {key: "allow" for key in (
        "page:projects", "page:requirements", "page:functions", "page:architecture", "action:architecture.edit")}, granted_by=account_id)
    for subject in (account_id, int(reviewer["id"])):
        store.replace_account_roles(subject, [int(role["id"])], assigned_by=account_id)

    class TransportProxy(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def forward(self):
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            headers = {key: value for key, value in self.headers.items() if key.lower() not in {"host", "content-length"}}
            response = httpx.request(self.command, f"{mcp_url}{self.path}", headers=headers, content=body, timeout=90)
            fault = evidence / "drop-write-once"
            if fault.exists() and b'ee.submit_ssts_review' in body:
                fault.unlink()
                self.close_connection = True
                return
            self.send_response(response.status_code)
            for key, value in response.headers.items():
                if key.lower() not in {"content-length", "transfer-encoding", "connection", "content-encoding"}:
                    self.send_header(key, value)
            self.send_header("content-length", str(len(response.content)))
            self.end_headers()
            self.wfile.write(response.content)

        do_POST = forward
        do_GET = forward
        do_DELETE = forward

    proxy = ThreadingHTTPServer(("127.0.0.1", 0), TransportProxy)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()
    env = dict(os.environ, HOST="0.0.0.0", PORT="3000",
        PC_RUNTIME_REGISTRY_STORE="postgres", PC_IDENTITY_STORE="postgres", PC_PROFILE_STORE="postgres",
        PC_RESOURCE_STORE="postgres", PC_GATEWAY_STORE="postgres", PC_EVENT_STORE="postgres", PC_SSTS_STORE="postgres",
        PC_GATEWAY_PROVIDER="ee_mcp", PC_BLOB_ROOT="/evidence/blobs", PC_MATERIALIZATION_ROOT="/evidence/workspaces",
        PC_ENVELOPE_SIGNING_KEY="local-dev09a-complete-signing-000000000000",
        PC_RUNTIME_SERVICE_SECRET="local-dev09a-runtime-service-0000000000",
        PC_PILOT_TENANT_ID="tenant_acceptance", PC_PILOT_ACCOUNT_KEY="pilot.acceptance",
        PC_PILOT_ACCOUNT_SECRET="LocalAcceptanceSecret123", PC_PILOT_EECLAW_ACCOUNT_ID=str(account_id),
        PC_REVIEWER_EE_ACCOUNT_ID=str(reviewer["id"]),
        EECLAW_ADAPTER_URL=scenario.ee_url, EECLAW_ADAPTER_SECRET=ee.EE_ADAPTER_SECRET,
        EE_MCP_ADAPTER_URL=f"http://127.0.0.1:{proxy.server_port}/mcp", EE_MCP_ADAPTER_SECRET=ee.MCP_SECRET,
        PC_WORKBENCH_RUNTIME_URL="http://127.0.0.1:3100",
        PC_EVENT_INGEST_SECRET="local-dev09a-event-ingest-00000000000")
    run_id = uuid4().hex
    runtime_env = dict(env, PORT="3100", PC_RUNTIME_ID=f"pc-dev09a-{run_id}", PC_RUNTIME_EPOCH="1",
        PC_RUNTIME_STATE_ROOT=f"/runtime-state/{run_id}/host",
        PC_RUNTIME_WORKSPACE=f"/runtime-state/{run_id}/workspace", DSH_HOME=f"/runtime-state/{run_id}/home",
        DSH_BIN="/usr/local/bin/dsh-source", DSH_BRIDGE_COMMAND="python",
        DSH_PYTHON_BRIDGE="/app/python/dsh_runtime_bridge.py", DSH_PROVIDER="deepseek-official",
        DSH_MODEL=os.environ.get("PC_DEV09A_MODEL", "deepseek-v4-flash"), DSH_REQUEST_TIMEOUT_MS="600000",
        PC_RUNTIME_TOOL_URL="http://127.0.0.1:3000/v1/internal/runtime-tools/execute",
        PC_EVENT_INGEST_URL="http://127.0.0.1:3000/v1/internal/events/ingest")
    processes = {}
    logs = {}

    def start(name):
        if name not in logs:
            logs[name] = (evidence / f"{name}.log").open("a")
        processes[name] = subprocess.Popen(["node", f"{name}.mjs"], env=runtime_env if name == "runtime" else env,
            stdout=logs[name], stderr=logs[name])
        url = "http://127.0.0.1:3100/health" if name == "runtime" else "http://127.0.0.1:3000/ready"
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if processes[name].poll() is not None:
                raise RuntimeError(f"{name} stopped; inspect {name}.log")
            try:
                if httpx.get(url, timeout=2).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(.3)
        raise RuntimeError(f"{name} readiness timeout")

    def stop(name):
        process = processes.pop(name, None)
        if process:
            process.terminate()
            try:
                process.wait(20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(5)

    def verify(mode):
        with (evidence / f"{mode}.log").open("w") as log:
            result = subprocess.run(["node", "verify.mjs", mode], env=env, stdout=log, stderr=log, timeout=1100)
        if result.returncode:
            raise RuntimeError(f"{mode} acceptance failed; inspect {mode}.log")
        print(f"{mode} PASS", flush=True)

    try:
        start("runtime")
        start("main")
        verify("setup")
        stop("main")
        start("main")
        verify("recover")
        stop("main")
        start("main")
        verify("approve")
        stop("main")
        start("main")
        verify("reconcile")
        stop("runtime")
        runtime_env["PC_RUNTIME_EPOCH"] = "2"
        start("runtime")
        verify("resume")
        (evidence / "result.json").write_text(json.dumps({"phase": "DEV-09A", "status": "BACKEND_PASS", "real_model": True}))
        print("Backend acceptance passed; local browser environment is ready on port 18090", flush=True)
        while not (evidence / "stop.request").exists():
            time.sleep(1)
    finally:
        for name in list(processes):
            stop(name)
        for log in logs.values():
            log.close()
        proxy.shutdown()
        proxy.server_close()


ee.IsolatedMySQLTestContext = LocalContext
ee._flask_server = captured_flask
ee._mcp_scenario = scenario
try:
    with pytest.MonkeyPatch.context() as patch:
        ee.test_real_mcp_streamable_http_project_filter_trace_and_revoke(patch)
except BaseException:
    (evidence / "result.json").write_text(json.dumps({"phase": "DEV-09A", "status": "FAIL"}))
    raise
