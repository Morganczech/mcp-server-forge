import {
  formatDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import type { CliError } from "../errors/cli-errors.js";
import type { CliOutputFormat } from "../commands/validate.js";
import {
  countDiagnostics,
  renderJsonOutput,
  type DiagnosticSummary,
} from "./json-output.js";

function summaryText(summary: DiagnosticSummary): string {
  return `${summary.errors} errors, ${summary.warnings} warnings.`;
}

export function renderValidationResult(options: {
  commandSuccess: boolean;
  validationSuccess: boolean;
  configPath: string;
  diagnostics: ForgeDiagnostic[];
  format: CliOutputFormat;
  includeSuggestions: boolean;
}): string {
  const summary = countDiagnostics(options.diagnostics);

  if (options.format === "json") {
    return renderJsonOutput({
      success: options.commandSuccess,
      configPath: options.configPath,
      summary,
      diagnostics: options.diagnostics,
    });
  }

  const renderedDiagnostics = formatDiagnostics(options.diagnostics, {
    style: options.format,
    includeSuggestions: options.includeSuggestions,
  });

  if (options.format === "compact") {
    const status = options.validationSuccess ? "OK" : "FAIL";
    const compactSummary = `${status} ${summary.errors} errors, ${summary.warnings} warnings`;
    return `${renderedDiagnostics.length > 0 ? `${renderedDiagnostics}\n` : ""}${compactSummary}\n`;
  }

  const status = options.validationSuccess
    ? summary.warnings > 0
      ? "Configuration is valid with warnings."
      : "Configuration is valid."
    : "Configuration is invalid.";
  const prefix =
    renderedDiagnostics.length > 0 ? `${renderedDiagnostics}\n\n` : "";

  return `${prefix}${status}\n\n${summaryText(summary)}\n`;
}

export function renderCliError(
  error: CliError,
  configPath: string,
  format: CliOutputFormat,
): string {
  if (format === "json") {
    return renderJsonOutput({
      success: false,
      configPath,
      summary: { errors: 0, warnings: 0, info: 0 },
      diagnostics: [],
      cliError: error,
    });
  }

  const path = error.path === undefined ? "" : `\n${error.path}`;
  return `ERROR ${error.code}${path}\n\n${error.message}\n`;
}
