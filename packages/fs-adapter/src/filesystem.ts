import { constants, lstat, open, realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { platform } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { isPortableRelativePath } from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  type ForgeDiagnostic,
  type ForgeDiagnosticCode,
} from "@mcp-server-forge/validators";

import { DEFAULT_MAX_FILE_SIZE_BYTES } from "./types.js";

export interface ResolvedRoot {
  path: string;
  diagnostics: ForgeDiagnostic[];
}

export type InspectedFile =
  | { kind: "missing" }
  | { kind: "error"; exists: boolean; diagnostics: ForgeDiagnostic[] }
  | { kind: "file"; path: string; stats: Stats };

export type BoundedReadResult =
  | { kind: "content"; content: Uint8Array }
  | { kind: "too-large"; size: number }
  | { kind: "error" };

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function diagnostic(
  code: ForgeDiagnosticCode,
  path: string,
  metadata?: Record<string, unknown>,
): ForgeDiagnostic {
  return createDiagnostic(code, path.length === 0 ? [] : [path], metadata);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

export function resolveMaxFileSize(value: number | undefined): {
  value?: number;
  diagnostics: ForgeDiagnostic[];
} {
  if (value === undefined) {
    return { value: DEFAULT_MAX_FILE_SIZE_BYTES, diagnostics: [] };
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      diagnostics: [
        diagnostic("FS_PATH_INVALID", "options.maxFileSizeBytes", { value }),
      ],
    };
  }
  return { value, diagnostics: [] };
}

export async function resolveDirectoryRoot(
  rootPath: string,
): Promise<ResolvedRoot> {
  if (!isAbsolute(rootPath)) {
    return {
      path: rootPath,
      diagnostics: [diagnostic("FS_PATH_INVALID", "rootPath")],
    };
  }

  try {
    const rootStats = await stat(rootPath);
    if (!rootStats.isDirectory()) {
      return {
        path: rootPath,
        diagnostics: [diagnostic("FS_ROOT_NOT_DIRECTORY", "rootPath")],
      };
    }
    return { path: await realpath(rootPath), diagnostics: [] };
  } catch (error) {
    return {
      path: rootPath,
      diagnostics: [
        diagnostic(
          errorCode(error) === "ENOENT"
            ? "FS_ROOT_NOT_FOUND"
            : "FS_FILE_READ_FAILED",
          "rootPath",
        ),
      ],
    };
  }
}

export async function inspectRegularFile(
  root: string,
  portablePath: string,
): Promise<InspectedFile> {
  if (!isPortableRelativePath(portablePath)) {
    return {
      kind: "error",
      exists: false,
      diagnostics: [diagnostic("FS_PATH_INVALID", portablePath)],
    };
  }

  const segments = portablePath.split("/");
  let candidate = root;
  for (const [index, segment] of segments.entries()) {
    candidate = join(candidate, segment);
    let candidateStats: Stats;
    try {
      candidateStats = await lstat(candidate);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { kind: "missing" };
      return {
        kind: "error",
        exists: true,
        diagnostics: [diagnostic("FS_FILE_READ_FAILED", portablePath)],
      };
    }

    if (candidateStats.isSymbolicLink()) {
      return {
        kind: "error",
        exists: true,
        diagnostics: [diagnostic("FS_SYMLINK_REJECTED", portablePath)],
      };
    }
    const finalSegment = index === segments.length - 1;
    if (!finalSegment && !candidateStats.isDirectory()) {
      return {
        kind: "error",
        exists: true,
        diagnostics: [diagnostic("FS_PATH_TYPE_UNSUPPORTED", portablePath)],
      };
    }
    if (finalSegment && !candidateStats.isFile()) {
      return {
        kind: "error",
        exists: true,
        diagnostics: [diagnostic("FS_PATH_TYPE_UNSUPPORTED", portablePath)],
      };
    }
  }

  try {
    const canonicalPath = await realpath(candidate);
    if (!isWithinRoot(root, canonicalPath)) {
      return {
        kind: "error",
        exists: true,
        diagnostics: [diagnostic("FS_PATH_OUTSIDE_ROOT", portablePath)],
      };
    }
    return {
      kind: "file",
      path: canonicalPath,
      stats: await stat(canonicalPath),
    };
  } catch {
    return {
      kind: "error",
      exists: true,
      diagnostics: [diagnostic("FS_FILE_READ_FAILED", portablePath)],
    };
  }
}

export async function readBoundedRegularFile(
  inspected: Extract<InspectedFile, { kind: "file" }>,
  maxFileSizeBytes: number,
): Promise<BoundedReadResult> {
  if (inspected.stats.size > maxFileSizeBytes) {
    return { kind: "too-large", size: inspected.stats.size };
  }

  let handle;
  try {
    handle = await open(
      inspected.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) return { kind: "error" };
    if (openedStats.size > maxFileSizeBytes) {
      return { kind: "too-large", size: openedStats.size };
    }
    const content = await handle.readFile();
    if (content.byteLength > maxFileSizeBytes) {
      return { kind: "too-large", size: content.byteLength };
    }
    return { kind: "content", content };
  } catch {
    return { kind: "error" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function executableFromStats(stats: Stats): boolean | undefined {
  return platform() === "win32" ? undefined : (stats.mode & 0o111) !== 0;
}

export function filesystemDiagnostic(
  code: ForgeDiagnosticCode,
  path: string,
  metadata?: Record<string, unknown>,
): ForgeDiagnostic {
  return diagnostic(code, path, metadata);
}
