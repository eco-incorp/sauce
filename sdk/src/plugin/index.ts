import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// At runtime this file is at dist/plugin/index.js, so package root is ../..
// The manifest lives at src/plugin/manifest.json, read directly (not `import … from
// "./manifest.json"`) to match `skills/loader.ts`'s own convention of reading a sibling
// data file relative to the package root rather than through a bundler-specific JSON
// import — the same reason `src/skills/*.md` are read this way instead of imported.
const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(thisDir, "..", "..");
const manifestPath = join(packageRoot, "src", "plugin", "manifest.json");

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

/** Load the plugin manifest. Re-reads the file on every call — it is small and rarely read. */
export function loadPlugin(): SaucePlugin {
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as SaucePlugin;
}
