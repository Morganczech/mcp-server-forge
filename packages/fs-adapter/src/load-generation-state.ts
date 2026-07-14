import { validateGenerationState } from "@mcp-server-forge/templates";
import { hasErrors, sortDiagnostics } from "@mcp-server-forge/validators";

import {
  filesystemDiagnostic,
  inspectRegularFile,
  readBoundedRegularFile,
  resolveDirectoryRoot,
  resolveMaxFileSize,
} from "./filesystem.js";
import {
  DEFAULT_GENERATION_STATE_PATH,
  type ForgeFilesystemReadOptions,
  type ForgeGenerationStateLoadResult,
} from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export async function loadGenerationState(
  rootPath: string,
  options: ForgeFilesystemReadOptions = {},
): Promise<ForgeGenerationStateLoadResult> {
  const root = await resolveDirectoryRoot(rootPath);
  const limit = resolveMaxFileSize(options.maxFileSizeBytes);
  const diagnostics = [...root.diagnostics, ...limit.diagnostics];
  if (root.diagnostics.length > 0 || limit.value === undefined) {
    return {
      success: false,
      available: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const inspected = await inspectRegularFile(
    root.path,
    DEFAULT_GENERATION_STATE_PATH,
  );
  if (inspected.kind === "missing") {
    return { success: true, available: false, diagnostics: [] };
  }
  if (inspected.kind === "error") {
    const resultDiagnostics = sortDiagnostics([
      ...diagnostics,
      ...inspected.diagnostics,
      filesystemDiagnostic(
        "FS_GENERATION_STATE_READ_FAILED",
        DEFAULT_GENERATION_STATE_PATH,
      ),
    ]);
    return { success: false, available: false, diagnostics: resultDiagnostics };
  }

  const read = await readBoundedRegularFile(inspected, limit.value);
  if (read.kind !== "content") {
    if (read.kind === "too-large") {
      diagnostics.push(
        filesystemDiagnostic(
          "FS_FILE_TOO_LARGE",
          DEFAULT_GENERATION_STATE_PATH,
          { maxFileSizeBytes: limit.value, size: read.size },
        ),
      );
    }
    diagnostics.push(
      filesystemDiagnostic(
        "FS_GENERATION_STATE_READ_FAILED",
        DEFAULT_GENERATION_STATE_PATH,
      ),
    );
    return {
      success: false,
      available: false,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(read.content));
  } catch {
    diagnostics.push(
      filesystemDiagnostic(
        "FS_GENERATION_STATE_INVALID",
        DEFAULT_GENERATION_STATE_PATH,
      ),
    );
    return {
      success: false,
      available: true,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const validated = validateGenerationState(parsed);
  if (!validated.success) {
    diagnostics.push(
      filesystemDiagnostic(
        "FS_GENERATION_STATE_INVALID",
        DEFAULT_GENERATION_STATE_PATH,
      ),
      ...validated.diagnostics,
    );
    return {
      success: false,
      available: true,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    success: !hasErrors(sortedDiagnostics),
    available: true,
    state: validated.data,
    diagnostics: sortedDiagnostics,
  };
}
