# Apply Contract

`@mcp-server-forge/core` is the pure boundary between generation decisions and
filesystem execution. `createForgeApplyContract` accepts a render result, its
authoritative manifest, a safe generation preview, optional previous state, and
an explicitly supplied ISO timestamp. It performs no filesystem, environment,
clock, network, or process access.

The JSON-serializable version 1 contract contains path-sorted `create` and
`replace` operations, exact rendered content and SHA-256 hashes, expected target
preconditions, the observed previous state, and the next generation state.
`skip` decisions never become write operations.

Contracts are rejected when the preview is unsafe, contains orphans or manual
review, disagrees with rendered output or template identity, has invalid hashes,
or declares a standalone directory not implied by a rendered file path. A
matching target without previous state is deliberately not adopted into state.

`validateForgeApplyContract` validates an untrusted serialized contract without
executing it. A valid contract is an authorization input, not proof that the
filesystem is unchanged; executors must check every precondition again. The
validator also rejects unsorted or nested operation paths and state entries that
are backed by neither a write operation nor unchanged previous state.
