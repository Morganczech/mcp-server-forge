# MCP Server Forge diagnostics

## Purpose

The diagnostics package converts configuration validation results into a stable,
JSON-serializable public model. The same diagnostics can later be used by the
Forge CLI, MCP server, editors, installers, client-configuration tooling,
documentation, and tests without exposing Zod internals.

Diagnostics report configuration problems; they do not modify files, apply
fixes, enforce runtime permissions, or install clients.

## Public data model

```ts
interface ForgeDiagnostic {
  code: ForgeDiagnosticCode;
  severity: "error" | "warning" | "info";
  message: string;
  path: Array<string | number>;
  pathText: string;
  source:
    | "schema"
    | "semantic"
    | "security"
    | "compatibility"
    | "import"
    | "template"
    | "generation"
    | "plan"
    | "filesystem";
  suggestion?: string;
  documentationUrl?: string;
  metadata?: Record<string, unknown>;
}
```

`code`, `severity`, `path`, `pathText`, and `source` are intended for machines.
`message` and `suggestion` are English user-facing text in the first version and
may be localized later without changing the code's meaning.

`metadata` is optional contextual or debugging data. Schema diagnostics may
include the original schema issue code and message there, but internal schema
wording is never used as the primary public message.

Example JSON:

```json
{
  "code": "CFG_NPM_VERSION_NOT_PINNED",
  "severity": "error",
  "message": "Npm package distributions must use an exact version.",
  "path": ["distribution", "version"],
  "pathText": "distribution.version",
  "source": "schema",
  "suggestion": "Replace the floating version with an exact version such as 1.2.3."
}
```

## Code naming and stability

Codes use uppercase ASCII words separated by underscores. Their prefix
identifies the owning area:

- `CFG_`: schema and configuration validation;
- `SEM_`: relationships between otherwise valid fields;
- `SEC_`: declared security-policy conflicts;
- `COMP_`: compatibility checks;
- `DOC_`: reserved for documentation checks;
- `REG_`: reserved for future registry checks;
- `CLIENT_`: reserved for future client-specific checks.
- `IMP_`: read-only import detection, normalization, and sanitization.
- `TPL_`: template manifests, generated-file state, ownership, and planning.
- `GEN_`: restricted in-memory template rendering and output validation.
- `PLAN_`: render-to-plan consistency and read-only generation decisions.
- `APPLY_`: pure Apply Contract validation and bounded execution failures.
- `FS_`: bounded filesystem inspection and root confinement.

Codes are independent of message wording. Renaming, rephrasing, or localizing a
message does not change its code.

> An existing public diagnostic code must never later be reused for a different
> meaning.

A code may be deprecated, but its original meaning must remain documented. A
meaningfully different condition receives a new code.

## Severity

- `error`: the project cannot be treated as a valid, internally consistent Forge
  configuration. `validateForgeProject` returns `success: false`.
- `warning`: the configuration parses, but an inconsistency or potentially
  surprising policy interaction should be reviewed. Successful results may
  contain warnings.
- `info`: reserved for useful non-problem status messages. No version 1 check
  currently emits info diagnostics.

## Current catalog

The TypeScript source of truth is `DIAGNOSTIC_CATALOG`. It records the default
severity, category, source, summary, public message, suggestion, and whether a
future automatic fix could be supported. `fixable: true` is only a capability
marker; no automatic fixes exist yet.

| Code                                         | Severity | Meaning                                              | Future fixable |
| -------------------------------------------- | -------- | ---------------------------------------------------- | -------------- |
| `CFG_SCHEMA_VERSION_MISSING`                 | error    | `schemaVersion` is absent.                           | yes            |
| `CFG_SCHEMA_VERSION_UNSUPPORTED`             | error    | The declared schema version is unsupported.          | no             |
| `CFG_UNKNOWN_FIELD`                          | error    | A strict schema object contains an unknown field.    | no             |
| `CFG_REQUIRED_FIELD_MISSING`                 | error    | A required field is absent.                          | no             |
| `CFG_INVALID_TYPE`                           | error    | A value has the wrong JSON type.                     | no             |
| `CFG_INVALID_VALUE`                          | error    | A value violates a schema constraint.                | no             |
| `CFG_INVALID_PATH`                           | error    | A project path is absolute or traverses a parent.    | no             |
| `CFG_DUPLICATE_NAME`                         | error    | A definition name is duplicated.                     | no             |
| `CFG_TOOL_NAME_INVALID`                      | error    | A tool name violates the snake_case contract.        | no             |
| `CFG_DESTRUCTIVE_CONFIRMATION_REQUIRED`      | error    | A destructive tool does not require confirmation.    | yes            |
| `CFG_SECRET_DEFAULT_FORBIDDEN`               | error    | A secret contains an inline default.                 | yes            |
| `CFG_KNOWLEDGE_SOURCE_LOCATION_INVALID`      | error    | A knowledge source uses the wrong location field.    | no             |
| `CFG_NPM_VERSION_NOT_PINNED`                 | error    | An npm distribution uses a floating version.         | no             |
| `CFG_CLIENT_MODE_INVALID`                    | error    | A client update mode is unsupported.                 | no             |
| `CFG_VALIDATION_FAILED`                      | error    | Fallback for an unmapped schema issue.               | no             |
| `SEM_CAPABILITY_DISABLED_WITH_DEFINITIONS`   | error    | Definitions exist for a disabled capability.         | no             |
| `SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS` | warning  | A capability is enabled without definitions.         | no             |
| `SEM_KNOWLEDGE_DISABLED_WITH_SOURCES`        | warning  | Disabled knowledge contains unused sources.          | no             |
| `SEC_TOOL_WRITE_DISABLED`                    | warning  | A mutating tool conflicts with disabled writes.      | no             |
| `SEC_TOOL_DELETE_DISABLED`                   | warning  | A destructive tool conflicts with disabled deletion. | no             |

