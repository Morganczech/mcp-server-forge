# Contributing

Thank you for helping build `mcp-server-forge`.

## Before making changes

Read `README.md`, `ROADMAP.md`, `TASKS.md`, and `AGENTS.md`. Keep each change
focused on one task and preserve the package boundaries described in the root
README.

## Development workflow

1. Install dependencies with `pnpm install`.
2. Make a focused change.
3. Add or update tests for observable behavior.
4. Run the required checks:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

5. Run `pnpm format:check` before opening a pull request.

Do not hand-edit generated files. Once generation exists, contributions must
change the relevant configuration or template and regenerate the output.

## Pull requests

Describe what changed, why it changed, how it was tested, and any known
limitations. Avoid unrelated refactoring and keep public API changes explicit.

## Reporting issues

Include a minimal reproduction, expected and actual behavior, Node.js and pnpm
versions, and relevant command output. Never include credentials or private
configuration.
