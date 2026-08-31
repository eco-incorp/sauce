#!/usr/bin/env node
// Copies the contract artifacts the dev-tools recipes and deploy.ts read at runtime
// into dev-tools/artifacts/. That directory is gitignored (build output) but ships in
// the published package (root package.json `files`), so this runs at `prepack` — and
// on demand via `pnpm sync-artifacts` for local recipe runs / fork tests.
//
// Source: sdk/src/artifacts/, produced by sdk/scripts/sync-engine-artifacts.mjs. It used to resolve
// the `sauce` git dep's forge output itself, with `compiler/node_modules/sauce` first in its
// candidate list — which is what tied this script to `compiler/` existing. Reading the sdk's synced
// copy instead leaves ONE place that knows where engine artifacts come from, and one forge build
// rather than two resolutions of the same thing.
//
// Ordering holds in both flows that matter: `pnpm build` builds the sdk (whose build runs the sync)
// before `pnpm publish` fires `prepack`, and `pnpm --filter './sdk' sync-engine-artifacts` is the
// documented step for a local run. Fails loudly rather than silently shipping empty artifacts.
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEV_TOOLS_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(DEV_TOOLS_DIR, "..");
const ARTIFACTS_DIR = resolve(DEV_TOOLS_DIR, "artifacts");
const SOURCE_DIR = resolve(REPO_ROOT, "sdk", "src", "artifacts");

// Contracts the recipes (`import … from "./artifacts/X.json"`, quoting.ts) and the
// deploy/fork-test flow (Router + SauceRouter, which carry deploy bytecode) read.
const ARTIFACTS = ["IERC20", "ISauceRouter", "IUniswapV3Pool", "Router", "SauceRouter"];

const missing = ARTIFACTS.filter((name) => !existsSync(resolve(SOURCE_DIR, `${name}.json`)));

if (missing.length) {
  console.error(
    `[sync-artifacts] missing from ${SOURCE_DIR}: ${missing.join(", ")}. Run ` +
      "`pnpm --filter './sdk' sync-engine-artifacts` first (with Foundry installed, so it can " +
      "build the pinned sauce engine).",
  );
  process.exit(1);
}

mkdirSync(ARTIFACTS_DIR, { recursive: true });
for (const name of ARTIFACTS) {
  copyFileSync(resolve(SOURCE_DIR, `${name}.json`), resolve(ARTIFACTS_DIR, `${name}.json`));
}

console.log(`[sync-artifacts] copied ${ARTIFACTS.length} artifacts -> dev-tools/artifacts/`);
