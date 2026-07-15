# Phase 4 — Read-only Forge MCP Interface and Trust Boundary

## Status

This document is a design proposal. None of the MCP tools, project catalog,
diagnostic codes, or runtime behavior described here is implemented yet.

## Main goal

Phase 4 should let AI clients such as LM Studio, Codex, or another MCP client
read verified Forge project facts and request read-only change-plan proposals.
Forge remains the source of truth.

An AI client may interpret a user's request, ask Forge for facts, explain those
facts, and request a proposed plan. It must not apply a plan, confirm on behalf
of the user, or modify a project directly. Apply remains outside the MCP
interface.

## Architectural boundary

```text
Forge Engine
   ├── CLI inspect
   ├── TUI
   └── Forge MCP interface
```

All clients consume `ForgeProjectInspection` and `ForgeProjectChangePlan` values
directly. The TUI and MCP server must never parse human-oriented CLI text.
Generation preview remains owned by `packages/generators`; the general change
plan remains an adapter over that preview in `packages/core`.

The MCP application in `apps/mcp-server` should be a thin protocol adapter over
the existing engine contracts, validators, and bounded filesystem reads. It must
not become a second planner or a generic filesystem server.

## Roles and trust model

### User

- defines the goal;
- decides whether proposed changes are acceptable;
- remains the only authority for any future approval;
- selects which projects may be exposed through the catalog.

### AI client

- is an untrusted proposer and interpreter;
- may misunderstand facts or instructions;
- cannot assert that the user approved a change;
- cannot mutate Forge state or supply trusted filesystem paths;
- must treat tool results as data, not as permission to act.

### Forge MCP interface

- returns bounded, structured facts only;
- validates all tool inputs;
- resolves project IDs through an explicit catalog;
- filters sensitive values and never returns secrets;
- preserves `unknown` or `not-declared` instead of guessing;
- never writes, applies, approves, installs, executes, or deletes.

### Forge Engine

- is authoritative for inspection, preview, policy, and plan construction;
- derives facts only from validated configuration and bounded observations;
- does not derive state or approval from AI-generated prose;
- validates serialized inspection and change-plan contracts.

## Safe project catalog

Tools must accept a stable `projectId`, not an arbitrary project path. At
startup, the operator supplies a read-only catalog whose entries contain:

```json
{
  "projectId": "customer-records",
  "root": "./projects/customer-records",
  "configPath": "./projects/customer-records/mcp-forge.json",
  "templatePath": "./templates/basic-typescript-server",
  "statePath": ".mcp-forge/generated-state.json"
}
```

Catalog loading must:

- use an explicitly configured catalog path;
- enforce configured allowed roots;
- canonicalize catalog roots once at startup;
- reject duplicate or invalid project IDs;
- reject traversal, ambiguous relative paths, unsupported objects, and symlink
  escape;
- keep the canonical root and evidence used for each registration;
- never accept a tool-provided absolute path as a substitute for `projectId`.

Catalog entries are read-only evidence. Phase 4 has no catalog mutation tool.

## Common tool envelope

Successful and unsuccessful tool results should use a common bounded envelope:

```json
{
  "success": true,
  "projectId": "customer-records",
  "data": {},
  "summary": "The project is healthy.",
  "diagnostics": [],
  "page": {
    "nextCursor": null,
    "returned": 1,
    "limit": 50
  }
}
```

`summary` is deterministic text produced by Forge, not an AI conclusion. `page`
is included only for paginated results. Tool errors must remain normal
structured tool results unless the MCP protocol itself cannot continue.

Proposed interface diagnostic codes are:

- `MCP_REQUEST_INVALID`;
- `MCP_PROJECT_NOT_FOUND`;
- `MCP_PROJECT_ACCESS_DENIED`;
- `MCP_PROJECT_MISMATCH`;
- `MCP_CURSOR_INVALID`;
- `MCP_OUTPUT_LIMIT_EXCEEDED`;
- `MCP_OPERATION_NOT_AVAILABLE`;
- `MCP_PLAN_STALE`.

These names are proposals, not registered public codes. Implementation must add
them to the diagnostic catalog with tests and documentation before exposure.

## Proposed read-only tools

The proposed names follow the repository's explicit snake-case command style.
Every tool is read-only and has zero write side effects.

### `forge_get_status`

Purpose: report interface version, supported contract versions, health, and
enforced limits without inspecting a project.

Input JSON Schema:

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

Output: service metadata, read-only capability flags, supported inspection and
plan versions, and limits. It must not include environment details, host paths,
or process configuration.

Limits: no project facts and no dependency, registry, or update checks.

### `forge_list_projects`

