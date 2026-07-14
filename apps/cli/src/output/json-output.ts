import type { ForgeDiagnostic } from "@mcp-server-forge/validators";

import type { CliError } from "../errors/cli-errors.js";

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  info: number;
}

export interface JsonValidationOutput {
  success: boolean;
  configPath: string;
  summary: DiagnosticSummary;
  diagnostics: ForgeDiagnostic[];
  cliError?: CliError;
}

export function countDiagnostics(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): DiagnosticSummary {
  const summary: DiagnosticSummary = { errors: 0, warnings: 0, info: 0 };

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      summary.errors += 1;
    } else if (diagnostic.severity === "warning") {
      summary.warnings += 1;
    } else {
      summary.info += 1;
    }
  }

  return summary;
}

export function renderJsonOutput(output: JsonValidationOutput): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}
