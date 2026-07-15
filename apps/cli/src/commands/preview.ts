import {
  loadGenerationState,
  loadTargetState,
  loadComposedTemplateBundle,
  type ForgeGenerationStateLoadResult,
  type ForgeManagedTargetPath,
} from "@mcp-server-forge/fs-adapter";
import {
  createGenerationPreview,
  renderForgeTemplate,
} from "@mcp-server-forge/generators";
import { compareAscii } from "@mcp-server-forge/templates";
import {
  hasErrors,
  sortDiagnostics,
  validateForgeProject,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { loadConfigFile } from "../config/load-config.js";
import { resolvePreviewInputs } from "../config/resolve-preview-inputs.js";
import { CLI_EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { countDiagnostics } from "../output/json-output.js";
import { renderPreviewOutput } from "../output/render-preview.js";
import type { ValidateCommandContext } from "./validate.js";
import type { PreviewCommandOptions } from "./preview-options.js";

function absentGenerationState(): ForgeGenerationStateLoadResult {
  return { success: true, available: false, diagnostics: [] };
}

function writePreviewOutput(
  context: ValidateCommandContext,
  format: PreviewCommandOptions["format"],
  output: string,
  loadingFailure = false,
): void {
  const writer =
    format === "json" || !loadingFailure ? context.stdout : context.stderr;
  writer.write(output);
}

function hasUnexpectedPlanningError(
  diagnostics: ReadonlyArray<ForgeDiagnostic>,
): boolean {
  return diagnostics.some(
    ({ code, severity }) =>
      severity === "error" && code !== "PLAN_FILE_CONFLICT",
  );
}

export async function runPreviewCommand(
  options: PreviewCommandOptions,
  context: ValidateCommandContext,
): Promise<CliExitCode> {
  const inputs = resolvePreviewInputs(options, context.cwd);
  const failure = (
    exitCode: CliExitCode,
    failureOptions: {
      diagnostics?: ForgeDiagnostic[];
      cliError?: Parameters<typeof renderPreviewOutput>[0]["cliError"];
      template?: { id: string; version: string };
      loadingFailure?: boolean;
    } = {},
  ): CliExitCode => {
    const output = renderPreviewOutput({
      success: false,
      configPath: inputs.configPath,
      projectRoot: inputs.projectRoot,
      templatePath: inputs.templatePath,
      diagnostics: failureOptions.diagnostics ?? [],
      format: options.format,
      showContent: options.showContent,
      showSkipped: options.showSkipped,
      ...(failureOptions.cliError === undefined
        ? {}
        : { cliError: failureOptions.cliError }),
      ...(failureOptions.template === undefined
        ? {}
        : { template: failureOptions.template }),
    });
    writePreviewOutput(
      context,
      options.format,
      output,
      failureOptions.loadingFailure,
    );
    return exitCode;
  };

  const loadedConfig = await loadConfigFile(inputs.configPath, context.cwd);
  if (!loadedConfig.success) {
    return failure(CLI_EXIT_CODES.fileError, {
      cliError: loadedConfig.error,
      loadingFailure: true,
    });
  }

  const validation = validateForgeProject(loadedConfig.value);
  if (!validation.success) {
    return failure(CLI_EXIT_CODES.validationError, {
      diagnostics: validation.diagnostics,
    });
  }

  const template = await loadComposedTemplateBundle(
    inputs.templatePath,
    inputs.capabilityRootPath,
    validation.data,
  );
  if (!template.success || template.bundle === undefined) {
    return failure(CLI_EXIT_CODES.fileError, {
      diagnostics: template.diagnostics,
      loadingFailure: true,
    });
  }
  const identity = {
    id: template.bundle.manifest.template.id,
    version: template.bundle.manifest.template.version,
  };

  const renderResult = renderForgeTemplate({
    config: template.bundle.effectiveConfig,
    manifest: template.bundle.manifest,
    templateSources: template.bundle.templateSources,
    ...(template.bundle.composition === undefined
      ? {}
      : { composition: template.bundle.composition }),
    options: {
      includeConditionSkipDiagnostics: options.showSkipped,
    },
  });
  if (!renderResult.success || hasErrors(renderResult.diagnostics)) {
    return failure(CLI_EXIT_CODES.validationError, {
      diagnostics: renderResult.diagnostics,
      template: identity,
    });
  }

  const generationState = options.noState
    ? absentGenerationState()
    : await loadGenerationState(inputs.projectRoot, {
        statePath: inputs.statePath,
      });
  if (!generationState.success) {
    return failure(CLI_EXIT_CODES.fileError, {
      diagnostics: generationState.diagnostics,
      template: identity,
      loadingFailure: true,
    });
  }

  const managedByPath = new Map<string, ForgeManagedTargetPath>();
  for (const file of renderResult.files) {
    managedByPath.set(file.path, {
      path: file.path,
      expectedExecutable: file.executable,
    });
  }
  for (const file of generationState.state?.files ?? []) {
    if (!managedByPath.has(file.path)) {
      managedByPath.set(file.path, { path: file.path });
    }
  }
  const managedPaths = [...managedByPath.values()].sort((left, right) =>
    compareAscii(left.path, right.path),
  );
  const targets = await loadTargetState(inputs.projectRoot, managedPaths);
  if (!targets.success) {
    return failure(CLI_EXIT_CODES.fileError, {
      diagnostics: targets.diagnostics,
      template: identity,
      loadingFailure: true,
    });
  }

  const preview = createGenerationPreview({
    renderResult,
    manifest: template.bundle.manifest,
    targetState: targets.targetState,
    ...(generationState.state === undefined
      ? {}
      : { previousState: generationState.state }),
    options: { allowExplicitReplace: options.allowExplicitReplace },
  });
  const diagnostics = sortDiagnostics([
    ...validation.diagnostics,
    ...template.diagnostics,
    ...generationState.diagnostics,
    ...targets.diagnostics,
    ...preview.diagnostics,
  ]);
  const summary = countDiagnostics(diagnostics);
  const unexpectedPlanningError = hasUnexpectedPlanningError(diagnostics);
  const exitCode: CliExitCode = unexpectedPlanningError
    ? CLI_EXIT_CODES.validationError
    : !preview.safeToApply
      ? CLI_EXIT_CODES.unsafePreview
      : options.warningsAsErrors && summary.warnings > 0
        ? CLI_EXIT_CODES.warningsAsErrors
        : CLI_EXIT_CODES.success;

  if (
    options.quiet &&
    options.format !== "json" &&
    exitCode === CLI_EXIT_CODES.success &&
    diagnostics.length === 0
  ) {
    return exitCode;
  }

  context.stdout.write(
    renderPreviewOutput({
      success: !unexpectedPlanningError,
      configPath: loadedConfig.configPath,
      projectRoot: inputs.projectRoot,
      templatePath: inputs.templatePath,
      template: identity,
      preview,
      renderedFiles: renderResult.files,
      diagnostics,
      format: options.format,
      showContent: options.showContent,
      showSkipped: options.showSkipped,
    }),
  );
  return exitCode;
}
