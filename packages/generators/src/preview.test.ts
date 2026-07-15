import { readFileSync } from "node:fs";

import { forgeConfigSchema } from "@mcp-server-forge/schemas";
import {
  hashGeneratedContent,
  validateTemplateManifest,
  type FileOwnership,
  type FileUpdateStrategy,
  type ForgeGeneratedFileState,
  type ForgeGenerationState,
  type ForgeTemplateFile,
  type ForgeTemplateManifest,
} from "@mcp-server-forge/templates";
import { describe, expect, it } from "vitest";

import {
  createGenerationPreview,
  renderForgeTemplate,
  validateGenerationPreviewRequest,
  type ForgeGenerationPreviewRequest,
  type ForgeRenderedFile,
  type ForgeRenderRequest,
  type ForgeTargetFileState,
} from "./index.js";

function loadBasicRenderRequest(): ForgeRenderRequest {
  const config = forgeConfigSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../fixtures/valid/basic-config.json", import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
  const manifestResult = validateTemplateManifest(
    JSON.parse(
      readFileSync(
        new URL(
          "../../templates/templates/basic-typescript-server/template.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
  if (!manifestResult.success) throw new Error("Expected valid basic manifest");
  const templateSources = Object.fromEntries(
    manifestResult.data.files.map(({ source }) => [
      source,
      readFileSync(
        new URL(
          `../../templates/templates/basic-typescript-server/${source}`,
          import.meta.url,
        ),
        "utf8",
      ),
    ]),
  );
  return { config, manifest: manifestResult.data, templateSources };
}

function renderedProject() {
  const request = loadBasicRenderRequest();
  const renderResult = renderForgeTemplate(request);
  if (!renderResult.success)
    throw new Error("Expected successful basic render");
  return { manifest: request.manifest, renderResult };
}

function stateFile(
  file: ForgeRenderedFile,
  overrides: Partial<ForgeGeneratedFileState> = {},
): ForgeGeneratedFileState {
  return {
    path: file.path,
    ownership: file.ownership,
    updateStrategy: file.updateStrategy,
    generatedHash: file.contentHash,
    ...overrides,
  };
}

function previousState(
  manifest: ForgeTemplateManifest,
  files: ForgeGeneratedFileState[],
  overrides: Partial<ForgeGenerationState> = {},
): ForgeGenerationState {
  return {
    stateVersion: "1",
    templateId: manifest.template.id,
    templateVersion: manifest.template.version,
    hashAlgorithm: "sha256",
    generatedAt: "2026-01-01T00:00:00.000Z",
    files,
    ...overrides,
  };
}

function singleFileRequest(
  path: string,
  options: {
    ownership?: FileOwnership;
    updateStrategy?: FileUpdateStrategy;
    target?: Omit<ForgeTargetFileState, "path">;
    previousHash?: string;
    previousOwnership?: FileOwnership;
    previousStrategy?: FileUpdateStrategy;
    allowExplicitReplace?: boolean;
    renderedExecutable?: boolean;
    targetExecutable?: boolean;
  } = {},
): ForgeGenerationPreviewRequest {
  const project = renderedProject();
  const originalManifest = project.manifest.files.find(
    (file) => file.path === path,
  );
  const originalRendered = project.renderResult.files.find(
    (file) => file.path === path,
  );
  if (originalManifest === undefined || originalRendered === undefined) {
    throw new Error(`Missing fixture file: ${path}`);
  }
  const manifestFile: ForgeTemplateFile = {
    ...originalManifest,
    ownership: options.ownership ?? originalManifest.ownership,
    updateStrategy: options.updateStrategy ?? originalManifest.updateStrategy,
    ...(options.renderedExecutable === undefined
      ? {}
      : { executable: options.renderedExecutable }),
  };
  const renderedFile: ForgeRenderedFile = {
    ...originalRendered,
    ownership: manifestFile.ownership,
    updateStrategy: manifestFile.updateStrategy,
    executable: options.renderedExecutable ?? manifestFile.executable ?? false,
  };
  const manifest: ForgeTemplateManifest = {
    ...project.manifest,
    files: [manifestFile],
  };
  const renderResult = {
    ...project.renderResult,
    files: [renderedFile],
    metadata: {
      ...project.renderResult.metadata,
      renderedFileCount: 1,
      skippedFileCount: 0,
      skippedFiles: [],
    },
  };
  const targetFile =
    options.target === undefined
      ? undefined
      : {
          path,
          ...options.target,
          ...(options.targetExecutable === undefined
            ? {}
            : { executable: options.targetExecutable }),
        };
  const previousFile =
    options.previousHash === undefined
      ? undefined
      : stateFile(renderedFile, {
          generatedHash: options.previousHash,
          ownership: options.previousOwnership ?? manifestFile.ownership,
          updateStrategy:
            options.previousStrategy ?? manifestFile.updateStrategy,
        });
  return {
    renderResult,
    manifest,
    targetState: { files: targetFile === undefined ? [] : [targetFile] },
    ...(previousFile === undefined
      ? {}
      : { previousState: previousState(manifest, [previousFile]) }),
    ...(options.allowExplicitReplace === undefined
      ? {}
      : { options: { allowExplicitReplace: options.allowExplicitReplace } }),
  };
}

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map(({ code }) => code);
}

describe("generation preview decisions", () => {
  it("creates a new file", () => {
    const preview = createGenerationPreview(singleFileRequest("package.json"));

    expect(preview.files[0]).toMatchObject({
      action: "create",
      reasonCode: "TARGET_MISSING",
    });
    expect(preview.safeToApply).toBe(true);
  });

  it("skips an existing file whose target hash already matches", () => {
    const request = singleFileRequest("package.json");
    const renderedHash = request.renderResult.files[0]?.contentHash;
    request.targetState.files = [
      { path: "package.json", exists: true, contentHash: renderedHash },
    ];

    expect(createGenerationPreview(request).files[0]).toMatchObject({
      action: "skip",
      reasonCode: "TARGET_ALREADY_MATCHES",
    });
  });

  it("skips an existing create-once target", () => {
    const preview = createGenerationPreview(
      singleFileRequest(".gitignore", {
        target: { exists: true, contentHash: hashGeneratedContent("user") },
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "skip",
      reasonCode: "USER_OWNED_TARGET_EXISTS",
    });
  });

  it("always preserves an existing user-owned file", () => {
    const preview = createGenerationPreview(
      singleFileRequest(".gitignore", {
        target: { exists: true },
      }),
    );

    expect(preview.files[0]?.action).toBe("skip");
  });

  it("requires review for a manual strategy", () => {
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        ownership: "forge-owned",
        updateStrategy: "manual",
        target: { exists: true, contentHash: hashGeneratedContent("old") },
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "manual-review",
      reasonCode: "MANUAL_STRATEGY",
    });
    expect(preview.safeToApply).toBe(false);
  });

  it("blocks replace without explicit permission", () => {
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        ownership: "forge-owned",
        updateStrategy: "replace",
        target: { exists: true, contentHash: hashGeneratedContent("old") },
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "manual-review",
      reasonCode: "EXPLICIT_REPLACE_NOT_ALLOWED",
    });
    expect(codes(preview)).toContain("PLAN_EXPLICIT_REPLACE_REQUIRED");
  });

  it("allows an explicitly approved replace", () => {
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        ownership: "forge-owned",
        updateStrategy: "replace",
        target: { exists: true, contentHash: hashGeneratedContent("old") },
        allowExplicitReplace: true,
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "replace",
      reasonCode: "EXPLICIT_REPLACE_ALLOWED",
    });
  });

  it("replaces when target matches the previous generation", () => {
    const previousHash = hashGeneratedContent("old generated content");
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        target: { exists: true, contentHash: previousHash },
        previousHash,
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "replace",
      reasonCode: "TARGET_MATCHES_PREVIOUS_GENERATION",
      changedFromPreviousGeneration: true,
      targetModifiedByUser: false,
    });
  });

  it("skips when rendered, target, and previous hashes all match", () => {
    const request = singleFileRequest("package.json");
    const renderedHash = request.renderResult.files[0]?.contentHash;
    if (renderedHash === undefined) throw new Error("Expected rendered hash");
    request.targetState.files = [
      { path: "package.json", exists: true, contentHash: renderedHash },
    ];
    request.previousState = previousState(request.manifest, [
      stateFile(request.renderResult.files[0] as ForgeRenderedFile),
    ]);

    expect(createGenerationPreview(request).files[0]).toMatchObject({
      action: "skip",
      reasonCode: "TARGET_ALREADY_MATCHES",
      changedFromPreviousGeneration: false,
      targetModifiedByUser: false,
    });
  });

  it("conflicts when a target was modified after generation", () => {
    const previousHash = hashGeneratedContent("old generated content");
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        target: {
          exists: true,
          contentHash: hashGeneratedContent("user edit"),
        },
        previousHash,
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "conflict",
      reasonCode: "TARGET_MODIFIED_SINCE_GENERATION",
      targetModifiedByUser: true,
    });
    expect(codes(preview)).toEqual(
      expect.arrayContaining(["PLAN_FILE_CONFLICT", "PLAN_TARGET_MODIFIED"]),
    );
  });

  it("conflicts when a previous hash is unavailable", () => {
    const preview = createGenerationPreview(
      singleFileRequest("package.json", {
        target: { exists: true, contentHash: hashGeneratedContent("existing") },
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "conflict",
      reasonCode: "PREVIOUS_GENERATION_HASH_MISSING",
    });
  });

  it("does not replace when an existing target hash is unknown", () => {
    const preview = createGenerationPreview(
      singleFileRequest("package.json", { target: { exists: true } }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "conflict",
      reasonCode: "TARGET_HASH_UNKNOWN",
    });
    expect(codes(preview)).toContain("PLAN_TARGET_HASH_MISSING");
  });

  it("requires merge review for an existing shared file", () => {
    const preview = createGenerationPreview(
      singleFileRequest("README.md", {
        target: {
          exists: true,
          contentHash: hashGeneratedContent("user text"),
        },
      }),
    );

    expect(preview.files[0]).toMatchObject({
      action: "manual-review",
      reasonCode: "SHARED_FILE_REQUIRES_MERGE",
    });
  });

  it("creates a missing shared file", () => {
    expect(
      createGenerationPreview(singleFileRequest("README.md")).files[0],
    ).toMatchObject({ action: "create", reasonCode: "TARGET_MISSING" });
  });

  it("records an executable-only change without inventing another action", () => {
    const request = singleFileRequest("package.json", {
      renderedExecutable: true,
      targetExecutable: false,
    });
    const renderedHash = request.renderResult.files[0]?.contentHash;
    if (renderedHash === undefined) throw new Error("Expected rendered hash");
    request.targetState.files[0] = {
      path: "package.json",
      exists: true,
      contentHash: renderedHash,
      executable: false,
    };
    request.previousState = previousState(request.manifest, [
      stateFile(request.renderResult.files[0] as ForgeRenderedFile),
    ]);
    const preview = createGenerationPreview(request);

    expect(preview.files[0]).toMatchObject({
      action: "replace",
      executableChange: true,
    });
  });
});

