import type { ForgeRenderedFile } from "@mcp-server-forge/generators";
import {
  compareAscii,
  hashGeneratedContent,
  isOwnershipStrategyValid,
  isPortableRelativePath,
  sortGeneratedFileStates,
  validateGenerationState,
  type ForgeGeneratedFileState,
  type ForgeGenerationState,
} from "@mcp-server-forge/templates";
import {
  createDiagnostic,
  hasErrors,
  sortDiagnostics,
  type ForgeDiagnostic,
} from "@mcp-server-forge/validators";

import type {
  ForgeApplyContract,
  ForgeApplyContractRequest,
  ForgeApplyContractResult,
  ForgeApplyContractValidationResult,
  ForgeApplyFileOperation,
  ForgeApplyRenderedLookup,
} from "./types.js";

const SHA_256 = /^[a-f0-9]{64}$/;

function renderedLookup(files: ForgeRenderedFile[]): ForgeApplyRenderedLookup {
  const byPath = new Map<string, ForgeRenderedFile>();
  const duplicatePaths: string[] = [];
  for (const file of files) {
    if (byPath.has(file.path)) duplicatePaths.push(file.path);
    else byPath.set(file.path, file);
  }
  return { byPath, duplicatePaths: duplicatePaths.sort(compareAscii) };
}

function validGeneratedAt(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function sameTemplate(
  request: ForgeApplyContractRequest,
  diagnostics: ForgeDiagnostic[],
): boolean {
  const id = request.manifest.template.id;
  const version = request.manifest.template.version;
  const matches =
    request.renderResult.metadata.templateId === id &&
    request.renderResult.metadata.templateVersion === version &&
    request.preview.metadata.templateId === id &&
    request.preview.metadata.templateVersion === version &&
    (request.previousState === undefined ||
      (request.previousState.templateId === id &&
        request.previousState.templateVersion === version));
  if (!matches) {
    diagnostics.push(createDiagnostic("APPLY_CONTRACT_INVALID", ["template"]));
  }
  return matches;
}

function standaloneDirectories(request: ForgeApplyContractRequest): string[] {
  const renderedPaths = request.renderResult.files.map(({ path }) => path);
  return (request.manifest.directories ?? [])
    .filter(
      ({ path }) =>
        !renderedPaths.some((renderedPath) =>
          renderedPath.startsWith(`${path}/`),
        ),
    )
    .map(({ path }) => path)
    .sort(compareAscii);
}

function stateFileForRendered(
  file: ForgeRenderedFile,
): ForgeGeneratedFileState {
  return {
    path: file.path,
    ownership: file.ownership,
    updateStrategy: file.updateStrategy,
    generatedHash: file.contentHash,
  };
}

function buildNextState(
  request: ForgeApplyContractRequest,
  rendered: ForgeApplyRenderedLookup,
): ForgeGenerationState {
  const previousByPath = new Map(
    (request.previousState?.files ?? []).map((file) => [file.path, file]),
  );
  const files: ForgeGeneratedFileState[] = [];
  for (const planned of request.preview.files) {
    const renderedFile = rendered.byPath.get(planned.path);
    if (
      renderedFile !== undefined &&
      (planned.action === "create" || planned.action === "replace")
    ) {
      files.push(stateFileForRendered(renderedFile));
      continue;
    }
    const previous = previousByPath.get(planned.path);
    if (planned.action === "skip" && previous !== undefined)
      files.push(previous);
  }
  return {
    stateVersion: "1",
    templateId: request.manifest.template.id,
    templateVersion: request.manifest.template.version,
    hashAlgorithm: "sha256",
    generatedAt: request.generatedAt,
    files: sortGeneratedFileStates(files),
  };
}

function operationFor(
  planned: ForgeApplyContractRequest["preview"]["files"][number],
  rendered: ForgeRenderedFile,
): ForgeApplyFileOperation {
  return {
    path: planned.path,
    action: planned.action as "create" | "replace",
    content: rendered.content,
    contentHash: rendered.contentHash,
    executable: rendered.executable,
    ownership: rendered.ownership,
    updateStrategy: rendered.updateStrategy,
    expectedTarget:
      planned.action === "create"
        ? { exists: false }
        : {
            exists: true,
            ...(planned.targetHash === undefined
              ? {}
              : { contentHash: planned.targetHash }),
            ...(planned.executableChange === undefined
              ? {}
              : {
                  executable: planned.executableChange
                    ? !rendered.executable
                    : rendered.executable,
                }),
          },
  };
}

export function createForgeApplyContract(
  request: ForgeApplyContractRequest,
): ForgeApplyContractResult {
  const diagnostics: ForgeDiagnostic[] = [];
  const rendered = renderedLookup(request.renderResult.files);

  if (
    !request.renderResult.success ||
    !request.preview.success ||
    !request.preview.safeToApply ||
    request.preview.orphanedFiles.length > 0 ||
    hasErrors([
      ...request.renderResult.diagnostics,
      ...request.preview.diagnostics,
    ])
  ) {
    diagnostics.push(createDiagnostic("APPLY_UNSAFE_PLAN", []));
  }
  sameTemplate(request, diagnostics);
  if (!validGeneratedAt(request.generatedAt)) {
    diagnostics.push(
      createDiagnostic("APPLY_CONTRACT_INVALID", ["generatedAt"]),
    );
  }
  for (const path of rendered.duplicatePaths) {
    diagnostics.push(createDiagnostic("APPLY_CONTRACT_INVALID", [path]));
  }
  for (const path of standaloneDirectories(request)) {
    diagnostics.push(createDiagnostic("APPLY_DIRECTORY_UNSUPPORTED", [path]));
  }

  const operations: ForgeApplyFileOperation[] = [];
  for (const planned of request.preview.files) {
    if (planned.action === "skip") continue;
    if (planned.action !== "create" && planned.action !== "replace") {
      diagnostics.push(createDiagnostic("APPLY_UNSAFE_PLAN", [planned.path]));
      continue;
    }
    const file = rendered.byPath.get(planned.path);
    if (
      file === undefined ||
      file.contentHash !== planned.renderedHash ||
      hashGeneratedContent(file.content) !== file.contentHash ||
      (planned.action === "replace" && planned.targetHash === undefined)
    ) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", [planned.path]),
      );
      continue;
    }
    operations.push(operationFor(planned, file));
  }

  const nextState = buildNextState(request, rendered);
  const stateValidation = validateGenerationState(nextState);
  diagnostics.push(...stateValidation.diagnostics);
  const sorted = sortDiagnostics(diagnostics);
  if (hasErrors(sorted) || !stateValidation.success) {
    return { success: false, diagnostics: sorted };
  }
  return {
    success: true,
    data: {
      contractVersion: "1",
      templateId: request.manifest.template.id,
      templateVersion: request.manifest.template.version,
      operations: operations.sort((left, right) =>
        compareAscii(left.path, right.path),
      ),
      previousState: request.previousState ?? null,
      nextState,
    },
    diagnostics: sorted,
  };
}

