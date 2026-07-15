import { resolve } from "node:path";

import {
  createProjectInspection,
  type ForgeInspectionDiagnostic,
  type ForgePermissionDeclarationInput,
  type ForgeProjectInspection,
} from "@mcp-server-forge/core";
import {
  loadGenerationState,
  loadTargetState,
  loadTemplateBundle,
  type ForgeManagedTargetPath,
} from "@mcp-server-forge/fs-adapter";
import {
  createGenerationPreview,
  renderForgeTemplate,
} from "@mcp-server-forge/generators";
import { compareAscii } from "@mcp-server-forge/templates";
import {
  hasErrors,
  sortDiagnostics,
  validateForgeProject,
} from "@mcp-server-forge/validators";

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

function permissionInputs(
  raw: Record<string, unknown>,
): ForgePermissionDeclarationInput[] {
  const security =
    typeof raw.security === "object" &&
    raw.security !== null &&
    !Array.isArray(raw.security)
      ? (raw.security as Record<string, unknown>)
      : {};
  const declared = (key: string) =>
    Object.prototype.hasOwnProperty.call(security, key);
  const source = "Forge security configuration";
  const allowedRoots = Array.isArray(security.allowedRootDirectories)
    ? security.allowedRootDirectories.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const booleanPermission = (
    permission: "filesystem.write" | "filesystem.delete" | "shell",
    key: "fileWrite" | "fileDelete" | "shellAccess",
    description: string,
  ): ForgePermissionDeclarationInput => ({
    permission,
    declared: declared(key),
    allowed: security[key] === true,
    source,
    description,
  });
  return [
    {
      permission: "filesystem.read",
      declared: declared("allowedRootDirectories"),
      allowed: allowedRoots.length > 0,
      scope: allowedRoots,
      source,
      description: "Filesystem roots declared for the generated server.",
    },
    booleanPermission(
      "filesystem.write",
      "fileWrite",
      "Generated server file writes.",
    ),
    booleanPermission(
      "filesystem.delete",
      "fileDelete",
      "Generated server file deletion.",
    ),
    {
      permission: "network",
      declared: declared("networkAccess"),
      allowed:
        security.networkAccess === "restricted" ||
        security.networkAccess === "unrestricted",
      scope:
        typeof security.networkAccess === "string"
          ? [security.networkAccess]
          : [],
      source,
      description: "Generated server network access mode.",
    },
    booleanPermission(
      "shell",
      "shellAccess",
      "Generated server shell execution.",
    ),
    {
      permission: "environment",
      description:
        "No environment-read permission contract exists; variable metadata is not access.",
    },
  ];
}

function trackedFiles(
  state: Awaited<ReturnType<typeof loadGenerationState>>["state"],
  targets: Awaited<ReturnType<typeof loadTargetState>>["targetState"],
) {
  const byPath = new Map(targets.files.map((file) => [file.path, file]));
  return (state?.files ?? []).map((file) => {
    const target = byPath.get(file.path);
    return {
      path: file.path,
      exists: target?.exists ?? false,
      ...(target?.contentHash === undefined
        ? {}
        : { currentHash: target.contentHash }),
      generatedHash: file.generatedHash,
    };
  });
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
  const validation = validateForgeProject(loaded.value);
  if (!validation.success) {
    return {
      inspection: createProjectInspection({
        project: { initialized: true },
        stateAvailable: false,
        permissions: permissionInputs(loaded.value),
        diagnostics: validation.diagnostics,
      }),
      exitCode: CLI_EXIT_CODES.validationError,
    };
  }
  const state = await loadGenerationState(projectRoot, {
    statePath: options.statePath,
  });
  if (!state.success) {
    return {
      inspection: createProjectInspection({
        project: {
          initialized: true,
          name: validation.data.project.name,
          title: validation.data.project.title,
          serverName: validation.data.server.name,
          serverVersion: validation.data.server.version,
        },
        stateAvailable: state.available,
        permissions: permissionInputs(loaded.value),
        diagnostics: [...validation.diagnostics, ...state.diagnostics],
      }),
      exitCode: CLI_EXIT_CODES.fileError,
    };
  }

  let preview;
  let targetState;
  const diagnostics = [...validation.diagnostics, ...state.diagnostics];
  if (options.templatePath !== undefined) {
    const template = await loadTemplateBundle(
      resolve(context.cwd, options.templatePath),
    );
    diagnostics.push(...template.diagnostics);
    if (template.success && template.bundle !== undefined) {
      const render = renderForgeTemplate({
        config: validation.data,
        manifest: template.bundle.manifest,
        templateSources: template.bundle.templateSources,
      });
      diagnostics.push(...render.diagnostics);
      const managed = new Map<string, ForgeManagedTargetPath>();
      for (const file of render.files)
        managed.set(file.path, {
          path: file.path,
          expectedExecutable: file.executable,
        });
      for (const file of state.state?.files ?? [])
        if (!managed.has(file.path))
          managed.set(file.path, { path: file.path });
      const targets = await loadTargetState(
        projectRoot,
        [...managed.values()].sort((left, right) =>
          compareAscii(left.path, right.path),
        ),
      );
      diagnostics.push(...targets.diagnostics);
      targetState = targets.targetState;
      if (render.success && targets.success && !hasErrors(render.diagnostics)) {
        preview = createGenerationPreview({
          renderResult: render,
          manifest: template.bundle.manifest,
          targetState: targets.targetState,
          ...(state.state === undefined ? {} : { previousState: state.state }),
        });
        diagnostics.push(...preview.diagnostics);
      }
    }
  } else {
    const targets = await loadTargetState(
      projectRoot,
      (state.state?.files ?? []).map(({ path }) => ({ path })),
    );
    diagnostics.push(...targets.diagnostics);
    targetState = targets.targetState;
  }

  const inspection = createProjectInspection({
    project: {
      initialized: true,
      name: validation.data.project.name,
      title: validation.data.project.title,
      serverName: validation.data.server.name,
      serverVersion: validation.data.server.version,
    },
    stateAvailable: state.available,
    ...(state.state === undefined
      ? {}
      : {
          stateTemplate: {
            id: state.state.templateId,
            version: state.state.templateVersion,
          },
        }),
    ...(preview === undefined ? {} : { preview }),
    ...(preview !== undefined || targetState === undefined
      ? {}
      : { trackedFiles: trackedFiles(state.state, targetState) }),
    permissions: permissionInputs(loaded.value),
    diagnostics: sortDiagnostics(diagnostics),
  });
  const hasFilesystemFailure = diagnostics.some(
    ({ severity, source }) => severity === "error" && source === "filesystem",
  );
  return {
    inspection,
    exitCode: hasFilesystemFailure
      ? CLI_EXIT_CODES.fileError
      : inspection.status === "error"
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
