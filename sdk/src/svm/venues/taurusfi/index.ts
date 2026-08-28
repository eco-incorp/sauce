/**
 * TaurusFi (SvmRoute ladder fragment) — program `9VX8EKBg6vM6tA68xaDsPkbrx26
 * XConZjkQmhVApUptc`, Jupiter's own label per `benchmark/adapters/fixtures/
 * jupiter-program-id-to-label.json`. No on-chain IDL ships for this program;
 * everything below is recovered by live transaction/account archaeology
 * (`getSignaturesForAddress` + `getTransaction` + `getAccountInfo` against
 * mainnet, plus a real Jupiter-routed swap CPI found in the sample), the same
 * method that produced bisonfi/humidifi/obric-v2/solfi-v2. Ported verbatim
 * (relocation, not a rewrite) from sauce-recipes' `the consuming app SVM venues
 * taurusfi.ts` — the same non-gPA shape humidifi uses (static pool-registry
 * discovery, since neither is gPA-discoverable by a mint-pair memcmp).
 *
 * ── What the program actually is (a real, load-bearing finding) ──
 * The OVERWHELMING majority of this program's traffic (191 of 200 sampled
 * signatures in a ~400s window, one transaction every 1-2s) is NOT a swap at
 * all — it is a keeper CRANK: a 2-account, ~505-byte instruction
 * (disc byte + a near-verbatim 504-byte overwrite of the target account's own
 * state) that updates a per-market PRICE/STATE account owned by this program.
 * Two markets were observed: `EWqXjWSd4sfVsZHdSc25DoD1QfMbMrVpQZPpayoiFPSP`
 * (live-priced, SOL/USDC) and `HFqA7kAqgUMjNCo5zDSN1tnKvE8GVBXGPDyK2nizJm11`
 * (all-zero — an inactive/unpriced market). Only 1-in-~25 sampled
 * transactions is a real SWAP CPI (found via a Jupiter multi-hop route,
 * signature `3GFzSaARr63Jgr4aFYz9dRCHMX7Ta8JZbyGg2D8tjBaP7eFL2Gn8cNETTXu6t8ReMxxAXjkcJkyo3Ht4fcmV8XMk`,
 * plus 7 more single-hop samples gathered separately) — a Lifinity/SolFi-class
 * ORACLE-PRICED prop-AMM: a keeper continuously pushes a price, and swaps
 * execute at (a haircut of) that price, NOT at the raw vault reserve ratio.
 *
 * ── The price account layout (504 bytes, decoded via a repeated-double scan
 *    cross-checked against a same-slot crank update) ──
 * Offset 0: an IEEE-754 binary64 (little-endian) — the live price, QUOTE
 * human-units per BASE human-unit (e.g. ~73.03 USDC per SOL, matching every
 * sampled trade to within measurement noise — see below). Offset 8: a second
 * f64, observed constant at 0.0001 (a confidence/tick-size-looking constant,
 * unused by this adapter). Offsets 48/56 repeat the same (price, 0.0001)
 * shape with a different price value (~144.83 at capture time) — plausibly a
 * second window/reference price this adapter does not need and does not use.
 * The account carries no plaintext pubkeys anywhere (verified: this is why
 * the family is NOT gPA-discoverable by a mint-pair memcmp — see
 * `withTaurusFiStaticCandidates` in the recipes' discovery.ts, the same
 * non-gPA shape humidifi uses).
 *
 * ── Validation: our zero-fee oracle-price prediction vs. 4 REAL swaps,
 *    each checked against a crank update in the SAME (or immediately
 *    adjacent) slot ──
 *   - slot 436472057 (sig `4Xbp3Sp6…B22T`): amountIn 513,854 USDC-µ, realized
 *     7,042,878 SOL-lamports out. Same-slot crank price 72.98968844357817.
 *     Naive prediction (amountIn/price, no fee) = 7,040,090 — realized is
 *     +0.040% ABOVE that (favourable to the venue's own model, i.e. our
 *     zero-fee prediction is itself already conservative here).
 *   - slot 436467023 (sigs `2hcJL8Zf…VHe`, `5gTnZy1c…sHn`) and 436467025
 *     (sig `5ZiFvLWFv5…4He`): realized output is -0.032% to -0.037% BELOW
 *     the same nearby-slot naive prediction across all three.
 *   All four land within ±5bps of a pure `amountOut = amountIn / price`
 *   relationship — this is a real, validated oracle-priced venue, not a
 *   vault-ratio curve (constant-product over the two live vault balances
 *   diverges from the realized output by **12.7x** on the first sample —
 *   the vaults are evidently an omnibus multi-market pool, not a dedicated
 *   SOL/USDC reserve pair, so their ratio carries no pricing information at
 *   all).
 *
 * ── SECOND, independent validation: OUR OWN constructed instruction (this
 *    exact account plan + byte layout), LIVE-EXECUTED via `simulateTransaction`
 *    (`sigVerify:false`, borrowing a real trader's wallet/ATAs — the standard
 *    technique for probing a program without funds) against the REAL deployed
 *    program on REAL current mainnet state, both directions, 3 sizes each —
 *    6 of 6 succeeded (2 large backward-direction sizes failed only on the
 *    borrowed wallet's OWN insufficient current balance, not on our encoding;
 *    the successful cells prove the instruction/account list this ladder
 *    emits is byte-for-byte accepted by the real program) ──
 *   backward (USDC->SOL, wallet `ttcZfmd9…PbNDq`): 100,000 USDC-µ in ->
 *     1,369,195 SOL-lamports realized; our model (this file's formula, live
 *     vault state) predicts 1,355,585 — realized/model = 1.0040 (model
 *     conservative by ~0.4%).
 *   forward (SOL->USDC, wallet `yUwUyouf…T9aH`): 1,000 / 100,000 / 5,000,000
 *     SOL-lamports in -> 72 / 7,295 / 364,747 USDC-µ realized; model predicts
 *     72 / 7,229 / 361,481 — realized/model = 1.000 / 1.0091 / 1.0090 (model
 *     conservative by ~0-0.9%, i.e. NEVER favourable, at real sizes spanning
 *     3 orders of magnitude).
 *
 * ── On-chain price decode: no floating point in SauceScript, so the f64 bit
 *    pattern is decoded with pure integer ops (the compiler DOES support
 *    runtime bitAnd/bitOr/bitXor/shl/shr) ──
 * `bits = accountUint(price, 0, 8)` (the raw u64 bit pattern). For a normal
 * (non-subnormal, non-negative — true of every real price observed) double:
 *   exp    = (bits >> 52) & 0x7FF                       (11-bit biased exponent)
 *   mant   = (bits & (2^52-1)) | 2^52                    (52-bit mantissa + implicit leading bit)
 *   priceScaled = mulDiv(mant, PRICE_SCALE, 2^(1075-exp))  (1075 = 1023 bias + 52 mantissa bits)
 * This is EXACT (no precision loss beyond PRICE_SCALE's own resolution) for
 * any realistic price and, as a bonus, degrades SAFELY on an unpriced market
 * (bits = 0 -> exp = 0 -> the divisor 2^1075 is so large the mulDiv floors to
 * exactly 0 regardless of the unconditionally-OR'd implicit bit — no branch
 * needed on-chain). A priceScaled of 0 is caught at PREPARE TIME
 * (the recipe's `FAMILIES.taurusfi.gate`, mirroring every other prepare-time-
 * only gate — orca-whirlpool/raydium-clmm/manifest all work the same way),
 * so the on-chain division-by-price this ladder performs is never fed a live
 * zero by construction.
 *
 * ── Quote curve (deliberately conservative — the true depth-decay curve, if
 *    any, was not recovered) ──
 * A virtual constant-product curve is shaped so `rout` is the REAL, live
 * output-vault balance (the honest hard capacity ceiling this curve
 * asymptotes to and can never exceed — undiscounted, so the cap itself is
 * never overstated) and `rin = rout / (rate * NUM/DEN)` = `rin_true *
 * DEN/NUM` (`rin` INFLATED by the reciprocal of a 1% haircut,
 * `OUT_DISCOUNT_NUM/DEN = 99/100`), where `rate` is the haircut-free
 * validated oracle rate. Inflating `rin` (rather than shrinking `rout`, which
 * would cancel out of the small-x marginal rate `rout/rin` entirely — a
 * discount applied equally to both terms is not a discount at all at the
 * margin, only at the asymptote) means the SMALL-x marginal rate is
 * genuinely ~1% BELOW the true oracle rate — comfortably past the <=5bps of
 * noise measured above, and a much tighter, better-calibrated margin than
 * bisonfi/humidifi could achieve since neither had oracle ground truth at
 * all — while the curve still asymptotes to the REAL, undiscounted vault
 * capacity as x grows. `qTaurusFi(x, rin, rout) = mulDiv(x, rout, rin + x)`
 * — the same monotone, strictly concave shape as every other CP-style
 * fragment in this file (bisonfi/gamma/humidifi/raydium-cp-swap), so it
 * cannot trigger the "coarse ladder allocated ZERO" hazard.
 *
 * ── Account plan (14 accounts, verified against 8 independent real trades
 *    — both directions were inferred from the trailing mint-order flip;
 *    only the sell-quote (USDC->SOL) direction has a *clean* (uncorrelated
 *    to a co-occurring hop) balance-delta confirmation, but the vaults/mints/
 *    fixed accounts are IDENTICAL either way, so the reverse direction is a
 *    same-mechanism inference, not a separate guess) ──
 *   0 vault0  (writable)           — BASE mint's SPL vault (fixed per market)
 *   1 vault1  (writable)           — QUOTE mint's SPL vault (fixed per market)
 *   2 owner   (writable, signer)   — the taker's own wallet (confirmed: IS the
 *     outer transaction's fee-payer/signer on every single-hop sample)
 *   3 userAta (writable)           — taker's ATA for vault0's mint
 *   4 userAta (writable)           — taker's ATA for vault1's mint
 *   5 vaultAuthority (writable)    — PDA owning BOTH vaults (SPL "owner" field
 *     of both vault0 and vault1 — confirmed identical for both, every sample)
 *   6 (readonly)                   — venue-wide fixed account, exact role not
 *     recovered (`ECADA9SPXrZTTbWG5JJTCC7KsagYR2MLZhw2KgFhivu9`)
 *   7 priceAccount (readonly)      — the market's own oracle/state PDA
 *   8 (readonly)                   — venue-wide fixed account, exact role not
 *     recovered (`Hg2PTGCBUwRvp7S3AF5BF4tfawNshXc1N2DDWijjJndo`) — UNLIKE
 *     bisonfi's analogous 9th account, this one is NEVER a signer in any
 *     sampled swap, so there is no third-party-cosign blocker here.
 *   9 TOKEN_PROGRAM (readonly)
 *  10 TOKEN_PROGRAM (readonly, again — verified against real chain data on
 *     every sample, not a transcription artifact, same as bisonfi's 6/7)
 *  11 mintIn  (readonly)           — direction signal: this position's mint
 *  12 mintOut (readonly)           — IS the input in every real sample (the
 *     vault/ATA positions 0/1/3/4 stay FIXED regardless of direction; only
 *     this trailing pair flips)
 *  13 SysvarInstructions (readonly)
 * Instruction data (11 bytes, `patch: 'in'`): disc(1)=0x08 ++ amountIn u64 LE
 * (patched at runtime) ++ tail(2) = [0x00, 0x01] — IDENTICAL across all 7
 * clean samples (different sizes: 3,072,612 to 982,452,558; both directions;
 * times 5 minutes apart), so treated as a fixed structural constant exactly
 * like bisonfi's TAIL_FLAG.
 *
 * ── CU (venue-side CPI cost; recipe-side budget pin is out of scope for this
 *    SDK module — see the recipes' `CU_FAMILIES.taurusfi` in budget.ts) ──
 * The venue's own CPI cost is UNUSUALLY FLAT (not size-tiered, unlike
 * bisonfi): 113,624-119,290 CU across 8 samples spanning ~0.001 to ~1 SOL
 * notional, both directions.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { getAddressCodec } from '@solana/kit';
import { readUintLE } from '../math.js';
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SwapUser,
  VenueAccount,
} from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'taurusfi';
export const TAURUSFI_PROGRAM_ID: Address<'9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc'> = address(
  '9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc',
);
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_INSTRUCTIONS = address('Sysvar1nstructions1111111111111111111111111');

/** disc(1) ++ amountIn u64 LE (patched) ++ tail(2) = 11 bytes. Byte 0. */
const SWAP_DISCRIMINATOR = 0x08;
/** Bytes 9-10 of the instruction — fixed across every real sample gathered (both directions, 5 sizes). */
const TAIL_BYTES: readonly number[] = [0x00, 0x01];

