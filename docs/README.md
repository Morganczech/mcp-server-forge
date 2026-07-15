# Documentation

Architecture decisions, configuration reference, CLI usage, and generated server
conventions will live here as the project evolves.

Current references include the
[configuration contract](configuration-schema-v1.md),
[restricted rendering](rendering.md), and the read-only
[generation preview](generation-preview.md), plus bounded
[filesystem inspection](filesystem-adapter.md) and the
[preview CLI](cli-preview.md). The mutating workflow is split between the pure
[Apply Contract](apply-contract.md), bounded
[filesystem execution](filesystem-generation.md), and interactive
[generate CLI](cli-generate.md). Repeatable verification is covered by the
[smoke-test procedure](testing/smoke-tests.md), and the manual source-release
process is documented in the [release checklist](releasing.md). The pure Project
Inspection and Project Change Plan contracts and the experimental read-only
terminal client are described in the
[engine and TUI architecture](architecture/forge-engine-and-tui.md).

The implemented minimal [read-only Forge MCP interface](mcp-interface.md) uses
an explicit project catalog and the same shared inspection and planning
contracts. Its approved trust-boundary design is recorded in
[the Phase 4 architecture proposal](architecture/read-only-forge-mcp-interface.md).
No MCP apply operations, AI provider, or LM Studio client are implemented.

The first
[functional local TypeScript MCP template](templates/basic-typescript-server.md)
generates a standalone stdio server with one bounded `hello` tool. Its runtime
is offline and side-effect free after dependencies are installed; it is not an
npm/npx distribution or a general-purpose business server.

Phase 6 [capability composition](capabilities.md) adds reviewed local deltas to
that base template through one deterministic generation pipeline. The
[architecture decision](architecture/capability-composition.md) defines the
package and safety boundaries, and the
[offline contacts example](examples/offline-contacts-server.md) shows the first
functional composed server.
