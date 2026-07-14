import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { createCliError, type CliError } from "../errors/cli-errors.js";

export interface LoadedConfig {
  success: true;
  configPath: string;
  value: Record<string, unknown>;
}

export interface ConfigLoadFailure {
  success: false;
  configPath: string;
  error: CliError;
}

export type ConfigLoadResult = LoadedConfig | ConfigLoadFailure;

function absoluteConfigPath(configPath: string, cwd: string): string {
  return isAbsolute(configPath)
    ? resolve(configPath)
    : resolve(cwd, configPath);
}

function nodeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return undefined;
}

export async function loadConfigFile(
  configPath: string,
  cwd: string,
): Promise<ConfigLoadResult> {
  const resolvedPath = absoluteConfigPath(configPath, cwd);
  let fileStats;

  try {
    fileStats = await stat(resolvedPath);
  } catch (error) {
    const systemCode = nodeErrorCode(error);

    if (systemCode === "ENOENT") {
      return {
        success: false,
        configPath: resolvedPath,
        error: createCliError(
          "CLI_FILE_NOT_FOUND",
          "The configuration file does not exist.",
          { path: resolvedPath },
        ),
      };
    }

    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_FILE_READ_FAILED",
        "The configuration path could not be inspected.",
        {
          path: resolvedPath,
          ...(systemCode === undefined ? {} : { details: { systemCode } }),
        },
      ),
    };
  }

  if (fileStats.isDirectory()) {
    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_PATH_IS_DIRECTORY",
        "The configuration path points to a directory, not a file.",
        { path: resolvedPath },
      ),
    };
  }

  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (error) {
    const systemCode = nodeErrorCode(error);

    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_FILE_READ_FAILED",
        "The configuration file could not be read as UTF-8.",
        {
          path: resolvedPath,
          ...(systemCode === undefined ? {} : { details: { systemCode } }),
        },
      ),
    };
  }

  if (source.trim().length === 0) {
    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_EMPTY_FILE",
        "The configuration file is empty.",
        { path: resolvedPath },
      ),
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_JSON_PARSE_FAILED",
        "The configuration file does not contain valid JSON.",
        { path: resolvedPath },
      ),
    };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      success: false,
      configPath: resolvedPath,
      error: createCliError(
        "CLI_JSON_ROOT_INVALID",
        "The configuration JSON root must be an object.",
        { path: resolvedPath },
      ),
    };
  }

  return {
    success: true,
    configPath: resolvedPath,
    value: value as Record<string, unknown>,
  };
}
