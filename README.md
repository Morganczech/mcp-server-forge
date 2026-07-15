# mcp-server-forge

`mcp-server-forge` is an early-stage toolkit for designing, generating,
validating, and documenting standard Model Context Protocol (MCP) servers. Its
CLI can validate, inspect, preview, interactively apply a safe generation plan,
open an experimental read-only terminal interface, and expose bounded project
facts through a minimal read-only MCP server.

The repository contains project infrastructure, validation/import contracts,
template ownership rules, safe generation, one functional local MCP server
template, and deterministic composition of reviewed local capabilities.

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

To generate the offline contacts example, select its local capability bundles
explicitly:

```bash
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/contacts-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server --capability-root ./packages/capabilities/capabilities
```

It adds bounded read-only `list_contacts`, `search_contacts`, and `get_contact`
tools while preserving `data/contacts.json` as user-owned data. See the
[capability guide](docs/capabilities.md).

After confirming generation, install and run the standalone local server:

```bash
cd target-project
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The generated server uses stdio and is launched by an MCP client with the local
Node.js executable and the absolute path to `target-project/dist/index.js`. It
is not published to npm and does not require `npx`. Its runtime does not use the
filesystem, network, shell, environment variables, or secrets. A first
dependency installation can still require registry access unless the local pnpm
store already contains every pinned dependency. See the
[basic TypeScript server guide](docs/templates/basic-typescript-server.md).

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

The Forge workspace packages remain private and are not published to npm. The
reserved installed command forms are:

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
  capabilities/ Reviewed capability manifests, pure composition, and local assets
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
structured project inspection, an experimental read-only TUI, confirmed
filesystem application, and deterministic local capability composition. The
separate Forge MCP interface exposes only read-only project facts. The
`basic-typescript-server` template produces a functional local stdio MCP server
with one bounded `hello` tool; the optional contacts capabilities demonstrate
bounded local JSON reads without turning the example into a production CRM.

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

`@mcp-server-forge/capabilities` validates reviewed local capability manifests
and resolves compatible files, exact dependencies, tools, and permission
requirements into one composed template input. It performs no filesystem access
or code execution. See [docs/capabilities.md](docs/capabilities.md) and the
[composition architecture](docs/architecture/capability-composition.md).

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
