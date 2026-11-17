"""Create only the first administrator of the guarded local EE demo database.

Run inside ee-api with PC_DEMO_ADMIN_PASSWORD supplied in memory. No schema
initialization, account resets, role replacement or project grants occur here.
"""
import json
import os

from ee_mcp_adapter.demo import guard
from platform_auth import AuthService, AuthStore
from session.db import get_conn

guard()
store = AuthStore(get_conn)
account = store.find_account_by_username("demo.admin")
if account is None:
    account = AuthService(store).bootstrap_admin(
        username="demo.admin", display_name="本地演示管理员", email="",
        password=os.environ["PC_DEMO_ADMIN_PASSWORD"],
    )
identity = store.effective_permissions(int(account["id"]))
if not identity["is_system_admin"]:
    raise RuntimeError("Existing demo.admin is not an administrator; account left unchanged")
print(json.dumps({"username": account["username"], "account_id": account["id"],
                  "is_system_admin": True, "mode": "isolated-local-demo"}))
