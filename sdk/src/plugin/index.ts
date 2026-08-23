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