describe("orphaned and unmanaged files", () => {
  it("reports an orphan without creating a delete action", () => {
    const request = singleFileRequest("package.json");
    const orphanHash = hashGeneratedContent("old orphan");
    request.previousState = previousState(request.manifest, [
      {
        path: "old-generated.md",
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        generatedHash: orphanHash,
      },
    ]);
    request.targetState.files.push({
      path: "old-generated.md",
      exists: true,
      contentHash: orphanHash,
    });
    const preview = createGenerationPreview(request);

    expect(preview.orphanedFiles).toEqual([
      expect.objectContaining({
        path: "old-generated.md",
        modifiedSinceGeneration: false,
      }),
    ]);
    expect(preview.files.some(({ path }) => path === "old-generated.md")).toBe(
      false,
    );
    expect(preview.safeToApply).toBe(false);
  });

  it("marks a modified orphan", () => {
    const request = singleFileRequest("package.json");
    const orphanHash = hashGeneratedContent("old orphan");
    request.previousState = previousState(request.manifest, [
      {
        path: "old-generated.md",
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        generatedHash: orphanHash,
      },
    ]);
    request.targetState.files.push({
      path: "old-generated.md",
      exists: true,
      contentHash: hashGeneratedContent("user edit"),
    });

    expect(createGenerationPreview(request).orphanedFiles[0]).toMatchObject({
      modifiedSinceGeneration: true,
    });
  });

  it("ignores unrelated user target files", () => {
    const request = singleFileRequest("package.json");
    request.targetState.files.push({
      path: "notes/user-file.md",
      exists: true,
      contentHash: hashGeneratedContent("user"),
    });
    const preview = createGenerationPreview(request);

    expect(preview.files).toHaveLength(1);
    expect(preview.orphanedFiles).toEqual([]);
    expect(preview.diagnostics).toEqual([]);
  });
});

