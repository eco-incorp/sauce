/**
 * HumidiFi (SvmRoute ladder fragment) — a top-10 chain-wide venue
 * (201.9M/7d, 40.3M/24h per the benchmark's Jupiter-label capture) with NO
 * on-chain IDL. This module is a from-scratch binary reverse-engineering,
 * not a port of any published adapter — the SDK ships no `humidifi` ladder.
 *
 * ── What was recovered (all evidence below is re-derivable — see
 *    `docs/humidifi-evidence.md` for the exact signatures/RPC calls) ──
 *
 * 1. TWO on-chain programs: a route/setup program (`AubCGUt9FfbuzrpFWcFgS4U6
 *    FTYRAfuzxrdtttN5TGP`) and the swap-settlement program this module
 *    targets (`9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp`).
 * 2. The 25-byte swap instruction's XOR obfuscation scheme: a 1:1 port of
 *    the public "HumidiFi Swap Parser" gist
 *    (gist.github.com/fengtality/fbfa28597be122ed74d4f25046b3e5a5, MIT-style
 *    utility script, independently verified against live mainnet
 *    transactions in this PR): 8-byte key `HUMIDIFI_XOR_KEY`, XORed in
 *    8-byte chunks with a per-chunk position mask (`pos·0x0001_0001_0001_
 *    0001`, `pos` = the 0-based chunk index). Layout: bytes 0-7 = an
 *    unstructured "header" that changes on EVERY observed transaction (see
 *    #4), bytes 8-15 = amountIn (u64 LE), byte 16 = a direction flag, bytes
 *    17-24 = mostly-zero trailer.
 * 3. The account order for the swap CPI (verified against >20 real
 *    transactions across 4 distinct pools): [user transfer authority
 *    (signer), pool state, base-token vault, quote-token vault, <2
 *    per-transaction accounts, see #4>, SysvarClock, token program (x2),
 *    ...variable trailing accounts]. The pool's own vaults are STANDARD SPL
 *    Token accounts (decoded the ordinary way — `amount` at offset 64) —
 *    confirmed via `preTokenBalances`/`postTokenBalances` on every sampled
 *    transaction.
 * 4. TWO STRUCTURAL BLOCKERS to fully autonomous instruction construction,
 *    both confirmed by direct evidence, not inferred from "thin docs":
 *      a. The 8-byte "header" (bytes 0-7) is DIFFERENT on every single
 *         sampled transaction, including repeated trades on the identical
 *         pool seconds apart with different amounts. It is not a
 *         discriminator (constant) or a simple function of amountIn/
 *         direction/pool/user we could reproduce.
 *      b. Two of the instruction's accounts (index 4 and 5 of the swap ix)
 *         are DIFFERENT on every single sampled transaction, even for
 *         repeated trades on the identical pool by different callers.
 *    Both point to the same mechanism: HumidiFi settles a per-trade,
 *      off-chain-negotiated commitment (consistent with its integration with
 *      DFlow's order-flow auction — the router in every sampled route is
 *      DFlow's `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH`, and the
 *      program logs a `dflow_score` event on every swap). An on-chain
 *      SauceScript program cannot participate in that off-chain negotiation,
 *      so `buildSwapV2` below cannot fill in a header/pair of accounts that
 *      the deployed program will accept for a NEW trade it never
 *      pre-negotiated. This is the documented, evidenced basis for the
 *      `humidifi` family's prepare-time gate in `the consuming app SVM solver entry`
 *      (`FAMILIES.humidifi.gate`) — not a permission/whitelist gate, and not
 *      env-flagged; see that file for exactly what is gated and why lifting
 *      it needs an off-chain RFQ-participation slice, not a code tweak here.
 * 5. The pool's OWN account (e.g. `3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuek
 *    ia2`, 1728 bytes, owner = the swap program) does not expose the pair's
 *    mints/vaults in plaintext at any offset/width/scale we scanned
 *    (verified by brute-force byte-window scanning cross-checked against
 *    TWO pools' independently-known real values — zero matches beyond one
 *    coincidental hit disproved by a 3rd pool). Discovery therefore cannot
 *    use `getProgramAccounts` + memcmp like every other family (see
 *    `SVM_FAMILY_FILTERS`'s `Partial<>` widening in discovery.ts) — pools
 *    are served from `HUMIDIFI_POOL_REGISTRY` below, a small hand-verified
 *    seed (curated the same way the SvmRoute route lane already curates
 *    hub mints instead of running an unbounded search).
 * 6. The realized price is NOT a function of the vault reserve ratio.
 *    Constant-product-over-reserves diverges from 21 real trades (2 pools,
 *    both directions, sizes from 0.01 to 10.57 SOL-equivalent) by 12.9%-57.8%, and the SIGN
 *    of the divergence flips within minutes on the SAME pool (proof: two
 *    snapshots of pool `3QYY...` four minutes apart show naive
 *    constant-product first UNDER- then OVER-estimating real output) — this
 *    venue quotes at a price set by an external process (again consistent
 *    with an RFQ), not by its own vault ratio. See `HUMIDIFI_SAFETY_FEE_PPM`
 *    below for how the quote curve stays conservative despite this.
 *
 * ── Pricing model (deliberately NOT venue-exact — see #6) ──
 *
 * The quote curve is textbook constant-product over the two vaults' LIVE
 * balances, with a 70% "safety haircut" applied to the input before the
 * curve (`HUMIDIFI_SAFETY_FEE_PPM` = 300,000 of 1,000,000, i.e. only 30% of
 * the input counts) — NOT a claim about HumidiFi's real fee, a conservative
 * bound sized so the merge never over-promises this venue's output (a
 * favourable error would win elections it cannot back up — see CLAUDE.md's
 * dust-K1 note). A 50% haircut (the first value tried) is NOT enough: it
 * stays safe across the 21-trade SOL/USDC-wormhole sample but OVER-promises
 * the second, memecoin/USDC pool by 18.6% on its one sampled trade — the
 * reserve-ratio-vs-real-price gap is pair-dependent, not just
 * time-dependent (see #6), so the constant had to be re-derived against
 * BOTH pools together, not just the one with more samples. At 70% haircut
 * the model stays BELOW the real realized output on all 22 gathered real
 * trades across both pools, worst-case margin 28.8% (the memecoin pool's
 * one sample) — see `docs/humidifi-evidence.md` for the full table and the
 * 50%-haircut counter-example. The curve is monotone and concave in the
 * input (a haircut constant-product IS a constant-product, just steeper),
 * so it cannot trigger the "coarse ladder gets allocated ZERO" failure mode.
 *
 * ── CU (`the consuming app SVM CU-budget module`'s `CU_FAMILIES.humidifi`) ──
 *
 * MEASURED, not modeled: two real mainnet CPI costs were read directly off
 * transaction logs — "Program 9H6tua7...consumed 40326 of ... compute
 * units" (tx `bCw8o8Aymp7T6kiGb3ac11DQo9ssx4TTKiBiM7TYSNfJw9wpCLNuCMhfZiCh9M
 * PHpNbV5JRQPrT5fairRt81xVk`) and "...consumed 31586..." (tx `dWC5fQYJog1i2
 * XbKDsZvXMK6wFLin8WDFdjdobRUFBafX4AzNzT1h7heP7Pwo9Zo4mZZBsGjC3dwdWAry8fv3Q5
 * `). The pin adds a margin-padded 45,000 (the higher measurement + ~12%)
 * on top of a same-complexity-family analog baseline (raydium-cp-swap's
 * 183,187 — two vault reads + one constant-product formula + merge share,
 * structurally identical to this family's fragment) instead of reusing a
 * placeholder, per the standing "existing pins omit the venue CPI" gap.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig } from "../types.js";

const SLUG = "humidifi";

/** The swap-settlement program (NOT the `AubCGUt9...` route/setup program). */
export const HUMIDIFI_PROGRAM_ID: Address<"9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp"> = address(
  "9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp",
);

