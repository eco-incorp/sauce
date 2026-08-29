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
 * The shared stdlib/DSL plugin's Layer-C manifest — the single declarative source of truth
 * both compilers' loaders are meant to read (see `docs/plans/P5-plugin-skeleton-design.md`).
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
