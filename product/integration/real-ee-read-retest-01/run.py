"""Only this task's isolated Compose project; credentials never printed or saved."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "pc-real-ee-read-retest-01"
TENANT = "rc_ee_read_retest_01"
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
    explicit_model = {name: env[name] for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "RC_MODEL") if env.get(name)}
    env.update(RC_EE_ROOT=str(EE).replace("\\", "/"), RC_BASE_IMAGE=image("vertical-demo-closure-01-runtime:local"),
               RC_NGINX_IMAGE=image("nginx:alpine"), RC_MYSQL_IMAGE=image("mysql:8.0.39"), RC_POSTGRES_IMAGE=image("postgres:17-alpine"))
    if existing:
        for service in ("ee-api", "ee-mysql", "pc-postgres", "pc-api", "standalone-api", "pc-runtime", "ee-mcp-adapter"):
            values = json.loads(capture(["docker", "inspect", "--format", "{{json .Config.Env}}", f"{PROJECT}-{service}-1"]))
            config = dict(value.split("=", 1) for value in values if "=" in value)
            for name, value in config.items():
                if value != "not-configured" and (name.startswith("RC_") or name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL")):
                    env[name] = value
            mappings = {"MYSQL_PASSWORD": "RC_MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD": "RC_MYSQL_ROOT_PASSWORD", "POSTGRES_PASSWORD": "RC_POSTGRES_PASSWORD",
                        "PC_ENVELOPE_SIGNING_KEY": "RC_SIGNING_KEY", "PC_RUNTIME_SERVICE_SECRET": "RC_RUNTIME_SECRET", "PC_EVENT_INGEST_SECRET": "RC_EVENT_SECRET",
                        "EECLAW_ADAPTER_SECRET": "RC_EE_SECRET", "EE_MCP_ADAPTER_SECRET": "RC_MCP_SECRET", "PC_PILOT_ACCOUNT_SECRET": "RC_PERSONAL_PASSWORD", "DSH_MODEL": "RC_MODEL"}
            for old, new in mappings.items():
                if config.get(old) and config[old] != "not-configured": env[new] = config[old]
        env.update(explicit_model)
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


def scrub_environment():
    env = dict(os.environ)
    env.update(RC_EE_ROOT=str(EE).replace("\\", "/"), RC_BASE_IMAGE="not-used:local",
               RC_NGINX_IMAGE="not-used:local", RC_MYSQL_IMAGE="not-used:local", RC_POSTGRES_IMAGE="not-used:local")
    for name in ("MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD", "POSTGRES_PASSWORD", "SIGNING_KEY", "RUNTIME_SECRET", "EVENT_SECRET", "EE_SECRET", "MCP_SECRET",
                 "PERSONAL_PASSWORD", "ENGINEER_PASSWORD", "REVIEWER_PASSWORD", "GENERIC_PASSWORD", "ZERO_PASSWORD", "ADMIN_PASSWORD"):
        env["RC_" + name] = "not-configured"
    env.update(DEEPSEEK_API_KEY="not-configured", DEEPSEEK_BASE_URL="https://api.deepseek.com", RC_MODEL="deepseek-chat")
    return env


def compose(env, args, **kwargs):
    if any(arg in ("down", "rm", "prune") for arg in args):
        raise RuntimeError("Resource deletion is outside this task runner")
    return command(["docker", "compose", "-p", PROJECT, "-f", str(COMPOSE), *args], env=env, **kwargs)


def task_volume_fingerprint():
    names = set()
    for label in (f"com.docker.compose.project={PROJECT}", f"pc.demo.project={PROJECT}"):
        names.update(capture(["docker", "volume", "ls", "-q", "--filter", f"label={label}"]).split())
    if not names:
        return {}
    values = json.loads(capture(["docker", "volume", "inspect", *sorted(names)]))
    return {value["Name"]: {key: value.get(key) for key in ("Driver", "Labels", "Options", "Scope")}
            for value in values}


def task_data_volume():
    names = capture(["docker", "volume", "ls", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}",
                     "--filter", "label=com.docker.compose.volume=pc-data"]).split()
    if len(names) != 1:
        raise RuntimeError("Task data volume identity is unavailable")
    return names[0]


def dynamic_runtimes():
    ids = capture(["docker", "ps", "-aq", "--filter", f"label=pc.demo.project={PROJECT}"]).split()
    if not ids:
        return []
    values = json.loads(capture(["docker", "inspect", *ids]))
    expected_data_volume = task_data_volume()
    records = []
    for value in values:
        labels = value["Config"].get("Labels", {})
        owner = labels.get("pc.demo.owner", "")
        if not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", owner):
            raise RuntimeError("Dynamic Runtime owner label is invalid")
        expected = "pc-workbench-user-" + hashlib.sha256((TENANT + ":" + owner).encode()).hexdigest()[:24]
        name = value["Name"].lstrip("/")
        if name != expected or labels.get("pc.demo.project") != PROJECT or labels.get("pc.demo.tenant") != TENANT:
            raise RuntimeError("Dynamic Runtime identity does not match its task labels")
        if labels.get("com.docker.compose.project"):
            raise RuntimeError("Compose services cannot be selected as dynamic Runtimes")
        state = [mount for mount in value["Mounts"] if mount["Destination"] == "/runtime-state"]
        data = [mount for mount in value["Mounts"] if mount["Destination"] == f"/data/workspaces/{TENANT}/{owner}"]
        if len(state) != 1 or state[0].get("Type") != "volume" or state[0].get("Name") != name + "-state" or not state[0].get("RW"):
            raise RuntimeError("Dynamic Runtime state volume is not the expected retained volume")
        if len(data) != 1 or data[0].get("Type") != "volume" or data[0].get("Name") != expected_data_volume or data[0].get("RW"):
            raise RuntimeError("Dynamic Runtime data mount is not the expected read-only materialization")
        volume = json.loads(capture(["docker", "volume", "inspect", state[0]["Name"]]))[0]
        volume_labels = volume.get("Labels", {})
        if any(volume_labels.get(key) != expected_value for key, expected_value in {
                "pc.demo.project": PROJECT, "pc.demo.owner": owner, "pc.demo.tenant": TENANT}.items()):
            raise RuntimeError("Dynamic Runtime state volume labels do not match its owner")
        records.append({"id": value["Id"], "name": name, "running": value["State"]["Running"]})
    return records


def remove_dynamic_runtimes():
    records = dynamic_runtimes()
    failures = []
    for record in records:
        if record["running"]:
            try: command(["docker", "stop", record["id"]])
            except Exception: failures.append("stop")
        try: command(["docker", "rm", record["id"]])
        except Exception: failures.append("remove")
    if dynamic_runtimes():
        failures.append("postcondition")
    if failures:
        raise RuntimeError("Dynamic Runtime cleanup failed")


def assert_runtime_templates(env, running):
    expected = {"DEEPSEEK_API_KEY": env.get("DEEPSEEK_API_KEY", ""),
                "DEEPSEEK_BASE_URL": env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                "DSH_MODEL": env.get("RC_MODEL", "deepseek-chat"),
                "PC_ENVELOPE_SIGNING_KEY": env["RC_SIGNING_KEY"],
                "PC_RUNTIME_SERVICE_SECRET": env["RC_RUNTIME_SECRET"],
                "PC_EVENT_INGEST_SECRET": env["RC_EVENT_SECRET"]}
    for service in ("pc-runtime", "standalone-runtime"):
        value = json.loads(capture(["docker", "inspect", f"{PROJECT}-{service}-1"]))[0]
        actual = dict(item.split("=", 1) for item in value["Config"]["Env"] if "=" in item)
        database_password = f":{env['RC_POSTGRES_PASSWORD']}@"
        if (value["State"]["Running"] is not running
                or any(actual.get(key) != expected_value for key, expected_value in expected.items())
                or database_password not in actual.get("DATABASE_URL", "")):
            raise RuntimeError("Runtime template postcondition failed")


def assert_runtime_manager():
    name = f"{PROJECT}-user-runtime-manager-1"
    value = json.loads(capture(["docker", "inspect", name]))[0]
    if not value["State"]["Running"]:
        raise RuntimeError("User Runtime manager is not running")
    command(["docker", "exec", name, "python", "-c",
             "from urllib.request import urlopen; assert urlopen('http://127.0.0.1:3200/health', timeout=3).status == 200"])


def wait_urls(urls):
    from urllib.request import urlopen
    for url in urls:
        deadline = time.monotonic() + 180
        while True:
            try:
                with urlopen(url, timeout=3) as response:
                    if response.status == 200: break
            except Exception:
                pass
            if time.monotonic() > deadline: raise RuntimeError("Candidate readiness timeout")
            time.sleep(2)


def wait_ready():
    wait_urls(("http://127.0.0.1:18891/api/ready", "http://127.0.0.1:18890/api/ready"))


def wait_ee_ready():
    wait_urls(("http://127.0.0.1:18892/api/health", "http://127.0.0.1:18893/health"))


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
        env = scrub_environment() if action == "stop" else environment(existing=action != "start")
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
        elif action == "resume":
            explicit_key = os.environ.get("DEEPSEEK_API_KEY", "")
            if not explicit_key or explicit_key == "not-configured":
                raise RuntimeError("Resume requires an explicit process-only model credential")
            volumes = task_volume_fingerprint()
            compose(env, ["stop", "user-runtime-manager", "pc-api"])
            remove_dynamic_runtimes()
            if task_volume_fingerprint() != volumes:
                raise RuntimeError("Runtime cleanup changed retained volumes")
            compose(env, ["up", "-d", "--no-build", "--no-deps", "--pull", "never", "--force-recreate", "pc-runtime", "standalone-runtime"])
            assert_runtime_templates(env, True)
            if dynamic_runtimes():
                raise RuntimeError("Stale dynamic Runtimes remain before manager startup")
            compose(env, ["up", "-d", "--no-build", "--pull", "never"])
            wait_ee_ready()
            compose(env, ["restart", "pc-api"])
            wait_ready()
            assert_runtime_templates(env, True)
            assert_runtime_manager()
            if task_volume_fingerprint() != volumes:
                raise RuntimeError("Runtime resume postcondition failed")
        elif action in ("revoke", "restore", "fingerprint"):
            compose(env, ["exec", "-T", "ee-api", "python", "ee_fixture.py", action])
        elif action == "update-web":
            command(["docker", "build", "--pull=false", "--build-arg", f"NGINX_IMAGE={env['RC_NGINX_IMAGE']}", "-f", "integration/real-ee-read-retest-01/web.Dockerfile", "-t", "real-ee-read-retest-01-web:d2912f4", "."], env={**env, "DOCKER_BUILDKIT": "0"})
            compose(env, ["up", "-d", "--no-build", "--no-deps", "--pull", "never", "web", "standalone-web"])
        elif action == "update-app":
            command(["node", "integration/real-ee-read-retest-01/build.mjs"])
            command(["docker", "build", "--pull=false", "--build-arg", f"BASE_IMAGE={env['RC_BASE_IMAGE']}", "-f", "integration/real-ee-read-retest-01/app.Dockerfile", "-t", "real-ee-read-retest-01-app:d2912f4", "."],
                    env={**env, "DOCKER_BUILDKIT": "0"})
            compose(env, ["up", "-d", "--no-build", "--no-deps", "--pull", "never", "--force-recreate", "pc-api", "standalone-api"])
            wait_ready()
        elif action in ("stop-ee", "start-ee"):
            compose(env, ["stop" if action == "stop-ee" else "start", "ee-api", "ee-mcp-adapter"])
            if action == "start-ee": wait_ee_ready()
        elif action in ("browser", "browser-skip-generic"):
            command(["node", "integration/real-ee-read-retest-01/browser.mjs"], env={**env, "RC_SKIP_GENERIC": "1"} if action == "browser-skip-generic" else env)
        elif action == "adversarial-a1":
            command(["node", "integration/real-ee-read-retest-01/adversarial.mjs"], env=env)
        elif action == "outage":
            command(["node", "integration/real-ee-read-retest-01/outage.mjs"], env=env)
        elif action == "stop":
            volumes = task_volume_fingerprint()
            failures = []
            try: compose(env, ["stop"])
            except Exception: failures.append("compose-stop")
            try: remove_dynamic_runtimes()
            except Exception: failures.append("dynamic-runtime-cleanup")
            try: compose(env, ["up", "--no-start", "--no-build", "--no-deps", "--force-recreate", "pc-runtime", "standalone-runtime"])
            except Exception: failures.append("template-scrub")
            try: assert_runtime_templates(env, False)
            except Exception: failures.append("template-postcondition")
            try:
                if task_volume_fingerprint() != volumes or dynamic_runtimes():
                    failures.append("retained-resource-postcondition")
            except Exception:
                failures.append("retained-resource-postcondition")
            if failures:
                raise RuntimeError("Runtime stop cleanup failed: " + ", ".join(failures))
        else:
            raise RuntimeError("Unknown task action")