describe("preview consistency validation", () => {
  it("rejects duplicate target paths", () => {
    const request = singleFileRequest("package.json");
    const hash = request.renderResult.files[0]?.contentHash;
    request.targetState.files = [
      { path: "package.json", exists: true, contentHash: hash },
      { path: "package.json", exists: true, contentHash: hash },
    ];

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_TARGET_PATH_DUPLICATE",
    );
  });

  it("rejects duplicate previous-state paths", () => {
    const request = singleFileRequest("package.json");
    const rendered = request.renderResult.files[0] as ForgeRenderedFile;
    request.previousState = previousState(request.manifest, [
      stateFile(rendered),
      stateFile(rendered),
    ]);

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_PREVIOUS_STATE_PATH_DUPLICATE",
    );
  });

  it("diagnoses a previous template ID mismatch", () => {
    const request = singleFileRequest("package.json");
    request.previousState = previousState(request.manifest, [], {
      templateId: "another-template",
    });

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_TEMPLATE_ID_MISMATCH",
    );
  });

  it("diagnoses a previous template version mismatch", () => {
    const request = singleFileRequest("package.json");
    request.previousState = previousState(request.manifest, [], {
      templateVersion: "2.0.0",
    });

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_TEMPLATE_VERSION_MISMATCH",
    );
  });

  it("diagnoses previous ownership mismatch", () => {
    const hash = hashGeneratedContent("previous");
    const request = singleFileRequest("package.json", {
      target: { exists: true, contentHash: hash },
      previousHash: hash,
      previousOwnership: "user-owned",
    });

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_OWNERSHIP_MISMATCH",
    );
  });

  it("diagnoses previous update-strategy mismatch", () => {
    const hash = hashGeneratedContent("previous");
    const request = singleFileRequest("package.json", {
      target: { exists: true, contentHash: hash },
      previousHash: hash,
      previousStrategy: "create-once",
    });

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_UPDATE_STRATEGY_MISMATCH",
    );
  });

  it("diagnoses rendered metadata that differs from the manifest", () => {
    const request = singleFileRequest("package.json");
    request.renderResult.files[0] = {
      ...(request.renderResult.files[0] as ForgeRenderedFile),
      ownership: "user-owned",
    };

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_RENDER_MANIFEST_MISMATCH",
    );
  });

  it("treats the manifest content type as authoritative", () => {
    const request = singleFileRequest("package.json");
    request.renderResult.files[0] = {
      ...(request.renderResult.files[0] as ForgeRenderedFile),
      contentType: "text/markdown",
    };

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_RENDER_MANIFEST_MISMATCH",
    );
  });

  it("diagnoses undeclared and missing rendered files", () => {
    const request = singleFileRequest("package.json");
    request.renderResult.files[0] = {
      ...(request.renderResult.files[0] as ForgeRenderedFile),
      path: "undeclared.txt",
    };
    const preview = createGenerationPreview(request);

    expect(codes(preview)).toEqual(
      expect.arrayContaining([
        "PLAN_RENDER_FILE_UNDECLARED",
        "PLAN_RENDER_FILE_MISSING",
      ]),
    );
  });

  it("verifies rendered content hashes", () => {
    const request = singleFileRequest("package.json");
    request.renderResult.files[0] = {
      ...(request.renderResult.files[0] as ForgeRenderedFile),
      contentHash: hashGeneratedContent("wrong content"),
    };

    expect(codes(createGenerationPreview(request))).toContain(
      "PLAN_HASH_MISMATCH",
    );
  });

  it("validates the public request envelope", () => {
    expect(validateGenerationPreviewRequest({ targetState: {} })).toMatchObject(
      {
        success: false,
        diagnostics: [
          expect.objectContaining({ code: "PLAN_REQUEST_INVALID" }),
        ],
      },
    );
    expect(
      validateGenerationPreviewRequest({
        renderResult: {},
        manifest: {},
        targetState: { files: [] },
      }),
    ).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "PLAN_REQUEST_INVALID" })],
    });

    const request = singleFileRequest("package.json");
    expect(
      validateGenerationPreviewRequest({
        ...request,
        options: { allowExplicitReplace: "yes" },
      }),
    ).toMatchObject({
      success: false,
      diagnostics: [expect.objectContaining({ code: "PLAN_REQUEST_INVALID" })],
    });
  });
});

