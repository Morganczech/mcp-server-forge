# MCP Server Forge Development Specification

This specification applies to the entire repository. The key words **MUST**,
**MUST NOT**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are to be interpreted as normative requirements.

## 1. Project Principles

- Contributors and agents MUST prefer extending existing public contracts over
  replacing them.
- Changes MUST remain within the approved task scope.
- Unnecessary refactoring outside the current task MUST NOT be performed.
- Backward compatibility SHALL take precedence over cosmetic code elegance
  unless the user explicitly requests a breaking change.
- Configuration, diagnostics, JSON output, CLI behavior, and versioned manifests
  SHALL be treated as public contracts.
- Functionality outside the approved task scope MUST NOT be implemented.
- New ideas SHOULD be recorded in documentation or proposed as exactly one next
  logical task. They MUST NOT be implemented automatically.

## 2. Architecture

- `packages/schemas` MUST NOT depend on the CLI or integration packages.
- `packages/validators` MAY depend on `packages/schemas`, but `packages/schemas`
  MUST NOT depend on `packages/validators`.
- Pure domain packages MUST NOT access the filesystem, network, child processes,
  shell, current time, or randomness unless the capability is their explicit
  responsibility and is represented by an appropriate boundary.
- Filesystem and client integrations MUST live in dedicated adapters.
- Server configuration SHALL be the single source of truth.
- Project data, server definitions, and template content MUST NOT be hard-coded
  in TypeScript implementations.
- Generated files MUST NOT be edited manually. Changes MUST respect file
  ownership rules and be made through configuration or templates followed by
  regeneration.
- Read-only layers MUST NOT perform hidden writes.
- Lower-level packages MUST NOT introduce reverse dependencies on higher-level
  layers.

## 3. Public Contract Stability

Public contracts include, at minimum:

- CLI commands and flags;
- CLI exit codes;
- JSON output;
- `mcp-forge.json`;
- diagnostic codes;
- the template manifest;
- generation state;
- the import model;
- the renderer contract;
- the generation preview contract.

The following rules apply:

- An existing public diagnostic code MUST NOT be reused with a different
  meaning.
- Existing JSON fields MUST NOT be removed or renamed without a migration.
- New fields SHOULD be backward-compatible and optional where possible.
- Every public contract change MUST be documented.
- Every breaking change MUST be explicitly identified as breaking.
- After version `1.0.0`, a breaking change MUST increment the major version.
- Before version `1.0.0`, a breaking change MUST still be clearly disclosed in
  the changelog.

## 4. Versioning

The project SHALL follow Semantic Versioning using `MAJOR.MINOR.PATCH`:

- `PATCH` SHALL contain bug fixes without new public functionality or breaking
  changes.
- `MINOR` SHALL contain backward-compatible new functionality.
- `MAJOR` SHALL contain breaking changes to public contracts.
- The `0.x` series indicates active development and an unstable public API.
- Version `1.0.0` SHALL be the first stable public release.

The project maintains independently versioned contracts:

- the Forge CLI and package version;
- configuration `schemaVersion`;
- template `manifestVersion`;
- template version;
- generation `stateVersion`;
- future registry metadata version.

These versions MUST NOT be synchronized automatically. In particular:

- Increasing the Forge version MUST NOT automatically change `schemaVersion`.
- `schemaVersion` MUST change only for a genuinely incompatible schema change.
- A `schemaVersion` change MUST include a migration plan or clearly documented
  incompatibility.
- Template versions MUST be exact Semantic Versioning values.
- Generation `stateVersion` MUST change only when its data contract changes.
- Reproducible dependencies and templates MUST NOT use `latest`.
- Agents MUST NOT increment any version automatically.

## 5. Git Workflow

- Before starting work, contributors and agents MUST run `git status`.
- Before editing files, contributors and agents MUST read `README.md`,
  `ROADMAP.md`, `TASKS.md`, and `AGENTS.md`.
- Files outside the requested scope MUST NOT be modified.
- Deleted files MUST NOT be restored without an explicit request.
- One logical change SHOULD form one commit.
- Commit messages SHOULD use concise Conventional Commits syntax.
- A commit MUST NOT be created unless the user requests or explicitly permits
  it.
- A push MUST NOT be performed without an explicit user request.
- History MUST NOT be rewritten, force-pushed, or tags deleted without an
  explicit user request.
- Relevant tests and checks MUST pass before a commit is proposed.
- The final task report MUST state whether the working tree is clean.

## 6. Testing and CI

- Every new public feature MUST have tests.
- Every bug fix SHOULD have a regression test when practical.
- Tests MUST be deterministic.
- Tests MUST NOT depend on real user data, the network, or user home paths.
- Integration tests SHOULD use temporary directories.
- Read-only functionality MUST have a test proving that it performs no writes.
- Security rules MUST be covered by negative tests.
- New public contracts MUST have serialization and validation tests.
- CI MUST remain green.
- Changes to scripts or workspace structure MUST verify that CI still invokes
  the correct commands.