The shared catalog also contains stable `IMP_` diagnostics for importers. Their
complete meanings and severities are listed in
[importers.md](importers.md#import-diagnostics).

Stable `TPL_` diagnostics cover template manifest validation, generation state,
ownership conflicts, modified files, and read-only planning decisions. Their
complete meanings and severities are listed in
[templates.md](templates.md#template-diagnostics).

Stable `GEN_` diagnostics cover safe render requests, source maps, restricted
syntax, context access, conditions, and output production. Their complete
meanings and severities are listed in
[rendering.md](rendering.md#generation-diagnostics).

Stable `PLAN_` diagnostics cover preview request consistency, ambiguous state,
unsafe file decisions, manual review, and orphaned generated files. Their
complete meanings and severities are listed in
[generation-preview.md](generation-preview.md#safety-and-diagnostics).

Stable `FS_` diagnostics cover explicit roots, confined portable paths,
symlinks, regular-file reads, size limits, generation state, and template
bundles. Their complete meanings and safety policy are listed in
[filesystem-adapter.md](filesystem-adapter.md#diagnostics).

Stable `APPLY_` diagnostics distinguish invalid or unsafe contracts, unsupported
standalone directories, stale targets, generated-file write failures, and state
write failures. Their execution semantics are documented in
[apply-contract.md](apply-contract.md) and
[filesystem-generation.md](filesystem-generation.md).

## Schema and semantic validation

Schema validation accepts unknown input and validates it against
`forgeConfigSchema`. The mapper uses stable paths and structural issue data to
select a code. Unknown future schema issue types receive
`CFG_VALIDATION_FAILED`; this prevents internal Zod codes or text from becoming
an accidental public API.

Semantic validation runs only after parsing and default application succeeds. It
currently checks:

- definitions present while the corresponding capability is disabled (error);
- capability enabled with no tools, resources/templates, or prompts (warning);
- knowledge sources present while the knowledge layer is disabled (warning);
- non-read-only tools while global file writes are disabled (warning);
- destructive tools while global file deletion is disabled (warning).

The write/delete checks are conservative policy warnings. Version 1 cannot
distinguish a filesystem mutation from another external mutation using only the
current tool metadata, so these diagnostics do not claim runtime enforcement.

Enabled clients receive no additional semantic warning in version 1. The
configuration schema deliberately allows client defaults, and validators must
not invent new required fields such as `configPath` or `serverName`.

## Public API

`@mcp-server-forge/validators` exports:

- `validateForgeProject(input)`: validates unknown input, then runs semantic
  checks; returns parsed data only when no errors exist;
- `validateParsedForgeConfig(config)`: runs semantic and security checks on a
  parsed `ForgeConfig` and returns diagnostics;
- `validateKnownForgeConfig(config)`: wraps parsed validation in the common
  success-result shape;
- `formatDiagnostics(diagnostics, options)`: stable compact or detailed text;
- `hasErrors` and `hasWarnings`;
- `groupDiagnosticsByPath` and `groupDiagnosticsByCode`, both returning maps;
- `sortDiagnostics`, `createDiagnostic`, the catalog, code list, and public
  diagnostic types.

The primary result is:

```ts
type ForgeValidationResult =
  | {
      success: true;
      data: ForgeConfig;
      diagnostics: ForgeDiagnostic[];
    }
  | {
      success: false;
      diagnostics: ForgeDiagnostic[];
    };
```

Warnings do not make `success` false. Diagnostics are sorted by severity, field
path, code, and message, so output is deterministic regardless of source order.

## Text output

Compact output uses one line per diagnostic:

```text
ERROR CFG_NPM_VERSION_NOT_PINNED distribution.version: Npm package distributions must use an exact version. Suggestion: Replace the floating version with an exact version such as 1.2.3.
```

Detailed output separates identity, location, message, and suggestion:

```text
ERROR CFG_NPM_VERSION_NOT_PINNED
distribution.version

Npm package distributions must use an exact version.
Suggestion: Replace the floating version with an exact version such as 1.2.3.
```

Set `includeSuggestions: false` to omit suggestions. The formatter intentionally
has no terminal colors and no CLI-library dependency.

## Adding a diagnostic

1. Confirm that no existing code already has exactly the same meaning.
2. Add the code to `FORGE_DIAGNOSTIC_CODES` using the owning prefix.
3. Add one complete `DIAGNOSTIC_CATALOG` entry.
4. Map or emit the code in exactly one appropriate validation layer.
5. Add tests for code, severity, path, deterministic ordering, and JSON shape.
6. Add the code and its stable meaning to this document.
7. Do not assert against internal Zod message wording.

Localization should select text by diagnostic code or a future message key. It
must not parse the English `message` field.