describe("preview determinism and summary", () => {
  it("sorts files and builds summary only from actions", () => {
    const project = renderedProject();
    const preview = createGenerationPreview({
      renderResult: project.renderResult,
      manifest: project.manifest,
      targetState: {
        files: [
          {
            path: ".gitignore",
            exists: true,
            contentHash: hashGeneratedContent("user"),
          },
        ],
      },
    });

    expect(preview.files.map(({ path }) => path)).toEqual([
      ".gitignore",
      "README.md",
      "mcp-forge.json",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "src/index.ts",
      "src/tools/hello.ts",
      "tests/hello.test.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
    expect(preview.summary).toEqual({
      create: 10,
      replace: 0,
      skip: 1,
      conflict: 0,
      manualReview: 0,
    });
    expect(preview.safeToApply).toBe(true);
  });

  it("is JSON serializable and independent of input order", () => {
    const project = renderedProject();
    const request: ForgeGenerationPreviewRequest = {
      renderResult: project.renderResult,
      manifest: project.manifest,
      targetState: { files: [] },
    };
    const reversed: ForgeGenerationPreviewRequest = {
      ...request,
      renderResult: {
        ...request.renderResult,
        files: [...request.renderResult.files].reverse(),
      },
      manifest: {
        ...request.manifest,
        files: [...request.manifest.files].reverse(),
      },
    };
    const preview = createGenerationPreview(request);

    expect(createGenerationPreview(reversed)).toEqual(preview);
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
  });
});
