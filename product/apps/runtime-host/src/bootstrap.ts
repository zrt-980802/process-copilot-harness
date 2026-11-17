import { OfficialDshSdkRuntime } from "@pc/dsh-bridge";
import { loadRuntimeHostConfig } from "./config.js";
import { RuntimeHostService } from "./runtime-service.js";
import { FileRuntimeStateStore } from "./state-store.js";
import { HttpRuntimeEventExporter } from "./event-exporter.js";

export function createRuntimeHostServiceFromEnvironment(): RuntimeHostService {
  const config = loadRuntimeHostConfig();
  const dsh = new OfficialDshSdkRuntime({
    profile: config.profile,
    dshHome: config.dshHome,
    workspace: config.workspace,
    provider: config.provider,
    model: config.model,
    profilePatch: config.profilePatch,
    environment: config.childEnvironment,
    initializeTimeoutMs: config.initializeTimeoutMs,
    runtimeId: config.runtimeId,
    runtimeEpoch: config.runtimeEpoch,
    controlDirectory: `${config.stateRoot}/bridge-control`,
    requireControlBridge: true,
    profileDigest: config.profileDigest ?? "process-copilot-runtime-dev04",
    ...(config.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: config.requestTimeoutMs }),
    ...(config.dshBin === undefined ? {} : { dshBin: config.dshBin }),
    ...(config.bridgeCommand === undefined
      ? {}
      : { bridgeCommand: config.bridgeCommand }),
    ...(config.bridgeScript === undefined
      ? {}
      : { bridgeScript: config.bridgeScript })
  });
  const exporter = config.eventIngestUrl === undefined
    || config.eventIngestSecret === undefined
    ? undefined
    : new HttpRuntimeEventExporter(
        config.eventIngestUrl,
        config.eventIngestSecret,
        config.eventExportTimeoutMs ?? 5_000
      );
  return new RuntimeHostService(
    config,
    dsh,
    new FileRuntimeStateStore(config.stateRoot),
    exporter
  );
}
