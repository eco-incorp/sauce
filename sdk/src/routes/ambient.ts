/**
 * Chain-scoped scalar ambient defines — `chainId`/protocol-contract addresses/caller token symbols,
 * threaded into `compile()`'s `defines` underneath a caller's own `IntentOptions.compile.defines`
 * (caller wins on a key collision; a user's own `let X = ...` inside the body wins over both, via
 * the compiler's own `getConstant`-only-when-`getVar`-is-undefined precedence).
 *
 * TOKEN SYMBOLS: `USDC`/`WETH`/etc. now resolve by DEFAULT from `token-registry.ts`'s curated,
 * probe-verified per-chain registry (see that file for exactly which chains/symbols are covered) --
 * this SDK has no OTHER per-chain token-address source (`protocols/erc20/addresses.ts` is
 * deliberately empty — "ERC20 is a standard interface, not a specific deployment"; see
 * `token-registry.ts`'s own module doc for the full discovery sweep). `opts.tokens` is the OVERRIDE
 * layer on top of the registry, resolved through `resolveTokenMap` (per-key precedence — overriding
 * one symbol never drops an unrelated registry symbol for the same chain).
 *
 * Deliberately NOT here: `self` (a runtime intrinsic, not a `bigint|boolean|number` constant — the
 * working spelling stays the compiler's own `ctx.self()`); SVM venue programIds; family-alias
 * spellings (`Uniswap_UniversalRouter` alongside `UniswapV4_UniversalRouter`); qualified cross-scope
 * `Base.USDC` (needs nesting).
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { loadPlugin, loadPluginData } from "../plugin/index.js";
import { pascalOfSlug } from "./builder.js";
import type { SauceCompileOptions } from "./sauce-route.js";
import type { AddressInput } from "./types.js";

export interface AmbientDefinesOptions {
  /** Caller-supplied token symbol -> address map, e.g. `{ USDC: "0x..." }`. */
  readonly tokens?: Readonly<Record<string, AddressInput>>;
}

function toBigIntAddress(input: AddressInput): bigint {
  return BigInt(input);
}

/**
 * The chain-scoped ambient defines map for `chain`: `chainId`/`CHAIN_ID`, every EVM protocol
 * contract address that has a real entry on `chain.id`, and any caller-supplied token symbols.
 *
 * P8: `protocolAddresses`/`tokens` are read through `loadPluginData()` (`plugin/index.ts`) rather
 * than importing `descriptors/registry.ts`/`token-registry.ts` directly — the SAME underlying
 * array/function, re-exposed through the plugin accessor as the single point the SDK reads
 * Layer-B data through. Byte-identical output: `loadPluginData().protocolAddresses` IS
 * `DESCRIPTORS` and `.tokens` IS `resolveTokenMap`, not a copy.
 */
export function chainDefines(
  chain: CanonicalChain,
  opts: AmbientDefinesOptions = {},
): Record<string, bigint | boolean | number> {
  const defines: Record<string, bigint | boolean | number> = {
    chainId: BigInt(chain.id),
    CHAIN_ID: BigInt(chain.id),
  };

  const plugin = loadPluginData();

  if (chain.kind === "evm") {
    for (const d of plugin.protocolAddresses) {
      const address = d.perChainAddress[chain.id];
      if (address === undefined) continue;
      const key = `${pascalOfSlug(d.protocol)}_${d.contract}`;
      defines[key] = toBigIntAddress(address);
    }
  }

  const tokenMap = plugin.tokens(chain, opts.tokens);
  for (const [symbol, address] of tokenMap) {
    defines[symbol] = address;
  }

  return defines;
}

/**
 * The ambient-MODULE half of a chain bundle (`chainDefines` above is the scalar-DEFINES half — two
 * distinct mechanisms, see `plugin/index.ts`'s note). Returns the ambient module specifier list
 * active for `chain`: whole SauceScript library modules whose exported functions/consts are
 * broadcast into a chain's compiled program with no `import` line (see
 * `sauce-route.ts#SauceCompileOptions.ambient`/`rs-compile.ts`).
 *
 * Currently a SINGLE source of truth, not yet chain-specific: every chain gets the same list, the
 * plugin manifest's own `ambient` array (`plugin/index.ts#loadPlugin`) — `["@sauce/token"]` by
 * default, resolved to the SDK's own vendored copy on the route path. Extensible to a genuinely
 * per-chain bundle later (e.g. an SVM destination activating an SVM-only ambient module an EVM one
 * shouldn't see) without changing this function's signature — a caller already threads `chain`
 * through.
 */
export function chainAmbient(_chain: CanonicalChain): string[] {
  return loadPlugin().ambient;
}

/**
 * `options` with `chain`'s whole ambient bundle underneath: `chainDefines` below the caller's own
 * `defines` (the caller wins a collision), and `chainAmbient` merged with the caller's `ambient`,
 * deduped — either side may name the same module.
 *
 * The bundle `openRoute` compiles a route body with, for `compileSauceProgram` — so a program
 * means the same thing on a Pot as in an intent. `compileSauceRoute` itself deliberately adds none
 * of this.
 */
export function withChainAmbient(
  chain: CanonicalChain,
  options: SauceCompileOptions,
  defines: AmbientDefinesOptions = {},
): SauceCompileOptions {
  const ambient = Array.from(new Set([...chainAmbient(chain), ...(options.ambient ?? [])]));

  return {
    ...options,
    defines: { ...chainDefines(chain, defines), ...options.defines },
    ambient: ambient.length > 0 ? ambient : options.ambient,
  };
}
