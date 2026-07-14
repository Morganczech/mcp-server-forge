import {
  compareAscii,
  createFilePlan,
  hashGeneratedContent,
  isPortableRelativePath,
  type ForgeFilePlanReasonCode,
  type ForgeGeneratedFileState,
  type ForgeTemplateFile,
} from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
  type ForgeDiagnosticCode,
} from "@mcp-server-forge/validators";

import type {
  ForgeGenerationPreview,
  ForgeGenerationPreviewRequest,
  ForgeGenerationPreviewSummary,
  ForgeGenerationPreviewValidationResult,
  ForgeGenerationReasonCode,
  ForgeOrphanedGeneratedFile,
  ForgePlannedFile,
  ForgePlannedFileInput,
  ForgePlannedFileResult,
  ForgeRenderedFile,
  ForgeTargetFileState,
  ForgeTargetState,
} from "./types.js";

const SHA_256 = /^[a-f0-9]{64}$/;

interface PreviewAnalysis {
  diagnostics: ForgeDiagnostic[];
  blockedPaths: Set<string>;
  manifestByPath: Map<string, ForgeTemplateFile>;
  targetByPath: Map<string, ForgeTargetFileState>;
  previousByPath: Map<string, ForgeGeneratedFileState>;
  previousUsable: boolean;
  renderIdentityMismatch: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: ForgeDiagnostic[],
  code: ForgeDiagnosticCode,
  path: Array<string | number>,
  metadata?: Record<string, unknown>,
): void {
  diagnostics.push(createDiagnostic(code, path, metadata));
}

function mapFirstByPath<T extends { path: string }>(
  items: ReadonlyArray<T>,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!result.has(item.path)) result.set(item.path, item);
  }
  return result;
}

function diagnoseDuplicatePaths<T extends { path: string }>(
  items: ReadonlyArray<T>,
  code: ForgeDiagnosticCode,
  root: string,
  diagnostics: ForgeDiagnostic[],
  blockedPaths: Set<string>,
): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const originalIndex = seen.get(item.path);
    if (originalIndex === undefined) {
      seen.set(item.path, index);
      return;
    }
    blockedPaths.add(item.path);
    addDiagnostic(diagnostics, code, [root, index, "path"], {
      path: item.path,
      originalIndex,
    });
  });
}

