/**
 * Flint (aka "Flint Trade") venue adapter — a closed-source proprietary AMM
 * ("prop AMM") on Solana, program `FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z`.
 * No on-chain Anchor IDL ships for this program, so everything below is
 * recovered by transaction archaeology (`getSignaturesForAddress` +
 * `getTransaction`, jsonParsed encoding) against a 4000-signature sample of
 * REAL, LANDED mainnet transactions — the same method that produced
 * bisonfi/humidifi/aquifer — cross-checked with our own `simulateTransaction`
 * probes (`sigVerify:false`, the standard technique for probing a program
 * without funds: the account-meta signer BIT drives execution without
 * needing that key's real signature). Full derivation trail:
 * `docs/flint-evidence.md`.
 *
 * ── Architecture: a HUB, not a per-pair pool ──
 * Unlike every other family in this repo, Flint has NO per-pair pool account
 * holding both mints. Instead, each of Flint's "market" accounts is a
 * SINGLE-MINT inventory vault-owner (variable size across markets observed —
 * 7728/9984/7388/9644/2368 bytes — so no fixed `dataSize` gPA filter exists
 * either): confirmed via `getTokenAccountsByOwner` for 6 real markets —
 * `35JazRP82XNsPLWL31Y3kwxYr3SABLufx9UnUJLnpkZz` -> USDT vault
 * `67nP7KoBRgrM6uJgPwVjDsxeV132471AvtJABLhj6jq5`,
 * `Dj9TPFLUsN9BmGMMC3GEbRb2Nuu3q5RMCQ7rzY8tg1Ww` -> USDC vault
 * `EiyYcHeonaax5m3BaUK55GkjevQrueatjCDaUoUQ7FJU`,
 * `BSDnuUchVVbadoc4ZDA4jPszHsH1WX4GMA9HVtKBq4bc` -> a Token-2022
 * pump.fun-launched mint (`pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn`) vault
 * `zh96VSSGmkGLHiKTFpEidDS4kdJuu5Yddric3cqcbyi`, plus wSOL/cbBTC/a long-tail
 * SPL markets observed but NOT covered by this adapter (see "Scope" below).
 * A single swap instruction debits one market's vault and credits another's —
 * ANY two markets can pair, so there is no `SVM_FAMILY_FILTERS` memcmp
 * geometry to write (no account embeds a counterparty mint at any offset).
 * Discovery is therefore a small CURATED registry
 * (`FLINT_PAIR_REGISTRY` below), wired via `withFlintStaticCandidates` in
 * discovery.ts — the exact same shape `HUMIDIFI_POOL_REGISTRY` already
 * established for a venue with no gPA geometry.
 *
 * ── Scope: 2 curated, REAL-evidence-backed pairs ──
 * `resolveSvmPoolSpec` treats a pool's REVERSE direction as gated by
 * `REVERSE_DIRECTION['flint']` in index.ts (set to `'BtoA'`); THIS module's
 * own `applyDirection` decides, PER POOL, whether that reverse is actually
 * supported (`entry.reversible`) — a pool that isn't simply throws, which
 * `resolveSvmPoolSpec`'s catch turns into a silent drop (never a crash), the
 * same shape as every other family's direction gate.
 *   1. USDT <-> USDC (`pool` = the USDC market `Dj9TPFLUsN9BmGMMC3GEbRb2Nuu
 *      3q5RMCQ7rzY8tg1Ww`) — ONE direction only (USDT->USDC, marketA->marketB
 *      here). REAL evidence: 10 landed T1TAN-router legs across a 4000-sig
 *      survey, sizes 1,134,870 to 17,703,755 raw USDT, EVERY one settling at
 *      essentially the same ~99.91% rate (e.g. tx `2ZAZQRGzKGkusQQQQea6CFf2D
 *      KLQSSoZkyKFvjCySdKNadJjfWcksZysMMD4ByLKZNa6xekZFEppWV8AUnJcjNur` moved
 *      17,703,755 in / 17,687,395 out) — confirmed BOTH via the venue
 *      vaults' own pre/post SPL balances AND via T1TAN's own per-leg log
 *      event (disc `65ccefa2fc2edc8a`). The REVERSE (USDC->USDT) is NOT
 *      shipped (`reversible: false`): a `simulateTransaction` probe reusing
 *      the SAME disc/shape with marketA/marketB swapped failed
 *      (`AccountLoaderError{context:"spot", err:"invalid discriminant"}`) —
 *      unlike the pumpCmXq pair below, swapping this pair's roles is NOT a
 *      same-shape operation, so shipping it would be a guess, not evidence.
 *   2. pumpCmXq (Token-2022) <-> USDT (`pool` = the pumpCmXq market
 *      `BSDnuUchVVbadoc4ZDA4jPszHsH1WX4GMA9HVtKBq4bc`) — BOTH directions,
 *      REVERSIBLE (`reversible: true`), same disc/tailZeros either way. REAL
 *      evidence: 5 landed pumpCmXq->USDT legs matched via T1TAN's own log
 *      event (14,839,219 to 24,959,817 raw pumpCmXq in; e.g. tx
 *      `5b2zhXvvXNGFai5gD3CYjYZMxR1DsBqThzFtV4j4vREoyKxApeiYrEYJTBX8u6JcB6jC
 *      uEakb8izPAmYd1PqXDJL` moved 24,959,817 in / 53,342 raw USDT out; 4 of
 *      the 5 additionally have a self-consistent pre-trade-reserve match and
 *      ride in `test/svm/fixtures/flint-probes.json` — the 5th's
 *      `preTokenBalances` lookup came back empty for unrelated reasons, see
 *      `docs/flint-evidence.md`) PLUS 2 landed USDT->pumpCmXq legs (the
 *      reverse direction, e.g. tx `4sRYkDt4nCdn6SH6L7ZZEgfJEUMJ9PRkGFbjX5oAC
 *      8uTiR3soYJkpndhnLktn9ZUmoA2keVyHCYnDYpLbNVvuKdo` moved 1,699,349 raw
 *      USDT in / 811,952,353 raw pumpCmXq out, both with a pre-trade-reserve
 *      match) — the reverse leg's own inner-instruction dump was read
 *      byte-for-byte to confirm the account order below holds with
 *      marketA/marketB (and the ata/vault roles) simply swapped, same
 *      disc=6/tailZeros=1, mint-account position unchanged (always the
 *      Token-2022 mint, regardless of which role it plays).
 * NOT shipped: the wSOL/cbBTC/long-tail markets we've also identified
 * (`7AQ4LkrxUtk8iC1tyZiv5dzFFk68XUAa5qJjtuPuY8GN` /
 * `DxYBaDH2BVzfpakAtpAopr9Z1m5DDG8cgXnPSkEGN8pY` — both also seen pairing
 * with the pumpCmXq market in the same survey, same disc=6 shape) — a future
 * slice can add them the same way once each is independently validated; this
 * is a coverage gap, never a safety gap (this family self-drops on any
 * fetch/gate failure — see `resolveSvmPoolSpec`'s catch — so a WRONG
 * discriminator would simply drop the pool, never mis-execute, but shipping
 * one without evidence defeats the point of this recovery method).
 *
 * ── Swap instruction (RE'd from 17+ real landed transactions across the two
 *    pairs above, cross-referenced against T1TAN's own per-leg log event) ──
 * `disc(1 byte) ++ amountIn(u64 LE, 8 bytes, PATCHED at runtime) ++
 * tail(N zero bytes)`. `disc`/`N` are NOT a single global constant — they
 * are stored per-registry-entry, exactly as chain-observed for THAT pair
 * (11 total bytes for USDT<->USDC, 10 for pumpCmXq<->USDT, either
 * direction); see `FLINT_PAIR_REGISTRY`.
 *
 * ── Accounts (11, or 12 when either mint is Token-2022 — FIXED order,
 *    ground-truthed against real transactions, BOTH directions where
 *    reversible) ──
 *   0 authority   (signer)            — token-authority for BOTH the input
 *                 debit and (via the market's own PDA-signed internal CPI)
 *                 the output credit; `SwapUser.owner` in production.
 *   1 Sysvar1nstructions (readonly)
 *   2 marketIn    (writable)          — input-side market/state account
 *   3 marketOut   (writable)          — output-side market/state account
 *   4 traderAtaIn (writable)          — authority's input-mint token account
 *   5 vaultIn     (writable)          — marketIn's own SPL vault (CREDITED)
 *   6 traderAtaOut(writable)          — authority's output-mint token account
 *   7 vaultOut    (writable)          — marketOut's own SPL vault (DEBITED)
 *   [8 mint (readonly)]               — ONLY when one side is Token-2022
 *                                        (needed for transferChecked); the
 *                                        Token-2022 side's own mint —
 *                                        UNCHANGED by direction (it is
 *                                        always the same physical mint,
 *                                        regardless of which role it plays).
 *   8/9 tokenProgramIn  (readonly)
 *   9/10 tokenProgramOut (readonly)
 *   10/11 FLINT program itself (readonly) — Flint lists its own program id as
 *                 a trailing account (used internally for a ~98 CU self-CPI
 *                 bookkeeping call after the transfers — entirely INTERNAL to
 *                 Flint's own logic; the caller never constructs that self-CPI).
 *
 * ── Quote curve — HONEST LIMITATION (same shape as bisonfi/humidifi) ──
 * Flint's real price is NOT a plain fixed-point scalar anywhere in either
 * market account's ~2-10KB of data (an oracle-crank keeper wallet posts
 * price/inventory updates roughly every 10-20 seconds via a SEPARATE,
 * distinctly-shaped instruction — disc=0, a repeating 24-byte-per-market
 * record — but the record's internal fields did not resolve to a plain
 * price scalar in the time available; see the evidence doc). What IS
 * live-readable and unobfuscated is each market's own vault's SPL `amount`
 * (standard offset 64). This ladder therefore quotes a virtual
 * constant-product curve over the two vaults' live balances, with an
 * ADDITIONAL haircut on top — but UNLIKE bisonfi/humidifi, naive CP over
 * the vaults' OWN reserves is NOT reliably conservative here: re-fetching
 * each of the 16 usable real fills' EXACT pre-trade vault balances (not a
 * single later "current" snapshot — Flint's thin vaults drift by 10s of %
 * within minutes, which a frozen snapshot badly aliases; see
 * `docs/flint-evidence.md`) shows naive CP (no haircut) slightly EXCEEDING
 * the real output for one USDT->USDC fill (ratio 1.0152) and MATERIALLY
 * exceeding it for both observed USDT->pumpCmXq (reverse) fills (ratio
 * 2.35-3.36x over) — a structural consequence of that direction dividing by
 * the THIN USDT reserve while the pumpCmXq reserve is ~1000x larger, not a
 * measurement fluke. The haircut is therefore PER DIRECTION, sized to the
 * worst real ratio observed for that direction plus a comfortable margin,
 * not one global constant:
 *   - USDT->USDC (`FLINT_HAIRCUT_USDT_USDC_PPM`): worst real naive-CP ratio
 *     1.0152 (10 fills) -> 700,000 ppm (0.7 x 1.0152 = 0.711, comfortably
 *     under 1).
 *   - pumpCmXq->USDT, the AtoB default for that pool
 *     (`FLINT_HAIRCUT_PUMPCMXQ_TO_USDT_PPM`): worst real naive-CP ratio
 *     0.5249 (4 fills) -> 900,000 ppm (0.9 x 0.5249 = 0.472).
 *   - USDT->pumpCmXq, the BtoA reverse (`FLINT_HAIRCUT_USDT_TO_PUMPCMXQ_PPM`):
 *     worst real naive-CP ratio 3.3597 (only 2 fills — a THIN evidence base,
 *     so this margin is deliberately much larger than the ratio alone would
 *     require) -> 150,000 ppm (0.15 x 3.3597 = 0.504).
 * Safe for election (a worse model never wins a share it doesn't deserve)
 * and trivially monotone/concave (a plain x/(r+x) curve, scaled by a
 * constant fraction, for any fixed positive scale). The real Flint CPI
 * still delivers its own authoritative output at cook time — this quote
 * only shapes off-chain ranking and the on-chain slot's own
 * predicted-output bookkeeping, never the real transfer.
 *
 * ── CU (measured 2026-08-01, REAL mainnet transaction logs — the "consumed
 *    X of Y compute units" line for Flint's own invoke, across BOTH shipped
 *    pairs and both directions) ──
 * pumpCmXq<->USDT (12 accounts, Token-2022 side): 12,201-17,963 CU per real
 * landed leg (7 samples, both directions). USDT->USDC (11 accounts, both
 * classic SPL): 12,201 CU per real landed leg. Both are markedly CHEAPER
 * than every other pinned family in `budget.ts` (the next-cheapest CP
 * family, raydium-amm-v4, is 163k+62k). `CU_FAMILIES.flint` is pinned
 * generously above the observed ceiling (see that file) — these are REAL
 * total-instruction measurements (not a stand-in harness), so unlike the
 * "omits the venue CPI" gap flagged for the original 12 pins, this pin's
 * `slot` term already reflects the real end-to-end cost; no local engine.so
 * re-measurement was available in this session to further split slot/rung,
 * so the split is conservative (see budget.ts's comment) — re-pin with
 * ECO_SVM_CU_PRINT=1 once one is.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig, VenueAccount } from "../types.js";

const SLUG = "flint";
export const FLINT_PROGRAM_ID = address("FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/**
 * Per-direction haircut applied ON TOP OF naive constant-product (ppm of
 * 1_000_000) — see the file header "Quote curve" section for the exact real
 * fill data and margin behind each of these three constants. Naive CP alone
 * is NOT reliably conservative for this venue (unlike bisonfi/humidifi), so
 * there is no single global constant.
 */
