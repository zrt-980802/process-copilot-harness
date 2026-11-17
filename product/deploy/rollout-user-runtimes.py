"""Explicit local Runtime image rollout; preserve every user's state volume."""
import json
import re
import subprocess
import sys


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=60).strip()


names = sys.argv[1:]
if not names:
    raise SystemExit("Pass the exact pc-workbench-user-<24 hex> container names to roll out")
template_image = docker("inspect", "--format", "{{.Image}}", "pc-workbench-demo-pc-runtime-1")
try:
    docker("image", "inspect", template_image, "--format", "{{.Id}}")
except subprocess.CalledProcessError:
    raise SystemExit("Template image is unavailable. Recreate pc-runtime before removing any user Runtime; all user containers/volumes were retained.") from None
checked = []
for name in names:
    if not re.fullmatch(r"pc-workbench-user-[0-9a-f]{24}", name):
        raise SystemExit("Only explicitly named local user Runtimes may be rolled out")
    item = json.loads(docker("inspect", name))[0]
    labels = item["Config"].get("Labels", {})
    if labels.get("pc.demo.project") != "pc-workbench-demo" or labels.get("pc.demo.tenant") != "tenant_acceptance":
        raise SystemExit("Container is outside the local demo")
    if not re.fullmatch(r"[0-9a-f-]{36}", labels.get("pc.demo.owner", "")):
        raise SystemExit("Container owner label is missing")
    if item["State"]["Running"]:
        health = json.loads(docker("exec", name, "node", "-e",
            "console.log(await (await fetch('http://127.0.0.1:3100/health')).text())"))
        if health.get("active_sessions") != 0 or health.get("revoking_sessions") != 0:
            raise SystemExit("Runtime has an active turn or revocation; retry after it completes: " + name)
    if not any(m.get("Type") == "volume" and m.get("Destination") == "/runtime-state" for m in item["Mounts"]):
        raise SystemExit("Runtime has no durable state volume")
    checked.append(name)

print("Rolling out exactly: " + ", ".join(checked))
for name in checked:
    docker("stop", "--time", "30", name)
    docker("rm", name)
print("State volumes retained. The next authenticated execution recreates each Runtime from the current local template.")
