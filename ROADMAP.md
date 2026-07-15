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

Dates and release commitments will be added after the configuration contract has
been validated with representative examples.
