import {
  createDiagnostic,
  sortDiagnostics,
} from "@mcp-server-forge/validators";

import type {
  ForgeConfigurationDraft,
  ImportedMcpServerDraft,
} from "./types.js";

function commandBasename(command: string): string {
  return command.split(/[\\/]/).at(-1)?.toLowerCase() ?? command.toLowerCase();
}

export function convertImportedServerToForgeDraft(
  server: ImportedMcpServerDraft,
): ForgeConfigurationDraft {
  const missingRequiredFields = [
    "project.description",
    "project.language",
    "server.description",
    "server.capabilities",
  ];
  const inferredFields = ["security", "server.transport"];
  const serverDraft: ForgeConfigurationDraft["server"] = {
    name: server.identity.suggestedId,
  };

  if (server.connection.kind === "remote") {
    serverDraft.transport = "streamable-http";
  } else {
    serverDraft.transport = "stdio";
  }

  if (
    server.connection.kind === "npm" ||
    (server.connection.kind === "command" &&
      ["node", "node.exe"].includes(commandBasename(server.connection.command)))
  ) {
    serverDraft.runtime = "node";
    inferredFields.push("server.runtime");
  } else {
    missingRequiredFields.push("server.runtime");
  }

  if (
    server.connection.kind === "npm" &&
    server.connection.versionKind === "pinned" &&
    server.connection.version !== undefined
  ) {
    serverDraft.version = server.connection.version;
  } else {
    missingRequiredFields.push("server.version");
  }

  if (
    server.connection.kind === "command" &&
    server.connection.entrypoint?.pathKind === "relative"
  ) {
    serverDraft.entrypoint = server.connection.entrypoint.path;
  } else {
    missingRequiredFields.push("server.entrypoint");
  }

  const distribution: ForgeConfigurationDraft["distribution"] =
    server.connection.kind === "npm"
      ? {
          type: "npm-package",
          packageName: server.connection.packageName,
          ...(server.connection.versionKind === "pinned" &&
          server.connection.version !== undefined
            ? { version: server.connection.version }
            : {}),
          packageManager: "npm",
          args: [...server.connection.packageArgs],
        }
      : server.connection.kind === "remote"
        ? { type: "remote-http", url: server.connection.url }
        : {
            type: "custom-command",
            command: server.connection.command,
            args: [...server.connection.args],
          };

  if (
    server.connection.kind === "npm" &&
    server.connection.versionKind !== "pinned"
  ) {
    missingRequiredFields.push("distribution.version");
  }

  const environment = server.environment.map((variable) => {
    missingRequiredFields.push(`environment.${variable.name}.description`);
    return {
      name: variable.name,
      required: true as const,
      secret: variable.secret,
      ...(!variable.secret &&
      variable.valueRetained &&
      variable.value !== undefined
        ? { default: variable.value }
        : {}),
    };
  });

  const inferredDiagnostic = createDiagnostic("IMP_FIELD_INFERRED", [], {
    fieldNames: [...new Set(inferredFields)].sort(),
  });

  return {
    status: "draft",
    requiresReview: true,
    project: {
      name: server.identity.suggestedId,
      title: server.identity.displayName,
    },
    server: serverDraft,
    distribution,
    environment,
    security: {
      allowedRootDirectories: [],
      networkAccess: "none",
      shellAccess: false,
      fileWrite: false,
      fileDelete: false,
      requireConfirmation: true,
    },
    missingRequiredFields: [...new Set(missingRequiredFields)].sort(),
    diagnostics: sortDiagnostics([...server.diagnostics, inferredDiagnostic]),
  };
}
