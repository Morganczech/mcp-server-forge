import { createCliError, type CliError } from "../errors/cli-errors.js";

export type PreviewOutputFormat = "table" | "compact" | "detailed" | "json";

export interface PreviewCommandOptions {
  configPath: string;
  rootPath: string;
  templatePath: string;
  format: PreviewOutputFormat;
  statePath: string;
  noState: boolean;
  showContent: boolean;
  showSkipped: boolean;
  warningsAsErrors: boolean;
  allowExplicitReplace: boolean;
  quiet: boolean;
}

export type ParsedPreviewArguments =
  | { success: true; options: PreviewCommandOptions }
  | { success: false; error: CliError };

const formats = new Set<PreviewOutputFormat>([
  "table",
  "compact",
  "detailed",
  "json",
]);

function invalid(message: string): ParsedPreviewArguments {
  return {
    success: false,
    error: createCliError("CLI_INVALID_ARGUMENT", message),
  };
}

function optionValue(
  args: string[],
  index: number,
  name: string,
): { value?: string; consumed: number } | undefined {
  const argument = args[index];
  if (argument === name) {
    const value = args[index + 1];
    return {
      ...(value === undefined || value.startsWith("--") ? {} : { value }),
      consumed: 1,
    };
  }
  const prefix = `${name}=`;
  return argument?.startsWith(prefix)
    ? { value: argument.slice(prefix.length), consumed: 0 }
    : undefined;
}

export function parsePreviewArguments(args: string[]): ParsedPreviewArguments {
  const options: PreviewCommandOptions = {
    configPath: "./mcp-forge.json",
    rootPath: ".",
    templatePath: "",
    format: "table",
    statePath: ".mcp-forge/generated-state.json",
    noState: false,
    showContent: false,
    showSkipped: false,
    warningsAsErrors: false,
    allowExplicitReplace: false,
    quiet: false,
  };
  let stateWasSet = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const booleanOption = {
      "--no-state": "noState",
      "--show-content": "showContent",
      "--show-skipped": "showSkipped",
      "--warnings-as-errors": "warningsAsErrors",
      "--allow-explicit-replace": "allowExplicitReplace",
      "--quiet": "quiet",
    }[argument ?? ""] as
      | keyof Pick<
          PreviewCommandOptions,
          | "noState"
          | "showContent"
          | "showSkipped"
          | "warningsAsErrors"
          | "allowExplicitReplace"
          | "quiet"
        >
      | undefined;
    if (booleanOption !== undefined) {
      options[booleanOption] = true;
      continue;
    }

    const valueOptions = [
      ["--config", "configPath"],
      ["--root", "rootPath"],
      ["--template", "templatePath"],
      ["--state", "statePath"],
      ["--format", "format"],
    ] as const;
    let matched = false;
    for (const [name, key] of valueOptions) {
      const parsed = optionValue(args, index, name);
      if (parsed === undefined) continue;
      if (parsed.value === undefined || parsed.value.length === 0) {
        return invalid(`${name} requires a value.`);
      }
      if (key === "format") {
        if (!formats.has(parsed.value as PreviewOutputFormat)) {
          return invalid("--format must be table, compact, detailed, or json.");
        }
        options.format = parsed.value as PreviewOutputFormat;
      } else {
        options[key] = parsed.value;
        if (key === "statePath") stateWasSet = true;
      }
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (matched) continue;

    return invalid(
      argument?.startsWith("--")
        ? `Unknown option: ${argument}`
        : "preview does not accept positional arguments.",
    );
  }

  if (options.templatePath.length === 0) {
    return invalid("--template is required for preview.");
  }
  if (options.noState && stateWasSet) {
    return invalid("--state and --no-state cannot be used together.");
  }
  return { success: true, options };
}
