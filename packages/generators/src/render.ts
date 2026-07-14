import {
  compareAscii,
  hashGeneratedContent,
  type ForgeTemplateFile,
} from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { evaluateTemplateCondition } from "./conditions.js";
import { createRenderContext } from "./context.js";
import { renderTemplateSource } from "./engine.js";
import { normalizeRenderedContent } from "./normalize.js";
import type {
  ForgeRenderedFile,
  ForgeRenderedPreview,
  ForgeRenderMetadata,
  ForgeRenderRequest,
  ForgeRenderResult,
  ForgeSkippedRenderFile,
} from "./types.js";
import { validateRenderRequest } from "./validate.js";

function metadata(
  request: ForgeRenderRequest,
  renderedFileCount: number,
  skippedFiles: ForgeSkippedRenderFile[],
): ForgeRenderMetadata {
  return {
    templateId: request.manifest.template.id,
    templateVersion: request.manifest.template.version,
    manifestVersion: request.manifest.manifestVersion,
    renderedFileCount,
    skippedFileCount: skippedFiles.length,
    skippedFiles: [...skippedFiles].sort((left, right) =>
      compareAscii(left.path, right.path),
    ),
    renderEngine: "mcp-forge-restricted",
    renderEngineVersion: "1",
    hashAlgorithm: "sha256",
    lineEndings: "lf",
    trailingNewline: "exactly-one",
  };
}

function renderFile(
  file: ForgeTemplateFile,
  source: string,
  context: ReturnType<typeof createRenderContext>,
): { file?: ForgeRenderedFile; diagnostics: ForgeDiagnostic[] } {
  const rendered = renderTemplateSource(source, context, {
    diagnosticPath: [file.path],
  });
  if (!rendered.success) {
    return {
      diagnostics: [
        ...rendered.diagnostics,
        createDiagnostic("GEN_TEMPLATE_RENDER_FAILED", [file.path], {
          source: file.source,
        }),
      ],
    };
  }
  const content = normalizeRenderedContent(rendered.content, file.contentType);
  return {
    file: {
      path: file.path,
      content,
      contentHash: hashGeneratedContent(content),
      ...(file.contentType === undefined
        ? {}
        : { contentType: file.contentType }),
      executable: file.executable ?? false,
      ownership: file.ownership,
      updateStrategy: file.updateStrategy,
      source: file.source,
    },
    diagnostics: rendered.diagnostics,
  };
}

export function renderForgeTemplate(
  request: ForgeRenderRequest,
): ForgeRenderResult {
  const validation = validateRenderRequest(request);
  const baseDiagnostics = [...validation.diagnostics];
  if (
    !validation.success &&
    validation.diagnostics.some(
      ({ code }) => code === "GEN_RENDER_REQUEST_INVALID",
    )
  ) {
    return {
      success: false,
      files: [],
      diagnostics: sortDiagnostics(baseDiagnostics),
      metadata: metadata(request, 0, []),
    };
  }

  const context = createRenderContext(request.config);
  const diagnostics = baseDiagnostics;
  const files: ForgeRenderedFile[] = [];
  const skippedFiles: ForgeSkippedRenderFile[] = [];
  const manifestSources = new Set(
    request.manifest.files.map(({ source }) => source),
  );
  const sourceValues = request.templateSources as Record<string, unknown>;

  for (const source of Object.keys(sourceValues).sort(compareAscii)) {
    if (!manifestSources.has(source)) {
      diagnostics.push(
        createDiagnostic(
          "GEN_TEMPLATE_SOURCE_UNUSED",
          ["templateSources", source],
          {
            source,
          },
        ),
      );
    }
  }

  for (const manifestFile of request.manifest.files) {
    if (manifestFile.condition !== undefined) {
      const condition = evaluateTemplateCondition(
        manifestFile.condition,
        context,
      );
      if (!condition.valid) {
        diagnostics.push(
          createDiagnostic("GEN_TEMPLATE_CONDITION_INVALID", [
            manifestFile.path,
          ]),
        );
        skippedFiles.push({
          path: manifestFile.path,
          source: manifestFile.source,
          reason: "condition-invalid",
        });
        continue;
      }
      if (!condition.matches) {
        if (request.options?.includeConditionSkipDiagnostics === true) {
          diagnostics.push(
            createDiagnostic("GEN_RENDER_SKIPPED_BY_CONDITION", [
              manifestFile.path,
            ]),
          );
        }
        skippedFiles.push({
          path: manifestFile.path,
          source: manifestFile.source,
          reason: "condition-not-met",
        });
        continue;
      }
    }

    const source = sourceValues[manifestFile.source];
    if (source === undefined) {
      diagnostics.push(
        createDiagnostic("GEN_TEMPLATE_SOURCE_MISSING", [manifestFile.path], {
          source: manifestFile.source,
        }),
      );
      skippedFiles.push({
        path: manifestFile.path,
        source: manifestFile.source,
        reason: "source-missing",
      });
      continue;
    }
    if (typeof source !== "string") {
      skippedFiles.push({
        path: manifestFile.path,
        source: manifestFile.source,
        reason: "source-invalid",
      });
      continue;
    }

    const rendered = renderFile(manifestFile, source, context);
    diagnostics.push(...rendered.diagnostics);
    if (rendered.file !== undefined) files.push(rendered.file);
  }

  const seenPaths = new Set<string>();
  for (const file of files) {
    if (seenPaths.has(file.path)) {
      diagnostics.push(
        createDiagnostic("GEN_OUTPUT_PATH_DUPLICATE", [file.path]),
      );
    }
    seenPaths.add(file.path);
  }

  files.sort((left, right) => compareAscii(left.path, right.path));
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  return {
    success: !hasErrors(sortedDiagnostics),
    files,
    diagnostics: sortedDiagnostics,
    metadata: metadata(request, files.length, skippedFiles),
  };
}

export function createRenderedPreview(
  result: ForgeRenderResult,
): ForgeRenderedPreview {
  return {
    files: result.files,
    diagnostics: result.diagnostics,
    safeToPlan: result.success && !hasErrors(result.diagnostics),
  };
}
