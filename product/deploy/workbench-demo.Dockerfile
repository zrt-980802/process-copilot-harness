FROM process-copilot-dev09a-complete:local
WORKDIR /app/demo
COPY .docker/workbench-demo/ ./
COPY deploy/start-pc-demo.py ./
COPY deploy/user-runtime-manager.py ./
COPY apps/runtime-host/python /app/python
COPY apps/runtime-host/bridge /app/bridge
COPY profiles/process-copilot-runtime /app/profiles/process-copilot-runtime
CMD ["node", "main.mjs"]
