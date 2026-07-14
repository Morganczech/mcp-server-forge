import { createRequire } from "node:module";

interface PackageMetadata {
  version: string;
}

export function readCliPackageVersion(): string {
  const require = createRequire(import.meta.url);
  const metadata = require("../package.json") as PackageMetadata;
  return metadata.version;
}
