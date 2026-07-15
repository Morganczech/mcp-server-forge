# Roadmap

## Phase 1 — Foundation

- Establish the pnpm workspace and package boundaries.
- Define contribution, testing, and formatting conventions.
- Design and document the versioned server configuration contract.

## Phase 2 — Validation and import

- Validate server configuration with actionable diagnostics.
- Import a supported subset of existing MCP server metadata.
- Add configuration fixtures and compatibility tests.

## Phase 3 — Generation

- Define a deterministic template contract.
- Generate a standard TypeScript MCP server from configuration.
- Validate generated output and document regeneration workflows.

## Phase 4 — Read-only Forge MCP interface and trust boundary

- Expose Project Inspection and Project Change Plan facts through an explicitly
  registered, read-only project catalog.
- Define the user, untrusted AI client, MCP interface, and Forge Engine trust
  boundaries.
- Enforce bounded output, stable diagnostics, path confinement, and zero write
  side effects.
- Keep apply, approval, installation, external registries, and AI providers out
  of the MCP interface.

The initial local stdio interface, catalog, seven-tool allowlist, shared
read-only application service, and security test coverage are implemented.
Broader clients and any mutating workflow remain outside this phase.

## Phase 5 — Functional local offline MCP template

- Replace the basic placeholder with one standalone TypeScript MCP server.
- Generate pinned installation metadata, tests, build configuration, and local
  stdio client instructions.
- Verify generation, installation, build, inspection, MCP handshake, the bounded
  `hello` tool, conflict protection, and zero runtime writes.

The first functional template is implemented. It runs locally without network,
filesystem, shell, environment, or secret access after dependencies are
installed. It intentionally provides only one example tool; additional
capabilities and production templates remain future work.

Dates and release commitments will be added after the configuration contract has
been validated with representative examples.
