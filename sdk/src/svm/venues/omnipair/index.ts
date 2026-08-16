/**
 * Omnipair — an oracle-less spot + margin money-market protocol on Solana
 * (program `omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE`; on-chain Anchor IDL
 * confirmed at 13,682 bytes, source cross-checked against the public
 * `omnipair/omnipair-rs` repo — `programs/omnipair/src/instructions/spot/swap.rs`
 * + `state/pair.rs` + `utils/gamm_math.rs`). Each `Pair` is a constant-product
 * AMM (`reserve0 * reserve1 = k`) whose reserves are LENDING-AWARE:
 * `reserve{0,1}` are VIRTUAL (curve) reserves that include whatever has been
 * borrowed out, while `cash_reserve{0,1}` are the actual liquid vault balance
 * (`reserve = cash + debt`). A swap prices off the virtual reserves but can
 * only ever DELIVER out of the cash reserve — `swap.rs`'s
 * `require_gte!(pair.cash_reserveX, amount_out)` — so this ladder quotes from
 * `(reserve0, reserve1)` and separately CAPS gross input so the predicted
 * output never exceeds the live `cash_reserve` of the output side (see
 * CAPACITY below).
 *
 * ACCOUNT LAYOUT (Borsh-packed, no padding; ALL 98 live mainnet pairs sampled
 * at integration time cross-checked byte-for-byte against the IDL's `Pair`
 * struct): disc(8) sha256('account:Pair')[0..8] = 55 48 31 b0 b6 e4 8d 52,
 * token0@8/token1@40/lp_mint@72/rate_model@104 (pubkeys), swap_fee_bps@136
 * (u16), half_life@138 (u64), THEN `fixed_cf_bps: Option<u16>` — Borsh
 * serializes this VARIABLE-LENGTH (1-byte tag, +2 more only if Some), so
 * every field after it sits at one of exactly two offsets depending on the
 * tag byte at 146: reserve0 starts at 147 (tag 0, None) or 149 (tag 1, Some).
 * This is an IMMUTABLE per-pair constant (no instruction in the IDL ever
 * flips `fixed_cf_bps` post-`initialize`), so it is baked as a compile-time
 * literal (`reserveBase`) and folded into the shape key — never re-derived
 * live. From `reserveBase`: reserve0/reserve1/cash_reserve0/cash_reserve1
 * (u64 x4, contiguous), then EMAs/rates/debt/etc (unused by this ladder),
 * token0_decimals/token1_decimals at `reserveBase+160/161`, ending with
 * `reduce_only` at `reserveBase+200` — total account size 350 bytes either
 * way (2 trailing unused bytes in the None case; `#[derive(InitSpace)]`
 * allocates the worst case up front), matching all 98 sampled mainnet pairs.
 *
 * QUOTE MATH (transcribed from `swap.rs`'s `handle_swap` + `gamm_math.rs`'s
 * `CPCurve::calculate_amount_out`, VALIDATED — see below):
 *   swap_fee = ceil(amountIn * swapFeeBps / 10000)
 *   netIn    = amountIn - swap_fee
 *   amountOut = floor(netIn * reserveOut / (reserveIn + netIn))
 * `netIn` has the closed-form IDENTITY `floor(x*(D-feeBps)/D) === x -
 * ceil(x*feeBps/D)` for D=10000 (proved by construction: ceil(a) = -floor(-a),
 * so x - ceil(xb/D) = x + floor(-xb/D) = floor(x - xb/D) = floor(x(D-b)/D) for
 * integer x) — used directly rather than emulating ceil, which the DSL has no
 * primitive for. The `futarchy_authority.revenue_share.swap_bps` split changes
 * only how the swap_fee is BOOKED between LPs/protocol (`amount_in_with_lp_fee`
 * feeds `new_reserve_in`), never `amount_out` — so this ladder does not read
 * futarchy_authority's content at all, only attaches its (fixed, PDA-derived)
 * address to the swap CPI, which requires it structurally.
 *
 * CAPACITY (closed form, the SAME "saturate past capacity, don't collapse"
 * class this codebase's other capacity-aware ladders — orca-whirlpool/
 * raydium-clmm/meteora-dlmm/manifest/meteora-damm-v2/obric-v2 — already fixed
 * for their own venues): amountOut(x) = reserveOut - floor(kq/(reserveIn +
 * netIn(x))) with kq = reserveIn*reserveOut (the SAME hyperbola shape as
 * obric-v2's oracle-anchored curve, just with kq the plain reserve product
 * instead of an oracle-derived one). amountOut(x) <= cashOut is trivial
 * (uncapped, U64_MAX sentinel) whenever `reserveOut <= cashOut`. Otherwise,
 * with `target = reserveOut - cashOut > 0`: solve for the max `netIn` with
 * `floor(kq/(reserveIn+netIn)) >= target`, i.e. `netInMax = floor(kq/target) -
 * reserveIn` (clamped to >= 0 — the obric-v2 derivation verbatim, since the
 * two curves share the exact `cOut - kq/(cIn+x)` shape). Converting the netIn
 * cap back to a GROSS input cap needs one more inversion because netIn(x) is
 * itself a floor: `floor(x*m/D) <= T  <=>  x <= floor(((T+1)*D-1)/m)` with
 * `m = D-feeBps` (verified against hand-checked boundary cases — x=xCap
 * satisfies the bound, x=xCap+1 does not, for several (T, feeBps) pairs).
 * A merge-decomposition ladder folds this into its rung capacities; the
 * ladders themselves now live in the consuming recipes package, so only the
 * decode/derivation above is this module's concern.
 *
 * REDUCE_ONLY: `Pair.reduce_only` ("blocks borrowing and adding liquidity for
 * this pair", per its own doc comment) and `FutarchyAuthority.global_reduce_only`
 * are NOT checked anywhere in `swap.rs`/`Swap::validate`/`Swap::handle_swap` —
 * confirmed by reading the instruction source directly. Swaps are UNAFFECTED
 * by either flag; this ladder does not gate on them (an earlier integration
 * plan assumed otherwise — that assumption is corrected here against the
 * actual source, not the doc comment's English description).
 *
 * INTEREST ACCRUAL (disclosed, measured, minOut-backstopped — NOT modeled):
 * every swap first calls `Pair::update()`, which — IF any slot has elapsed
 * since `last_update` (a SLOT number, not unix time) — accrues interest onto
 * `total_debt{0,1}` via a Taylor-series exponential rate-model integral and
 * adds the LP-owed portion straight onto `reserve{0,1}` (see `pair.rs`'s
 * `update()`). This ladder reads `reserve0/reserve1` RAW (no accrual replay:
 * the rate-model integral needs a fixed-point Taylor exp with no cheap
 * closed form, and the shift is exactly the same *class* of drift every other
 * time-dependent venue in this codebase (locked-profit decay, amp ramps)
 * already carries, backstopped by `minOut`, not a per-venue quote guarantee).
 * MEASURED size, via `view_pair_data`'s `SwapQuote` getter (which itself DOES
 * replay the accrual, so its `simulateTransaction` answer is true
 * post-accrual ground truth) against real mainnet pair
 * `Cp2nGCWWfqkUmPR3pPKoR376Fti8wuYRFrSWJZq1a9SA` (token0
 * `METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta` / token1 USDC): at a 23-slot
 * gap (~9.2s) the raw-reserve quote and SwapQuote's post-accrual answer agree
 * BIT-EXACT at the smallest tested size and within single-digit-to-tens of
 * raw units (relative error ~1.2e-9) at 5,000/30,000 USDC and 1,000/13,000
 * token0 — at a 679-slot gap (~4.5 min) the same comparison widens to
 * ~3.5e-8 relative, consistent with linear-in-time accrual. Both residuals
 * are many orders of magnitude below the `minOut` floor any real caller sets.
 *
 * Gates (fetchPoolConfig, all recoverable/self-drop classes): wrong size/
 * discriminator; either mint not a classic 82-byte Tokenkeg mint (Token-2022
 * transfer-fee/extension mints are out of scope, same restriction as
 * defituna/raydium-cp-swap's classic-SPL-only swap path); an uninitialized
 * pair (`reserve0 === 0 || reserve1 === 0`, mirroring `Pair::is_initialized`);
 * a degenerate `swap_fee_bps >= 10000`.
 */
