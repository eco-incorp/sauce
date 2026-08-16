/**
 * Sanctum Infinity (SvmRoute venue, `sanctum-infinity`) — the multi-LST
 * liquidity pool run by the S-controller program ("INF"), open source at
 * github.com/igneous-labs/inf-1.5 (the successor to the archived
 * github.com/igneous-labs/S; this pool's on-chain `PoolState.version == 2`,
 * confirmed 2026-07-31 against the live `AYhux5g...` account — every layout
 * and instruction fact below is cited against inf-1.5, not the archived repo).
 *
 * SHAPE: unlike every other wired SVM family, Infinity is NOT a per-pair
 * pool account — ONE pool (three fixed PDAs: `poolState`, `lstStateList`,
 * plus the pricing program's `slab`) holds up to ~124 LSTs simultaneously,
 * and any two of them can be swapped against each other. This breaks the
 * `fetchPoolConfig(load, pool)`-embeds-both-mints assumption every 2-asset
 * family relies on, so this venue does NOT use the generic
 * `SVM_FAMILY_FILTERS` getProgramAccounts sweep (there is no per-pair
 * account to memcmp-scan for) — see the discovery-wiring note below and in
 * `the consuming app SVM discovery module`'s `withSanctumInfinity`.
 *
 * QUOTE (ground-truthed against inf-1.5's actual on-chain math, not the
 * archived repo's older `s_controller` IDL — the two agree on every formula
 * below, just PoolState grew from 176 to 240 bytes and the fee model moved
 * from bps to nanos):
 *
 *   1. `inSolValue = inCalc.lstToSol(amountIn)` — the SOL value of the
 *      input LST, per its own SOL-value calculator (`core/src/quote/swap/
 *      exact_in.rs::quote_exact_in`, `.start()` == `.get_min()`).
 *   2. `outSolValue = FlatSlab.priceExactIn(inSolValue)` — the FlatSlab
 *      pricing program (deployed at `s1b6NRXj6ygNu1QMKXh2H9LUR2aPApAAm1UQ2DjdhNV`,
 *      confirmed == the live pool's `pricingProgram` field) applies a FLAT,
 *      size-independent proportional fee: `floor(inSolValue * (1e9 -
 *      inFeeNanos - outFeeNanos) / 1e9)` (`pricing/flatslab/core/src/
 *      pricing.rs::out_ratio`/`pp_price_exact_in`) — `inFeeNanos`/
 *      `outFeeNanos` come from ONE shared global `slab` account (PDA seed
 *      `b"slab"`, `4T9YzXnmQFMyYi2nrxyXjhtUANavmCkxGCsU3GKaNjwT`), a
 *      mint-sorted packed array of `{mint, inpFeeNanos: i32, outFeeNanos:
 *      i32}` (40 bytes/entry) after a 32-byte admin header
 *      (`pricing/flatslab/core/src/typedefs.rs`, IDL confirms "NO account
 *      discriminator/header").
 *   3. `amountOut = outCalc.solToLst(outSolValue)` — the reverse of step 1
 *      on the output leg, capped at the pool's LIVE `outPoolReserves` SPL
 *      balance (`core/src/quote/swap/exact_in.rs` — a straight capacity
 *      check, `NotEnoughLiquidity` if exceeded; this adapter SATURATES
 *      instead of reverting rather than collapsing to zero).
 *
 * Because the fee is a FLAT proportional rate (no curve), the quote is
 * PIECEWISE LINEAR (linear up to the output-reserve cap, flat after) —
 * trivially monotone and concave, and cheaper to model than any curved
 * family: no ladder-rung path-dependence exists (rung count is a codegen
 * convenience, not an accuracy requirement).
 *
 * CALCULATORS SUPPORTED (of `WHITELISTED_SVC_PROGS`, the 6 whitelisted
 * SOL-value-calculator programs, `controller/core/src/keys.rs`): `spl`,
 * `sanctumSpl`, `sanctumSplMulti` (identical math and account shape, only
 * 4 constants differ — `sol-val-calc/{spl,generic}/core/src/keys.rs`) and
 * `wsol` (trivial 1:1 identity, `sol-val-calc/wsol/core/src/calc.rs`). A
 * live read of `lstStateList` on 2026-07-31 found 124 active LSTs: 22 spl +
 * 83 sanctumSpl + 16 sanctumSplMulti + 1 wsol = 122 covered (98.4%); the
 * other 2 (mSOL via `marinade`, stSOL via `lido`) are OUT OF SCOPE for this
 * pass — each is a single specific mint with its own bespoke calculator
 * account layout, a reasonable follow-up, not a reason to withhold the
 * other 122. A pool whose `sol_value_calculator` is neither of the 4
 * supported programs self-drops that ONE mint (never the whole venue) —
 * see `resolveInfinityLeg`.
 *
 * PER-LST STAKE-POOL ADDRESS: the calculator CPI needs the specific
 * stake-pool account for a given LST (holding `total_lamports`/
 * `pool_token_supply`), which is NOT derivable from `LstState` or the mint
 * alone (`SplLstSolValCalc::from_pool` in igneous-labs/S takes it as an
 * external input) — resolved via the vendored, cross-validated
 * `./sanctum-infinity-registry.ts` (110 of the 121 non-wsol legs; see that
 * file's header for the validation methodology and the 11-mint staleness
 * gap). A mint absent from the registry self-drops (this file's
 * `resolveInfinityLeg`), never throwing the whole pair out if the OTHER
 * leg resolves fine against a DIFFERENT candidate pair.
 *
 * SWAP CPI: `swapExactInV2` (discriminator 23 — NOT the legacy `swapExactIn`
 * discriminator 1, which still carries a now-vestigial
 * `protocolFeeAccumulator` account; V2 drops it, since PoolStateV2 tracks
 * protocol fees as lamports internally rather than a per-LST token
 * accumulator). Account order confirmed against `controller/program/src/
 * instructions/swap/v2/common.rs::swap_v2_split_accs` +
 * `sol-val-calc/generic/program/src/lib.rs`'s account-suffix verification:
 * `[signer, inMint, outMint, inAcc, outAcc, inTokenProgram, outTokenProgram,
 * poolState, lstStateList, inPoolReserves, outPoolReserves,
 *   inCalcProgram, ...inCalcSuf(state, poolState_i, poolProg, poolProgData),
 *   outCalcProgram, ...outCalcSuf(same shape),
 *   pricingProgram, slab]`
 * The suf order is `[state, pool_state, pool_prog, pool_progdata]` — this is
 * the ONE place a wrong guess is easy to make (the OLD igneous-labs/S repo's
 * analogous struct orders `pool_state` LAST, not second; inf-1.5's
 * `sol-val-calc/generic/core/src/instructions/interface/mod.rs` `IxSufAccs`
 * struct is the ground truth, confirmed by a real mainnet
 * `simulateTransaction` — the wrong order fails on-chain inside the
 * calculator program with `WrongPoolProgram` (custom error 1003), NOT inside
 * the S-controller, so a naive account-count check alone would not catch it).
 * — 11 fixed + (1+4 or 1+0 for wsol) + (1+4 or 1+0) + (1+1). Args: disc(1) ++
 * inCalcAccs(u8) ++ outCalcAccs(u8) ++ inLstIndex(u32 LE) ++ outLstIndex(u32
 * LE) ++ limit(u64 LE, =1 — the recipe's outAta delta check is the real
 * floor, matching every other adapter's convention) ++ amount(u64 LE,
 * runtime-patched).
 *
 * PACKET-SIZE RISK (flagged in the venue brief): a two-non-wsol-leg swap
 * attaches 23 accounts (11 + 5 + 5 + 2) for THIS ONE VENUE alone — several
 * times a typical 2-asset venue's footprint. `estimatePacket`
 * (`the consuming app SVM solver entry`) already sizes the whole compiled program against
 * the 1,232-byte no-ALT ceiling across every attached venue; a route or
 * multi-slot shape that would overflow it is rejected/falls back the same
 * way an oversized route already does elsewhere (see `route.ts`'s ALT-fit
 * note) — this adapter adds no new packet-budget mechanism, it just
 * consumes more of the existing one per slot than most families.
 */
