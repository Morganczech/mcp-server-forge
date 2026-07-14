# MCP Server Forge importers

## Purpose

`@mcp-server-forge/importers` converts existing MCP client configuration values
into a client-independent, read-only server draft. The normalized result can
later support Forge configuration creation, cataloging, installation previews,
and client migration without treating incomplete or inferred data as verified.

Importing is not generation. The package never writes `mcp-forge.json`, edits a
client, starts a command, installs a package, reads a path, or makes a network
request.

## Supported formats

Version 1 fully supports two JSON value shapes:

### LM Studio

```json
{
  "mcpServers": {
    "browser-tools": {
      "command": "npx",
      "args": ["-y", "@example/browser-mcp@1.2.3"],
      "env": {}
    }
  }
}
```

Only the documented `mcpServers` wrapper is recognized as LM Studio input.

### Generic MCP JSON

Wrapped server map:

```json
{
  "servers": {
    "catalog-server": {
      "command": "node",
      "args": ["catalog-server.mjs"]
    }
  }
}
```

Direct root map:

```json
{
  "catalog-server": {
    "command": "node",
    "args": ["catalog-server.mjs"]
  }
}
```

`package-json`, `server-metadata`, and `custom` are reserved source kinds. An
explicit request for one currently returns `IMP_UNSUPPORTED_FORMAT`; the type
does not imply implementation.

## Format detection

`detectMcpConfigurationFormat` is independent from conversion and returns a
status, confidence, and reason.

- `mcpServers` alone selects LM Studio with high confidence.
- `servers` alone selects generic MCP JSON with high confidence.
- a non-empty root whose every value has a known server-definition field selects
  the generic root map with medium confidence;
- both wrapper keys produce an ambiguous result and no import;
- `options.sourceKind` always takes precedence over heuristic detection.

Detection does not silently choose between conflicting formats. It does not
inspect the filesystem or execute a server to increase confidence.

## Normalized model

Each `ImportedMcpServerDraft` contains:

- `source`: supported format and source variant;
- `identity`: suggested portable ID, original display name, and observed npm
  version when available;
- `connection`: `command`, reliably detected `npm`, or a future-ready `remote`
  union member;
- `environment`: safe environment declarations with explicit redaction state;
- `capabilities`: only actual hints; currently empty because supported inputs do
  not prove capabilities;
- `provenance`: original server key/path and observed versus inferred fields;
- `confidence`: overall and per-field confidence;
- `diagnostics`: stable Forge diagnostics for that server;
- optional `raw.unknownFields`: sanitized unknown metadata only.

The result is JSON-serializable and contains multiple servers. Server keys and
environment names are sorted by deterministic ASCII comparison. Source object
insertion order is not part of the API.

Example sanitized result excerpt:

```json
{
  "identity": {
    "suggestedId": "video-server",
    "displayName": "video-server"
  },
  "connection": {
    "kind": "command",
    "command": "node",
    "commandPathKind": "path-command",
    "args": ["server.js"],
    "entrypoint": {
      "path": "server.js",
      "pathKind": "relative",
      "argumentIndex": 0
    }
  },
  "environment": [
    {
      "name": "VIDEO_API_KEY",
      "required": true,
      "secret": true,
      "valuePresent": true,
      "redacted": true,
      "valueRetained": false
    }
  ]
}
```

## Connection normalization

Command connections preserve `command`, all `args`, optional `cwd`, and whether
the command is absolute or expected through `PATH`.

The Node entrypoint heuristic is intentionally narrow: only the first direct
argument to a command whose basename is `node` or `node.exe` is considered, and
only when it has a `.js`, `.mjs`, or `.cjs` suffix. An option-first invocation
is left uninterpreted.

An npm connection is detected only for an `npx` basename followed by optional
`-y`/`--yes` and a syntactically valid package specifier. Unknown npx flags keep
the connection as a generic command. Scoped packages are supported. The model
preserves the complete original invocation separately from arguments following
the package specifier.

Exact versions such as `1.2.3` are pinned. A missing version and floating values
such as `latest` remain visible but produce warnings. No package is downloaded
or inspected.

Absolute commands, entrypoints, and working directories are preserved as
imported evidence and receive `IMP_ABSOLUTE_PATH_REQUIRES_REVIEW`. Existence is
never checked.

## Environment values and secrets

Names containing a delimited `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`,
`PRIVATE_KEY`, or `ACCESS_KEY` marker are treated as potentially secret.