import { address, getAddressCodec, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'omnipair';
export const OMNIPAIR_PROGRAM_ID = address('omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const PAIR_ACCOUNT_SIZE = 350;
/** sha256('account:Pair')[0..8]. */
export const PAIR_DISCRIMINATOR = [0x55, 0x48, 0x31, 0xb0, 0xb6, 0xe4, 0x8d, 0x52];
const OFF_TOKEN0 = 8;
const OFF_TOKEN1 = 40;
const OFF_RATE_MODEL = 104;
const OFF_SWAP_FEE_BPS = 136;
/** The fixed_cf_bps Option<u16> discriminant byte — decides reserveBase (147 vs 149). */
const OFF_OPTION_TAG = 146;

const FEE_D = 10_000n;
const U64_MAX = (1n << 64n) - 1n;

export interface OmnipairPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'aToB' (default, token0 in / token1 out) | 'bToA'. */
  direction: 'aToB' | 'bToA';
  token0Mint: Address;
  token1Mint: Address;
  rateModel: Address;
  futarchyAuthority: Address;
  eventAuthority: Address;
  reserveVault0: Address;
  reserveVault1: Address;
  /** Immutable per-pair Borsh option-tag offset for reserve0 (147 tag=None, 149 tag=Some) — part of the shape key. */
  reserveBase: 147 | 149;
  token0Decimals: number;
  token1Decimals: number;
}

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}
function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}
async function derivePda(seeds: Uint8Array[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: OMNIPAIR_PROGRAM_ID, seeds });
  return pda;
}