function analyzePreviewRequest(
  request: ForgeGenerationPreviewRequest,
): PreviewAnalysis {
  const diagnostics = [...request.renderResult.diagnostics];
  const blockedPaths = new Set<string>();
  const manifestByPath = mapFirstByPath(request.manifest.files);
  const targetByPath = mapFirstByPath(request.targetState.files);
  const previousFiles = request.previousState?.files ?? [];
  const previousByPath = mapFirstByPath(previousFiles);

  diagnoseDuplicatePaths(
    request.targetState.files,
    "PLAN_TARGET_PATH_DUPLICATE",
    "targetState.files",
    diagnostics,
    blockedPaths,
  );
  diagnoseDuplicatePaths(
    previousFiles,
    "PLAN_PREVIOUS_STATE_PATH_DUPLICATE",
    "previousState.files",
    diagnostics,
    blockedPaths,
  );

  for (const [index, target] of request.targetState.files.entries()) {
    if (
      !isPortableRelativePath(target.path) ||
      typeof target.exists !== "boolean" ||
      (target.contentHash !== undefined && !SHA_256.test(target.contentHash)) ||
      (target.executable !== undefined &&
        typeof target.executable !== "boolean") ||
      (!target.exists && target.contentHash !== undefined)
    ) {
      blockedPaths.add(target.path);
      addDiagnostic(diagnostics, "PLAN_REQUEST_INVALID", [
        "targetState",
        "files",
        index,
      ]);
    }
  }

  for (const [index, previous] of previousFiles.entries()) {
    if (
      !isPortableRelativePath(previous.path) ||
      !SHA_256.test(previous.generatedHash)
    ) {
      blockedPaths.add(previous.path);
      addDiagnostic(
        diagnostics,
        "PLAN_HASH_MISMATCH",
        ["previousState", "files", index, "generatedHash"],
        { path: previous.path },
      );
    }
  }

  if (!request.renderResult.success) {
    addDiagnostic(diagnostics, "PLAN_REQUEST_INVALID", ["renderResult"]);
  }

  const renderIdentityMismatch =
    request.renderResult.metadata.templateId !== request.manifest.template.id ||
    request.renderResult.metadata.templateVersion !==
      request.manifest.template.version;
  if (
    request.renderResult.metadata.templateId !== request.manifest.template.id
  ) {
    addDiagnostic(diagnostics, "PLAN_TEMPLATE_ID_MISMATCH", [
      "renderResult",
      "metadata",
      "templateId",
    ]);
  }
  if (
    request.renderResult.metadata.templateVersion !==
    request.manifest.template.version
  ) {
    addDiagnostic(diagnostics, "PLAN_TEMPLATE_VERSION_MISMATCH", [
      "renderResult",
      "metadata",
      "templateVersion",
    ]);
  }

  const previousIdMatches =
    request.previousState === undefined ||
    request.previousState.templateId === request.manifest.template.id;
  const previousVersionMatches =
    request.previousState === undefined ||
    request.previousState.templateVersion === request.manifest.template.version;
  if (!previousIdMatches) {
    addDiagnostic(diagnostics, "PLAN_TEMPLATE_ID_MISMATCH", [
      "previousState",
      "templateId",
    ]);
  }
  if (!previousVersionMatches) {
    addDiagnostic(diagnostics, "PLAN_TEMPLATE_VERSION_MISMATCH", [
      "previousState",
      "templateVersion",
    ]);
  }
  const previousUsable = previousIdMatches && previousVersionMatches;

  const renderedByPath = mapFirstByPath(request.renderResult.files);
  diagnoseDuplicatePaths(
    request.renderResult.files,
    "PLAN_RENDER_MANIFEST_MISMATCH",
    "renderResult.files",
    diagnostics,
    blockedPaths,
  );

  for (const [index, rendered] of request.renderResult.files.entries()) {
    const manifestFile = manifestByPath.get(rendered.path);
    if (manifestFile === undefined) {
      blockedPaths.add(rendered.path);
      addDiagnostic(
        diagnostics,
        "PLAN_RENDER_FILE_UNDECLARED",
        ["renderResult", "files", index, "path"],
        { path: rendered.path },
      );
      continue;
    }
    if (
      rendered.source !== manifestFile.source ||
      rendered.ownership !== manifestFile.ownership ||
      rendered.updateStrategy !== manifestFile.updateStrategy ||
      rendered.contentType !== manifestFile.contentType ||
      rendered.executable !== (manifestFile.executable ?? false)
    ) {
      blockedPaths.add(rendered.path);
      addDiagnostic(
        diagnostics,
        "PLAN_RENDER_MANIFEST_MISMATCH",
        ["renderResult", "files", index],
        { path: rendered.path },
      );
    }
    if (
      !SHA_256.test(rendered.contentHash) ||
      hashGeneratedContent(rendered.content) !== rendered.contentHash
    ) {
      blockedPaths.add(rendered.path);
      addDiagnostic(
        diagnostics,
        "PLAN_HASH_MISMATCH",
        ["renderResult", "files", index, "contentHash"],
        { path: rendered.path },
      );
    }
  }

  const conditionSkipped = new Set(
    request.renderResult.metadata.skippedFiles
      .filter(({ reason }) => reason === "condition-not-met")
      .map(({ path }) => path),
  );
  request.manifest.files.forEach((manifestFile, index) => {
    if (
      !renderedByPath.has(manifestFile.path) &&
      !conditionSkipped.has(manifestFile.path)
    ) {
      blockedPaths.add(manifestFile.path);
      addDiagnostic(
        diagnostics,
        "PLAN_RENDER_FILE_MISSING",
        ["manifest", "files", index, "path"],
        { path: manifestFile.path },
      );
    }

    const previous = previousByPath.get(manifestFile.path);
    if (previous !== undefined && previousUsable) {
      if (previous.ownership !== manifestFile.ownership) {
        blockedPaths.add(manifestFile.path);
        addDiagnostic(diagnostics, "PLAN_OWNERSHIP_MISMATCH", [
          "previousState",
          "files",
          manifestFile.path,
          "ownership",
        ]);
      }
      if (previous.updateStrategy !== manifestFile.updateStrategy) {
        blockedPaths.add(manifestFile.path);
        addDiagnostic(diagnostics, "PLAN_UPDATE_STRATEGY_MISMATCH", [
          "previousState",
          "files",
          manifestFile.path,
          "updateStrategy",
        ]);
      }
    }
  });

  return {
    diagnostics: sortDiagnostics(diagnostics),
    blockedPaths,
    manifestByPath,
    targetByPath,
    previousByPath,
    previousUsable,
    renderIdentityMismatch,
  };
}

