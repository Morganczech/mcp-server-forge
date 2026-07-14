export const CLI_EXIT_CODES = {
  success: 0,
  validationError: 1,
  fileError: 2,
  warningsAsErrors: 3,
  invalidUsage: 4,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];
