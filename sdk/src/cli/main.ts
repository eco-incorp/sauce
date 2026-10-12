#!/usr/bin/env node
/**
 * The package's `sauce` executable (`bin` in the root `package.json`). Everything it does is
 * `run.ts#runCli`; this only hands it the process — and the built-in public endpoints, which a
 * command reads a chain through when it is given no endpoint of its own, KyberSwap's and Jupiter's
 * public APIs, which `kyberSwap` and `jupiterSwap` routes come from when no other is given, what
 * `sauce update` reaches (this package's directory, the npm registry and the package managers), the
 * installer of the runtime folder `sauce mcp` and a Solana rehearsal load their packages from
 * (`npm ci`), and the update check, which notices a newer version from its cache and refreshes that
 * cache in a process of its own (`update-check.ts`). Nothing else creates them, so importing a
 * module reaches nothing.
 */
import { useRuntime } from "./optional.js";
import { publicEndpoints } from "./public-endpoints.js";
import { JUPITER_PUBLIC_API, KYBER_PUBLIC_API } from "./public-swap-apis.js";
import { nodeIo, runCli } from "./run.js";
import { nodeRuntimeInstaller } from "./runtime.js";
import { nodeUpdateCheck } from "./update-check.js";
import { nodeUpdater } from "./update.js";

useRuntime({ installer: nodeRuntimeInstaller() });

process.exitCode = await runCli(process.argv.slice(2), {
  ...nodeIo(),
  publicRpcs: publicEndpoints(),
  swapApis: { kyber: KYBER_PUBLIC_API, jupiter: JUPITER_PUBLIC_API },
  updater: nodeUpdater(),
  updateCheck: nodeUpdateCheck(),
});
