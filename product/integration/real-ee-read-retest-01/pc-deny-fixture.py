import os
from ee_mcp_adapter.demo import guard
from eea.governance.harness_store import HarnessStore
from platform_auth import AuthStore
from platform_auth.security import hash_password
from session.db import get_conn

guard()
if os.environ.get("RC_TASK") != "REAL-EE-READ-RETEST-01":
    raise RuntimeError("Wrong isolated fixture")
username = os.environ["RC_TEST_USER"]
if not username.startswith("rc.pcdeny-"):
    raise RuntimeError("Wrong fixture account")
store = AuthStore(get_conn)
account = store.create_account(username=username, display_name="PC Deny fixture", email=None,
                               password_hash=hash_password(os.environ["RC_TEST_PASSWORD"]))
role = store.create_role(role_key=username.replace(".", "_").replace("-", "_"), name="PC Deny fixture", description="Isolated test", created_by=int(account["id"]))
store.replace_role_permissions(int(role["id"]), {"page:projects": "allow"}, granted_by=int(account["id"]))
store.replace_account_roles(int(account["id"]), [int(role["id"])], assigned_by=int(account["id"]))
HarnessStore(get_conn).grant("RCI-ENG", int(account["id"]), "reader", 0, int(account["id"]))
print("PC_DENY_FIXTURE_CREATED")
