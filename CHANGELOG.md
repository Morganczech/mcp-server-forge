# Changelog

All notable changes to `mcp-server-forge` are documented in this file.

The project follows [Semantic Versioning](https://semver.org/) and uses
pre-release identifiers while its public contracts are still evolving.

## Unreleased

### Added

- pure Project Inspection, generated-server permission, and deterministic
  Project Change Plan contracts;
- read-only `mcp-forge inspect` text and JSON output for project health,
  generation state, managed files, permissions, and diagnostics;
- experimental read-only `mcp-forge tui` screens for interactive inspection;
- shared read-only application orchestration for CLI and MCP project inspection
  and preview;
- minimal stdio Forge MCP server with an explicit project catalog and seven
  allowlisted read-only tools for status, projects, inspection, permissions,
  tracked files, preview, and diagnostic explanations.

### Changed

- interactive generation confirmations are bound to the displayed deterministic
  plan identity before the existing fresh-preview and Apply Contract checks;
- tracked-file inspection preserves ownership metadata already recorded in
  generation state.

### Documentation

- document the reusable engine boundary, terminal client isolation, command
  usage, and current non-goals;
- document MCP catalog setup, client configuration, response bounds, trust
  boundaries, and the exact unsupported write operations.

### Security

- confine MCP project access to canonical registered roots and reject duplicate
  IDs, traversal, symlink escape, unsupported catalog fields, and unsafe paths;
- revalidate registered project roots at use time and validate serialized
  Project Inspection and Change Plan contracts before returning them;
- bound MCP catalog, configuration, pagination, diagnostic, user-text, and
  response sizes while hiding absolute permission paths and redacting common
  credential, authorization, cookie, connection-string, and private-key shapes.

### Testing

- cover catalog and path boundaries, all seven read-only services, pagination,
  redaction, response limits, deterministic summaries, zero writes, and an
  official MCP client/server transport integration.

### Known limitations

- the TUI is a small terminal-only foundation and has no apply or configuration
  editing actions;
- a remote engine API, approval tokens, desktop, web, editor, and MCP clients
  beyond the local stdio interface remain future work;
- the MCP catalog is manual and startup-only, and no MCP tool can apply or
  approve a plan.

## [0.1.0-alpha.2] - 2026-07-15

Second public alpha release of MCP Server Forge.

### Added

- interactive `mcp-forge generate` workflow with explicit TTY confirmation;
- pure versioned Apply Contract separated from bounded filesystem execution;
- versioned generation state recording ownership, update policy, and generated
  hashes for successfully applied managed files;
- conflict, manual-review, orphan, stale-target, symlink, and path-boundary
  protections that block unsafe generation plans before writes begin;
- atomic per-file writes with generation state persisted only after all planned
  file operations succeed;
- idempotent repeated generation that skips unchanged managed files.

### Fixed

- repository text files are normalized to LF so formatting checks behave
  consistently on Windows checkouts.

### Testing

- end-to-end CLI smoke coverage verifies initial generation, the generated file
  set and state, an idempotent second run, and rejection of a manually modified
  forge-owned file;
- read-only CI runs frozen-lockfile installation, formatting, lint, typecheck,
  tests, and build on Ubuntu, macOS, and Windows with Node.js 22 and pnpm
  11.7.0.

### Documentation

- onboarding documents Node.js and pnpm prerequisites, Corepack and npm setup,
  frozen installation, build, test, validate, preview, and generate workflows;
- repeatable cross-platform smoke-test instructions and the completed Ubuntu
  smoke report are recorded under `docs/testing/`;
- Apply Contract, filesystem execution, interactive generation boundaries, and
  the source-release checklist are documented separately.

### Known limitations

- generated TypeScript projects remain placeholders without a functional MCP SDK
  server;
- marker merge, generated-file deletion, registry and dependency resolution, and
  template migrations are not implemented;
- the MCP server application remains a future interface;
- all packages remain private and are not prepared for npm publication.

## [0.1.0-alpha.1] - 2026-07-14

First public alpha release of MCP Server Forge.

### Added

- pnpm workspace foundation for the CLI, future MCP server, shared packages,
  examples, and documentation;
- versioned Forge configuration schema with Zod validation and representative
  valid and invalid fixtures;
- stable structured diagnostics spanning configuration, imports, templates,
  rendering, planning, and filesystem inspection;
- read-only `mcp-forge validate` command with text and JSON output for local
  development and CI;
- read-only import normalization for supported LM Studio and generic MCP JSON,
  including secret redaction and provenance metadata;
- versioned template manifests, generated-file ownership rules, SHA-256 state
  contracts, and conservative regeneration planning;
- restricted deterministic in-memory renderer with a safe context, bounded
  helpers, conditions, normalized output, and content hashes;
- complete read-only generation preview with stable actions, reason codes,
  orphan detection, executable-change reporting, and `safeToApply` evaluation;
- bounded filesystem adapter with root confinement, symlink rejection,
  exact-byte target hashing, optional state loading, and declared-only template
  source loading;
- read-only `mcp-forge preview` command with table, compact, detailed, and JSON
  formats, optional content, custom state paths, help, version output, and
  documented exit codes;
- Vitest coverage for domain contracts, filesystem safety, deterministic output,
  CLI behavior, and read-only integration scenarios.

### Security

- generation workflows do not write, delete, rename, install, execute generated
  code, access the network, or automatically resolve conflicts;
- rendering excludes secret values and exposes only an approved configuration
  context;
- filesystem inspection requires explicit roots, portable relative managed
  paths, bounded regular files, and rejects symlinks on managed read paths.

### Known limitations

- generated TypeScript projects are placeholders without a functional MCP SDK
  server;
- generation plans cannot be applied and generation state is never written;
- marker merge, registry and dependency resolution, and template migrations are
  not implemented;
- the MCP server application remains a future interface;
- packages are private and public APIs may change during the alpha series.
