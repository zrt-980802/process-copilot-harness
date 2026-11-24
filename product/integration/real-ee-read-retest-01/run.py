"""Only this task's isolated Compose project; credentials never printed or saved."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "pc-real-ee-read-retest-01"
COMPOSE = ROOT / "integration/real-ee-read-retest-01/compose.yml"
EE = Path("E:/shanzi_workspace/feishu-ee-agents-dev09a")


def command(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def capture(args):
    return command(args, capture_output=True, text=True).stdout


def image(name):
    identifier = capture(["docker", "image", "inspect", name, "--format", "{{.Id}}"]).strip()
    tag = "real-ee-read-retest-01-base:" + identifier[7:19]
    command(["docker", "image", "tag", identifier, tag])
    return tag


def environment(existing=False):
    env = dict(os.environ)
    env.update(RC_EE_ROOT=str(EE).replace("\\", "/"), RC_BASE_IMAGE=image("vertical-demo-closure-01-runtime:local"),
               RC_NGINX_IMAGE=image("nginx:alpine"), RC_MYSQL_IMAGE=image("mysql:8.0.39"), RC_POSTGRES_IMAGE=image("postgres:17-alpine"))
    if existing:
        for service in ("ee-api", "ee-mysql", "pc-postgres", "pc-api", "standalone-api", "pc-runtime", "ee-mcp-adapter"):
            values = json.loads(capture(["docker", "inspect", "--format", "{{json .Config.Env}}", f"{PROJECT}-{service}-1"]))
            config = dict(value.split("=", 1) for value in values if "=" in value)
            for name, value in config.items():
                if name.startswith("RC_") or name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"):
                    env[name] = value
            mappings = {"MYSQL_PASSWORD": "RC_MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD": "RC_MYSQL_ROOT_PASSWORD", "POSTGRES_PASSWORD": "RC_POSTGRES_PASSWORD",
                        "PC_ENVELOPE_SIGNING_KEY": "RC_SIGNING_KEY", "PC_RUNTIME_SERVICE_SECRET": "RC_RUNTIME_SECRET", "PC_EVENT_INGEST_SECRET": "RC_EVENT_SECRET",
                        "EECLAW_ADAPTER_SECRET": "RC_EE_SECRET", "EE_MCP_ADAPTER_SECRET": "RC_MCP_SECRET", "PC_PILOT_ACCOUNT_SECRET": "RC_PERSONAL_PASSWORD", "DSH_MODEL": "RC_MODEL"}
            for old, new in mappings.items():
                if config.get(old): env[new] = config[old]
    else:
        for name in ("MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "POSTGRES_PASSWORD", "SIGNING_KEY", "RUNTIME_SECRET", "EVENT_SECRET", "EE_SECRET", "MCP_SECRET",
                     "PERSONAL_PASSWORD", "ENGINEER_PASSWORD", "REVIEWER_PASSWORD", "GENERIC_PASSWORD", "ZERO_PASSWORD", "ADMIN_PASSWORD"):
            env["RC_" + name] = "Rc1_" + secrets.token_urlsafe(32)
        if not env.get("DEEPSEEK_API_KEY"):
            import yaml
            credentials = yaml.safe_load((Path.home() / ".dsh/.credentials.yaml").read_text(encoding="utf-8"))
            env["DEEPSEEK_API_KEY"] = credentials.get("refs", {}).get("DEEPSEEK_API_KEY", "")
        env.setdefault("RC_MODEL", "deepseek-chat")
    return env


def compose(env, args, **kwargs):
    if any(arg in ("down", "rm", "prune") for arg in args):
        raise RuntimeError("Resource deletion is outside this task runner")
    return command(["docker", "compose", "-p", PROJECT, "-f", str(COMPOSE), *args], env=env, **kwargs)


def wait_ready():
    from urllib.request import urlopen
    deadline = time.monotonic() + 180
    for url in ("http://127.0.0.1:18891/api/ready", "http://127.0.0.1:18890/api/ready"):
        while True:
            try:
                with urlopen(url, timeout=3) as response:
                    if response.status == 200: break
            except Exception:
                if time.monotonic() > deadline: raise RuntimeError("Candidate readiness timeout")
                time.sleep(2)


def snapshot():
    def source(root):
        files = set(capture_at(root, ["git", "ls-files", "-z"]).split("\0")) | set(capture_at(root, ["git", "ls-files", "-z", "--others", "--exclude-standard"]).split("\0"))
        entries = []
        for name in sorted(files):
            file = root / name
            if file.is_file(): entries.append([name, hashlib.sha256(file.read_bytes()).hexdigest()])
        return {"head": capture_at(root, ["git", "rev-parse", "HEAD"]).strip(), "status": capture_at(root, ["git", "status", "--porcelain=v1"]),
                "sha256": hashlib.sha256(json.dumps(entries).encode()).hexdigest(), "files": entries}
    ids = capture(["docker", "ps", "-aq"]).split()
    containers = json.loads(capture(["docker", "inspect", *ids])) if ids else []
    records = [{"name": value["Name"].lstrip("/"), "id": value["Id"], "image": value["Image"], "project": value["Config"].get("Labels", {}).get("com.docker.compose.project"),
                "env_sha256": hashlib.sha256(json.dumps(value["Config"]["Env"], sort_keys=True).encode()).hexdigest(),
                "mounts": [{key: mount.get(key) for key in ("Type", "Name", "Source", "Destination", "RW")} for mount in value["Mounts"]],
                "ports": value["HostConfig"]["PortBindings"], "networks": sorted(value["NetworkSettings"]["Networks"]), "status": value["State"]["Status"]} for value in containers]
    return {"pc": source(ROOT.parent), "ee": source(EE), "containers": records, "volumes": capture(["docker", "volume", "ls", "--format", "{{.Name}}"]).splitlines()}


def capture_at(root, args):
    return subprocess.run(args, cwd=root, check=True, capture_output=True, text=True, encoding="utf-8").stdout


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "snapshot":
        destination = Path(sys.argv[2])
        if destination.exists(): raise RuntimeError("Evidence already exists")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(snapshot(), indent=2), encoding="utf-8")
    else:
        env = environment(existing=action != "start")
        if action == "start":
            if capture(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}"]).strip() or capture(["docker", "volume", "ls", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}"]).strip():
                raise RuntimeError("Candidate containers or volumes already exist")
            command(["node", "integration/real-ee-read-retest-01/build.mjs"])
            build_env = {**env, "DOCKER_BUILDKIT": "0"}
            command(["docker", "build", "--pull=false", "--build-arg", f"BASE_IMAGE={env['RC_BASE_IMAGE']}", "-f", "integration/real-ee-read-retest-01/app.Dockerfile", "-t", "real-ee-read-retest-01-app:d2912f4", "."], env=build_env)
            command(["docker", "build", "--pull=false", "--build-arg", f"NGINX_IMAGE={env['RC_NGINX_IMAGE']}", "-f", "integration/real-ee-read-retest-01/web.Dockerfile", "-t", "real-ee-read-retest-01-web:d2912f4", "."], env=build_env)
            compose(env, ["up", "-d", "--no-build", "--pull", "never"])
            wait_ready()
            seeded = {**env, "DATABASE_URL": f"postgresql://pc:{env['RC_POSTGRES_PASSWORD']}@pc-postgres:5432/pc", "PC_ENVELOPE_SIGNING_KEY": env["RC_SIGNING_KEY"], "RC_TASK": "REAL-EE-READ-RETEST-01"}
            compose(seeded, ["exec", "-T", *sum((["-e", key] for key in ("RC_ENGINEER_PASSWORD", "RC_REVIEWER_PASSWORD", "RC_GENERIC_PASSWORD", "RC_ZERO_PASSWORD", "RC_ADMIN_PASSWORD")), []), "pc-api", "node", "pc-fixture.mjs"])
        elif action in ("revoke", "restore", "fingerprint"):
            compose(env, ["exec", "-T", "ee-api", "python", "ee_fixture.py", action])
        elif action == "update-web":
            command(["docker", "build", "--pull=false", "--build-arg", f"NGINX_IMAGE={env['RC_NGINX_IMAGE']}", "-f", "integration/real-ee-read-retest-01/web.Dockerfile", "-t", "real-ee-read-retest-01-web:d2912f4", "."], env={**env, "DOCKER_BUILDKIT": "0"})
            compose(env, ["up", "-d", "--no-build", "--no-deps", "--pull", "never", "web", "standalone-web"])
        elif action in ("stop-ee", "start-ee"):
            compose(env, ["stop" if action == "stop-ee" else "start", "ee-api", "ee-mcp-adapter"])
        elif action in ("browser", "browser-skip-generic"):
            command(["node", "integration/real-ee-read-retest-01/browser.mjs"], env={**env, "RC_SKIP_GENERIC": "1"} if action == "browser-skip-generic" else env)
        elif action == "outage":
            command(["node", "integration/real-ee-read-retest-01/outage.mjs"], env=env)
        elif action == "stop":
            compose(env, ["stop"])
            users = capture(["docker", "ps", "-q", "--filter", "label=pc.demo.project=pc-real-ee-read-retest-01"]).split()
            if users: command(["docker", "stop", *users])
        else:
            raise RuntimeError("Unknown task action")
