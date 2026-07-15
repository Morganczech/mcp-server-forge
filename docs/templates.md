# MCP Server Forge template contract

## Purpose

`@mcp-server-forge/templates` defines the versioned, read-only contracts used to
describe template outputs and plan safe future regeneration. It does not render
content, inspect or write a filesystem, execute commands, or expose a CLI.

A template is the complete base project. A capability is a separately validated
local delta composed into one manifest before this existing pipeline runs. See
[capabilities.md](capabilities.md); capability manifests do not change template
manifest version 1.

Template manifests and generation state are JSON-serializable data. Validation,
hashing, sorting, and planning are separate public operations so generators and
product interfaces can depend on the same deterministic rules later.

## Template manifest version 1

Every manifest declares `manifestVersion: "1"`, template identity,
compatibility, files, and optional directories:

```json
{
  "manifestVersion": "1",
  "template": {
    "id": "basic-typescript-server",
    "version": "1.1.0",
    "title": "Basic TypeScript MCP server",
    "description": "Template contract for a standard server.",
    "kind": "server",
    "runtime": "node",
    "language": "typescript"
  },
  "compatibility": {
    "forgeConfigSchema": ["1"],
    "minimumForgeVersion": "0.1.0"
  },
  "files": []
}
```

Version 1 supports `server` and `knowledge-server`. `registry-package` and
`client-profile` are reserved template kinds, but validation rejects them until
their contracts are implemented. Template and minimum Forge versions must be
exact semantic versions.

Manifest validation sorts files and directories by portable ASCII path. Input
object insertion order therefore does not affect the normalized result.

## File declarations

Each file declares:

- a project-relative target `path`;
- a package-relative template `source`;
- `ownership` and `updateStrategy`;
- whether it is `required`;
- optional executable, content type, and condition metadata.

Directories are declarative targets with a path, required flag, and optional
condition. A directory may be a normal parent of a declared file. It conflicts
when it has exactly the same path as a file or lies below a path declared as a
file.

## Ownership and update strategies

Ownership answers who controls content after initial creation:

- `forge-owned`: Forge may manage the whole file under the declared safety rule;
- `user-owned`: Forge may create the file, but preserves it afterwards;
- `shared`: Forge and the user own separate sections, requiring a future
  marker-based or structural merge.

The valid version 1 matrix is:

| Ownership     | Valid strategies                                            |
| ------------- | ----------------------------------------------------------- |
| `forge-owned` | `create-once`, `replace`, `replace-if-unmodified`, `manual` |
| `user-owned`  | `create-once`, `manual`                                     |
| `shared`      | `merge-markers`, `manual`                                   |

Strategies mean:

- `create-once`: create a missing target and never replace an existing one;
- `replace`: replace only after explicit permission in a controlled workflow;
- `replace-if-unmodified`: replace only when the target hash equals the last
  generated hash;
- `merge-markers`: update a managed section in the future; version 1 planning
  always requests manual review because merge implementation is absent;
- `manual`: report a proposed change but never apply it automatically.

`user-owned + replace` and `shared + replace` are invalid. A manifest must be
fixed before planning when its ownership-strategy combination is invalid.

## Conditional files

Conditions are a deliberately small declarative union:

```json
{ "field": "knowledge.enabled", "equals": true }
```

or:

```json
{ "field": "registry.categories", "includes": "knowledge" }
```

`equals` accepts only documented scalar paths in normalized Forge configuration.
`includes` is limited to `registry.categories`. Conditions are validated and
preserved but are not evaluated in this phase. There is no expression language,
function invocation, interpolation, or schema-package dependency.

## Safe paths and sources

Target and directory paths must be non-empty relative paths using `/`. They
reject absolute POSIX and Windows paths, backslashes, `.` or `..` segments,
empty segments, and NUL bytes. Target paths must be unique.

Source paths follow the same portable path rules and additionally reject URL
schemes and shell syntax such as command substitution, backticks, pipes, and
redirections. A source is only an opaque reference to content within its
template package; validation does not read it.

## Generation state

The future `.mcp-forge/generated-state.json` shape is represented, but is not
written:

```json
{
  "stateVersion": "1",
  "templateId": "basic-typescript-server",
  "templateVersion": "1.0.0",
  "hashAlgorithm": "sha256",
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "files": [
    {
      "path": "src/index.ts",
      "ownership": "forge-owned",
      "updateStrategy": "replace-if-unmodified",
      "generatedHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ]
}
```

State stores hashes, never historical file content. `generatedHash` records the
exact generated bytes used to detect later modification; optional
`templateSourceHash` records the source template bytes. Both are lowercase
64-character SHA-256 hex digests. `generatedAt` records provenance but is never
used for sorting, hashing, or decisions, keeping tests deterministic.

`hashGeneratedContent` hashes a string as UTF-8, or hashes supplied bytes
unchanged, using Node's cryptographic SHA-256 implementation.

## Read-only change planning