export function validateForgeApplyContract(
  input: unknown,
): ForgeApplyContractValidationResult {
  const diagnostics: ForgeDiagnostic[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      success: false,
      diagnostics: [createDiagnostic("APPLY_CONTRACT_INVALID", [])],
    };
  }
  const contract = input as Partial<ForgeApplyContract>;
  const operations = Array.isArray(contract.operations)
    ? contract.operations
    : [];
  if (
    contract.contractVersion !== "1" ||
    typeof contract.templateId !== "string" ||
    typeof contract.templateVersion !== "string" ||
    !Array.isArray(contract.operations) ||
    contract.nextState === undefined ||
    !(contract.previousState === null || contract.previousState !== undefined)
  ) {
    diagnostics.push(createDiagnostic("APPLY_CONTRACT_INVALID", []));
  }
  const seen = new Set<string>();
  const operationPaths: string[] = [];
  for (const [index, operation] of operations.entries()) {
    const valid =
      typeof operation === "object" &&
      operation !== null &&
      isPortableRelativePath(operation.path) &&
      !seen.has(operation.path) &&
      (operation.action === "create" || operation.action === "replace") &&
      typeof operation.content === "string" &&
      SHA_256.test(operation.contentHash) &&
      hashGeneratedContent(operation.content) === operation.contentHash &&
      typeof operation.executable === "boolean" &&
      isOwnershipStrategyValid(operation.ownership, operation.updateStrategy) &&
      typeof operation.expectedTarget === "object" &&
      operation.expectedTarget !== null &&
      typeof operation.expectedTarget.exists === "boolean" &&
      (operation.action !== "create" || !operation.expectedTarget.exists) &&
      (operation.action !== "replace" ||
        (operation.expectedTarget.exists &&
          typeof operation.expectedTarget.contentHash === "string" &&
          SHA_256.test(operation.expectedTarget.contentHash)));
    if (!valid) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", ["operations", index]),
      );
    }
    if (typeof operation === "object" && operation !== null) {
      seen.add(operation.path);
      operationPaths.push(operation.path);
    }
  }
  const sortedOperationPaths = [...operationPaths].sort(compareAscii);
  if (
    operationPaths.some((path, index) => path !== sortedOperationPaths[index])
  ) {
    diagnostics.push(
      createDiagnostic("APPLY_CONTRACT_INVALID", ["operations"]),
    );
  }
  for (const [index, path] of sortedOperationPaths.entries()) {
    const nextPath = sortedOperationPaths[index + 1];
    if (nextPath?.startsWith(`${path}/`)) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", ["operations", path]),
      );
    }
  }
  const nextStateValidation = validateGenerationState(contract.nextState);
  diagnostics.push(...nextStateValidation.diagnostics);
  const previousStateValidation =
    contract.previousState === null || contract.previousState === undefined
      ? undefined
      : validateGenerationState(contract.previousState);
  if (previousStateValidation !== undefined) {
    diagnostics.push(...previousStateValidation.diagnostics);
    if (
      previousStateValidation.success &&
      (previousStateValidation.data.templateId !== contract.templateId ||
        previousStateValidation.data.templateVersion !==
          contract.templateVersion)
    ) {
      diagnostics.push(
        createDiagnostic("APPLY_CONTRACT_INVALID", ["previousState"]),
      );
    }
  }
  if (
    nextStateValidation.success &&
    (nextStateValidation.data.templateId !== contract.templateId ||
      nextStateValidation.data.templateVersion !== contract.templateVersion)
  ) {
    diagnostics.push(createDiagnostic("APPLY_CONTRACT_INVALID", ["nextState"]));
  }
  if (nextStateValidation.success) {
    const stateByPath = new Map(
      nextStateValidation.data.files.map((file) => [file.path, file]),
    );
    const previousByPath = new Map(
      previousStateValidation?.success !== true
        ? []
        : previousStateValidation.data.files.map((file) => [file.path, file]),
    );
    for (const operation of operations) {
      const stateFile = stateByPath.get(operation.path);
      if (
        stateFile === undefined ||
        stateFile.generatedHash !== operation.contentHash ||
        stateFile.ownership !== operation.ownership ||
        stateFile.updateStrategy !== operation.updateStrategy
      ) {
        diagnostics.push(
          createDiagnostic("APPLY_CONTRACT_INVALID", [
            "nextState",
            operation.path,
          ]),
        );
      }
    }
    for (const stateFile of nextStateValidation.data.files) {
      const operation = operations.find(({ path }) => path === stateFile.path);
      const previous = previousByPath.get(stateFile.path);
      if (
        operation === undefined &&
        (previous === undefined ||
          previous.generatedHash !== stateFile.generatedHash ||
          previous.ownership !== stateFile.ownership ||
          previous.updateStrategy !== stateFile.updateStrategy ||
          previous.templateSourceHash !== stateFile.templateSourceHash)
      ) {
        diagnostics.push(
          createDiagnostic("APPLY_CONTRACT_INVALID", [
            "nextState",
            stateFile.path,
          ]),
        );
      }
    }
    if (previousStateValidation?.success === true) {
      for (const previousFile of previousStateValidation.data.files) {
        if (!stateByPath.has(previousFile.path)) {
          diagnostics.push(
            createDiagnostic("APPLY_CONTRACT_INVALID", [
              "nextState",
              previousFile.path,
            ]),
          );
        }
      }
    }
  }
  const sorted = sortDiagnostics(diagnostics);
  return hasErrors(sorted)
    ? { success: false, diagnostics: sorted }
    : { success: true, data: input as ForgeApplyContract, diagnostics: sorted };
}
