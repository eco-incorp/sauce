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
 * MINIMAL, THIS BRANCH (`feat/plugin-sdk-wiring`, P7): `ambient` ships EMPTY here — no real
 * ambient stdlib module (e.g. `@sauce/token`) is wired in on this branch yet, deliberately, per
 * the "keep the plugin minimal, in-place" directive. A separate branch (`plugin-token-ambient`,
 * off `origin/main`) landed a fuller P5a version of this exact file/loader with
 * `ambient: ["@sauce/token"]` (commit b2b3a7e). The two are NOT yet reconciled — when both land on
 * `main`, this manifest should absorb that branch's real ambient entry (and its
 * `manifest.test.ts` nameParity-vs-real-opcode pin) rather than the two drifting independently.
 * Until then, an empty default here means `chainAmbient()` (routes/ambient.ts) — and therefore
 * every route compiled through `openRoute` — activates NO ambient module unless a caller opts in
 * via `IntentOptions.compile.ambient`/`options.ambient`, so nothing on this branch changes
 * existing compiled output.
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
