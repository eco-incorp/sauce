/**
 * AlphaQ — a "quant" multi-market Solana AMM with NO on-chain IDL. Program id
 * `ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA`, Jupiter label `"AlphaQ"`
 * (`benchmark/adapters/fixtures/jupiter-program-id-to-label.json`), $218.8M/7d
 * $40.5M/24h per the Jupiter volume snapshot this integration was scoped from.
 *
 * REVERSE-ENGINEERED FROM MAINNET (no IDL, no docs) via:
 *   1. `getProgramAccounts` (owner=program id) split by `dataSize` — every
 *      market is a 672-byte "config" account (symbol/mints/vaults/decimals)
 *      paired 1:1 by a 16-byte leading ASCII symbol string with a 336-byte
 *      "stats" account (per-market hot state the swap CPI writes to; holds no
 *      pubkeys itself and does not derive from the market's address by any
 *      PDA / `create_address_with_seed` scheme we could find — see
 *      `ALPHAQ_STATS_ACCOUNTS` below).
 *   2. `getSignaturesForAddress` + `getTransaction` on a market account to
 *      isolate real historical swap CPIs (the program's OWN keeper also calls
 *      it directly with an unrelated, longer, per-market "crank"/oracle-update
 *      instruction — never confuse the two; only the CPI-nested one below is
 *      the swap).
 *   3. Jupiter's public `quote` + `swap-instructions` endpoints, replayed
 *      through `simulateTransaction` (sigVerify:false, replaceRecentBlockhash,
 *      innerInstructions:true) to recover the EXACT bytes of a FRESH,
 *      currently-valid swap CPI at several sizes and both directions — a
 *      byte-for-byte replay of a real HISTORICAL swap's instruction data
 *      reproducibly fails `InvalidInstructionData` at ~2,011 CU regardless of
 *      account permissions, CPI depth (tested via a purpose-built on-chain
 *      relay program) or payload content, so the format could only be pinned
 *      by observing FRESH instructions the chain still accepts, not by
 *      decoding a captured one. See "SWAP INSTRUCTION" below for the result.
 *   4. A same-technique account-permission bisection (via the same relay
 *      program) to find the one non-obvious flag: account #2 (the "stats"
 *      account) must ride WRITABLE or the CPI fails `Immutable` after both
 *      SPL transfers already ran.
 *
 * SWAP INSTRUCTION (opcode 0x0c) — 18 bytes total, CONFIRMED against the real
 * program via `simulateTransaction` at 4 sizes (10, 1,000, 5,000, 50,000,
 * 130,000 USDT) and both directions on the USDT-USDC market:
 *   `[0x0c, dirByte, amountIn: u64 LE, 0x00 * 8]`
 *   - dirByte = 1: mintA(vaultA) -> mintB(vaultB); dirByte = 0: reverse.
 *   - the trailing 8 bytes are always zero in every real sample gathered —
 *     no venue-level min_out; the recipe's own terminal outAta-delta check
 *     is the real floor, following the same "venue min_out is always 1"
 *     convention every ladder uses (here it's simply absent, not encoded as 1).
 *   - amountIn genuinely needs the full 8 bytes: confirmed via a
 *     130,000,000,000-raw-unit (130k USDT) trade whose encoded value exceeds
 *     u32 range and round-trips exactly as a u64 LE.
 *
 * ACCOUNTS (12, order load-bearing, CONFIRMED against Jupiter's real
 * swap-instructions accounts + a from-scratch replay via a purpose-built
 * on-chain CPI relay program — see the module doc above):
 *   0 owner            (signer)
 *   1 market            (672-byte config account; read-only)
 *   2 stats             (336-byte hot-state account; WRITABLE — the one
 *                         non-obvious flag; omitting it fails `Immutable`
 *                         after both transfers already landed)
 *   3 user source ATA   (writable)
 *   4 user dest ATA     (writable)
 *   5 vaultA            (writable)
 *   6 vaultB            (writable)
 *   7 vaultA            (dup, read-only)
 *   8 vaultB            (dup, read-only)
 *   9 vaultB            (dup, writable — the observed "fee" leg; always
 *                         vaultB regardless of trade direction in every
 *                         sample gathered)
 *  10 token program (Tokenkeg)
 *  11 instructions sysvar
 *
 * MARKET ACCOUNT (672 bytes) layout actually used here (every offset
 * ground-truthed against >=40 real mainnet market accounts via gPA, matched
 * to known mint addresses and real SPL vault balances/decimals):
 *   [0:16)    ASCII symbol, e.g. "USDT-USDC", NUL-padded (also the stats
 *             account's own leading 16 bytes — the ONLY join key available;
 *             see ALPHAQ_STATS_ACCOUNTS)
 *   [106]     decimalsA (u8)
 *   [107]     decimalsB (u8)
 *   [112:144) vaultA (SPL token account holding mintA; matches offset 176
 *             verbatim in every sample — a duplicated field, harmless)
 *   [144:176) vaultB (ditto, duplicated at 208 and 304)
 *   [240:272) mintA
 *   [272:304) mintB
 * Fields outside this list (a keeper/admin pubkey at [24:56), several
 * slot/timestamp u32s, and a large unread block from [336:672) that almost
 * certainly holds AlphaQ's REAL virtual-liquidity / curve state) are not
 * decoded — see "QUOTE MODEL" for why they are not needed here.
 *
 * QUOTE MODEL — DELIBERATELY CONSERVATIVE, NOT AlphaQ's real curve, AND
 * SCOPE-LIMITED to genuine $1-stablecoin pairs (see STABLE_MINTS below).
 * Real quotes gathered live (USDT-USDC, `onlyDirectRoutes=true` so
 * single-market): 5,000 USDT -> 4995.696234 USDC (-8.6bps), 50,000 ->
 * 49942.058920 (-11.6bps), 130,000 -> 129625.077569 (-28.8bps). Back-solving
 * a constant-product (x*y=k) curve from those points gives an EFFECTIVE
 * depth of ~46.19M raw-unit tokens each side — roughly 300x the market's
 * REAL SPL vault balances (~150k USDT / ~290k USDC at capture time) — i.e.
 * AlphaQ is NOT pricing off its own vault balances; it has some deeper
 * backing (a shared multi-market hub, an oracle, or both) this integration
 * could not fully identify from the outside.
 *
 * REJECTED FIRST ATTEMPT (kept here as a citable mistake, not a footnote):
 * an earlier revision of this file priced directly off the raw vaultA/
 * vaultB SPL balances as a plain constant-product pair (reserveIn,
 * reserveOut) = (vaultA, vaultB). That is WRONG, not just imprecise — this
 * market's vaults are frequently skewed (observed ~2.15:1 USDC:USDT at one
 * capture), and a plain CP formula's SPOT PRICE *is* reserveOut/reserveIn,
 * so it would have quoted ~2.15 USDC per 1 USDT — a gross, FAVOURABLE
 * mispricing of the base exchange rate itself (not merely the slippage
 * curve), caught by this file's own offline test
 * (test/fast/alphaq.quote.test.ts) asserting predicted <= real against a
 * freshly re-fetched fixture. The fix below never derives the spot price
 * from the raw reserve ratio.
 *
 * THE ACTUAL MODEL: assumes near-1:1 fair value between mintA and mintB
 * (true for a genuine stablecoin pair, false for an LST/SOL or wrapped-BTC
 * pair) and prices a SYMMETRIC constant-product curve `out = net * D /
 * (D + net)` where `D = min(rawVaultA, rawVaultB)` (raw units — see the gate
 * below requiring decimalsA === decimalsB, which makes raw-unit comparison
 * directly meaningful) and `net = x - ceil(x * 10bps)`. Spot price is
 * therefore pinned at parity (minus the haircut), never at the skewed raw
 * ratio; depth is bounded by the THINNER real vault, which is real,
 * verifiable, on-chain state — this UNDERSTATES AlphaQ's real (~300x
 * deeper) depth on every market checked, the safe direction. Monotone +
 * concave by construction (a standard CP curve). The real on-chain CPI
 * still executes AlphaQ's OWN pricing regardless of this model's accuracy
 * — this curve only shapes OFF-CHAIN election/sizing; the recipe's
 * post-swap outAta-delta check is what actually bounds the fill.
 *
 * SCOPE GATE: this model is only SAFE for pairs both sides of which are
 * genuine ~$1 stablecoins — for an LST-SOL or wrapped-BTC market (also
 * present in AlphaQ's universe) the true fair rate is NOT 1:1, and assuming
 * parity could OVER-promise the appreciated side (e.g. paying 1 SOL for
 * jitoSOL at assumed parity would over-promise jitoSOL, since jitoSOL is
 * really worth MORE than SOL) — exactly the favourable-error hazard this
 * integration exists to avoid. `fetchAlphaqPoolConfig` therefore requires
 * BOTH mints to be in the curated `STABLE_MINTS` set below AND to share the
 * same on-chain decimals, self-dropping (throwing, caught by
 * `resolveSvmPoolSpec`) every other AlphaQ market rather than guessing at a
 * price this integration has no oracle to verify. That is a real, current
 * scope limitation (9 of AlphaQ's 40 markets, all $1-stablecoin pairs) —
 * not a refusal: extending to LST/BTC/RWA pairs needs an actual price
 * reference this integration does not have, not more reserve-reading.
 *
 * UPDATE — the price reference WAS found: AlphaQ's live oracle spot is in the
 * 336-byte STATS account at {@link OFF_STATS_PRICE} (u64 LE, price*1e10,
 * mintA->mintB), recovered by cross-market correlation against live rates. The
 * former hard "both mints must be a curated stablecoin" gate is LIFTED: any
 * equal-decimal market with a sane stats price now serves, priced at that real
 * spot (see `alphaqQuote`). A genuine stablecoin pair (both in `STABLE_MINTS`)
 * still keeps the exact parity model, byte/lamport-identical (`isStablePair`).
 * A non-stable market with no readable stats price self-drops rather than
 * assuming parity (which mispriced syrupUSDC ~1.178 as 1.0 and forced the
 * catastrophic route). The decimalsA === decimalsB precondition stays.
 * CONSUMER NOTE: the recipe ladder's on-chain fragment should read stats@56
 * LIVE at cook time (the price drifts); this SDK config carries `priceRaw` for
 * the off-chain reference/sizing.
 *
 * KNOWN OPEN ISSUE: the real-CPI LiteSVM cell for this family
 * (the consuming app realcpi e2e test's `alphaq quadrilateral`)
 * currently fails `InvalidAccountOwner` at ~5,010 CU inside AlphaQ's own
 * execution, DESPITE the identical account list/instruction format being
 * independently proven correct on REAL mainnet via two separate methods (a
 * from-scratch CPI relay program and Jupiter's own route) at 5 sizes and
 * both directions. See that test file's module doc for the full
 * investigation trail (what was ruled out and what remains untested) — this
 * is flagged as a follow-up, not resolved by guessing further.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { base64Bytes } from "../../../bytes.js";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";

const SLUG = "alphaq";
export const ALPHAQ_PROGRAM_ID = address("ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA");
const MARKET_SIZE = 672;
const OFF_DECIMALS_A = 106;
const OFF_DECIMALS_B = 107;
const OFF_VAULT_A = 112;
const OFF_VAULT_B = 144;
const OFF_MINT_A = 240;
const OFF_MINT_B = 272;
/**
 * Flat conservative haircut applied on the INPUT side of the constant-product
 * model, in bps of 10,000 — see the module doc's "QUOTE MODEL" section for
 * why this is a deliberately crude, reserve-based stand-in for AlphaQ's real
 * (materially deeper) pricing, never the reverse.
 */
