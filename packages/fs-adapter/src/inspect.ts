import { compareAscii } from "@mcp-server-forge/templates";
import { hasErrors, sortDiagnostics } from "@mcp-server-forge/validators";

import { loadGenerationState } from "./load-generation-state.js";
import { loadTargetState } from "./load-target-state.js";
import { loadTemplateBundle } from "./load-template-bundle.js";
import type {
  ForgeGenerationWorkspaceInspection,
  ForgeGenerationWorkspaceInspectionRequest,
  ForgeManagedTargetPath,
} from "./types.js";

export async function inspectGenerationWorkspace(
  request: ForgeGenerationWorkspaceInspectionRequest,
): Promise<ForgeGenerationWorkspaceInspection> {
  const [template, generationState] = await Promise.all([
    loadTemplateBundle(request.templateDirectory, request.options),
    loadGenerationState(request.projectRoot, {
      ...request.options,
      ...(request.statePath === undefined
        ? {}
        : { statePath: request.statePath }),
    }),
  ]);

  const managedByPath = new Map<string, ForgeManagedTargetPath>();
  for (const file of template.bundle?.manifest.files ?? []) {
    managedByPath.set(file.path, {
      path: file.path,
      ...(file.executable === undefined
        ? {}
        : { expectedExecutable: file.executable }),
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
  const targets = await loadTargetState(
    request.projectRoot,
    managedPaths,
    request.options,
  );
  const diagnostics = sortDiagnostics([
    ...template.diagnostics,
    ...generationState.diagnostics,
    ...targets.diagnostics,
  ]);
  const success = !hasErrors(diagnostics);
  return {
    success,
    safeToRenderAndPreview:
      success && template.bundle !== undefined && targets.success,
    targetState: targets.targetState,
    ...(generationState.state === undefined
      ? {}
      : { previousState: generationState.state }),
    ...(template.bundle === undefined
      ? {}
      : {
          manifest: template.bundle.manifest,
          templateSources: template.bundle.templateSources,
        }),
    diagnostics,
  };
}
