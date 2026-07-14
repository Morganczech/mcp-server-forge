import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTemplateBundle } from "@mcp-server-forge/fs-adapter";
import { renderForgeTemplate } from "@mcp-server-forge/generators";
import { hashGeneratedContent } from "@mcp-server-forge/templates";
import { validateForgeProject } from "@mcp-server-forge/validators";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SnapshotEntry {
  path: string;
  type: "directory" | "file";
  mode: number;
  content?: string;
}

const basicTemplate = fileURLToPath(
  new URL(
    "../../../packages/templates/templates/basic-typescript-server",
    import.meta.url,
  ),
);
const basicConfigFixture = new URL(
  "../../../packages/generators/fixtures/valid/basic-config.json",
  import.meta.url,
);

let testDirectory: string;
let projectRoot: string;
let basicConfig: Record<string, unknown>;

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "mcp-forge-preview-cli-"));
  projectRoot = join(testDirectory, "project");
  await mkdir(projectRoot);
  basicConfig = JSON.parse(
    await readFile(basicConfigFixture, "utf8"),
  ) as Record<string, unknown>;
  await writeFile(
    join(testDirectory, "mcp-forge.json"),
    JSON.stringify(basicConfig),
  );
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

async function capture(
  args: string[],
  cwd = testDirectory,
): Promise<CapturedRun> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    cwd,
    version: "0.1.0-alpha.1",
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
  });
  return { exitCode, stdout, stderr };
}

function previewArgs(...extra: string[]): string[] {
  return [
    "preview",
    "--root",
    projectRoot,
    "--template",
    basicTemplate,
    ...extra,
  ];
}

async function renderedBasicProject() {
  const validation = validateForgeProject(basicConfig);
  if (!validation.success) throw new Error("test config must be valid");
  const template = await loadTemplateBundle(basicTemplate);
  if (!template.success || template.bundle === undefined) {
    throw new Error("test template must be valid");
  }
  return {
    manifest: template.bundle.manifest,
    renderResult: renderForgeTemplate({
      config: validation.data,
      manifest: template.bundle.manifest,
      templateSources: template.bundle.templateSources,
    }),
  };
}

