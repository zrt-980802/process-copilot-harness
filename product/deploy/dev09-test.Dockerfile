FROM node:22-bookworm-slim

ENV CI=true
WORKDIR /workspace

RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "exec", "vitest", "run", "packages/persistence/tests/postgres-ssts-draft.test.ts"]
