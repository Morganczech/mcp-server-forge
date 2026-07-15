# MCP Server Forge CLI

## Status and scope

The CLI provides validation, structured project inspection, read-only preview,
an experimental read-only TUI, and one explicitly confirmed mutating workflow:

```bash
mcp-forge validate ./mcp-forge.json
mcp-forge inspect --json
mcp-forge preview --template ./path/to/template
mcp-forge generate --template ./path/to/template
mcp-forge tui --template ./path/to/template
```

The validate command reads one UTF-8 JSON file, validates schema version 1, runs
Forge semantic and security diagnostics, renders the result, and returns a
documented exit code. It does not generate, repair, install, import, or publish
anything.

Preview composes validation, bounded filesystem inspection, in-memory rendering,
and generation planning. Its contract is documented in
[cli-preview.md](cli-preview.md).

Generate displays the same preview, requires interactive TTY confirmation,
recomputes the Apply Contract from fresh state, and delegates writes to the
filesystem executor. Its contract is documented in
[cli-generate.md](cli-generate.md).

Inspect emits a structured Project Inspection in text or JSON. It reads the
configuration and generation state, compares tracked files, and optionally
adapts a fresh generation preview when `--template` is supplied. It never
writes. See the [engine architecture](architecture/forge-engine-and-tui.md).

The experimental `tui` command presents the same inspection through an
interactive terminal. It is read-only, requires both input and output TTYs, and
rejects redirected execution with a recommendation to use `inspect`.

## Development setup

Install workspace dependencies from the repository root:

```bash
pnpm install
```

Run the TypeScript entrypoint during development:

```bash
pnpm --filter @mcp-server-forge/cli dev validate ./mcp-forge.json
```

Build the CLI and its workspace dependencies:

```bash
pnpm build
node apps/cli/dist/index.js validate ./mcp-forge.json
```

The package reserves the future executable name `mcp-forge`. It is private and
is not published yet.

## Functional basic template

The repository's `basic-typescript-server` template produces a standalone
private Node.js 22 project. Generate it through the normal preview,
confirmation, stale-target, and Apply Contract workflow:

```bash
node apps/cli/dist/index.js generate --config ./packages/generators/fixtures/valid/basic-config.json --root ./target-project --template ./packages/templates/templates/basic-typescript-server
```

Then run these commands inside `target-project`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

The generated `dist/index.js` is a local stdio MCP server with one `hello` tool.
It needs no `npx`, npm account, environment variables, or network at runtime. A
clean first installation is not guaranteed offline: pnpm needs registry access
unless all pinned packages are already present in its local store. See the
[template guide](templates/basic-typescript-server.md).

## Validate command

```text
mcp-forge validate [config-path] [options]
```

If `config-path` is omitted, the command uses `./mcp-forge.json` relative to the
current working directory. Relative paths are resolved to absolute paths before
loading and reporting. Absolute paths are accepted unchanged after
normalization.

Examples:

```bash
mcp-forge validate
mcp-forge validate ./examples/company-info/mcp-forge.json
mcp-forge validate ./config/custom.json
```

## Options

| Option                 | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `--format compact`     | One diagnostic per line followed by a short summary.        |
| `--format detailed`    | Multi-line diagnostics and summary; this is the default.    |
| `--format json`        | Stable machine-readable JSON and no surrounding text.       |
| `--no-suggestions`     | Omits suggestions from compact and detailed output.         |
| `--warnings-as-errors` | Returns exit code 3 when warnings exist without errors.     |
| `--quiet`              | Suppresses output only when the command exits successfully. |

`--format=<value>` is equivalent to `--format <value>`. Options may appear
before or after the configuration path.

`--no-suggestions` does not remove suggestion fields from JSON. JSON is the
complete structured diagnostic API; this option controls only text rendering.

With `--quiet`, warnings are also silent while they remain a successful result.
When combined with `--warnings-as-errors`, warnings are printed because the
command exits unsuccessfully.

## Text output

Successful detailed validation:

```text
Configuration is valid.

0 errors, 0 warnings.
```

Detailed validation with warnings includes each warning and ends with:

```text
Configuration is valid with warnings.

0 errors, 2 warnings.
```

Compact success:

```text
OK 0 errors, 0 warnings
```

Compact errors and warnings use the stable validator format:

```text
ERROR CFG_REQUIRED_FIELD_MISSING server.name: A required configuration field is missing.
```