const HAIRCUT_BPS = 10n;
const HAIRCUT_DENOM = 10_000n;

/**
 * The market's 336-byte STATS account carries AlphaQ's LIVE oracle price of
 * mintA in mintB at offset 56 (u64 LE), scaled by 1e10 — the "deeper backing"
 * the module doc's QUOTE MODEL section notes the vaults do not reflect. This is
 * what lets a NON-stable pair (an LST/SOL, a yield-bearing stable like
 * syrupUSDC at ~1.178) be priced at its real spot instead of an assumed
 * parity. Reverse-engineered by correlating stats@56/1e10 against live rates
 * across 21 markets (SYRUPU-USDC 1.1783 vs Jupiter 1.1784, MSOL-SOL 1.398,
 * JITOSO-SOL 1.295, every stable ~1.0 — all within a few bps); confirmed
 * stable across re-reads (an oracle field the keeper cranks, not a swap-mutated
 * counter). Sibling fields at +8/+48 read within a bp (bid/ask around the mid).
 * The price is a WHOLE-coin rate (mintA->mintB); it is directly usable as a raw
 * rate only because this adapter gates decimalsA === decimalsB.
 */
const OFF_STATS_PRICE = 56;
/** Fixed-point scale of the stats-account price field (see OFF_STATS_PRICE). */
const PRICE_SCALE = 10_000_000_000n; // 1e10

