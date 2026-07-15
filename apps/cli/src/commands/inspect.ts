import { resolve } from "node:path";

import {
  createProjectInspection,
  type ForgeInspectionDiagnostic,
  type ForgeProjectInspection,
} from "@mcp-server-forge/core";
import { inspectForgeProject } from "@mcp-server-forge/engine";

import { loadConfigFile } from "../config/load-config.js";
import { CLI_EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import type { ValidateCommandContext } from "./validate.js";
import type { InspectCommandOptions } from "./inspect-options.js";

export interface InspectProjectResult {
  inspection: ForgeProjectInspection;
  exitCode: CliExitCode;
}

function cliDiagnostic(
  code: string,
  message: string,
): ForgeInspectionDiagnostic {
  return { code, severity: "error", message, source: "cli", path: [] };
}

export async function inspectProject(
  options: InspectCommandOptions,
  context: Pick<ValidateCommandContext, "cwd">,
): Promise<InspectProjectResult> {
  const projectRoot = resolve(context.cwd, options.rootPath);
  const loaded = await loadConfigFile(options.configPath, context.cwd);
  if (!loaded.success) {
    return {
      inspection: createProjectInspection({
        stateAvailable: false,
        diagnostics: [cliDiagnostic(loaded.error.code, loaded.error.message)],
      }),
      exitCode: CLI_EXIT_CODES.fileError,
    };
  }
  const result = await inspectForgeProject({
    projectRoot,
    configValue: loaded.value,
    statePath: options.statePath,
    ...(options.templatePath === undefined
      ? {}
      : { templatePath: resolve(context.cwd, options.templatePath) }),
    ...(options.capabilityRootPath === undefined
      ? {}
      : {
          capabilityRootPath: resolve(context.cwd, options.capabilityRootPath),
        }),
  });
  return {
    inspection: result.inspection,
    exitCode: result.filesystemFailure
      ? CLI_EXIT_CODES.fileError
      : result.validationFailure
        ? CLI_EXIT_CODES.validationError
        : result.inspection.status === "error"
          ? CLI_EXIT_CODES.unsafePreview
          : CLI_EXIT_CODES.success,
  };
}

export function renderInspection(inspection: ForgeProjectInspection): string {
  const lines = [
    "MCP Server Forge project inspection",
    "",
    `Project: ${inspection.project.title ?? inspection.project.name ?? "not initialized"}`,
    `Status: ${inspection.status}`,
    `Capabilities: ${inspection.project.capabilities?.join(", ") || "none"}`,
    `Tools: ${inspection.project.tools?.join(", ") || "none"}`,
    `Generation state: ${inspection.generation.stateAvailable ? "available" : "not available"}`,
    "",
    "Permissions (generated server configuration)",
    ...inspection.permissions.map(
      ({ permission, status, scope }) =>
        `  ${permission}: ${status}${scope.length === 0 ? "" : ` [${scope.join(", ")}]`}`,
    ),
    "",
    "Generated files",
    ...(inspection.generation.files.length === 0
      ? ["  none"]
      : inspection.generation.files.map(
          ({ path, status }) => `  ${status.padEnd(15)} ${path}`,
        )),
    "",
    "Diagnostics",
    ...(inspection.diagnostics.length === 0
      ? ["  none"]
      : inspection.diagnostics.map(
          ({ severity, code, message }) =>
            `  ${severity.toUpperCase()} ${code}: ${message}`,
        )),
    "",
    `Summary: ${inspection.summary.files} files, ${inspection.summary.conflicts} conflicts, ${inspection.summary.errors} errors, ${inspection.summary.warnings} warnings`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function runInspectCommand(
  options: InspectCommandOptions,
  context: ValidateCommandContext,
): Promise<CliExitCode> {
  const result = await inspectProject(options, context);
  context.stdout.write(
    options.json
      ? `${JSON.stringify(result.inspection, null, 2)}\n`
      : renderInspection(result.inspection),
  );
  return result.exitCode;
}
