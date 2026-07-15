import {
  createProjectChangePlan,
  createProjectInspection,
  type ForgePermissionDeclarationInput,
} from "@mcp-server-forge/core";
import {
  DEFAULT_GENERATION_STATE_PATH,
  loadGenerationState,
  loadTargetState,
  loadComposedTemplateBundle,
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

import type {
  ForgeReadOnlyProjectRequest,
  ForgeReadOnlyProjectResult,
} from "./types.js";

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
  const allowedReadPaths = Array.isArray(security.allowedReadPaths)
    ? security.allowedReadPaths.filter(
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
      declared:
        declared("allowedRootDirectories") || declared("allowedReadPaths"),
      allowed: allowedRoots.length > 0 || allowedReadPaths.length > 0,
      scope: [...allowedRoots, ...allowedReadPaths],
      source,
      description:
        "Project-relative filesystem read scope declared for the generated server.",
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

export async function inspectForgeProject(
  request: ForgeReadOnlyProjectRequest,
): Promise<ForgeReadOnlyProjectResult> {
  const validation = validateForgeProject(request.configValue);
  if (!validation.success) {
    return {
      inspection: createProjectInspection({
        project: { initialized: true },
        stateAvailable: false,
        permissions: permissionInputs(request.configValue),
        diagnostics: validation.diagnostics,
      }),
      filesystemFailure: false,
      validationFailure: true,
    };
  }

  const state = await loadGenerationState(request.projectRoot, {
    statePath: request.statePath ?? DEFAULT_GENERATION_STATE_PATH,
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
        permissions: permissionInputs(request.configValue),
        diagnostics: [...validation.diagnostics, ...state.diagnostics],
      }),
      filesystemFailure: true,
      validationFailure: false,
    };
  }

  let preview;
  let targetState;
  let effectiveConfig = validation.data;
  const diagnostics = [...validation.diagnostics, ...state.diagnostics];
  if (request.templatePath !== undefined) {
    const template = await loadComposedTemplateBundle(
      request.templatePath,
      request.capabilityRootPath,
      validation.data,
    );
    diagnostics.push(...template.diagnostics);
    if (template.success && template.bundle !== undefined) {
      effectiveConfig = template.bundle.effectiveConfig;
      const render = renderForgeTemplate({
        config: template.bundle.effectiveConfig,
        manifest: template.bundle.manifest,
        templateSources: template.bundle.templateSources,
        ...(template.bundle.composition === undefined
          ? {}
          : { composition: template.bundle.composition }),
      });
      diagnostics.push(...render.diagnostics);
      const managed = new Map<string, ForgeManagedTargetPath>();
      for (const file of render.files) {
        managed.set(file.path, {
          path: file.path,
          expectedExecutable: file.executable,
        });
      }
      for (const file of state.state?.files ?? []) {
        if (!managed.has(file.path))
          managed.set(file.path, { path: file.path });
      }
      const targets = await loadTargetState(
        request.projectRoot,
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
      request.projectRoot,
      (state.state?.files ?? []).map(({ path }) => ({ path })),
    );
    diagnostics.push(...targets.diagnostics);
    targetState = targets.targetState;
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const rawConfig =
    typeof request.configValue === "object" &&
    request.configValue !== null &&
    !Array.isArray(request.configValue)
      ? (request.configValue as Record<string, unknown>)
      : {};
  const rawSecurity =
    typeof rawConfig.security === "object" &&
    rawConfig.security !== null &&
    !Array.isArray(rawConfig.security)
      ? (rawConfig.security as Record<string, unknown>)
      : undefined;
  const permissionConfig =
    effectiveConfig.security.allowedReadPaths.length === 0
      ? rawConfig
      : {
          ...rawConfig,
          security: {
            ...rawSecurity,
            allowedReadPaths: effectiveConfig.security.allowedReadPaths,
          },
        };
  const baseInspection = createProjectInspection({
    project: {
      initialized: true,
      name: validation.data.project.name,
      title: validation.data.project.title,
      serverName: validation.data.server.name,
      serverVersion: validation.data.server.version,
      capabilities: [...effectiveConfig.capabilities],
      tools: effectiveConfig.tools.map(({ name }) => name).sort(compareAscii),
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
    permissions: permissionInputs(permissionConfig),
    diagnostics: sortedDiagnostics,
  });
  const ownershipByPath = new Map(
    (state.state?.files ?? []).map((file) => [file.path, file.ownership]),
  );
  const inspection =
    preview !== undefined
      ? baseInspection
      : {
          ...baseInspection,
          generation: {
            ...baseInspection.generation,
            files: baseInspection.generation.files.map((file) => ({
              ...file,
              ...(ownershipByPath.get(file.path) === undefined
                ? {}
                : { ownership: ownershipByPath.get(file.path) }),
            })),
          },
        };
  const filesystemFailure = sortedDiagnostics.some(
    ({ severity, source }) => severity === "error" && source === "filesystem",
  );
  return {
    inspection,
    ...(preview === undefined || request.observedAt === undefined
      ? {}
      : { changePlan: createProjectChangePlan(preview, request.observedAt) }),
    filesystemFailure,
    validationFailure: false,
  };
}
