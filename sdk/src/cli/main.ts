#!/usr/bin/env node
/**
 * The package's `sauce` executable (`bin` in the root `package.json`). Everything it does is
 * `run.ts#runCli`; this only hands it the process.
 */
import { nodeIo, runCli } from "./run.js";

process.exitCode = await runCli(process.argv.slice(2), nodeIo());
