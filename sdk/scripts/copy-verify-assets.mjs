#!/usr/bin/env node
// `tsc` only emits compiled .js/.d.ts — it does not copy the `.sauce.ts` program assets the
// package exports (`./recipes/settle.sauce.ts`, `./svm/recipes/settle.sauce.ts`) for a partner to
// read, hash or vendor. `src/**/*.sauce.ts` is excluded from the tsconfig (it is SauceScript, not
// TypeScript tsc can parse), so without this step a fresh `sdk/dist` would be missing them. The SDK
// itself reads none of these files at run time: `gen-embedded-sources.mjs` embeds their text.
// Mirrors `@eco-incorp/sauce-recipes`'s `scripts/copy-dist-assets.mjs` (same
// problem, same shape, different package).
//
// Each asset names its own SUBDIR (relative to sdk/) because the EVM and SVM
// programs live in different trees — the SVM one under the svm/ subtree with the
// rest of the SVM SDK. The dest directory is CREATED, not asserted: a directory
// holding only `.sauce.ts` files gets no `tsc` output at all (all excluded), so
// there may be no dist dir for the copy to land in.
//
// The engine ABI artifacts the EVM `settle.sauce.ts` imports (`./artifacts/*.json`) are handled
// separately by `sync-engine-artifacts` (which writes them into dist/artifacts as a build output),
// not here — this script only copies the `.sauce.ts` program templates `tsc` leaves behind.
//
// Run as the last step of `sdk`'s `build` script.
import { existsSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");

const ASSETS = [
  { subdir: "recipes", file: "settle.sauce.ts" },
  { subdir: "recipes", file: "cctp-split.sauce.ts" },
  { subdir: "recipes", file: "plain-transfer.sauce.ts" },
  { subdir: join("svm", "recipes"), file: "settle.sauce.ts" },
  // Layer-C plugin manifest, beside its compiled module for tools that read it directly.
  // `loadPlugin()` imports it as JSON.
  { subdir: "plugin", file: "manifest.json" },
  // `@sauce/token`, `@sauce/router` and `@sauce/swap`, the SauceScript stdlib, shipped as files for
  // a consumer resolving them off disk. The route path serves the embedded copies
  // (`src/embedded/resolve.ts`) and reads none of these.
  ...stdPackage("token"),
  ...stdPackage("router"),
  ...stdPackage("swap"),
];

/** Every file of the standard-library package in `src/std/<name>/`. */
function stdPackage(name) {
  const subdir = join("std", name);

  return readdirSync(join(SDK_DIR, "src", subdir))
    .sort()
    .map((file) => ({ subdir, file }));
}

for (const { subdir, file } of ASSETS) {
  const src = join(SDK_DIR, "src", subdir, file);
  const dest = join(SDK_DIR, "dist", subdir, file);

  if (!existsSync(src)) {
    console.error(`copy-verify-assets: missing source asset ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copy-verify-assets: copied ${file} -> dist/${subdir}/`);
}
