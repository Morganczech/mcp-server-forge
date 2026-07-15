# Generation preview

## Purpose and flow

`@mcp-server-forge/generators` connects the restricted renderer to the shared
template planner without reading or changing a project:

```text
validated Forge config + manifest + in-memory sources
  -> renderForgeTemplate
  -> rendered content and SHA-256 hashes
  -> createGenerationPreview(manifest, target state, optional previous state)
  -> deterministic read-only plan
```

The preview never writes files, persists generation state, merges sections, or
executes a plan. Its request and result are JSON-serializable and independent of
the CLI.

## Inputs

`ForgeGenerationPreviewRequest` contains a `ForgeRenderResult`, its
authoritative `ForgeTemplateManifest`, an abstract `ForgeTargetState`, an
optional previous `ForgeGenerationState`, and optional explicit-replace
permission.

The target model contains metadata, never file content:

```ts
interface ForgeTargetFileState {
  path: string;
  exists: boolean;
  contentHash?: string;
  executable?: boolean;
}

interface ForgeTargetState {
  files: ForgeTargetFileState[];
}
```

An existing target may omit `contentHash` when it cannot be observed. Such a
file is never automatically replaced. Portable `/` paths and lowercase SHA-256
hashes use the existing template contracts. Unmanaged target files that occur in
neither the manifest nor previous state are ignored.

The optional read-only filesystem integration that creates this abstract input
is documented in [filesystem-adapter.md](filesystem-adapter.md). Preview itself
remains a pure in-memory operation.

Previous state supplies the last generated hash and the ownership/update policy
recorded for each file. Its template identity and file policy must agree with
the selected manifest before it can participate in a decision.

## Result and actions

`ForgeGenerationPreview` contains `success`, `safeToApply`, path-sorted planned
files, path-sorted `orphanedFiles`, action counts, diagnostics, and
template/file count metadata. It contains no timestamp.

Each `ForgePlannedFile` has one action:

- `create`: the target is missing and creation is permitted;
- `replace`: a whole-file replacement passed the declared safety rule;
- `skip`: the target is preserved or already matches the rendered output;
- `conflict`: available state cannot prove that replacement is safe;
- `manual-review`: policy requires a human decision or an unavailable merge.

It also reports rendered, target, and previous hashes when known, plus
`changedFromPreviousGeneration`, `targetModifiedByUser`, and `executableChange`
where those facts can be derived.

## Decision table

| Situation                                                          | Action          |
| ------------------------------------------------------------------ | --------------- |
| Missing target, non-`manual` valid strategy                        | `create`        |
| Missing target, `manual`                                           | `manual-review` |
| Existing target hash equals rendered hash and no executable change | `skip`          |
| Existing `user-owned`, non-`manual`                                | `skip`          |
| Existing `create-once`                                             | `skip`          |
| `replace-if-unmodified`, target equals previous, render changed    | `replace`       |
| `replace-if-unmodified`, target differs from previous              | `conflict`      |
| `replace-if-unmodified`, comparison hash unavailable               | `conflict`      |
| Existing `replace`, explicit permission absent                     | `manual-review` |
| Existing `replace`, explicit permission present                    | `replace`       |
| Existing `shared + merge-markers`                                  | `manual-review` |
| Existing `manual`                                                  | `manual-review` |
| Inconsistent or ambiguous render/manifest/state mapping            | `conflict`      |

Manifest ownership, update strategy, content type, and executable flag are
authoritative. The preview verifies that each rendered file agrees with them and
that its public content hash matches the rendered content.

If content is unchanged but the executable flag differs, the item records
`executableChange: true`. The normal ownership and update rules then produce
`replace`, `manual-review`, or `skip`; there is intentionally no separate
filesystem permission action. User-owned and create-once files remain preserved,
while an otherwise safe forge-owned whole-file update may replace.

## Stable reason codes

Reason codes are English machine identifiers separate from diagnostic messages:

- `TARGET_MISSING`
- `TARGET_ALREADY_MATCHES`
- `CREATE_ONCE_TARGET_EXISTS`
- `USER_OWNED_TARGET_EXISTS`
- `TARGET_MATCHES_PREVIOUS_GENERATION`
- `TARGET_MODIFIED_SINCE_GENERATION`
- `PREVIOUS_GENERATION_HASH_MISSING`
- `EXPLICIT_REPLACE_NOT_ALLOWED`
- `EXPLICIT_REPLACE_ALLOWED`
- `SHARED_FILE_REQUIRES_MERGE`
- `MANUAL_STRATEGY`
- `TARGET_HASH_UNKNOWN`
- `EXECUTABLE_FLAG_CHANGED`
- `MAPPING_INCONSISTENT`

## Orphaned generated files

A path present in usable previous state but absent from the current manifest is
returned in `orphanedFiles`. The entry reports its previous hash, whether the
target still exists, its current hash when known, and whether it was modified.
Forge does not create a delete action. Every orphan emits
`PLAN_ORPHANED_GENERATED_FILE`, requires review, and makes `safeToApply` false.

## Safety and diagnostics

`safeToApply` is true only when there are no error diagnostics, no `conflict` or
`manual-review` actions, and no orphaned files. It describes whether a future
application layer could safely proceed; preview itself never applies anything.
`success` only reports the absence of error diagnostics, so a valid preview that
contains a warning-level manual review can have `success: true` and
`safeToApply: false`.

The `PLAN_` catalog currently includes:

- request/mapping: `PLAN_REQUEST_INVALID`, `PLAN_RENDER_MANIFEST_MISMATCH`,
  `PLAN_RENDER_FILE_MISSING`, `PLAN_RENDER_FILE_UNDECLARED`;
- ambiguity/identity: `PLAN_TARGET_PATH_DUPLICATE`,
  `PLAN_PREVIOUS_STATE_PATH_DUPLICATE`, `PLAN_TEMPLATE_ID_MISMATCH`,
  `PLAN_TEMPLATE_VERSION_MISMATCH`;
- policy/hash consistency: `PLAN_OWNERSHIP_MISMATCH`,
  `PLAN_UPDATE_STRATEGY_MISMATCH`, `PLAN_HASH_MISMATCH`,
  `PLAN_TARGET_HASH_MISSING`, `PLAN_TARGET_MODIFIED`;
- decisions: `PLAN_FILE_CONFLICT`, `PLAN_MANUAL_REVIEW_REQUIRED`,
  `PLAN_EXPLICIT_REPLACE_REQUIRED`, `PLAN_ORPHANED_GENERATED_FILE`,
  `PLAN_UNSAFE_ACTION_BLOCKED`.

Normal `skip` decisions do not emit diagnostics.

## Determinism

Planned and orphaned files use portable ASCII path ordering. Diagnostics use the
shared deterministic sorter, and summary counts derive only from final actions.
Input array and object insertion order do not affect the result. Planning uses
no filesystem, network, child process, environment, clock, or randomness.

## Public API

The generators package exports:

- `validateGenerationPreviewRequest`;
- `createGenerationPreview`;
- `createPlannedFile`;
- `findOrphanedGeneratedFiles`;
- `summarizeGenerationPlan`;
- `isGenerationPlanSafe`;
- the JSON-serializable target, request, plan, result, and reason-code types.

## Not implemented

- filesystem writes or deletes; bounded target inspection lives in the separate
  read-only filesystem adapter;
- generation-state creation or persistence;
- plan application, interactive approval, or automatic conflict repair;
- marker-based or structural merge;
- functional MCP SDK project generation.

The separate confirmed application workflow is documented in
[cli-generate.md](cli-generate.md).
