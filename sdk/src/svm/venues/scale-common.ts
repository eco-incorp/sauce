/**
 * Shared plumbing for the Scale AMM (`scale_amm`) and Scale VMM (`scale_vmm`) venue
 * adapters — sibling Anchor programs that share byte-identical Pool/PairState fee +
 * curve semantics (verified empirically against BOTH programs' `quote_buy`/`quote_sell`
 * on-chain simulation, see below), differing only in account layout and the VMM->AMM
 * graduation plumbing (scale-vmm.ts).
 *
 * QUOTE MATH — derived empirically (no public source), cross-checked against live
 * mainnet `quote_buy`/`quote_sell` simulation on BOTH programs at 9 total (size, pool)
 * combinations spanning three pools (feeCount 0 and 1) and amounts from 777 to
 * 999_999_999_999 raw units, wei-exact on every cell:
 *
 *   vA (virtual reserve A) = token_a_reserves + shift   (the ONLY virtual side — `shift`
 *     is a one-time constant baked at pool creation, e.g. pump.fun-style virtual-SOL
 *     bootstrapping; `create`'s params only ever specify `initial_token_b_reserves`, so
 *     A starts at a real reserve of 0 and `shift` is what keeps the initial price finite)
 *   vB (virtual reserve B) = token_b_reserves            (no virtual component)
 *
 *   feeTotal(amount) = floor(amount * platformFeeBps / 10000)
 *                    + Σ_{i=0..4} floor(amount * feeBeneficiaries[i].shareBps / 10000)
 *     — SIX INDEPENDENT FLOOR DIVISIONS SUMMED, NOT floor(amount * Σbps / 10000): the two
 *     differ whenever the individual terms carry different fractional remainders (proven
 *     empirically — e.g. pool with platformFeeBps=20, one beneficiary shareBps=100, amount
 *     777: floor(777*20/10000)+floor(777*100/10000) = 1+7 = 8, matching the program's
 *     returned fee_a exactly; floor(777*120/10000) = 9 does NOT match). Inactive
 *     beneficiary slots (index >= fee_beneficiary_count) carry shareBps = 0 (zero-inited
 *     Anchor account space), so summing over the full fixed 5-slot array unconditionally
 *     is safe and needs no runtime count check.
 *
 *   BUY  (mint_a in -> mint_b out): net = amountIn - feeTotal(amountIn)
 *                                   out = floor(vB * net / (vA + net))
 *   SELL (mint_b in -> mint_a out): gross = floor(vA * amountIn / (vB + amountIn))
 *                                   out   = gross - feeTotal(gross)
 *     — the fee is ALWAYS denominated in token A (`fee_a` in both BuyEvent/SellEvent),
 *     deducted from the INPUT on a buy and from the GROSS OUTPUT on a sell.
 *
 * Overflow bound: reserves/shift are u128 (real values observed are all << 2^64, but the
 * type permits up to 2^128); vB * net or vA * amountIn is then at most 2^128 * 2^64 =
 * 2^192, comfortably inside the engine's 256-bit wrap-free range (Math.mulDiv is used for
 * every product anyway, matching every other CP-family adapter's convention).
 *
 * Gates (checked at fetch time, REFUSE-don't-guess): `enabled` must be true (mirrors the
 * program's own `PoolDisabled`/`PairDisabled` revert — verified live: a graduated,
 * disabled scale-vmm pair's `quote_buy` reverts with exactly this error); `curve` must be
 * ConstantProduct (0) — the only variant observed across 987 live scale-amm pools + all
 * 3 scale-vmm pairs; `Exponential` (1) is declared in the IDL but never seen live and its
 * formula is unverified, so a pool carrying it is rejected rather than guessed at.
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { parseMintExtensions } from "../token-extensions.js";
import { memoizedGetProgramDerivedAddress } from "./pda-memo.js";

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

export const SCALE_AMM_PROGRAM_ID = address("SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA");
export const SCALE_VMM_PROGRAM_ID = address("SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa");

/** Anchor global instruction discriminators (sha256("global:<name>")[0..8]). */
export const BUY_DISCRIMINATOR = Uint8Array.of(102, 6, 61, 18, 1, 218, 235, 234);
export const SELL_DISCRIMINATOR = Uint8Array.of(51, 230, 133, 164, 1, 127, 131, 173);

export const FEE_BENEFICIARY_SLOTS = 5;
/** Borsh size of one FeeBeneficiary entry (wallet pubkey + u16 share_bps). */
const FEE_BENEFICIARY_STRIDE = 34;