`createFilePlan` accepts only abstract state: one manifest entry, target
existence, optional current, rendered, and previous hashes, optional executable
flags, and optional explicit replace permission. It performs no I/O. When the
known target hash already equals the rendered hash and the executable flag does
not change, the result is `skip`.

| Situation                                      | Strategy / ownership               | Action          |
| ---------------------------------------------- | ---------------------------------- | --------------- |
| Target missing                                 | safe automatic strategy            | `create`        |
| Target missing                                 | `manual`                           | `manual-review` |
| Target already equals rendered output          | compatible ownership and strategy  | `skip`          |
| Target exists                                  | `user-owned`                       | `skip`          |
| Target exists                                  | `create-once`                      | `skip`          |
| Target equals previous generated hash          | `replace-if-unmodified`            | `replace`       |
| Previous hash missing or comparison impossible | `replace-if-unmodified`            | `conflict`      |
| Target differs from previous generated hash    | `replace-if-unmodified`            | `conflict`      |
| Target exists                                  | `shared` / `merge-markers`         | `manual-review` |
| Target exists, no explicit permission          | `replace`                          | `manual-review` |
| Target exists, explicit permission             | `forge-owned` / `replace`          | `replace`       |
| Any target                                     | invalid ownership-strategy pairing | `conflict`      |

The planner never returns `replace` for a modified `replace-if-unmodified`
target. User-owned targets are preserved even when their hashes differ. Shared
targets wait for the future merge implementation. Executable-only changes use
the same ownership policy and may require manual review.

`createGenerationPlan` combines and path-sorts file plans, checks a supplied
generation state's template identity, sorts diagnostics, and sets `safeToApply`
only when every action is `create`, `replace`, or `skip` and no error diagnostic
exists. It still does not apply the plan.

Renderer-to-planner orchestration, target-state comparison, orphan detection,
and `PLAN_` diagnostics are documented in
[generation-preview.md](generation-preview.md).

## Public API

The package exports:

- `validateTemplateManifest(input)` and `validateGenerationState(input)`;
- `hashGeneratedContent(content)` and the declared hash algorithm;
- `createFilePlan(input)` and `createGenerationPlan(input)`;
- deterministic file, directory, and state sorting helpers;
- safe-path and ownership-strategy predicates;
- all JSON-serializable public data types and validation result contracts.

Validation results expose normalized data or shared `ForgeDiagnostic` values.
Validation-library internals and messages are not part of the public result.

## Template diagnostics

| Code                               | Meaning                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `TPL_MANIFEST_VERSION_UNSUPPORTED` | Manifest version is unsupported.                      |
| `TPL_MANIFEST_INVALID`             | Manifest shape is otherwise invalid.                  |
| `TPL_TEMPLATE_KIND_UNSUPPORTED`    | Reserved template kind is not implemented.            |
| `TPL_TEMPLATE_ID_INVALID`          | Template ID is not portable kebab-case.               |
| `TPL_TEMPLATE_VERSION_INVALID`     | A template-related version is not exact.              |
| `TPL_FILE_PATH_INVALID`            | Target or directory path is unsafe.                   |
| `TPL_SOURCE_PATH_INVALID`          | Source is unsafe or outside the relative contract.    |
| `TPL_DUPLICATE_FILE_PATH`          | Multiple files use one target path.                   |
| `TPL_FILE_DIRECTORY_CONFLICT`      | A path is required as both file and directory.        |
| `TPL_OWNERSHIP_STRATEGY_INVALID`   | Ownership and update strategy are incompatible.       |
| `TPL_CONDITION_INVALID`            | Condition operator, field, or value is unsupported.   |
| `TPL_GENERATED_STATE_INVALID`      | Generation state, hash, or state metadata is invalid. |
| `TPL_TEMPLATE_VERSION_MISMATCH`    | State and selected template identities differ.        |
| `TPL_FILE_MODIFIED`                | Current content differs from the generated hash.      |
| `TPL_FILE_OWNERSHIP_CONFLICT`      | Planned operation violates ownership safety.          |
| `TPL_MANUAL_REVIEW_REQUIRED`       | Current planner cannot safely automate the file.      |
| `TPL_UNSAFE_REPLACE_BLOCKED`       | Existing target replacement lacks explicit consent.   |

## Examples

Versioned example templates live in:

- `packages/templates/templates/basic-typescript-server`;
- `packages/templates/templates/knowledge-typescript-server`.

Their `.hbs` files use the restricted renderer language documented in
[rendering.md](rendering.md). Template content is stored in those files, not
hard-coded in TypeScript. `basic-typescript-server@1.1.0` is functional and is
documented in the
[standalone template guide](templates/basic-typescript-server.md);
`knowledge-typescript-server` remains a data-oriented example rather than a
complete production server.

## Not implemented yet

- filesystem discovery, reads, writes, or generated-state persistence;
- marker-based or structural merge;
- actual diff generation or interactive approval;
- template registry, resolution, download, or installation;
- template migration execution;
- CLI commands or MCP tools;
- support for `registry-package` or `client-profile` manifests.
