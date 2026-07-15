# Cross-platform smoke tests

## Purpose

This procedure verifies that a clean MCP Server Forge checkout can install,
build, test, and run its current CLI workflows without relying on an existing
development environment. It is intentionally operating-system-neutral and should
be repeated on each supported platform.

The smoke test verifies:

- reproducible dependency installation from `pnpm-lock.yaml`;
- repository formatting, lint, type, test, and build checks;
- local execution of the built `validate`, `preview`, and `generate` commands;
- read-only preview behavior and explicit interactive generation confirmation;
- the generated file set and generation state;
- idempotent repeated generation;
- conflict detection after a forge-owned file is manually modified;
- documented diagnostics and process exit codes.
- frozen installation, typecheck, tests, and build of the generated standalone
  project;
- an official MCP client handshake, exact `hello` allowlist and tool call;
- zero generated-server filesystem changes while running.

It is not a release, package publication, exhaustive security audit, performance
benchmark, or compatibility guarantee for every Node.js distribution. The
functional template intentionally contains one example tool rather than a
business server. The CLI package is private and is run locally from the monorepo
build; neither Forge nor the generated server is published to npm.

## Environment

- a clean clone of this repository;
- Node.js 22 or newer;
- pnpm 11.7.0;
- Git;
- an interactive terminal for the confirmed `generate` scenario.

Enable the pnpm version pinned by the repository with Corepack:

```bash
corepack enable
pnpm --version
```

If Corepack is unavailable or unusable, install the pinned version with npm:

```bash
npm install -g pnpm@11.7.0
```

## Prepare and verify the repository

