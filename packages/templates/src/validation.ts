import {
  createDiagnostic,
  sortDiagnostics,
  type ForgeDiagnostic,
  type ForgeDiagnosticCode,
} from "@mcp-server-forge/validators";

import { isOwnershipStrategyValid } from "./ownership.js";
import {
  compareAscii,
  isPortableRelativePath,
  isSafeTemplateSourcePath,
} from "./paths.js";
import {
  sortGeneratedFileStates,
  sortTemplateDirectories,
  sortTemplateFiles,
} from "./sort.js";
import type {
  FileOwnership,
  FileUpdateStrategy,
  ForgeGeneratedFileState,
  ForgeGenerationState,
  ForgeTemplateDirectory,
  ForgeTemplateFile,
  ForgeTemplateManifest,
  SupportedForgeTemplateKind,
  TemplateCondition,
  TemplateValidationResult,
} from "./types.js";

type DiagnosticPath = Array<string | number>;
type JsonObject = Record<string, unknown>;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const OWNERSHIPS: FileOwnership[] = ["forge-owned", "user-owned", "shared"];
const UPDATE_STRATEGIES: FileUpdateStrategy[] = [
  "create-once",
  "replace",
  "replace-if-unmodified",
  "merge-markers",
  "manual",
];
const EQUALS_FIELDS = [
  "project.language",
  "server.runtime",
  "server.transport",
  "server.capabilities.tools",
  "server.capabilities.resources",
  "server.capabilities.prompts",
  "knowledge.enabled",
  "documentation.language",
  "distribution.type",
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: JsonObject,
  allowed: ReadonlyArray<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pushDiagnostic(
  diagnostics: ForgeDiagnostic[],
  code: ForgeDiagnosticCode,
  path: DiagnosticPath,
  metadata?: Record<string, unknown>,
): void {
  diagnostics.push(createDiagnostic(code, path, metadata));
}

function parseCondition(
  input: unknown,
  path: DiagnosticPath,
  diagnostics: ForgeDiagnostic[],
): TemplateCondition | undefined {
  if (!isObject(input)) {
    pushDiagnostic(diagnostics, "TPL_CONDITION_INVALID", path);
    return undefined;
  }

  if (
    hasOnlyKeys(input, ["field", "equals"]) &&
    typeof input.field === "string" &&
    EQUALS_FIELDS.includes(input.field as (typeof EQUALS_FIELDS)[number]) &&
    (typeof input.equals === "string" || typeof input.equals === "boolean")
  ) {
    return input as TemplateCondition;
  }

  if (
    hasOnlyKeys(input, ["field", "includes"]) &&
    input.field === "registry.categories" &&
    nonEmptyString(input.includes)
  ) {
    return input as TemplateCondition;
  }

  pushDiagnostic(diagnostics, "TPL_CONDITION_INVALID", path);
  return undefined;
}

function parseTemplateFile(
  input: unknown,
  index: number,
  diagnostics: ForgeDiagnostic[],
): ForgeTemplateFile | undefined {
  const root = ["files", index] as DiagnosticPath;
  if (
    !isObject(input) ||
    !hasOnlyKeys(input, [
      "path",
      "source",
      "ownership",
      "updateStrategy",
      "required",
      "executable",
      "contentType",
      "condition",
    ])
  ) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", root);
    return undefined;
  }

  let valid = true;
  if (typeof input.path !== "string" || !isPortableRelativePath(input.path)) {
    pushDiagnostic(diagnostics, "TPL_FILE_PATH_INVALID", [...root, "path"]);
    valid = false;
  }
  if (
    typeof input.source !== "string" ||
    !isSafeTemplateSourcePath(input.source)
  ) {
    pushDiagnostic(diagnostics, "TPL_SOURCE_PATH_INVALID", [...root, "source"]);
    valid = false;
  }
  if (!OWNERSHIPS.includes(input.ownership as FileOwnership)) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [...root, "ownership"]);
    valid = false;
  }
  if (!UPDATE_STRATEGIES.includes(input.updateStrategy as FileUpdateStrategy)) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [
      ...root,
      "updateStrategy",
    ]);
    valid = false;
  }
  if (typeof input.required !== "boolean") {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [...root, "required"]);
    valid = false;
  }
  if (input.executable !== undefined && typeof input.executable !== "boolean") {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [
      ...root,
      "executable",
    ]);
    valid = false;
  }
  if (input.contentType !== undefined && !nonEmptyString(input.contentType)) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [
      ...root,
      "contentType",
    ]);
    valid = false;
  }

  const condition =
    input.condition === undefined
      ? undefined
      : parseCondition(input.condition, [...root, "condition"], diagnostics);
  if (input.condition !== undefined && condition === undefined) valid = false;
  if (!valid) return undefined;

  return {
    path: input.path as string,
    source: input.source as string,
    ownership: input.ownership as FileOwnership,
    updateStrategy: input.updateStrategy as FileUpdateStrategy,
    required: input.required as boolean,
    ...(input.executable === undefined
      ? {}
      : { executable: input.executable as boolean }),
    ...(input.contentType === undefined
      ? {}
      : { contentType: input.contentType as string }),
    ...(condition === undefined ? {} : { condition }),
  };
}

