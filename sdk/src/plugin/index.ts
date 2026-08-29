import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Read the manifest from a sibling file (same dir as this compiled JS). This works in both
// modes without any packaging quirks:
//   - dev (ts-jest): thisDir resolves to `<sdk>/src/plugin/`, where manifest.json lives.
//   - published: thisDir resolves to `<sdk>/dist/plugin/`, where `copy-verify-assets.mjs`
//     copies manifest.json alongside index.js — and `sdk/dist` IS in the root `files` list
//     (unlike `sdk/src/plugin/`), so consumers actually receive it.
// Read directly (not `import ... from "./manifest.json"`) because `tsc` does not copy
// imported JSON to outDir — same reason `src/skills/*.md` are read via `readFileSync`.
const thisDir = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(thisDir, "manifest.json");

/**
 * The shared stdlib/DSL plugin's manifest — the single declarative source of truth both
 * compilers' loaders are meant to read.
 *
 * `ambient` ships EMPTY, and an entry is not free to add: `chainAmbient()` (routes/ambient.ts)
 * hands this list to EVERY `openRoute` compile, which both activates the RS compiler and makes the
 * compile fail unless each specifier resolves. `rs-compile.ts` resolves a bare specifier by walking
 * up from the caller's `baseDirs` looking for `node_modules/<pkg>`, and `openRoute` supplies no
 * `baseDirs` — so a specifier that is not installed in a real `node_modules` tree makes every route
 * throw `failed to import module "<name>"`.
 *
 * `@sauce/token` is exactly that case today: it lives at `sdk/src/std/token/` and is never
 * installed anywhere the walk can find it (the token suites reach it through a synthetic resolver
 * in their own harness). It belongs here once the SDK can resolve its own stdlib on the route path,
 * not before.
 */
export interface SaucePlugin {
  /** Module specifiers broadcast into every compile's global resolution set with no import line. */
  ambient: string[];
  /** SauceScript surface name -> the underlying engine/opcode name each compiler actually implements. */
  nameParity: Record<string, string>;
}

// Memoize: `chainAmbient()` (routes/ambient.ts) calls this on every `openRoute` compile, which
// is a hot path. The manifest is a bundled asset that cannot change over the life of the
// process — one parse per process is enough.
let cached: SaucePlugin | undefined;

/** Load the plugin manifest. Cached after the first call. */
export function loadPlugin(): SaucePlugin {
  if (cached === undefined) {
    cached = JSON.parse(readFileSync(manifestPath, "utf-8")) as SaucePlugin;
  }
  return cached;
}