// ── obfuscation scheme (verified against >20 live mainnet transactions) ──

/** The 8-byte XOR key, per the public "HumidiFi Swap Parser" gist (see file header, item 2). */
export const HUMIDIFI_XOR_KEY: readonly number[] = [58, 255, 47, 255, 226, 186, 235, 195];

/** The 8-byte keystream for 8-byte chunk `pos` (0-based): `HUMIDIFI_XOR_KEY[j] ^ ((pos·0x0001_0001_0001_0001) bytes)[j]`. */
export function humidifiKeystream(pos: number): Uint8Array {
  const out = new Uint8Array(8);
  const lo = pos & 0xff;
  const hi = (pos >> 8) & 0xff;
  for (let j = 0; j < 8; j += 2) {
    out[j] = HUMIDIFI_XOR_KEY[j]! ^ lo;
    out[j + 1] = HUMIDIFI_XOR_KEY[j + 1]! ^ hi;
  }
  return out;
}

/** chunk 1 (bytes 8-15, amountIn) keystream, as a little-endian u64 — XORing a runtime LE value
 *  with this constant is byte-for-byte equivalent to XORing the two 8-byte arrays (see file header
 *  item 2 and `buildSwapV2` below), so this is exactly what `patchXorMaskIn` needs to be. */
export const HUMIDIFI_AMOUNT_XOR_MASK: bigint = (() => {
  const k = humidifiKeystream(1);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(k[i]!);
  return v;
})();
/** Deobfuscate a captured 25-byte HumidiFi swap instruction (test/verification use). */
export function humidifiDeobfuscate(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  let pos = 0;
  for (let i = 0; i < data.length; i += 8) {
    const chunkLen = Math.min(8, data.length - i);
    const ks = humidifiKeystream(pos);
    for (let j = 0; j < chunkLen; j++) out[i + j] = data[i + j]! ^ ks[j]!;
    pos++;
  }
  return out;
}

// ── static pool registry (see file header item 5 for why gPA can't discover these) ──

export interface HumidiFiRegistryEntry {
  baseVault: Address;
  quoteVault: Address;
  baseMint: Address;
  quoteMint: Address;
  baseDecimals: number;
  quoteDecimals: number;
}

