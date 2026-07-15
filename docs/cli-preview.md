# Read-only generation preview CLI

## Purpose and flow

`mcp-forge preview` renders a selected template in memory, inspects an explicit
project root through the bounded filesystem adapter, and prints the generation
plan without applying it:

```text
config loader -> Forge validation -> template bundle -> in-memory render
  -> optional previous state + managed target metadata -> generation preview
  -> text or JSON output
```

Version 1 requires an explicit template directory because the configuration
contract does not identify one unambiguously.

## Usage and options

```text
mcp-forge preview --template <path> [options]
```

| Option                                      | Default                           | Meaning                                                  |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `--config <path>`                           | `./mcp-forge.json`                | Config relative to the CLI working directory.            |
| `--root <path>`                             | CLI working directory             | Project root, made absolute before adapter use.          |
| `--template <path>`                         | none                              | Required explicit template directory.                    |
| `--format <table\|compact\|detailed\|json>` | `table`                           | Output contract.                                         |
| `--state <path>`                            | `.mcp-forge/generated-state.json` | Relative state path confined inside root.                |
| `--no-state`                                | off                               | Ignore previous state without changing it.               |
| `--show-content`                            | off                               | Include eligible rendered content, never target content. |
| `--show-skipped`                            | off                               | Include skipped rows in text and condition-skip info.    |
| `--warnings-as-errors`                      | off                               | Exit 3 for otherwise successful warnings.                |
| `--allow-explicit-replace`                  | off                               | Permit replacement in preview only.                      |
| `--quiet`                                   | off                               | Suppress only clean successful text output.              |

`--state` and `--no-state` are mutually exclusive. Absolute or traversing state
paths are rejected. Value options support both `--option value` and
`--option=value`.

```bash
mcp-forge preview \
  --config ./mcp-forge.json \
  --root ./server-project \
  --template ./packages/templates/templates/basic-typescript-server
```

## Managed paths and state

The CLI validates config before loading a template. It loads the bundle only
through `@mcp-server-forge/fs-adapter`, renders in memory, and derives managed
target paths from files that were actually rendered. Condition-skipped files are
not inspected as required targets. Additional previous-state paths are inspected
so orphaned generated files remain visible.

A missing state file is normal. `--no-state` avoids reading it entirely. The
command never creates `.mcp-forge` or writes a replacement state.

## Actions and text formats

Actions and stable reason codes come directly from the public generation preview
contract: `create`, `replace`, `skip`, `conflict`, and `manual-review`. See
[generation-preview.md](generation-preview.md#stable-reason-codes).

`table` prints dynamically sized, uncolored columns with complete paths,
followed by summary counts and `Safe to apply`. `compact` prints one action per
line and a machine-friendly summary. `detailed` prints ownership, strategy,
reason, and shared Forge diagnostics. Skip rows are hidden in text unless
`--show-skipped` is active, but summary counts always include them.

With `--show-content`, rendered content for `create`, `replace`, and
`manual-review` appears after plan diagnostics:

```text
--- package.json ---
...
--- end package.json ---
```

`skip` and `conflict` content is not shown. Existing target content is never
returned by the adapter or CLI.

## JSON contract

JSON mode emits exactly one JSON document on standard output:

```json
{
  "success": true,
  "safeToApply": false,
  "configPath": "/absolute/path/mcp-forge.json",
  "projectRoot": "/absolute/path/project",
  "templatePath": "/absolute/path/template",
  "template": { "id": "basic-typescript-server", "version": "1.1.0" },
  "summary": {
    "create": 1,
    "replace": 0,
    "skip": 0,
    "conflict": 0,
    "manualReview": 1
  },
  "files": [],
  "orphanedFiles": [],
  "diagnostics": []
}
```

`success` means a technically consistent preview exists. It may be true while
`safeToApply` is false for a normal conflict, manual review, or orphan. Early
failures retain the envelope with empty plan fields and may include `cliError`.
JSON always includes skips. `--show-content` adds only eligible rendered
content. `--quiet` never suppresses JSON.

## Exit codes and priority

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Preview exists and is safe; warnings are allowed.                    |
| `1`  | Config, rendering, or plan-input consistency validation failed.      |
| `2`  | Config, template, root, target, or state could not be loaded safely. |
| `3`  | Safe preview has warnings and `--warnings-as-errors` is active.      |
| `4`  | Invalid command, option, value, or argument combination.             |
| `5`  | Preview exists but has conflict, manual review, or orphaned files.   |

Priority is usage, loading, validation/consistency, unsafe preview,
warnings-as-errors, then success. Expected `PLAN_FILE_CONFLICT` belongs to exit
5; unrelated mapping or hash consistency errors use exit 1. Diagnostic severity
is never changed.

## Help, CI, and read-only guarantees

```bash
mcp-forge --help
mcp-forge preview --help
mcp-forge validate --help
mcp-forge --version
```

The version comes from local package metadata without a registry lookup. In CI,
prefer `--format json --warnings-as-errors` and treat exit 5 as a human-review
outcome.

The command never writes or deletes files, creates directories, changes modes,
persists state, applies a plan, installs dependencies, launches generated code,
uses the network, or invokes a child process. `--allow-explicit-replace` and
`--show-content` change preview/output only. The working directory is a default
only at the CLI boundary; lower layers always receive an explicit absolute root.
