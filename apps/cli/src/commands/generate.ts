import { resolve } from "node:path";

import {
  createForgeApplyContract,
  createProjectChangePlan,
  type ForgeApplyContract,
} from "@mcp-server-forge/core";
import {
  applyGenerationWorkspace,
  loadGenerationState,
  loadTargetState,
  loadTemplateBundle,
  type ForgeManagedTargetPath,
} from "@mcp-server-forge/fs-adapter";
import {
  createGenerationPreview,
  renderForgeTemplate,
  type ForgeGenerationPreview,
  type ForgeRenderResult,
} from "@mcp-server-forge/generators";
import {
  compareAscii,
  type ForgeGenerationState,
  type ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import {
  formatDiagnostics,
  hasErrors,
  sortDiagnostics,
  validateForgeProject,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import type { CliContext } from "../cli.js";
import { loadConfigFile } from "../config/load-config.js";
import { CLI_EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { renderPreviewOutput } from "../output/render-preview.js";
import type { GenerateCommandOptions } from "./generate-options.js";

interface PreparedGeneration {
  success: true;
  exitCode: CliExitCode;
  configPath: string;
  projectRoot: string;
  templatePath: string;
  template: { id: string; version: string };
  manifest: ForgeTemplateManifest;
  renderResult: ForgeRenderResult;
  previousState?: ForgeGenerationState;
  preview: ForgeGenerationPreview;
  diagnostics: ForgeDiagnostic[];
}

interface FailedPreparation {
  success: false;
  exitCode: CliExitCode;
  message: string;
}

function hasUnexpectedPlanningError(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): boolean {
  return diagnostics.some(
    ({ code, severity }) =>
      severity === "error" && code !== "PLAN_FILE_CONFLICT",
  );
}

function failure(
  exitCode: CliExitCode,
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
  fallback: string,
): FailedPreparation {
  return {
    success: false,
    exitCode,
    message:
      diagnostics.length === 0
        ? `${fallback}\n`
        : `${formatDiagnostics(diagnostics)}\n`,
  };
}

async function prepareGeneration(
  options: GenerateCommandOptions,
  context: CliContext,
): Promise<PreparedGeneration | FailedPreparation> {
  const projectRoot = resolve(context.cwd, options.rootPath);
  const templatePath = resolve(context.cwd, options.templatePath);
  const loadedConfig = await loadConfigFile(options.configPath, context.cwd);
  if (!loadedConfig.success) {
    return failure(
      CLI_EXIT_CODES.fileError,
      [],
      `ERROR ${loadedConfig.error.code}: ${loadedConfig.error.message}`,
    );
  }
  const validation = validateForgeProject(loadedConfig.value);
  if (!validation.success) {
    return failure(
      CLI_EXIT_CODES.validationError,
      validation.diagnostics,
      "Configuration validation failed.",
    );
  }
  const template = await loadTemplateBundle(templatePath);
  if (!template.success || template.bundle === undefined) {
    return failure(
      CLI_EXIT_CODES.fileError,
      template.diagnostics,
      "Template loading failed.",
    );
  }
  const identity = {
    id: template.bundle.manifest.template.id,
    version: template.bundle.manifest.template.version,
  };
  const renderResult = renderForgeTemplate({
    config: validation.data,
    manifest: template.bundle.manifest,
    templateSources: template.bundle.templateSources,
    options: { includeConditionSkipDiagnostics: options.showSkipped },
  });
  if (!renderResult.success || hasErrors(renderResult.diagnostics)) {
    return failure(
      CLI_EXIT_CODES.validationError,
      renderResult.diagnostics,
      "Template rendering failed.",
    );
  }
  const previous = await loadGenerationState(projectRoot, {
    statePath: options.statePath,
  });
  if (!previous.success) {
    return failure(
      CLI_EXIT_CODES.fileError,
      previous.diagnostics,
      "Generation state loading failed.",
    );
  }
  const managedByPath = new Map<string, ForgeManagedTargetPath>();
  for (const file of renderResult.files) {
    managedByPath.set(file.path, {
      path: file.path,
      expectedExecutable: file.executable,
    });
  }
  for (const file of previous.state?.files ?? []) {
    if (!managedByPath.has(file.path)) {
      managedByPath.set(file.path, { path: file.path });
    }
  }
  const targets = await loadTargetState(
    projectRoot,
    [...managedByPath.values()].sort((left, right) =>
      compareAscii(left.path, right.path),
    ),
  );
  if (!targets.success) {
    return failure(
      CLI_EXIT_CODES.fileError,
      targets.diagnostics,
      "Target inspection failed.",
    );
  }
  const preview = createGenerationPreview({
    renderResult,
    manifest: template.bundle.manifest,
    targetState: targets.targetState,
    ...(previous.state === undefined ? {} : { previousState: previous.state }),
    options: { allowExplicitReplace: options.allowExplicitReplace },
  });
  const diagnostics = sortDiagnostics([
    ...validation.diagnostics,
    ...template.diagnostics,
    ...previous.diagnostics,
    ...targets.diagnostics,
    ...preview.diagnostics,
  ]);
  const unexpectedPlanningError = hasUnexpectedPlanningError(diagnostics);
  return {
    success: true,
    exitCode: unexpectedPlanningError
      ? CLI_EXIT_CODES.validationError
      : preview.safeToApply
        ? CLI_EXIT_CODES.success
        : CLI_EXIT_CODES.unsafePreview,
    configPath: loadedConfig.configPath,
    projectRoot,
    templatePath,
    template: identity,
    manifest: template.bundle.manifest,
    renderResult,
    ...(previous.state === undefined ? {} : { previousState: previous.state }),
    preview,
    diagnostics,
  };
}

function createContract(prepared: PreparedGeneration, generatedAt: string) {
  return createForgeApplyContract({
    renderResult: prepared.renderResult,
    preview: prepared.preview,
    manifest: prepared.manifest,
    ...(prepared.previousState === undefined
      ? {}
      : { previousState: prepared.previousState }),
    generatedAt,
  });
}

function sameContract(
  displayed: ForgeApplyContract,
  refreshed: ForgeApplyContract,
): boolean {
  return JSON.stringify(displayed) === JSON.stringify(refreshed);
}

export async function runGenerateCommand(
  options: GenerateCommandOptions,
  context: CliContext,
): Promise<CliExitCode> {
  const displayed = await prepareGeneration(options, context);
  if (!displayed.success) {
    context.stderr.write(displayed.message);
    return displayed.exitCode;
  }
  context.stdout.write(
    renderPreviewOutput({
      success: displayed.exitCode !== CLI_EXIT_CODES.validationError,
      configPath: displayed.configPath,
      projectRoot: displayed.projectRoot,
      templatePath: displayed.templatePath,
      template: displayed.template,
      preview: displayed.preview,
      renderedFiles: displayed.renderResult.files,
      diagnostics: displayed.diagnostics,
      format: "table",
      showContent: false,
      showSkipped: options.showSkipped,
    }),
  );
  if (displayed.exitCode !== CLI_EXIT_CODES.success) {
    return displayed.exitCode;
  }

  const generatedAt = context.now?.() ?? new Date().toISOString();
  const displayedContract = createContract(displayed, generatedAt);
  const displayedPlan = createProjectChangePlan(displayed.preview, generatedAt);
  if (!displayedContract.success) {
    context.stderr.write(
      `${formatDiagnostics(displayedContract.diagnostics)}\n`,
    );
    return CLI_EXIT_CODES.validationError;
  }
  if (displayedContract.data.operations.length === 0) {
    context.stdout.write(
      "No file changes to apply; generation state was not changed.\n",
    );
    return CLI_EXIT_CODES.success;
  }
  if (!context.isInteractive || context.confirm === undefined) {
    context.stderr.write(
      "Generation was not applied: an interactive TTY confirmation is required.\n",
    );
    return CLI_EXIT_CODES.applyNotConfirmed;
  }
  const confirmed = await context.confirm(
    `Apply plan ${displayedPlan.planId} and update generation state? [y/N] `,
  );
  if (!confirmed) {
    context.stderr.write("Generation was not applied.\n");
    return CLI_EXIT_CODES.applyNotConfirmed;
  }

  const refreshed = await prepareGeneration(options, context);
  if (!refreshed.success || refreshed.exitCode !== CLI_EXIT_CODES.success) {
    context.stderr.write(
      "Generation was not applied because the preview changed after " +
        "confirmation. Preview again.\n",
    );
    return refreshed.success
      ? refreshed.exitCode
      : CLI_EXIT_CODES.unsafePreview;
  }
  const refreshedContract = createContract(refreshed, generatedAt);
  const refreshedPlan = createProjectChangePlan(refreshed.preview, generatedAt);
  if (
    !refreshedContract.success ||
    refreshedPlan.planId !== displayedPlan.planId ||
    refreshedPlan.planHash !== displayedPlan.planHash ||
    !sameContract(displayedContract.data, refreshedContract.data)
  ) {
    context.stderr.write(
      "Generation was not applied because the confirmed plan changed. " +
        "Preview again.\n",
    );
    return CLI_EXIT_CODES.unsafePreview;
  }

  const applied = await applyGenerationWorkspace({
    projectRoot: refreshed.projectRoot,
    statePath: options.statePath,
    contract: refreshedContract.data,
  });
  if (!applied.success) {
    context.stderr.write(`${formatDiagnostics(applied.diagnostics)}\n`);
    if (applied.appliedFiles.length > 0) {
      context.stderr.write(
        `Files written before failure: ${applied.appliedFiles.join(", ")}\n`,
      );
    }
    return applied.diagnostics.some(
      ({ code }) => code === "APPLY_TARGET_CHANGED",
    )
      ? CLI_EXIT_CODES.unsafePreview
      : CLI_EXIT_CODES.fileError;
  }
  context.stdout.write(
    `Applied ${applied.appliedFiles.length} file change(s) and updated ` +
      `${options.statePath}.\n`,
  );
  return CLI_EXIT_CODES.success;
}
