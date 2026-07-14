import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashGeneratedContent } from "@mcp-server-forge/templates";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectGenerationWorkspace,
  loadGenerationState,
  loadTargetState,
  loadTemplateBundle,
} from "./index.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `mcp-forge-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function codes(result: { diagnostics: Array<{ code: string }> }): string[] {
  return result.diagnostics.map(({ code }) => code);
}

function generationState(files: unknown[] = []): object {
  return {
    stateVersion: "1",
    templateId: "test-template",
    templateVersion: "1.0.0",
    hashAlgorithm: "sha256",
    generatedAt: "2026-01-01T00:00:00.000Z",
    files,
  };
}

function manifest(source = "files/index.ts.hbs"): object {
  return {
    manifestVersion: "1",
    template: {
      id: "test-template",
      version: "1.0.0",
      title: "Test template",
      description: "A filesystem adapter fixture.",
      kind: "server",
      runtime: "node",
      language: "typescript",
    },
    compatibility: { forgeConfigSchema: ["1"] },
    files: [
      {
        path: "src/index.ts",
        source,
        ownership: "forge-owned",
        updateStrategy: "replace-if-unmodified",
        required: true,
        contentType: "text/typescript",
      },
    ],
  };
}

async function createTemplateBundle(): Promise<string> {
  const root = await temporaryDirectory("template");
  await mkdir(join(root, "files"));
  await writeFile(join(root, "template.json"), JSON.stringify(manifest()));
  await writeFile(
    join(root, "files/index.ts.hbs"),
    "export const ok = true;\n",
  );
  return root;
}

describe("loadTargetState", () => {
  it("represents a missing target under an existing empty root", async () => {
    const root = await temporaryDirectory("empty-root");
    const result = await loadTargetState(root, [{ path: "src/index.ts" }]);

    expect(result).toMatchObject({
      success: true,
      targetState: { files: [{ path: "src/index.ts", exists: false }] },
      diagnostics: [],
    });
  });

  it("rejects a missing root and a file used as root", async () => {
    const parent = await temporaryDirectory("bad-roots");
    const file = join(parent, "root.txt");
    await writeFile(file, "not a directory");

    expect(codes(await loadTargetState(join(parent, "missing"), []))).toContain(
      "FS_ROOT_NOT_FOUND",
    );
    expect(codes(await loadTargetState(file, []))).toContain(
      "FS_ROOT_NOT_DIRECTORY",
    );
  });

  it("requires an explicit absolute root", async () => {
    expect(codes(await loadTargetState("relative-root", []))).toContain(
      "FS_PATH_INVALID",
    );
  });

  it("hashes exact bytes and reports executable metadata portably", async () => {
    const root = await temporaryDirectory("target-hash");
    const content = Buffer.from([0x61, 0x0d, 0x0a, 0x62]);
    await writeFile(join(root, "managed.txt"), content);
    await chmod(join(root, "managed.txt"), 0o744);

    const result = await loadTargetState(root, [
      { path: "managed.txt", expectedExecutable: true },
    ]);
    const target = result.targetState.files[0];

    expect(target).toMatchObject({
      path: "managed.txt",
      exists: true,
      contentHash: hashGeneratedContent(content),
    });
    expect(
      target?.executable === undefined ||
        typeof target.executable === "boolean",
    ).toBe(true);
  });

  it("does not read or hash a target above the configured limit", async () => {
    const root = await temporaryDirectory("large-target");
    await writeFile(join(root, "large.txt"), "123456");

    const result = await loadTargetState(root, [{ path: "large.txt" }], {
      maxFileSizeBytes: 5,
    });

    expect(result.targetState.files[0]).toMatchObject({
      path: "large.txt",
      exists: true,
    });
    expect(result.targetState.files[0]).not.toHaveProperty("contentHash");
    expect(codes(result)).toContain("FS_FILE_TOO_LARGE");
  });

  it("rejects traversal, absolute paths, and duplicates", async () => {
    const root = await temporaryDirectory("invalid-paths");
    const result = await loadTargetState(root, [
      { path: "../outside.txt" },
      { path: join(root, "absolute.txt") },
      { path: "same.txt" },
      { path: "same.txt" },
    ]);

    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "FS_PATH_INVALID",
        "FS_DUPLICATE_NORMALIZED_PATH",
      ]),
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects file symlinks and directory symlinks escaping the root",
    async () => {
      const root = await temporaryDirectory("symlink-root");
      const outside = await temporaryDirectory("symlink-outside");
      await writeFile(join(outside, "outside.txt"), "outside");
      await symlink(join(outside, "outside.txt"), join(root, "file-link"));
      await symlink(outside, join(root, "directory-link"));

      expect(
        codes(await loadTargetState(root, [{ path: "file-link" }])),
      ).toContain("FS_SYMLINK_REJECTED");
      expect(
        codes(
          await loadTargetState(root, [{ path: "directory-link/outside.txt" }]),
        ),
      ).toContain("FS_SYMLINK_REJECTED");
    },
  );

  it("rejects directories and files in required parent positions", async () => {
    const root = await temporaryDirectory("wrong-types");
    await mkdir(join(root, "target"));
    await writeFile(join(root, "parent"), "file");

    expect(codes(await loadTargetState(root, [{ path: "target" }]))).toContain(
      "FS_PATH_TYPE_UNSUPPORTED",
    );
    expect(
      codes(await loadTargetState(root, [{ path: "parent/child.txt" }])),
    ).toContain("FS_PATH_TYPE_UNSUPPORTED");
  });

  it("sorts target paths deterministically", async () => {
    const root = await temporaryDirectory("sorted-targets");
    const result = await loadTargetState(root, [
      { path: "z.txt" },
      { path: "a.txt" },
    ]);

    expect(result.targetState.files.map(({ path }) => path)).toEqual([
      "a.txt",
      "z.txt",
    ]);
  });
});

