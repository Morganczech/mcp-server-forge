# Forge Engine and TUI Architecture

## Audit summary

The repository already separates generation decisions from effects:

- `packages/schemas` defines configuration values;
- `packages/validators` produces structured validation diagnostics;
- `packages/templates` defines manifests, ownership, generation state, and
  content hashing;
- `packages/generators` renders in memory and creates the authoritative
  generation preview;
- `packages/core` converts safe decisions into pure, serializable contracts;
- `packages/fs-adapter` performs bounded reads and separately executes an Apply
  Contract;
- `apps/cli` resolves command-line inputs and renders terminal output.

Rendering and planning are deterministic and filesystem-independent. Target,
state, and template reads belong to the filesystem adapter. The CLI currently
owns configuration-file loading and workflow composition. Filesystem mutation is
confined to `applyGenerationWorkspace`; `validate`, `preview`, `inspect`, and
`tui` do not call it.

The reusable engine is the composition of the pure schemas, validators,
generators, templates, and core contracts. It is not a daemon and does not own
terminal output. Other future clients can consume the same structured values,
but a stable remote engine API is not implemented.

## Project Inspection contract

`ForgeProjectInspection` version 1 is a pure, JSON-serializable snapshot. It
contains project and server identity without configuration secrets, normalized
health, generation-state and managed-file status, generated-server permission
declarations, structured diagnostics, and a deterministic summary.

`createProjectInspection` has no filesystem, clock, environment, process,
network, or terminal access. The CLI supplies already validated configuration
metadata and filesystem observations. Without an explicit template, inspection
compares tracked targets with generation state. With `--template`, it adapts the
existing generation preview and does not create a second planner.

`isForgeProjectInspection` validates an untrusted serialized inspection before
another client consumes it.

Missing configuration produces an `uninitialized` inspection. Schema errors,
filesystem errors, missing tracked files, conflicts, manual review, and orphaned
files remain visible rather than being converted to optimistic health.

## Permission model

The permission kinds are `filesystem.read`, `filesystem.write`,
`filesystem.delete`, `network`, `shell`, and `environment`. Each declaration
contains status, scope, source, and a user-facing description.

Status is `allowed`, `denied`, or `not-declared`. Schema defaults are not
misrepresented as explicit user declarations: the CLI checks the raw security
object before applying validated values. Environment-variable metadata does not
grant environment-read permission, so environment access is currently
`not-declared`. Permission results describe the generated server configuration,
not Forge's own read-only inspection access.

No environment values, secret defaults, tokens, or arbitrary configuration
payloads are copied into inspection results.

## Project Change Plan contract

`ForgeProjectChangePlan` version 1 is a general view adapted directly from
`ForgeGenerationPreview`. It adds deterministic `planId` and SHA-256 `planHash`
over canonical plan content, explicit risk, normalized file changes, an empty
`permissionChanges` collection, and declared data effects.

The timestamp is metadata and is intentionally excluded from plan identity. The
same preview therefore has the same identity at different observation times. A
confirmation binding contains only `planId` and `planHash`; there is no generic
`confirmed: true` value. Generate binds its interactive confirmation to that
identity, refreshes the preview, and still compares the complete Apply Contract
before filesystem execution.

The plan explicitly states that there is no deletion and no project-wide
transaction. It is not an approval token, an apply endpoint, or a new execution
path. `isForgeProjectChangePlan` validates the serialized shape, identity
binding, and canonical hash before consumption.

## Experimental read-only TUI

The command is named `mcp-forge tui`; the name makes the terminal-only boundary
explicit. The initial implementation uses Node.js terminal primitives instead of
a third-party framework. This keeps the client isolated, avoids a React runtime
and a new dependency, and is sufficient for the small read-only screen model. A
library should be reconsidered only when navigation, layout, or accessibility
requirements exceed this boundary.

The TUI exposes overview, permissions, generated files, diagnostics, refresh,
inspect, preview, help, and quit actions. Refresh, inspect, and preview all
recompute read-only inspection data. There is deliberately no apply, delete,
permission editing, configuration editing, installation, shell execution, or
automatic confirmation action.

Non-TTY execution is rejected before project inspection and points automation to
`mcp-forge inspect`. ANSI control sequences are limited to the interactive TUI;
inspect text and JSON output contain none.

## Future engine API

A future API can expose Project Inspection and Project Change Plan values to an
MCP server, desktop client, web client, or editor integration. That work must
define authentication, trust, cancellation, and approval boundaries first. None
of those clients or remote operations is implemented in this phase.