function parseDirectory(
  input: unknown,
  index: number,
  diagnostics: ForgeDiagnostic[],
): ForgeTemplateDirectory | undefined {
  const root = ["directories", index] as DiagnosticPath;
  if (
    !isObject(input) ||
    !hasOnlyKeys(input, ["path", "required", "condition"])
  ) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", root);
    return undefined;
  }

  let valid = true;
  if (typeof input.path !== "string" || !isPortableRelativePath(input.path)) {
    pushDiagnostic(diagnostics, "TPL_FILE_PATH_INVALID", [...root, "path"]);
    valid = false;
  }
  if (typeof input.required !== "boolean") {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", [...root, "required"]);
    valid = false;
  }
  const condition =
    input.condition === undefined
      ? undefined
      : parseCondition(input.condition, [...root, "condition"], diagnostics);
  if (input.condition !== undefined && condition === undefined) valid = false;
  if (!valid) return undefined;

  return {
    path: input.path as string,
    required: input.required as boolean,
    ...(condition === undefined ? {} : { condition }),
  };
}

function duplicatePathDiagnostics(
  paths: ReadonlyArray<string>,
  code: ForgeDiagnosticCode,
  root: string,
): ForgeDiagnostic[] {
  const firstIndex = new Map<string, number>();
  const diagnostics: ForgeDiagnostic[] = [];
  paths.forEach((path, index) => {
    const originalIndex = firstIndex.get(path);
    if (originalIndex === undefined) {
      firstIndex.set(path, index);
      return;
    }
    pushDiagnostic(diagnostics, code, [root, index, "path"], {
      originalIndex,
      path,
    });
  });
  return diagnostics;
}

function manifestSemanticDiagnostics(
  manifest: ForgeTemplateManifest,
): ForgeDiagnostic[] {
  const diagnostics = duplicatePathDiagnostics(
    manifest.files.map(({ path }) => path),
    "TPL_DUPLICATE_FILE_PATH",
    "files",
  );
  const directories = manifest.directories ?? [];
  diagnostics.push(
    ...duplicatePathDiagnostics(
      directories.map(({ path }) => path),
      "TPL_DUPLICATE_FILE_PATH",
      "directories",
    ),
  );

  manifest.files.forEach((file, index) => {
    if (!isOwnershipStrategyValid(file.ownership, file.updateStrategy)) {
      pushDiagnostic(
        diagnostics,
        "TPL_OWNERSHIP_STRATEGY_INVALID",
        ["files", index, "updateStrategy"],
        { ownership: file.ownership, updateStrategy: file.updateStrategy },
      );
    }

    directories.forEach((directory, directoryIndex) => {
      if (
        file.path === directory.path ||
        directory.path.startsWith(`${file.path}/`)
      ) {
        pushDiagnostic(
          diagnostics,
          "TPL_FILE_DIRECTORY_CONFLICT",
          ["directories", directoryIndex, "path"],
          { directoryPath: directory.path, filePath: file.path },
        );
      }
    });
  });

  return diagnostics;
}

