import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  ImmutableBlobStore,
  MaterializedEntry,
  WorkspaceMaterializer
} from "./types.js";
import { ResourceError } from "./types.js";

function sha256(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function safeId(value: string, field: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new ResourceError(
      "PC_RESOURCE_PATH_COMPONENT_INVALID",
      `${field} is not a typed path component`,
      false,
      { field }
    );
  }
  return value;
}

async function assertNotLink(target: string): Promise<void> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      throw new ResourceError(
        "PC_RESOURCE_SYMLINK_REJECTED",
        "Materialization path cannot contain a symbolic link"
      );
    }
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "ENOENT"
    ) return;
    throw error;
  }
}

async function ensureDirectoryTree(root: string, components: string[]): Promise<string> {
  let current = root;
  for (const component of components) {
    current = path.resolve(current, component);
    assertContained(root, current);
    await assertNotLink(current);
    await mkdir(current, { recursive: false }).catch((error: unknown) => {
      if (
        error instanceof Error
        && "code" in error
        && (error as NodeJS.ErrnoException).code === "EEXIST"
      ) return;
      throw error;
    });
    await assertNotLink(current);
  }
  return current;
}

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  ) return;
  throw new ResourceError(
    "PC_RESOURCE_PATH_ESCAPE",
    "Materialization path escapes the configured root"
  );
}

export class LocalImmutableBlobStore implements ImmutableBlobStore {
  constructor(private readonly root: string) {}

  async put(content: Uint8Array, expectedDigest: string): Promise<string> {
    const actual = sha256(content);
    if (actual !== expectedDigest) {
      throw new ResourceError(
        "PC_RESOURCE_DIGEST_MISMATCH",
        "Blob content does not match the expected digest"
      );
    }
    const hex = actual.slice("sha256:".length);
    const configuredRoot = path.resolve(this.root);
    await mkdir(configuredRoot, { recursive: true });
    await assertNotLink(configuredRoot);
    const canonicalRoot = await realpath(configuredRoot);
    const prefixRoot = await ensureDirectoryTree(canonicalRoot, [hex.slice(0, 2)]);
    const target = path.resolve(prefixRoot, hex);
    assertContained(canonicalRoot, target);
    await assertNotLink(target);
    try {
      const existing = await readFile(target);
      if (sha256(existing) !== actual) {
        throw new ResourceError(
          "PC_RESOURCE_BLOB_COLLISION",
          "Existing immutable blob failed digest verification"
        );
      }
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        await writeFile(target, content, { flag: "wx" });
        await chmod(target, 0o444);
      } else {
        throw error;
      }
    }
    return `blob:sha256:${hex}`;
  }

  async read(blobRef: string): Promise<Uint8Array> {
    const match = /^blob:sha256:([a-f0-9]{64})$/u.exec(blobRef);
    if (match?.[1] === undefined) {
      throw new ResourceError(
        "PC_RESOURCE_BLOB_REF_INVALID",
        "Blob reference is not a valid immutable content reference"
      );
    }
    const configuredRoot = path.resolve(this.root);
    await assertNotLink(configuredRoot);
    const canonicalRoot = await realpath(configuredRoot);
    const target = path.resolve(canonicalRoot, match[1].slice(0, 2), match[1]);
    assertContained(canonicalRoot, target);
    await assertNotLink(target);
    return readFile(target);
  }
}

export class LocalWorkspaceMaterializer implements WorkspaceMaterializer {
  constructor(private readonly root: string) {}

  async materialize(
    input: Parameters<WorkspaceMaterializer["materialize"]>[0]
  ): Promise<{ internal_root: string; entries: MaterializedEntry[] }> {
    const components = [
      safeId(input.tenant_id, "tenant_id"),
      safeId(input.principal_id, "principal_id"),
      safeId(input.pc_session_id, "pc_session_id"),
      `${safeId(input.target_runtime_id, "target_runtime_id")}-${input.target_runtime_epoch}`,
      safeId(input.materialization_id, "materialization_id")
    ];
    const configuredRoot = path.resolve(this.root);
    await mkdir(configuredRoot, { recursive: true });
    await assertNotLink(configuredRoot);
    const canonicalRoot = await realpath(configuredRoot);
    const targetRoot = await ensureDirectoryTree(canonicalRoot, components);

    const materialized: MaterializedEntry[] = [];
    try {
      for (const [index, entry] of input.entries.entries()) {
        const rawExtension = path.extname(entry.display_name).slice(0, 16);
        const extension = /^\.[a-zA-Z0-9]+$/u.test(rawExtension)
          ? rawExtension
          : "";
        const relativePath = `input/${String(index + 1).padStart(3, "0")}-${safeId(
          entry.version.resource_version_id,
          "resource_version_id"
        )}${extension}`;
        const target = path.resolve(targetRoot, ...relativePath.split("/"));
        assertContained(targetRoot, target);
        await mkdir(path.dirname(target), { recursive: true });
        await assertNotLink(path.dirname(target));
        await writeFile(target, entry.content, { flag: "wx" });
        await chmod(target, entry.mode === "READ_ONLY" ? 0o444 : 0o600);
        materialized.push({
          resource_id: entry.version.resource_id,
          resource_version_id: entry.version.resource_version_id,
          relative_path: relativePath,
          content_digest: entry.version.content_digest,
          bytes: entry.version.bytes,
          mode: entry.mode
        });
      }
      return { internal_root: targetRoot, entries: materialized };
    } catch (error) {
      await rm(targetRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async cleanup(internalRoot: string): Promise<void> {
    const configuredRoot = path.resolve(this.root);
    const canonicalRoot = await realpath(configuredRoot);
    const target = path.resolve(internalRoot);
    assertContained(canonicalRoot, target);
    if (target === canonicalRoot) {
      throw new ResourceError(
        "PC_RESOURCE_CLEANUP_ROOT_REJECTED",
        "Configured materialization root cannot be removed"
      );
    }
    await assertNotLink(target);
    await rm(target, { recursive: true, force: true });
  }
}
