from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any

from deepseek_harness import DeepSeekHarness


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def create_harness() -> DeepSeekHarness:
    patch = os.environ.get("DSH_PROFILE_PATCH", "").strip()
    request_timeout_ms = os.environ.get("DSH_REQUEST_TIMEOUT_MS", "").strip()
    return DeepSeekHarness(
        dsh_bin=required("DSH_BIN"),
        dsh_home=required("DSH_HOME"),
        profile=os.environ.get("DSH_PROFILE", "sdk-minimal"),
        patches=[patch] if patch else [],
        cwd=required("DSH_WORKSPACE"),
        runtime_cwd=required("DSH_WORKSPACE"),
        provider=os.environ.get("DSH_PROVIDER", "deepseek-official"),
        model=os.environ.get("DSH_MODEL", "deepseek-v4-flash"),
        env=dict(os.environ),
        initialize_timeout_seconds=(
            int(os.environ.get("DSH_INITIALIZE_TIMEOUT_MS", "30000")) / 1000
        ),
        request_timeout_seconds=(
            int(request_timeout_ms) / 1000 if request_timeout_ms else None
        ),
    )


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    harness: DeepSeekHarness | None = None
    for line in sys.stdin:
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            request_id = int(request["id"])
            method = str(request["method"])
            params = request.get("params") or {}
            if harness is None:
                harness = create_harness()

            if method == "start":
                harness.start()
                result: Any = {"started": True}
            elif method == "run":
                run = harness.run(
                    str(params["prompt"]),
                    session_id=str(params["session_id"]),
                )
                turn_error = None
                for event in reversed(run.events):
                    if event.get("type") != "turn/end":
                        continue
                    data = event.get("data")
                    reason = data.get("reason") if isinstance(data, dict) else None
                    error = reason.get("error") if isinstance(reason, dict) else None
                    if isinstance(error, dict):
                        turn_error = {
                            "code": str(error.get("code") or "DSH_TURN_FAILED"),
                            "message": str(error.get("message") or "DSH turn failed"),
                        }
                    break
                result = {
                    "session_id": run.session_id,
                    "final_response": run.final_response,
                    "events": run.events,
                    "notification_count": len(run.notifications),
                    "finish_reason": run.finish_reason,
                    "turn_error": turn_error,
                }
            elif method == "resume":
                harness.resume_session(str(params["session_id"]))
                result = {"resumed": True}
            elif method == "close":
                harness.close()
                emit({"id": request_id, "ok": True, "result": {"closed": True}})
                return
            else:
                raise RuntimeError(f"unsupported bridge method: {method}")
            emit({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            emit(
                {
                    "id": int(request.get("id", 0)),
                    "ok": False,
                    "error": f"{type(error).__name__}: {error}",
                }
            )
    if harness is not None:
        harness.close()


if __name__ == "__main__":
    main()