export function validateTemplateManifest(
  input: unknown,
): TemplateValidationResult<ForgeTemplateManifest> {
  const diagnostics: ForgeDiagnostic[] = [];
  if (
    !isObject(input) ||
    !hasOnlyKeys(input, [
      "manifestVersion",
      "template",
      "compatibility",
      "files",
      "directories",
    ])
  ) {
    return {
      success: false,
      diagnostics: [createDiagnostic("TPL_MANIFEST_INVALID", [])],
    };
  }

  if (input.manifestVersion !== "1") {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_VERSION_UNSUPPORTED", [
      "manifestVersion",
    ]);
  }

  const template = input.template;
  if (
    !isObject(template) ||
    !hasOnlyKeys(template, [
      "id",
      "version",
      "title",
      "description",
      "kind",
      "runtime",
      "language",
    ])
  ) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["template"]);
  } else {
    if (
      typeof template.id !== "string" ||
      template.id.length > 128 ||
      !TEMPLATE_ID.test(template.id)
    ) {
      pushDiagnostic(diagnostics, "TPL_TEMPLATE_ID_INVALID", [
        "template",
        "id",
      ]);
    }
    if (
      typeof template.version !== "string" ||
      !EXACT_VERSION.test(template.version)
    ) {
      pushDiagnostic(diagnostics, "TPL_TEMPLATE_VERSION_INVALID", [
        "template",
        "version",
      ]);
    }
    if (
      !nonEmptyString(template.title) ||
      !nonEmptyString(template.description)
    ) {
      pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["template"]);
    }
    if (
      !(["server", "knowledge-server"] as unknown[]).includes(template.kind)
    ) {
      pushDiagnostic(diagnostics, "TPL_TEMPLATE_KIND_UNSUPPORTED", [
        "template",
        "kind",
      ]);
    }
    if (template.runtime !== "node" || template.language !== "typescript") {
      pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["template"]);
    }
  }

  const compatibility = input.compatibility;
  if (
    !isObject(compatibility) ||
    !hasOnlyKeys(compatibility, ["forgeConfigSchema", "minimumForgeVersion"]) ||
    !Array.isArray(compatibility.forgeConfigSchema) ||
    compatibility.forgeConfigSchema.length === 0 ||
    !compatibility.forgeConfigSchema.every(nonEmptyString)
  ) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["compatibility"]);
  } else if (
    compatibility.minimumForgeVersion !== undefined &&
    (typeof compatibility.minimumForgeVersion !== "string" ||
      !EXACT_VERSION.test(compatibility.minimumForgeVersion))
  ) {
    pushDiagnostic(diagnostics, "TPL_TEMPLATE_VERSION_INVALID", [
      "compatibility",
      "minimumForgeVersion",
    ]);
  }

  const files = Array.isArray(input.files)
    ? input.files
        .map((file, index) => parseTemplateFile(file, index, diagnostics))
        .filter((file): file is ForgeTemplateFile => file !== undefined)
    : [];
  if (!Array.isArray(input.files) || input.files.length === 0) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["files"]);
  }

  const directories =
    input.directories === undefined
      ? undefined
      : Array.isArray(input.directories)
        ? input.directories
            .map((directory, index) =>
              parseDirectory(directory, index, diagnostics),
            )
            .filter(
              (directory): directory is ForgeTemplateDirectory =>
                directory !== undefined,
            )
        : undefined;
  if (input.directories !== undefined && !Array.isArray(input.directories)) {
    pushDiagnostic(diagnostics, "TPL_MANIFEST_INVALID", ["directories"]);
  }

  if (
    diagnostics.length > 0 ||
    !isObject(template) ||
    !isObject(compatibility)
  ) {
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  const data: ForgeTemplateManifest = {
    manifestVersion: "1",
    template: {
      id: template.id as string,
      version: template.version as string,
      title: template.title as string,
      description: template.description as string,
      kind: template.kind as SupportedForgeTemplateKind,
      runtime: "node",
      language: "typescript",
    },
    compatibility: {
      forgeConfigSchema: [
        ...(compatibility.forgeConfigSchema as string[]),
      ].sort(compareAscii),
      ...(compatibility.minimumForgeVersion === undefined
        ? {}
        : { minimumForgeVersion: compatibility.minimumForgeVersion as string }),
    },
    files: sortTemplateFiles(files),
    ...(directories === undefined
      ? {}
      : { directories: sortTemplateDirectories(directories) }),
  };
  const semanticDiagnostics = sortDiagnostics(
    manifestSemanticDiagnostics(data),
  );
  return semanticDiagnostics.length === 0
    ? { success: true, data, diagnostics: semanticDiagnostics }
    : { success: false, diagnostics: semanticDiagnostics };
}

