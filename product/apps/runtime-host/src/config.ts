import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { RuntimeIdentity } from "@pc/runtime-adapter";

export interface RuntimeHostConfig extends RuntimeIdentity {
  ownerUserId?: string;
  tenantId?: string;
  stateRoot: string;
  dshHome: string;
  workspace: string;
  materializationRoot?: string;
  profile: string;
  profilePatch: string;
  profileDigest?: string;
  bundleLockDigest?: string;
  provider: string;
  model: string;
  dshBin?: string;
  initializeTimeoutMs: number;
  requestTimeoutMs?: number;
  bridgeCommand?: string;
  bridgeScript?: string;
  eventIngestUrl?: string;
  eventIngestSecret?: string;
  eventExportTimeoutMs?: number;
  childEnvironment: NodeJS.ProcessEnv;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadRuntimeHostConfig(env: NodeJS.ProcessEnv = process.env): RuntimeHostConfig {
  const stateRoot = resolve(env.PC_RUNTIME_STATE_ROOT ?? ".runtime-state");
  const workspace = resolve(env.PC_RUNTIME_WORKSPACE ?? `${stateRoot}/workspace`);
  const dshHome = resolve(env.DSH_HOME ?? `${stateRoot}/dsh-home`);
  const profilePatch = resolve(
    env.DSH_PROFILE_PATCH ?? "profiles/process-copilot-runtime/cordis.patch.yml"
  );
  const eventIngestUrl = env.PC_EVENT_INGEST_URL?.trim();
  const eventIngestSecret = env.PC_EVENT_INGEST_SECRET?.trim();
  if ((eventIngestUrl === undefined) !== (eventIngestSecret === undefined)) {
    throw new Error(
      "PC_EVENT_INGEST_URL and PC_EVENT_INGEST_SECRET must be configured together"
    );
  }
  if (
    eventIngestUrl !== undefined
    && !/^https?:\/\//u.test(eventIngestUrl)
  ) {
    throw new Error("PC_EVENT_INGEST_URL must be an HTTP(S) URL");
  }
  if (eventIngestSecret !== undefined && eventIngestSecret.length < 24) {
    throw new Error("PC_EVENT_INGEST_SECRET must contain at least 24 characters");
  }
  return {
    ...(env.PC_RUNTIME_OWNER_USER_ID ? { ownerUserId: env.PC_RUNTIME_OWNER_USER_ID } : {}),
    ...(env.PC_RUNTIME_TENANT_ID ? { tenantId: env.PC_RUNTIME_TENANT_ID } : {}),
    runtimeId: env.PC_RUNTIME_ID ?? "pc-runtime-p1a-1",
    runtimeEpoch: nonNegativeInteger(env.PC_RUNTIME_EPOCH, 1, "PC_RUNTIME_EPOCH"),
    stateRoot,
    workspace,
    ...(env.PC_MATERIALIZATION_ROOT === undefined
      ? {}
      : { materializationRoot: resolve(env.PC_MATERIALIZATION_ROOT) }),
    dshHome,
    profile: env.DSH_PROFILE ?? "sdk-minimal",
    profilePatch,
    profileDigest: `sha256:${createHash("sha256").update(readFileSync(profilePatch)).digest("hex")}`,
    bundleLockDigest: `sha256:${createHash("sha256").update("dsh:1f81c047fc48fa190a683e469daa699857e9afe8")
      .update(readFileSync(resolve(env.PC_RUNTIME_BRIDGE_ROOT ?? "apps/runtime-host/bridge", "pc-runtime-bridge.mjs")))
      .update(readFileSync(resolve(env.PC_RUNTIME_BRIDGE_ROOT ?? "apps/runtime-host/bridge", "pc-tool-provider.mjs"))).digest("hex")}`,
    provider: env.DSH_PROVIDER ?? "deepseek-official",
    model: env.DSH_MODEL ?? "deepseek-v4-flash",
    ...(env.DSH_BIN === undefined ? {} : { dshBin: env.DSH_BIN }),
    initializeTimeoutMs: positiveInteger(
      env.DSH_INITIALIZE_TIMEOUT_MS,
      30_000,
      "DSH_INITIALIZE_TIMEOUT_MS"
    ),
    ...(env.DSH_REQUEST_TIMEOUT_MS === undefined
      ? {}
      : {
          requestTimeoutMs: positiveInteger(
            env.DSH_REQUEST_TIMEOUT_MS,
            1,
            "DSH_REQUEST_TIMEOUT_MS"
          )
        }),
    ...(env.DSH_BRIDGE_COMMAND === undefined
      ? {}
      : { bridgeCommand: env.DSH_BRIDGE_COMMAND }),
    ...(env.DSH_PYTHON_BRIDGE === undefined
      ? {}
      : { bridgeScript: resolve(env.DSH_PYTHON_BRIDGE) }),
    ...(eventIngestUrl === undefined ? {} : { eventIngestUrl }),
    ...(eventIngestSecret === undefined ? {} : { eventIngestSecret }),
    eventExportTimeoutMs: positiveInteger(
      env.PC_EVENT_EXPORT_TIMEOUT_MS,
      5_000,
      "PC_EVENT_EXPORT_TIMEOUT_MS"
    ),
    childEnvironment: Object.fromEntries(Object.entries(env).filter(([name]) =>
      ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE",
        "LANG", "LC_ALL", "NODE_PATH", "PYTHONPATH", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
        "DSH_CONTEXT_WINDOW", "PC_RUNTIME_TOOL_URL"].includes(name)
    ))
  };
}
