export const CLI_ERROR_CODES = [
  "CLI_FILE_NOT_FOUND",
  "CLI_PATH_IS_DIRECTORY",
  "CLI_FILE_READ_FAILED",
  "CLI_JSON_PARSE_FAILED",
  "CLI_EMPTY_FILE",
  "CLI_JSON_ROOT_INVALID",
  "CLI_INVALID_ARGUMENT",
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

export interface CliError {
  code: CliErrorCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export function createCliError(
  code: CliErrorCode,
  message: string,
  options: { path?: string; details?: Record<string, unknown> } = {},
): CliError {
  return {
    code,
    message,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}
