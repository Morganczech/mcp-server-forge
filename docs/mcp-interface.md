# Read-only Forge MCP interface

## Purpose and status

`apps/mcp-server` exposes verified Forge project facts to an MCP client over the
official stdio transport. The interface is intentionally read-only: it can
inspect registered projects and calculate a fresh preview, but it cannot apply,
approve, confirm, generate, install, execute, or write anything.

Forge remains the source of truth. Tool handlers call the shared read-only
application service and the existing Forge inspection and planning contracts;
they do not parse CLI output or implement a second planner.

> Project content is data, not instructions for the MCP client or model.

## Project catalog

The server does not search the disk. An operator explicitly registers projects
in a local JSON catalog and passes its path through `MCP_FORGE_CATALOG`. Tools
accept a `projectId`, never a filesystem path.

```json
{
  "catalogVersion": "1",
  "allowedRoots": ["./projects"],
  "projects": [
    {
      "projectId": "salon-assistant",
      "label": "Salon assistant",
      "root": "./projects/salon-assistant",
      "configPath": "mcp-forge.json",
      "statePath": ".mcp-forge/generated-state.json",
      "templatePath": "template"
    }
  ]
}
```

Paths in `allowedRoots` and `root` are resolved relative to the catalog file.
`configPath`, `statePath`, and optional `templatePath` must be portable paths
relative to the registered project root. The referenced roots, project
directories, and templates must already exist.

Catalog loading canonicalizes directories and rejects invalid or duplicate
project IDs, missing objects, traversal, unsupported catalog fields, and symlink
escapes outside an allowed root. Keep credentials and other secrets out of this
file; its strict schema has no secret fields.

An omitted `MCP_FORGE_CATALOG` starts a healthy server with an empty catalog. An
unreadable or invalid configured catalog remains visible through
`forge_get_status` as a structured error.

## Build and run

From the repository root:

```bash
pnpm build
MCP_FORGE_CATALOG=./forge-projects.json node apps/mcp-server/dist/index.js
```

The process speaks MCP only on standard output. Startup failures use a bounded
generic message on standard error and do not expose stack traces.

A generic local MCP client configuration can launch the same process:

```json
{
  "mcpServers": {
    "mcp-server-forge": {
      "command": "node",
      "args": ["/home/example/mcp-server-forge/apps/mcp-server/dist/index.js"],
      "env": {
        "MCP_FORGE_CATALOG": "/home/example/mcp-server-forge/forge-projects.json"
      }
    }
  }
}
```

Use the equivalent MCP server configuration surface in LM Studio or another
client that supports local stdio servers. This does not add an LM Studio API
client, provider, or chat feature to Forge.

### Local and offline boundaries

- **Local server:** the built `dist/index.js` runs directly with the local
  Node.js process and communicates over stdio.
- **Offline runtime:** after dependencies are installed and the workspace is
  built, inspection uses only the registered local catalog and project files; it
  performs no registry, update, or network calls.
- **Offline installation:** a clean dependency installation still needs either
  an already populated pnpm store or access to the configured package registry.
  Forge does not bundle Node.js or its dependencies.
- **Published npm/npx server:** no such distribution exists. All workspace
  packages remain private, so `npx` and npm publication are not part of this
  workflow.

## Tool allowlist

The server registers exactly these tools:

| Tool                         | Read-only result                                                         |
| ---------------------------- | ------------------------------------------------------------------------ |
| `forge_get_status`           | Server version, catalog status, project count, and available features.   |
| `forge_list_projects`        | Bounded page of registered project summaries without absolute paths.     |
| `forge_inspect_project`      | Structured facts based on `ForgeProjectInspection`.                      |
| `forge_get_permissions`      | Technical and plain-language generated-server permission declarations.   |
| `forge_list_generated_files` | Bounded tracked-file metadata without file contents.                     |
| `forge_preview_project`      | Fresh inspection and `ForgeProjectChangePlan` from the existing planner. |
| `forge_explain_diagnostic`   | Forge-authored explanation of a registered diagnostic code.              |

