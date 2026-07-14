import type {
  ForgeGenerationPreview,
  ForgePlannedFile,
  ForgeRenderedFile,
} from "@mcp-server-forge/generators";
import {
  formatDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import type { PreviewOutputFormat } from "../commands/preview-options.js";
import type { CliError } from "../errors/cli-errors.js";

interface PreviewIdentity {
  id: string;
  version: string;
}

export interface RenderPreviewOptions {
  success: boolean;
  configPath: string;
  projectRoot: string;
  templatePath: string;
  template?: PreviewIdentity;
  preview?: ForgeGenerationPreview;
  renderedFiles?: ReadonlyArray<ForgeRenderedFile>;
  diagnostics: ForgeDiagnostic[];
  cliError?: CliError;
  format: PreviewOutputFormat;
  showContent: boolean;
  showSkipped: boolean;
}

const emptySummary = {
  create: 0,
  replace: 0,
  skip: 0,
  conflict: 0,
  manualReview: 0,
};

function visibleFiles(
  files: ReadonlyArray<ForgePlannedFile>,
  showSkipped: boolean,
): ForgePlannedFile[] {
  return files.filter(({ action }) => showSkipped || action !== "skip");
}

function compactAction(action: ForgePlannedFile["action"]): string {
  return action === "manual-review" ? "REVIEW" : action.toUpperCase();
}

function renderTable(files: ReadonlyArray<ForgePlannedFile>): string {
  if (files.length === 0) return "No visible file actions.\n";
  const rows = files.map((file) => [
    file.action,
    file.path,
    file.ownership,
    file.reasonCode,
  ]);
  const headers = ["ACTION", "PATH", "OWNERSHIP", "REASON"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (row: string[]): string =>
    row
      .map((value, index) =>
        index === row.length - 1 ? value : value.padEnd(widths[index] ?? 0),
      )
      .join("  ");
  return `${line(headers)}\n${rows.map(line).join("\n")}\n`;
}

function renderCompact(files: ReadonlyArray<ForgePlannedFile>): string {
  return files
    .map(
      (file) => `${compactAction(file.action)} ${file.path} ${file.reasonCode}`,
    )
    .join("\n");
}

function renderDetailed(files: ReadonlyArray<ForgePlannedFile>): string {
  return files
    .map(
      (
        file,
      ) => `${compactAction(file.action).replace("REVIEW", "MANUAL REVIEW")} ${file.path}

Ownership: ${file.ownership}
Strategy: ${file.updateStrategy}
Reason: ${file.reasonCode}`,
    )
    .join("\n\n");
}

function renderSummary(preview: ForgeGenerationPreview): string {
  const summary = preview.summary;
  return `Summary:
  create:         ${summary.create}
  replace:        ${summary.replace}
  skip:           ${summary.skip}
  conflicts:      ${summary.conflict}
  manual review:  ${summary.manualReview}

Safe to apply: ${preview.safeToApply ? "yes" : "no"}`;
}

function eligibleContent(action: ForgePlannedFile["action"]): boolean {
  return (
    action === "create" || action === "replace" || action === "manual-review"
  );
}

function renderedContentSections(
  preview: ForgeGenerationPreview,
  renderedFiles: ReadonlyArray<ForgeRenderedFile>,
): string {
  const renderedByPath = new Map(
    renderedFiles.map((file) => [file.path, file.content]),
  );
  return preview.files
    .filter(({ action }) => eligibleContent(action))
    .map((file) => {
      const content = renderedByPath.get(file.path);
      return content === undefined
        ? ""
        : `--- ${file.path} ---\n${content}--- end ${file.path} ---`;
    })
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function renderJson(options: RenderPreviewOptions): string {
  const preview = options.preview;
  const renderedByPath = new Map(
    (options.renderedFiles ?? []).map((file) => [file.path, file.content]),
  );
  const files = (preview?.files ?? []).map((file) => {
    const content = renderedByPath.get(file.path);
    return {
      ...file,
      ...(options.showContent &&
      eligibleContent(file.action) &&
      content !== undefined
        ? { content }
        : {}),
    };
  });
  const output = {
    success: options.success,
    safeToApply: preview?.safeToApply ?? false,
    configPath: options.configPath,
    projectRoot: options.projectRoot,
    templatePath: options.templatePath,
    template: options.template ?? null,
    summary: preview?.summary ?? emptySummary,
    files,
    orphanedFiles: preview?.orphanedFiles ?? [],
    diagnostics: options.diagnostics,
    ...(options.cliError === undefined ? {} : { cliError: options.cliError }),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function renderPreviewOutput(options: RenderPreviewOptions): string {
  if (options.format === "json") return renderJson(options);

  const preview = options.preview;
  const identity =
    options.template === undefined
      ? "unavailable"
      : `${options.template.id}@${options.template.version}`;
  const parts = [
    "MCP Server Forge generation preview",
    `Template: ${identity}\nProject root: ${options.projectRoot}`,
  ];

  if (options.cliError !== undefined) {
    parts.push(`ERROR ${options.cliError.code}\n\n${options.cliError.message}`);
  }

  if (preview !== undefined) {
    const files = visibleFiles(preview.files, options.showSkipped);
    if (options.format === "compact") {
      const lines = renderCompact(files);
      if (lines.length > 0) parts.push(lines);
      const summary = preview.summary;
      parts.push(
        `SUMMARY create=${summary.create} replace=${summary.replace} skip=${summary.skip} conflict=${summary.conflict} review=${summary.manualReview} safe=${String(preview.safeToApply)}`,
      );
    } else {
      parts.push(
        options.format === "table"
          ? renderTable(files).trimEnd()
          : renderDetailed(files),
        renderSummary(preview),
      );
    }
  }

  if (options.diagnostics.length > 0) {
    parts.push(
      `Diagnostics:\n${formatDiagnostics(options.diagnostics, {
        style: options.format === "compact" ? "compact" : "detailed",
      })}`,
    );
  }

  if (
    options.showContent &&
    preview !== undefined &&
    options.renderedFiles !== undefined
  ) {
    const content = renderedContentSections(preview, options.renderedFiles);
    if (content.length > 0) parts.push(content);
  }

  return `${parts.filter((part) => part.length > 0).join("\n\n")}\n`;
}