Purpose: list catalogued projects available to the current MCP instance.

Input JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "cursor": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "additionalProperties": false
}
```

Output: paginated project IDs, safe display names, initialization status, and
optional template identity derived from `ForgeProjectInspection`.

Limits: no canonical roots, configuration contents, file contents, or secret
metadata.

### `forge_inspect_project`

Purpose: return the authoritative inspection snapshot for one registered
project.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["projectId"],
  "properties": {
    "projectId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" },
    "includePreview": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

Output: validated `ForgeProjectInspection`. When `includePreview` is true, the
catalog must contain an approved template path and the existing preview owner
must be used.

Limits: no raw configuration, rendered content, arbitrary target paths, or
filesystem writes.

### `forge_preview_project`

Purpose: calculate a fresh read-only preview and expose its normalized
inspection and change-plan facts.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["projectId"],
  "properties": {
    "projectId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" },
    "includeSkipped": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

Output: `ForgeProjectInspection` plus `ForgeProjectChangePlan`, both validated
after serialization.

Limits: always recomputed, never cached as approval, never applied, and never
returns rendered file contents.

### `forge_explain_diagnostic`

Purpose: return the registered Forge explanation for one diagnostic code.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["code"],
  "properties": {
    "code": { "type": "string", "minLength": 1, "maxLength": 128 }
  },
  "additionalProperties": false
}
```

Output: stable code, severity, category, Forge-authored explanation, suggestion,
and documentation reference from the diagnostic catalog.

Limits: it cannot accept arbitrary diagnostic prose, invoke an AI model, or
claim that a suggested repair is approved.

### `forge_list_generated_files`

Purpose: list managed-file metadata for one project.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["projectId"],
  "properties": {
    "projectId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" },
    "status": {
      "type": "string",
      "enum": [
        "current",
        "planned-create",
        "planned-replace",
        "missing",
        "conflict",
        "manual-review",
        "orphaned"
      ]
    },
    "cursor": { "type": "string", "minLength": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "additionalProperties": false
}
```

Output: paginated `ForgeProjectInspection.generation.files` entries.

Limits: metadata only; no file body, diff, hash preimage, or path outside the
registered project.

### `forge_get_permissions`

Purpose: expose generated-server permission declarations in technical and
plain-language forms.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["projectId"],
  "properties": {
    "projectId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" }
  },
  "additionalProperties": false
}
```

Output: `ForgeProjectInspection.permissions` enriched by a deterministic label
and explanation catalog.

Limits: never returns environment values or infers permission from tool prose.
Unknown declarations remain `unknown` if that status is added to the contract;
absent declarations remain `not-declared`.

Example for non-programmers:

```json
{
  "id": "filesystem.write",
  "status": "denied",
  "label": "Write files",
  "explanation": "This server cannot create or modify files."
}
```

### `forge_get_change_plan`

Purpose: calculate and return one fresh general change plan for a registered
project.

Input JSON Schema:

```json
{
  "type": "object",
  "required": ["projectId"],
  "properties": {
    "projectId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,63}$" }
  },
  "additionalProperties": false
}
```

Output: validated `ForgeProjectChangePlan`, a plain-language deterministic
summary, and diagnostics.

Limits: the plan is evidence, not authorization. It cannot be confirmed or
applied through MCP. A later request recomputes the plan; stale identity is
reported rather than silently reused.

## Explicitly forbidden tools

Phase 4 must not register tools named or equivalent to:

```text
apply
generate
write
delete
approve
install
update
rollback
```

This includes generic filesystem, shell, process, package-manager, patch, or
"execute action" tools that could provide the same capability indirectly.

## Output safety

The interface must:

- cap every serialized tool result by bytes as well as item count;
- default list pages to 50 and cap them at 100 entries;
- use opaque, project-bound, expiring cursors;
- return metadata instead of whole files;
- never return environment values, secret defaults, tokens, or client
  configuration payloads;
- redact sensitive diagnostic metadata before serialization;
- truncate only at structured item boundaries and emit
  `MCP_OUTPUT_LIMIT_EXCEEDED`;
- include machine-readable diagnostics and deterministic user-facing summary
  data;
- reject requests whose safe result cannot fit within the enforced limit.

## Threat model

