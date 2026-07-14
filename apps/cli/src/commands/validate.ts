import { validateForgeProject } from "@mcp-server-forge/validators";

import { loadConfigFile } from "../config/load-config.js";
import { CLI_EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import {
  renderCliError,
  renderValidationResult,
} from "../output/render-validation.js";
import { countDiagnostics } from "../output/json-output.js";

export type CliOutputFormat = "compact" | "detailed" | "json";

export interface ValidateCommandOptions {
  configPath: string;
  format: CliOutputFormat;
  includeSuggestions: boolean;
  warningsAsErrors: boolean;
  quiet: boolean;
}

export interface CliWritable {
  write(chunk: string): unknown;
}

export interface ValidateCommandContext {
  cwd: string;
  stdout: CliWritable;
  stderr: CliWritable;
}

export async function runValidateCommand(
  options: ValidateCommandOptions,
  context: ValidateCommandContext,
): Promise<CliExitCode> {
  const loaded = await loadConfigFile(options.configPath, context.cwd);

  if (!loaded.success) {
    const output = renderCliError(
      loaded.error,
      loaded.configPath,
      options.format,
    );
    const writer = options.format === "json" ? context.stdout : context.stderr;
    writer.write(output);
    return CLI_EXIT_CODES.fileError;
  }

  const validation = validateForgeProject(loaded.value);
  const summary = countDiagnostics(validation.diagnostics);
  const exitCode: CliExitCode =
    summary.errors > 0
      ? CLI_EXIT_CODES.validationError
      : options.warningsAsErrors && summary.warnings > 0
        ? CLI_EXIT_CODES.warningsAsErrors
        : CLI_EXIT_CODES.success;

  if (options.quiet && exitCode === CLI_EXIT_CODES.success) {
    return exitCode;
  }

  context.stdout.write(
    renderValidationResult({
      commandSuccess: exitCode === CLI_EXIT_CODES.success,
      validationSuccess: validation.success,
      configPath: loaded.configPath,
      diagnostics: validation.diagnostics,
      format: options.format,
      includeSuggestions: options.includeSuggestions,
    }),
  );

  return exitCode;
}