/**
 * Hand-verified HumidiFi pools: for each, a real mainnet swap transaction was
 * decoded (obfuscation removed, account order matched) and the vault/mint
 * addresses were cross-checked against `preTokenBalances`/`postTokenBalances`
 * on that transaction. Ranked by observed activity in the sampled window;
 * extend by repeating the same verification (see docs/humidifi-evidence.md).
 */
export const HUMIDIFI_POOL_REGISTRY: Record<string, HumidiFiRegistryEntry> = {
  // SOL / USDC (native, EPjF...) — the top pair by sampled tx frequency.
  "8sKQHfjNhvmAw94PhfvfMcytmqW6jmxvwieYyzXCCPu": {
    baseVault: address("H292B1VbSvD6GuUmSvUvfQstg1Acfzog796uQ7d1ccCw"),
    quoteVault: address("A3C9xwv4Hfx92M5HQpxUiibSqCa5pYhD2kTwnU5fEPq"),
    baseMint: address("So11111111111111111111111111111111111111112"),
    quoteMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    baseDecimals: 9,
    quoteDecimals: 6,
  },
  // SOL / USDC (Wormhole, Es9v...) — heavily sampled (21 real trades, see file header item 6).
  "3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuekia2": {
    baseVault: address("AzzKL5BpnX9UXfJRyiGbAwyFvw93vwCTBvW56tJebsqd"),
    quoteVault: address("EmyNiSYtMYZsBCVYpzLwNduQFqCpDGR8qM1h2CoLpWnM"),
    baseMint: address("So11111111111111111111111111111111111111112"),
    quoteMint: address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    baseDecimals: 9,
    quoteDecimals: 6,
  },
  // A memecoin / USDC pair, sampled to confirm the pricing model generalizes off SOL pairs.
  H3TyE2Q3rDrvRXD8PzHYE7BS2hafGuybje4qXCtyWqMH: {
    baseVault: address("49pft8q7cyugVDWnJCXjMHJdb5Uji198k5MognVvA48n"),
    quoteVault: address("EKFwmKoPA9o3HpoL8AnQd8uNBxtJbaPv4w4tbxNn6iei"),
    baseMint: address("98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g"),
    quoteMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    baseDecimals: 9,
    quoteDecimals: 6,
  },
  ELp3rjbAncW8FLAPvmWS6vjG4FXFLDo1HiKh4PhQBgvx: {
    baseVault: address("4uGxv6uabyEmHzhi7LBWGzqSwGEE98VzYL2NahRqbfCP"),
    quoteVault: address("2XCEJJf3hnuMeot5dJST9yaj92i1wCLB2c67eH7WYzvR"),
    baseMint: address("Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk"),
    quoteMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    baseDecimals: 6,
    quoteDecimals: 6,
  },
};

export interface HumidiFiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'baseToQuote' (default, flag byte 0) sells the registry's baseMint; 'quoteToBase' (flag byte 1) sells quoteMint. */
  direction: "baseToQuote" | "quoteToBase";
  baseVault: Address;
  quoteVault: Address;
  baseMint: Address;
  quoteMint: Address;
  baseDecimals: number;
  quoteDecimals: number;
}

/**
 * Registry lookup + liveness check ONLY — this family's pool account carries
 * no plaintext structure we can decode (file header item 5), so there is
 * nothing further to read off it. `load(pool)` still runs once so a pool
 * whose account has since closed/reallocated (a stale registry entry) is
 * dropped like any other vanished pool, never silently misquoted.
 */
export async function fetchHumidifiConfig(
  load: AccountLoader,
  pool: Address,
): Promise<HumidiFiPoolConfig> {
  const entry = HUMIDIFI_POOL_REGISTRY[pool as unknown as string];
  if (entry === undefined) {
    throw new Error(
      `${SLUG}: pool ${pool} is not in HUMIDIFI_POOL_REGISTRY — this venue's pool state has no ` +
        "decodable plaintext layout (verified by exhaustive offset scan), so unregistered pools " +
        "cannot be resolved at all; see the consuming app humidifi venue module for how to add one",
    );
  }
  const raw = await load(pool);
  if (raw === null)
    throw new Error(`${SLUG}: pool ${pool} account not found (registry entry stale?)`);
  return { venue: SLUG, pool, direction: "baseToQuote", ...entry };
}

/**
 * Safety haircut on the INPUT before a plain constant-product curve — NOT a
 * claim about HumidiFi's real fee (unknown, see file header item 6). Only
 * 300,000 (of 1,000,000) = 30% of the input counts (a 70% haircut). Chosen
 * so the model stays below every one of 22 real sampled trades' realized
 * output ACROSS TWO DIFFERENT POOLS (worst-case margin 28.8%, on the
 * memecoin/USDC pool) — a 50% haircut passes the 21-trade SOL/USDC sample
 * but over-promises the second pool by 18.6%, so this constant is
 * calibrated against the worst pool sampled, not the best-sampled one.
 */
export const HUMIDIFI_SAFETY_FEE_PPM = 300_000n;
