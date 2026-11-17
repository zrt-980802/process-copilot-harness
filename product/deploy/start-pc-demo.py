"""Read local EE account identifiers before starting an actual PC service."""
import json
import os
from pathlib import Path
import sys

if os.environ.get("PC_LOCAL_DEMO") != "1" or sys.argv[1:] not in (["main.mjs"], ["seed.mjs"]):
    raise RuntimeError("This launcher is restricted to the local demo API and seed")
accounts = json.loads(Path("/demo-bootstrap/accounts.json").read_text())
if accounts.get("mode") != "isolated-local-demo" or any(
    not isinstance(accounts.get(key), int) or accounts[key] < 1 for key in ("engineer", "reviewer")
):
    raise RuntimeError("Local EE account bootstrap is invalid")
os.environ["PC_PILOT_EECLAW_ACCOUNT_ID"] = str(accounts["engineer"])
os.environ["PC_REVIEWER_EE_ACCOUNT_ID"] = str(accounts["reviewer"])
os.execvp("node", ["node", sys.argv[1]])
