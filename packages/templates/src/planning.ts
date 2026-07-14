import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import { isOwnershipStrategyValid } from "./ownership.js";
import { compareAscii } from "./paths.js";
import type {
  FilePlanningInput,
  ForgeFilePlan,
  ForgeFilePlanningResult,
  ForgeGenerationPlan,
  ForgeGenerationPlanningInput,
} from "./types.js";

function result(
  input: FilePlanningInput,
  action: ForgeFilePlan["action"],
  reasonCode: ForgeFilePlan["reasonCode"],
  diagnostics: ForgeDiagnostic[] = [],
): ForgeFilePlanningResult {
  return {
    plan: {
      path: input.manifestFile.path,
      action,
      reasonCode,
      ownership: input.manifestFile.ownership,
      updateStrategy: input.manifestFile.updateStrategy,
    },
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function createFilePlan(
  input: FilePlanningInput,
): ForgeFilePlanningResult {
  const { manifestFile: file } = input;
  if (!isOwnershipStrategyValid(file.ownership, file.updateStrategy)) {
    return result(input, "conflict", "ownership-strategy-conflict", [
      createDiagnostic("TPL_FILE_OWNERSHIP_CONFLICT", [file.path], {
        ownership: file.ownership,
        updateStrategy: file.updateStrategy,
      }),
    ]);
  }

  if (!input.targetExists) {
    if (file.updateStrategy === "manual") {
      return result(input, "manual-review", "manual-strategy", [
        createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path]),
      ]);
    }
    return result(input, "create", "target-missing");
  }

  const executableChange =
    input.targetExecutable !== undefined &&
    input.renderedExecutable !== undefined &&
    input.targetExecutable !== input.renderedExecutable;

  if (
    input.targetHash !== undefined &&
    input.renderedHash !== undefined &&
    input.targetHash === input.renderedHash &&
    !executableChange
  ) {
    return result(input, "skip", "target-already-matches");
  }

  if (file.ownership === "user-owned") {
    if (file.updateStrategy === "manual" || executableChange) {
      return result(
        input,
        "manual-review",
        executableChange
          ? "executable-change-requires-review"
          : "manual-strategy",
        [createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path])],
      );
    }
    return result(input, "skip", "user-owned-preserved");
  }

  if (file.ownership === "shared") {
    return result(input, "manual-review", "shared-merge-unavailable", [
      createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path]),
    ]);
  }

  switch (file.updateStrategy) {
    case "create-once":
      if (executableChange) {
        return result(
          input,
          "manual-review",
          "executable-change-requires-review",
          [createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path])],
        );
      }
      return result(input, "skip", "create-once-preserved");
    case "manual":
      return result(input, "manual-review", "manual-strategy", [
        createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path]),
      ]);
    case "replace":
      return input.allowUnsafeReplace === true
        ? result(input, "replace", "unsafe-replace-approved")
        : result(input, "manual-review", "unsafe-replace-blocked", [
            createDiagnostic("TPL_UNSAFE_REPLACE_BLOCKED", [file.path]),
          ]);
    case "replace-if-unmodified": {
      if (
        input.targetHash === undefined ||
        input.previousGeneratedHash === undefined
      ) {
        return result(input, "conflict", "previous-state-missing", [
          createDiagnostic("TPL_FILE_OWNERSHIP_CONFLICT", [file.path]),
        ]);
      }
      if (input.targetHash === input.previousGeneratedHash) {
        return result(input, "replace", "target-unmodified");
      }
      return result(input, "conflict", "target-modified", [
        createDiagnostic("TPL_FILE_MODIFIED", [file.path]),
      ]);
    }
    case "merge-markers":
      return result(input, "manual-review", "shared-merge-unavailable", [
        createDiagnostic("TPL_MANUAL_REVIEW_REQUIRED", [file.path]),
      ]);
  }
}

export function createGenerationPlan(
  input: ForgeGenerationPlanningInput,
): ForgeGenerationPlan {
  const results = input.files.map(createFilePlan);
  const diagnostics = results.flatMap(({ diagnostics }) => diagnostics);

  if (
    input.previousState !== undefined &&
    (input.previousState.templateId !== input.templateId ||
      input.previousState.templateVersion !== input.templateVersion)
  ) {
    diagnostics.push(
      createDiagnostic("TPL_TEMPLATE_VERSION_MISMATCH", [], {
        requestedTemplateId: input.templateId,
        requestedTemplateVersion: input.templateVersion,
        stateTemplateId: input.previousState.templateId,
        stateTemplateVersion: input.previousState.templateVersion,
      }),
    );
  }

  const files = results
    .map(({ plan }) => plan)
    .sort((left, right) => compareAscii(left.path, right.path));
  const sortedDiagnostics = sortDiagnostics(diagnostics);
  const safeToApply =
    !hasErrors(sortedDiagnostics) &&
    files.every(({ action }) => ["create", "replace", "skip"].includes(action));

  return {
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    files,
    diagnostics: sortedDiagnostics,
    safeToApply,
  };
}
