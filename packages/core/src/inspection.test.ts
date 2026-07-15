import type { ForgeGenerationPreview } from "@mcp-server-forge/generators";
import { describe, expect, it } from "vitest";

import {
  createPermissionDeclaration,
  createProjectChangePlan,
  createProjectInspection,
  isForgeProjectChangePlan,
  isForgeProjectInspection,
} from "./index.js";

const preview: ForgeGenerationPreview = {
  success: true,
  safeToApply: true,
  files: [
    {
      path: "src/index.ts",
      action: "create",
      reasonCode: "TARGET_MISSING",
      ownership: "forge-owned",
      updateStrategy: "replace-if-unmodified",
      renderedHash: "a".repeat(64),
    },
  ],
  orphanedFiles: [],
  summary: { create: 1, replace: 0, skip: 0, conflict: 0, manualReview: 0 },
  diagnostics: [],
  metadata: {
    templateId: "test-template",
    templateVersion: "1.0.0",
    renderedFileCount: 1,
    plannedFileCount: 1,
  },
};

describe("Forge engine inspection contracts", () => {
  it("represents undeclared permissions without treating metadata as access", () => {
    expect(
      createPermissionDeclaration({
        permission: "environment",
        description: "Generated server environment access.",
      }),
    ).toEqual({
      permission: "environment",
      status: "not-declared",
      scope: [],
      source: "not declared",
      description: "Generated server environment access.",
    });
  });

  it("creates a deterministic structured project inspection", () => {
    const input = {
      project: { initialized: true, name: "test", title: "Test" },
      stateAvailable: false,
      preview,
      permissions: [
        {
          permission: "filesystem.write" as const,
          declared: true,
          allowed: false,
          description: "Generated server file writes.",
        },
      ],
    };
    const first = createProjectInspection(input);

    expect(first).toEqual(createProjectInspection(input));
    expect(first).toMatchObject({
      inspectionVersion: "1",
      status: "healthy",
      generation: { safeToApply: true },
      summary: { files: 1, conflicts: 0, warnings: 0, errors: 0 },
    });
    expect(isForgeProjectInspection(JSON.parse(JSON.stringify(first)))).toBe(
      true,
    );
  });

  it("preserves ownership for orphaned generated files", () => {
    const orphanedPreview = structuredClone(preview);
    orphanedPreview.safeToApply = false;
    orphanedPreview.orphanedFiles = [
      {
        path: "data/contacts.json",
        ownership: "user-owned",
        updateStrategy: "create-once",
        previousGeneratedHash: "b".repeat(64),
        targetExists: true,
        modifiedSinceGeneration: true,
      },
    ];

    const inspection = createProjectInspection({
      project: { initialized: true },
      stateAvailable: true,
      preview: orphanedPreview,
    });

    expect(
      inspection.generation.files.find(
        ({ path }) => path === "data/contacts.json",
      ),
    ).toMatchObject({ status: "orphaned", ownership: "user-owned" });
  });

  it("derives a stable change-plan identity without a boolean confirmation", () => {
    const first = createProjectChangePlan(preview, "2026-07-15T08:00:00.000Z");
    const second = createProjectChangePlan(preview, "2026-07-15T09:00:00.000Z");

    expect(first.planId).toBe(second.planId);
    expect(first.planHash).toBe(second.planHash);
    expect(first).not.toHaveProperty("confirmed");
    expect(first.dataEffects).toEqual({
      writesFiles: true,
      deletesFiles: false,
      writesGenerationState: true,
      projectWideTransaction: false,
    });
    expect(isForgeProjectChangePlan(JSON.parse(JSON.stringify(first)))).toBe(
      true,
    );

    const tampered = structuredClone(first);
    tampered.risk = "high";
    expect(isForgeProjectChangePlan(tampered)).toBe(false);
  });

  it("reports tracked-file conflicts without needing a template render", () => {
    const inspection = createProjectInspection({
      project: { initialized: true },
      stateAvailable: true,
      trackedFiles: [
        {
          path: "a.txt",
          exists: true,
          currentHash: "new",
          generatedHash: "old",
        },
      ],
    });

    expect(inspection.status).toBe("error");
    expect(inspection.generation.files[0]?.status).toBe("conflict");
  });
});
