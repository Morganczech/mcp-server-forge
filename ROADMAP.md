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

## Phase 4 — Product interfaces

- Build the CLI workflow around pure inspection, planning, and apply contracts.
- Establish a read-only terminal interface before adding remote clients.
- Expose selected forge capabilities through an MCP server.
- Publish end-to-end examples and reference documentation.

Dates and release commitments will be added after the configuration contract has
been validated with representative examples.
