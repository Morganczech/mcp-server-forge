#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { once } from "node:events";

import { runCli } from "./cli.js";
import { isConfirmedAnswer } from "./confirmation.js";
import { readCliPackageVersion } from "./version.js";

async function confirm(prompt: string): Promise<boolean> {
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return isConfirmedAnswer(await input.question(prompt));
  } finally {
    input.close();
  }
}

async function readTuiKey(): Promise<string> {
  const input = process.stdin;
  input.setRawMode?.(true);
  input.resume();
  try {
    const [data] = (await once(input, "data")) as [Buffer];
    return data.toString("utf8");
  } finally {
    input.setRawMode?.(false);
    input.pause();
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.env.INIT_CWD ?? process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  version: readCliPackageVersion(),
  isInteractive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  confirm,
  readTuiKey,
});
