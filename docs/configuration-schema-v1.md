# MCP Server Forge configuration contract — version 1

## Purpose

`mcp-forge.json` is the declarative source of truth for one MCP Server Forge
project. Version 1 describes project metadata, the intended MCP surface,
knowledge inputs, documentation outputs, distribution, client previews, runtime
environment requirements, and security boundaries.

The contract does not perform generation, installation, registry access, or
filesystem operations. It only validates intent and produces a normalized
in-memory configuration with documented defaults.

Every configuration starts with an explicit version:

```json
{
  "schemaVersion": "1"
}
```

Unknown fields are rejected throughout the contract. A future incompatible shape
must use another `schemaVersion`; compatible additions can be introduced as
optional fields within version 1.

## Top-level structure

| Section             | Input requirement | Purpose                                       |
| ------------------- | ----------------- | --------------------------------------------- |
| `schemaVersion`     | required          | Selects this contract; must equal `"1"`.      |
| `project`           | required          | Human-facing project metadata.                |
| `server`            | required          | MCP runtime and capability declaration.       |
| `tools`             | optional          | Tool definitions; defaults to `[]`.           |
| `resources`         | optional          | Static resource definitions; defaults `[]`.   |
| `resourceTemplates` | optional          | URI template definitions; defaults to `[]`.   |
| `prompts`           | optional          | Prompt definitions; defaults to `[]`.         |
| `knowledge`         | optional          | Knowledge layout and sources.                 |
| `documentation`     | optional          | Requested documentation outputs.              |
| `clients`           | optional          | Future client configuration previews.         |
| `distribution`      | required          | How the server is expected to be invoked.     |
| `environment`       | optional          | Runtime variable declarations; defaults `[]`. |
| `security`          | optional          | Explicit safety boundaries.                   |
| `registry`          | optional          | Future public-registry metadata.              |

Fields described as optional may still appear in the parsed result because the
schema applies safe defaults.

## Project

`project` contains required `name`, `title`, `description`, and `language`.
Optional fields are `license`, `homepage`, and `repository`; both URL fields
must be valid absolute URLs.

`project.name` uses lowercase kebab-case, starts with an alphanumeric character,
and is at most 64 characters. `language` is a non-empty language identifier; v1
does not enforce one particular language-code standard.

```json
{
  "project": {
    "name": "company-knowledge",
    "title": "Company Knowledge",
    "description": "A fictional reviewed knowledge server.",
    "language": "en",
    "license": "MIT"
  }
}
```

## Server

`server` requires:

- `name`: lowercase kebab-case, at most 64 characters;
- `version`: an exact semantic-style version such as `1.2.3` or `1.2.3-beta.1`;
- `description`;
- `runtime`: `node` in version 1;
- `transport`: `stdio` or `streamable-http`;
- `entrypoint`: a non-empty relative path;
- `capabilities`: booleans for `tools`, `resources`, and `prompts`.

Capability flags declare the intended public MCP surface. Version 1 does not
infer or rewrite them from the definition arrays; keeping the declaration and
definitions aligned remains an author responsibility.

## Tools

Every tool requires `name`, `title`, `description`, `inputSchema`, `useWhen`,
`avoidWhen`, `riskLevel`, `readOnly`, `destructive`, and `requiresConfirmation`.
`outputSchema` is optional.

Tool names use snake_case, start with a lowercase letter, contain only lowercase
letters, digits, and underscores, and are at most 64 characters. `riskLevel` is
one of `low`, `medium`, `high`, or `critical`.

`inputSchema` and `outputSchema` must be JSON objects. Their nested content must
be JSON-compatible, but MCP Server Forge deliberately does not implement a full
JSON Schema validator in version 1.

```json
{
  "name": "search_documents",
  "title": "Search documents",
  "description": "Searches approved documents.",
  "inputSchema": {
    "type": "object",
    "properties": { "query": { "type": "string" } }
  },
  "useWhen": "The user asks about reviewed documentation.",
  "avoidWhen": "The answer requires private or unreviewed data.",
  "riskLevel": "low",
  "readOnly": true,
  "destructive": false,
  "requiresConfirmation": false
}
```

A destructive tool is invalid unless `requiresConfirmation` is `true`. Tool
names must be unique within the configuration.

## Resources and resource templates

A static resource requires `name`, `title`, `description`, and `uri`. Optional
fields are `mimeType` and `source`.

A resource template uses the same metadata but requires `uriTemplate` instead of
`uri`. Template expansion is outside version 1; the field only preserves the
future MCP contract. Resource and resource-template names share one uniqueness
namespace and use the same snake_case rule as tool names.

## Prompts

A prompt requires `name`, `title`, and `description`. Optional input fields are:

- `arguments`, an array defaulting to `[]`; each argument has `name`,
  `description`, and `required` (default `false`);
- `templatePath`, a relative path to a future prompt template.

Prompt names must be unique and use snake_case. Version 1 validates metadata but
does not load or render `templatePath`.

## Knowledge

The optional `knowledge` section has these safe defaults:

| Field                         | Default                   |
| ----------------------------- | ------------------------- |
| `enabled`                     | `false`                   |
| `dataDirectory`               | `knowledge`               |
| `manifest`                    | `knowledge/manifest.json` |
| `publicDirectory`             | `knowledge/public`        |
| `privateDirectory`            | `knowledge/private`       |
| `sourceDocumentsDirectory`    | `knowledge/sources`       |
| `generatedDocumentsDirectory` | `knowledge/generated`     |
| `index`                       | `knowledge/index.json`    |
| `sources`                     | `[]`                      |

