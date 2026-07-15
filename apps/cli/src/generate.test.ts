import {
  mkdir,
  mkdtemp,
  readFile,
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
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(
    ["generate", "--root", projectRoot, "--template", basicTemplate],
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

describe("mcp-forge generate", () => {
  it("applies a fresh safe preview after explicit confirmation", async () => {
    const result = await capture(true);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("MCP Server Forge generation preview");
    expect(result.stdout).toContain("Applied 4 file change(s)");
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