/** Fetch + decode one Pair, deriving the fixed accounts the swap CPI needs. Read-only against the loader. */
export async function fetchOmnipairPoolConfig(load: AccountLoader, pool: Address): Promise<OmnipairPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pair account ${pool} not found`);
  if (data.length !== PAIR_ACCOUNT_SIZE) {
    throw new Error(`${SLUG}: pair ${pool} has ${data.length} bytes, expected ${PAIR_ACCOUNT_SIZE}`);
  }
  if (!hasDiscriminator(data, PAIR_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pair ${pool} has a foreign discriminator (not a Pair account)`);
  }

  const codec = getAddressCodec();
  const token0Mint = codec.decode(data.subarray(OFF_TOKEN0, OFF_TOKEN0 + 32)) as Address;
  const token1Mint = codec.decode(data.subarray(OFF_TOKEN1, OFF_TOKEN1 + 32)) as Address;
  const rateModel = codec.decode(data.subarray(OFF_RATE_MODEL, OFF_RATE_MODEL + 32)) as Address;
  const swapFeeBps = readUintLE(data, OFF_SWAP_FEE_BPS, 2);
  if (swapFeeBps >= FEE_D) throw new Error(`${SLUG}: pair ${pool} has a degenerate swap_fee_bps ${swapFeeBps}`);

  const tag = data[OFF_OPTION_TAG];
  const reserveBase: 147 | 149 = tag === 0 ? 147 : 149;
  const reserve0 = readUintLE(data, reserveBase, 8);
  const reserve1 = readUintLE(data, reserveBase + 8, 8);
  if (reserve0 === 0n || reserve1 === 0n) throw new Error(`${SLUG}: pair ${pool} is not initialized (zero reserve)`);

  // The swap path is Tokenkeg-only (Token-2022 transfer-fee/extension mints are
  // out of scope), so detect a Token-2022 or un-routable mint via the shared
  // data-shape resolver and SELF-DROP the pool (the thrown error is the
  // graceful-drop signal the SvmRoute orchestrator catches). The LEGACY path is
  // byte-identical: a classic 82-byte mint classifies Tokenkeg with no extensions.
  for (const mint of [token0Mint, token1Mint]) {
    const mintData = await load(mint);
    if (mintData === null) continue; // an unreadable mint falls back to the legacy assumption
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const [futarchyAuthority, eventAuthority, reserveVault0, reserveVault1] = await Promise.all([
    derivePda([new TextEncoder().encode('futarchy_authority')]),
    derivePda([new TextEncoder().encode('__event_authority')]),
    derivePda([new TextEncoder().encode('reserve_vault'), getAddressEncoded(pool), getAddressEncoded(token0Mint)]),
    derivePda([new TextEncoder().encode('reserve_vault'), getAddressEncoded(pool), getAddressEncoded(token1Mint)]),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: 'aToB',
    token0Mint,
    token1Mint,
    rateModel,
    futarchyAuthority,
    eventAuthority,
    reserveVault0,
    reserveVault1,
    reserveBase,
    token0Decimals: data[reserveBase + 160]!,
    token1Decimals: data[reserveBase + 161]!,
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like orca-whirlpool/raydium-clmm/defituna). */
export const omnipair = {
  slug: SLUG,
  programId: OMNIPAIR_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchOmnipairPoolConfig,
};

/**
 * Closed-form capacity: the largest gross input `x` for which
 * `amountOut(x) <= cashOut` holds (see the module header derivation).
 * `U64_MAX` when `reserveOut <= cashOut` (never binds).
 */
export function omnipairCapacity(reserveIn: bigint, reserveOut: bigint, cashOut: bigint, feeBps: bigint): bigint {
  if (reserveOut <= cashOut) return U64_MAX;
  const kq = reserveIn * reserveOut;
  const target = reserveOut - cashOut;
  let netInMax = kq / target - reserveIn;
  if (netInMax < 0n) netInMax = 0n;
  // Invert netIn(x) = floor(x*m/D) <= netInMax back to a gross-input cap:
  // floor(x*m/D) <= T  <=>  x*m <= (T+1)*D - 1  <=>  x <= floor(((T+1)*D-1)/m).
  const m = FEE_D - feeBps;
  return ((netInMax + 1n) * FEE_D - 1n) / m;
}

/** The COLD (venue-exact) quote for gross input x, saturating at the capacity clamp. */
export function omnipairQuote(x: bigint, ri: bigint, ro: bigint, fb: bigint, icap: bigint): bigint {
  const cx = x > icap ? icap : x;
  if (cx <= 0n) return 0n;
  const ni = (cx * (FEE_D - fb)) / FEE_D;
  return (ni * ro) / (ri + ni);
}

