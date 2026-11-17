FROM node:22-bookworm-slim
WORKDIR /runner
RUN npm install --ignore-scripts --legacy-peer-deps --save-exact --no-audit --no-fund \
    --registry=https://registry.npmmirror.com --fetch-retries=1 --fetch-timeout=20000 vitest@4.1.12
CMD ["sleep", "infinity"]
