# syntax=docker/dockerfile:1.7

ARG DSH_RUNTIME_BASE_IMAGE=process-copilot-dsh-runtime-base:0.2.1-rc.3-gate2
FROM ${DSH_RUNTIME_BASE_IMAGE} AS dsh-runtime

RUN test "$(/usr/local/bin/dsh-source --version)" = "0.2.1-rc.3" \
    && test -d /opt/dsh/python/sdk \
    && python -c "from deepseek_harness import DeepSeekHarness"

FROM node:22.23.4-bookworm-slim AS runtime-host-build

ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /src
RUN corepack enable \
    && COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
       corepack prepare pnpm@11.21.0 --activate \
    && npm install --global typescript@5.9.3 esbuild@0.28.2 --registry=${NPM_REGISTRY}

ARG PNPM_OFFLINE=false
ARG PNPM_REGISTRY=${NPM_REGISTRY}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/runtime-host ./apps/runtime-host
COPY packages/dsh-bridge ./packages/dsh-bridge
COPY packages/runtime-adapter ./packages/runtime-adapter

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    export PNPM_CONFIG_OFFLINE=${PNPM_OFFLINE} \
    && pnpm install \
      --frozen-lockfile \
      --trust-lockfile \
      --filter @pc/runtime-host... \
      --registry=${PNPM_REGISTRY} \
    && pnpm -r --filter @pc/runtime-host... --if-present build \
    && mkdir -p /out/dist \
    && cp apps/runtime-host/package.json /out/package.json \
    && esbuild apps/runtime-host/src/main.ts \
      --bundle \
      --platform=node \
      --format=esm \
      --target=node22 \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=/out/dist/main.js

FROM dsh-runtime

ENV NODE_ENV=production \
    DSH_HOME=/var/lib/process-copilot/dsh-home \
    PC_RUNTIME_STATE_ROOT=/var/lib/process-copilot/runtime-host \
    PC_RUNTIME_WORKSPACE=/var/lib/process-copilot/workspace \
    DSH_BIN=/usr/local/bin/dsh-source \
    DSH_PROFILE=sdk-minimal \
    DSH_PROFILE_PATCH=/app/profiles/process-copilot-runtime/cordis.patch.yml \
    DSH_BRIDGE_COMMAND=python \
    DSH_PYTHON_BRIDGE=/app/python/dsh_runtime_bridge.py

WORKDIR /app
USER root

RUN rm -rf /app/*

COPY --from=runtime-host-build /out/package.json ./
COPY --from=runtime-host-build /out/dist ./dist
COPY apps/runtime-host/python ./python
COPY apps/runtime-host/bridge ./bridge
COPY profiles/process-copilot-runtime ./profiles/process-copilot-runtime

RUN mkdir -p \
      /var/lib/process-copilot/dsh-home \
      /var/lib/process-copilot/runtime-host \
      /var/lib/process-copilot/workspace

ENTRYPOINT []
EXPOSE 3100
CMD ["node", "dist/main.js"]
