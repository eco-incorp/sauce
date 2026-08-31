/**
 * Per-chain token symbol -> address registry, the DEFAULT source for U4's `rewriteTokenMembers`
 * (`token-rewrite.ts`) and the balance sugar it now also implements — so a bare `USDC.transfer(to,
 * amt)` inside a `Base.route(...)` compiles with NO `IntentOptions.tokenDefines`.
 *
 * DISCOVERY (measured, not assumed): this SDK has no existing per-chain token-address source to
 * reuse. `protocols/erc20/addresses.ts` is deliberately empty ("ERC20 is a standard interface, not
 * a specific deployment" -- `ambient.ts`'s own HARD FINDING, unchanged). `protocols/*\/addresses.ts`
 * (127 protocols) are role-keyed CONTRACT maps -- a minority of role keys are genuinely tokens, but
 * none is USDC/USDT/WETH, and the keys are roles, not tickers, sitting beside non-token roles in
 * the same map -- not a derivable symbol table. `descriptors/registry.ts` only has Compound MARKETS
 * (CometUSDC/CometWETH), not the tokens themselves. `chains/canonical.ts` is identity-only by
 * design (no `nativeCurrency`). `svm/venues/**` addresses are SPL base58 mints, a different address
 * space this registry (EVM-only) does not cover. The only in-repo pinned token addresses are
 * `verify/vectors.ts`'s Base USDC/WETH (Tier 0 below).
 *
 * COVERAGE, tiered and self-describing (`knownTokenSymbols` derives from the rows below, so this
 * module can never claim more coverage than the data actually committed here):
 *
 *   TIER 0 (already pinned in-repo, zero new trust): base USDC/WETH -- `verify/vectors.ts`.
 *   TIER 1 (this cut, EACH ROW PROBE-VERIFIED before landing -- see the PROVENANCE GATE below):
 *     ethereum, optimism, arbitrum, polygon, base -- USDC, WETH, plus USDT wherever the deployed
 *     contract's OWN `symbol()` string-equals "USDT" (see the note below), plus the wrapped native
 *     under whatever `symbol()` actually returns where it isn't WETH (polygon's WPOL).
 *
 *   NOT CLAIMED: every other canonical chain; DAI/WBTC/USDS/cbETH/LST symbols; bridged token
 *   variants under a plain key (see below); SVM/SPL mints; decimals-aware amount sugar; anything
 *   auto-derived from `protocols/*\/addresses.ts` role keys.
 *
 * PROVENANCE GATE: a row lands only if (a) already pinned in-repo (`verify/vectors.ts`), or (b)
 * confirmed by a real RPC probe (via the paid Alchemy key in gitignored `sdk/.env`) checking
 * `getCode !== "0x"`, `symbol()` string-equals the row's `symbol`, and `decimals()` equals the
 * row's `decimals`. The probe itself is a one-time, network-dependent script -- never part of the
 * jest gate -- so this committed table stays static and the suite stays offline.
 *
 * THE symbol() CHECK IS LOAD-BEARING: it is what stops a bridged/renamed variant from landing under
 * a plain ticker key. Confirmed live during this cut's own probe: Arbitrum's and Polygon's
 * Tether-migrated USDT deployments return `symbol() == "USD₮0"` / `"USDT0"`, NOT `"USDT"` -- so
 * neither is registered under `USDT` here (a caller wanting that specific token still can, via
 * `tokenDefines`, which always overrides this registry per-key). Base's USDT was not independently
 * verified in this cut and is therefore also NOT claimed.
 */
import { getAddress, isAddress } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainById } from "../chains/canonical.js";
import type { AddressInput } from "./types.js";

// Mirrors token-rewrite.ts's own `REWRITABLE_METHODS` -- duplicated here rather than imported.
// token-rewrite.ts imports accessor-index.ts (for the balance-sugar holder-rejection checks),
// which imports builder.ts, which imports intent-dsl.ts, which imports sauce-route.ts, which
// imports THIS file (`resolveTokenMap`) -- so an import of token-rewrite.ts's export back here
// would close a genuine module-eval cycle: this file's own top-level validation loop (below) runs
// synchronously as part of resolving that cycle, before token-rewrite.ts's own top-level code has
// reached its `export const REWRITABLE_METHODS = ...` line, tripping a TDZ `ReferenceError`
// (confirmed reachable — this is not a hypothetical). Three well-known method names duplicated is
// a far smaller cost than restructuring that import graph; token-rewrite.ts's own module doc cross-
// references this list for anyone changing one who needs to remember the other.
const REWRITABLE_METHODS: ReadonlySet<string> = new Set(["transfer", "approve", "balanceOf"]);

export interface TokenRegistryRow {
  /** The ticker `symbol()` itself returns on-chain -- uppercase, e.g. "USDC", "WPOL". */
  readonly symbol: string;
  /** EIP-55 checksummed 20-byte address. */
  readonly address: `0x${string}`;
  /** Verification metadata only -- NOT consumed by the rewrite (no decimals-aware amount sugar). */
  readonly decimals: number;
  /** Provenance: an in-repo pin, or `probe:<chain>@<date>` for a network-verified row. */
  readonly source: string;
}

