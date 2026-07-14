# MCP Server Forge rendering contract

## Purpose

`@mcp-server-forge/generators` converts a validated Forge configuration, a
validated template manifest, and an in-memory source map into deterministic
rendered files. Rendering is pure computation: it does not discover templates,
read or write files, inspect environment variables, resolve dependencies, run
commands, or update generation state.

```text
validated config + validated manifest + in-memory sources = rendered files
```

Rendering is distinct from planning and writing. Rendering creates desired
content. Planning compares its hashes with abstract or future filesystem state.
Writing will eventually apply an explicitly approved plan.

## Request and result

`ForgeRenderRequest` contains:

- normalized `ForgeConfig`;
- normalized `ForgeTemplateManifest`;
- `templateSources`, keyed by the manifest's exact source paths;
- optional renderer behavior such as informational condition-skip diagnostics.

`ForgeRenderResult` always contains deterministically sorted files, sorted
shared diagnostics, and metadata. Each successful file records its portable
target path, normalized content, SHA-256 content hash, source path, content
type, executable flag, ownership, and update strategy.

The metadata has no timestamp. It records template and engine versions, counts,
condition/source skips, hash algorithm, and newline policy. The complete result
is JSON-serializable and suitable for a future generation preview.

`ForgeRenderedPreview` exposes files and diagnostics with `safeToPlan`. It does
not compare against a disk or generation state.

## In-memory template sources

Sources are supplied as `Record<string, string>`:

```json
{
  "files/package.json.hbs": "{ \"name\": {{json project.name}} }",
  "files/src/index.ts.hbs": "console.error({{json project.title}});"
}
```

The renderer never loads these paths. Every active manifest file must have an
exact string entry. A missing or non-string source prevents only that file from
rendering and makes the overall result unsuccessful. Extra source entries emit
`GEN_TEMPLATE_SOURCE_UNUSED` but do not fail rendering.

## Safe render context

`createRenderContext` copies only explicitly approved configuration data:

- project name, title, description, language, and optional license;
- server name, version, description, runtime, and transport;
- capability booleans;
- knowledge enabled state and documentation language;
- distribution type;
- verified security declarations needed for general guidance;
- registry category strings for manifest conditions;
- environment name, description, required, and secret flags.

Environment defaults, external-source details, runtime values, allowed root
directories, arbitrary configuration fields, and the original configuration
object are not exposed. Template attempts to access environment or secret paths
receive `GEN_SECRET_ACCESS_BLOCKED`.

## Restricted template language version 1

Simple values use double braces:

```text
{{project.name}}
{{project.title}}
{{server.name}}
{{server.version}}
{{server.description}}
{{server.runtime}}
{{server.transport}}
```

Additional documented scalar context paths include project metadata,
capabilities, `knowledge.enabled`, `documentation.language`, distribution type,
and selected security declarations. Unknown paths are errors; property traversal
does not fall through to object prototypes.

### Helpers

Exactly six helpers are built in:

| Helper           | Behavior                                    |
| ---------------- | ------------------------------------------- |
| `json`           | JSON-encodes a string or boolean.           |
| `lowercase`      | Applies deterministic lowercase conversion. |
| `uppercase`      | Applies deterministic uppercase conversion. |
| `kebabCase`      | Produces lowercase ASCII kebab-case words.  |
| `snakeCase`      | Produces lowercase ASCII snake_case words.  |
| `escapeMarkdown` | Escapes Markdown control punctuation.       |

Usage takes exactly one approved context path:

```text
{{json project.name}}
{{escapeMarkdown project.title}}
```

There are no user helpers, JavaScript callbacks, function calls, literals,
partials, filesystem includes, or dynamic helper lookup.

### Conditions

The source language supports balanced, nestable boolean blocks only:

```text
{{#if knowledge.enabled}}
Knowledge is enabled.
{{/if}}
```

There is no `else`, comparison operator, loop, or expression language. The path
must resolve to an exposed boolean.

Manifest file conditions are evaluated separately against explicit context
mappings. `equals` supports the normalized fields defined by template manifest
version 1; `includes` supports registry categories. A false condition records a
deterministic metadata skip and is not an error. An unavailable condition field
is an error and skips that file.

## Content normalization and hashing

All renderer inputs and outputs are text. Before hashing and returning a file:

1. CRLF and lone CR become LF (`\n`);
2. all trailing newlines are removed;
3. exactly one final LF is appended.

An empty template therefore renders as one newline. The normalized UTF-8 content
is hashed with the public `hashGeneratedContent` helper from
`@mcp-server-forge/templates`, using SHA-256. The same normalized content always
has the same hash on every supported operating system.

## Determinism

- output files are sorted by portable target path;
- diagnostics use the shared deterministic sorter;
- skipped-file metadata is path-sorted;
- registry categories are sorted before entering context;
- source-map and manifest insertion order do not affect output;
- no time, working directory, operating system path conversion, environment,
  random number, or network state enters the result.

## Generation diagnostics

| Code                              | Meaning                                     |
| --------------------------------- | ------------------------------------------- |
| `GEN_RENDER_REQUEST_INVALID`      | Request inputs are not validated contracts. |
| `GEN_TEMPLATE_SOURCE_MISSING`     | Active manifest source is absent.           |
| `GEN_TEMPLATE_SOURCE_INVALID`     | Source value is not text.                   |
| `GEN_TEMPLATE_SOURCE_UNUSED`      | Source map contains an unreferenced entry.  |
| `GEN_TEMPLATE_SYNTAX_INVALID`     | Restricted syntax is malformed.             |
| `GEN_TEMPLATE_VARIABLE_UNKNOWN`   | Context path is not exposed.                |
| `GEN_TEMPLATE_HELPER_UNKNOWN`     | Helper is not built in.                     |
| `GEN_TEMPLATE_CONDITION_INVALID`  | A condition cannot be safely evaluated.     |
| `GEN_TEMPLATE_RENDER_FAILED`      | A file did not produce safe output.         |
| `GEN_OUTPUT_PATH_DUPLICATE`       | Rendered target path is duplicated.         |
| `GEN_OUTPUT_CONTENT_INVALID`      | Output is not valid render text.            |
| `GEN_SECRET_ACCESS_BLOCKED`       | Secret-related path access was denied.      |
| `GEN_RENDER_SKIPPED_BY_CONDITION` | Optional info for a false file condition.   |

Condition-skip diagnostics are disabled by default to avoid noisy normal output;
the skip remains visible in metadata.

## Public API

- `createRenderContext(config)`;
- `validateRenderRequest(request)`;
- `renderTemplateSource(source, context, options)`;
- `evaluateTemplateCondition(condition, context)`;
- `normalizeRenderedContent(content, contentType)`;
- `renderForgeTemplate(request)`;
- `createRenderedPreview(result)`;
- helper names, allowed context paths, and JSON-serializable public types.

The renderer result can be passed to the separate read-only planner described in
[generation-preview.md](generation-preview.md). Rendering produces content and
hashes; generation preview compares only that output and abstract state. Neither
layer discovers or writes filesystem state.

## Version 1 limitations

- no functional MCP SDK server generation;
- no dependency or package-version resolution;
- no loops, `else`, partials, arbitrary expressions, or custom helpers;
- no binary templates;
- no filesystem source loader or output writer;
- no generation-state creation; comparison is limited to the separate read-only
  generation preview contract;
- no plan application, merge markers, migrations, registry, clients, CLI, or MCP
  tools.

The included basic and knowledge templates intentionally generate transparent
placeholder projects. Their README and package metadata state that dependency
resolution and functional MCP integration are still pending.