function reasonCode(
  reason: ForgeFilePlanReasonCode,
  targetHashMissing: boolean,
): ForgeGenerationReasonCode {
  switch (reason) {
    case "target-missing":
      return "TARGET_MISSING";
    case "target-already-matches":
      return "TARGET_ALREADY_MATCHES";
    case "create-once-preserved":
      return "CREATE_ONCE_TARGET_EXISTS";
    case "user-owned-preserved":
      return "USER_OWNED_TARGET_EXISTS";
    case "target-unmodified":
      return "TARGET_MATCHES_PREVIOUS_GENERATION";
    case "target-modified":
      return "TARGET_MODIFIED_SINCE_GENERATION";
    case "previous-state-missing":
      return targetHashMissing
        ? "TARGET_HASH_UNKNOWN"
        : "PREVIOUS_GENERATION_HASH_MISSING";
    case "unsafe-replace-blocked":
      return "EXPLICIT_REPLACE_NOT_ALLOWED";
    case "unsafe-replace-approved":
      return "EXPLICIT_REPLACE_ALLOWED";
    case "shared-merge-unavailable":
      return "SHARED_FILE_REQUIRES_MERGE";
    case "manual-strategy":
      return "MANUAL_STRATEGY";
    case "executable-change-requires-review":
      return "EXECUTABLE_FLAG_CHANGED";
    case "ownership-strategy-conflict":
      return "MAPPING_INCONSISTENT";
  }
}

