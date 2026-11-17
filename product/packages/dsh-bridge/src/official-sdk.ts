import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  DshBridgeControlError,
  PcRuntimeBridgeClient
} from "./runtime-bridge.js";
import type {
  DshAssignmentGuardSnapshot,
  DshBridgeControlHealth,
  DshBridgeHandshake,
  DshCancelResult,
  DshEventsResult,
  DshFlushResult,
  DshGuardDecision,
  DshReleaseResult,
  DshRunResult,
  DshRuntimeHealth,
  DshRuntimeOptions,
  DshRuntimePort
} from "./types.js";

interface BridgeResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class OfficialDshSdkRuntime implements DshRuntimePort {
  private process: ChildProcessWithoutNullStreams | undefined;
  private controlClient: PcRuntimeBridgeClient | undefined;
  private controlHandshake: DshBridgeHandshake | undefined;
  private controlSecret: string | undefined;
  private controlEndpointFile: string | undefined;
  private controlState: DshBridgeControlHealth["state"];
  private controlLastSuccessAt: string | undefined;
  private controlLastError: string | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private state: DshRuntimeHealth["state"] = "NOT_STARTED";
  private lastSuccessAt: string | undefined;
  private lastError: string | undefined;

  constructor(private readonly options: DshRuntimeOptions) {
    this.controlState = options.requireControlBridge === true ? "STARTING" : "DISABLED";
  }

  async start(): Promise<void> {
    if (this.state === "READY") return;
    if (this.state === "CLOSED") throw new Error("DSH runtime is closed");
    this.state = "STARTING";
    try {
      if (this.options.requireControlBridge === true) await this.prepareControlBridge();
      this.ensureBridgeProcess();
      await this.request("start", {});
      if (this.options.requireControlBridge === true) await this.connectControlBridge();
      this.state = "READY";
      this.markSuccess();
    } catch (error) {
      this.state = "FAILED";
      if (this.options.requireControlBridge === true) {
        this.controlState = "FAILED";
        this.controlLastError = error instanceof Error ? error.message : String(error);
      }
      this.process?.kill("SIGTERM");
      this.markFailure(error);
      throw error;
    }
  }