/**
 * The stats account also carries the LAST-CRANK unix timestamp (u64 LE) at
 * offset 48 — when the keeper last refreshed the oracle price at
 * {@link OFF_STATS_PRICE}. This is the "sane price" discriminator: a market
 * whose keeper has stopped cranking holds a STALE @56 that no longer tracks the
 * real rate (measured: JLP-USDC last cranked 2025-10-09 reads 5.834 vs a real
 * ~3.62; PYTHIA/EITHER ~100 days stale read 6x/1000x off), and serving it would
 * OVER-PROMISE the appreciated side — the exact favourable-error hazard this
 * adapter exists to avoid. Across every AlphaQ market a freshness cut cleanly
 * separates good from bad: EVERY market cranked within the hour has @56 matching
 * the live routable rate to a few bps (zero false rejects), EVERY diverging
 * market is stale. So a non-stable market is served only when its oracle price
 * is fresh; otherwise it self-drops.
 */
const OFF_STATS_PRICE_TS = 48;
/**
 * Max age (seconds) of the stats oracle timestamp for a NON-stable market to be
 * served. 1 hour — data-validated (every fresh market is minutes old; every
 * stale one is 98+ DAYS, so any threshold in this vast gap separates them, and
 * the tight end is the safe, over-promise-averse choice). Stablecoin pairs use
 * the parity model and ignore this. NOTE: this is the PREPARE-time gate; the
 * recipe ladder's on-chain fragment must additionally check @48 against
 * block.timestamp LIVE at cook time, since a price fresh at prepare can go stale
 * before the swap lands (see the module doc's CONSUMER NOTE).
 */
