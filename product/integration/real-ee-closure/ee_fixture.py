"""Existing EE services over a fresh task-owned database; no production imports/config."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time


def guard():
    from ee_mcp_adapter.demo import guard as existing_guard
    existing_guard()
    if os.environ.get("RC_TASK") != "REAL-EE-INTEGRATION-CLOSURE-01":
        raise RuntimeError("Task isolation guard failed")


def seed():
    guard()
    from session.db import get_conn
    from platform_auth import AuthStore, init_platform_auth_schema
    from platform_auth.security import hash_password
    from eea.requirements.schema import init_requirements_schema
    from eea.projects.schema import init_projects_schema
    from eea.functions.schema import init_functions_schema
    from eea.architecture.schema import init_architecture_schema
    from eea.governance.schema import init_governance_schema
    from eea.governance.harness_store import HarnessStore
    from eea.architecture.documents import DocumentRepository
    marker = Path("/demo-bootstrap/real-ee-closure.json")
    with get_conn() as conn:
        instance = conn.execute("SELECT @@server_uuid AS id").fetchone()["id"]
    if marker.exists():
        if json.loads(marker.read_text())["instance"] != instance:
            raise RuntimeError("Database instance changed; refusing reseed")
        return
    init_platform_auth_schema(get_conn)
    with get_conn() as conn:
        for initializer in [init_requirements_schema, init_projects_schema, init_functions_schema, init_architecture_schema, init_governance_schema]:
            initializer(conn)
    store = AuthStore(get_conn)
    harness = HarnessStore(get_conn)
    harness.ensure_schema()
    full = ["page:projects", "page:requirements", "page:functions", "page:architecture", "action:architecture.edit"]
    matrix = {"engineer": (full, {"RCI-ENG": "editor", "RCI-FULLA": "editor"}),
              "reviewer": (full[:-1], {"RCI-FULLB": "reviewer"}),
              "generic": (["page:projects"], {"RCI-GENERIC": "reader"}),
              "zero": (full, {}), "admin": (full + ["action:accounts.manage"], {})}
    accounts = {}
    for key, (permissions, memberships) in matrix.items():
        account = store.find_account_by_username(f"rc.{key}") or store.create_account(username=f"rc.{key}", display_name=f"RC {key}", email=None,
            password_hash=hash_password(os.environ[f"RC_{key.upper()}_PASSWORD"]))
        with get_conn() as conn:
            role = conn.execute("SELECT id FROM platform_roles WHERE role_key=?", (f"rc_{key}",)).fetchone()
        role = role or store.create_role(role_key=f"rc_{key}", name=f"RC {key}", description="Task-owned synthetic integration account", created_by=int(account["id"]))
        store.replace_role_permissions(int(role["id"]), {key: "allow" for key in permissions}, granted_by=int(account["id"]))
        store.replace_account_roles(int(account["id"]), [int(role["id"])], assigned_by=int(account["id"]))
        accounts[key] = {"account_id": int(account["id"]), "username": f"rc.{key}", "permissions": permissions, "memberships": memberships}
    now = int(time.time())
    for project, name in [("RCI-GENERIC", "RC Generic Project"), ("RCI-ENG", "RC Engineering Without Specifications"),
                          ("RCI-FULLA", "RC Alpha Engineering"), ("RCI-FULLB", "RC Beta Engineering")]:
        with get_conn() as conn:
            conn.execute("INSERT INTO eea_projects(code,name,status,created_at,updated_at) VALUES(?,?,'active',?,?)", (project, name, now, now))
            if project != "RCI-GENERIC":
                req, fun = f"REQ-{project}-1", f"FN-{project}-1"
                conn.execute("INSERT INTO eea_requirements(code,title,content,project_code,status,priority,owner,created_at,updated_at) VALUES(?,?,?,?,'new','high','RC',?,?)",
                    (req, f"{project} supply supervision", f"{project}: diagnose invalid supply within 100ms; confirmed input version 1.", project, now, now))
                req_id = conn.execute("SELECT id FROM eea_requirements WHERE code=?", (req,)).fetchone()["id"]
                conn.execute("INSERT INTO eea_functions(code,title,description,project_code,project,status,priority,source_requirement_code,created_at,updated_at) VALUES(?,?,?,?,?,'new','high',?,?,?)",
                    (fun, f"{project} supervision function", "Recover after stable input for 500ms; thresholds remain open.", project, project, req, now, now))
                fun_id = conn.execute("SELECT id FROM eea_functions WHERE code=?", (fun,)).fetchone()["id"]
                conn.execute("INSERT INTO eea_requirement_functions(requirement_id,requirement_code,function_id,function_code,relation_type,project_code,created_at) VALUES(?,?,?,?,'implements',?,?)",
                    (req_id, req, fun_id, fun, project, now))
                if project.startswith("RCI-FULL"):
                    code = f"SSTS-{project}-1"
                    repo = DocumentRepository(conn)
                    repo.create_document("SSTS", {"ssts_code": code, "ssts_title": f"{project} source specification", "project_code": project, "associated_functions": [fun]})
                    repo.upsert_section("SSTS", code, {"section_number": "1", "section_title": "Source version 1", "content": f"{req} / {fun}: 100ms diagnosis and 500ms stable recovery. Task-owned synthetic engineering data."})
                    conn.execute("INSERT INTO eea_function_ssts_links(function_id,function_code,ssts_code,project_code,relation_type,status,mapping_method,created_at,updated_at) VALUES(?,?,?,?,'writes_to','confirmed','manual',?,?)",
                        (fun_id, fun, code, project, now, now))
        for account in accounts.values():
            if project in account["memberships"]:
                harness.grant(project, account["account_id"], account["memberships"][project], 0, accounts["engineer"]["account_id"])
    marker.write_text(json.dumps({"instance": instance, "accounts": accounts}))
    print(json.dumps({"seed": "complete", "accounts": accounts}), flush=True)


def membership(role):
    guard()
    from eea.governance.harness_store import HarnessStore
    state = json.loads(Path("/demo-bootstrap/real-ee-closure.json").read_text())
    account = state["accounts"]["engineer"]["account_id"]
    store = HarnessStore()
    previous = store.member("RCI-FULLA", account)
    result = store.grant("RCI-FULLA", account, role, int(previous["revision"]), account)
    print(json.dumps({"membership": result}), flush=True)


def fingerprint():
    guard()
    from session.db import get_conn
    tables = ["platform_accounts", "platform_roles", "platform_role_permissions", "platform_account_roles", "eea_harness_project_member", "eea_projects", "eea_requirements", "eea_functions", "eea_ssts_document", "eea_document_sections"]
    result = {}
    with get_conn() as conn:
        available = {next(iter(row.values())) for row in conn.execute("SHOW TABLES").fetchall()}
        for table in sorted(available):
            if table not in tables and not any(word in table for word in ["trace", "audit"]):
                continue
            rows = [dict(row) for row in conn.execute(f"SELECT * FROM `{table}`").fetchall()]
            serialized = sorted(json.dumps(row, sort_keys=True, default=str) for row in rows)
            result[table] = {"rows": len(rows), "sha256": hashlib.sha256(json.dumps(serialized).encode()).hexdigest()}
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    guard()
    action = sys.argv[1]
    if action == "serve":
        seed()
        from ee_mcp_adapter.demo import create_web_app
        from werkzeug.serving import run_simple
        run_simple("0.0.0.0", 5000, create_web_app(), threaded=True, use_reloader=False)
    elif action in ("revoke", "restore"):
        membership("revoked" if action == "revoke" else "editor")
    elif action == "fingerprint":
        fingerprint()
    else:
        raise RuntimeError("Unknown isolated fixture action")
