import { exactVersionSchema, type JsonValue } from "@mcp-server-forge/schemas";
import {
  createDiagnostic,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { isRecord } from "./detect.js";
import {
  isPotentialSecretName,
  sanitizeImportedConfiguration,
} from "./sanitize.js";
import type {
  ImportOptions,
  ImportSource,
  ImportedCommandConnection,
  ImportedConnection,
  ImportedEnvironmentVariable,
  ImportedMcpServerDraft,
  ImportedNpmConnection,
} from "./types.js";

const knownDefinitionFields = new Set(["command", "args", "env", "cwd"]);
const portableIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const packageNamePattern = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)$/i;
const nodeEntrypointPattern = /\.(?:cjs|mjs|js)$/i;

export interface NormalizedServerResult {
  server?: ImportedMcpServerDraft;
  diagnostics: ForgeDiagnostic[];
}

function isAbsolutePortablePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function commandBasename(command: string): string {
  return command.split(/[\\/]/).at(-1)?.toLowerCase() ?? command.toLowerCase();
}

function normalizeSuggestedId(serverKey: string, index: number): string {
  const normalized = serverKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : `imported-server-${index + 1}`;
}

function parsePackageSpecifier(specifier: string):
  | {
      packageName: string;
      version?: string;
    }
  | undefined {
  let packageName = specifier;
  let version: string | undefined;

  if (specifier.startsWith("@")) {
    const slashIndex = specifier.indexOf("/");
    const versionIndex = specifier.lastIndexOf("@");
    if (slashIndex < 2) {
      return undefined;
    }
    if (versionIndex > slashIndex) {
      packageName = specifier.slice(0, versionIndex);
      version = specifier.slice(versionIndex + 1);
    }
  } else {
    const versionIndex = specifier.lastIndexOf("@");
    if (versionIndex > 0) {
      packageName = specifier.slice(0, versionIndex);
      version = specifier.slice(versionIndex + 1);
    }
  }

  if (!packageNamePattern.test(packageName) || version === "") {
    return undefined;
  }

  return { packageName, ...(version === undefined ? {} : { version }) };
}

function detectNpmConnection(
  command: string,
  args: string[],
): ImportedNpmConnection | undefined {
  if (commandBasename(command) !== "npx") {
    return undefined;
  }

  let packageArgument: string | undefined;
  let packageArgumentIndex = -1;
  for (const [index, argument] of args.entries()) {
    if (argument === "-y" || argument === "--yes") {
      continue;
    }
    if (argument.startsWith("-")) {
      return undefined;
    }
    packageArgument = argument;
    packageArgumentIndex = index;
    break;
  }

  if (packageArgument === undefined) {
    return undefined;
  }

  const packageSpecifier = parsePackageSpecifier(packageArgument);
  if (packageSpecifier === undefined) {
    return undefined;
  }

  const versionKind =
    packageSpecifier.version === undefined
      ? "missing"
      : exactVersionSchema.safeParse(packageSpecifier.version).success
        ? "pinned"
        : "floating";

  return {
    kind: "npm",
    packageName: packageSpecifier.packageName,
    ...(packageSpecifier.version === undefined
      ? {}
      : { version: packageSpecifier.version }),
    versionKind,
    packageManager: "npm",
    originalCommand: command,
    originalArgs: [...args],
    packageArgs: args.slice(packageArgumentIndex + 1),
  };
}

function createCommandConnection(
  command: string,
  args: string[],
  workingDirectory: string | undefined,
): ImportedCommandConnection {
  const connection: ImportedCommandConnection = {
    kind: "command",
    command,
    commandPathKind: isAbsolutePortablePath(command)
      ? "absolute"
      : "path-command",
    args: [...args],
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };

  const firstArgument = args[0];
  if (
    ["node", "node.exe"].includes(commandBasename(command)) &&
    firstArgument !== undefined &&
    !firstArgument.startsWith("-") &&
    nodeEntrypointPattern.test(firstArgument)
  ) {
    connection.entrypoint = {
      path: firstArgument,
      pathKind: isAbsolutePortablePath(firstArgument) ? "absolute" : "relative",
      argumentIndex: 0,
    };
  }

  return connection;
}

