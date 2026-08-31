import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { DESCRIPTORS } from "../descriptors/registry.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { resolveTokenMap } from "../routes/token-registry.js";

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
 * compilers' loaders are meant to read (see
 * `docs/plans/P5-plugin-skeleton-design.md`).
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

/**
 * P8 — the single declarative accessor over every Layer-B data source the SDK's loaders read.
 * Carries the manifest's own `ambient`/`nameParity` (re-read via `loadPlugin()`, unchanged)
 * alongside `protocolAddresses`/`tokens`, which are re-exposed FROM the two registries the SDK
 * already trusted before there was a "plugin" concept at all — `descriptors/registry.ts`'s
 * `DESCRIPTORS` (protocol contract addresses) and `routes/token-registry.ts`'s `resolveTokenMap`
 * (per-chain token symbol -> address, including its existing caller-override merge). NEITHER is
 * copied or relocated: this is the SAME array/function reference, so a caller reading through
 * `loadPluginData()` sees byte-identical data to reading `DESCRIPTORS`/`resolveTokenMap` directly.
 * The point is a single point of entry, not a new data source — see `routes/ambient.ts#chainDefines`
 * for the first (and, per the "keep this minimal, in-place" directive, currently only) caller
 * routed through this accessor instead of importing those two registries itself.
 */
export interface SaucePluginData extends SaucePlugin {
  /** `descriptors/registry.ts`'s `DESCRIPTORS`, re-exposed verbatim (same array reference). */
  readonly protocolAddresses: readonly ContractDescriptor[];
  /** `token-registry.ts`'s `resolveTokenMap`, re-exposed verbatim (same function reference). */
  readonly tokens: typeof resolveTokenMap;
}

// Memoized for the same reason `loadPlugin()` is: `chainDefines` (routes/ambient.ts) calls
// `loadPluginData()` on every `openRoute` compile. The wrapper is a fixed 4-property view of
// process-lifetime constants (the manifest, DESCRIPTORS, resolveTokenMap) — one allocation is
// enough. Skipping this leaves a fresh object literal per hot-path call for zero benefit.
let cachedData: SaucePluginData | undefined;

export function loadPluginData(): SaucePluginData {
  if (cachedData === undefined) {
    const plugin = loadPlugin();
    cachedData = {
      ambient: plugin.ambient,
      nameParity: plugin.nameParity,
      protocolAddresses: DESCRIPTORS,
      tokens: resolveTokenMap,
    };
  }
  return cachedData;
}

/**
 * Live accessor for the manifest's `nameParity` map (`manifest.json`'s `{ throw:
 * "revert" }` — SauceScript surface name -> the underlying engine/opcode name each compiler
 * actually implements). Declared in the manifest since P7 but never consulted anywhere in the SDK
 * until this function — exported so it is a live, tested part of the plugin surface rather than
 * inert config; see `plugin.test.ts`. Returned `Readonly` because the underlying object IS the
 * cached manifest's own map — a caller mutating this would corrupt every subsequent read.
 */
export function pluginNameParity(): Readonly<Record<string, string>> {
  return loadPluginData().nameParity;
}