export const FLINT_HAIRCUT_USDT_USDC_PPM = 700_000n;
export const FLINT_HAIRCUT_PUMPCMXQ_TO_USDT_PPM = 900_000n;
export const FLINT_HAIRCUT_USDT_TO_PUMPCMXQ_PPM = 150_000n;

const USDT_MINT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PUMPCMXQ_MINT = address("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn");

const USDT_MARKET = address("35JazRP82XNsPLWL31Y3kwxYr3SABLufx9UnUJLnpkZz");
const USDT_VAULT = address("67nP7KoBRgrM6uJgPwVjDsxeV132471AvtJABLhj6jq5");
const USDC_MARKET = address("Dj9TPFLUsN9BmGMMC3GEbRb2Nuu3q5RMCQ7rzY8tg1Ww");
const USDC_VAULT = address("EiyYcHeonaax5m3BaUK55GkjevQrueatjCDaUoUQ7FJU");
const PUMPCMXQ_MARKET = address("BSDnuUchVVbadoc4ZDA4jPszHsH1WX4GMA9HVtKBq4bc");
const PUMPCMXQ_VAULT = address("zh96VSSGmkGLHiKTFpEidDS4kdJuu5Yddric3cqcbyi");

/** One curated Flint pair, in its DEFAULT (A -> B) orientation. */
export interface FlintPairEntry {
  marketA: Address;
  vaultA: Address;
  mintA: Address;
  tokenProgramA: Address;
  marketB: Address;
  vaultB: Address;
  mintB: Address;
  tokenProgramB: Address;
  /** Real, chain-recovered instruction discriminator for THIS pair (see file header). */
  disc: number;
  /** Zero-byte tail length after the patched amountIn u64 (see file header). */
  tailZeros: number;
  /** The Token-2022 side's mint, if either side is Token-2022 (needed for transferChecked). */
  checkedMint?: Address;
  /** Whether the B->A direction is ALSO real-evidence-confirmed (see file header "Scope"). */
  reversible: boolean;
  /** Haircut (ppm) for the A->B direction — see file header "Quote curve" for the real-fill basis. */
  haircutAtoBPpm: bigint;
  /** Haircut (ppm) for the B->A direction — REQUIRED iff reversible (a DIFFERENT margin; see file header). */
  haircutBtoAPpm?: bigint;
}