const MAX_PRICE_AGE_SECONDS = 3600n;

/**
 * Curated set of mints this integration TRUSTS to be genuine ~$1 stablecoins
 * — see the module doc's "SCOPE GATE". High-confidence, well-known-brand
 * $1-pegged stablecoins only (USDC, USDT, and 6 others actually paired
 * against them in AlphaQ's live universe); tickers this integration could
 * NOT confirm are $1-pegged from the name alone (CASH, DUSD, USX, and every
 * tokenized-equity/prediction-market/meme ticker in AlphaQ's other 31
 * markets) are deliberately EXCLUDED, not merely unconfirmed — see
 * `fetchAlphaqPoolConfig`.
 */
const STABLE_MINTS: ReadonlySet<string> = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", // USD1 (World Liberty Financial)
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD (PayPal USD)
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", // USDG (Global Dollar / Paxos)
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", // USDS (Sky / MakerDAO)
  "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u", // FDUSD (First Digital USD)
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD", // JUPUSD
]);

/**
 * Every AlphaQ market discovered via a live `getProgramAccounts` sweep
 * (owner=ALPHAQ_PROGRAM_ID, split by dataSize 672/336, joined by the shared
 * 16-byte leading symbol string — the only join key that exists; see the
 * module doc). Captured 2026-07-31. `resolveAlphaqStatsAccount` below checks
 * this table FIRST and falls back to a runtime cache primed by
 * {@link primeAlphaqStatsAccounts} for anything discovered later — so a new
 * market lands the moment the table (or the runtime prime) knows it, never a
 * hard-coded ceiling.
 */
const ALPHAQ_STATS_ACCOUNTS: Readonly<Record<string, Address>> = Object.freeze({
  "ANDURI-USDC": address("5yGK2j7mWcyrf27FpjEExHQwgjTjEgXfMPZuMopFujr7"),
  "ANTHRO-USDC": address("7SPyhvsgHGkvpWgeYcYG9mf43MFizNW6EWY8mcqcrB2E"),
  "ASSFAC-SOL": address("HiJXGmoFH1AH1HWWLwxjtFffKUCzXPcHNQad7d6M86Fz"),
  "CASH-USDC": address("aXQtJ9cGr1zgLyrppKJ5BR5jv1RMjyYL5Wetd2KZNtB"),
  "CRCLX-USDC": address("3NLJ35oEQ9mY2etDMvG4vpu6Q4CAkFgdaH7aFWrLnYtB"),
  "DUMB-SOL": address("3u8ataMk7ZZzCRQSzU8Yd61rYxE2Jh8iaaRtU3TeQsLv"),
  "DUSD-USDC": address("BLHKPNbpvpADT17eJWL9Ewz9sANt3RhPsijhjPFtbLMd"),
  "DUSD-USDT": address("85aqCUSm4eMv5EbRErC5VD3wuSFb43H5KJuniyAYjE5P"),
  "EITHER-SOL": address("4oZAfPeTfXN8qt6kfRgZ4t8AK2zWxRc4Nvd4kRYaijGA"),
  "FDUSD-USDT": address("9dNuFzNwtUYezvDiCRPaGL4XvBoaxzYrCr4YYV4NvLYN"),
  "INF-SOL": address("FWXN9o4Tmq3TJrpJ3Q7JCgVAQtq3fBL2yAUSQ893q9bC"),
  "JITOSO-SOL": address("HZyb7Gv2pWTRYq8XuaeWBePQ8CDNhxigkNohZU2dLPEC"),
  "JLP-USDC": address("3ffdgFCa3KwCsSh6rzzW3ddArJentdo2k3d7vtHaHwtk"),
  "JUPSOL-SOL": address("CyNXfwYg6kUDh4ExsHMBpiYuDoxrNxcBgLWqseBMjq9y"),
  "JUPUSD-USDC": address("FnH8uVCgE8iGz4KQSEpQWdpLxzEENB2n2XHYUhUw13wc"),
  "JUPUSD-USDT": address("7BPrU6uG6uqmr4weyV7vkrez1mvuT6xgxFchYFxK6SPu"),
  "KALSHI-USDC": address("HqYrSFRcq7UKWQjM1Hx3wHmqeniLouCe1pKAuCHWGpzh"),
  "MSOL-SOL": address("CZfrCHhBb9zzhFyM5Weqg53oCBdxkYBPSU5k1wTR9hdu"),
  "MSTRX-USDC": address("JCicdoVWTFerE4wieNx6RviNrm24ZEzfCqzsXimEiT1v"),
  "OPENAI-USDC": address("CsZnDXbHjJUb5uGG2WxfD18K5jsht8ao5WPcd7CNUQiJ"),
  "ORE-SOL": address("AdF6BbUZNvrPKVhkvBDhwaJVQxYPpoHPRR4VPJkxhziY"),
  "PENGUI-SOL": address("Fby3ZnTJiy2Zkm6EwWSF2uMgzC3mkmm49L9XLS7sCAVh"),
  "POLYMA-USDC": address("2xDUVdLT156FeyTGv5ux8tTghzDga8XhRJ7VPSca5DcF"),
  "PYTHIA-USDT": address("8YoW85ZkjmpR79LGovxWs4AZR88fYGanP7pDDhtx64DU"),
  "PYUSD-USDC": address("9gXvza14Bp6kBDdd5rWowt7NssYy36eSNvV7MzpWzLF3"),
  "QQQX-USDC": address("FoPAa1uiyPjijVJZeFhozTwfDeCSQbTJq5KGZRuiqKJn"),
  "SOL-USDC": address("DGgbAS3oHCWNGxhyUv2uMRc1ZXDbkDFsNfD9HyTJdHyd"),
  "SOL-USDT": address("55aNhhR33vhgcLViZnht4XKiyid1zNYhDzrxHmKQf3iP"),
  "SPACEX-USDC": address("EScGNZtsiLhKmwwmEyTBiA9JmhMJLYcmYbqcTLLXM9hu"),
  "SPYX-USDC": address("4TFySy2kRUJZLKtV23xvewp3AfCw2hzqTfU1jvHHz7b7"),
  "SYRUPU-USDC": address("FGRoxhDzPmY3ggRZqZsBTn6aLcrAePmNwH5GXLE6cok5"),
  "TSLAX-USDC": address("93YDBumWPaz53GjdMXH4kb64Gyb5sWUqSgTj8dh1dm9b"),
  "USD1-USDC": address("H18xqLYd5uEenmiFKoXkgrTvyhnLgJMPT8sSvdZPpi3p"),
  "USD1-USDT": address("F1LYc9NCbRvoUfxJPCamp2g737LQ2PbH8mBd9uFja2qZ"),
  "USDG-USDC": address("BLtETTx81aLGdXVmqsaRBNFG6sraxK76CE55NPLW8ja4"),
  "USDS-USDC": address("HjRw8yeBVUCGHMUWZzF83U4x82KwsrVwaeh6CYxtGBsQ"),
  "USDT-USDC": address("445fd6ffBZqWYsryCgs6wcE8exaLkRsMrefAQ5UHvt8v"),
  "USX-USDC": address("4ViPChs1hjYCAdfVBwnEcFVLHn8hzbhbunrGwXsoHkEZ"),
  "WBTC-CBBTC": address("H6khGhf2eYUB4hBaqNf8H1CtK7PZnyN5hYrBjmtKAu27"),
  "XAUT0-USDT": address("GZC3sCQUFVACFFe9gVjXsmZppp2uvcHP4zz5aGrnNjQh"),
});