import { createHash } from 'node:crypto';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig, VenueAccount } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
import {
  SANCTUM_INFINITY_REGISTRY,
  WSOL_MINT,
  type SanctumInfinityCalcFamily,
} from './registry.js';

const SLUG = 'sanctum-infinity';

/** The S-controller ("INF") program — `SVM_VENUE_PROGRAM_IDS['sanctum-infinity']`. */
export const SANCTUM_INFINITY_PROGRAM_ID = address('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');

// ── fixed PDAs (all derived offline; cross-checked 2026-07-31 against the
// literal snapshot test in `controller/core/src/pda.rs` — see the module
// doc for the derivation trail) ───────────────────────────────────────────
export const POOL_STATE_ID = address('AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW');
export const LST_STATE_LIST_ID = address('Gb7m4daakbVbrFLR33FKMDVMHAprRZ66CSYt4bpFwUgS');
/** The FlatSlab pricing program (== the live pool's `pricingProgram`, verified 2026-07-31). */
export const FLAT_SLAB_PROGRAM_ID = address('s1b6NRXj6ygNu1QMKXh2H9LUR2aPApAAm1UQ2DjdhNV');
/** FlatSlab's one global fee-schedule account (PDA seed `b"slab"`). */
export const SLAB_ID = address('4T9YzXnmQFMyYi2nrxyXjhtUANavmCkxGCsU3GKaNjwT');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Per-calculator-family constants (`sol-val-calc/{spl,generic}/core/src/keys.rs`). */
interface CalcConstants {
  calcProgram: Address;
  poolProgram: Address;
  poolProgramData: Address;
  /** The generic calculator's own `CalculatorState` PDA (seed `b"state"` under `calcProgram`). */
  calcState: Address;
}
const CALC_CONSTANTS: Record<SanctumInfinityCalcFamily, CalcConstants> = {
  spl: {
    calcProgram: address('sp1V4h2gWorkGhVcazBc22Hfo2f5sd7jcjT4EDPrWFF'),
    poolProgram: address('SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'),
    poolProgramData: address('EmiU8AQkB2sswTxVB6aCmsAJftoowZGGDXuytm6X65R3'),
    calcState: address('7orJ4kDhn1Ewp54j29tBzUWDFGhyimhYi7sxybZcphHd'),
  },
  sanctumSpl: {
    calcProgram: address('sspUE1vrh7xRoXxGsg7vR1zde2WdGtJRbyK9uRumBDy'),
    poolProgram: address('SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY'),
    poolProgramData: address('Cn5fegqLh8Fmvffisr4Wk3LmuaUgMMzTFfEuidpZFsvV'),
    calcState: address('84C2M1NcmqFiP37qHKzuz8ydyyjCrzNqY77GhvHtCpyf'),
  },
  sanctumSplMulti: {
    calcProgram: address('ssmbu3KZxgonUtjEMCKspZzxvUQCxAFnyh1rcHUeEDo'),
    poolProgram: address('SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn'),
    poolProgramData: address('HxBTMuB7cFBPVWVJjTi9iBF8MPd7mfY1QnrrWfLAySFd'),
    calcState: address('Ehcuy2BzuY9BscqcH2K43tDKqoi6xQHxChtVjzrMfvU8'),
  },
};
/** The wSOL calculator: no state/pool_prog/pool_progdata — pure identity math, zero suf accounts. */
export const WSOL_CALC_PROGRAM_ID = address('wsoGmxQLSvwWpuaidCApxN5kEowLe2HLQLJhCQnj4bE');