These paths describe the intended layout only. Validation does not read, create,
or modify them.

Each source requires `id`, `type`, and `title`. Optional metadata is `language`,
`reviewStatus`, `private` (default `false`), and ISO 8601 `updatedAt`.
`reviewStatus` is `generated`, `needs-review`, `approved`, or `outdated`.

Local source types are `markdown`, `text`, `json`, `yaml`, `pdf`, and
`directory`. They require a relative `path` and reject `url`. The `web` type
requires a valid absolute `url` and rejects `path`. This discriminated design
prevents both fields from being required or supplied together.

All project-relative paths reject parent-directory (`..`) traversal.

## Documentation

`documentation.language` defaults to `en`. `outputs` contains independent
booleans for:

- `readme` (`README.md`);
- `shortSystemPrompt`;
- `fullSystemPrompt`;
- `agents` (`AGENTS.md`);
- `queryExamples`;
- `clientConfigurations`.

All output flags default to `false`, so parsing configuration never opts into a
future write operation implicitly.

## Clients

Supported keys are `lm-studio`, `claude-desktop`, `cursor`, `codex`, `continue`,
and `generic-json`. Each client may declare:

- `enabled`, default `false`;
- `configPath`, an optional relative path;
- `serverName`, an optional target name;
- `updateMode`: `preview`, `merge`, or `replace-managed-section`.

`updateMode` defaults to `preview`. The schema does not update any client; it
only records a future operation. Relative config paths keep version 1 scoped to
the project and avoid silently targeting user-level files.

## Distribution

`distribution` is a required discriminated union:

- `local-entrypoint`: `entrypoint` relative path;
- `npm-package`: `packageName`, exact pinned `version`, `packageManager`, and
  optional `args` (default `[]`);
- `remote-http`: absolute `url`;
- `custom-command`: `command` and optional `args` (default `[]`).

Supported package managers are `npm`, `pnpm`, `yarn`, and `bun`. Floating npm
versions such as `latest` are rejected; v1 requires an exact version.

## Environment variables and secrets

Each item in `environment` requires `name`, `description`, `required`, and
`secret`. Names use uppercase letters, digits, and underscores and start with a
letter. Non-secret variables may declare a JSON-compatible `default`.

Secret variables must not contain a default or secret value in `mcp-forge.json`.
They may declare `externalSource` as either:

- an `environment-variable` with its external variable `name`; or
- a `secret-manager` with an opaque `reference`.

An external reference is descriptive in version 1; resolving it is explicitly
out of scope.

## Security

The optional `security` section defaults to a deny-oriented posture:

```json
{
  "allowedRootDirectories": [],
  "networkAccess": "none",
  "shellAccess": false,
  "fileWrite": false,
  "fileDelete": false,
  "requireConfirmation": true,
  "maxResponseBytes": 1048576,
  "timeoutMs": 30000
}
```

`networkAccess` is `none`, `restricted`, or `unrestricted`. Size and timeout
limits must be positive integers. These values declare intended policy; v1 does
not enforce permissions at runtime.

## Registry metadata

Optional `registry` metadata supports `publicRegistryId`, `publisher`,
`sourceRepository`, `trustStatus`, `categories`, and ISO 8601 `lastSyncedAt`.
`trustStatus` defaults to `unverified` and may be `unverified`, `verified`, or
`deprecated`.

This section is storage for future integration. Version 1 performs no registry
lookup, publication, synchronization, or trust verification.

## Validation and errors

Consumers can use `forgeConfigSchema` directly or call `validateForgeConfig`.
The latter returns either parsed `ForgeConfig` data or structured errors with a
Zod issue `code`, dotted `path`, and readable `message`.

Important cross-field rules are:

- tool, resource (including templates), and prompt names are unique;
- destructive tools require confirmation;
- secret environment variables cannot have inline defaults;
- web knowledge sources use `url`, while local sources use `path`;
- npm distribution versions are exact and never default to `latest`.

The fixture suite under `packages/schemas/fixtures` is executable contract
documentation. Every file in `valid` must parse; every file in `invalid` must be
rejected.

## Architectural decisions and future extension

Version 1 favors small schema modules and discriminated unions. The root export
provides the complete schema, all derived TypeScript types, individual section
schemas, and the readable validation helper. `packages/schemas` has no
dependency on CLI or application packages.

Extensions should follow these rules:

1. Add backward-compatible optional fields only when old version 1 files retain
   their meaning.
2. Add new union members deliberately and with fixtures.
3. Introduce a new `schemaVersion` for incompatible changes.
4. Keep filesystem, networking, generation, and installation behavior outside
   the schema package.

## Deliberately outside version 1

- MCP server code or documentation generation;
- CLI commands and interactive prompts;
- full JSON Schema semantic validation;
- reading source documents or rendering prompt templates;
- client configuration writes and LM Studio installation;
- public MCP Registry access, publication, or trust verification;
- secret resolution or storage;
- runtime security enforcement;
- migration between schema versions;
- automatic reconciliation between capability flags and definition arrays.

Complete examples are available in
`packages/schemas/fixtures/valid/full-project.json` and the other fixture files.
