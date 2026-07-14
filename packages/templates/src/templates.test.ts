import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createFilePlan,
  createGenerationPlan,
  hashGeneratedContent,
  sortTemplateFiles,
  validateGenerationState,
  validateTemplateManifest,
  type FileOwnership,
  type FileUpdateStrategy,
  type ForgeTemplateFile,
} from "./index.js";

function fixture(group: "valid" | "invalid", fileName: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/${group}/${fileName}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function validManifest(): Record<string, unknown> {
  return structuredClone(
    fixture("valid", "basic-server-template.json"),
  ) as Record<string, unknown>;
}

function templateFile(
  ownership: FileOwnership,
  updateStrategy: FileUpdateStrategy,
): ForgeTemplateFile {
  return {
    path: "src/index.ts",
    source: "files/src/index.ts.hbs",
    ownership,
    updateStrategy,
    required: true,
  };
}

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map(({ code }) => code);
}

describe("template manifest validation", () => {
  it.each(["basic-typescript-server", "knowledge-typescript-server"])(
    "ships a valid %s example manifest",
    (templateId) => {
      const input = JSON.parse(
        readFileSync(
          new URL(`../templates/${templateId}/template.json`, import.meta.url),
          "utf8",
        ),
      ) as unknown;

      expect(validateTemplateManifest(input).success).toBe(true);
    },
  );

  it("validates and deterministically sorts a basic server manifest", () => {
    const result = validateTemplateManifest(
      fixture("valid", "basic-server-template.json"),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.template.kind).toBe("server");
      expect(result.data.files.map(({ path }) => path)).toEqual([
        "README.md",
        "src/index.ts",
      ]);
    }
  });

  it("validates a knowledge-server manifest and condition", () => {
    const result = validateTemplateManifest(
      fixture("valid", "knowledge-server-template.json"),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.template.kind).toBe("knowledge-server");
      expect(result.data.files[1]?.condition).toEqual({
        field: "knowledge.enabled",
        equals: true,
      });
    }
  });

  it("rejects an unsupported manifest version", () => {
    expect(
      codes(
        validateTemplateManifest(
          fixture("invalid", "unsupported-manifest-version.json"),
        ),
      ),
    ).toContain("TPL_MANIFEST_VERSION_UNSUPPORTED");
  });

  it("rejects reserved template kinds that are not implemented", () => {
    const input = validManifest();
    (input.template as Record<string, unknown>).kind = "registry-package";

    expect(codes(validateTemplateManifest(input))).toContain(
      "TPL_TEMPLATE_KIND_UNSUPPORTED",
    );
  });

  it("rejects an invalid template ID", () => {
    const input = validManifest();
    (input.template as Record<string, unknown>).id = "Invalid ID";

    expect(codes(validateTemplateManifest(input))).toContain(
      "TPL_TEMPLATE_ID_INVALID",
    );
  });

  it("rejects a floating template version", () => {
    const input = validManifest();
    (input.template as Record<string, unknown>).version = "latest";

    expect(codes(validateTemplateManifest(input))).toContain(
      "TPL_TEMPLATE_VERSION_INVALID",
    );
  });

  it.each([
    "../README.md",
    "/tmp/file.ts",
    "C:\\project\\file.ts",
    "src//index.ts",
  ])("rejects unsafe target path %s", (path) => {
    const input = validManifest();
    (
      (input.files as Array<Record<string, unknown>>)[0] as Record<
        string,
        unknown
      >
    ).path = path;

    expect(codes(validateTemplateManifest(input))).toContain(
      "TPL_FILE_PATH_INVALID",
    );
  });

  it.each([
    "../files/index",
    "/tmp/index",
    "https://example.com/a",
    "files/$(cmd)",
  ])("rejects unsafe source path %s", (source) => {
    const input = validManifest();
    (
      (input.files as Array<Record<string, unknown>>)[0] as Record<
        string,
        unknown
      >
    ).source = source;

    expect(codes(validateTemplateManifest(input))).toContain(
      "TPL_SOURCE_PATH_INVALID",
    );
  });

  it("rejects duplicate target paths", () => {
    expect(
      codes(
        validateTemplateManifest(
          fixture("invalid", "duplicate-file-path.json"),
        ),
      ),
    ).toContain("TPL_DUPLICATE_FILE_PATH");
  });

  it("rejects file and directory conflicts", () => {
    expect(
      codes(
        validateTemplateManifest(
          fixture("invalid", "file-directory-conflict.json"),
        ),
      ),
    ).toContain("TPL_FILE_DIRECTORY_CONFLICT");
  });

  it.each(["user-owned-replace.json", "shared-replace.json"])(
    "rejects invalid ownership in %s",
    (fileName) => {
      expect(
        codes(validateTemplateManifest(fixture("invalid", fileName))),
      ).toContain("TPL_OWNERSHIP_STRATEGY_INVALID");
    },
  );

  it("rejects unknown condition fields", () => {
    expect(
      codes(
        validateTemplateManifest(fixture("invalid", "invalid-condition.json")),
      ),
    ).toContain("TPL_CONDITION_INVALID");
  });
});