function normalizeEnvironment(
  value: unknown,
  path: Array<string | number>,
  policy: "preserve" | "omit",
): {
  environment: ImportedEnvironmentVariable[];
  diagnostics: ForgeDiagnostic[];
} {
  if (value === undefined) {
    return { environment: [], diagnostics: [] };
  }
  if (!isRecord(value)) {
    return {
      environment: [],
      diagnostics: [createDiagnostic("IMP_ENV_INVALID", path)],
    };
  }

  const environment: ImportedEnvironmentVariable[] = [];
  const diagnostics: ForgeDiagnostic[] = [];

  for (const [name, environmentValue] of Object.entries(value).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    if (typeof environmentValue !== "string") {
      diagnostics.push(
        createDiagnostic("IMP_ENV_INVALID", [...path, name], {
          variableName: name,
        }),
      );
      continue;
    }

    const secret = isPotentialSecretName(name);
    const preserveValue = !secret && policy === "preserve";
    environment.push({
      name,
      required: true,
      secret,
      valuePresent: true,
      redacted: secret,
      valueRetained: preserveValue,
      ...(preserveValue ? { value: environmentValue } : {}),
    });

    if (secret) {
      diagnostics.push(
        createDiagnostic("IMP_SECRET_REDACTED", [...path, name], {
          variableName: name,
        }),
      );
    }
  }

  return { environment, diagnostics };
}

function sanitizedUnknownFields(
  definition: Record<string, unknown>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(definition)
      .filter(([key]) => !knownDefinitionFields.has(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, value]) => [key, sanitizeImportedConfiguration(value)]),
  );
}