/** Keyed by canonical EVM chain id (`CanonicalChain.id`). */
export const TOKEN_REGISTRY: Readonly<Record<number, readonly TokenRegistryRow[]>> = {
  // ethereum (1) -- probe-verified 2026-08-11 (getCode + symbol() + decimals(), via sdk/.env's ETH_RPC_URL).
  1: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, source: "probe:ethereum@2026-08-11" },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, source: "probe:ethereum@2026-08-11" },
    { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, source: "probe:ethereum@2026-08-11" },
  ],
  // optimism (10) -- probe-verified 2026-08-11.
  10: [
    { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, source: "probe:optimism@2026-08-11" },
    { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, source: "probe:optimism@2026-08-11" },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, source: "probe:optimism@2026-08-11" },
  ],
  // polygon (137) -- probe-verified 2026-08-11. USDT deliberately excluded: the deployed contract's
  // own symbol() returns "USDT0" (Tether-migrated), not "USDT" -- fails the provenance gate's
  // symbol() check, so it does not land under the plain USDT key.
  137: [
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, source: "probe:polygon@2026-08-11" },
    { symbol: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, source: "probe:polygon@2026-08-11" },
    { symbol: "WPOL", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18, source: "probe:polygon@2026-08-11" },
  ],
  // monad (143) -- probe-verified 2026-08-31 (getCode + symbol() + decimals(), via rpc-mainnet.monadinfra.com).
  // Native Circle USDC (v2.2, per circle.com/multi-chain-usdc/monad) + the wrapped native WMON.
  143: [
    { symbol: "USDC", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, source: "probe:monad@2026-08-31" },
    { symbol: "WMON", address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", decimals: 18, source: "probe:monad@2026-08-31" },
  ],
  // base (8453) -- USDC/WETH already pinned in verify/vectors.ts (Tier 0); re-probed 2026-08-11 to
  // confirm the pinned constants still match a live symbol()/decimals() read.
  8453: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, source: "sdk:verify/vectors.ts" },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, source: "sdk:verify/vectors.ts" },
  ],
  // arbitrum (42161) -- probe-verified 2026-08-11. USDT deliberately excluded: symbol() returns
  // "USD₮0" (Tether-migrated), not "USDT" -- same provenance-gate rejection as polygon above.
  42161: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, source: "probe:arbitrum@2026-08-11" },
    { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, source: "probe:arbitrum@2026-08-11" },
  ],
};

// --- module-eval invariants (fail closed, mirroring accessor-index.ts's convention) --------------

const SYMBOL_RE = /^[A-Z][A-Z0-9]{1,10}$/;

for (const [idStr, rows] of Object.entries(TOKEN_REGISTRY)) {
  const id = Number(idStr);
  const chain = chainById(id);
  if (chain === undefined || chain.kind !== "evm") {
    throw new Error(`token-registry: key '${idStr}' is not a canonical EVM chain id`);
  }
  const seenSymbols = new Set<string>();
  const seenAddresses = new Set<string>();
  for (const row of rows) {
    if (!SYMBOL_RE.test(row.symbol)) {
      throw new Error(`token-registry: chain ${id} row '${row.symbol}' does not match ${SYMBOL_RE}`);
    }
    for (const method of REWRITABLE_METHODS) {
      if (row.symbol.toUpperCase() === method.toUpperCase()) {
        throw new Error(
          `token-registry: chain ${id} row '${row.symbol}' collides with U4's rewritable method ` +
            `'${method}' -- this would make the U4-vs-namespace recognition partition ambiguous`,
        );
      }
    }
    if (!isAddress(row.address, { strict: true }) || getAddress(row.address) !== row.address) {
      throw new Error(`token-registry: chain ${id} symbol '${row.symbol}' address is not EIP-55 checksummed`);
    }
    if (seenSymbols.has(row.symbol)) {
      throw new Error(`token-registry: chain ${id} has a duplicate symbol '${row.symbol}'`);
    }
    seenSymbols.add(row.symbol);
    const addrKey = row.address.toLowerCase();
    if (seenAddresses.has(addrKey)) {
      throw new Error(`token-registry: chain ${id} has a duplicate address '${row.address}'`);
    }
    seenAddresses.add(addrKey);
  }
}

// --- query surface ---------------------------------------------------------------------------

function toBigIntAddress(input: AddressInput): bigint {
  return BigInt(input);
}

/** The registry's own address for `symbol` on `chain`, or `undefined` if unregistered. EVM-only --
 *  an svm chain always returns `undefined` (no `TOKEN_REGISTRY` key exists for an svm chain id). */
export function registryTokenAddress(chain: CanonicalChain, symbol: string): bigint | undefined {
  if (chain.kind !== "evm") return undefined;
  const rows = TOKEN_REGISTRY[chain.id];
  const row = rows?.find((r) => r.symbol === symbol);
  return row === undefined ? undefined : BigInt(row.address);
}

/** Every symbol this registry knows for `chain`, sorted for stable diagnostics/tests. */
export function knownTokenSymbols(chain: CanonicalChain): readonly string[] {
  if (chain.kind !== "evm") return [];
  const rows = TOKEN_REGISTRY[chain.id] ?? [];
  return [...rows.map((r) => r.symbol)].sort();
}

/**
 * THE one precedence resolver every token-address consumer goes through: registry rows for `chain`
 * first (skipped entirely for a non-evm chain -- there are none to skip in practice, since no
 * `TOKEN_REGISTRY` key is ever an svm chain id, but the `chain.kind` guard makes that explicit
 * rather than incidental), then `callerTokens` merged PER KEY on top -- overriding one symbol (e.g.
 * `USDC`) never drops an unrelated registry symbol (e.g. `WETH`) for the same chain.
 */
export function resolveTokenMap(
  chain: CanonicalChain,
  callerTokens?: Readonly<Record<string, AddressInput>>,
): ReadonlyMap<string, bigint> {
  const map = new Map<string, bigint>();
  if (chain.kind === "evm") {
    for (const row of TOKEN_REGISTRY[chain.id] ?? []) {
      map.set(row.symbol, BigInt(row.address));
    }
  }
  if (callerTokens) {
    for (const [symbol, address] of Object.entries(callerTokens)) {
      map.set(symbol, toBigIntAddress(address));
    }
  }
  return map;
}