/** Runtime-primed overlay for markets discovered AFTER the table above was captured. */
const runtimeStatsBySymbol = new Map<string, Address>();

/** A stats account's size: the `dataSize` the prime asks for, and the only size it accepts. */
const STATS_ACCOUNT_SIZE = 336;
/** Base64 of exactly {@link STATS_ACCOUNT_SIZE} bytes (a multiple of 3, so no `=` padding). */
const STATS_ACCOUNT_BASE64 = /^[A-Za-z0-9+/]{448}$/;
/** The 16-byte symbol prefix as base64: 24 characters decode to 18 bytes, the first 16 read. */
const SYMBOL_PREFIX_BASE64_CHARS = 24;
/** A market symbol, `BASE-QUOTE` in upper-case ASCII letters and digits. */
const MARKET_SYMBOL = /^[A-Z0-9]+-[A-Z0-9]+$/;
/** At most this many runtime entries; the static table holds every market known at capture. */
const MAX_RUNTIME_STATS_ACCOUNTS = 1024;

/** Minimal getProgramAccounts transport for the stats-account join (data included, unlike the
 *  pubkey-only {@link GetProgramAccountsRpc} discovery.ts uses for candidate scans). */
export interface AlphaqStatsRpc {
  getProgramAccounts(
    program: Address,
    config: { encoding: "base64"; filters: { dataSize: bigint }[] },
  ): { send(): Promise<readonly { pubkey: Address; account: { data: [string, string] } }[]> };
}

let primePromise: Promise<void> | null = null;