For secrets:

- the source value is never included in the normalized environment item;
- `valuePresent`, `secret`, and `redacted` describe what happened;
- `IMP_SECRET_REDACTED` tells the user to configure an external source later;
- recursive sanitization also redacts secret-looking keys inside unknown raw
  metadata.

Public string values are preserved by default. Set
`publicEnvironmentValues: "omit"` to retain only their presence. Invalid
non-string values are omitted and reported with `IMP_ENV_INVALID`.

`sanitizeImportedConfiguration` also converts unsupported programmatic values to
`null` and marks circular references as `[CIRCULAR]`, keeping its output JSON
serializable.

## Imported server versus Forge configuration

An imported server describes source evidence. It is not a valid Forge project
and does not invent descriptions, capabilities, tools, resources, prompts, or
permissions.

`convertImportedServerToForgeDraft` proposes only relevant fragments:

- project ID and title;
- server identity plus safely inferred runtime/transport when possible;
- npm, custom-command, or remote distribution;
- sanitized environment declarations;
- deny-oriented security defaults.

The output has `status: "draft"`, `requiresReview: true`, an explicit
`missingRequiredFields` list, and `IMP_FIELD_INFERRED`. It is intentionally not
passed to schema v1 until a user supplies missing information.

## Public API

- `detectMcpConfigurationFormat(input, options)`;
- `importMcpConfiguration(input, options)`;
- `importLmStudioConfiguration(input, options)`;
- `importGenericMcpConfiguration(input, options)`;
- `sanitizeImportedConfiguration(input)`;
- `isPotentialSecretName(name)`;
- `convertImportedServerToForgeDraft(server)`;
- normalized model, detection, result, options, and draft TypeScript types.

`ImportResult.success` is false only when diagnostics contain errors. Warnings
and info diagnostics can accompany a successful import.

## Import diagnostics

Import codes use the stable shared `ForgeDiagnostic` model and the `IMP_`
prefix:

| Code                                | Severity | Meaning                                     |
| ----------------------------------- | -------- | ------------------------------------------- |
| `IMP_UNSUPPORTED_FORMAT`            | error    | No supported importer matches.              |
| `IMP_AMBIGUOUS_FORMAT`              | error    | Multiple formats match safely.              |
| `IMP_SERVER_NAME_INVALID`           | warning  | Source name needed ID normalization.        |
| `IMP_SERVER_DEFINITION_INVALID`     | error    | Server definition/map has an invalid shape. |
| `IMP_COMMAND_MISSING`               | error    | No usable local command exists.             |
| `IMP_ARGS_INVALID`                  | error    | Arguments are not an array of strings.      |
| `IMP_ENV_INVALID`                   | error    | Environment shape or values are invalid.    |
| `IMP_SECRET_REDACTED`               | warning  | A potential secret value was removed.       |
| `IMP_NPM_PACKAGE_DETECTED`          | info     | A reliable npx package was normalized.      |
| `IMP_NPM_VERSION_MISSING`           | warning  | Detected npm package has no version.        |
| `IMP_NPM_VERSION_NOT_PINNED`        | warning  | Detected npm version is floating.           |
| `IMP_ABSOLUTE_PATH_REQUIRES_REVIEW` | warning  | Machine-specific path needs a decision.     |
| `IMP_FIELD_INFERRED`                | info     | Forge draft fields were inferred.           |
| `IMP_UNKNOWN_FIELD_PRESERVED`       | warning  | Sanitized unknown metadata was retained.    |
| `IMP_DUPLICATE_SERVER_NAME`         | error    | Suggested IDs collide after normalization.  |

Codes retain their meaning under the stability rules in `docs/diagnostics.md`.

## Security boundaries

Importer domain code has no filesystem, HTTP, network, or child-process
dependency. It does not:

- execute or verify commands;
- expand variables or shell expressions;
- perform command substitution;
- read imported absolute paths;
- fetch registry or npm metadata;
- install packages;
- log or return source secret values;
- write a client or Forge configuration.

## Deliberately outside the first version

- public MCP Registry and npm inspection;
- package.json and standalone server-metadata conversion;
- client configuration discovery on disk;
- remote connection import from undocumented client shapes;
- capability probing or MCP server execution;
- automatic completion or validation of the Forge draft;
- CLI commands and file output;
- automatic fixes or installation.
