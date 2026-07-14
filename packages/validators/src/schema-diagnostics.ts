import { createDiagnostic, sortDiagnostics } from "./diagnostics.js";
import type { ForgeDiagnosticCode } from "./codes.js";
import type { ForgeDiagnostic, ForgeDiagnosticPathSegment } from "./types.js";

export interface SchemaIssueLike {
  code: string;
  path: ForgeDiagnosticPathSegment[];
  message: string;
  keys?: string[];
  received?: unknown;
}

const relativePathFields = new Set([
  "entrypoint",
  "templatePath",
  "configPath",
  "dataDirectory",
  "manifest",
  "publicDirectory",
  "privateDirectory",
  "sourceDocumentsDirectory",
  "generatedDocumentsDirectory",
  "index",
  "path",
]);

function pathEndsWith(
  path: ReadonlyArray<ForgeDiagnosticPathSegment>,
  ...segments: ForgeDiagnosticPathSegment[]
): boolean {
  return segments.every(
    (segment, index) => path[path.length - segments.length + index] === segment,
  );
}

function isCollectionNamePath(
  path: ReadonlyArray<ForgeDiagnosticPathSegment>,
): boolean {
  return (
    pathEndsWith(path, "name") &&
    ["tools", "resources", "resourceTemplates", "prompts"].includes(
      String(path[0]),
    )
  );
}

function isKnowledgeLocationPath(
  path: ReadonlyArray<ForgeDiagnosticPathSegment>,
): boolean {
  return (
    path[0] === "knowledge" &&
    path[1] === "sources" &&
    (pathEndsWith(path, "path") || pathEndsWith(path, "url"))
  );
}

function mapIssueCode(issue: SchemaIssueLike): ForgeDiagnosticCode {
  const { code, path } = issue;
  const lastSegment = path.at(-1);
  const receivedMissingValue =
    issue.received === undefined || issue.received === "undefined";

  if (pathEndsWith(path, "schemaVersion")) {
    return receivedMissingValue
      ? "CFG_SCHEMA_VERSION_MISSING"
      : "CFG_SCHEMA_VERSION_UNSUPPORTED";
  }

  if (
    code === "custom" &&
    pathEndsWith(path, "requiresConfirmation") &&
    path[0] === "tools"
  ) {
    return "CFG_DESTRUCTIVE_CONFIRMATION_REQUIRED";
  }

  if (
    code === "custom" &&
    pathEndsWith(path, "default") &&
    path[0] === "environment"
  ) {
    return "CFG_SECRET_DEFAULT_FORBIDDEN";
  }

  if (code === "custom" && isCollectionNamePath(path)) {
    return "CFG_DUPLICATE_NAME";
  }

  if (
    code === "invalid_string" &&
    path[0] === "tools" &&
    lastSegment === "name"
  ) {
    return "CFG_TOOL_NAME_INVALID";
  }

  if (
    code === "invalid_string" &&
    pathEndsWith(path, "distribution", "version")
  ) {
    return "CFG_NPM_VERSION_NOT_PINNED";
  }

  if (
    code === "invalid_enum_value" &&
    path[0] === "clients" &&
    lastSegment === "updateMode"
  ) {
    return "CFG_CLIENT_MODE_INVALID";
  }

  if (
    code === "custom" &&
    typeof lastSegment === "string" &&
    relativePathFields.has(lastSegment)
  ) {
    return "CFG_INVALID_PATH";
  }

  if (
    isKnowledgeLocationPath(path) &&
    ["invalid_type", "invalid_string", "invalid_union"].includes(code)
  ) {
    return "CFG_KNOWLEDGE_SOURCE_LOCATION_INVALID";
  }

  if (code === "invalid_type" && receivedMissingValue) {
    return "CFG_REQUIRED_FIELD_MISSING";
  }

  if (code === "invalid_type") {
    return "CFG_INVALID_TYPE";
  }

  if (
    [
      "invalid_enum_value",
      "invalid_literal",
      "invalid_string",
      "invalid_union",
      "invalid_union_discriminator",
      "too_small",
      "too_big",
    ].includes(code)
  ) {
    return "CFG_INVALID_VALUE";
  }

  return "CFG_VALIDATION_FAILED";
}

function metadataForIssue(issue: SchemaIssueLike): Record<string, unknown> {
  return {
    schemaIssueCode: issue.code,
    schemaMessage: issue.message,
  };
}

export function schemaIssuesToDiagnostics(
  issues: ReadonlyArray<SchemaIssueLike>,
): ForgeDiagnostic[] {
  const diagnostics: ForgeDiagnostic[] = [];

  for (const issue of issues) {
    if (issue.code === "unrecognized_keys" && issue.keys !== undefined) {
      for (const key of [...issue.keys].sort()) {
        diagnostics.push(
          createDiagnostic(
            "CFG_UNKNOWN_FIELD",
            [...issue.path, key],
            metadataForIssue(issue),
          ),
        );
      }
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        mapIssueCode(issue),
        issue.path,
        metadataForIssue(issue),
      ),
    );
  }

  return sortDiagnostics(diagnostics);
}