/**
 * One-time (idempotent, memoized) live join for markets not yet in
 * {@link ALPHAQ_STATS_ACCOUNTS}. Safe to call repeatedly/concurrently — every
 * call after the first returns the SAME in-flight/completed promise. A failed
 * prime is not memoized: the next call tries again. A failure here never
 * costs the caller anything beyond "no new markets discovered this run" — the
 * static table still serves every market known at integration time.
 *
 * The RPC is the caller's, so its answer is held to a stats account's shape:
 * base64 of exactly {@link STATS_ACCOUNT_SIZE} bytes, of which only the
 * 16-byte symbol prefix is decoded; a symbol of the {@link MARKET_SYMBOL}
 * form; never a symbol the static table names (which stays authoritative);
 * and at most {@link MAX_RUNTIME_STATS_ACCOUNTS} entries. Anything else is
 * skipped.
 *
 * NOT auto-wired into `the consuming app SVM discovery module`'s gPA sweep (deliberately —
 * it would add one extra getProgramAccounts call to EVERY discovery sweep for
 * a table that is already complete for every market that exists today). A
 * caller with its own boot sequence (the api, a CLI, a future cron) should
 * invoke this once with a live `getProgramAccounts` transport to pick up any
 * AlphaQ market added after this file was captured.
 */
export function primeAlphaqStatsAccounts(rpc: AlphaqStatsRpc): Promise<void> {
  if (primePromise) return primePromise;
  const prime = (async () => {
    const accounts = await rpc
      .getProgramAccounts(ALPHAQ_PROGRAM_ID, {
        encoding: "base64",
        filters: [{ dataSize: BigInt(STATS_ACCOUNT_SIZE) }],
      })
      .send();
    for (const acc of accounts) {
      const [text, encoding] = acc.account.data;
      if (encoding !== "base64" || !STATS_ACCOUNT_BASE64.test(text)) continue;
      const symbol = strictSymbol(base64Bytes(text.slice(0, SYMBOL_PREFIX_BASE64_CHARS)));
      if (symbol === null || Object.hasOwn(ALPHAQ_STATS_ACCOUNTS, symbol)) continue;
      if (
        !runtimeStatsBySymbol.has(symbol) &&
        runtimeStatsBySymbol.size >= MAX_RUNTIME_STATS_ACCOUNTS
      ) {
        continue;
      }
      runtimeStatsBySymbol.set(symbol, acc.pubkey);
    }
  })();
  primePromise = prime;
  prime.catch(() => {
    if (primePromise === prime) primePromise = null;
  });
  return prime;
}

/**
 * The symbol of a stats account's prefix, or null unless it is a {@link MARKET_SYMBOL}: read up to
 * the first NUL within 16 bytes, refusing any byte outside printable ASCII (unlike
 * {@link decodeSymbol}, which masks the high bit).
 */
function strictSymbol(prefix: Uint8Array): string | null {
  let symbol = "";
  for (let i = 0; i < 16 && prefix[i] !== 0; i++) {
    if (prefix[i] < 0x20 || prefix[i] > 0x7e) return null;
    symbol += String.fromCharCode(prefix[i]);
  }
  return MARKET_SYMBOL.test(symbol) ? symbol : null;
}

/** Test-only: seed the runtime overlay without a real RPC (LiteSVM/jest fixtures). */
export function __setAlphaqStatsAccountsForTest(entries: Readonly<Record<string, Address>>): void {
  runtimeStatsBySymbol.clear();
  for (const [symbol, acct] of Object.entries(entries)) runtimeStatsBySymbol.set(symbol, acct);
}

/** Test-only: undo {@link __setAlphaqStatsAccountsForTest} / a completed prime. */
export function __resetAlphaqStatsAccountsForTest(): void {
  runtimeStatsBySymbol.clear();
  primePromise = null;
}

/** Test-only: a read-only view of the runtime overlay. */
export function __alphaqRuntimeStatsForTest(): ReadonlyMap<string, Address> {
  return runtimeStatsBySymbol;
}

function resolveAlphaqStatsAccount(symbol: string): Address | undefined {
  return ALPHAQ_STATS_ACCOUNTS[symbol] ?? runtimeStatsBySymbol.get(symbol);
}

function decodeSymbol(data: Uint8Array): string {
  let end = 0;
  while (end < 16 && data[end] !== 0) end++;
  // `Buffer#toString("ascii")`: each byte with its high bit cleared, read as one character.
  return String.fromCharCode(...Array.from(data.subarray(0, end), (byte) => byte & 0x7f));
}

function readPubkey(data: Uint8Array, offset: number): Address {
  return address(bs58EncodeUnchecked(data.slice(offset, offset + 32)));
}