async function writeProjectFile(path: string, content: string): Promise<void> {
  const absolute = join(projectRoot, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function writeState(
  files: unknown[],
  path = ".mcp-forge/generated-state.json",
) {
  const absolute = join(projectRoot, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(
    absolute,
    JSON.stringify({
      stateVersion: "1",
      templateId: "basic-typescript-server",
      templateVersion: "1.0.0",
      hashAlgorithm: "sha256",
      generatedAt: "2026-01-01T00:00:00.000Z",
      files,
    }),
  );
}

async function snapshot(root: string): Promise<SnapshotEntry[]> {
  const entries: SnapshotEntry[] = [];
  async function visit(directory: string, prefix = ""): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = prefix.length === 0 ? child.name : `${prefix}/${child.name}`;
      const absolute = join(directory, child.name);
      const metadata = await stat(absolute);
      if (child.isDirectory()) {
        entries.push({ path, type: "directory", mode: metadata.mode });
        await visit(absolute, path);
      } else {
        entries.push({
          path,
          type: "file",
          mode: metadata.mode,
          content: await readFile(absolute, "utf8"),
        });
      }
    }
  }
  await visit(root);
  return entries;
}

async function createReplaceTemplate(): Promise<string> {
  const root = join(testDirectory, "replace-template");
  await mkdir(join(root, "files"), { recursive: true });
  await writeFile(
    join(root, "template.json"),
    JSON.stringify({
      manifestVersion: "1",
      template: {
        id: "replace-template",
        version: "1.0.0",
        title: "Replace template",
        description: "A CLI preview test template.",
        kind: "server",
        runtime: "node",
        language: "typescript",
      },
      compatibility: { forgeConfigSchema: ["1"] },
      files: [
        {
          path: "replace.txt",
          source: "files/replace.txt.hbs",
          ownership: "forge-owned",
          updateStrategy: "replace",
          required: true,
        },
      ],
    }),
  );
  await writeFile(join(root, "files/replace.txt.hbs"), "{{project.name}}\n");
  return root;
}

describe("mcp-forge preview", () => {
  it("previews a new project with defaults and table output", async () => {
    const result = await capture(previewArgs());
    const defaultRoot = await capture([
      "preview",
      "--template",
      basicTemplate,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MCP Server Forge generation preview");
    expect(result.stdout).toContain("ACTION");
    expect(result.stdout).toContain("package.json");
    expect(result.stdout).toContain("create:         4");
    expect(result.stdout).toContain("Safe to apply: yes");
    expect(JSON.parse(defaultRoot.stdout).projectRoot).toBe(testDirectory);
  });

  it("supports explicit config, root, and template paths", async () => {
    const configPath = join(testDirectory, "explicit.json");
    await writeFile(configPath, JSON.stringify(basicConfig));
    const result = await capture([
      "preview",
      "--config",
      configPath,
      "--root",
      projectRoot,
      "--template",
      basicTemplate,
      "--format=compact",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CREATE package.json TARGET_MISSING");
    expect(result.stdout).toContain("SUMMARY create=4");
  });

  it("requires a template and reports invalid usage", async () => {
    const result = await capture(["preview"]);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--template is required");
    expect(result.stderr).toContain("Usage: mcp-forge preview");
  });

  it("reports missing and invalid configuration without continuing", async () => {
    const missing = await capture(
      previewArgs("--config", "missing.json", "--format", "json"),
    );
    await writeFile(join(testDirectory, "invalid.json"), "{");
    const invalid = await capture(previewArgs("--config", "invalid.json"));

    expect(missing.exitCode).toBe(2);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      success: false,
      cliError: { code: "CLI_FILE_NOT_FOUND" },
    });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("CLI_JSON_PARSE_FAILED");
  });

  it("reports schema-invalid config, missing root, and invalid templates", async () => {
    await writeFile(join(testDirectory, "schema-invalid.json"), "{}");
    const invalidConfig = await capture(
      previewArgs("--config", "schema-invalid.json"),
    );
    const missingRoot = await capture([
      ...previewArgs(),
      "--root",
      join(testDirectory, "missing-root"),
    ]);
    const invalidTemplate = join(testDirectory, "invalid-template");
    await mkdir(invalidTemplate);
    await writeFile(join(invalidTemplate, "template.json"), "{}");
    const invalidBundle = await capture([
      "preview",
      "--root",
      projectRoot,
      "--template",
      invalidTemplate,
    ]);

    expect(invalidConfig.exitCode).toBe(1);
    expect(invalidConfig.stdout).toContain("CFG_SCHEMA_VERSION_MISSING");
    expect(missingRoot.exitCode).toBe(2);
    expect(missingRoot.stderr).toContain("FS_ROOT_NOT_FOUND");
    expect(invalidBundle.exitCode).toBe(2);
    expect(invalidBundle.stderr).toContain("FS_TEMPLATE_MANIFEST_INVALID");
  });

  it("reports a missing declared template source", async () => {
    const template = await createReplaceTemplate();
    await rm(join(template, "files/replace.txt.hbs"));
    const result = await capture([
      "preview",
      "--root",
      projectRoot,
      "--template",
      template,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("FS_TEMPLATE_SOURCE_MISSING");
  });

  it("skips an unchanged generated file and detects a modified forge file", async () => {
    const project = await renderedBasicProject();
    const rendered = project.renderResult.files.find(
      ({ path }) => path === "package.json",
    );
    if (rendered === undefined) throw new Error("package render missing");
    await writeProjectFile(rendered.path, rendered.content);
    await writeState([
      {
        path: rendered.path,
        ownership: rendered.ownership,
        updateStrategy: rendered.updateStrategy,
        generatedHash: rendered.contentHash,
      },
    ]);

    const unchanged = await capture(previewArgs("--show-skipped"));
    await writeProjectFile(rendered.path, "manually changed\n");
    const modified = await capture(previewArgs("--format", "detailed"));

    expect(unchanged.exitCode).toBe(0);
    expect(unchanged.stdout).toContain("TARGET_ALREADY_MATCHES");
    expect(modified.exitCode).toBe(5);
    expect(modified.stdout).toContain("CONFLICT package.json");
    expect(modified.stdout).toContain("PLAN_TARGET_MODIFIED");
    expect(modified.stdout).toContain("Safe to apply: no");
  });

  it("requires review for an existing shared file and an orphan", async () => {
    await writeProjectFile("README.md", "user README\n");
    const shared = await capture(previewArgs());
    expect(shared.exitCode).toBe(5);
    expect(shared.stdout).toContain("manual-review");
    expect(shared.stdout).toContain("SHARED_FILE_REQUIRES_MERGE");

    await writeProjectFile("old.txt", "old\n");
    await writeState([
      {
        path: "old.txt",
        ownership: "forge-owned",
        updateStrategy: "create-once",
        generatedHash: hashGeneratedContent("old\n"),
      },
    ]);
    const orphan = await capture(previewArgs());
    expect(orphan.exitCode).toBe(5);
    expect(orphan.stdout).toContain("PLAN_ORPHANED_GENERATED_FILE");
  });

  it("supports missing state, --no-state, and a custom state path", async () => {
    const missing = await capture(previewArgs());
    await writeState([], "state/previous.json");
    const custom = await capture(
      previewArgs("--state", "state/previous.json", "--format", "json"),
    );
    await writeFile(join(projectRoot, "state/previous.json"), "invalid state");
    const ignored = await capture(previewArgs("--no-state"));
    const incompatible = await capture(
      previewArgs("--state", "state/previous.json", "--no-state"),
    );

    expect(missing.exitCode).toBe(0);
    expect(custom.exitCode).toBe(0);
    expect(JSON.parse(custom.stdout).safeToApply).toBe(true);
    expect(ignored.exitCode).toBe(0);
    expect(incompatible.exitCode).toBe(4);
  });

  it("renders compact, detailed, and pure JSON contracts", async () => {
    const compact = await capture(previewArgs("--format", "compact"));
    const detailed = await capture(previewArgs("--format", "detailed"));
    const json = await capture(previewArgs("--format", "json"));
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;

    expect(compact.stdout).toContain("CREATE package.json TARGET_MISSING");
    expect(detailed.stdout).toContain("CREATE package.json");
    expect(detailed.stdout).toContain("Ownership: forge-owned");
    expect(json.stderr).toBe("");
    expect(json.stdout.trim()).toBe(JSON.stringify(parsed, null, 2));
    expect(parsed).toMatchObject({
      success: true,
      safeToApply: true,
      template: { id: "basic-typescript-server", version: "1.0.0" },
      summary: { create: 4 },
    });
    expect((parsed.files as unknown[]).length).toBe(4);
  });

  it("shows only eligible rendered content and can reveal skipped rows", async () => {
    const content = await capture(previewArgs("--show-content"));
    const jsonContent = await capture(
      previewArgs("--show-content", "--format", "json"),
    );
    expect(content.stdout).toContain("--- package.json ---");
    expect(content.stdout).toContain("--- end package.json ---");
    expect(
      (
        JSON.parse(jsonContent.stdout).files as Array<{ content?: string }>
      ).every(({ content }) => typeof content === "string"),
    ).toBe(true);

    const project = await renderedBasicProject();
    const rendered = project.renderResult.files.find(
      ({ path }) => path === "SYSTEM_PROMPT.md",
    );
    if (rendered === undefined) throw new Error("prompt render missing");
    await writeProjectFile(rendered.path, "private target content\n");
    const hidden = await capture(previewArgs("--show-content"));
    const shown = await capture(previewArgs("--show-skipped"));

    expect(hidden.stdout).not.toContain("private target content");
    expect(hidden.stdout).not.toContain("--- SYSTEM_PROMPT.md ---");
    expect(hidden.stdout).not.toContain("skip    SYSTEM_PROMPT.md");
    expect(shown.stdout).toContain("SYSTEM_PROMPT.md");
    expect(shown.stdout).toContain("USER_OWNED_TARGET_EXISTS");
  });

  it("previews explicit replacement without modifying the target", async () => {
    const template = await createReplaceTemplate();
    await writeProjectFile("replace.txt", "user value\n");
    const before = await snapshot(projectRoot);
    const blocked = await capture([
      "preview",
      "--root",
      projectRoot,
      "--template",
      template,
    ]);
    const allowed = await capture([
      "preview",
      "--root",
      projectRoot,
      "--template",
      template,
      "--allow-explicit-replace",
      "--show-content",
    ]);

    expect(blocked.exitCode).toBe(5);
    expect(blocked.stdout).toContain("EXPLICIT_REPLACE_NOT_ALLOWED");
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stdout).toContain("replace");
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  it("supports warnings-as-errors and quiet semantics", async () => {
    const server = basicConfig.server as Record<string, unknown>;
    basicConfig = {
      ...basicConfig,
      server: {
        ...server,
        capabilities: {
          ...(server.capabilities as Record<string, unknown>),
          tools: true,
        },
      },
    };
    await writeFile(
      join(testDirectory, "mcp-forge.json"),
      JSON.stringify(basicConfig),
    );
    const warning = await capture(
      previewArgs("--warnings-as-errors", "--quiet"),
    );
    expect(warning.exitCode).toBe(3);
    expect(warning.stdout).toContain(
      "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
    );

    basicConfig = JSON.parse(
      await readFile(basicConfigFixture, "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      join(testDirectory, "mcp-forge.json"),
      JSON.stringify(basicConfig),
    );
    const quiet = await capture(previewArgs("--quiet"));
    const quietJson = await capture(previewArgs("--quiet", "--format", "json"));
    expect(quiet).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(JSON.parse(quietJson.stdout).success).toBe(true);
  });

  it("is deterministic when manifest input order changes", async () => {
    const first = await capture(previewArgs("--format", "json"));
    const copiedTemplate = join(testDirectory, "reordered-template");
    const bundle = await loadTemplateBundle(basicTemplate);
    if (!bundle.success || bundle.bundle === undefined) {
      throw new Error("bundle unavailable");
    }
    await mkdir(copiedTemplate);
    await writeFile(
      join(copiedTemplate, "template.json"),
      JSON.stringify({
        ...bundle.bundle.manifest,
        files: [...bundle.bundle.manifest.files].reverse(),
      }),
    );
    for (const [source, content] of Object.entries(
      bundle.bundle.templateSources,
    )) {
      await mkdir(dirname(join(copiedTemplate, source)), { recursive: true });
      await writeFile(join(copiedTemplate, source), content);
    }
    const second = await capture([
      "preview",
      "--root",
      projectRoot,
      "--template",
      copiedTemplate,
      "--format",
      "json",
    ]);
    const firstJson = JSON.parse(first.stdout) as Record<string, unknown>;
    const secondJson = JSON.parse(second.stdout) as Record<string, unknown>;
    delete firstJson.templatePath;
    delete secondJson.templatePath;
    expect(secondJson).toEqual(firstJson);
  });

  it("never creates state or mutates project files across preview modes", async () => {
    await writeProjectFile("README.md", "shared content\n");
    const before = await snapshot(projectRoot);

    await capture(previewArgs());
    await capture(previewArgs("--show-content"));
    await capture(previewArgs("--allow-explicit-replace"));
    await capture(previewArgs("--config", "missing.json"));

    expect(await snapshot(projectRoot)).toEqual(before);
    expect(before.some(({ path }) => path === ".mcp-forge")).toBe(false);
  });
});

describe("CLI help and version", () => {
  it("provides global and command help plus package version", async () => {
    expect((await capture(["--help"])).stdout).toContain("Commands:");
    expect((await capture(["preview", "--help"])).stdout).toContain(
      "--allow-explicit-replace",
    );
    expect((await capture(["validate", "--help"])).stdout).toContain(
      "mcp-forge validate",
    );
    expect(await capture(["--version"])).toEqual({
      exitCode: 0,
      stdout: "0.1.0-alpha.1\n",
      stderr: "",
    });
  });
});
