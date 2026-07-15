import type { CliContext } from "../cli.js";
import { CLI_EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import type { InspectCommandOptions } from "./inspect-options.js";
import { inspectProject } from "./inspect.js";

type TuiScreen = "overview" | "permissions" | "files" | "diagnostics" | "help";

function renderScreen(
  screen: TuiScreen,
  result: Awaited<ReturnType<typeof inspectProject>>,
): string {
  const { inspection } = result;
  const heading = `MCP Server Forge TUI (experimental, read-only) — ${screen}`;
  const body =
    screen === "overview"
      ? [
          `Project: ${inspection.project.title ?? inspection.project.name ?? "not initialized"}`,
          `Status: ${inspection.status}`,
          `Server: ${inspection.project.serverName ?? "not available"}`,
          `Generation state: ${inspection.generation.stateAvailable ? "available" : "not available"}`,
          `Files: ${inspection.summary.files}; conflicts: ${inspection.summary.conflicts}`,
        ]
      : screen === "permissions"
        ? inspection.permissions.map(
            ({ permission, status, scope }) =>
              `${permission}: ${status}${scope.length === 0 ? "" : ` (${scope.join(", ")})`}`,
          )
        : screen === "files"
          ? inspection.generation.files.map(
              ({ path, status }) => `${status.padEnd(15)} ${path}`,
            )
          : screen === "diagnostics"
            ? inspection.diagnostics.map(
                ({ severity, code, message }) =>
                  `${severity.toUpperCase()} ${code}: ${message}`,
              )
            : [
                "1 overview   2 permissions   3 generated files   4 diagnostics",
                "r refresh    i inspect       p preview current configuration",
                "h help       q quit",
                "",
                "This interface cannot apply plans, delete files, change permissions or configuration, install dependencies, or run shell commands.",
              ];
  return `\u001b[2J\u001b[H${heading}\n${"=".repeat(heading.length)}\n\n${
    body.length === 0 ? "No entries." : body.join("\n")
  }\n\n[1-4] screens  [r/i] refresh  [p] preview  [h] help  [q] quit\n`;
}

export async function runTuiCommand(
  options: InspectCommandOptions,
  context: CliContext,
): Promise<CliExitCode> {
  if (!context.isInteractive || context.readTuiKey === undefined) {
    context.stderr.write(
      "The experimental TUI requires an interactive TTY. Use `mcp-forge inspect` for non-interactive inspection.\n",
    );
    return CLI_EXIT_CODES.invalidUsage;
  }

  let result = await inspectProject(options, context);
  let screen: TuiScreen = "overview";
  while (true) {
    context.stdout.write(renderScreen(screen, result));
    const key = (await context.readTuiKey()).toLowerCase();
    if (key === "q" || key === "\u0003") return result.exitCode;
    if (key === "1") screen = "overview";
    else if (key === "2") screen = "permissions";
    else if (key === "3") screen = "files";
    else if (key === "4") screen = "diagnostics";
    else if (key === "h" || key === "?") screen = "help";
    else if (key === "r" || key === "i")
      result = await inspectProject(options, context);
    else if (key === "p") {
      result = await inspectProject(options, context);
      screen = "files";
    }
  }
}
