# Tasks

## Current milestone: foundation

- [x] Create the pnpm workspace structure.
- [x] Configure TypeScript, ESLint, Prettier, and Vitest.
- [x] Add initial repository documentation and contribution rules.
- [x] Specify the versioned server configuration contract in `docs/`.
- [x] Expand `packages/schemas` from the minimal bootstrap schema based on that
      specification.
- [x] Add valid and invalid configuration fixtures.

## Later

- [x] Design validator diagnostics.
- [x] Implement the read-only `mcp-forge validate` CLI command.
- [x] Define importer boundaries and implement read-only LM Studio and generic
      MCP JSON normalization.
- [x] Design the template manifest and generated-file ownership rules.
- [x] Implement the pure in-memory renderer contract for placeholder templates.
- [x] Connect rendered output to deterministic, read-only generation preview
      planning over abstract target and previous state.
- [ ] Implement filesystem generation only after rendering and planning are
      reviewed together.
- [ ] Implement additional CLI commands after their underlying workflows exist.
- [ ] Implement the forge MCP server.
