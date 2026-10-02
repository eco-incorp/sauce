#!/usr/bin/env node
/**
 * The package's `sauce` executable (`bin` in the root `package.json`). Everything it does is
 * `run.ts#runCli`; this only hands it the process — and the built-in public endpoints, which a
 * command reads a chain through when it is given no endpoint of its own.
 */
import { publicEndpoints } from "./public-endpoints.js";
import { nodeIo, runCli } from "./run.js";

process.exitCode = await runCli(process.argv.slice(2), {
  ...nodeIo(),
  publicRpcs: publicEndpoints(),
});
