FROM process-copilot-dev09a3-verifier:local
WORKDIR /verification
COPY .docker/dev09a-complete/ ./
COPY deploy/verify-dev09a-complete.py deploy/dev09a3-mysql.yaml ./
COPY apps/runtime-host/python /app/python
COPY apps/runtime-host/bridge /app/bridge
COPY profiles/process-copilot-runtime /app/profiles/process-copilot-runtime
COPY apps/web/dist /web
ENV PC_RUNTIME_BRIDGE_ROOT=/app/bridge DSH_PROFILE_PATCH=/app/profiles/process-copilot-runtime/cordis.patch.yml
CMD ["python", "verify-dev09a-complete.py"]
