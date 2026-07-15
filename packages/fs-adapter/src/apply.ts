import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  validateForgeApplyContract,
  type ForgeApplyContract,
  type ForgeApplyFileOperation,
} from "@mcp-server-forge/core";
import {
  hashGeneratedContent,
  isPortableRelativePath,
} from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import {
  inspectRegularFile,
  readBoundedRegularFile,
  resolveDirectoryRoot,
} from "./filesystem.js";
import { loadGenerationState } from "./load-generation-state.js";
import { loadTargetState } from "./load-target-state.js";
import {
  DEFAULT_GENERATION_STATE_PATH,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  type ForgeApplyExecutionRequest,
  type ForgeApplyExecutionResult,
} from "./types.js";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetMatches(
  operation: ForgeApplyFileOperation,
  actual:
    | Awaited<
        ReturnType<typeof loadTargetState>
      >["targetState"]["files"][number]
    | undefined,
): boolean {
  const expected = operation.expectedTarget;
  return (
    actual !== undefined &&
    actual.exists === expected.exists &&
    (expected.contentHash === undefined ||
      actual.contentHash === expected.contentHash) &&
    (expected.executable === undefined ||
      actual.executable === undefined ||
      actual.executable === expected.executable)
  );
}

async function checkParentPath(
  root: string,
  path: string,
): Promise<ForgeDiagnostic[]> {
  const diagnostics: ForgeDiagnostic[] = [];
  const parent = dirname(path).replaceAll("\\", "/");
  if (parent === ".") return diagnostics;
  let current = root;
  for (const segment of parent.split("/")) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        diagnostics.push(createDiagnostic("FS_SYMLINK_REJECTED", [path]));
        break;
      }
      if (!metadata.isDirectory()) {
        diagnostics.push(createDiagnostic("FS_PATH_TYPE_UNSUPPORTED", [path]));
        break;
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") break;
      diagnostics.push(createDiagnostic("FS_FILE_READ_FAILED", [path]));
      break;
    }
  }
  return diagnostics;
}

async function ensureParents(root: string, path: string): Promise<void> {
  const parent = dirname(path);
  if (parent === ".") return;
  let current = root;
  for (const segment of parent.split("/")) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("unsafe parent path");
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o755 });
    }
  }
}

let temporaryCounter = 0;

