import { createCliError, type CliError } from "../errors/cli-errors.js";

export interface GenerateCommandOptions {
  configPath: string;
  rootPath: string;
  templatePath: string;
  capabilityRootPath?: string;
  statePath: string;
  showSkipped: boolean;
  allowExplicitReplace: boolean;
}

export type ParsedGenerateArguments =
  | { success: true; options: GenerateCommandOptions }
  | { success: false; error: CliError };

function invalid(message: string): ParsedGenerateArguments {
  return {
    success: false,
    error: createCliError("CLI_INVALID_ARGUMENT", message),
  };
}

function valueAt(args: string[], index: number, name: string) {
  const argument = args[index];
  if (argument === name) {
    const value = args[index + 1];
    return { value: value?.startsWith("--") ? undefined : value, consumed: 1 };
  }
  const prefix = `${name}=`;
  return argument?.startsWith(prefix)
    ? { value: argument.slice(prefix.length), consumed: 0 }
    : undefined;
}

export function parseGenerateArguments(
  args: string[],
): ParsedGenerateArguments {
  const options: GenerateCommandOptions = {
    configPath: "./mcp-forge.json",
    rootPath: ".",
    templatePath: "",
    statePath: ".mcp-forge/generated-state.json",
    showSkipped: false,
    allowExplicitReplace: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--show-skipped") {
      options.showSkipped = true;
      continue;
    }
    if (argument === "--allow-explicit-replace") {
      options.allowExplicitReplace = true;
      continue;
    }
    let matched = false;
    for (const [name, key] of [
      ["--config", "configPath"],
      ["--root", "rootPath"],
      ["--template", "templatePath"],
      ["--capability-root", "capabilityRootPath"],
      ["--state", "statePath"],
    ] as const) {
      const parsed = valueAt(args, index, name);
      if (parsed === undefined) continue;
      if (parsed.value === undefined || parsed.value.length === 0) {
        return invalid(`${name} requires a value.`);
      }
      options[key] = parsed.value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (!matched) {
      return invalid(
        argument?.startsWith("--")
          ? `Unknown option: ${argument}`
          : "generate does not accept positional arguments.",
      );
    }
  }
  return options.templatePath.length === 0
    ? invalid("--template is required for generate.")
    : { success: true, options };
}