// ── LstState (80 bytes; identical layout in both the archived and inf-1.5 repos) ──
const LST_STATE_SIZE = 80;
const OFF_IS_INPUT_DISABLED = 0;
const OFF_MINT = 16;
const OFF_SOL_VALUE_CALCULATOR = 48;

// ── SPL(-family) stake-pool account (Borsh; only the fields this adapter
// reads — see the module doc's field-order citation). Fixed offsets hold up
// through pool_token_supply because nothing variable-length precedes them;
// stake_withdrawal_fee sits after several Option<T> fields, so it is
// resolved by an explicit off-chain walk (`readStakeWithdrawalFee`), NOT a
// fixed offset. ──
const SPL_ACCOUNT_TYPE_STAKE_POOL = 1;
/** Reads a Borsh `Fee { denominator: u64, numerator: u64 }` at `off`. */
function readFee(data: Uint8Array, off: number): { numerator: bigint; denominator: bigint } {
  const denominator = readUintLE(data, off, 8);
  const numerator = readUintLE(data, off + 8, 8);
  return { numerator, denominator };
}

/**
 * Off-chain-only Borsh walk from `last_update_epoch` (fixed offset 274)
 * through the variable-length prefix (`lockup`, `epoch_fee`,
 * `next_epoch_fee: Option<Fee>`, two `Option<Pubkey>`s, `stake_deposit_fee`)
 * to `stake_withdrawal_fee` — see the module doc for the full field list.
 * `stake_withdrawal_fee` (the withdrawal fee levied on `lst_to_sol`/
 * `sol_to_lst`) changes rarely (an admin-set config value, not a
 * per-trade-drifting reserve), so it is a natural compile-time PARAM for a
 * consumer's fragment, while `total_lamports`/`pool_token_supply` must stay
 * LIVE on-chain reads.
 */
