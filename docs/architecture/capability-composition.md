# Capability composition architecture

## Decision

Phase 6 adds deterministic capability composition without creating a second
generation pipeline:

```text
configuration + base template + selected capability bundles
  -> pure resolver
  -> one composed template manifest and source map
  -> existing renderer
  -> existing preview
  -> existing Apply Contract
  -> existing filesystem executor
```

`@mcp-server-forge/capabilities` owns manifest validation, dependency ordering,
compatibility checks, collision detection, and pure composition. It does not
read files. `@mcp-server-forge/fs-adapter` loads explicitly selected local
bundles with the same confined, bounded regular-file rules as templates. The
renderer, planner, Apply Contract, generation state, and filesystem executor
remain authoritative and unchanged in responsibility.

## Contracts

A template defines the complete base project. A capability is a reviewed local
delta that may declare additional managed files, exact dependencies, public
tools, permission requirements, and another capability it requires. A permission
describes the runtime authority required by the composed server; it does not
grant Forge authority to write or execute anything.

Dependency declarations are exact requirements, not an offline package resolver.
Phase 6 accepts them only when the selected template already contains the same
package and version in its rendered `package.json` and lockfile. The official
SDK and Zod requirements therefore deduplicate against the base template and
leave its lockfile unchanged. A missing or different locked dependency fails
composition; the generated project's frozen installation is the end-to-end
consistency check.

Capability manifest version 1 is strict. It requires exact versions, portable
relative file and registration-module paths, explicit ownership and update
strategies, an allowlist of compatible template IDs, and closed objects with no
unknown fields. It has no scripts, commands, hooks, network locations, or
arbitrary executable entrypoint. Loading a manifest never executes capability
code.

The resolver uses an ASCII-stable topological order. It rejects unknown or
duplicate capability IDs, missing or cyclic requirements, declared conflicts,
incompatible templates, file-path collisions, public-tool collisions, unequal
versions of the same dependency, and incompatible permission declarations. There
is no last-writer-wins behavior.

## Ownership and removal

Composed files enter the same generation manifest as base-template files, so
normal ownership rules apply:

- `forge-owned` files may be replaced only when unmodified;
- `shared` files require manual review when content diverges;
- `user-owned` files use `create-once` and are never adopted or overwritten.

Removing a capability does not delete its former outputs. The existing planner
reports tracked outputs as orphaned and blocks apply. In particular, local data
declared by `local-json-data` remains user-owned and preserved. Phase 6 has no
purge, migration, uninstall, or automatic cleanup operation.

## Configuration and derived facts

`mcp-forge.json` stores selected capability IDs. Tool registrations, exact
dependencies, and capability-required read scopes are derived during every
composition. They are not copied back into the configuration as a second source
of truth. Read-only inspection with a registered template and capability root
shows the resulting capability IDs, tool names, permissions, files, and plan.

Composition does not change configuration `schemaVersion`, template
`manifestVersion`, generation `stateVersion`, or package versions. It is an
additive schema-version-1 feature.

## Explicit non-goals

Phase 6 does not implement a remote registry, package download, dynamic plugin
execution, arbitrary user-authored scripts, automatic dependency negotiation,
capability installation, deletion, migration, or MCP-based apply. Capability
bundles are reviewed repository assets selected from an explicit local root.