/**
 * Curated registry, keyed by the "pool" address this family is discovered
 * under — the NON-USDT side of each pair (USDT is the common factor in both
 * shipped pairs today). See file header "Scope" for the evidence backing
 * each entry and each entry's reversibility.
 */
export const FLINT_PAIR_REGISTRY: Record<string, FlintPairEntry> = {
  [USDC_MARKET as string]: {
    marketA: USDT_MARKET,
    vaultA: USDT_VAULT,
    mintA: USDT_MINT,
    tokenProgramA: TOKEN_PROGRAM,
    marketB: USDC_MARKET,
    vaultB: USDC_VAULT,
    mintB: USDC_MINT,
    tokenProgramB: TOKEN_PROGRAM,
    disc: 11,
    tailZeros: 2,
    reversible: false,
    haircutAtoBPpm: FLINT_HAIRCUT_USDT_USDC_PPM,
  },
  [PUMPCMXQ_MARKET as string]: {
    marketA: PUMPCMXQ_MARKET,
    vaultA: PUMPCMXQ_VAULT,
    mintA: PUMPCMXQ_MINT,
    tokenProgramA: TOKEN_2022_PROGRAM,
    marketB: USDT_MARKET,
    vaultB: USDT_VAULT,
    mintB: USDT_MINT,
    tokenProgramB: TOKEN_PROGRAM,
    disc: 6,
    tailZeros: 1,
    checkedMint: PUMPCMXQ_MINT,
    reversible: true,
    haircutAtoBPpm: FLINT_HAIRCUT_PUMPCMXQ_TO_USDT_PPM,
    haircutBtoAPpm: FLINT_HAIRCUT_USDT_TO_PUMPCMXQ_PPM,
  },
};