function readStakeWithdrawalFee(data: Uint8Array): { numerator: bigint; denominator: bigint } {
  let off = 274 + 8 + 48 + 16; // last_update_epoch(8) + lockup(48) + epoch_fee(16)
  const nextEpochFeeTag = data[off];
  off += 1;
  if (nextEpochFeeTag !== 0) off += 16;
  const preferredDepositTag = data[off];
  off += 1;
  if (preferredDepositTag !== 0) off += 32;
  const preferredWithdrawTag = data[off];
  off += 1;
  if (preferredWithdrawTag !== 0) off += 32;
  off += 16; // stake_deposit_fee: Fee
  return readFee(data, off);
}

export interface SanctumInfinityLegConfig {
  mint: Address;
  isWsol: boolean;
  /** Absent iff isWsol. */
  stakePool?: Address;
  poolReserves: Address;
  /** Index of this LST within `lst_state_list` at fetch time — baked into the swap ix. */
  lstIndex: number;
  isInputDisabled: boolean;
  /** Withdrawal fee ratio (0/1 for wsol). */
  feeNum: bigint;
  feeDenom: bigint;
  /** FlatSlab per-mint fee-schedule entry (i32 nanos; can be negative — a rebate). */
  inpFeeNanos: bigint;
  outFeeNanos: bigint;
}

export interface SanctumInfinityPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  in: SanctumInfinityLegConfig;
  out: SanctumInfinityLegConfig;
}

// ── directed-pair discovery key (see the consuming app SVM discovery module's
// `withSanctumInfinity`) ──────────────────────────────────────────────────
//
// Infinity has no per-pair on-chain account, so there is no real address to
// hand `fetchPoolConfig` the way every other family does. Instead, the
// discovery wrapper mints a DETERMINISTIC, PURELY LOCAL synthetic "pool"
// key per (inMint, outMint) request (sha256, so it round-trips through the
// `Address` brand as a plain 32-byte value — it is NEVER read on-chain) and
// registers the pair in this module-level map. `fetchPoolConfig` looks the
// pair back up here; a key that was never minted (a stale/foreign
// candidate) throws, which `resolveSvmPoolSpec` swallows into a harmless
// drop, exactly like a wrong-owner spoof on any other family.
const PAIR_BY_KEY = new Map<string, { inMint: Address; outMint: Address }>();

/** Mint (or re-mint, idempotently) the synthetic discovery key for a directed pair. */
export function sanctumInfinityPoolKey(inMint: Address, outMint: Address): Address {
  const digest = createHash('sha256').update(`${inMint}\0${outMint}`).digest();
  const key = address(base58Encode(digest));
  PAIR_BY_KEY.set(key as string, { inMint, outMint });
  return key;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n /= 58n;
    s = B58_ALPHABET[r] + s;
  }
  let pad = 0;
  for (const b of bytes) {
    if (b === 0) pad++;
    else break;
  }
  return B58_ALPHABET[0].repeat(pad) + s;
}

const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ADDRESS_ENCODER = getAddressEncoder();

/**
 * ATA derivation — the standard scheme every SPL token account uses
 * (verified 2026-07-31: the derived wSOL pool-reserves ATA's live `amount`
 * matches `lst_state_list`'s `sol_value` for that leg exactly — see the
 * module doc's account-order citation trail).
 */
async function findAta(wallet: Address, mint: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [ADDRESS_ENCODER.encode(wallet), ADDRESS_ENCODER.encode(TOKEN_PROGRAM), ADDRESS_ENCODER.encode(mint)],
  });
  return pda;
}

/**
 * Resolve one directed leg: look up the mint's calculator family (wSOL is a
 * hardcoded special case; everything else goes through the vendored
 * registry), find its `LstState` entry (mint, index, is_input_disabled,
 * sol_value_calculator — cross-checked against the registry's claimed
 * family), derive its pool-reserves ATA, and — for a non-wsol leg — read its
 * stake-pool account for the withdrawal fee. Throws (self-drops just this
 * ONE leg/pair) on: an unmapped mint, a family mismatch between the
 * registry and live `LstState`, a missing/wrong-size stake-pool account, or
 * an account read failure.
 */
