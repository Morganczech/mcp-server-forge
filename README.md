# mcp-server-forge

`mcp-server-forge` is an early-stage toolkit for designing, generating,
validating, and documenting standard Model Context Protocol (MCP) servers. The
first interface will be a CLI, followed later by an MCP server.

The repository contains project infrastructure, validation/import contracts,
template ownership rules, and pure in-memory placeholder rendering. It does
**not** yet write projects or generate a functional MCP SDK server.

## Requirements

- Node.js 22 or newer
- pnpm 11

## Getting started

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Validate a Forge configuration during development:

```bash
pnpm --filter @mcp-server-forge/cli dev validate ./mcp-forge.json
```

The future installed command is:

```bash
mcp-forge validate ./mcp-forge.json
```

See [docs/cli.md](docs/cli.md) for output formats, CI usage, and exit codes.

## Repository layout

```text
apps/
  cli/          Read-only validation command and future CLI workflows
  mcp-server/   Future MCP interface to the forge
packages/
  core/         Shared domain and orchestration logic
  schemas/      Zod schemas for configuration contracts
  generators/   Future code and documentation generators
  validators/   Configuration and generated-output validation
  importers/    Import of existing MCP server definitions
  templates/    Versioned generation templates
examples/
  company-info/ Configuration-driven example project
docs/           Architecture and user documentation
```

## Project principles

- A server configuration is the single source of truth.
- Runtime data and template content do not belong hard-coded in TypeScript.
- Generated files are reproducible outputs and are not edited manually.
- Packages should keep clear responsibilities and expose small public APIs.

See [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md), and
[CONTRIBUTING.md](CONTRIBUTING.md) before making changes.

## Status

The project is in its initial scaffolding phase. Public APIs and configuration
formats are not stable yet. The first version of the configuration contract is
documented in
[docs/configuration-schema-v1.md](docs/configuration-schema-v1.md).

`@mcp-server-forge/validators` provides stable JSON diagnostics, semantic and
security consistency checks, deterministic grouping, and compact or detailed
text formatting. Its public model and code-stability rules are documented in
[docs/diagnostics.md](docs/diagnostics.md).

`@mcp-server-forge/importers` provides pure read-only normalization for LM
Studio and generic MCP JSON values. It preserves provenance and confidence,
redacts potential secrets, and produces an explicitly incomplete Forge draft.
See [docs/importers.md](docs/importers.md).

`@mcp-server-forge/templates` defines template manifest version 1,
generated-file ownership, SHA-256 generation state, and pure read-only change
planning. It does not render or write template output. See
[docs/templates.md](docs/templates.md).

`@mcp-server-forge/generators` provides a restricted deterministic renderer and
a complete read-only generation preview over abstract target and previous-state
metadata. It performs no filesystem access or plan application. See
[docs/rendering.md](docs/rendering.md) and
[docs/generation-preview.md](docs/generation-preview.md).

## License

Licensed under the [MIT License](LICENSE).
