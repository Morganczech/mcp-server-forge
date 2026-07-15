# Ubuntu Linux smoke test report

## Scope

This report records a manual cross-platform smoke test of MCP Server Forge. The
project was developed and first verified on macOS, then checked from a clean
GitHub clone on Ubuntu Linux. The exact Ubuntu version was not recorded during
the test, so this report does not infer one.

The CLI was executed locally from the built monorepo. The package is private and
is not published to npm. This report records the earlier four-file placeholder
template smoke test and predates the Phase 5 functional template; current
functional coverage is defined in [smoke-tests.md](smoke-tests.md) and CI.

## Environment

- operating system: Ubuntu Linux, exact version not recorded;
- Node.js: 22.x, satisfying the Node.js 22+ requirement;
- pnpm: 11.7.0;
- source: clean clone from GitHub.

The supported pnpm setup was verified as Corepack where available, with
`npm install -g pnpm@11.7.0` as the alternative for Node.js installations that
do not provide a usable Corepack configuration.

## Repository checks

The following commands were run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Recorded results:

| Check                   | Result                     |
| ----------------------- | -------------------------- |
| Frozen-lockfile install | PASS                       |
| `pnpm format:check`     | PASS                       |
| `pnpm lint`             | PASS                       |
| `pnpm typecheck`        | PASS                       |
| `pnpm test`             | PASS, 234/234 tests passed |
| `pnpm build`            | PASS                       |
| `git diff --check`      | PASS                       |

## CLI workflow

`validate`, `preview`, and `generate` were run against the included valid
configuration fixture and basic TypeScript template using the built entrypoint
at `apps/cli/dist/index.js`.

Recorded results:

- `validate`: PASS;
- `preview`: PASS, with four planned `create` actions and no writes;
- `generate`: PASS after entering `yes` at the interactive TTY prompt;
- four project files were created: `README.md`, `SYSTEM_PROMPT.md`,
  `package.json`, and `src/index.ts`;
- `.mcp-forge/generated-state.json` was created;
- a second generation run produced four `skip` actions;
- no unexpected filesystem modifications were observed.

## Forge-owned file conflict

After successful generation, `src/index.ts` was changed manually and generation
was run again. The plan reported:

```text
ACTION    PATH          OWNERSHIP    REASON
conflict  src/index.ts  forge-owned  TARGET_MODIFIED_SINCE_GENERATION
```

The diagnostics were:

```text
ERROR PLAN_FILE_CONFLICT
WARNING PLAN_TARGET_MODIFIED
```

The command returned exit code `5`. The conflict correctly prevented Forge from
automatically overwriting the manually modified forge-owned file. No new
generation state was written.

## Result

**PASS**

The Ubuntu run confirmed reproducible installation, repository checks, read-only
preview, explicit TTY confirmation, safe generation, state creation, idempotent
repeated generation, and rejection of an unsafe overwrite.
