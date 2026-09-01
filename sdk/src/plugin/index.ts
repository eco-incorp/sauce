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
 * TWO SEPARATE MECHANISMS, one word. Don't conflate them:
 *   • ambient DEFINES  (`routes/ambient.ts#chainDefines`) — chain-scoped SCALARS (chainId, protocol
 *     contract addresses, token symbol -> address) injected as compile-time `defines`. Always on.
 *   • ambient MODULES  (this `ambient` list, via `chainAmbient`) — whole SauceScript LIBRARY modules
 *     whose exported functions/consts are broadcast into every route with no `import` line.
 *
 * `ambient` now ships with `@sauce/token`: `chainAmbient()` (routes/ambient.ts) hands this list to
 * EVERY `openRoute` compile, so every route can call the token stdlib's `approve`/`transfer`/
 * `balanceOf`/... with zero import. This is only safe because `rs-compile.ts` resolves `@sauce/token`
 * to the SDK's OWN vendored copy (`SDK_STD_PACKAGES`, from `dist/std/token` when built) regardless of
 * `baseDirs` — a specifier the compile can't resolve makes EVERY route throw
 * `failed to import module "<name>"`, so an entry is not free to add: it must be resolvable on the
 * route path first (an npm package a consumer may not have installed is exactly what this list must
 * NOT name).
 *
 * NOTE: the token FUNCTION surface is what's live (`approve(token, spender, amount)`), NOT a
 * `Token(addr).approve(...)` wrapper — the published compiler's M1 subset rejects a method call on a
 * call result, so the wrapper is gated on a compiler feature. Once `@sauce/token` can export a
 * `Token`, it appears globally for free, already broadcast from here.
 */
export interface SaucePlugin {
  /** Ambient MODULE specifiers — library modules whose exports broadcast into every compile with no
   *  import line (distinct from the ambient DEFINES `chainDefines` threads in). */
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