export function createPlannedFile(
  input: ForgePlannedFileInput,
): ForgePlannedFileResult {
  const target = input.targetFile ?? {
    path: input.renderedFile.path,
    exists: false,
  };
  const desiredExecutable = input.manifestFile.executable ?? false;
  const executableChange =
    target.exists &&
    target.executable !== undefined &&
    target.executable !== desiredExecutable;
  const targetHashMissing = target.exists && target.contentHash === undefined;
  const base = createFilePlan({
    manifestFile: input.manifestFile,
    targetExists: target.exists,
    ...(target.contentHash === undefined
      ? {}
      : { targetHash: target.contentHash }),
    ...(input.previousFile === undefined
      ? {}
      : { previousGeneratedHash: input.previousFile.generatedHash }),
    renderedHash: input.renderedFile.contentHash,
    ...(target.executable === undefined
      ? {}
      : { targetExecutable: target.executable }),
    renderedExecutable: desiredExecutable,
    allowUnsafeReplace: input.allowExplicitReplace === true,
  });

  let action = base.plan.action;
  let stableReason = reasonCode(base.plan.reasonCode, targetHashMissing);
  if (targetHashMissing && action === "replace") {
    action = "manual-review";
    stableReason = "TARGET_HASH_UNKNOWN";
  }

  const diagnostics: ForgeDiagnostic[] = [];
  if (
    targetHashMissing &&
    (action === "conflict" || action === "manual-review")
  ) {
    addDiagnostic(diagnostics, "PLAN_TARGET_HASH_MISSING", [target.path]);
  }
  if (action === "conflict") {
    addDiagnostic(diagnostics, "PLAN_FILE_CONFLICT", [target.path]);
    if (
      input.previousFile !== undefined &&
      target.contentHash !== undefined &&
      target.contentHash !== input.previousFile.generatedHash
    ) {
      addDiagnostic(diagnostics, "PLAN_TARGET_MODIFIED", [target.path]);
    }
  }
  if (action === "manual-review") {
    addDiagnostic(diagnostics, "PLAN_MANUAL_REVIEW_REQUIRED", [target.path]);
    if (stableReason === "EXPLICIT_REPLACE_NOT_ALLOWED") {
      addDiagnostic(diagnostics, "PLAN_EXPLICIT_REPLACE_REQUIRED", [
        target.path,
      ]);
    }
  }

  const changedFromPreviousGeneration =
    input.previousFile === undefined
      ? undefined
      : input.renderedFile.contentHash !== input.previousFile.generatedHash;
  const targetModifiedByUser =
    input.previousFile === undefined || target.contentHash === undefined
      ? undefined
      : target.contentHash !== input.previousFile.generatedHash;

  return {
    file: {
      path: input.renderedFile.path,
      action,
      reasonCode: stableReason,
      ownership: input.manifestFile.ownership,
      updateStrategy: input.manifestFile.updateStrategy,
      renderedHash: input.renderedFile.contentHash,
      ...(target.contentHash === undefined
        ? {}
        : { targetHash: target.contentHash }),
      ...(input.previousFile === undefined
        ? {}
        : { previousGeneratedHash: input.previousFile.generatedHash }),
      ...(changedFromPreviousGeneration === undefined
        ? {}
        : { changedFromPreviousGeneration }),
      ...(targetModifiedByUser === undefined ? {} : { targetModifiedByUser }),
      ...(executableChange ? { executableChange: true } : {}),
    },
    diagnostics: sortDiagnostics(diagnostics),
  };
}

function blockedFile(
  rendered: ForgeRenderedFile,
  manifest: ForgeTemplateFile,
  target: ForgeTargetFileState | undefined,
  previous: ForgeGeneratedFileState | undefined,
): ForgePlannedFile {
  return {
    path: rendered.path,
    action: "conflict",
    reasonCode: "MAPPING_INCONSISTENT",
    ownership: manifest.ownership,
    updateStrategy: manifest.updateStrategy,
    renderedHash: rendered.contentHash,
    ...(target?.contentHash === undefined
      ? {}
      : { targetHash: target.contentHash }),
    ...(previous === undefined
      ? {}
      : { previousGeneratedHash: previous.generatedHash }),
  };
}

export function findOrphanedGeneratedFiles(
  previousFiles: ReadonlyArray<ForgeGeneratedFileState>,
  manifestFiles: ReadonlyArray<ForgeTemplateFile>,
  targetState: ForgeTargetState,
): ForgeOrphanedGeneratedFile[] {
  const manifestPaths = new Set(manifestFiles.map(({ path }) => path));
  const targetByPath = mapFirstByPath(targetState.files);
  return [...mapFirstByPath(previousFiles).values()]
    .filter(({ path }) => !manifestPaths.has(path))
    .map((previous) => {
      const target = targetByPath.get(previous.path);
      const targetExists = target?.exists ?? false;
      const modifiedSinceGeneration =
        targetExists && target?.contentHash !== undefined
          ? target.contentHash !== previous.generatedHash
          : undefined;
      return {
        path: previous.path,
        previousGeneratedHash: previous.generatedHash,
        targetExists,
        ...(target?.contentHash === undefined
          ? {}
          : { targetHash: target.contentHash }),
        ...(modifiedSinceGeneration === undefined
          ? {}
          : { modifiedSinceGeneration }),
      };
    })
    .sort((left, right) => compareAscii(left.path, right.path));
}

export function summarizeGenerationPlan(
  files: ReadonlyArray<ForgePlannedFile>,
): ForgeGenerationPreviewSummary {
  const summary: ForgeGenerationPreviewSummary = {
    create: 0,
    replace: 0,
    skip: 0,
    conflict: 0,
    manualReview: 0,
  };
  for (const file of files) {
    if (file.action === "manual-review") summary.manualReview += 1;
    else summary[file.action] += 1;
  }
  return summary;
}

