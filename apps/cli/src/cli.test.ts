import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let testDirectory: string;

function readFixtureUrl(group: "valid" | "invalid", fileName: string): URL {
  return new URL(
    `../../../packages/schemas/fixtures/${group}/${fileName}`,
    import.meta.url,
  );
}

async function fixtureValue(
  group: "valid" | "invalid",
  fileName: string,
): Promise<Record<string, unknown>> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(
    await readFile(readFixtureUrl(group, fileName), "utf8"),
  ) as Record<string, unknown>;
}

async function writeJson(
  fileName: string,
  value: Record<string, unknown>,
): Promise<string> {
  const path = join(testDirectory, fileName);
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

async function captureCli(args: string[]): Promise<CapturedRun> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    cwd: testDirectory,
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
  });

  return { exitCode, stdout, stderr };
}

function enableEmptyToolsCapability(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const server = input.server as Record<string, unknown>;
  return {
    ...input,
    server: {
      ...server,
      capabilities: {
        ...(server.capabilities as Record<string, unknown>),
        tools: true,
      },
    },
  };
}

function addToolToDisabledCapability(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...input,
    tools: [
      {
        name: "inspect_record",
        title: "Inspect record",
        description: "Inspects a fictional record.",
        inputSchema: {},
        useWhen: "A record must be inspected.",
        avoidWhen: "A record must be changed.",
        riskLevel: "low",
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
      },
    ],
  };
}

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "mcp-forge-cli-"));
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

describe("mcp-forge validate", () => {
  it("validates a minimal configuration with the default detailed output", async () => {
    const path = await writeJson(
      "minimal.json",
      await fixtureValue("valid", "minimal-stdio.json"),
    );

    const result = await captureCli(["validate", path]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Configuration is valid.\n\n0 errors, 0 warnings.\n",
      stderr: "",
    });
  });

  it("uses ./mcp-forge.json when no path is supplied", async () => {
    await writeJson(
      "mcp-forge.json",
      await fixtureValue("valid", "minimal-stdio.json"),
    );

    const result = await captureCli(["validate", "--format", "compact"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("OK 0 errors, 0 warnings\n");
  });

  it("returns warnings while keeping a valid result", async () => {
    const input = enableEmptyToolsCapability(
      await fixtureValue("valid", "minimal-stdio.json"),
    );
    const path = await writeJson("warning.json", input);

    const result = await captureCli(["validate", path]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "SEM_CAPABILITY_ENABLED_WITHOUT_DEFINITIONS",
    );
    expect(result.stdout).toContain("Configuration is valid with warnings.");
  });

  it("returns exit code 1 for schema errors", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );

    const result = await captureCli(["validate", path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("CFG_SCHEMA_VERSION_MISSING");
    expect(result.stdout).toContain("Configuration is invalid.");
  });

  it("returns exit code 1 for semantic errors", async () => {
    const input = addToolToDisabledCapability(
      await fixtureValue("valid", "minimal-stdio.json"),
    );
    const path = await writeJson("semantic-error.json", input);

    const result = await captureCli(["validate", path]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("SEM_CAPABILITY_DISABLED_WITH_DEFINITIONS");
  });

  it("renders compact diagnostics on one line each", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );

    const result = await captureCli([
      "validate",
      path,
      "--format",
      "compact",
      "--no-suggestions",
    ]);

    expect(result.stdout).toContain(
      "ERROR CFG_SCHEMA_VERSION_MISSING schemaVersion: The configuration must declare schemaVersion.\n",
    );
    expect(result.stdout).toContain("FAIL 1 errors, 0 warnings\n");
  });

  it("renders detailed diagnostics with suggestions by default", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );

    const result = await captureCli(["validate", path, "--format=detailed"]);

    expect(result.stdout).toContain(
      "ERROR CFG_SCHEMA_VERSION_MISSING\nschemaVersion\n\n",
    );
    expect(result.stdout).toContain("Suggestion:");
  });

  it("omits suggestions from text output when requested", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );

    const result = await captureCli(["validate", path, "--no-suggestions"]);

    expect(result.stdout).not.toContain("Suggestion:");
  });

  it("renders stable JSON with no additional text", async () => {
    const path = await writeJson(
      "minimal.json",
      await fixtureValue("valid", "minimal-stdio.json"),
    );

    const result = await captureCli(["validate", path, "--format", "json"]);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(output).toEqual({
      success: true,
      configPath: path,
      summary: { errors: 0, warnings: 0, info: 0 },
      diagnostics: [],
    });
    expect(result.stdout.trim()).toBe(JSON.stringify(output, null, 2));
  });

  it("keeps warning severity in JSON when warnings are treated as errors", async () => {
    const input = enableEmptyToolsCapability(
      await fixtureValue("valid", "minimal-stdio.json"),
    );
    const path = await writeJson("warning.json", input);

    const result = await captureCli([
      "validate",
      path,
      "--format",
      "json",
      "--warnings-as-errors",
    ]);
    const output = JSON.parse(result.stdout) as {
      success: boolean;
      diagnostics: Array<{ severity: string }>;
    };

    expect(result.exitCode).toBe(3);
    expect(output.success).toBe(false);
    expect(output.diagnostics[0]?.severity).toBe("warning");
  });

  it("suppresses successful output in quiet mode", async () => {
    const path = await writeJson(
      "minimal.json",
      await fixtureValue("valid", "minimal-stdio.json"),
    );

    const result = await captureCli(["validate", path, "--quiet"]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("does not suppress validation errors in quiet mode", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );

    const result = await captureCli(["validate", path, "--quiet"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("CFG_SCHEMA_VERSION_MISSING");
  });

  it("returns exit code 2 for missing and malformed files", async () => {
    const missing = await captureCli(["validate", "missing.json"]);
    await writeFile(join(testDirectory, "invalid.json"), "{", "utf8");
    const malformed = await captureCli(["validate", "invalid.json"]);

    expect(missing).toMatchObject({ exitCode: 2, stdout: "" });
    expect(missing.stderr).toContain("CLI_FILE_NOT_FOUND");
    expect(malformed).toMatchObject({ exitCode: 2, stdout: "" });
    expect(malformed.stderr).toContain("CLI_JSON_PARSE_FAILED");
  });

  it("returns exit code 4 for invalid usage without a stack trace", async () => {
    const result = await captureCli(["validate", "--unknown"]);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("CLI_INVALID_ARGUMENT");
    expect(result.stderr).toContain("Usage: mcp-forge validate");
    expect(result.stderr).not.toContain(" at ");
  });

  it("produces deterministic output", async () => {
    const path = await writeJson(
      "invalid.json",
      await fixtureValue("invalid", "missing-schema-version.json"),
    );
    const args = ["validate", path, "--format", "json"];

    expect(await captureCli(args)).toEqual(await captureCli(args));
  });
});
