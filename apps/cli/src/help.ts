export const GLOBAL_HELP = `MCP Server Forge

Usage: mcp-forge <command> [options]

Commands:
  validate    Validate a Forge configuration without modifying it
  preview     Render and inspect a read-only generation plan

Global options:
  --help      Show this help
  --version   Show the CLI package version
`;

export const VALIDATE_HELP = `Usage: mcp-forge validate [config-path] [options]

Options:
  --format <compact|detailed|json>
  --no-suggestions
  --warnings-as-errors
  --quiet
  --help
`;

export const PREVIEW_HELP = `Usage: mcp-forge preview --template <path> [options]

Options:
  --config <path>             Forge config relative to the CLI working directory
  --root <path>               Project root (default: current working directory)
  --template <path>           Explicit template directory (required)
  --format <table|compact|detailed|json>
  --state <path>              State path inside root
  --no-state                  Ignore previous generation state
  --show-content              Show eligible rendered content
  --show-skipped              Include skipped files in text output
  --warnings-as-errors        Return exit code 3 for otherwise successful warnings
  --allow-explicit-replace    Preview explicitly permitted whole-file replacement
  --quiet                     Suppress clean successful text output
  --help                      Show this help
`;
