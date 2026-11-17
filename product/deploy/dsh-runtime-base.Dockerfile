# syntax=docker/dockerfile:1.7

FROM node:22.23.4-bookworm-slim AS dsh-build

WORKDIR /opt/dsh
COPY --from=dsh-source . .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable \
    && COREPACK_NPM_REGISTRY=https://registry.npmmirror.com \
       corepack prepare pnpm@11.28.5 --activate \
    && npm install --global tsx@4.23.13 --registry=https://registry.npmmirror.com \
    && node -e "const fs=require('node:fs');const p=require('./package.json');delete p.scripts.postinstall;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" \
    && pnpm install \
       --frozen-lockfile \
       --filter @deepseek-ai/dsh... \
       --prod \
       --registry=https://registry.npmmirror.com \
    && mkdir -p /tmp/dsh-native-system \
    && cd /tmp/dsh-native-system \
    && npm pack @deepseek-ai/node-addon-system-linux-x64@0.1.2 \
       --registry=https://registry.npmmirror.com \
       --silent >/tmp/dsh-native-system/archive-name \
    && tar -xzf "$(cat /tmp/dsh-native-system/archive-name)" \
    && mkdir -p /opt/dsh/native/system/packages/linux-x64/bin \
    && cp -a package/bin/. /opt/dsh/native/system/packages/linux-x64/bin/ \
    && cd /opt/dsh \
    && rm -rf /tmp/dsh-native-system \
    && test -f native/system/packages/linux-x64/bin/glibc/system.node

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=dsh-build /usr/local/bin/node /usr/local/bin/node
COPY --from=dsh-build /opt/dsh /opt/dsh
COPY --from=dsh-build /usr/local/lib/node_modules/tsx /usr/local/lib/node_modules/tsx
COPY deploy/dsh-source /usr/local/bin/dsh-source

RUN pip install --no-cache-dir "pydantic>=2.12,<3" \
    && pip install --no-cache-dir --no-deps /opt/dsh/python/sdk \
    && chmod 0755 /usr/local/bin/dsh-source \
    && ln -s /usr/local/lib/node_modules/tsx/dist/cli.mjs /usr/local/bin/tsx \
    && test "$(/usr/local/bin/dsh-source --version)" = "0.2.1-rc.3" \
    && python -c "from deepseek_harness import DeepSeekHarness"

WORKDIR /runtime