export interface FlintPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  entry: FlintPairEntry;
  /** 'AtoB' = entry's default orientation; 'BtoA' only when entry.reversible. */
  direction: "AtoB" | "BtoA";
}

function flintConfig(cfg: PoolConfig): FlintPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as FlintPoolConfig;
}

/** The directed (in, out) roles for a config, resolving its `direction` against its `entry`. */
function directed(cfg: FlintPoolConfig) {
  const e = cfg.entry;
  return cfg.direction === "BtoA"
    ? {
        marketIn: e.marketB,
        vaultIn: e.vaultB,
        mintIn: e.mintB,
        tokenProgramIn: e.tokenProgramB,
        marketOut: e.marketA,
        vaultOut: e.vaultA,
        mintOut: e.mintA,
        tokenProgramOut: e.tokenProgramA,
      }
    : {
        marketIn: e.marketA,
        vaultIn: e.vaultA,
        mintIn: e.mintA,
        tokenProgramIn: e.tokenProgramA,
        marketOut: e.marketB,
        vaultOut: e.vaultB,
        mintOut: e.mintB,
        tokenProgramOut: e.tokenProgramB,
      };
}

async function fetchPoolConfig(owned: OwnedAccountLoader, pool: Address): Promise<FlintPoolConfig> {
  const load = accountDataLoader(owned);
  // Per-side token programs are threaded from the curated registry (tokenProgramA/
  // tokenProgramB), each real-evidence-confirmed per pair — the Token-2022 side
  // (pumpCmXq) carries TOKEN_2022_PROGRAM and its own `checkedMint` for the swap
  // ix's transferChecked. Opposite sides differ (pumpCmXq is Token-2022, its USDT
  // counterparty is legacy), which the registry captures explicitly.
  // TODO(t22-fee-netting): the curated pumpCmXq (Token-2022) mint is NOT
  // transfer-fee-netted here. Flint's quote is a per-direction constant-product
  // haircut over live vault balances (see the "Quote curve" header) sized to the
  // WORST observed real-fill ratio plus a large margin, so any small wire fee is
  // already absorbed conservatively; and there is no referenceQuote in this
  // fetch-only adapter to net a fee on. If a curated pair's Token-2022 side is
  // ever found to carry a material effective fee, net it in the consuming app's
  // Flint quote fragment rather than here — a missed netting is a safe self-limit.
  const entry = FLINT_PAIR_REGISTRY[pool as string];
  if (entry === undefined) {
    throw new Error(`${SLUG}: ${pool} is not a curated pair (see FLINT_PAIR_REGISTRY)`);
  }
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} market ${pool} account not found`);
  return { venue: SLUG, pool, entry, direction: "AtoB" };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = flintConfig(base);
  const d = directed(cfg);
  return [
    { ref: `${cfg.pool}:vaultIn`, address: d.vaultIn },
    { ref: `${cfg.pool}:vaultOut`, address: d.vaultOut },
  ];
}

export const flint = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: FLINT_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};
