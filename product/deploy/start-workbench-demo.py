"""Inherit the existing local credential in memory; never emit or persist it."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
env = dict(os.environ)
if not env.get("DEEPSEEK_API_KEY"):
    for container in ("pc-workbench-demo-pc-runtime-1", "pc-dev09a-complete-verifier-1"):
        result = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Env}}", container],
                                capture_output=True, text=True)
        if result.returncode:
            continue
        values = dict(item.split("=", 1) for item in json.loads(result.stdout) if "=" in item)
        for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "PC_DEV09A_MODEL"):
            if values.get(name) and not env.get(name):
                env[name] = values[name]
        if not env.get("PC_DEV09A_MODEL") and values.get("DSH_MODEL"):
            env["PC_DEV09A_MODEL"] = values["DSH_MODEL"]
        if env.get("DEEPSEEK_API_KEY"):
            break
if not env.get("DEEPSEEK_API_KEY"):
    raise RuntimeError("Set the local DEEPSEEK_API_KEY environment variable before starting the demo")
env.setdefault("PC_DEMO_EE_ROOT", "E:/shanzi_workspace/feishu-ee-agents-dev09a")
env.setdefault("PC_DEMO_PRODUCT_ROOT", str(root))
args = sys.argv[1:] or ["up", "-d", "--build"]
candidate_files = json.loads(env.get("PC_CANDIDATE_COMPOSE_FILES", "[]"))
candidate_args = [item for path in candidate_files for item in ("-f", path)]
if "build" in args or "--build" in args:
    template = subprocess.run(["docker", "inspect", "--format", "{{.Image}}", "pc-workbench-demo-pc-runtime-1"],
                              capture_output=True, text=True)
    image = template.stdout.strip()
    if template.returncode == 0 and image.startswith("sha256:"):
        available = subprocess.run(["docker", "image", "inspect", image], capture_output=True, text=True)
        if available.returncode == 0:
            # A retained name keeps the live template addressable after containerd retags a build.
            subprocess.run(["docker", "image", "tag", image, "process-copilot-runtime-preserved:" + image[7:]], check=True)
        else:
            print("Live Runtime template image is unavailable; recreate the template before a user Runtime rollout.", file=sys.stderr)
raise SystemExit(subprocess.run(["docker", "compose", "-f", "deploy/docker-compose.workbench-demo.yml",
                                "-f", "deploy/docker-compose.ee-admin.yml", *candidate_args, *args],
                               cwd=root, env=env).returncode)
