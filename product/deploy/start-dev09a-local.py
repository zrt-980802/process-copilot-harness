"""Load the already configured DSH model secret without logging or copying it."""
import os
import json
from pathlib import Path
import subprocess
import sys
import yaml

root = Path(__file__).resolve().parents[1]
credential = Path.home() / ".dsh" / ".credentials.yaml"
env = dict(os.environ)
if not env.get("DEEPSEEK_API_KEY"):
    existing = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Env}}",
                               "pc-dev09a-complete-verifier-1"], capture_output=True, text=True)
    if existing.returncode == 0:
        values = dict(item.split("=", 1) for item in json.loads(existing.stdout) if "=" in item)
        for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "PC_DEV09A_MODEL"):
            if values.get(name) and name not in env:
                env[name] = values[name]
model_key = env.get("DEEPSEEK_API_KEY") or yaml.safe_load(credential.read_text())["refs"]["DEEPSEEK_API_KEY"]
if not isinstance(model_key, str) or not model_key.startswith("sk-"):
    raise RuntimeError("Configured DeepSeek credential is unavailable")
env.update(DEEPSEEK_API_KEY=model_key,
           PC_DEV09A_EE_ROOT="E:/shanzi_workspace/feishu-ee-agents-dev09a")
args = sys.argv[1:] or ["up", "-d", "--build"]
raise SystemExit(subprocess.run(["docker", "compose", "-f", "deploy/docker-compose.dev09a-complete.yml", *args],
                               cwd=root, env=env).returncode)
