import { resolve } from "node:path";

import type { PreviewCommandOptions } from "../commands/preview-options.js";

export interface ResolvedPreviewInputs {
  configPath: string;
  projectRoot: string;
  templatePath: string;
  statePath: string;
}

export function resolvePreviewInputs(
  options: PreviewCommandOptions,
  cwd: string,
): ResolvedPreviewInputs {
  return {
    configPath: resolve(cwd, options.configPath),
    projectRoot: resolve(cwd, options.rootPath),
    templatePath: resolve(cwd, options.templatePath),
    statePath: options.statePath,
  };
}