function parseGeneratedFile(
  input: unknown,
  index: number,
  diagnostics: ForgeDiagnostic[],
): ForgeGeneratedFileState | undefined {
  const root = ["files", index] as DiagnosticPath;
  if (
    !isObject(input) ||
    !hasOnlyKeys(input, [
      "path",
      "ownership",
      "updateStrategy",
      "generatedHash",
      "templateSourceHash",
    ]) ||
    typeof input.path !== "string" ||
    !isPortableRelativePath(input.path) ||
    !OWNERSHIPS.includes(input.ownership as FileOwnership) ||
    !UPDATE_STRATEGIES.includes(input.updateStrategy as FileUpdateStrategy) ||
    typeof input.generatedHash !== "string" ||
    !SHA_256.test(input.generatedHash) ||
    (input.templateSourceHash !== undefined &&
      (typeof input.templateSourceHash !== "string" ||
        !SHA_256.test(input.templateSourceHash)))
  ) {
    pushDiagnostic(diagnostics, "TPL_GENERATED_STATE_INVALID", root);
    return undefined;
  }

  return {
    path: input.path,
    ownership: input.ownership as FileOwnership,
    updateStrategy: input.updateStrategy as FileUpdateStrategy,
    generatedHash: input.generatedHash,
    ...(input.templateSourceHash === undefined
      ? {}
      : { templateSourceHash: input.templateSourceHash }),
  };
}

export function validateGenerationState(
  input: unknown,
): TemplateValidationResult<ForgeGenerationState> {
  const diagnostics: ForgeDiagnostic[] = [];
  if (
    !isObject(input) ||
    !hasOnlyKeys(input, [
      "stateVersion",
      "templateId",
      "templateVersion",
      "hashAlgorithm",
      "generatedAt",
      "files",
    ]) ||
    input.stateVersion !== "1" ||
    typeof input.templateId !== "string" ||
    !TEMPLATE_ID.test(input.templateId) ||
    typeof input.templateVersion !== "string" ||
    !EXACT_VERSION.test(input.templateVersion) ||
    input.hashAlgorithm !== "sha256" ||
    typeof input.generatedAt !== "string" ||
    !ISO_DATE_TIME.test(input.generatedAt) ||
    Number.isNaN(Date.parse(input.generatedAt)) ||
    !Array.isArray(input.files)
  ) {
    return {
      success: false,
      diagnostics: [createDiagnostic("TPL_GENERATED_STATE_INVALID", [])],
    };
  }

  const files = input.files
    .map((file, index) => parseGeneratedFile(file, index, diagnostics))
    .filter((file): file is ForgeGeneratedFileState => file !== undefined);
  diagnostics.push(
    ...duplicatePathDiagnostics(
      files.map(({ path }) => path),
      "TPL_GENERATED_STATE_INVALID",
      "files",
    ),
  );
  files.forEach((file, index) => {
    if (!isOwnershipStrategyValid(file.ownership, file.updateStrategy)) {
      pushDiagnostic(diagnostics, "TPL_GENERATED_STATE_INVALID", [
        "files",
        index,
        "updateStrategy",
      ]);
    }
  });
  if (diagnostics.length > 0) {
    return { success: false, diagnostics: sortDiagnostics(diagnostics) };
  }

  return {
    success: true,
    data: {
      stateVersion: "1",
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      hashAlgorithm: "sha256",
      generatedAt: input.generatedAt,
      files: sortGeneratedFileStates(files),
    },
    diagnostics: [],
  };
}