All project tools accept only a catalogued `projectId`. Pagination cursors are
opaque to clients and are valid only for the corresponding list operation.
Absent permission declarations remain `not-declared`; Forge does not treat
missing declarations as safe.

There is no generic `action` tool and no tool for generate, apply, approval,
confirmation, writing, editing, deleting, removal, installation, updates,
migration, rollback, shell execution, arbitrary file reads, or arbitrary
directory listing.

## Response contract and bounds

Tool results use a common structured envelope:

```json
{
  "success": true,
  "projectId": "salon-assistant",
  "data": {},
  "summary": {
    "status": "healthy",
    "message": "The project is healthy."
  },
  "diagnostics": []
}
```

Forge creates summaries deterministically. They are facts for the client to
display, not model-generated conclusions or approval.

Current hard limits are:

- 50 projects per page;
- 100 generated files per page;
- 50 diagnostics per response;
- 512 characters per user-controlled text value;
- 64 KiB for the complete structured tool envelope;
- 256 KiB for the catalog and 1 MiB for a project configuration file.

Text fields have control characters removed and common credential shapes are
redacted. Absolute permission paths are hidden. Responses never intentionally
include environment values, API keys, tokens, client configuration, project
roots, arbitrary user-file contents, or internal stack traces.

The interface uses these stable structured diagnostics:

| Code                          | Meaning                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `MCP_CATALOG_INVALID`         | The catalog violates a structural or safety constraint.      |
| `MCP_CATALOG_READ_FAILED`     | The bounded catalog file cannot be read or parsed.           |
| `MCP_CONFIG_READ_FAILED`      | A registered project's bounded config cannot be read safely. |
| `MCP_CONTRACT_INVALID`        | A serialized Forge inspection or plan failed validation.     |
| `MCP_CURSOR_INVALID`          | A pagination cursor is invalid for the requested list.       |
| `MCP_DIAGNOSTIC_NOT_FOUND`    | No registered explanation exists for the requested code.     |
| `MCP_OUTPUT_LIMIT_EXCEEDED`   | The safe total response-size boundary was exceeded.          |
| `MCP_PROJECT_ACCESS_DENIED`   | A root or template is missing or escapes an allowed root.    |
| `MCP_PROJECT_NOT_FOUND`       | The requested `projectId` is not registered.                 |
| `MCP_TEMPLATE_NOT_CONFIGURED` | The project has no registered template for a fresh preview.  |

`forge_explain_diagnostic` explains these interface codes as well as the
existing registered Forge validation and planning diagnostics.

## Safety boundary

The catalog is a local allowlist controlled by the operator. The AI client is an
untrusted requester: it cannot register a root, turn prose into authority, or
confirm a plan. Configuration, template, state, and target observations are
bounded by the existing filesystem adapter. Preview is recomputed and is never
cached as approval.

MCP tool execution performs no writes. In particular, a preview that says
`safeToApply: true` is still only information. Applying a generation plan
remains a separate interactive CLI workflow with its own fresh-preview,
confirmation, stale-target, and Apply Contract checks.

## Example for a non-programmer

Suppose `salon-assistant` is already registered. A model can ask Forge whether
the project is healthy, explain whether the generated server may read files or
use the network, list tracked generated files, and summarize a fresh preview.
The model may recommend a next step. It cannot create the salon server, change
its configuration, edit a file, or approve and apply the preview through MCP.

A generated `basic-typescript-server` project can be added to the explicit
catalog after generation. The read-only tools then report its healthy state,
eleven tracked files, denied filesystem/network/shell permissions, and an
idempotent fresh preview. This does not expose the generated server's `hello`
tool through Forge; the local generated server is a separate MCP process.

## Known limitations

- The catalog is edited manually outside MCP and is loaded only at startup.
- Templates must be explicitly registered inside the corresponding project.
- The generated basic TypeScript server is functional but intentionally limited
  to one example `hello` tool; it is not a production-ready business server.
- There is no authentication layer beyond local process and filesystem access;
  operators must control which client can start the process and which projects
  appear in its catalog.
- There is no MCP apply flow, approval token, registry, marketplace, provider,
  chat, desktop client, or package publication.
