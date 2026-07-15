import {
  hashGeneratedContent,
  type ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import type {
  ForgeGenerationPreview,
  ForgeRenderResult,
} from "@mcp-server-forge/generators";
import { describe, expect, it } from "vitest";

import {
  createForgeApplyContract,
  validateForgeApplyContract,
} from "./index.js";

const manifest: ForgeTemplateManifest = {
  manifestVersion: "1",
  template: {
    id: "test-template",
    version: "1.0.0",
    title: "Test",
    description: "Test template.",
    kind: "server",
    runtime: "node",
    language: "typescript",
  },
  compatibility: { forgeConfigSchema: ["1"] },
  files: [
    {
      path: "src/index.ts",
      source: "files/index.ts.hbs",
      ownership: "forge-owned",
      updateStrategy: "replace-if-unmodified",
      required: true,
    },
  ],
};

function inputs(action: "create" | "skip" = "create") {
  const content = "export const ok = true;\n";
  const contentHash = hashGeneratedContent(content);
  const renderResult: ForgeRenderResult = {
    success: true,
    files: [
      {
        path: "src/index.ts",
        content,
        contentHash,
        executable: false,
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        source: "files/index.ts.hbs",
      },
    ],
    diagnostics: [],
    metadata: {
      templateId: "test-template",
      templateVersion: "1.0.0",
      manifestVersion: "1",
      renderedFileCount: 1,
      skippedFileCount: 0,
      skippedFiles: [],
      renderEngine: "mcp-forge-restricted",
      renderEngineVersion: "1",
      hashAlgorithm: "sha256",
      lineEndings: "lf",
      trailingNewline: "exactly-one",
    },
  };
  const preview: ForgeGenerationPreview = {
    success: true,
    safeToApply: true,
    files: [
      {
        path: "src/index.ts",
        action,
        reasonCode:
          action === "create" ? "TARGET_MISSING" : "TARGET_ALREADY_MATCHES",
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        renderedHash: contentHash,
        ...(action === "skip" ? { targetHash: contentHash } : {}),
      },
    ],
    orphanedFiles: [],
    summary: {
      create: action === "create" ? 1 : 0,
      replace: 0,
      skip: action === "skip" ? 1 : 0,
      conflict: 0,
      manualReview: 0,
    },
    diagnostics: [],
    metadata: {
      templateId: "test-template",
      templateVersion: "1.0.0",
      renderedFileCount: 1,
      plannedFileCount: 1,
    },
  };
  return { renderResult, preview };
}

describe("Forge apply contract", () => {
  it("creates a deterministic pure contract from a safe preview", () => {
    const result = createForgeApplyContract({
      ...inputs(),
      manifest,
      generatedAt: "2026-07-15T08:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.operations).toMatchObject([
      {
        path: "src/index.ts",
        action: "create",
        expectedTarget: { exists: false },
      },
    ]);
    expect(result.data.nextState.files).toHaveLength(1);
    expect(validateForgeApplyContract(result.data).success).toBe(true);
  });

  it("does not adopt a matching but previously untracked skipped file", () => {
    const result = createForgeApplyContract({
      ...inputs("skip"),
      manifest,
      generatedAt: "2026-07-15T08:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.operations).toEqual([]);
    expect(result.data.nextState.files).toEqual([]);
  });

  it("rejects unsafe previews and standalone declared directories", () => {
    const unsafe = inputs();
    unsafe.preview.safeToApply = false;
    expect(
      createForgeApplyContract({
        ...unsafe,
        manifest,
        generatedAt: "2026-07-15T08:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      createForgeApplyContract({
        ...inputs(),
        manifest: {
          ...manifest,
          directories: [{ path: "empty", required: true }],
        },
        generatedAt: "2026-07-15T08:00:00.000Z",
      }).diagnostics.map(({ code }) => code),
    ).toContain("APPLY_DIRECTORY_UNSUPPORTED");
  });

  it("rejects path conflicts and untracked extra state in serialized contracts", () => {
    const result = createForgeApplyContract({
      ...inputs(),
      manifest,
      generatedAt: "2026-07-15T08:00:00.000Z",
    });
    if (!result.success) throw new Error("fixture contract must be valid");
    const conflicting = structuredClone(result.data);
    conflicting.operations.push({
      ...conflicting.operations[0]!,
      path: "src/index.ts/nested",
    });
    conflicting.nextState.files.push({
      ...conflicting.nextState.files[0]!,
      path: "src/index.ts/nested",
    });
    expect(validateForgeApplyContract(conflicting).success).toBe(false);

    const adopted = structuredClone(result.data);
    adopted.nextState.files.push({
      ...adopted.nextState.files[0]!,
      path: "untracked.txt",
    });
    expect(validateForgeApplyContract(adopted).success).toBe(false);

    const wrongPreviousTemplate = structuredClone(result.data);
    wrongPreviousTemplate.previousState = {
      ...wrongPreviousTemplate.nextState,
      templateId: "different-template",
    };
    expect(validateForgeApplyContract(wrongPreviousTemplate).success).toBe(
      false,
    );

    const droppedPreviousFile = structuredClone(result.data);
    droppedPreviousFile.previousState = structuredClone(
      droppedPreviousFile.nextState,
    );
    droppedPreviousFile.operations = [];
    droppedPreviousFile.nextState.files = [];
    expect(validateForgeApplyContract(droppedPreviousFile).success).toBe(false);
  });
});
