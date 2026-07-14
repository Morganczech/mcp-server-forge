import {
  compareAscii,
  validateTemplateManifest,
} from "@mcp-server-forge/templates";
import { hasErrors, sortDiagnostics } from "@mcp-server-forge/validators";

import {
  filesystemDiagnostic,
  inspectRegularFile,
  readBoundedRegularFile,
  resolveDirectoryRoot,
  resolveMaxFileSize,
} from "./filesystem.js";
import type {
  ForgeFilesystemReadOptions,
  ForgeTemplateBundleLoadResult,
} from "./types.js";

const MANIFEST_PATH = "template.json";
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function loadTemplateBundle(
  templateDirectory: string,
  options: ForgeFilesystemReadOptions = {},
): Promise<ForgeTemplateBundleLoadResult> {
  const root = await resolveDirectoryRoot(templateDirectory);
  const limit = resolveMaxFileSize(options.maxFileSizeBytes);
  const diagnostics = [...root.diagnostics, ...limit.diagnostics];
  if (root.diagnostics.length > 0 || limit.value === undefined) {
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const manifestFile = await inspectRegularFile(root.path, MANIFEST_PATH);
  if (manifestFile.kind === "missing") {
    diagnostics.push(
      filesystemDiagnostic("FS_TEMPLATE_MANIFEST_NOT_FOUND", MANIFEST_PATH),
    );
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  if (manifestFile.kind === "error") {
    diagnostics.push(...manifestFile.diagnostics);
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const manifestRead = await readBoundedRegularFile(manifestFile, limit.value);
  if (manifestRead.kind !== "content") {
    if (manifestRead.kind === "too-large") {
      diagnostics.push(
        filesystemDiagnostic("FS_FILE_TOO_LARGE", MANIFEST_PATH, {
          maxFileSizeBytes: limit.value,
          size: manifestRead.size,
        }),
      );
    }
    diagnostics.push(
      filesystemDiagnostic("FS_TEMPLATE_MANIFEST_INVALID", MANIFEST_PATH),
    );
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(decoder.decode(manifestRead.content));
  } catch {
    diagnostics.push(
      filesystemDiagnostic("FS_TEMPLATE_MANIFEST_INVALID", MANIFEST_PATH),
    );
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const validated = validateTemplateManifest(manifestInput);
  if (!validated.success) {
    diagnostics.push(
      filesystemDiagnostic("FS_TEMPLATE_MANIFEST_INVALID", MANIFEST_PATH),
      ...validated.diagnostics,
    );
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const templateSources: Record<string, string> = {};
  const sources = [
    ...new Set(validated.data.files.map(({ source }) => source)),
  ].sort(compareAscii);
  for (const source of sources) {
    const sourceFile = await inspectRegularFile(root.path, source);
    if (sourceFile.kind === "missing") {
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_MISSING", source),
      );
      continue;
    }
    if (sourceFile.kind === "error") {
      diagnostics.push(...sourceFile.diagnostics);
      continue;
    }

    const sourceRead = await readBoundedRegularFile(sourceFile, limit.value);
    if (sourceRead.kind !== "content") {
      if (sourceRead.kind === "too-large") {
        diagnostics.push(
          filesystemDiagnostic("FS_FILE_TOO_LARGE", source, {
            maxFileSizeBytes: limit.value,
            size: sourceRead.size,
          }),
        );
      }
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_READ_FAILED", source),
      );
      continue;
    }
    try {
      templateSources[source] = decoder.decode(sourceRead.content);
    } catch {
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_READ_FAILED", source),
      );
    }
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const success = !hasErrors(sortedDiagnostics);
  return {
    success,
    ...(success
      ? { bundle: { manifest: validated.data, templateSources } }
      : {}),
    diagnostics: sortedDiagnostics,
  };
}