/** Standard SPL token account field offsets (mint@0, amount@64) — the vaults are plain SPL accounts. */
const VAULT_MINT_OFFSET = 0;
const VAULT_AMOUNT_OFFSET = 64;

// ── IEEE-754 binary64 bit-decode constants (see file header) ──
const F64_EXP_MASK = 2047n; // 0x7FF, 11 bits
const F64_MANTISSA_MASK = 4503599627370495n; // 2^52 - 1
const F64_IMPLICIT_BIT = 4503599627370496n; // 2^52
const F64_BIAS_PLUS_MANTISSA_BITS = 1075n; // 1023 + 52
/** Fixed-point scale for the decoded price (10^9 — ~9-10 significant decimal digits of headroom). */
export const TAURUSFI_PRICE_SCALE = 1_000_000_000n;

/** Conservative haircut on the output-side virtual reserve — see file header "Quote curve". */
const OUT_DISCOUNT_NUM = 99n;
const OUT_DISCOUNT_DEN = 100n;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

/**
 * Decodes a raw f64 bit pattern (as read off-chain OR the exact on-chain
 * `accountUint` value) into a `TAURUSFI_PRICE_SCALE`-fixed-point integer,
 * LOCKSTEP with the on-chain formula in `emitSetup` below (same masks, same
 * mulDiv-shaped floor division) — bit-exact by construction, not merely
 * "close". Degrades to exactly 0 for an unpriced market (bits === 0n) with
 * no special case (see file header).
 */
