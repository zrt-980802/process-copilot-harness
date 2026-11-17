FROM node:22-bookworm-slim AS node
FROM process-copilot-p1a-local-dsh-runtime-base:0.2.1-rc.3
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=ee backend/requirements.txt /tmp/ee-requirements.txt
RUN pip install --no-cache-dir -r /tmp/ee-requirements.txt pytest
WORKDIR /verification
COPY .docker/dev09a3/dist/ ./
COPY deploy/verify-dev09a3-ee.py deploy/dev09a3-mysql.yaml ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "verify-dev09a3-ee.py"]
