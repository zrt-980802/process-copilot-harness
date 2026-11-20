ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app/demo
COPY .docker/real-ee-closure/*.mjs ./
COPY integration/real-ee-closure/ee_fixture.py integration/real-ee-closure/runtime-manager.py ./
COPY apps/runtime-host/python /app/python
COPY apps/runtime-host/bridge /app/bridge
COPY profiles/process-copilot-runtime /app/profiles/process-copilot-runtime
ENV PYTHONDONTWRITEBYTECODE=1