export function readUintLE(data: Uint8Array, offset: number, width: number): bigint {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`readUintLE offset must be a non-negative integer, got ${offset}`);
  }
  if (!Number.isInteger(width) || width < 1 || width > 32) {
    throw new Error(`readUintLE width must be an integer in 1..=32, got ${width}`);
  }
  if (offset + width > data.length) {
    throw new Error(
      `readUintLE reads [${offset}, ${offset + width}) beyond ${data.length}-byte data`,
    );
  }
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
}

const ADDRESS_DECODER = getAddressDecoder();

export function pubkeyAt(data: Uint8Array, offset: number): Address {
  return ADDRESS_DECODER.decode(data.subarray(offset, offset + 32));
}

export interface FeeBeneficiary {
  wallet: Address;
  shareBps: number;
}

/** Reads all FEE_BENEFICIARY_SLOTS entries unconditionally (inactive slots are zero-inited). */
export function readFeeBeneficiaries(data: Uint8Array, offset: number): FeeBeneficiary[] {
  const out: FeeBeneficiary[] = [];
  for (let i = 0; i < FEE_BENEFICIARY_SLOTS; i++) {
    const entryOffset = offset + i * FEE_BENEFICIARY_STRIDE;
    out.push({
      wallet: pubkeyAt(data, entryOffset),
      shareBps: Number(readUintLE(data, entryOffset + 32, 2)),
    });
  }
  return out;
}

/** The literal ASCII seed both programs' PlatformConfig PDA uses (seeds=["config"]). */
export const CONFIG_SEED = new TextEncoder().encode("config");
/** The literal ASCII seed scale_amm's own (non-VMM-migrated) Pool PDA uses (seeds=["pool", owner, mint_a, mint_b]). */
export const POOL_SEED = new TextEncoder().encode("pool");

async function pda(seeds: (Address | Uint8Array)[], programAddress: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const bytes = seeds.map((seed) =>
    seed instanceof Uint8Array ? seed : new Uint8Array(encoder.encode(seed)),
  );
  return memoizedGetProgramDerivedAddress(programAddress, bytes);
}

/** Associated Token Account address: PDA([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM). */
export async function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return pda(
    [
      new Uint8Array(encoder.encode(owner)),
      new Uint8Array(encoder.encode(tokenProgram)),
      new Uint8Array(encoder.encode(mint)),
    ],
    ASSOCIATED_TOKEN_PROGRAM,
  );
}

export { pda };

/**
 * Which token program serves this mint — the SAME detection + gate the SDK's pumpswap adapter
 * uses. The OWNER decides the program: an extensionless Token-2022 mint is 82 bytes, exactly a
 * classic mint's layout, so only the owner tells them apart. Without an owner, an 82-byte mint is
 * taken as legacy. A Token-2022 mint's extensions are then checked either way: a TransferFeeConfig
 * extension makes real wire amounts diverge from the quote (a portion of every transfer is
 * withheld by the mint itself), so such mints are rejected rather than mis-quoted.
 */
export function detectTokenProgram(mint: Address, data: Uint8Array, owner?: Address): Address {
  if (owner !== undefined) {
    if (owner === TOKEN_PROGRAM) return TOKEN_PROGRAM;
    if (owner !== TOKEN_2022_PROGRAM) {
      throw new Error(
        `scale venue: mint ${mint} is owned by ${owner}, neither the legacy nor Token-2022 program`,
      );
    }
    // A Token-2022 mint with no extensions: nothing past the base layout to check.
    if (data.length === 82) return TOKEN_2022_PROGRAM;
  } else if (data.length === 82) {
    return TOKEN_PROGRAM;
  }
  if (data.length < 166) {
    throw new Error(
      `scale venue: mint ${mint} data is ${data.length} bytes, not a token mint layout`,
    );
  }
  if (data[165] !== 1) {
    throw new Error(
      `scale venue: mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`,
    );
  }
  // A NonTransferable / DefaultAccountState=frozen mint genuinely cannot route
  // through a plain transferChecked — self-drop it (safe; a dropped pool just
  // self-limits). PermanentDelegate/Confidential are advisories, not blocking,
  // so a routable T22 stablecoin (PYUSD/USDG) still passes.
  const { blocking } = parseMintExtensions(data);
  if (blocking.length > 0) {
    throw new Error(`scale venue: mint ${mint} is un-routable: ${blocking.join("; ")}`);
  }
  let offset = 166;
  while (offset + 4 <= data.length) {
    const extensionType = data[offset]! | (data[offset + 1]! << 8);
    const extensionLength = data[offset + 2]! | (data[offset + 3]! << 8);
    if (extensionType === 0) break; // uninitialized tail
    if (extensionType === 1) {
      // TODO(t22-fee-netting): a fee-bearing mint is REJECTED here rather than
      // fee-netted. Netting would need net(amount, feeConfig, epoch) on both
      // legs, but (a) scale-vmm exposes no referenceQuote at all and scale-amm's
      // receives only a unix `now`, not the Solana `epoch` getEpochFee requires,
      // and (b) how a mint-level transfer fee composes with this virtual-CP
      // curve's own fee-on-input / fee-on-gross-output split is not confidently
      // determined. Rejecting self-limits (safe); a wrong net silently
      // mis-quotes — so keep the no-op (reject) path.
      throw new Error(
        `scale venue: mint ${mint} carries a token-2022 TransferFeeConfig extension (wire amounts would not match the quote)`,
      );
    }
    offset += 4 + extensionLength;
  }
  return TOKEN_2022_PROGRAM;
}

