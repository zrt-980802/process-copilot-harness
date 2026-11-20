"""Read-only candidate/protected-resource comparison; emits hashes, never row dumps."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen
from run import ROOT, PROJECT, snapshot, capture

baseline = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
destination = Path(sys.argv[2])
if destination.exists():
    raise RuntimeError("Audit evidence already exists")
current = snapshot()
protected = {row["id"]: row for row in baseline["containers"]}
live = {row["id"]: row for row in current["containers"]}
keys = ["id", "image", "env_sha256", "mounts", "ports", "networks"]
differences = [{"name": before["name"], "field": key} for identifier, before in protected.items() for key in keys
               if identifier not in live or before[key] != live[identifier][key]]
own = [row for row in current["containers"] if row["project"] == PROJECT or row["name"].startswith("pc-real-ee-closure-01-user-")]
identifiers = capture(["docker", "ps", "-aq", "--filter", "label=pc.demo.project=pc-real-ee-closure-01"]).split()
own += [row for row in current["containers"] if any(row["id"].startswith(identifier) for identifier in identifiers) and row not in own]
old_volumes = set(baseline["volumes"])
own_mounts = [mount for row in own for mount in row["mounts"] if mount["Type"] == "volume"]
shared = sorted({mount["Name"] for mount in own_mounts if mount["Name"] in old_volumes})
ports = {}
for port, route in [(18790, "/api/ready"), (18791, "/api/ready"), (18792, "/api/health"), (18793, "/health")]:
    with urlopen(f"http://127.0.0.1:{port}{route}", timeout=10) as response:
        ports[str(port)] = response.status

databases = {}
for service in ["pc-postgres", "standalone-postgres"]:
    prefix = ["docker", "exec", f"{PROJECT}-{service}-1", "psql", "-U", "pc", "-d", "pc", "-At", "-c"]
    tables = capture(prefix + ["SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]).splitlines()
    rows = []
    for table in tables:
        identifier = '"' + table.replace('"', '""') + '"'
        literal = "'" + table.replace("'", "''") + "'"
        sql = f"SELECT json_build_object('table',{literal},'rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),''),'UTF8')),'hex')) FROM public.{identifier} t"
        rows.append(json.loads(capture(prefix + [sql])))
    databases[service] = rows

secrets = []
for row in own:
    config = json.loads(capture(["docker", "inspect", "--format", "{{json .Config.Env}}", row["id"]]))
    for entry in config:
        key, _, value = entry.partition("=")
        if any(marker in key for marker in ["PASSWORD", "SECRET", "API_KEY", "SIGNING_KEY"]) and len(value) > 8:
            secrets.append(value)
logs_dir = destination.parent / ("container-logs-" + str(time.time_ns()))
logs_dir.mkdir(parents=True)
for row in own:
    logs = subprocess.run(["docker", "logs", row["id"]], capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = logs.stdout + logs.stderr
    for value in secrets:
        text = text.replace(value, "[REDACTED]")
    (logs_dir / (row["name"] + ".log")).write_text(text, encoding="utf-8")

result = {"status": "PASS_ISOLATION_ONLY", "pc": current["pc"], "ee": current["ee"],
          "ee_source_unchanged": current["ee"]["sha256"] == baseline["ee"]["sha256"],
          "protected_count": len(protected), "protected_container_differences": differences,
          "old_volumes_preserved": old_volumes.issubset(current["volumes"]), "old_volume_count": len(old_volumes),
          "volume_count": len(current["volumes"]), "shared_old_data_volumes": shared,
          "task_containers": own, "health_http": ports, "pc_database_fingerprints": databases,
          "compose_sha256": hashlib.sha256((ROOT / "integration/real-ee-closure/compose.yml").read_bytes()).hexdigest(), "logs": str(logs_dir)}
if differences or shared or not result["ee_source_unchanged"] or not result["old_volumes_preserved"]:
    result["status"] = "FAIL_ISOLATION"
destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({key: result[key] for key in ["status", "ee_source_unchanged", "protected_count", "protected_container_differences", "old_volumes_preserved", "old_volume_count", "volume_count", "shared_old_data_volumes", "health_http"]}))
if result["status"] != "PASS_ISOLATION_ONLY":
    raise SystemExit(1)
