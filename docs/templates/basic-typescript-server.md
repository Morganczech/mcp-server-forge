# Functional basic TypeScript MCP server

## What it is

`basic-typescript-server@1.1.0` is Forge's first functional generated MCP
project. It is a small local Node.js 22 stdio server with one example tool named
`hello`. It is intended for learning, connection checks, and exercising Forge's
safe generation workflow. It is not a complete business server.

The server runs directly from a local directory. After dependencies are
installed and the project is built, its runtime does not need internet access.
It does not read, write, or delete files, execute shell commands, read
environment secrets, or send data away from the computer.

## Generate it

From the Forge repository root, build Forge and create an empty target:

```bash
pnpm build
node -e "require('node:fs').mkdirSync('./my-local-server', { recursive: true })"
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/basic-config.json --root ./my-local-server --template ./packages/templates/templates/basic-typescript-server
```

Review the preview and enter `yes` in the interactive terminal. Forge writes the
eleven planned files and then writes generation state last.

## Generated files

```text
my-local-server/
├── src/
│   ├── index.ts
│   └── tools/
│       └── hello.ts
├── tests/
│   └── hello.test.ts
├── .gitignore
├── mcp-forge.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── README.md
├── tsconfig.json
└── vitest.config.ts
```

Forge owns the complete content of the TypeScript, JSON, YAML, and test files
under `replace-if-unmodified`. `.gitignore` is user-owned and created once.
README is shared and contains Forge-managed markers. Because marker merging is
not implemented yet, editing the managed README section can require manual
review on a future regeneration.

## Install and verify

```bash
cd my-local-server
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Runtime dependencies are exactly:

- `@modelcontextprotocol/sdk@1.29.0`;
- `zod@3.25.76`.

Development dependencies are exactly:

- `@types/node@22.16.4`;
- `typescript@5.8.3`;
- `vitest@3.2.4`.

The generated `pnpm-lock.yaml` pins transitive resolution. `pnpm-workspace.yaml`
explicitly permits the required local esbuild install step on pnpm 11 without
adding application runtime authority.

### Maintaining the generated lockfile

Template maintainers must update `package.json.hbs` and `pnpm-lock.yaml.hbs`
together. Use pnpm 11.7.0, generate the template into a temporary directory, and
run `pnpm install --lockfile-only --no-frozen-lockfile` there. Review the
resulting lockfile before copying it back to the template, remove the temporary
project, and run `pnpm test:template-smoke`. The smoke test uses
`pnpm install --frozen-lockfile`, so CI rejects a stale template lockfile.

## Start and connect

`pnpm start` runs `node dist/index.js`. The process speaks MCP over standard
input and output, so launch it from LM Studio or another stdio-capable MCP
client with values equivalent to:

```json
{
  "command": "/path/to/node",
  "args": ["/path/to/my-local-server/dist/index.js"]
}
```

Replace both paths with real absolute local paths. `npx` is not needed, the
server is not published to npm, and no npm account is required.

## The `hello` tool

The only tool accepts an optional trimmed `name` of at most 80 characters. With
no input it returns:

```json
{ "message": "Hello from your local MCP server!" }
```

With `{ "name": "Mirďas" }` it returns:

```json
{ "message": "Hello, Mirďas!" }
```

The output is deterministic, bounded, read-only, and side-effect free. The tool
does not accept paths, URLs, commands, code, or arbitrary JSON payloads.

## Local and offline boundaries

- **Local server:** Node.js starts `dist/index.js` directly from this project.
- **Offline runtime:** the running `hello` server makes no network requests.
- **Offline installation:** installation works without internet only when every
  pinned package already exists in the local pnpm store.
- **Published npm/npx server:** this template is private and has no published
  package or `npx` workflow.

## Inspect with Forge

From the Forge repository root, use the generated configuration and state:

```bash
node apps/cli/dist/index.js inspect --config ./my-local-server/mcp-forge.json --root ./my-local-server --template ./packages/templates/templates/basic-typescript-server
node apps/cli/dist/index.js inspect --config ./my-local-server/mcp-forge.json --root ./my-local-server --template ./packages/templates/templates/basic-typescript-server --json
```

A new generated project is healthy, has eleven current tracked files, denies
filesystem, network, and shell permissions, and produces an idempotent preview.
The same facts are available through the read-only Forge MCP tools after an
operator explicitly registers the project and template in the local catalog.

## Known limitations

- only one example tool is implemented;
- Forge does not add or configure new tools yet;
- there is no registry, marketplace, npm publication, `npx` distribution, AI
  provider, file access, network access, database, or client configuration
  writer;
- runtime safety is represented by the generated code and configuration, not an
  operating-system sandbox.
