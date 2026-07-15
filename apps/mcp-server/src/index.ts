#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadProjectCatalog } from "./catalog.js";
import { ForgeReadOnlyService } from "./service.js";
import { createForgeMcpServer } from "./server.js";
import { readMcpServerVersion } from "./version.js";

export * from "./catalog.js";
export * from "./constants.js";
export * from "./diagnostics.js";
export * from "./evidence.js";
export * from "./output.js";
export * from "./server.js";
export * from "./service.js";
export type * from "./types.js";

export async function runForgeMcpServer(
  options: {
    catalogPath?: string;
    cwd?: string;
  } = {},
): Promise<void> {
  const version = readMcpServerVersion();
  const catalog = await loadProjectCatalog(
    options.catalogPath ?? process.env.MCP_FORGE_CATALOG,
    options.cwd,
  );
  const service = new ForgeReadOnlyService({ catalog, version });
  const server = createForgeMcpServer({ service, version });
  await server.connect(new StdioServerTransport());
}

function isEntryPoint(): boolean {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isEntryPoint()) {
  try {
    await runForgeMcpServer();
  } catch {
    process.stderr.write("Forge MCP server failed to start safely.\n");
    process.exitCode = 1;
  }
}