Run every command from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:template-smoke
git diff --check
```

Every command must exit with code `0`. The install must not update the lockfile,
and `git status --short` must remain empty in a clean checkout.

The examples below use `./smoke-target`. Create it as a new empty directory in a
clean checkout with a cross-platform Node.js command:

```bash
node -e "require('node:fs').mkdirSync('./smoke-target', { recursive: true })"
```

Do not reuse a target from an earlier smoke test unless the scenario explicitly
requires it.

## Validate

Run the built CLI against the included valid fixture:

```bash
node apps/cli/dist/index.js validate ./packages/generators/fixtures/valid/basic-config.json
```

Expected result:

- exit code `0`;
- `Configuration is valid.`;
- zero errors and zero warnings;
- no files are written.

## Preview

```bash
node apps/cli/dist/index.js preview --config ./packages/generators/fixtures/valid/basic-config.json --root ./smoke-target --template ./packages/templates/templates/basic-typescript-server
```

Expected result:

- exit code `0`;
- eleven `create` actions and `Safe to apply: yes`;
- no generated file or generation state is written.

The planned project files are `.gitignore`, `README.md`, `mcp-forge.json`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `src/index.ts`,
`src/tools/hello.ts`, `tests/hello.test.ts`, `tsconfig.json`, and
`vitest.config.ts`.

## Generate

Run `generate` directly in an interactive terminal. Do not pipe input into the
command because non-TTY confirmation is intentionally rejected.

```bash
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/basic-config.json --root ./smoke-target --template ./packages/templates/templates/basic-typescript-server
```

At the prompt, enter `yes` and press Enter.

Expected result:

- exit code `0`;
- eleven file changes are reported as applied;
- only the eleven planned project files are created;
- `.mcp-forge/generated-state.json` is created after the project files;
- no unplanned project files are created.

Inspect the state as JSON. It must contain `stateVersion`, the selected template
identity and version, `hashAlgorithm`, `generatedAt`, and one entry for each
managed file. Each generated hash must match the corresponding generated file.

## Repeat generation

Run the same command again, adding `--show-skipped`:

```bash
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/basic-config.json --root ./smoke-target --template ./packages/templates/templates/basic-typescript-server --show-skipped
```

Expected result:

- exit code `0`;
- eleven `skip` actions;
- no confirmation prompt because there are no write operations;
- `No file changes to apply; generation state was not changed.`;
- project file contents and generation state remain unchanged.

## Verify the generated MCP server

Before applying the manual conflict change, enter the generated directory and
verify its pinned standalone project:

```bash
cd smoke-target
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cd ..
```

Run `node ./smoke-target/dist/index.js` through an MCP client rather than
expecting terminal output. The process speaks protocol messages on stdout and
must not emit normal logs there. The client must complete a handshake, list
exactly `hello`, and receive these structured responses:

```json
{ "message": "Hello from your local MCP server!" }
```

```json
{ "message": "Hello, Mirďas!" }
```

Closing the client must stop the child process cleanly and the runtime must not
change project files. The repository command `pnpm test:template-smoke`
automates generation, installation, build, inspection, MCP calls, idempotency,
conflict protection, cleanup, and the no-write comparison. CI runs it on Ubuntu,
macOS, and Windows after the normal workspace build.

This is a local server and its runtime is offline. A first clean installation
still requires registry access unless the exact dependencies are already in the
local pnpm store. No npm publication or `npx` command is involved.

## Detect a manually modified forge-owned file

Modify `src/index.ts` without changing the generation state. This portable
command appends a test marker:

```bash
node -e "require('node:fs').appendFileSync('./smoke-target/src/index.ts', '\n// manual smoke-test change\n')"
```

Run the same `generate` command again.

Expected plan entry:

```text
ACTION    PATH          OWNERSHIP    REASON
conflict  src/index.ts  forge-owned  TARGET_MODIFIED_SINCE_GENERATION
```

Expected diagnostics include:

```text
ERROR PLAN_FILE_CONFLICT
WARNING PLAN_TARGET_MODIFIED
```

Expected result:

- exit code `5`;
- `Safe to apply: no`;
- no confirmation prompt and no filesystem writes;
- the manual modification is preserved;
- generation state remains unchanged.

The three identifiers have different roles: `TARGET_MODIFIED_SINCE_GENERATION`
is the plan reason, `PLAN_FILE_CONFLICT` is the error diagnostic, and
`PLAN_TARGET_MODIFIED` is the warning diagnostic.

## Exit-code check

Record the exit code immediately after each command. POSIX shells expose it as
`$?`; PowerShell exposes it as `$LASTEXITCODE`.

| Scenario                         | Expected code |
| -------------------------------- | ------------- |
| Valid configuration              | `0`           |
| Safe preview                     | `0`           |
| Confirmed initial generation     | `0`           |
| Unchanged repeated generation    | `0`           |
| Modified forge-owned file        | `5`           |
| Refused or unavailable TTY apply | `6`           |

## Recording results

Record the date, operating system and version when known, CPU architecture,
Node.js version, pnpm version, clean source commit, each command and exit code,
test count, observed file list, diagnostics, and final PASS or FAIL. Do not
record usernames, personal absolute paths, environment variables, tokens, or
other secrets. A failure record should include the first unexpected output and
whether the target or generation state changed.

## PASS/FAIL checklist

- [ ] Clean checkout and frozen-lockfile install succeeded.
- [ ] Format, lint, typecheck, tests, build, and diff check passed.
- [ ] Validate returned the expected success result.
- [ ] Preview planned eleven creates and performed no writes.
- [ ] TTY-confirmed generation created only the expected files and state.
- [ ] Repeated generation produced eleven skips and no writes.
- [ ] Manual forge-owned modification produced the expected conflict.
- [ ] Generated project frozen install, typecheck, tests, and build passed.
- [ ] Official MCP client saw only `hello` and both expected responses.
- [ ] Generated server runtime produced no stderr or filesystem writes.
- [ ] Exit codes and diagnostics matched the documented contracts.
- [ ] No unexpected filesystem changes occurred.

Mark the smoke test PASS only when every item is checked. Otherwise mark it FAIL
and retain the failure evidence.
