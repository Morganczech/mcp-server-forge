import {
  runValidateCommand,
  type CliOutputFormat,
  type ValidateCommandContext,
  type ValidateCommandOptions,
} from "./commands/validate.js";
import { createCliError, type CliError } from "./errors/cli-errors.js";
import { CLI_EXIT_CODES, type CliExitCode } from "./exit-codes.js";

export type CliContext = ValidateCommandContext;

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

function renderUsageError(error: CliError): string {
  return `ERROR ${error.code}\n\n${error.message}\n\nUsage: mcp-forge validate [config-path] [options]\n`;
}

export async function runCli(
  args: string[],
  context: CliContext,
): Promise<CliExitCode> {
  const [command, ...commandArguments] = args;

  if (command !== "validate") {
    const message =
      command === undefined
        ? "A command is required."
        : `Unknown command: ${command}`;
    context.stderr.write(
      renderUsageError(createCliError("CLI_INVALID_ARGUMENT", message)),
    );
    return CLI_EXIT_CODES.invalidUsage;
  }

  const parsed = parseValidateArguments(commandArguments);
  if (!parsed.success) {
    context.stderr.write(renderUsageError(parsed.error));
    return CLI_EXIT_CODES.invalidUsage;
  }

  return runValidateCommand(parsed.options, context);
}