describe("loadGenerationState", () => {
  it("returns unavailable without an error when state is missing", async () => {
    const root = await temporaryDirectory("no-state");
    await expect(loadGenerationState(root)).resolves.toEqual({
      success: true,
      available: false,
      diagnostics: [],
    });
  });

  it("loads and validates a generation state", async () => {
    const root = await temporaryDirectory("valid-state");
    await mkdir(join(root, ".mcp-forge"));
    await writeFile(
      join(root, ".mcp-forge/generated-state.json"),
      JSON.stringify(generationState()),
    );

    const result = await loadGenerationState(root);
    expect(result).toMatchObject({
      success: true,
      available: true,
      state: { templateId: "test-template", files: [] },
    });
  });

  it("rejects invalid JSON and schema-invalid state", async () => {
    const root = await temporaryDirectory("invalid-state");
    await mkdir(join(root, ".mcp-forge"));
    const path = join(root, ".mcp-forge/generated-state.json");
    await writeFile(path, "{");
    expect(codes(await loadGenerationState(root))).toContain(
      "FS_GENERATION_STATE_INVALID",
    );

    await writeFile(path, JSON.stringify({ stateVersion: "2" }));
    const invalidSchema = await loadGenerationState(root);
    expect(codes(invalidSchema)).toEqual(
      expect.arrayContaining([
        "FS_GENERATION_STATE_INVALID",
        "TPL_GENERATED_STATE_INVALID",
      ]),
    );
  });
});

