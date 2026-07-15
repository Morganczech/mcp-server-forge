# Capability composition

Capabilities add reviewed, reusable behavior to a base template while keeping
one safe generation workflow. The first implemented example composes an offline
contacts server from:

```text
Basic server
+ local data
+ contact reading
= offline contacts server
```

- `basic-typescript-server`: the standalone TypeScript MCP project;
- `local-json-data`: a bounded JSON loader and user-owned sample data;
- `contacts-read`: `list_contacts`, `search_contacts`, and `get_contact`.

The base `hello` tool remains available, so the generated server exposes exactly
`get_contact`, `hello`, `list_contacts`, and `search_contacts`.

## Generate the example

From the repository root after `pnpm build`:

```bash
node -e "require('node:fs').mkdirSync('./contacts-target', { recursive: true })"
node apps/cli/dist/index.js preview --config ./packages/generators/fixtures/valid/contacts-config.json --root ./contacts-target --template ./packages/templates/templates/basic-typescript-server --capability-root ./packages/capabilities/capabilities
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/contacts-config.json --root ./contacts-target --template ./packages/templates/templates/basic-typescript-server --capability-root ./packages/capabilities/capabilities
```

`generate` still requires an interactive TTY and only `y` or `yes` confirms the
fresh plan. The capability root selects local reviewed bundles; it is not a
registry and Forge performs no download or capability code execution.

Then verify the generated project:

```bash
cd contacts-target
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The first dependency installation may require registry access. After build, the
server runtime is local and uses no network, shell, environment variables,
secrets, or file writes.

Capability dependency declarations must match exact packages already present in
the selected template's lockfile. Forge does not invent package resolutions or
silently rewrite a lockfile; an absent or different version fails composition.

## Edit the contacts

Edit `data/contacts.json` in the generated project. The file contains fictional
sample values and is `user-owned` with `create-once` update policy. Subsequent
generation preserves it byte-for-byte. Each record has an `id`, `name`, `email`,
`phone`, and `tags` array; duplicate IDs or invalid data are rejected at runtime
with structured errors.

The loader reads only `data/contacts.json`, rejects symlinks and oversized or
invalid input, and returns bounded results. The three contacts tools cannot
modify data. Listing and search return at most 20 contacts per call so the
largest valid response remains below the configured response boundary. Search is
a bounded case-insensitive substring match, not fuzzy or remote directory
search.

## Composition safety

Preview fails closed before rendering when a capability is unknown, duplicated,
missing a dependency, cyclic, incompatible with the template, or collides on a
file, tool, dependency version, or permission. Removing a capability reports its
tracked files as orphaned. Forge preserves the files and blocks apply; no
automatic cleanup or purge is implemented.

For the manifest and package boundaries, see the
[architecture decision](architecture/capability-composition.md). For a complete
walkthrough, see the
[offline contacts example](examples/offline-contacts-server.md).