export function normalizeServerDefinition(options: {
  serverKey: string;
  definition: unknown;
  index: number;
  source: ImportSource;
  sourcePath: Array<string | number>;
  importOptions?: ImportOptions;
}): NormalizedServerResult {
  const definitionPath = [...options.sourcePath, options.serverKey];
  if (!isRecord(options.definition)) {
    return {
      diagnostics: [
        createDiagnostic("IMP_SERVER_DEFINITION_INVALID", definitionPath),
      ],
    };
  }

  const diagnostics: ForgeDiagnostic[] = [];
  const command = options.definition.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    return {
      diagnostics: [
        createDiagnostic("IMP_COMMAND_MISSING", [...definitionPath, "command"]),
      ],
    };
  }

  const argsValue = options.definition.args;
  if (
    argsValue !== undefined &&
    (!Array.isArray(argsValue) ||
      !argsValue.every((argument) => typeof argument === "string"))
  ) {
    return {
      diagnostics: [
        createDiagnostic("IMP_ARGS_INVALID", [...definitionPath, "args"]),
      ],
    };
  }
  const args = argsValue === undefined ? [] : (argsValue as string[]);

  const workingDirectoryValue = options.definition.cwd;
  const workingDirectory =
    typeof workingDirectoryValue === "string" &&
    workingDirectoryValue.trim().length > 0
      ? workingDirectoryValue
      : undefined;
  if (workingDirectoryValue !== undefined && workingDirectory === undefined) {
    diagnostics.push(
      createDiagnostic("IMP_SERVER_DEFINITION_INVALID", [
        ...definitionPath,
        "cwd",
      ]),
    );
  }

  const environmentResult = normalizeEnvironment(
    options.definition.env,
    [...definitionPath, "env"],
    options.importOptions?.publicEnvironmentValues ?? "preserve",
  );
  diagnostics.push(...environmentResult.diagnostics);

  const suggestedId = normalizeSuggestedId(options.serverKey, options.index);
  const idWasNormalized =
    suggestedId !== options.serverKey ||
    !portableIdPattern.test(options.serverKey);
  if (idWasNormalized) {
    diagnostics.push(
      createDiagnostic("IMP_SERVER_NAME_INVALID", definitionPath, {
        sourceName: options.serverKey,
        suggestedId,
      }),
    );
  }

  const npmConnection = detectNpmConnection(command, args);
  let connection: ImportedConnection;
  const inferredFields: string[] = idWasNormalized
    ? ["identity.suggestedId"]
    : [];
  const fieldConfidence: Record<string, "high" | "medium" | "low"> = {
    "identity.displayName": "high",
    "identity.suggestedId": idWasNormalized ? "medium" : "high",
    "connection.command": "high",
  };

  if (npmConnection !== undefined) {
    connection = npmConnection;
    inferredFields.push("connection.kind", "connection.packageName");
    fieldConfidence["connection.kind"] = "high";
    fieldConfidence["connection.packageName"] = "high";
    diagnostics.push(
      createDiagnostic("IMP_NPM_PACKAGE_DETECTED", [...definitionPath, "args"]),
    );
    if (npmConnection.versionKind === "missing") {
      diagnostics.push(
        createDiagnostic("IMP_NPM_VERSION_MISSING", [
          ...definitionPath,
          "args",
        ]),
      );
      fieldConfidence["identity.version"] = "low";
    } else if (npmConnection.versionKind === "floating") {
      diagnostics.push(
        createDiagnostic("IMP_NPM_VERSION_NOT_PINNED", [
          ...definitionPath,
          "args",
        ]),
      );
      fieldConfidence["identity.version"] = "medium";
    } else {
      fieldConfidence["identity.version"] = "high";
    }
  } else {
    connection = createCommandConnection(command, args, workingDirectory);
    fieldConfidence["connection.kind"] = "high";
    fieldConfidence["connection.args"] = "high";
    if (connection.entrypoint !== undefined) {
      inferredFields.push("connection.entrypoint");
      fieldConfidence["connection.entrypoint"] = "high";
    }
  }

  if (isAbsolutePortablePath(command)) {
    diagnostics.push(
      createDiagnostic("IMP_ABSOLUTE_PATH_REQUIRES_REVIEW", [
        ...definitionPath,
        "command",
      ]),
    );
  }
  if (
    connection.kind === "command" &&
    connection.entrypoint?.pathKind === "absolute"
  ) {
    diagnostics.push(
      createDiagnostic("IMP_ABSOLUTE_PATH_REQUIRES_REVIEW", [
        ...definitionPath,
        "args",
        connection.entrypoint.argumentIndex,
      ]),
    );
  }
  if (
    workingDirectory !== undefined &&
    isAbsolutePortablePath(workingDirectory)
  ) {
    diagnostics.push(
      createDiagnostic("IMP_ABSOLUTE_PATH_REQUIRES_REVIEW", [
        ...definitionPath,
        "cwd",
      ]),
    );
  }

  const unknownFields = sanitizedUnknownFields(options.definition);
  const unknownFieldNames = Object.keys(unknownFields);
  if (unknownFieldNames.length > 0) {
    diagnostics.push(
      createDiagnostic("IMP_UNKNOWN_FIELD_PRESERVED", definitionPath, {
        fieldNames: unknownFieldNames,
      }),
    );
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const observedFields = [
    "identity.displayName",
    "connection.command",
    ...(argsValue === undefined ? [] : ["connection.args"]),
    ...(options.definition.env === undefined ? [] : ["environment"]),
    ...(workingDirectory === undefined ? [] : ["connection.workingDirectory"]),
  ].sort();
  const overallConfidence = sortedDiagnostics.some(
    ({ severity }) => severity === "warning" || severity === "error",
  )
    ? "medium"
    : "high";

  const server: ImportedMcpServerDraft = {
    source: options.source,
    identity: {
      suggestedId,
      displayName: options.serverKey,
      ...(npmConnection?.version === undefined
        ? {}
        : { version: npmConnection.version }),
    },
    connection,
    environment: environmentResult.environment,
    capabilities: [],
    provenance: {
      sourceKind: options.source.kind,
      sourceVariant: options.source.variant,
      sourcePath: definitionPath,
      serverKey: options.serverKey,
      observedFields,
      inferredFields: [...new Set(inferredFields)].sort(),
    },
    diagnostics: sortedDiagnostics,
    confidence: {
      overall: overallConfidence,
      fields: fieldConfidence,
    },
    ...(options.importOptions?.includeSanitizedRaw === false ||
    unknownFieldNames.length === 0
      ? {}
      : { raw: { unknownFields } }),
  };

  return { server, diagnostics: sortedDiagnostics };
}
