import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfigFile } from "./load-config.js";

let testDirectory: string;

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "mcp-forge-loader-"));
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

describe("loadConfigFile", () => {
  it("resolves relative paths and reads UTF-8 JSON objects", async () => {
    await writeFile(
      join(testDirectory, "config.json"),
      '{"title":"Fictional café"}',
      "utf8",
    );

    const result = await loadConfigFile("./config.json", testDirectory);

    expect(result).toEqual({
      success: true,
      configPath: join(testDirectory, "config.json"),
      value: { title: "Fictional café" },
    });
  });

  it("reports a missing file", async () => {
    const result = await loadConfigFile("missing.json", testDirectory);

    expect(result).toMatchObject({
      success: false,
      error: { code: "CLI_FILE_NOT_FOUND" },
    });
  });

  it("reports a directory instead of a file", async () => {
    await mkdir(join(testDirectory, "config-directory"));

    const result = await loadConfigFile("config-directory", testDirectory);

    expect(result).toMatchObject({
      success: false,
      error: { code: "CLI_PATH_IS_DIRECTORY" },
    });
  });

  it("reports invalid JSON", async () => {
    await writeFile(join(testDirectory, "invalid.json"), "{ invalid", "utf8");

    const result = await loadConfigFile("invalid.json", testDirectory);

    expect(result).toMatchObject({
      success: false,
      error: { code: "CLI_JSON_PARSE_FAILED" },
    });
  });

  it("reports an empty file", async () => {
    await writeFile(join(testDirectory, "empty.json"), "  \n", "utf8");

    const result = await loadConfigFile("empty.json", testDirectory);

    expect(result).toMatchObject({
      success: false,
      error: { code: "CLI_EMPTY_FILE" },
    });
  });

  it("reports a non-object JSON root", async () => {
    await writeFile(join(testDirectory, "array.json"), "[]", "utf8");

    const result = await loadConfigFile("array.json", testDirectory);

    expect(result).toMatchObject({
      success: false,
      error: { code: "CLI_JSON_ROOT_INVALID" },
    });
  });
});
