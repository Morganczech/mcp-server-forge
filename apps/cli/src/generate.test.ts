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
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

const basicTemplate = fileURLToPath(
  new URL(
    "../../../packages/templates/templates/basic-typescript-server",
    import.meta.url,
  ),
);
const configFixture = new URL(
  "../../../packages/generators/fixtures/valid/basic-config.json",
  import.meta.url,
);
const contactsConfigFixture = new URL(
  "../../../packages/generators/fixtures/valid/contacts-config.json",
  import.meta.url,
);
const capabilityRoot = fileURLToPath(
  new URL("../../../packages/capabilities/capabilities", import.meta.url),
);

let testRoot: string;
let projectRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "mcp-forge-generate-cli-"));
  projectRoot = join(testRoot, "project");
  await mkdir(projectRoot);
  await writeFile(
    join(testRoot, "mcp-forge.json"),
    await readFile(configFixture),
  );
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function capture(
  confirmed: boolean,
  interactive = true,
  onConfirm?: () => Promise<void>,
  withCapabilities = false,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(
    [
      "generate",
      "--root",
      projectRoot,
      "--template",
      basicTemplate,
      ...(withCapabilities ? ["--capability-root", capabilityRoot] : []),
    ],
    {
      cwd: testRoot,
      stdout: { write: (chunk) => (stdout += chunk) },
      stderr: { write: (chunk) => (stderr += chunk) },
      isInteractive: interactive,
      confirm: async () => {
        await onConfirm?.();
        return confirmed;
      },
      now: () => "2026-07-15T08:00:00.000Z",
    },
  );
  return { exitCode, stdout, stderr };
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(join(root, entry.name), path)));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