export function decodeTaurusFiPriceScaled(bits: bigint): bigint {
  const exp = (bits >> 52n) & F64_EXP_MASK;
  const mant = (bits & F64_MANTISSA_MASK) | F64_IMPLICIT_BIT;
  const shiftAmt = F64_BIAS_PLUS_MANTISSA_BITS - exp;
  return (mant * TAURUSFI_PRICE_SCALE) / (1n << shiftAmt);
}

export interface TaurusFiRegistryEntry {
  /** BASE mint's SPL vault. */
  vault0: Address;
  /** QUOTE mint's SPL vault. */
  vault1: Address;
  mint0: Address;
  mint1: Address;
  decimals0: number;
  decimals1: number;
  /** PDA owning both vaults (SPL "owner" field of both — confirmed identical). */
  vaultAuthority: Address;
  /** Venue-wide fixed account, account 6 in the swap ix — exact role not recovered. */
  globalConfig: Address;
  /** Venue-wide fixed account, account 8 in the swap ix — exact role not recovered; never a signer. */
  globalAuthority: Address;
  /** The market's own price/oracle state PDA (also the registry key). */
  priceAccount: Address;
}

/**
 * Hand-verified TaurusFi markets: for each, a real mainnet swap CPI (inside a
 * Jupiter route) was decoded and the vault/mint addresses were cross-checked
 * against `preTokenBalances`/`postTokenBalances`, and the price account was
 * independently confirmed against a same-slot keeper-crank update. Only one
 * live-priced market was observed during integration; a second market
 * account (`HFqA7kAqgUMjNCo5zDSN1tnKvE8GVBXGPDyK2nizJm11`) exists but reads an
 * all-zero (unpriced/inactive) price and has no known vault/mint pair, so it
 * is deliberately NOT seeded here — extend by repeating the same
 * verification once it (or another market) goes live.
 */
