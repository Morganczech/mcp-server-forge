export const FORGE_MCP_TOOL_NAMES = [
  "forge_get_status",
  "forge_list_projects",
  "forge_inspect_project",
  "forge_get_permissions",
  "forge_list_generated_files",
  "forge_preview_project",
  "forge_explain_diagnostic",
] as const;

export const MAX_CATALOG_BYTES = 256 * 1024;
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const MAX_PROJECTS_PER_PAGE = 50;
export const MAX_FILES_PER_PAGE = 100;
export const MAX_DIAGNOSTICS = 50;
export const MAX_USER_TEXT_LENGTH = 512;
export const MAX_TOOL_RESPONSE_BYTES = 64 * 1024;
