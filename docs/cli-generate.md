# Interactive generation CLI

`mcp-forge generate` displays a fresh generation preview and writes only after
an explicit `y` or `yes` response on an interactive TTY:

```bash
mcp-forge generate --template ./template --root ./project
```

Options are `--config`, `--root`, `--template`, `--state`, `--show-skipped`, and
`--allow-explicit-replace`. The template path is required. There is
intentionally no `--yes`, JSON apply mode, or environment-variable confirmation.

After confirmation the command reloads configuration, template, targets, and
state, reconstructs the preview and Apply Contract, and requires the refreshed
contract to match the one that was displayed and confirmed exactly. It then
delegates execution to the filesystem adapter. A changed or newly unsafe plan is
not applied, even when the replacement plan would otherwise be safe.

Exit codes retain the preview contract: `1` validation, `2` filesystem failure,
`4` usage, and `5` unsafe or stale plan. Code `6` means confirmation was refused
or unavailable. Code `0` means all planned writes and state persistence
succeeded, or that no file changes existed and no state write was needed.
