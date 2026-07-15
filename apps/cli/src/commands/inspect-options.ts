import { createCliError, type CliError } from "../errors/cli-errors.js";

export interface InspectCommandOptions {
  configPath: string;
  rootPath: string;
  templatePath?: string;
  capabilityRootPath?: string;
  statePath: string;
  json: boolean;
}

export type ParsedInspectArguments =
  | { success: true; options: InspectCommandOptions }
  | { success: false; error: CliError };

export function parseInspectArguments(args: string[]): ParsedInspectArguments {
  const options: InspectCommandOptions = {
    configPath: "./mcp-forge.json",
    rootPath: ".",
    statePath: ".mcp-forge/generated-state.json",
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
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
      if (argument !== name && !argument?.startsWith(`${name}=`)) continue;
      const inline = argument.startsWith(`${name}=`);
      const value = inline ? argument.slice(name.length + 1) : args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        return {
          success: false,
          error: createCliError(
            "CLI_INVALID_ARGUMENT",
            `${name} requires a value.`,
          ),
        };
      }
      options[key] = value;
      if (!inline) index += 1;
      matched = true;
      break;
    }
    if (!matched) {
      return {
        success: false,
        error: createCliError(
          "CLI_INVALID_ARGUMENT",
          argument?.startsWith("--")
            ? `Unknown option: ${argument}`
            : "inspect does not accept positional arguments.",
        ),
      };
    }
  }
  return { success: true, options };
}