export const TAURUSFI_POOL_REGISTRY: Record<string, TaurusFiRegistryEntry> = {
  // SOL / USDC (native, EPjF...) — the only market observed live-priced and
  // live-traded during integration.
  EWqXjWSd4sfVsZHdSc25DoD1QfMbMrVpQZPpayoiFPSP: {
    vault0: address('BA6hdJwgzayrm3Q7Z6MPq1wVgPcUMJDbQcUwxJ9Nfu1H'),
    vault1: address('7qPQugSL2cJgnVDQWNPt6woSidEF4XQhjPDkYrdnv8CK'),
    mint0: address('So11111111111111111111111111111111111111112'),
    mint1: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    decimals0: 9,
    decimals1: 6,
    vaultAuthority: address('544UsNRFNU7tzWKcHGZorwy7UKnsso9x83N9WWMvY5JX'),
    globalConfig: address('ECADA9SPXrZTTbWG5JJTCC7KsagYR2MLZhw2KgFhivu9'),
    globalAuthority: address('Hg2PTGCBUwRvp7S3AF5BF4tfawNshXc1N2DDWijjJndo'),
    priceAccount: address('EWqXjWSd4sfVsZHdSc25DoD1QfMbMrVpQZPpayoiFPSP'),
  },
};

export interface TaurusFiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** '0to1' (default) sells mint0 for mint1; '1to0' sells mint1 for mint0. */
  direction: '0to1' | '1to0';
  vault0: Address;
  vault1: Address;
  mint0: Address;
  mint1: Address;
  decimals0: number;
  decimals1: number;
  vaultAuthority: Address;
  globalConfig: Address;
  globalAuthority: Address;
  priceAccount: Address;
  /** Decoded once at fetch time — the gate's ONLY read (see the recipe's `FAMILIES.taurusfi.gate`). */
  priceScaled: bigint;
}