- Tests, assertions, coverage, lint rules, and type checks MUST NOT be weakened
  merely to make a check pass.
- After changes, contributors and agents MUST run the applicable formatting
  check, lint, typecheck, tests, and build.

## 7. Documentation

- Every public feature MUST have corresponding documentation.
- Documentation MUST distinguish implemented functionality from planned
  functionality.
- A placeholder MUST NOT be presented as a functional MCP server.
- README content MUST be transparent about current user-facing capabilities.
- Examples MUST be runnable or clearly identified as designs or placeholders.
- Diagnostic codes, exit codes, and public JSON contracts MUST be documented.
- API changes MUST update the README, the relevant document under `docs/`, and
  `TASKS.md` when applicable.
- `ROADMAP.md` MUST change only when project direction or phase ordering
  genuinely changes.
- `CHANGELOG.md` MUST be updated for changes intended for a release.

## 8. Security

- API keys, tokens, passwords, secrets, and private keys MUST NOT be committed.
- Real secret values MUST NOT appear in fixtures, snapshots, logs, or
  documentation.
- Examples and tests MUST use fictional paths and data.
- Real company or personal data MUST NOT be added.
- Absolute example paths MUST use forms such as `/Users/example/...` or
  `/home/example/...`.
- Write operations MUST require explicit confirmation, a preview, and bounded
  safety constraints.
- Third-party MCP servers MUST NOT be bundled directly into Forge without
  review.
- Public servers SHOULD be installed from their official sources.
- Server licensing and provenance SHALL be transparent when registry or
  distribution functionality is implemented.
- Third-party code MUST NOT be installed or executed without explicit user
  confirmation.

## 9. Release Rules

- A release SHALL always be an explicit user action.
- A tag, GitHub Release, or package publication MUST NOT be created without an
  explicit user request.
- Agents MUST NOT automatically run `git tag`, `git push --tags`,
  `gh release create`, `npm publish`, or `pnpm publish`.
- Package versions MUST NOT be incremented automatically.
- The working tree MUST be clean before release operations begin.
- A release tag MUST match the package version, for example `v0.1.0-alpha.1`.
- A release MUST be reproducible from a clean checkout.
- A release MUST NOT contain uncommitted changes.
- A push MUST NOT be performed without an explicit user request.

### Release Checklist

Before every release, all of the following MUST be verified:

- the working tree is clean;
- the target tag does not already exist locally or remotely;
- package metadata versions match the target tag;
- `CHANGELOG.md` is current;
- the README matches implemented functionality;
- relevant documentation is current;
- the applicable formatting check passes;
- `pnpm lint` passes;
- `pnpm typecheck` passes;
- `pnpm test` passes;
- `pnpm build` passes;
- `git diff --check` passes;
- no secret values are present;
- no unintended personal absolute paths are present;
- CI on the main branch is successful.

Only after explicit user confirmation MAY an agent:

- create a release commit;
- create a tag;
- push a branch;
- push a tag;
- create a GitHub Release;
- publish a package.

## 10. CI Requirements

- CI MUST use read-only repository permissions unless a separately approved
  workflow has a documented need for additional permissions.
- CI MUST install dependencies from the lockfile without updating it.
- CI MUST run formatting, lint, typecheck, test, and build checks.
- CI MUST NOT publish packages, create releases, deploy, push commits, or use
  release secrets.
- CI action dependencies SHOULD use supported stable major versions from their
  official publishers.

## 11. AI Agent Behaviour

An AI agent MUST:

- read `README.md`, `ROADMAP.md`, `TASKS.md`, and `AGENTS.md` before
  implementing changes;
- inspect repository status and actual project tooling before making changes;
- keep changes within the requested scope;
- preserve public contracts and deterministic behavior;
- explain material compromises;
- report changed files, verification results, and working-tree status;
- propose exactly one next logical task.

An AI agent MUST NOT:

- introduce breaking changes without explicit explanation and approval;
- modify unrelated files;
- invent or imply missing functionality;
- silently refactor unrelated code;
- create commits unless requested or explicitly permitted;
- push unless explicitly requested;
- create tags or releases unless explicitly requested;
- publish npm or pnpm packages unless explicitly requested.

## 12. Forbidden Operations

Without an explicit user request and the safeguards required by this
specification, contributors and agents MUST NOT:

- edit generated files manually;
- bypass file ownership or path-boundary rules;
- introduce hidden filesystem writes into read-only workflows;
- execute untrusted third-party code;
- commit secrets or real private data;
- modify unrelated files;
- weaken validation or verification to conceal failures;
- create commits, push changes, rewrite history, force-push, or delete tags;
- create tags, releases, deployments, or package publications.