async function resolveInfinityLeg(
  load: AccountLoader,
  mint: Address,
  lstStateList: Uint8Array,
): Promise<SanctumInfinityLegConfig> {
  const count = lstStateList.length / LST_STATE_SIZE;
  let lstIndex = -1;
  for (let i = 0; i < count; i++) {
    const off = i * LST_STATE_SIZE;
    const entryMint = readAddress(lstStateList, off + OFF_MINT);
    if (entryMint === mint) {
      lstIndex = i;
      break;
    }
  }
  if (lstIndex < 0) throw new Error(`${SLUG}: mint ${mint} is not in the live lst_state_list`);
  const entryOff = lstIndex * LST_STATE_SIZE;
  const isInputDisabled = lstStateList[entryOff + OFF_IS_INPUT_DISABLED] !== 0;
  // The pool-reserves ATA is re-derived via findAta (the standard scheme), not reconstructed
  // from LstState's cached bump — one fewer coupling to the exact bump-storage convention.
  const solValueCalculator = readAddress(lstStateList, entryOff + OFF_SOL_VALUE_CALCULATOR);

  const poolReserves = await findAta(POOL_STATE_ID, mint);

  if (mint === WSOL_MINT) {
    if (solValueCalculator !== WSOL_CALC_PROGRAM_ID) {
      throw new Error(`${SLUG}: wSOL LstState.sol_value_calculator mismatch (got ${solValueCalculator})`);
    }
    return {
      mint,
      isWsol: true,
      poolReserves,
      lstIndex,
      isInputDisabled,
      feeNum: 0n,
      feeDenom: 1n,
      inpFeeNanos: 0n,
      outFeeNanos: 0n,
    };
  }

  const reg = SANCTUM_INFINITY_REGISTRY.get(mint as unknown as string);
  if (reg === undefined) throw new Error(`${SLUG}: mint ${mint} has no vendored stake-pool registry entry`);
  const constants = CALC_CONSTANTS[reg.family];
  if (constants.calcProgram !== solValueCalculator) {
    throw new Error(
      `${SLUG}: mint ${mint} registry family '${reg.family}' disagrees with live sol_value_calculator ${solValueCalculator}`,
    );
  }

  const stakePoolData = await load(reg.stakePool);
  if (stakePoolData === null) throw new Error(`${SLUG}: stake pool ${reg.stakePool} does not exist`);
  if (stakePoolData[0] !== SPL_ACCOUNT_TYPE_STAKE_POOL) {
    throw new Error(`${SLUG}: stake pool ${reg.stakePool} has unexpected account_type ${stakePoolData[0]}`);
  }
  const { numerator: feeNum, denominator: feeDenom } = readStakeWithdrawalFee(stakePoolData);

  return {
    mint,
    isWsol: false,
    stakePool: reg.stakePool,
    poolReserves,
    lstIndex,
    isInputDisabled,
    feeNum,
    feeDenom: feeDenom === 0n ? 1n : feeDenom, // Fee{0,0} is the well-formed "no fee" encoding
    inpFeeNanos: 0n,
    outFeeNanos: 0n,
  };
}

function readAddress(data: Uint8Array, off: number): Address {
  return address(base58Encode(data.subarray(off, off + 32)));
}

/** Reads FlatSlab's `slab` account (32-byte admin header + mint-sorted 40-byte entries) for one mint. */
function readSlabFees(slab: Uint8Array, mint: Address): { inpFeeNanos: bigint; outFeeNanos: bigint } {
  const count = (slab.length - 32) / 40;
  for (let i = 0; i < count; i++) {
    const off = 32 + i * 40;
    if (readAddress(slab, off) === mint) {
      return {
        inpFeeNanos: BigInt(new DataView(slab.buffer, slab.byteOffset + off + 32, 4).getInt32(0, true)),
        outFeeNanos: BigInt(new DataView(slab.buffer, slab.byteOffset + off + 36, 4).getInt32(0, true)),
      };
    }
  }
  throw new Error(`${SLUG}: mint ${mint} has no FlatSlab fee-schedule entry`);
}

function infinityConfig(cfg: PoolConfig): SanctumInfinityPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as SanctumInfinityPoolConfig;
}