describe("mcp-forge generate", () => {
  it("reports an unknown capability without writing", async () => {
    const config = JSON.parse(
      await readFile(contactsConfigFixture, "utf8"),
    ) as {
      capabilities: string[];
    };
    config.capabilities = ["unknown-capability"];
    await writeFile(join(testRoot, "mcp-forge.json"), JSON.stringify(config));

    const result = await capture(true, true, undefined, true);

    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain("CAP_UNKNOWN");
    expect(await listFiles(projectRoot)).toEqual([]);
  });

  it("composes configured capabilities before applying one generation plan", async () => {
    await writeFile(
      join(testRoot, "mcp-forge.json"),
      await readFile(contactsConfigFixture),
    );

    const result = await capture(true, true, undefined, true);
    const generatedConfig = JSON.parse(
      await readFile(join(projectRoot, "mcp-forge.json"), "utf8"),
    ) as {
      capabilities: string[];
      tools: Array<{ name: string }>;
      security: { allowedReadPaths: string[] };
    };

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Applied 18 file change(s)");
    expect(generatedConfig.capabilities).toEqual([
      "local-json-data",
      "contacts-read",
    ]);
    expect(generatedConfig.tools.map(({ name }) => name)).toEqual(["hello"]);
    expect(generatedConfig.security.allowedReadPaths).toEqual([]);
    await expect(
      readFile(join(projectRoot, "src/tools/list-contacts.ts"), "utf8"),
    ).resolves.toContain("registerListContactsTool");
    await expect(
      readFile(join(projectRoot, "data/contacts.json"), "utf8"),
    ).resolves.toContain("Ada Příkladová");
  });

  it("applies a fresh safe preview after explicit confirmation", async () => {
    const result = await capture(true);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MCP Server Forge generation preview");
    expect(result.stdout).toContain("Applied 11 file change(s)");
    expect(await readFile(join(projectRoot, "package.json"), "utf8")).toContain(
      '"name"',
    );
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, ".mcp-forge/generated-state.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      generatedAt: "2026-07-15T08:00:00.000Z",
      files: expect.any(Array),
    });
  });

  it("is idempotent and blocks a manually modified forge-owned file", async () => {
    const first = await capture(true);
    expect(first.exitCode).toBe(0);
    expect(await listFiles(projectRoot)).toEqual([
      ".gitignore",
      ".mcp-forge/generated-state.json",
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

    const statePath = join(projectRoot, ".mcp-forge/generated-state.json");
    const stateAfterFirstRun = await readFile(statePath, "utf8");
    const indexAfterFirstRun = await readFile(
      join(projectRoot, "src/index.ts"),
      "utf8",
    );

    const second = await capture(true);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("skip:           11");
    expect(second.stdout).toContain(
      "No file changes to apply; generation state was not changed.",
    );
    expect(await readFile(statePath, "utf8")).toBe(stateAfterFirstRun);
    expect(await readFile(join(projectRoot, "src/index.ts"), "utf8")).toBe(
      indexAfterFirstRun,
    );

    await writeFile(
      join(projectRoot, "src/index.ts"),
      `${indexAfterFirstRun}\n// manual smoke-test change\n`,
    );
    const conflict = await capture(true);

    expect(conflict.exitCode).toBe(5);
    expect(conflict.stdout).toContain("TARGET_MODIFIED_SINCE_GENERATION");
    expect(conflict.stdout).toContain("PLAN_FILE_CONFLICT");
    expect(conflict.stdout).toContain("PLAN_TARGET_MODIFIED");
    expect(await readFile(statePath, "utf8")).toBe(stateAfterFirstRun);
    expect(await readFile(join(projectRoot, "src/index.ts"), "utf8")).toContain(
      "// manual smoke-test change",
    );
  });

  it("does not write when confirmation is refused or no TTY exists", async () => {
    const refused = await capture(false);
    expect(refused.exitCode).toBe(6);
    await expect(stat(join(projectRoot, "package.json"))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );

    const nonInteractive = await capture(true, false);
    expect(nonInteractive.exitCode).toBe(6);
    expect(nonInteractive.stderr).toContain("interactive TTY confirmation");
    await expect(stat(join(projectRoot, "package.json"))).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
  });

  it("preserves user-maintained shared README content and blocks automatic merge", async () => {
    const first = await capture(true);
    expect(first.exitCode).toBe(0);

    const readmePath = join(projectRoot, "README.md");
    const statePath = join(projectRoot, ".mcp-forge/generated-state.json");
    const stateBefore = await readFile(statePath, "utf8");
    const customized = `${await readFile(readmePath, "utf8")}\nUser-maintained note.\n`;
    await writeFile(readmePath, customized);

    const repeated = await capture(true);

    expect(repeated.exitCode).toBe(5);
    expect(repeated.stdout).toContain("manual-review");
    expect(repeated.stdout).toContain("SHARED_FILE_REQUIRES_MERGE");
    expect(await readFile(readmePath, "utf8")).toBe(customized);
    expect(await readFile(statePath, "utf8")).toBe(stateBefore);
  });

  it("blocks a changed target and a different safe plan after confirmation", async () => {
    const staleTarget = await capture(true, true, async () => {
      await writeFile(join(projectRoot, "package.json"), "manually changed\n");
    });
    expect(staleTarget.exitCode).toBe(5);
    expect(staleTarget.stderr).toContain("preview changed");
    expect(await readFile(join(projectRoot, "package.json"), "utf8")).toBe(
      "manually changed\n",
    );
    await expect(
      stat(join(projectRoot, ".mcp-forge/generated-state.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await rm(projectRoot, { recursive: true, force: true });
    await mkdir(projectRoot);
    const changedPlan = await capture(true, true, async () => {
      const configPath = join(testRoot, "mcp-forge.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        project: { name: string };
      };
      config.project.name = "changed-after-confirmation";
      await writeFile(configPath, JSON.stringify(config));
    });
    expect(changedPlan.exitCode).toBe(5);
    expect(changedPlan.stderr).toContain("confirmed plan changed");
    await expect(stat(join(projectRoot, "package.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
});