// Minimal base58 (no external dep pulled in for a 32-byte encode — the same
// alphabet every other adapter's Address type ultimately round-trips through).
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58EncodeUnchecked(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let out = "";
  while (value > 0n) {
    const rem = value % 58n;
    value /= 58n;
    out = BASE58_ALPHABET[Number(rem)] + out;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out || "1";
}

export interface AlphaqPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'AtoB' (default, mintA -> mintB) | 'BtoA'. */
  direction: "AtoB" | "BtoA";
  symbol: string;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  decimalsA: number;
  decimalsB: number;
  /** The market's 336-byte hot-state companion account — WRITABLE in the swap CPI. */
  statsAccount: Address;
  /**
   * AlphaQ's live oracle price of mintA in mintB, scaled by {@link PRICE_SCALE}
   * (1e10), read from the stats account at {@link OFF_STATS_PRICE}. `1e10`
   * (parity) for a genuine stablecoin pair; the real spot (e.g. ~1.178e10 for
   * syrupUSDC) for a non-stable one. A non-stable pool is priced at this spot;
   * a stablecoin pool keeps the byte-identical parity model and ignores it.
   */
  priceRaw: bigint;
  /**
   * The unix timestamp (seconds) the oracle price was last cranked, read from
   * the stats account at {@link OFF_STATS_PRICE_TS}. The freshness anchor: a
   * non-stable market is only served when this is recent (see
   * {@link MAX_PRICE_AGE_SECONDS}); carried so the recipe fragment can re-check
   * it LIVE at cook time. 0 for a never-cranked market.
   */
  priceTimestamp: bigint;
  /**
   * True iff BOTH mints are in the curated {@link STABLE_MINTS} set. Stable
   * pools keep the original parity quote (byte/lamport-identical, regression-
   * guarded); non-stable pools use the oracle-priced quote. See
   * `fetchAlphaqPoolConfig`.
   */
  isStablePair: boolean;
}

/**
 * Decode a market (672-byte) account. Throws (caller self-drops, per
 * `resolveSvmPoolSpec`'s existing try/catch) on: a size mismatch; a blank
 * symbol; either mint outside the curated `STABLE_MINTS` set (the "SCOPE
 * GATE" — this ladder's quote model is only safe for a genuine stablecoin
 * pair); mismatched decimals (the raw-unit depth comparison's precondition);
 * or a stats account this integration has neither the static table nor a
 * live prime for. A genuinely unknown/out-of-scope/future market is
 * dropped, never crashed on.
 */
export async function fetchAlphaqPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
  now?: bigint,
): Promise<AlphaqPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`alphaq market ${pool} not found`);
  if (data.length !== MARKET_SIZE) {
    throw new Error(
      `alphaq market ${pool} has unexpected size ${data.length} (want ${MARKET_SIZE})`,
    );
  }
  const symbol = decodeSymbol(data);
  if (symbol.length === 0) throw new Error(`alphaq market ${pool} has a blank symbol`);
  const mintA = readPubkey(data, OFF_MINT_A);
  const mintB = readPubkey(data, OFF_MINT_B);
  const isStablePair =
    STABLE_MINTS.has(mintA as unknown as string) && STABLE_MINTS.has(mintB as unknown as string);
  const decimalsA = data[OFF_DECIMALS_A];
  const decimalsB = data[OFF_DECIMALS_B];
  if (decimalsA !== decimalsB) {
    // Raw-unit reserve comparison (this model's `D = min(vaultA, vaultB)`) is
    // only meaningful when one raw unit of each side is the same fraction of a
    // whole coin — see the module doc's "THE ACTUAL MODEL". This precondition
    // holds for BOTH the stable parity model and the oracle-priced non-stable
    // model (the stats price is a WHOLE-coin rate, usable raw only at equal
    // decimals), so it stays a hard gate for every market.
    throw new Error(
      `alphaq market ${pool} ("${symbol}") has mismatched decimals (${decimalsA} vs ${decimalsB}) — not priceable by this model`,
    );
  }
  const statsAccount = resolveAlphaqStatsAccount(symbol);
  if (statsAccount === undefined) {
    throw new Error(
      `alphaq market ${pool} ("${symbol}") has no known stats account — not in the captured table and ` +
        "not primed via primeAlphaqStatsAccounts()",
    );
  }
  // Read the live oracle spot from the stats account (see OFF_STATS_PRICE). A
  // STABLE pair keeps the parity model and does not need it, but a NON-stable
  // pair is only priceable WITH it — so a non-stable market self-drops (throws,
  // caught by resolveSvmPoolSpec) when the stats price is missing or non-sane,
  // instead of falling back to the parity assumption that mis-priced syrupUSDC
  // (~1.178) as 1.0 and forced a catastrophic route. This LIFTS the former
  // hard STABLE_MINTS-only gate: any equal-decimal market with a sane oracle
  // price now serves.
  const statsData = await load(statsAccount);
  const hasStats = statsData !== null && statsData.length >= OFF_STATS_PRICE + 8;
  const priceRaw = hasStats ? readUint64LE(statsData, OFF_STATS_PRICE) : PRICE_SCALE; // parity default (stable pairs ignore it)
  const priceTimestamp =
    statsData !== null && statsData.length >= OFF_STATS_PRICE_TS + 8
      ? readUint64LE(statsData, OFF_STATS_PRICE_TS)
      : 0n;
  // "Sane oracle price" gate for a NON-stable pair: it is only priceable via
  // the oracle, so it self-drops (throws, caught by resolveSvmPoolSpec) rather
  // than serve a garbage-but-parseable or STALE @56 — never falling back to the
  // parity assumption that mispriced syrupUSDC. A stablecoin pair uses parity
  // and ignores all of this. Three ways a non-stable oracle is not sane:
  if (!isStablePair) {
    if (!hasStats || priceRaw <= 0n) {
      throw new Error(
        `alphaq market ${pool} ("${symbol}") is a non-stable pair with no readable oracle price ` +
          `(stats@${OFF_STATS_PRICE}) — self-dropping rather than assuming parity`,
      );
    }
    if (priceTimestamp <= 0n) {
      throw new Error(
        `alphaq market ${pool} ("${symbol}") has a never-cranked oracle (stats@${OFF_STATS_PRICE_TS} == 0) — self-dropping`,
      );
    }
    const nowSec = now ?? BigInt(Math.floor(Date.now() / 1000));
    const age = nowSec - priceTimestamp;
    if (age > MAX_PRICE_AGE_SECONDS) {
      throw new Error(
        `alphaq market ${pool} ("${symbol}") oracle price is STALE (last cranked ${age}s ago, ` +
          `max ${MAX_PRICE_AGE_SECONDS}s) — self-dropping rather than serving a stale/over-promising price`,
      );
    }
  }
  return {
    venue: SLUG,
    pool,
    direction: "AtoB",
    symbol,
    mintA,
    mintB,
    vaultA: readPubkey(data, OFF_VAULT_A),
    vaultB: readPubkey(data, OFF_VAULT_B),
    decimalsA,
    decimalsB,
    statsAccount,
    priceRaw,
    priceTimestamp,
    isStablePair,
  };
}

