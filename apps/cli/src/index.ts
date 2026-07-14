#!/usr/bin/env node

import { runCli } from "./cli.js";
import { readCliPackageVersion } from "./version.js";

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  version: readCliPackageVersion(),
});
