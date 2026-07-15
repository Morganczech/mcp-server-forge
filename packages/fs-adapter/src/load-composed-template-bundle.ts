import { lstat } from "node:fs/promises";
import { join } from "node:path";

import {
  resolveCapabilityComposition,
  validateCapabilityManifest,
  type ForgeCapabilityBundle,
} from "@mcp-server-forge/capabilities";
import type { ForgeConfig } from "@mcp-server-forge/schemas";
import { compareAscii } from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
} from "@mcp-server-forge/validators";

import {
  filesystemDiagnostic,
  inspectRegularFile,
  readBoundedRegularFile,
  resolveDirectoryRoot,
  resolveMaxFileSize,
} from "./filesystem.js";
import { loadTemplateBundle } from "./load-template-bundle.js";
import type {
  ForgeComposedTemplateBundleLoadResult,
  ForgeFilesystemReadOptions,
} from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

async function loadCapabilityBundle(
  capabilityRoot: string,
  id: string,
  options: ForgeFilesystemReadOptions,
): Promise<{
  bundle?: ForgeCapabilityBundle;
  diagnostics: ReturnType<typeof createDiagnostic>[];
}> {
  const diagnostics: ReturnType<typeof createDiagnostic>[] = [];
  const bundlePath = join(capabilityRoot, id);
  try {
    if ((await lstat(bundlePath)).isSymbolicLink()) {
      diagnostics.push(
        filesystemDiagnostic("FS_SYMLINK_REJECTED", `capabilities/${id}`),
        createDiagnostic("CAP_UNKNOWN", ["capabilities", id], { id }),
      );
      return { diagnostics };
    }
  } catch {
    // Root resolution below produces the stable missing/read diagnostic.
  }
  const root = await resolveDirectoryRoot(bundlePath);
  diagnostics.push(...root.diagnostics);
  const limit = resolveMaxFileSize(options.maxFileSizeBytes);
  diagnostics.push(...limit.diagnostics);
  if (root.diagnostics.length > 0 || limit.value === undefined) {
    diagnostics.push(
      createDiagnostic("CAP_UNKNOWN", ["capabilities", id], { id }),
    );
    return { diagnostics };
  }
  const manifestFile = await inspectRegularFile(root.path, "capability.json");
  if (manifestFile.kind !== "file") {
    diagnostics.push(
      createDiagnostic("CAP_UNKNOWN", ["capabilities", id], { id }),
    );
    if (manifestFile.kind === "error")
      diagnostics.push(...manifestFile.diagnostics);
    return { diagnostics };
  }
  const manifestRead = await readBoundedRegularFile(manifestFile, limit.value);
  if (manifestRead.kind !== "content") {
    diagnostics.push(
      filesystemDiagnostic(
        "FS_FILE_READ_FAILED",
        `capabilities/${id}/capability.json`,
      ),
    );
    return { diagnostics };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(manifestRead.content));
  } catch {
    diagnostics.push(
      createDiagnostic("CAP_MANIFEST_INVALID", ["capabilities", id]),
    );
    return { diagnostics };
  }
  const validation = validateCapabilityManifest(raw);
  diagnostics.push(...validation.diagnostics);
  if (!validation.success || validation.data.id !== id) {
    if (validation.success) {
      diagnostics.push(
        createDiagnostic("CAP_MANIFEST_INVALID", ["capabilities", id, "id"]),
      );
    }
    return { diagnostics };
  }
  const templateSources: Record<string, string> = {};
  for (const source of [
    ...new Set(validation.data.files.map(({ source }) => source)),
  ].sort(compareAscii)) {
    const file = await inspectRegularFile(root.path, source);
    if (file.kind !== "file") {
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_MISSING", source),
      );
      if (file.kind === "error") diagnostics.push(...file.diagnostics);
      continue;
    }
    const read = await readBoundedRegularFile(file, limit.value);
    if (read.kind !== "content") {
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_READ_FAILED", source),
      );
      continue;
    }
    try {
      templateSources[source] = decoder.decode(read.content);
    } catch {
      diagnostics.push(
        filesystemDiagnostic("FS_TEMPLATE_SOURCE_READ_FAILED", source),
      );
    }
  }
  return {
    ...(hasErrors(diagnostics)
      ? {}
      : { bundle: { manifest: validation.data, templateSources } }),
    diagnostics,
  };
}

export async function loadComposedTemplateBundle(
  templateDirectory: string,
  capabilityRoot: string | undefined,
  config: ForgeConfig,
  options: ForgeFilesystemReadOptions = {},
): Promise<ForgeComposedTemplateBundleLoadResult> {
  const template = await loadTemplateBundle(templateDirectory, options);
  const diagnostics = [...template.diagnostics];
  if (!template.success || template.bundle === undefined) {
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  if (config.capabilities.length === 0) {
    return {
      success: true,
      bundle: { ...template.bundle, effectiveConfig: config },
      diagnostics: sortDiagnostics(diagnostics),
    };
  }
  if (capabilityRoot === undefined) {
    diagnostics.push(
      createDiagnostic("CAP_UNKNOWN", ["capabilities"], {
        reason: "capability root missing",
      }),
    );
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }
  try {
    if ((await lstat(capabilityRoot)).isSymbolicLink()) {
      diagnostics.push(
        filesystemDiagnostic("FS_SYMLINK_REJECTED", "capabilityRoot"),
      );
      return { success: false, diagnostics: sortDiagnostics(diagnostics) };
    }
  } catch {
    // Individual bundle loading produces the stable missing/read diagnostics.
  }
  const loaded = await Promise.all(
    [...new Set(config.capabilities)]
      .sort(compareAscii)
      .map((id) => loadCapabilityBundle(capabilityRoot, id, options)),
  );
  diagnostics.push(...loaded.flatMap(({ diagnostics: value }) => value));
  const composition = resolveCapabilityComposition({
    config,
    templateManifest: template.bundle.manifest,
    templateSources: template.bundle.templateSources,
    requestedCapabilities: config.capabilities,
    capabilityBundles: loaded.flatMap(({ bundle }) =>
      bundle === undefined ? [] : [bundle],
    ),
  });
  diagnostics.push(...composition.diagnostics);
  const sorted = sortDiagnostics(diagnostics);
  if (!composition.success || hasErrors(sorted))
    return { success: false, diagnostics: sorted };
  const { renderComposition, ...bundle } = composition.data;
  return {
    success: true,
    bundle: {
      manifest: bundle.manifest,
      templateSources: bundle.templateSources,
      effectiveConfig: renderComposition.effectiveConfig,
      composition: {
        capabilityIds: renderComposition.capabilityIds,
        runtimeDependencies: renderComposition.runtimeDependencies,
        developmentDependencies: renderComposition.developmentDependencies,
        declaredTools: renderComposition.declaredTools,
        declaredAllowedReadPaths: renderComposition.declaredAllowedReadPaths,
      },
    },
    diagnostics: sorted,
  };
}
