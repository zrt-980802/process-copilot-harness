"""Retire explicitly named previous-stage containers; retain every data volume.

No prune, image removal, network removal or filesystem deletion is performed.
"""
import json
from pathlib import Path
import subprocess

TARGETS = {
    "pc-dev09a-complete-verifier-1": "pc-dev09a-complete",
    "pc-dev09a-complete-web-1": "pc-dev09a-complete",
    "pc-dev09a-complete-postgres-1": "pc-dev09a-complete",
    "pc-dev09a-complete-mysql-1": "pc-dev09a-complete",
    "pc-workbench-demo-seed-1": "pc-workbench-demo",
}


def command(*args):
    return subprocess.check_output(["docker", *args], text=True, encoding="utf-8").strip()


volumes_before = sorted(command("volume", "ls", "-q").splitlines())
present = set(command("ps", "-a", "--format", "{{.Names}}").splitlines())
records = []
for name, project in TARGETS.items():
    if name not in present:
        continue
    container = json.loads(command("inspect", name))[0]
    if container["Config"]["Labels"].get("com.docker.compose.project") != project:
        raise RuntimeError(f"Unexpected owner for {name}; cleanup aborted")
    if name.endswith("seed-1") and (container["State"]["Running"] or container["State"]["ExitCode"] != 0):
        raise RuntimeError("Seed is not successfully completed; cleanup aborted")
    records.append({"name": name, "image": container["Config"]["Image"],
                    "running": container["State"]["Running"],
                    "volumes": [mount["Name"] for mount in container["Mounts"] if mount["Type"] == "volume"]})

evidence = Path("reports/docker-cleanup")
evidence.mkdir(parents=True, exist_ok=True)
report = {"scope": "Explicit previous-stage containers only", "containers": records,
          "volumes_before": volumes_before, "images_and_build_cache": "retained (build dependency chain and unrelated resources)"}
(evidence / "before.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
running = [item["name"] for item in records if item["running"]]
if running:
    command("stop", "--time", "20", *running)
if records:
    command("rm", *[item["name"] for item in records])
volumes_after = sorted(command("volume", "ls", "-q").splitlines())
if volumes_after != volumes_before:
    raise RuntimeError("Docker volume inventory changed unexpectedly")
report.update({"volumes_after": volumes_after, "all_volumes_preserved": True,
               "remaining_containers": command("ps", "-a", "--format", "{{.Names}} {{.Status}}").splitlines()})
(evidence / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"removed_containers": [item["name"] for item in records], "preserved_volume_count": len(volumes_after)}))
