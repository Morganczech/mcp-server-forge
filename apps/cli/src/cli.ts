import {
  runValidateCommand,
  type CliOutputFormat,
  type ValidateCommandContext,
  type ValidateCommandOptions,
} from "./commands/validate.js";
import { runPreviewCommand } from "./commands/preview.js";
import { parsePreviewArguments } from "./commands/preview-options.js";
import { runGenerateCommand } from "./commands/generate.js";
import { parseGenerateArguments } from "./commands/generate-options.js";
import { runInspectCommand } from "./commands/inspect.js";
import { parseInspectArguments } from "./commands/inspect-options.js";
import { runTuiCommand } from "./commands/tui.js";
import { createCliError, type CliError } from "./errors/cli-errors.js";
import { CLI_EXIT_CODES, type CliExitCode } from "./exit-codes.js";
import {
  GENERATE_HELP,
  GLOBAL_HELP,
  INSPECT_HELP,
  PREVIEW_HELP,
  TUI_HELP,
  VALIDATE_HELP,
} from "./help.js";

export interface CliContext extends ValidateCommandContext {
  version?: string;
  isInteractive?: boolean;
  confirm?: (prompt: string) => Promise<boolean>;
  now?: () => string;
  readTuiKey?: () => Promise<string>;
}

type ParsedValidateArguments =
  | { success: true; options: ValidateCommandOptions }
  | { success: false; error: CliError };

const outputFormats = new Set<CliOutputFormat>(["compact", "detailed", "json"]);

function invalidArgument(message: string): ParsedValidateArguments {
  return {
    success: false,
    error: createCliError("CLI_INVALID_ARGUMENT", message),
  };
}

export function parseValidateArguments(
  args: string[],
): ParsedValidateArguments {
  const options: ValidateCommandOptions = {
    configPath: "./mcp-forge.json",
    format: "detailed",
    includeSuggestions: true,
    warningsAsErrors: false,
    quiet: false,
  };
  let positionalPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--no-suggestions") {
      options.includeSuggestions = false;
      continue;
    }
    if (argument === "--warnings-as-errors") {
      options.warningsAsErrors = true;
      continue;
    }
    if (argument === "--quiet") {
      options.quiet = true;
      continue;
    }

    let formatValue: string | undefined;
    if (argument === "--format") {
      formatValue = args[index + 1];
      if (formatValue === undefined || formatValue.startsWith("--")) {
        return invalidArgument("--format requires a value.");
      }
      index += 1;
    } else if (argument?.startsWith("--format=")) {
      formatValue = argument.slice("--format=".length);
    }

    if (formatValue !== undefined) {
      if (!outputFormats.has(formatValue as CliOutputFormat)) {
        return invalidArgument("--format must be compact, detailed, or json.");
      }
      options.format = formatValue as CliOutputFormat;
      continue;
    }

    if (argument === undefined || argument.startsWith("--")) {
      return invalidArgument(
        argument === undefined
          ? "--format requires a value."
          : `Unknown option: ${argument}`,
      );
    }

    if (positionalPath !== undefined) {
      return invalidArgument(
        "validate accepts at most one configuration path.",
      );
    }
    positionalPath = argument;
  }

  if (positionalPath !== undefined) {
    options.configPath = positionalPath;
  }

  return { success: true, options };
}

function renderUsageError(error: CliError, usage: string): string {
  return `ERROR ${error.code}\n\n${error.message}\n\n${usage}`;
}

export async function runCli(
  args: string[],
  context: CliContext,
): Promise<CliExitCode> {
  const [command, ...commandArguments] = args;

  if (command === "--help" || command === "-h") {
    context.stdout.write(GLOBAL_HELP);
    return CLI_EXIT_CODES.success;
  }
  if (command === "--version" || command === "-v") {
    context.stdout.write(`${context.version ?? "unknown"}\n`);
    return CLI_EXIT_CODES.success;
  }
  if (
    (command === "validate" ||
      command === "preview" ||
      command === "generate" ||
      command === "inspect" ||
      command === "tui") &&
    (commandArguments[0] === "--help" || commandArguments[0] === "-h")
  ) {
    context.stdout.write(
      command === "validate"
        ? VALIDATE_HELP
        : command === "preview"
          ? PREVIEW_HELP
          : command === "generate"
            ? GENERATE_HELP
            : command === "inspect"
              ? INSPECT_HELP
              : TUI_HELP,
    );
    return CLI_EXIT_CODES.success;
  }

  if (
    command !== "validate" &&
    command !== "preview" &&
    command !== "generate" &&
    command !== "inspect" &&
    command !== "tui"
  ) {
    const message =
      command === undefined
        ? "A command is required."
        : `Unknown command: ${command}`;
    context.stderr.write(
      renderUsageError(
        createCliError("CLI_INVALID_ARGUMENT", message),
        GLOBAL_HELP,
      ),
    );
    return CLI_EXIT_CODES.invalidUsage;
  }

  if (command === "preview") {
    const parsed = parsePreviewArguments(commandArguments);
    if (!parsed.success) {
      context.stderr.write(renderUsageError(parsed.error, PREVIEW_HELP));
      return CLI_EXIT_CODES.invalidUsage;
    }
    return runPreviewCommand(parsed.options, context);
  }

  if (command === "generate") {
    const parsed = parseGenerateArguments(commandArguments);
    if (!parsed.success) {
      context.stderr.write(renderUsageError(parsed.error, GENERATE_HELP));
      return CLI_EXIT_CODES.invalidUsage;
    }
    return runGenerateCommand(parsed.options, context);
  }

  if (command === "inspect" || command === "tui") {
    const parsed = parseInspectArguments(commandArguments);
    if (!parsed.success) {
      context.stderr.write(
        renderUsageError(
          parsed.error,
          command === "inspect" ? INSPECT_HELP : TUI_HELP,
        ),
      );
      return CLI_EXIT_CODES.invalidUsage;
    }
    if (command === "tui" && parsed.options.json) {
      context.stderr.write(
        renderUsageError(
          createCliError(
            "CLI_INVALID_ARGUMENT",
            "--json is available on inspect, not tui.",
          ),
          TUI_HELP,
        ),
      );
      return CLI_EXIT_CODES.invalidUsage;
    }
    return command === "inspect"
      ? runInspectCommand(parsed.options, context)
      : runTuiCommand(parsed.options, context);
  }

  const parsed = parseValidateArguments(commandArguments);
  if (!parsed.success) {
    context.stderr.write(renderUsageError(parsed.error, VALIDATE_HELP));
    return CLI_EXIT_CODES.invalidUsage;
  }

  return runValidateCommand(parsed.options, context);
}
