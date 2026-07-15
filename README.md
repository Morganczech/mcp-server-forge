# mcp-server-forge

`mcp-server-forge` is an early-stage toolkit for designing, generating,
validating, and documenting standard Model Context Protocol (MCP) servers. Its
CLI can validate, inspect, preview, interactively apply a safe generation plan,
open an experimental read-only terminal interface, and expose bounded project
facts through a minimal read-only MCP server.

The repository contains project infrastructure, validation/import contracts,
template ownership rules, and pure in-memory placeholder rendering. It does not
yet generate a functional MCP SDK server.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.7.0

The preferred pnpm setup uses Corepack:

```bash
corepack enable
pnpm --version
```

The repository's `packageManager` field pins pnpm 11.7.0. If the Node.js
installation does not provide a usable Corepack setup, install that version with
npm instead:

```bash
npm install -g pnpm@11.7.0
```

For an installation that does not require a system-wide global directory:

```bash
npm install -g pnpm@11.7.0 --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

Run the following commands from the root of a clean clone.

### Install

```bash
pnpm install --frozen-lockfile
```

### Build

```bash
pnpm build
```

### Test

Run the same verification suite used by the project:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

### Validate

Validate the included example configuration:

```bash
node apps/cli/dist/index.js validate ./packages/generators/fixtures/valid/basic-config.json
```

### Preview

Create an empty target directory, then inspect a generation plan. Preview is
read-only and does not write generated files or generation state.

```bash
node -e "require('node:fs').mkdirSync('./target-project', { recursive: true })"
node apps/cli/dist/index.js preview --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server
```

### Inspect

Inspect project health, configured permissions, generation state, managed files,
and diagnostics without writing. Add `--template` for a complete current
generation preview inside the inspection.

```bash
node apps/cli/dist/index.js inspect --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server
node apps/cli/dist/index.js inspect --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --json
```

### Experimental TUI

From an interactive terminal, open the read-only terminal interface:

```bash
node apps/cli/dist/index.js tui --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server
```

The TUI can refresh and display inspection or preview information. It cannot
apply plans, delete files, change permissions or configuration, install
dependencies, or run shell commands. In automation or redirected terminals use
`mcp-forge inspect --json` instead.

### Generate

Generate always creates a fresh preview before asking for confirmation. It
writes only from an interactive terminal and only after the answer `y` or `yes`:

```bash
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server
```

### Read-only MCP server

Create an explicit project catalog as described in
[docs/mcp-interface.md](docs/mcp-interface.md), then start the local stdio
server:

```bash
MCP_FORGE_CATALOG=./forge-projects.json node apps/mcp-server/dist/index.js
```

The seven MCP tools can inspect registered projects, permissions, tracked files,
diagnostics, and fresh previews. They cannot generate, apply, approve, write,
delete, install, or execute anything, and the server never scans for projects.

The generated TypeScript project is currently placeholder output, not yet a
functional MCP SDK server. The package is also private and is not published to
npm. The reserved installed command forms are:

```bash
mcp-forge validate ./mcp-forge.json
mcp-forge inspect --root ./project --json
mcp-forge preview --root ./project --template ./template
mcp-forge generate --root ./project --template ./template
mcp-forge tui --root ./project --template ./template
```

See [docs/cli.md](docs/cli.md), [docs/cli-preview.md](docs/cli-preview.md), and
[docs/cli-generate.md](docs/cli-generate.md) for command contracts, output, and
exit codes.

For repeatable end-to-end verification, see the
[general smoke test procedure](docs/testing/smoke-tests.md) and the recorded
[Ubuntu smoke test](docs/testing/linux-ubuntu.md).

## Repository layout

```text
apps/
  cli/          Validation, inspection, TUI, preview, and generation workflows
  mcp-server/   Minimal read-only stdio interface to registered Forge projects
packages/
  core/         Pure inspection, change-plan, and apply contracts
  engine/       Shared read-only project inspection and preview orchestration
  schemas/      Zod schemas for configuration contracts
  generators/   Future code and documentation generators
  fs-adapter/    Bounded filesystem inspection and apply execution
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

The current workspace version is `v0.1.0-alpha.2`. It supports configuration
validation, safe import normalization, deterministic in-memory rendering,
bounded filesystem inspection, complete read-only generation previews,
structured project inspection, an experimental read-only TUI, and confirmed
filesystem application. The separate Forge MCP interface exposes only read-only
project facts; generated projects still are not functional MCP SDK servers.

Public APIs and configuration formats may change during the alpha series. The
first version of the configuration contract is documented in
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

`@mcp-server-forge/core` converts a safe preview into a pure, validated Apply
Contract and next generation state without filesystem access. It also exposes
pure Project Inspection and Project Change Plan contracts. See
[docs/apply-contract.md](docs/apply-contract.md) and the
[engine and TUI architecture](docs/architecture/forge-engine-and-tui.md).

`@mcp-server-forge/engine` composes validation and bounded filesystem evidence
into the same inspection and preview contracts for the CLI and MCP transport.
`apps/mcp-server` registers an exact seven-tool read-only allowlist over that
service. See [docs/mcp-interface.md](docs/mcp-interface.md).

`@mcp-server-forge/fs-adapter` safely converts explicit project and template
directories into abstract target metadata, optional validated generation state,
and bounded in-memory template sources. Its separate executor revalidates Apply
Contract preconditions and performs confirmed atomic-per-file writes. See
[docs/filesystem-adapter.md](docs/filesystem-adapter.md).

Release history and current limitations are recorded in
[CHANGELOG.md](CHANGELOG.md).

## License

Licensed under the [MIT License](LICENSE).
