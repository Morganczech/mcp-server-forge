import {
  compareAscii,
  hashGeneratedContent,
} from "@mcp-server-forge/templates";

import type {
  ForgeInspectedFile,
  ForgeInspectionDiagnostic,
  ForgePermissionDeclaration,
  ForgePermissionDeclarationInput,
  ForgeProjectChangePlan,
  ForgeProjectInspection,
  ForgeProjectInspectionInput,
} from "./types.js";

type InputDiagnostic = NonNullable<
  ForgeProjectInspectionInput["diagnostics"]
>[number];

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isStringArray(input: unknown): input is string[] {
  return (
    Array.isArray(input) && input.every((value) => typeof value === "string")
  );
}

function isDiagnostic(input: unknown): input is ForgeInspectionDiagnostic {
  return (
    isObject(input) &&
    typeof input.code === "string" &&
    ["error", "warning", "info"].includes(String(input.severity)) &&
    typeof input.message === "string" &&
    typeof input.source === "string" &&
    Array.isArray(input.path) &&
    input.path.every(
      (segment) => typeof segment === "string" || typeof segment === "number",
    )
  );
}

function normalizeDiagnostic(
  diagnostic: InputDiagnostic,
): ForgeInspectionDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source,
    path: [...diagnostic.path],
  };
}

export function createPermissionDeclaration(
  input: ForgePermissionDeclarationInput,
): ForgePermissionDeclaration {
  return {
    permission: input.permission,
    status:
      input.declared !== true
        ? "not-declared"
        : input.allowed === true
          ? "allowed"
          : "denied",
    scope: [...(input.scope ?? [])].sort(compareAscii),
    source: input.source ?? "not declared",
    description: input.description,
  };
}

function filesFromInspection(
  input: ForgeProjectInspectionInput,
): ForgeInspectedFile[] {
  if (input.preview !== undefined) {
    const files: ForgeInspectedFile[] = input.preview.files.map((file) => ({
      path: file.path,
      status:
        file.action === "skip"
          ? "current"
          : file.action === "create"
            ? "planned-create"
            : file.action === "replace"
              ? "planned-replace"
              : file.action,
      ownership: file.ownership,
      reasonCode: file.reasonCode,
    }));
    files.push(
      ...input.preview.orphanedFiles.map((file) => ({
        path: file.path,
        status: "orphaned" as const,
        ...(file.ownership === undefined ? {} : { ownership: file.ownership }),
        reasonCode: "PLAN_ORPHANED_GENERATED_FILE",
      })),
    );
    return files.sort((left, right) => compareAscii(left.path, right.path));
  }
  return (input.trackedFiles ?? [])
    .map((file): ForgeInspectedFile => {
      if (!file.exists) return { path: file.path, status: "missing" };
      return file.currentHash === file.generatedHash
        ? { path: file.path, status: "current" }
        : { path: file.path, status: "conflict" };
    })
    .sort((left, right) => compareAscii(left.path, right.path));
}

export function createProjectInspection(
  input: ForgeProjectInspectionInput,
): ForgeProjectInspection {
  const diagnostics = (input.diagnostics ?? [])
    .map(normalizeDiagnostic)
    .sort(
      (left, right) =>
        compareAscii(left.code, right.code) ||
        compareAscii(left.path.join("."), right.path.join(".")),
    );
  const files = filesFromInspection(input);
  const errors = diagnostics.filter(
    ({ severity }) => severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    ({ severity }) => severity === "warning",
  ).length;
  const conflicts = files.filter(({ status }) =>
    ["conflict", "manual-review", "orphaned", "missing"].includes(status),
  ).length;
  const initialized = input.project?.initialized === true;
  const status = !initialized
    ? "uninitialized"
    : errors > 0 || conflicts > 0
      ? "error"
      : warnings > 0
        ? "warning"
        : "healthy";
  return {
    inspectionVersion: "1",
    project: input.project ?? { initialized: false },
    status,
    generation: {
      stateAvailable: input.stateAvailable,
      ...(input.preview === undefined
        ? input.stateTemplate === undefined
          ? {}
          : {
              templateId: input.stateTemplate.id,
              templateVersion: input.stateTemplate.version,
            }
        : {
            templateId: input.preview.metadata.templateId,
            templateVersion: input.preview.metadata.templateVersion,
            safeToApply: input.preview.safeToApply,
          }),
      files,
    },
    permissions: (input.permissions ?? [])
      .map(createPermissionDeclaration)
      .sort((left, right) => compareAscii(left.permission, right.permission)),
    diagnostics,
    summary: { files: files.length, conflicts, warnings, errors },
  };
}

