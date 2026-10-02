#!/usr/bin/env node
/**
 * The package's `sauce` executable (`bin` in the root `package.json`). Everything it does is
 * `run.ts#runCli`; this only hands it the process — and the built-in public endpoints, which a
 * command reads a chain through when it is given no endpoint of its own, and what `sauce update`
 * reaches: this package's directory, the npm registry and the package managers.
 */
import { publicEndpoints } from "./public-endpoints.js";
import { nodeIo, runCli } from "./run.js";
import { nodeUpdater } from "./update.js";

process.exitCode = await runCli(process.argv.slice(2), {
  ...nodeIo(),
  publicRpcs: publicEndpoints(),
  updater: nodeUpdater(),
});
