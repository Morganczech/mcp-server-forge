import type { ForgeTargetFileState } from "@mcp-server-forge/generators";
import {
  compareAscii,
  hashGeneratedContent,
  isPortableRelativePath,
} from "@mcp-server-forge/templates";
import { hasErrors, sortDiagnostics } from "@mcp-server-forge/validators";

import {
  executableFromStats,
  filesystemDiagnostic,
  inspectRegularFile,
  readBoundedRegularFile,
  resolveDirectoryRoot,
  resolveMaxFileSize,
} from "./filesystem.js";
import type {
  ForgeFilesystemReadOptions,
  ForgeManagedTargetPath,
  ForgeTargetStateLoadResult,
} from "./types.js";

export async function loadTargetState(
  rootPath: string,
  managedPaths: ReadonlyArray<ForgeManagedTargetPath>,
  options: ForgeFilesystemReadOptions = {},
): Promise<ForgeTargetStateLoadResult> {
  const root = await resolveDirectoryRoot(rootPath);
  const limit = resolveMaxFileSize(options.maxFileSizeBytes);
  const diagnostics = [...root.diagnostics, ...limit.diagnostics];
  const files: ForgeTargetFileState[] = [];
  if (root.diagnostics.length > 0 || limit.value === undefined) {
    return {
      success: false,
      targetState: { files },
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const seen = new Map<string, number>();
  for (const [index, managed] of managedPaths.entries()) {
    if (!isPortableRelativePath(managed.path)) {
      diagnostics.push(
        filesystemDiagnostic("FS_PATH_INVALID", `managedPaths.${index}.path`),
      );
      continue;
    }
    const previousIndex = seen.get(managed.path);
    if (previousIndex !== undefined) {
      diagnostics.push(
        filesystemDiagnostic(
          "FS_DUPLICATE_NORMALIZED_PATH",
          `managedPaths.${index}.path`,
          { path: managed.path, originalIndex: previousIndex },
        ),
      );
      continue;
    }
    seen.set(managed.path, index);

    const inspected = await inspectRegularFile(root.path, managed.path);
    if (inspected.kind === "missing") {
      files.push({ path: managed.path, exists: false });
      continue;
    }
    if (inspected.kind === "error") {
      diagnostics.push(...inspected.diagnostics);
      if (inspected.exists) {
        files.push({ path: managed.path, exists: true });
      }
      continue;
    }

    const executable = executableFromStats(inspected.stats);
    const file: ForgeTargetFileState = {
      path: managed.path,
      exists: true,
      ...(executable === undefined ? {} : { executable }),
    };
    const read = await readBoundedRegularFile(inspected, limit.value);
    if (read.kind === "too-large") {
      diagnostics.push(
        filesystemDiagnostic("FS_FILE_TOO_LARGE", managed.path, {
          maxFileSizeBytes: limit.value,
          size: read.size,
        }),
      );
    } else if (read.kind === "error") {
      diagnostics.push(filesystemDiagnostic("FS_HASH_FAILED", managed.path));
    } else {
      file.contentHash = hashGeneratedContent(read.content);
    }
    files.push(file);
  }

  files.sort((left, right) => compareAscii(left.path, right.path));
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    success: !hasErrors(sortedDiagnostics),
    targetState: { files },
    diagnostics: sortedDiagnostics,
  };
}