| Threat                                | Source and impact                                                | Protective boundary and Forge responsibility                                                                                        | Not solved in Phase 4                                                |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Prompt injection in project documents | A file tells the model to ignore policy or exfiltrate data.      | Forge treats content as data, does not return file bodies, and never derives authority from project text.                           | Detecting or classifying hostile natural language.                   |
| False approval claim                  | A model says the user approved a plan.                           | No approval or apply tool exists; AI prose is never confirmation evidence.                                                          | A future approval protocol.                                          |
| Planning bypass                       | A client asks a generic tool to mutate directly.                 | Strict allowlisted tool registry with no filesystem, shell, or generic execution tool.                                              | Mutations outside Forge performed by unrelated software.             |
| Path traversal                        | Crafted input attempts `../` access.                             | Tools accept project IDs; catalog paths use portable validation and canonical roots.                                                | Operating-system compromise below the process boundary.              |
| Symlink escape                        | Catalogued or managed paths redirect outside a root.             | Reuse bounded filesystem inspection and reject symlinks on managed paths.                                                           | Following trusted symlinks; Phase 4 follows none.                    |
| Read outside allowed roots            | Client supplies another path or project.                         | No arbitrary path parameters; project catalog and allowed-root policy are authoritative.                                            | Multi-user authorization beyond one configured MCP instance.         |
| Environment exfiltration              | Client requests variables or secrets.                            | No environment-reading tool; permission output contains declarations only.                                                          | Secrets exposed by another server or host process.                   |
| Secrets in diagnostics                | Libraries attach sensitive values to metadata.                   | Diagnostic allowlist/redaction runs before the common envelope is serialized.                                                       | Recovering a secret already written into user-visible project files. |
| Oversized output                      | A large project exhausts memory or context.                      | Bounded reads, byte limits, pagination, item caps, and structured truncation.                                                       | Fully inspecting arbitrarily large projects in one request.          |
| Inspect denial of service             | Repeated or highly concurrent scans consume CPU and I/O.         | Per-request deadlines, concurrency limits, cancellation, and catalog quotas.                                                        | Distributed rate limiting or hostile local users.                    |
| Stale plan                            | Targets change after a plan is returned.                         | Plans carry deterministic identity; each request observes fresh state and never authorizes apply.                                   | Applying or approving any plan.                                      |
| Project substitution                  | A client labels one project's result as another.                 | Every envelope binds `projectId`; cursors and plans remain project-bound.                                                           | A malicious UI deliberately misrepresenting correctly bound data.    |
| Ambiguous relative paths              | Different working directories resolve the same text differently. | Catalog paths resolve once relative to the catalog, then use canonical evidence.                                                    | User confusion in external tools that display their own paths.       |
| Compromised MCP client                | Client alters, suppresses, or misrepresents facts.               | Forge returns signed-by-structure IDs, hashes, diagnostics, and deterministic summaries; no authority crosses back from the client. | Cryptographic attestation and trusted display.                       |

## LM Studio scenario

The following is a future interaction design, not functionality delivered by
Phase 3 and not an LM Studio integration included in the Phase 4 minimum:

1. The user configures a future TUI connection to an LM Studio API.
2. The model calls `forge_inspect_project` using a catalogued project ID.
3. Forge returns structured, bounded facts.
4. The model explains those facts to the user.
5. The model proposes configuration goals.
6. Forge produces a read-only `ForgeProjectChangePlan`.
7. The user can inspect the plan, but MCP cannot apply or approve it.
8. Apply remains outside the MCP interface.

For example, a non-programmer might ask for a server that helps track fictional
customers and calendar appointments. In the minimum Phase 4 implementation, the
model can explain the current Forge configuration, permissions, diagnostics, and
a proposed file plan. It cannot create the customer system, connect a real
calendar, install integrations, edit configuration, or generate/apply files
through MCP. Those are future capabilities with separate trust decisions.

## Smallest viable Phase 4 implementation

1. Build `apps/mcp-server` as a private read-only MCP application.
2. Add a fixed allowlisted tool registry containing only the tools above.
3. Add a validated read-only project catalog with allowed-root and canonical
   path enforcement.
4. Reuse `packages/core` contracts and validators, `packages/generators` as the
   only preview owner, and `packages/fs-adapter` for bounded reads.
5. Extract the current CLI inspection orchestration into a shared read-only
   application service so CLI, TUI, and MCP consume the same structured data.
6. Add contract, protocol, path-boundary, redaction, pagination, size-limit, and
   no-write tests.
7. Document every new tool and diagnostic as a public contract.

The minimum explicitly excludes an AI provider, LM Studio API client, apply,
approval tokens, external component registry, marketplace, package installation,
dependency execution, and publication.

## Feasibility decision

The read-only interface is implementable without weakening current boundaries if
project selection is catalog-based, inspection orchestration is shared as
structured data, generation preview remains authoritative in
`packages/generators`, and `apps/mcp-server` exposes no generic execution or
filesystem capability. The primary design risk is accidental capability creep,
not the MCP transport itself.