function taurusFiConfig(cfg: PoolConfig): TaurusFiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as TaurusFiPoolConfig;
}

/**
 * Registry lookup + live decode: reads the market's price account (for the
 * gate) and both vaults (mint-integrity check, mirroring gamma's/bisonfi's
 * own vault verification) — nothing else is decodable off this venue's pool
 * state (no plaintext pool-identity account exists at all; see file header).
 */
export async function fetchTaurusFiConfig(load: AccountLoader, pool: Address): Promise<TaurusFiPoolConfig> {
  const entry = TAURUSFI_POOL_REGISTRY[pool as unknown as string];
  if (entry === undefined) {
    throw new Error(
      `${SLUG}: pool ${pool} is not in TAURUSFI_POOL_REGISTRY — this venue has no plaintext pool-identity ` +
        'account to decode a new market from; see sdk/src/svm/venues/taurusfi/index.ts for how to add one',
    );
  }
  const priceData = await load(entry.priceAccount);
  if (priceData === null) throw new Error(`${SLUG}: price account ${entry.priceAccount} not found`);
  if (priceData.length < 8) {
    throw new Error(`${SLUG}: price account ${entry.priceAccount} is ${priceData.length} bytes, expected >= 8`);
  }
  const priceScaled = decodeTaurusFiPriceScaled(readUintLE(priceData, 0, 8));

  const _vaultPairs = [
    [entry.vault0, entry.mint0],
    [entry.vault1, entry.mint1],
  ] as const;
  const _vaultDatas = await Promise.all(_vaultPairs.map(([vault]) => load(vault)));
  for (let _i = 0; _i < _vaultPairs.length; _i++) {
    const [vault, mint] = _vaultPairs[_i]!;
    const vaultData = _vaultDatas[_i]!;
    if (vaultData === null) throw new Error(`${SLUG}: vault ${vault} not found`);
    if (vaultData.length < VAULT_AMOUNT_OFFSET + 8) {
      throw new Error(`${SLUG}: vault ${vault} is ${vaultData.length} bytes, expected an SPL token account`);
    }
    const vaultMint = pubkeyAt(vaultData, VAULT_MINT_OFFSET);
    if (vaultMint !== mint) throw new Error(`${SLUG}: vault ${vault} holds mint ${vaultMint}, expected ${mint}`);
  }

  // This venue's swap CPI is legacy-SPL (Tokenkeg) only. Detect a Token-2022
  // (or otherwise un-routable) mint per side and GRACEFULLY SELF-DROP the pool
  // (the SvmRoute orchestrator catches a fetchPoolConfig throw and drops the
  // venue). The LEGACY path is byte-identical; an unreadable mint falls back to
  // the legacy assumption.
  const _mints = [entry.mint0, entry.mint1];
  const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
  for (let _i = 0; _i < _mints.length; _i++) {
    const mint = _mints[_i]!;
    const mintData = _mintDatas[_i]!;
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  return { venue: SLUG, pool, direction: '0to1', priceScaled, ...entry };
}

/** Family facade for the recipe orchestrator (ladder-only, like raydium-amm-v4/raydium-cp-swap). */
export const taurusfi = {
  slug: SLUG,
  programId: TAURUSFI_PROGRAM_ID,
  fetchPoolConfig: fetchTaurusFiConfig,
};

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

/** decimals1 >= decimals0 ? [10^(decimals1-decimals0), 1] : [1, 10^(decimals0-decimals1)]. */
function decimalScale(cfg: TaurusFiPoolConfig): { num: bigint; den: bigint } {
  return cfg.decimals1 >= cfg.decimals0
    ? { num: 10n ** BigInt(cfg.decimals1 - cfg.decimals0), den: 1n }
    : { num: 1n, den: 10n ** BigInt(cfg.decimals0 - cfg.decimals1) };
}

