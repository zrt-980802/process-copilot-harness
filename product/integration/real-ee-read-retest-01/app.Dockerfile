ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app/demo
COPY .docker/real-ee-read-retest-01/*.mjs ./
COPY integration/real-ee-read-retest-01/ee_fixture.py integration/real-ee-read-retest-01/runtime-manager.py ./
COPY packages/persistence/migrations/identity/0001_session_assurance.sql /app/migrations/identity/0001_session_assurance.sql
COPY apps/runtime-host/python /app/python
COPY apps/runtime-host/bridge /app/bridge
COPY profiles/process-copilot-runtime /app/profiles/process-copilot-runtime
ENV PYTHONDONTWRITEBYTECODE=1
