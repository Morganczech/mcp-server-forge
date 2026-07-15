import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli, type CliContext } from "./cli.js";

const templatePath = fileURLToPath(
  new URL(
    "../../../packages/templates/templates/basic-typescript-server",
    import.meta.url,
  ),
);
const configFixture = new URL(
  "../../../packages/generators/fixtures/valid/basic-config.json",
  import.meta.url,
);

let directory: string;
let projectRoot: string;

async function capture(
  args: string[],
  context: Partial<CliContext> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    cwd: directory,
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
    ...context,
  });
  return { exitCode, stdout, stderr };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mcp-forge-inspect-"));
  projectRoot = join(directory, "project");
  await mkdir(projectRoot);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("mcp-forge inspect", () => {
  it("returns a structured uninitialized result for a missing configuration", async () => {
    const result = await capture(["inspect", "--json"]);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result).toMatchObject({ exitCode: 2, stderr: "" });
    expect(output).toMatchObject({
      inspectionVersion: "1",
      project: { initialized: false },
      status: "uninitialized",
    });
    expect(result.stdout).not.toContain("\u001b[");
  });

  it("inspects a valid project deterministically without writing", async () => {
    await writeFile(
      join(directory, "mcp-forge.json"),
      await readFile(configFixture),
    );
    const before = await readdir(projectRoot, { recursive: true });
    const args = [
      "inspect",
      "--root",
      projectRoot,
      "--template",
      templatePath,
      "--json",
    ];
    const first = await capture(args);
    const second = await capture(args);

    expect(first).toEqual(second);
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      status: "healthy",
      generation: { stateAvailable: false, safeToApply: true },
      summary: { files: 4, conflicts: 0 },
    });
    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);

    const text = await capture([
      "inspect",
      "--root",
      projectRoot,
      "--template",
      templatePath,
    ]);
    expect(text.stdout).toContain("MCP Server Forge project inspection");
    expect(text.stdout).not.toContain("\u001b[");
  });

  it("inspects a valid generated project as current and remains read-only", async () => {
    await writeFile(
      join(directory, "mcp-forge.json"),
      await readFile(configFixture),
    );
    const generated = await capture(
      ["generate", "--root", projectRoot, "--template", templatePath],
      {
        isInteractive: true,
        confirm: async () => true,
        now: () => "2026-07-15T08:00:00.000Z",
      },
    );
    expect(generated.exitCode).toBe(0);
    const before = await readdir(projectRoot, { recursive: true });

    const inspected = await capture([
      "inspect",
      "--root",
      projectRoot,
      "--template",
      templatePath,
      "--json",
    ]);
    const output = JSON.parse(inspected.stdout) as {
      status: string;
      generation: { files: Array<{ status: string }> };
    };
    expect(inspected.exitCode).toBe(0);
    expect(output.status).toBe("healthy");
    expect(
      output.generation.files.every(({ status }) => status === "current"),
    ).toBe(true);
    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });

  it("uses validation exit code 1 for an invalid configuration", async () => {
    await writeFile(join(directory, "mcp-forge.json"), "{}");

    const result = await capture(["inspect", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "error" });
  });

  it("reports undeclared permissions and a modified tracked file conflict", async () => {
    const config = JSON.parse(await readFile(configFixture, "utf8")) as Record<
      string,
      unknown
    >;
    delete config.security;
    await writeFile(join(directory, "mcp-forge.json"), JSON.stringify(config));
    await writeFile(join(projectRoot, "managed.txt"), "changed\n");
    await mkdir(join(projectRoot, ".mcp-forge"));
    await writeFile(
      join(projectRoot, ".mcp-forge/generated-state.json"),
      JSON.stringify({
        stateVersion: "1",
        templateId: "test",
        templateVersion: "1.0.0",
        hashAlgorithm: "sha256",
        generatedAt: "2026-07-15T08:00:00.000Z",
        files: [
          {
            path: "managed.txt",
            generatedHash: "a".repeat(64),
            ownership: "forge-owned",
            updateStrategy: "replace-if-unmodified",
          },
        ],
      }),
    );
    const result = await capture(["inspect", "--root", projectRoot, "--json"]);
    const output = JSON.parse(result.stdout) as {
      status: string;
      permissions: Array<{ permission: string; status: string }>;
      generation: { files: Array<{ status: string }> };
    };

    expect(result.exitCode).toBe(5);
    expect(output.status).toBe("error");
    expect(
      output.permissions.every(({ status }) => status === "not-declared"),
    ).toBe(true);
    expect(output.generation.files[0]?.status).toBe("conflict");
  });

  it("rejects the TUI on non-TTY before reading the project", async () => {
    const result = await capture(["tui"]);

    expect(result).toEqual({
      exitCode: 4,
      stdout: "",
      stderr:
        "The experimental TUI requires an interactive TTY. Use `mcp-forge inspect` for non-interactive inspection.\n",
    });
  });

  it("keeps an interactive TUI session read-only", async () => {
    await writeFile(
      join(directory, "mcp-forge.json"),
      await readFile(configFixture),
    );
    const before = await readdir(projectRoot, { recursive: true });
    const keys = ["p", "r", "i", "q"];
    const result = await capture(
      ["tui", "--root", projectRoot, "--template", templatePath],
      { isInteractive: true, readTuiKey: async () => keys.shift() ?? "q" },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("experimental, read-only");
    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });

  it("documents inspect and TUI in command help", async () => {
    expect((await capture(["--help"])).stdout).toContain("inspect");
    expect((await capture(["inspect", "--help"])).stdout).toContain("--json");
    expect((await capture(["tui", "--help"])).stdout).toContain(
      "requires an interactive TTY",
    );
  });
});
