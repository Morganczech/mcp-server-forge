import { sortDiagnostics } from "./diagnostics.js";
import type { ForgeDiagnostic, FormatDiagnosticsOptions } from "./types.js";

function formatCompact(
  diagnostic: ForgeDiagnostic,
  includeSuggestions: boolean,
): string {
  const suggestion =
    includeSuggestions && diagnostic.suggestion !== undefined
      ? ` Suggestion: ${diagnostic.suggestion}`
      : "";

  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.pathText}: ${diagnostic.message}${suggestion}`;
}

function formatDetailed(
  diagnostic: ForgeDiagnostic,
  includeSuggestions: boolean,
): string {
  const lines = [
    `${diagnostic.severity.toUpperCase()} ${diagnostic.code}`,
    diagnostic.pathText,
    "",
    diagnostic.message,
  ];

  if (includeSuggestions && diagnostic.suggestion !== undefined) {
    lines.push(`Suggestion: ${diagnostic.suggestion}`);
  }

  return lines.join("\n");
}

export function formatDiagnostics(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
  options: FormatDiagnosticsOptions = {},
): string {
  const style = options.style ?? "compact";
  const includeSuggestions = options.includeSuggestions ?? true;
  const formatter = style === "detailed" ? formatDetailed : formatCompact;
  const separator = style === "detailed" ? "\n\n" : "\n";

  return sortDiagnostics(diagnostics)
    .map((diagnostic) => formatter(diagnostic, includeSuggestions))
    .join(separator);
}