describe("loadTemplateBundle", () => {
  it("loads only manifest-declared UTF-8 sources", async () => {
    const root = await createTemplateBundle();
    await writeFile(join(root, "unused-large.bin"), "x".repeat(1_000));

    const result = await loadTemplateBundle(root, { maxFileSizeBytes: 500 });

    expect(result).toMatchObject({
      success: true,
      bundle: {
        manifest: { template: { id: "test-template" } },
        templateSources: {
          "files/index.ts.hbs": "export const ok = true;\n",
        },
      },
      diagnostics: [],
    });
  });

  it("reports a missing or invalid manifest", async () => {
    const missing = await temporaryDirectory("missing-manifest");
    expect(codes(await loadTemplateBundle(missing))).toContain(
      "FS_TEMPLATE_MANIFEST_NOT_FOUND",
    );

    const invalid = await temporaryDirectory("invalid-manifest");
    await writeFile(join(invalid, "template.json"), "not-json");
    expect(codes(await loadTemplateBundle(invalid))).toContain(
      "FS_TEMPLATE_MANIFEST_INVALID",
    );
  });

  it("reports schema-invalid manifests and missing declared sources", async () => {
    const invalid = await temporaryDirectory("schema-invalid-manifest");
    await writeFile(join(invalid, "template.json"), JSON.stringify({}));
    expect(codes(await loadTemplateBundle(invalid))).toEqual(
      expect.arrayContaining([
        "FS_TEMPLATE_MANIFEST_INVALID",
        "TPL_MANIFEST_INVALID",
      ]),
    );

    const missingSource = await temporaryDirectory("missing-source");
    await writeFile(
      join(missingSource, "template.json"),
      JSON.stringify(manifest()),
    );
    expect(codes(await loadTemplateBundle(missingSource))).toContain(
      "FS_TEMPLATE_SOURCE_MISSING",
    );
  });

  it("enforces the size limit for declared sources", async () => {
    const root = await createTemplateBundle();
    await writeFile(join(root, "files/index.ts.hbs"), "x".repeat(1_000));
    const result = await loadTemplateBundle(root, { maxFileSizeBytes: 800 });

    expect(result.success).toBe(false);
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        "FS_FILE_TOO_LARGE",
        "FS_TEMPLATE_SOURCE_READ_FAILED",
      ]),
    );
  });
});

describe("inspectGenerationWorkspace", () => {
  it("combines bundle, previous state, and sorted target metadata", async () => {
    const projectRoot = await temporaryDirectory("workspace");
    const templateDirectory = await createTemplateBundle();
    await mkdir(join(projectRoot, ".mcp-forge"));
    await writeFile(
      join(projectRoot, ".mcp-forge/generated-state.json"),
      JSON.stringify(
        generationState([
          {
            path: "old.txt",
            ownership: "forge-owned",
            updateStrategy: "create-once",
            generatedHash: hashGeneratedContent("old"),
          },
        ]),
      ),
    );
    await writeFile(join(projectRoot, "old.txt"), "old");

    const before = {
      entries: await readdir(projectRoot),
      state: await readFile(
        join(projectRoot, ".mcp-forge/generated-state.json"),
        "utf8",
      ),
      old: await readFile(join(projectRoot, "old.txt"), "utf8"),
    };
    const result = await inspectGenerationWorkspace({
      projectRoot,
      templateDirectory,
    });
    const after = {
      entries: await readdir(projectRoot),
      state: await readFile(
        join(projectRoot, ".mcp-forge/generated-state.json"),
        "utf8",
      ),
      old: await readFile(join(projectRoot, "old.txt"), "utf8"),
    };

    expect(result.safeToRenderAndPreview).toBe(true);
    expect(result.targetState.files.map(({ path }) => path)).toEqual([
      "old.txt",
      "src/index.ts",
    ]);
    expect(after).toEqual(before);
  });

  it("contains no production write, delete, network, or process APIs", async () => {
    const sourceFiles = [
      "filesystem.ts",
      "inspect.ts",
      "load-generation-state.ts",
      "load-target-state.ts",
      "load-template-bundle.ts",
    ];
    const sources = await Promise.all(
      sourceFiles.map((file) =>
        readFile(new URL(file, import.meta.url), "utf8"),
      ),
    );
    const source = sources.join("\n");

    expect(source).not.toMatch(
      /\b(writeFile|appendFile|mkdir|rm|unlink|rename|rmdir|fetch|spawn|exec|fork)\b/,
    );
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("process.env");
  });
});