describe("generation state and deterministic utilities", () => {
  it("validates generation state without retaining file contents", () => {
    const result = validateGenerationState(
      fixture("valid", "generation-state.json"),
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('content"');
  });

  it("rejects a malformed SHA-256 hash", () => {
    const input = structuredClone(
      fixture("valid", "generation-state.json"),
    ) as Record<string, unknown>;
    (
      (input.files as Array<Record<string, unknown>>)[0] as Record<
        string,
        unknown
      >
    ).generatedHash = "not-a-hash";

    expect(codes(validateGenerationState(input))).toContain(
      "TPL_GENERATED_STATE_INVALID",
    );
  });

  it("sorts without mutating the caller's file list", () => {
    const files = [
      { ...templateFile("forge-owned", "replace-if-unmodified"), path: "z" },
      { ...templateFile("forge-owned", "replace-if-unmodified"), path: "a" },
    ];

    expect(sortTemplateFiles(files).map(({ path }) => path)).toEqual([
      "a",
      "z",
    ]);
    expect(files.map(({ path }) => path)).toEqual(["z", "a"]);
  });

  it("hashes content with deterministic SHA-256", () => {
    expect(hashGeneratedContent("forge")).toBe(
      "71b41d6dd48dc58eba8f5cf9edf30fef6597fdf285a521bb8fcbad4b3d50887d",
    );
    expect(hashGeneratedContent("forge")).toBe(hashGeneratedContent("forge"));
  });
});

describe("read-only file planning", () => {
  it("creates a missing create-once target", () => {
    expect(
      createFilePlan({
        manifestFile: templateFile("user-owned", "create-once"),
        targetExists: false,
      }).plan,
    ).toMatchObject({ action: "create", reasonCode: "target-missing" });
  });

  it("skips an existing create-once target", () => {
    expect(
      createFilePlan({
        manifestFile: templateFile("user-owned", "create-once"),
        targetExists: true,
      }).plan.action,
    ).toBe("skip");
  });

  it("replaces an unmodified replace-if-unmodified target", () => {
    expect(
      createFilePlan({
        manifestFile: templateFile("forge-owned", "replace-if-unmodified"),
        targetExists: true,
        targetHash: "same",
        previousGeneratedHash: "same",
      }).plan.action,
    ).toBe("replace");
  });

  it("reports conflict for a modified replace-if-unmodified target", () => {
    const result = createFilePlan({
      manifestFile: templateFile("forge-owned", "replace-if-unmodified"),
      targetExists: true,
      targetHash: "changed",
      previousGeneratedHash: "original",
    });

    expect(result.plan.action).toBe("conflict");
    expect(codes(result)).toContain("TPL_FILE_MODIFIED");
  });

  it("requires manual review for a shared target", () => {
    const result = createFilePlan({
      manifestFile: templateFile("shared", "merge-markers"),
      targetExists: true,
      targetHash: "changed",
      previousGeneratedHash: "original",
    });

    expect(result.plan.action).toBe("manual-review");
    expect(codes(result)).toContain("TPL_MANUAL_REVIEW_REQUIRED");
  });

  it("blocks replace unless explicit permission is present", () => {
    const blocked = createFilePlan({
      manifestFile: templateFile("forge-owned", "replace"),
      targetExists: true,
    });
    const approved = createFilePlan({
      manifestFile: templateFile("forge-owned", "replace"),
      targetExists: true,
      allowUnsafeReplace: true,
    });

    expect(blocked.plan.action).toBe("manual-review");
    expect(codes(blocked)).toContain("TPL_UNSAFE_REPLACE_BLOCKED");
    expect(approved.plan.action).toBe("replace");
  });

  it("sorts a generation plan and marks manual actions unsafe", () => {
    const plan = createGenerationPlan({
      templateId: "basic-typescript-server",
      templateVersion: "1.0.0",
      files: [
        {
          manifestFile: {
            ...templateFile("shared", "merge-markers"),
            path: "z.md",
          },
          targetExists: true,
        },
        {
          manifestFile: {
            ...templateFile("user-owned", "create-once"),
            path: "a.md",
          },
          targetExists: false,
        },
      ],
    });

    expect(plan.files.map(({ path }) => path)).toEqual(["a.md", "z.md"]);
    expect(plan.safeToApply).toBe(false);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it("diagnoses planning against another template version", () => {
    const state = fixture("valid", "generation-state.json") as Parameters<
      typeof createGenerationPlan
    >[0]["previousState"];
    const plan = createGenerationPlan({
      templateId: "basic-typescript-server",
      templateVersion: "2.0.0",
      files: [],
      previousState: state,
    });

    expect(codes(plan)).toContain("TPL_TEMPLATE_VERSION_MISMATCH");
    expect(plan.safeToApply).toBe(false);
  });
});

describe("domain boundaries", () => {
  it("keeps runtime source free of filesystem, network, and child processes", () => {
    const sourceFiles = [
      "hash.ts",
      "ownership.ts",
      "paths.ts",
      "planning.ts",
      "sort.ts",
      "types.ts",
      "validation.ts",
    ];

    for (const fileName of sourceFiles) {
      const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
      expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net)/);
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