/** Little-endian u64 read (no external dep; mirrors the venue math helper). */
function readUint64LE(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]);
  return v;
}

/**
 * The symmetric constant-product model — see the module doc's "THE ACTUAL
 * MODEL". `D = min(rawA, rawB)` (raw units; safe because
 * `fetchAlphaqPoolConfig` gates decimalsA === decimalsB) is the conservative
 * shared depth, pinning the spot price at parity (minus the haircut) rather
 * than at the market's possibly-skewed raw reserve RATIO — the fix for the
 * favourable-mispricing bug this file's own test caught (see the module
 * doc's "REJECTED FIRST ATTEMPT").
 */
function cpQuote(x: bigint, rawA: bigint, rawB: bigint): bigint {
  if (x <= 0n || rawA <= 0n || rawB <= 0n) return 0n;
  const depth = rawA < rawB ? rawA : rawB;
  const fee = (x * HAIRCUT_BPS + (HAIRCUT_DENOM - 1n)) / HAIRCUT_DENOM; // ceil, matches the helper below
  const net = x - fee;
  if (net <= 0n) return 0n;
  return (net * depth) / (depth + net); // floor
}

/**
 * The venue quote. For a STABLE pair this is the ORIGINAL parity model,
 * byte/lamport-identical to before (spot pinned at 1:1). For a NON-stable pair
 * it pins the spot at AlphaQ's live oracle price (`priceRaw`/{@link PRICE_SCALE},
 * mintA->mintB) instead: the symmetric constant-product base
 * (`net*D/(D+net)`, D = min raw vault — the same conservative, depth-
 * understating shape) is scaled by the spot, `AtoB` multiplying by the price
 * and `BtoA` dividing by it. Because the base is direction-symmetric and the
 * spot scaling is applied last, the curve passes through the real spot at
 * x->0 (fixing the parity mispricing that made syrupUSDC quote ~1.0 instead of
 * ~0.849 per USDC) while still understating AlphaQ's true (deeper) depth — the
 * safe direction, since the on-chain CPI executes AlphaQ's own pricing and the
 * recipe's post-swap outAta-delta check bounds the fill.
 *
 * `rawA`/`rawB` are the live raw vault balances (mintA/mintB); `direction`
 * is which way the trade goes ('AtoB' spends mintA). `x` is the gross input in
 * the input side's raw units.
 */
function alphaqQuote(
  x: bigint,
  rawA: bigint,
  rawB: bigint,
  priceRaw: bigint,
  isStablePair: boolean,
  direction: "AtoB" | "BtoA",
): bigint {
  const base = cpQuote(x, rawA, rawB);
  if (isStablePair) return base; // unchanged parity path — regression-guarded
  if (priceRaw <= 0n) return 0n;
  return direction === "AtoB" ? (base * priceRaw) / PRICE_SCALE : (base * PRICE_SCALE) / priceRaw;
}

export {
  cpQuote as __alphaqCpQuoteForTest,
  alphaqQuote as __alphaqQuoteForTest,
  decodeSymbol as __alphaqDecodeSymbolForTest,
};