export const sanctumInfinity = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: SANCTUM_INFINITY_PROGRAM_ID,

  /**
   * `pool` is the synthetic per-directed-pair key from
   * `sanctumInfinityPoolKey` (see this file's discovery-key doc) — NEVER an
   * on-chain address. Reads `lst_state_list` + `slab` once, resolves both
   * legs (self-dropping the whole pair on ANY unsupported/missing leg —
   * a per-pair gate, since a pair genuinely needs both legs to be
   * servable), and gates on `pool_state.{is_disabled,is_rebalancing}` and
   * the INPUT leg's `is_input_disabled` (the on-chain check only inspects
   * the src side — see `verify_swap_v2`).
   */
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<SanctumInfinityPoolConfig> {
    const pair = PAIR_BY_KEY.get(pool as unknown as string);
    if (pair === undefined) throw new Error(`${SLUG}: unknown discovery key ${pool} (not minted this process)`);
    if (pair.inMint === pair.outMint) throw new Error(`${SLUG}: in/out mint are identical`);

    // The swap CPI is legacy-SPL (Tokenkeg) only for now, so SELF-DROP the pair
    // if either mint is Token-2022 (or carries an un-routable extension) — the
    // thrown error is the graceful-drop signal (SvmRoute drops the venue on a
    // fetchPoolConfig throw). An unreadable mint falls back to the legacy
    // assumption, keeping the byte-identical legacy path.
    for (const mint of [pair.inMint, pair.outMint]) {
      const mintData = await load(mint);
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(`${SLUG}: dropping pair — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(`${SLUG}: dropping pair — mint ${mint} is un-routable: ${blocking.join('; ')}`);
      }
    }

    const [poolStateData, lstStateList, slab] = await Promise.all([
      load(POOL_STATE_ID),
      load(LST_STATE_LIST_ID),
      load(SLAB_ID),
    ]);
    if (poolStateData === null) throw new Error(`${SLUG}: pool_state ${POOL_STATE_ID} does not exist`);
    if (poolStateData[13] !== 0) throw new Error(`${SLUG}: pool is disabled`);
    if (poolStateData[14] !== 0) throw new Error(`${SLUG}: pool is rebalancing`);
    if (lstStateList === null) throw new Error(`${SLUG}: lst_state_list does not exist`);
    if (slab === null) throw new Error(`${SLUG}: slab does not exist`);

    const [inLeg, outLeg] = await Promise.all([
      resolveInfinityLeg(load, pair.inMint, lstStateList),
      resolveInfinityLeg(load, pair.outMint, lstStateList),
    ]);
    if (inLeg.isInputDisabled) throw new Error(`${SLUG}: input LST ${pair.inMint} has input disabled`);

    const inFees = readSlabFees(slab, pair.inMint);
    const outFees = readSlabFees(slab, pair.outMint);
    inLeg.inpFeeNanos = inFees.inpFeeNanos;
    outLeg.outFeeNanos = outFees.outFeeNanos;
    const feeNanosSum = inFees.inpFeeNanos + outFees.outFeeNanos;
    if (feeNanosSum < 0n) throw new Error(`${SLUG}: ${pair.inMint}->${pair.outMint} is net-negative-fee (disallowed)`);
    if (feeNanosSum > 1_000_000_000n) throw new Error(`${SLUG}: ${pair.inMint}->${pair.outMint} fee exceeds 100%`);

    return { venue: SLUG, pool, in: inLeg, out: outLeg };
  },

  quoteAccounts(base: PoolConfig): VenueAccount[] {
    const cfg = infinityConfig(base);
    const accs: VenueAccount[] = [
      { ref: `${cfg.pool}:poolState`, address: POOL_STATE_ID },
      { ref: `${cfg.pool}:inPoolReserves`, address: cfg.in.poolReserves },
      { ref: `${cfg.pool}:outPoolReserves`, address: cfg.out.poolReserves },
    ];
    if (cfg.in.stakePool !== undefined) accs.push({ ref: `${cfg.pool}:inStakePool`, address: cfg.in.stakePool });
    if (cfg.out.stakePool !== undefined) accs.push({ ref: `${cfg.pool}:outStakePool`, address: cfg.out.stakePool });
    return accs;
  },
};

// ── ladder ────────────────────────────────────────────────────────────────

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

/** Test/tooling seam: clear the discovery-key registry between fixtures. */
export function __resetSanctumInfinityKeysForTest(): void {
  PAIR_BY_KEY.clear();
}

/** Test/tooling seam: look up a previously-minted discovery key (mirrors what `fetchPoolConfig` does). */
export function sanctumInfinityLookupPair(pool: Address): { inMint: Address; outMint: Address } | undefined {
  return PAIR_BY_KEY.get(pool as unknown as string);
}
