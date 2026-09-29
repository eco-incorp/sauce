import { DESCRIPTORS } from "../descriptors/registry.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { resolveTokenMap } from "../routes/token-registry.js";
// A JSON import, so no filesystem is read at run time and a bundler inlines it. `manifest.json`
// still ships beside the compiled module (`copy-verify-assets.mjs`) for tools that read it directly.
import manifest from "./manifest.json" with { type: "json" };

/**
 * Manifest for SDK route defaults and SauceScript operation-name metadata.
 *
 * Ambient defines and ambient modules are separate inputs. `chainDefines()` resolves scalar
 * chain, protocol, and token addresses. `chainAmbient()` supplies library module specifiers whose
 * exports become available without imports.
 *
 * The default ambient module is `@sauce/token`. `openRoute` merges this list with caller-supplied
 * modules; direct `compileSauceRoute` uses only the caller's list. `rs-compile.ts` resolves the
 * token module to the SDK's packaged `std/token` sources. New ambient modules must likewise be
 * resolvable by the SDK because a missing module causes route compilation to fail.
 *
 * The module exposes function forms such as `approve(token, spender, amount)`. Separately, SDK
 * route rewriting lowers `Token(address).approve(...)` to an ERC-20 ABI binding.
 */
export interface SaucePlugin {
  /** Ambient MODULE specifiers — library modules whose exports broadcast into every compile with no
   *  import line (distinct from the ambient DEFINES `chainDefines` threads in). */
  ambient: string[];
  /** SauceScript surface name -> the corresponding engine operation name. */
  nameParity: Record<string, string>;
}

/** Load the plugin manifest. The same object on every call. */
export function loadPlugin(): SaucePlugin {
  return manifest as SaucePlugin;
}

/**
 * Combined access to the manifest and the registries used by route ambient resolution.
 * `protocolAddresses` and `tokens` retain the original descriptor-array and resolver references;
 * this view does not duplicate their data or change token override precedence.
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
 * Read the manifest's SauceScript-to-engine operation mapping, currently `{ throw: "revert" }`.
 * The readonly return type protects the cached manifest object from caller mutation at type level.
 */
export function pluginNameParity(): Readonly<Record<string, string>> {
  return loadPluginData().nameParity;
}