async function createTemporaryFile(
  target: string,
  content: string,
  mode: number,
): Promise<string> {
  for (;;) {
    temporaryCounter += 1;
    const temporary = join(
      dirname(target),
      `.${basename(target)}.mcp-forge-${process.pid}-${temporaryCounter}.tmp`,
    );
    try {
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        mode,
      );
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return temporary;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
}

async function currentTargetHash(root: string, path: string, maxBytes: number) {
  const inspected = await inspectRegularFile(root, path);
  if (inspected.kind !== "file") return undefined;
  const read = await readBoundedRegularFile(inspected, maxBytes);
  if (read.kind !== "content") return undefined;
  return hashGeneratedContent(read.content);
}

async function writeOperation(
  root: string,
  operation: ForgeApplyFileOperation,
): Promise<void> {
  await ensureParents(root, operation.path);
  const target = join(root, operation.path);
  let mode = operation.executable ? 0o755 : 0o644;
  if (operation.action === "replace") {
    const currentMode = (await stat(target)).mode;
    mode = operation.executable ? currentMode | 0o111 : currentMode & ~0o111;
  }
  const temporary = await createTemporaryFile(target, operation.content, mode);
  try {
    if (operation.action === "create") {
      await link(temporary, target);
      await unlink(temporary);
    } else {
      await rename(temporary, target);
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function writeState(
  root: string,
  statePath: string,
  contract: ForgeApplyContract,
): Promise<void> {
  await ensureParents(root, statePath);
  const target = join(root, statePath);
  const content = `${JSON.stringify(contract.nextState, null, 2)}\n`;
  const temporary = await createTemporaryFile(target, content, 0o644);
  try {
    const inspected = await inspectRegularFile(root, statePath);
    if (inspected.kind === "missing") {
      await link(temporary, target);
      await unlink(temporary);
    } else if (inspected.kind === "file") {
      await rename(temporary, target);
    } else {
      throw new Error("unsafe state target");
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function stateStillMatches(
  root: string,
  statePath: string,
  contract: ForgeApplyContract,
): Promise<boolean> {
  const loaded = await loadGenerationState(root, { statePath });
  if (!loaded.success) return false;
  return contract.previousState === null
    ? !loaded.available
    : loaded.state !== undefined &&
        sameJson(loaded.state, contract.previousState);
}

export async function applyGenerationWorkspace(
  request: ForgeApplyExecutionRequest,
): Promise<ForgeApplyExecutionResult> {
  return applyGenerationWorkspaceWithHooks(request);
}

export interface ForgeApplyExecutionTestHooks {
  beforeFileWrite?: (
    operation: ForgeApplyFileOperation,
    index: number,
  ) => void | Promise<void>;
}

export async function applyGenerationWorkspaceWithHooks(
  request: ForgeApplyExecutionRequest,
  hooks: ForgeApplyExecutionTestHooks = {},
): Promise<ForgeApplyExecutionResult> {
  const validation = validateForgeApplyContract(request.contract);
  const diagnostics: ForgeDiagnostic[] = [...validation.diagnostics];
  const appliedFiles: string[] = [];
  const statePath = request.statePath ?? DEFAULT_GENERATION_STATE_PATH;
  if (!validation.success || !isPortableRelativePath(statePath)) {
    if (!isPortableRelativePath(statePath)) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", ["statePath"]),
      );
    }
    return {
      success: false,
      appliedFiles,
      stateWritten: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }
  if (request.contract.operations.some(({ path }) => path === statePath)) {
    diagnostics.push(createDiagnostic("APPLY_CONTRACT_INVALID", ["statePath"]));
  }
  const resolved = await resolveDirectoryRoot(request.projectRoot);
  diagnostics.push(...resolved.diagnostics);
  const maxBytes =
    request.options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  for (const operation of request.contract.operations) {
    const size = Buffer.byteLength(operation.content, "utf8");
    if (size > maxBytes) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", [operation.path], {
          size,
          maxFileSizeBytes: maxBytes,
        }),
      );
    }
  }
  const stateSize = Buffer.byteLength(
    `${JSON.stringify(request.contract.nextState, null, 2)}\n`,
    "utf8",
  );
  if (stateSize > maxBytes) {
    diagnostics.push(
      createDiagnostic("APPLY_CONTRACT_INVALID", [statePath], {
        size: stateSize,
        maxFileSizeBytes: maxBytes,
      }),
    );
  }
  if (hasErrors(diagnostics)) {
    return {
      success: false,
      appliedFiles,
      stateWritten: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  for (const operation of request.contract.operations) {
    diagnostics.push(...(await checkParentPath(resolved.path, operation.path)));
  }
  diagnostics.push(...(await checkParentPath(resolved.path, statePath)));
  const targets = await loadTargetState(
    resolved.path,
    request.contract.operations.map(({ path, executable }) => ({
      path,
      expectedExecutable: executable,
    })),
    request.options,
  );
  diagnostics.push(...targets.diagnostics);
  for (const operation of request.contract.operations) {
    const actual = targets.targetState.files.find(
      ({ path }) => path === operation.path,
    );
    if (!targetMatches(operation, actual)) {
      diagnostics.push(
        createDiagnostic("APPLY_TARGET_CHANGED", [operation.path]),
      );
    }
  }
  if (!(await stateStillMatches(resolved.path, statePath, request.contract))) {
    diagnostics.push(createDiagnostic("APPLY_TARGET_CHANGED", [statePath]));
  }
  if (hasErrors(diagnostics)) {
    return {
      success: false,
      appliedFiles,
      stateWritten: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  for (const [index, operation] of request.contract.operations.entries()) {
    const fresh = await loadTargetState(
      resolved.path,
      [{ path: operation.path, expectedExecutable: operation.executable }],
      request.options,
    );
    if (
      !fresh.success ||
      !targetMatches(operation, fresh.targetState.files[0])
    ) {
      diagnostics.push(
        createDiagnostic("APPLY_TARGET_CHANGED", [operation.path]),
      );
      return {
        success: false,
        appliedFiles,
        stateWritten: false,
        diagnostics: sortDiagnostics(diagnostics),
      };
    }
    if (
      operation.action === "replace" &&
      (await currentTargetHash(resolved.path, operation.path, maxBytes)) !==
        operation.expectedTarget.contentHash
    ) {
      diagnostics.push(
        createDiagnostic("APPLY_TARGET_CHANGED", [operation.path]),
      );
      return {
        success: false,
        appliedFiles,
        stateWritten: false,
        diagnostics: sortDiagnostics(diagnostics),
      };
    }
    try {
      await hooks.beforeFileWrite?.(operation, index);
      await writeOperation(resolved.path, operation);
      appliedFiles.push(operation.path);
    } catch {
      diagnostics.push(
        createDiagnostic("APPLY_WRITE_FAILED", [operation.path]),
      );
      return {
        success: false,
        appliedFiles,
        stateWritten: false,
        diagnostics: sortDiagnostics(diagnostics),
      };
    }
  }

  if (!(await stateStillMatches(resolved.path, statePath, request.contract))) {
    diagnostics.push(createDiagnostic("APPLY_TARGET_CHANGED", [statePath]));
    return {
      success: false,
      appliedFiles,
      stateWritten: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }
  try {
    await writeState(resolved.path, statePath, request.contract);
  } catch {
    diagnostics.push(createDiagnostic("APPLY_STATE_WRITE_FAILED", [statePath]));
    return {
      success: false,
      appliedFiles,
      stateWritten: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }
  return {
    success: true,
    appliedFiles,
    stateWritten: true,
    diagnostics: sortDiagnostics(diagnostics),
  };
}