export function isForgeProjectInspection(
  input: unknown,
): input is ForgeProjectInspection {
  if (!isObject(input) || input.inspectionVersion !== "1") return false;
  if (
    !isObject(input.project) ||
    typeof input.project.initialized !== "boolean" ||
    !["uninitialized", "healthy", "warning", "error"].includes(
      String(input.status),
    ) ||
    !isObject(input.generation) ||
    typeof input.generation.stateAvailable !== "boolean" ||
    !Array.isArray(input.generation.files) ||
    !Array.isArray(input.permissions) ||
    !Array.isArray(input.diagnostics) ||
    !input.diagnostics.every(isDiagnostic) ||
    !isObject(input.summary)
  ) {
    return false;
  }
  const project = input.project;
  const summary = input.summary;
  const optionalProjectStrings = [
    "name",
    "title",
    "serverName",
    "serverVersion",
  ];
  if (
    optionalProjectStrings.some(
      (key) => project[key] !== undefined && typeof project[key] !== "string",
    )
  ) {
    return false;
  }
  if (
    (project.capabilities !== undefined &&
      !isStringArray(project.capabilities)) ||
    (project.tools !== undefined && !isStringArray(project.tools))
  ) {
    return false;
  }
  if (
    !input.generation.files.every(
      (file) =>
        isObject(file) &&
        typeof file.path === "string" &&
        [
          "current",
          "planned-create",
          "planned-replace",
          "missing",
          "conflict",
          "manual-review",
          "orphaned",
        ].includes(String(file.status)),
    ) ||
    !input.permissions.every(
      (permission) =>
        isObject(permission) &&
        [
          "filesystem.read",
          "filesystem.write",
          "filesystem.delete",
          "network",
          "shell",
          "environment",
        ].includes(String(permission.permission)) &&
        ["allowed", "denied", "not-declared"].includes(
          String(permission.status),
        ) &&
        isStringArray(permission.scope) &&
        typeof permission.source === "string" &&
        typeof permission.description === "string",
    )
  ) {
    return false;
  }
  return ["files", "conflicts", "warnings", "errors"].every(
    (key) =>
      typeof summary[key] === "number" &&
      Number.isInteger(summary[key]) &&
      Number(summary[key]) >= 0,
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareAscii(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createProjectChangePlan(
  preview: NonNullable<ForgeProjectInspectionInput["preview"]>,
  createdAt: string,
): ForgeProjectChangePlan {
  const changes = preview.files.map((file) => ({
    path: file.path,
    action: file.action,
    reasonCode: file.reasonCode,
    ownership: file.ownership,
    ...(file.targetHash === undefined
      ? {}
      : { expectedTargetHash: file.targetHash }),
    desiredHash: file.renderedHash,
  }));
  const diagnostics = preview.diagnostics.map(normalizeDiagnostic);
  const writesFiles = changes.some(
    ({ action }) => action === "create" || action === "replace",
  );
  const risk: ForgeProjectChangePlan["risk"] = !preview.safeToApply
    ? "high"
    : changes.some(({ action }) => action === "replace")
      ? "medium"
      : changes.some(({ action }) => action === "create")
        ? "low"
        : "none";
  const identity = {
    planVersion: "1" as const,
    safeToApply: preview.safeToApply,
    risk,
    changes,
    permissionChanges: [] as [],
    dataEffects: {
      writesFiles,
      deletesFiles: false as const,
      writesGenerationState: writesFiles,
      projectWideTransaction: false as const,
    },
    diagnostics,
  };
  const planHash = hashGeneratedContent(canonical(identity));
  return {
    ...identity,
    planId: `forge-plan:${planHash}`,
    planHash,
    createdAt,
  };
}

export function isForgeProjectChangePlan(
  input: unknown,
): input is ForgeProjectChangePlan {
  if (
    !isObject(input) ||
    input.planVersion !== "1" ||
    typeof input.planId !== "string" ||
    typeof input.planHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.planHash) ||
    input.planId !== `forge-plan:${input.planHash}` ||
    typeof input.createdAt !== "string" ||
    typeof input.safeToApply !== "boolean" ||
    !["none", "low", "medium", "high"].includes(String(input.risk)) ||
    !Array.isArray(input.changes) ||
    !Array.isArray(input.permissionChanges) ||
    input.permissionChanges.length !== 0 ||
    !isObject(input.dataEffects) ||
    !Array.isArray(input.diagnostics) ||
    !input.diagnostics.every(isDiagnostic)
  ) {
    return false;
  }
  if (
    !input.changes.every(
      (change) =>
        isObject(change) &&
        typeof change.path === "string" &&
        ["create", "replace", "skip", "conflict", "manual-review"].includes(
          String(change.action),
        ) &&
        typeof change.reasonCode === "string" &&
        typeof change.ownership === "string" &&
        typeof change.desiredHash === "string" &&
        /^[a-f0-9]{64}$/u.test(change.desiredHash) &&
        (change.expectedTargetHash === undefined ||
          (typeof change.expectedTargetHash === "string" &&
            /^[a-f0-9]{64}$/u.test(change.expectedTargetHash))),
    ) ||
    typeof input.dataEffects.writesFiles !== "boolean" ||
    input.dataEffects.deletesFiles !== false ||
    typeof input.dataEffects.writesGenerationState !== "boolean" ||
    input.dataEffects.projectWideTransaction !== false
  ) {
    return false;
  }
  const identity = {
    planVersion: input.planVersion,
    safeToApply: input.safeToApply,
    risk: input.risk,
    changes: input.changes,
    permissionChanges: input.permissionChanges,
    dataEffects: input.dataEffects,
    diagnostics: input.diagnostics,
  };
  return hashGeneratedContent(canonical(identity)) === input.planHash;
}