export function isGenerationPlanSafe(
  files: ReadonlyArray<ForgePlannedFile>,
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
  orphanedFiles: ReadonlyArray<ForgeOrphanedGeneratedFile>,
): boolean {
  return (
    !hasErrors(diagnostics) &&
    orphanedFiles.length === 0 &&
    files.every(
      ({ action }) => action !== "conflict" && action !== "manual-review",
    )
  );
}

export function validateGenerationPreviewRequest(
  input: unknown,
): ForgeGenerationPreviewValidationResult {
  if (
    !isObject(input) ||
    !isObject(input.renderResult) ||
    !isObject(input.manifest) ||
    !isObject(input.targetState) ||
    !Array.isArray(input.targetState.files) ||
    (input.options !== undefined &&
      (!isObject(input.options) ||
        (input.options.allowExplicitReplace !== undefined &&
          typeof input.options.allowExplicitReplace !== "boolean")))
  ) {
    return {
      success: false,
      diagnostics: [createDiagnostic("PLAN_REQUEST_INVALID", [])],
    };
  }
  const request = input as unknown as ForgeGenerationPreviewRequest;
  let analysis: PreviewAnalysis;
  try {
    analysis = analyzePreviewRequest(request);
  } catch {
    return {
      success: false,
      diagnostics: [createDiagnostic("PLAN_REQUEST_INVALID", [])],
    };
  }
  return hasErrors(analysis.diagnostics)
    ? { success: false, diagnostics: analysis.diagnostics }
    : { success: true, data: request, diagnostics: analysis.diagnostics };
}

export function createGenerationPreview(
  request: ForgeGenerationPreviewRequest,
): ForgeGenerationPreview {
  const analysis = analyzePreviewRequest(request);
  const diagnostics = [...analysis.diagnostics];
  const files: ForgePlannedFile[] = [];

  for (const rendered of request.renderResult.files) {
    const manifestFile = analysis.manifestByPath.get(rendered.path);
    if (manifestFile === undefined) continue;
    const target = analysis.targetByPath.get(rendered.path);
    const previous = analysis.previousUsable
      ? analysis.previousByPath.get(rendered.path)
      : undefined;

    if (
      analysis.renderIdentityMismatch ||
      analysis.blockedPaths.has(rendered.path)
    ) {
      files.push(blockedFile(rendered, manifestFile, target, previous));
      addDiagnostic(diagnostics, "PLAN_UNSAFE_ACTION_BLOCKED", [rendered.path]);
      continue;
    }

    const planned = createPlannedFile({
      renderedFile: rendered,
      manifestFile,
      ...(target === undefined ? {} : { targetFile: target }),
      ...(previous === undefined ? {} : { previousFile: previous }),
      allowExplicitReplace: request.options?.allowExplicitReplace === true,
    });
    files.push(planned.file);
    diagnostics.push(...planned.diagnostics);
  }

  files.sort((left, right) => compareAscii(left.path, right.path));
  const orphanedFiles = analysis.previousUsable
    ? findOrphanedGeneratedFiles(
        request.previousState?.files ?? [],
        request.manifest.files,
        request.targetState,
      )
    : [];
  for (const orphan of orphanedFiles) {
    addDiagnostic(diagnostics, "PLAN_ORPHANED_GENERATED_FILE", [orphan.path], {
      modifiedSinceGeneration: orphan.modifiedSinceGeneration,
    });
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    success: !hasErrors(sortedDiagnostics),
    safeToApply: isGenerationPlanSafe(files, sortedDiagnostics, orphanedFiles),
    files,
    orphanedFiles,
    summary: summarizeGenerationPlan(files),
    diagnostics: sortedDiagnostics,
    metadata: {
      templateId: request.manifest.template.id,
      templateVersion: request.manifest.template.version,
      renderedFileCount: request.renderResult.files.length,
      plannedFileCount: files.length,
    },
  };
}