Normal validation diagnostics are written to standard output. File-loading and
usage errors use standard error in text modes. Routine failures never print a
stack trace.

## JSON output

JSON mode always emits one JSON document and no explanatory text:

```json
{
  "success": false,
  "configPath": "/absolute/path/mcp-forge.json",
  "summary": {
    "errors": 2,
    "warnings": 1,
    "info": 0
  },
  "diagnostics": []
}
```

`success` describes the command result. It is therefore `false` when
`--warnings-as-errors` changes an otherwise valid warning result to exit code 3.
The diagnostics retain their original `warning` severity.

File-loading failures keep `diagnostics` empty and add a stable `cliError`
object. They are not presented as schema diagnostics:

```json
{
  "success": false,
  "configPath": "/absolute/path/missing.json",
  "summary": {
    "errors": 0,
    "warnings": 0,
    "info": 0
  },
  "diagnostics": [],
  "cliError": {
    "code": "CLI_FILE_NOT_FOUND",
    "message": "The configuration file does not exist.",
    "path": "/absolute/path/missing.json"
  }
}
```

## File errors

The loader distinguishes:

- `CLI_FILE_NOT_FOUND`;
- `CLI_PATH_IS_DIRECTORY`;
- `CLI_FILE_READ_FAILED`;
- `CLI_JSON_PARSE_FAILED`;
- `CLI_EMPTY_FILE`;
- `CLI_JSON_ROOT_INVALID` when valid JSON has a non-object root;
- `CLI_INVALID_ARGUMENT` for command-line usage errors.

The loader never writes to the configuration file. JSON parsing and root-shape
checks are separate from schema and semantic validation.

## Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Configuration is valid; warnings are allowed by default.         |
| `1`  | At least one schema or semantic error exists.                    |
| `2`  | The file cannot be loaded, read, parsed, or used as a JSON root. |
| `3`  | Warnings exist and `--warnings-as-errors` is active.             |
| `4`  | Invalid command, option, format, or positional argument count.   |
| `5`  | Preview or inspection requires conflict or manual review.        |
| `6`  | Apply confirmation was refused or unavailable.                   |

Errors take precedence over warnings: a result containing both uses exit code 1,
even with `--warnings-as-errors`.

## CI usage

Use compact output and promote warnings to a failing result:

```bash
mcp-forge validate ./mcp-forge.json --format compact --warnings-as-errors
```

For structured processing, use JSON and inspect both the process exit code and
the `summary` object:

```bash
mcp-forge validate ./mcp-forge.json --format json --warnings-as-errors
```

The read-only GitHub Actions workflow runs the repository verification suite on
Ubuntu, macOS, and Windows with Node.js 22. It does not publish packages or
create releases.

## General help

```bash
mcp-forge --help
mcp-forge validate --help
mcp-forge inspect --help
mcp-forge preview --help
mcp-forge generate --help
mcp-forge tui --help
mcp-forge --version
```

The version is read from local package metadata without network access.

## Inspect command

```text
mcp-forge inspect [--config <path>] [--root <path>] [--template <path>]
                  [--state <path>] [--json]
```

Text is intended for people. `--json` writes exactly one versioned Project
Inspection document to standard output with no ANSI control sequences or
surrounding prose. A missing configuration is represented as `uninitialized` and
exits with code 2. Invalid configuration exits 1, filesystem loading errors exit
2, unsafe tracked-file or preview state exits 5, and a healthy inspection
exits 0.

Without `--template`, tracked files are compared with saved generation hashes.
With a template, inspect renders and adapts the same authoritative plan used by
`preview`; it does not maintain a separate planner.

Inspection permission rows describe the generated server configuration.
`not-declared` means the relevant key was absent from the source configuration;
schema defaults are not presented as an explicit decision. No environment or
secret values are included.

## Experimental TUI command

```text
mcp-forge tui [--config <path>] [--root <path>] [--template <path>]
              [--state <path>]
```

Keys `1` through `4` open overview, permissions, generated files, and
diagnostics. `r` refreshes, `i` reruns inspection, `p` refreshes preview data,
`h` opens help, and `q` quits. Preview data is complete only when a template was
provided. All actions are read-only.

The TUI is an experimental terminal client, not a desktop, web, or editor UI. It
cannot apply or approve a plan, modify files or configuration, delete data,
change permissions, install software, or execute commands.
