import { createRequire } from "node:module";

export function readMcpServerVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}