  async run(sessionId: string, prompt: string): Promise<DshRunResult> {
    await this.start();
    try {
      const result = record(await this.request("run", {
        session_id: sessionId,
        prompt
      }));
      this.markSuccess();
      return {
        sessionId: String(result.session_id ?? sessionId),
        finalResponse: String(result.final_response ?? ""),
        events: Array.isArray(result.events) ? result.events as DshRunResult["events"] : [],
        notificationCount: Number(result.notification_count ?? 0),
        ...(typeof result.finish_reason === "string"
          ? { finishReason: result.finish_reason }
          : {}),
        ...(result.turn_error !== null && typeof result.turn_error === "object"
          ? {
              turnError: {
                code: String(record(result.turn_error).code ?? "DSH_TURN_FAILED"),
                message: String(record(result.turn_error).message ?? "DSH turn failed")
              }
            }
          : {})
      };
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async configureTools(sessionId: string, context: Record<string, unknown>): Promise<void> {
    await this.start();
    await this.controlRequest((client) => client.configureTools(sessionId, context));
  }

  async resume(sessionId: string): Promise<void> {
    await this.start();
    try {
      await this.request("resume", { session_id: sessionId });
      this.markSuccess();
    } catch (error) {
      this.markFailure(error);
      throw error;
    }
  }

  async flush(sessionId: string): Promise<DshFlushResult> {
    return this.controlRequest((client) => client.flush(sessionId));
  }

  async cancel(sessionId: string): Promise<DshCancelResult> {
    return this.controlRequest((client) => client.cancel(sessionId));
  }

  async events(
    sessionId: string,
    afterSequence: number,
    limit: number
  ): Promise<DshEventsResult> {
    return this.controlRequest((client) => client.events(sessionId, afterSequence, limit));
  }

  async release(sessionId: string): Promise<DshReleaseResult> {
    return this.controlRequest((client) => client.release(sessionId));
  }

  async recycle(): Promise<void> {
    await this.close();
    this.state = "NOT_STARTED";
    await this.start();
  }

  async upsertAssignmentGuard(snapshot: DshAssignmentGuardSnapshot): Promise<void> {
    await this.controlRequest((client) => client.upsertAssignmentGuard(snapshot));
  }

  async assignmentGuard(
    sessionId: string,
    kind: "step" | "tool"
  ): Promise<DshGuardDecision> {
    return this.controlRequest((client) => client.assignmentGuard(sessionId, kind));
  }

  async close(): Promise<void> {
    if (this.state === "CLOSED") return;
    const child = this.process;
    this.state = "CLOSED";
    if (child !== undefined && child.exitCode === null) {
      try {
        await this.request("close", {});
      } catch {
        child.kill("SIGTERM");
      }
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve();
          }, 2_000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    }
    this.process = undefined;
    this.controlClient = undefined;
    this.controlHandshake = undefined;
    this.controlState = this.options.requireControlBridge === true ? "CLOSED" : "DISABLED";
    if (this.controlEndpointFile !== undefined) {
      await rm(this.controlEndpointFile, { force: true });
    }
  }

  health(): DshRuntimeHealth {
    return {
      state: this.state,
      profile: this.options.profile,
      version: "0.2.1-rc.3",
      ...(this.lastSuccessAt === undefined ? {} : { lastSuccessAt: this.lastSuccessAt }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      controlBridge: {
        state: this.controlState,
        ...(this.controlHandshake === undefined
          ? {}
          : {
              protocolVersion: this.controlHandshake.protocolVersion,
              bridgeBuild: this.controlHandshake.bridgeBuild
            }),
        ...(this.controlLastSuccessAt === undefined
          ? {}
          : { lastSuccessAt: this.controlLastSuccessAt }),
        ...(this.controlLastError === undefined ? {} : { lastError: this.controlLastError })
      }
    };
  }

  private async prepareControlBridge(): Promise<void> {
    const runtimeId = this.options.runtimeId;
    const runtimeEpoch = this.options.runtimeEpoch;
    const controlDirectory = this.options.controlDirectory;
    if (
      runtimeId === undefined
      || runtimeEpoch === undefined
      || controlDirectory === undefined
    ) {
      throw new DshBridgeControlError(
        "BRIDGE_CONFIGURATION",
        "runtimeId, runtimeEpoch and controlDirectory are required for the PC control bridge"
      );
    }
    await mkdir(controlDirectory, { recursive: true });
    const entries = await readdir(controlDirectory, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile() && /^endpoint-.*\.json$/u.test(entry.name))
      .map((entry) => rm(join(controlDirectory, entry.name), { force: true })));
    this.controlSecret = randomBytes(32).toString("hex");
    this.controlEndpointFile = join(
      controlDirectory,
      `endpoint-${process.pid}-${randomUUID()}.json`
    );
    await rm(this.controlEndpointFile, { force: true });
    this.controlState = "STARTING";
    this.controlLastError = undefined;
  }

  private async connectControlBridge(): Promise<void> {
    const endpointFile = this.controlEndpointFile;
    const secret = this.controlSecret;
    if (endpointFile === undefined || secret === undefined) {
      throw new DshBridgeControlError("BRIDGE_CONFIGURATION", "control bridge was not prepared");
    }
    const deadline = Date.now() + (this.options.initializeTimeoutMs ?? 30_000);
    let port: number | undefined;
    while (Date.now() < deadline) {
      try {
        const endpoint = JSON.parse(await readFile(endpointFile, "utf8")) as {
          host?: unknown;
          port?: unknown;
        };
        if (
          endpoint.host !== "127.0.0.1"
          || !Number.isInteger(endpoint.port)
          || Number(endpoint.port) <= 0
        ) {
          throw new DshBridgeControlError(
            "BRIDGE_PROTOCOL",
            "control bridge endpoint file is invalid"
          );
        }
        port = Number(endpoint.port);
        break;
      } catch (error) {
        if (
          error instanceof DshBridgeControlError
          || (error as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (port === undefined) {
      throw new DshBridgeControlError(
        "BRIDGE_STARTUP_TIMEOUT",
        "timed out waiting for the PC control bridge endpoint",
        true
      );
    }
    const client = new PcRuntimeBridgeClient(
      `http://127.0.0.1:${port}`,
      secret,
      this.options.requestTimeoutMs ?? 10_000
    );
    const handshake = await client.handshake();
    this.assertHandshake(handshake);
    this.controlClient = client;
    this.controlHandshake = handshake;
    this.controlState = "READY";
    this.markControlSuccess();
  }

  private assertHandshake(handshake: DshBridgeHandshake): void {
    if (handshake.protocolVersion !== "1.0") {
      throw new DshBridgeControlError(
        "BRIDGE_PROTOCOL_INCOMPATIBLE",
        `unsupported PC bridge protocol: ${handshake.protocolVersion}`
      );
    }
    if (
      handshake.runtimeId !== this.options.runtimeId
      || handshake.runtimeEpoch !== this.options.runtimeEpoch
    ) {
      throw new DshBridgeControlError(
        "BRIDGE_IDENTITY_MISMATCH",
        "PC bridge runtime identity does not match the Runtime Host"
      );
    }
    if (
      handshake.dshVersion !== "0.2.1-rc.3"
      || handshake.profileId !== this.options.profile
      || handshake.profileDigest !== (this.options.profileDigest ?? "process-copilot-runtime-dev04")
    ) {
      throw new DshBridgeControlError(
        "BRIDGE_PROFILE_INCOMPATIBLE",
        "PC bridge DSH/profile tuple is incompatible"
      );
    }
    if (
      !handshake.capabilities.sessionFlush
      || !handshake.capabilities.sessionCancel
      || !handshake.capabilities.sessionEvents
      || !handshake.capabilities.sessionRelease
      || !handshake.capabilities.stepGuard
      || !handshake.capabilities.toolGuard
    ) {
      throw new DshBridgeControlError(
        "BRIDGE_CAPABILITY_MISSING",
        "PC bridge is missing a required P1-B capability"
      );
    }
  }

  private async controlRequest<T>(
    operation: (client: PcRuntimeBridgeClient) => Promise<T>
  ): Promise<T> {
    const client = this.controlClient;
    if (client === undefined || this.controlState !== "READY") {
      throw new DshBridgeControlError(
        "BRIDGE_UNAVAILABLE",
        "PC control bridge is not ready",
        true
      );
    }
    try {
      const result = await operation(client);
      this.markControlSuccess();
      return result;
    } catch (error) {
      this.controlLastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private ensureBridgeProcess(): void {
    if (this.process !== undefined && this.process.exitCode === null) return;
    const command = this.options.bridgeCommand ?? "python";
    const args = this.options.bridgeArgs
      ?? [this.options.bridgeScript ?? "/app/python/dsh_runtime_bridge.py"];
    const child = spawn(command, args, {
      cwd: this.options.workspace,
      env: {
        ...(this.options.environment ?? process.env),
        DSH_HOME: this.options.dshHome,
        DSH_PROFILE: this.options.profile,
        DSH_WORKSPACE: this.options.workspace,
        DSH_PROVIDER: this.options.provider,
        DSH_MODEL: this.options.model,
        ...(this.options.profilePatch === undefined
          ? {}
          : { DSH_PROFILE_PATCH: this.options.profilePatch }),
        ...(this.options.dshBin === undefined ? {} : { DSH_BIN: this.options.dshBin }),
        DSH_INITIALIZE_TIMEOUT_MS: String(this.options.initializeTimeoutMs ?? 30_000),
        ...(this.options.requireControlBridge === true
          ? {
              PC_BRIDGE_SECRET: this.controlSecret ?? "",
              PC_BRIDGE_ENDPOINT_FILE: this.controlEndpointFile ?? "",
              PC_BRIDGE_PROTOCOL_VERSION: "1.0",
              PC_BRIDGE_BUILD: "process-copilot-dev04",
              PC_RUNTIME_ID: this.options.runtimeId ?? "",
              PC_RUNTIME_EPOCH: String(this.options.runtimeEpoch ?? ""),
              PC_DSH_VERSION: "0.2.1-rc.3",
              PC_RUNTIME_PROFILE_ID: this.options.profile,
              PC_RUNTIME_PROFILE_DIGEST:
                this.options.profileDigest ?? "process-copilot-runtime-dev04"
            }
          : {}),
        ...(this.options.requestTimeoutMs === undefined
          ? {}
          : { DSH_REQUEST_TIMEOUT_MS: String(this.options.requestTimeoutMs) })
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[dsh-sdk-bridge] ${chunk.toString()}`);
    });
    child.once("error", (error) => this.failPending(error));
    child.once("exit", (code, signal) => {
      this.process = undefined;
      if (this.state !== "CLOSED") {
        this.state = "FAILED";
        this.failPending(
          new Error(`DSH SDK bridge exited code=${String(code)} signal=${String(signal)}`)
        );
      }
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleResponse(line));
    this.process = child;
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.process;
    if (child === undefined || child.exitCode !== null) {
      return Promise.reject(new Error("DSH SDK bridge is not running"));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error === null || error === undefined) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private handleResponse(line: string): void {
    let response: BridgeResponse;
    try {
      response = JSON.parse(line) as BridgeResponse;
    } catch (error) {
      this.failPending(
        new Error(`DSH SDK bridge emitted invalid JSON: ${String(error)}`)
      );
      return;
    }
    const request = this.pending.get(response.id);
    if (request === undefined) return;
    this.pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error ?? "DSH SDK bridge request failed"));
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.markFailure(error);
  }

  private markSuccess(): void {
    this.lastSuccessAt = new Date().toISOString();
    this.lastError = undefined;
  }

  private markFailure(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  private markControlSuccess(): void {
    this.controlLastSuccessAt = new Date().toISOString();
    this.controlLastError = undefined;
  }
}
