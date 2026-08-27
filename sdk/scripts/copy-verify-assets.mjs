#!/usr/bin/env node
// `tsc` only emits compiled .js/.d.ts — it does not copy the runtime `.sauce.ts`
// program assets that the source getters read from disk at RUN time via
// `readFileSync` (`settleSource()` → dist/recipes/, `svmSettleSource()`
// → dist/svm/recipes/). `src/**/*.sauce.ts` is excluded from the tsconfig (it is
// SauceScript, not TypeScript tsc can parse), so without this step a fresh
// `sdk/dist` would be missing the files a partner needs to reproduce our bytecode.
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
// Run as part of `sdk`'s build: `tsc && sync-engine-artifacts && node scripts/copy-verify-assets.mjs`.
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SDK_DIR = resolve(SCRIPT_DIR, "..");

const ASSETS = [
  { subdir: "recipes", file: "settle.sauce.ts" },
  { subdir: join("svm", "recipes"), file: "settle.sauce.ts" },
  // Layer-C plugin manifest — `loadPlugin()` reads it via `readFileSync` from the same dir
  // as its own compiled JS (see `src/plugin/index.ts`), so it must land in `dist/plugin/`.
  // `tsc` only emits the compiled `.js`/`.d.ts` and doesn't copy JSON to outDir.
  { subdir: "plugin", file: "manifest.json" },
];

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
