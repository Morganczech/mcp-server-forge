# Filesystem generation

`applyGenerationWorkspace` in `@mcp-server-forge/fs-adapter` executes a
validated Apply Contract under an explicit absolute project root. It does not
render, plan, approve replacements, resolve conflicts, or invent operations.

Before the first write it validates the contract, confines every portable path,
rejects symlinked or unsupported parents, reloads all managed targets and the
generation state, and compares them with contract preconditions. Each target is
checked again immediately before its operation. Rendered content and serialized
state must also remain within the adapter's configured bounded file-size limit.

Generated content is first synced to a same-directory temporary regular file.
Creates use an exclusive hard-link operation; replacements use rename. File
executable bits follow the contract while other existing mode bits are
preserved. Generation state is formatted as JSON with a final newline and is
written only after every file succeeds.

The executor reports path-sorted diagnostics, files completed before a failure,
and whether state was written. Individual file replacement is atomic, but a
multi-file apply is not a transaction. If a later write fails, earlier files may
remain changed and state is not updated.

Deletion, rollback, shared-file merge, standalone empty directories, directory
symlinks, and automatic conflict repair are not implemented.