/** CurveType::ConstantProduct — the only variant this adapter supports (see module doc). */
export const CURVE_CONSTANT_PRODUCT = 0;

export type ScaleDirection = "aToB" | "bToA";

export interface ScaleCurveState {
  reservesA: bigint;
  reservesB: bigint;
  shift: bigint;
  platformFeeBps: bigint;
  shareBps: readonly bigint[]; // length FEE_BENEFICIARY_SLOTS
}

function feeTotal(amount: bigint, state: ScaleCurveState): bigint {
  let fee = (amount * state.platformFeeBps) / 10000n;
  for (const bps of state.shareBps) fee += (amount * bps) / 10000n;
  return fee;
}

/** TS mirror of the `qScaleCurve` SauceScript helper — see module doc for the derivation. */
export function computeScaleQuote(
  state: ScaleCurveState,
  amountIn: bigint,
  direction: ScaleDirection,
): bigint {
  if (amountIn === 0n) return 0n;
  const vA = state.reservesA + state.shift;
  const vB = state.reservesB;
  if (direction === "aToB") {
    const net = amountIn - feeTotal(amountIn, state);
    if (net <= 0n) return 0n;
    return (vB * net) / (vA + net);
  }
  const gross = (vA * amountIn) / (vB + amountIn);
  return gross - feeTotal(gross, state);
}

/** Effective (reserveIn, reserveOut) for the relative-depth filter — the VIRTUAL reserves the curve above actually prices against. */
export function scaleDepthReserves(
  state: ScaleCurveState,
  direction: ScaleDirection,
): { reserveIn: bigint; reserveOut: bigint } {
  const vA = state.reservesA + state.shift;
  const vB = state.reservesB;
  return direction === "aToB"
    ? { reserveIn: vA, reserveOut: vB }
    : { reserveIn: vB, reserveOut: vA };
}

/** Continuous-oracle fee model (measurement only). */
export function scaleContinuousFees(
  state: ScaleCurveState,
  direction: ScaleDirection,
): { gammaPpm: bigint; muPpm: bigint } {
  const totalBps = state.platformFeeBps + state.shareBps.reduce((sum, bps) => sum + bps, 0n);
  const totalPpm = totalBps * 100n; // bps (1e4) -> ppm (1e6)
  const retainedPpm = 1_000_000n - totalPpm;
  // BUY charges the fee on input (gamma), SELL on output (mu); the other side is untouched.
  return direction === "aToB"
    ? { gammaPpm: retainedPpm, muPpm: 1_000_000n }
    : { gammaPpm: 1_000_000n, muPpm: retainedPpm };
}

/**
 * The shared quote-curve helper, deduped BY NAME across both scale-amm and scale-vmm
 * (byte-identical source — the
 * two programs' math is identical, only account layouts differ). `dir` is 0 for
 * aToB (buy: fee on input) and nonzero for bToA (sell: fee on gross output).
 */
export const SCALE_CURVE_HELPER_NAME = "qScaleCurve";
export const SCALE_CURVE_HELPER_SOURCE = [
  `function ${SCALE_CURVE_HELPER_NAME}(x, rA, rB, shift, pbps, s0, s1, s2, s3, s4, dir) {`,
  "  if (x === 0) { return 0 }",
  "  const vA = rA + shift;",
  "  const vB = rB;",
  "  if (dir === 0) {",
  "    const feeIn = Math.mulDiv(x, pbps, 10000) + Math.mulDiv(x, s0, 10000) + Math.mulDiv(x, s1, 10000) + Math.mulDiv(x, s2, 10000) + Math.mulDiv(x, s3, 10000) + Math.mulDiv(x, s4, 10000);",
  "    const net = x - feeIn;",
  "    return Math.mulDiv(vB, net, vA + net);",
  "  }",
  "  const gross = Math.mulDiv(vA, x, vB + x);",
  "  const feeOut = Math.mulDiv(gross, pbps, 10000) + Math.mulDiv(gross, s0, 10000) + Math.mulDiv(gross, s1, 10000) + Math.mulDiv(gross, s2, 10000) + Math.mulDiv(gross, s3, 10000) + Math.mulDiv(gross, s4, 10000);",
  "  return gross - feeOut;",
  "}",
].join("\n");
