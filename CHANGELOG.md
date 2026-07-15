# Changelog

All notable changes to `mcp-server-forge` are documented in this file.

The project follows [Semantic Versioning](https://semver.org/) and uses
pre-release identifiers while its public contracts are still evolving.

## Unreleased

### Added

- pure versioned Apply Contract in `@mcp-server-forge/core`;
- bounded filesystem execution with stale-target checks, atomic-per-file writes,
  executable-mode handling, and generation state persisted last;
- interactive `mcp-forge generate` workflow with no non-interactive bypass.

### Security

- unsafe plans, unconfirmed applications, symlinked paths, changed targets,
  changed generation state, and standalone empty directories are rejected before
  writes begin.

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
