"""Restricted local provisioning for user-owned Runtime containers."""
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import threading
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

SECRET = os.environ["PC_RUNTIME_SERVICE_SECRET"]
TENANT = os.environ["PC_RUNTIME_TENANT"]
TEMPLATE = "pc-real-ee-read-retest-01-pc-runtime-1"
LOCK = threading.Lock()


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/var/run/docker.sock")


def docker(method, path, body=None, missing=False):
    conn = DockerConnection("localhost", timeout=25)
    try:
        encoded = None if body is None else json.dumps(body).encode()
        conn.request(method, path, body=encoded, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        raw = response.read()
        if response.status == 404 and missing:
            return None
        if response.status >= 300:
            raise RuntimeError("Local container operation failed (HTTP %s)" % response.status)
        return json.loads(raw) if raw else {}
    finally:
        conn.close()


def ensure(owner):
    if set(owner) != {"tenant_id", "principal_id"} or owner["tenant_id"] != TENANT or not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", str(owner["principal_id"])):
        raise ValueError("Invalid Runtime owner")
    suffix = hashlib.sha256((TENANT + ":" + owner["principal_id"]).encode()).hexdigest()[:24]
    name = "pc-workbench-user-" + suffix
    labels = {"pc.demo.project": "pc-real-ee-read-retest-01", "pc.demo.owner": owner["principal_id"], "pc.demo.tenant": TENANT}
    with LOCK:
        template = docker("GET", "/containers/" + TEMPLATE + "/json")
        existing = docker("GET", "/containers/" + name + "/json", missing=True)
        if existing:
            if any(existing["Config"]["Labels"].get(key) != value for key, value in labels.items()):
                raise RuntimeError("Runtime owner labels do not match")
            if existing["Image"] != template["Image"]:
                raise RuntimeError("User Runtime requires an explicit drained version rollout")
        else:
            containers = docker("GET", "/containers/json?all=1")
            if sum(c.get("Labels", {}).get("pc.demo.project") == "pc-real-ee-read-retest-01" for c in containers) >= 16:
                raise RuntimeError("Local user Runtime capacity reached")
            subpath = "workspaces/" + TENANT + "/" + owner["principal_id"]
            directory = Path("/pc-data")
            for part in subpath.split("/"):
                directory = directory / part
                directory.mkdir(exist_ok=True)
                if directory.is_symlink() or not directory.is_dir():
                    raise RuntimeError("Unsafe materialization directory")
            source = next(m["Name"] for m in template["Mounts"] if m["Destination"] == "/data")
            volume = name + "-state"
            docker("POST", "/volumes/create", {"Name": volume, "Labels": labels})
            environment = dict(item.split("=", 1) for item in template["Config"]["Env"])
            allowed = {"PATH", "NODE_PATH", "HOST", "PORT", "DSH_HOME", "DSH_BIN", "DSH_PROVIDER", "DSH_MODEL",
                       "DSH_BRIDGE_COMMAND", "DSH_PYTHON_BRIDGE", "DSH_REQUEST_TIMEOUT_MS", "DEEPSEEK_API_KEY",
                       "DEEPSEEK_BASE_URL", "PC_RUNTIME_SERVICE_SECRET", "PC_EVENT_INGEST_SECRET", "PC_EVENT_INGEST_URL",
                       "PC_RUNTIME_TOOL_URL", "PC_RUNTIME_STATE_ROOT", "PC_RUNTIME_WORKSPACE", "PC_MATERIALIZATION_ROOT",
                       "PC_RUNTIME_BRIDGE_ROOT", "DSH_PROFILE_PATCH", "DSH_PROFILE", "DSH_INITIALIZE_TIMEOUT_MS"}
            environment = {k: v for k, v in environment.items() if k in allowed}
            environment.update(PC_RUNTIME_ID=name, PC_RUNTIME_EPOCH="1", PC_RUNTIME_OWNER_USER_ID=owner["principal_id"],
                               PC_RUNTIME_TENANT_ID=TENANT)
            networks = {key: {} for key in template["NetworkSettings"]["Networks"]}
            docker("POST", "/containers/create?name=" + name, {"Image": template["Image"], "Cmd": ["node", "runtime.mjs"],
                "WorkingDir": "/app/demo", "Env": [k + "=" + v for k, v in environment.items()], "Labels": labels,
                "HostConfig": {"RestartPolicy": {"Name": "unless-stopped"}, "CapDrop": ["ALL"],
                    "SecurityOpt": ["no-new-privileges:true"], "PidsLimit": 256,
                    "Mounts": [{"Type": "volume", "Source": volume, "Target": "/runtime-state"},
                        {"Type": "volume", "Source": source, "Target": "/data/" + subpath, "ReadOnly": True,
                         "VolumeOptions": {"Subpath": subpath}}]},
                "NetworkingConfig": {"EndpointsConfig": networks}})
            existing = docker("GET", "/containers/" + name + "/json")
        if not existing["State"]["Running"]:
            docker("POST", "/containers/" + name + "/start")
    endpoint = "http://" + name + ":3100"
    deadline = time.monotonic() + 50
    while time.monotonic() < deadline:
        try:
            with urlopen(Request(endpoint + "/health"), timeout=3) as response:
                if response.status == 200:
                    return {"runtime_id": name, "endpoint_url": endpoint, **owner}
        except (URLError, TimeoutError):
            time.sleep(0.4)
    raise RuntimeError("User Runtime did not become healthy")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send(self, status, payload):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        self.send(200 if self.path == "/health" else 404, {"status": "ok"})

    def do_POST(self):
        if not hmac.compare_digest(self.headers.get("X-PC-Runtime-Secret", ""), SECRET):
            return self.send(401, {"error": "Service authentication required"})
        if self.path != "/v1/user-runtimes/ensure":
            return self.send(404, {"error": "Unknown operation"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 512:
                raise ValueError("Invalid request size")
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError("Owner object required")
            self.send(200, ensure(value))
        except (ValueError, KeyError, TypeError):
            self.send(400, {"error": "Invalid Runtime owner request"})
        except Exception:
            self.send(503, {"error": "User Runtime provisioning unavailable"})


if os.environ.get("PC_LOCAL_DEMO") != "1" or len(SECRET) < 24 or not re.fullmatch(r"[a-zA-Z0-9_-]+", TENANT):
    raise RuntimeError("Only the explicitly configured local demo can provision Runtimes")
ThreadingHTTPServer(("0.0.0.0", 3200), Handler).serve_forever()
