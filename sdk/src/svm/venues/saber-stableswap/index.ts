/**
 * Saber StableSwap venue adapter — program SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ
 * (same address on mainnet-beta and devnet). Non-Anchor: no 8-byte
 * discriminators anywhere; pool state is the 395-byte SwapInfo account
 * (program_pack, fixed offsets, all ints little-endian) and the swap
 * instruction is a single tag byte 0x01.
 *
 * Layouts and math verified against saber-hq/stable-swap sources:
 * stable-swap-client/src/state.rs (SwapInfo), fees.rs (Fees, 8 x u64 LE),
 * instruction.rs (SwapInstruction tag=1, account order),
 * stable-swap-math/src/curve.rs (compute_d / compute_y_raw / swap_to).
 *
 * Reserves are the LIVE SPL vault balances (amount u64 LE @64): admin fees
 * are transferred out of the destination vault in the same swap instruction,
 * so vault.amount is directly the quotable reserve — nothing to subtract.
 *
 * Quote/swap direction is token A -> token B (the adapter interface carries
 * no direction; B -> A is the same math with the roles swapped).
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { memoizedCreateProgramAddress } from "../pda-memo.js";
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "saber-stableswap";

export const SABER_STABLESWAP_PROGRAM_ID = address("SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ");

// Classic SPL Token — Saber predates Token-2022; vaults are Tokenkeg-owned.
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const SWAP_INFO_LEN = 395;
const U64_MAX = (1n << 64n) - 1n;

export interface SaberPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** Stored bump for the swap authority (SwapInfo byte 2) — create_program_address, NOT find. */
  nonce: number;
  /** create_program_address([pool (32B), [nonce]], programId) — owner of both vaults. */
  swapAuthority: Address;
  initialAmpFactor: bigint;
  targetAmpFactor: bigint;
  /** i64 unix seconds, read unsigned (sign bit never set for real timestamps). */
  startRampTs: bigint;
  /** i64 unix seconds; 0 or past means amp == targetAmpFactor. */
  stopRampTs: bigint;
  /** SPL token account holding token A reserves (quote-input side). */
  vaultA: Address;
  /** SPL token account holding token B reserves (quote-output side). */
  vaultB: Address;
  mintA: Address;
  mintB: Address;
  adminFeeA: Address;
  /** Admin fee account of the OUTPUT token for A -> B swaps (instruction account 7). */
  adminFeeB: Address;
  tradeFeeNumerator: bigint;
  tradeFeeDenominator: bigint;
  adminTradeFeeNumerator: bigint;
  adminTradeFeeDenominator: bigint;
}

function asSaberConfig(cfg: PoolConfig): SaberPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`saber-stableswap adapter got a config for venue '${cfg.venue}'`);
  return cfg as SaberPoolConfig;
}

function assertU64AmountIn(amountIn: bigint): void {
  if (amountIn <= 0n)
    throw new Error(`saber-stableswap amountIn must be positive, got ${amountIn}`);
  if (amountIn > U64_MAX)
    throw new Error(`saber-stableswap amountIn must fit u64, got ${amountIn}`);
}

/**
 * sha256(pool || [nonce] || programId || "ProgramDerivedAddress") — the raw
 * create_program_address with the stored bump. find_program_address would be
 * wrong for any pool whose stored nonce is not the canonical bump.
 */
function deriveSwapAuthority(pool: Address, nonce: number): Address {
  const encoder = getAddressEncoder();
  const { address: authority, offCurve } = memoizedCreateProgramAddress(
    SABER_STABLESWAP_PROGRAM_ID,
    [encoder.encode(pool), Uint8Array.of(nonce)],
  );
  if (!offCurve) {
    throw new Error(
      `saber-stableswap pool ${pool} nonce ${nonce} derives an on-curve swap authority`,
    );
  }
  return authority;
}

/**
 * compute_amp_factor: linear interpolation while now < stop_ramp_ts (floor
 * division, exact in bigint), otherwise — including stop_ramp_ts == 0 — the
 * target. The degenerate guards (equal amps, empty ramp window) mirror the
 * conditions under which emitQuote skips the ramp branch.
 */
function computeAmpFactor(cfg: SaberPoolConfig, now: bigint): bigint {
  const range = cfg.stopRampTs - cfg.startRampTs;
  if (now < cfg.stopRampTs && range > 0n && cfg.initialAmpFactor !== cfg.targetAmpFactor) {
    const delta = now - cfg.startRampTs;
    return cfg.targetAmpFactor >= cfg.initialAmpFactor
      ? cfg.initialAmpFactor + ((cfg.targetAmpFactor - cfg.initialAmpFactor) * delta) / range
      : cfg.initialAmpFactor - ((cfg.initialAmpFactor - cfg.targetAmpFactor) * delta) / range;
  }
  return cfg.targetAmpFactor;
}

/**
 * compute_d Newton iteration for the two-token invariant: ann = amp * 2,
 * d starts at the sum, up to 256 rounds, converged when successive estimates
 * differ by <= 1. On-chain this runs in U192 with checked ops; bigint floor
 * division matches exactly because d <= xa + xb < 2^65 keeps the d^3-scale
 * intermediates below 2^192 for u64 reserves.
 */
function computeD(amp: bigint, xa: bigint, xb: bigint): bigint {
  const sum = xa + xb;
  if (sum === 0n) return 0n;
  const ann = amp * 2n;
  let d = sum;
  for (let round = 0; round < 256; round++) {
    let dProd = (d * d) / (xa * 2n);
    dProd = (dProd * d) / (xb * 2n);
    const dPrev = d;
    d = (d * (dProd * 2n + sum * ann)) / (d * (ann - 1n) + dProd * 3n);
    const diff = d > dPrev ? d - dPrev : dPrev - d;
    if (diff <= 1n) break;
  }
  return d;
}

/**
 * compute_y Newton iteration: the destination-side balance that keeps the
 * invariant d after the source side moved to x. Same cap (256), same <= 1
 * convergence, same floor division as compute_d.
 */
function computeY(amp: bigint, x: bigint, d: bigint): bigint {
  const ann = amp * 2n;
  let c = (d * d) / (x * 2n);
  c = (c * d) / (ann * 2n);
  const b = d / ann + x;
  let y = d;
  for (let round = 0; round < 256; round++) {
    const yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    const diff = y > yPrev ? y - yPrev : yPrev - y;
    if (diff <= 1n) break;
  }
  return y;
}

export const saberStableswap: SvmVenueAdapter = {
  slug: SLUG,
  kind: "stable",
  programId: SABER_STABLESWAP_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<SaberPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`saber-stableswap pool account ${pool} not found`);
    if (data.length !== SWAP_INFO_LEN) {
      throw new Error(
        `saber-stableswap pool ${pool} data must be ${SWAP_INFO_LEN} bytes (SwapInfo), got ${data.length}`,
      );
    }
    if (data[0] !== 1)
      throw new Error(
        `saber-stableswap pool ${pool} is not initialized (is_initialized = ${data[0]})`,
      );
    if (data[1] !== 0)
      throw new Error(`saber-stableswap pool ${pool} is paused (is_paused = ${data[1]})`);

    const tradeFeeDenominator = readUintLE(data, 371, 8);
    // A zero denominator would fail on-chain with CalculationFailure and the
    // engine's mulDiv aborts on a zero divisor — gate it off-chain instead.
    if (tradeFeeDenominator === 0n) {
      throw new Error(`saber-stableswap pool ${pool} trade_fee_denominator must be positive`);
    }

    const nonce = data[2];
    const pubkey = getAddressDecoder();
    const mintA = pubkey.decode(data, 203);
    const mintB = pubkey.decode(data, 235);
    // Saber predates Token-2022 and its vaults are Tokenkeg-owned, but detect
    // and SELF-DROP a pool holding a Token-2022 mint (or an un-routable
    // extension mint) defensively — the thrown error is the graceful-drop
    // signal (SvmRoute drops the venue on a fetchPoolConfig throw). An
    // unreadable mint falls back to the legacy assumption, leaving the
    // byte-identical legacy path intact.
    const mints = [mintA, mintB];
    const mintDatas = await Promise.all(mints.map((mint) => load(mint)));
    for (let mi = 0; mi < mints.length; mi++) {
      const mint = mints[mi]!;
      const mintData = mintDatas[mi]!;
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }
    return {
      venue: SLUG,
      pool,
      nonce,
      swapAuthority: deriveSwapAuthority(pool, nonce),
      initialAmpFactor: readUintLE(data, 3, 8),
      targetAmpFactor: readUintLE(data, 11, 8),
      startRampTs: readUintLE(data, 19, 8),
      stopRampTs: readUintLE(data, 27, 8),
      vaultA: pubkey.decode(data, 107),
      vaultB: pubkey.decode(data, 139),
      mintA,
      mintB,
      adminFeeA: pubkey.decode(data, 267),
      adminFeeB: pubkey.decode(data, 299),
      adminTradeFeeNumerator: readUintLE(data, 331, 8),
      adminTradeFeeDenominator: readUintLE(data, 339, 8),
      tradeFeeNumerator: readUintLE(data, 363, 8),
      tradeFeeDenominator,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = asSaberConfig(cfg);
    // The pool rides along for the live is_paused byte; reserves are the two
    // vault balances. Refs are the base58 addresses themselves — unique per
    // account, and the generator binds them without a resolution entry.
    return [
      { ref: c.pool, address: c.pool },
      { ref: c.vaultA, address: c.vaultA },
      { ref: c.vaultB, address: c.vaultB },
    ];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = asSaberConfig(cfg);
    if (!Number.isInteger(i) || i < 0) {
      throw new Error(
        `saber-stableswap emitQuote pool index must be a non-negative integer, got ${i}`,
      );
    }
    assertU64AmountIn(amountIn);

    // Account model (RS): quoteAccounts() attaches [pool, vaultA, vaultB], so
    // the pool is slot 0 (acc0), vaultA slot 1 (acc1) and vaultB slot 2 (acc2);
    // every read is `svm.sload(acc<k>, off, w).toLe()` (all u64/u8 LE fields).
    // stableD(amp, xa, xb) -> invariant D and stableY(amp, x, d) -> new
    // destination-side balance are the shared stable-curve helpers the
    // generator declares once (Newton per computeD/computeY above: cap 256,
    // converge <= 1, floor division). In-VM bounds: reserves and amountIn are
    // u64, so srcRes + amountIn < 2^65 and every fragment-level op stays far
    // below the 256-bit wrap; Math.mulDiv is 512-bit-safe by construction.
    const lines = [
      `  const paused${i} = svm.sload(acc0, 1, 1).toLe();`,
      `  const srcRes${i} = svm.sload(acc1, 64, 8).toLe();`,
      `  const dstRes${i} = svm.sload(acc2, 64, 8).toLe();`,
      `  let amp${i} = ${c.targetAmpFactor};`,
    ];

    // Amp ramp: the interpolation direction depends only on compile-time
    // constants, so bake the up- or down-ramp branch; once the ramp window is
    // past, ctx.timestamp() < stopRampTs is false and amp stays the target.
    const range = c.stopRampTs - c.startRampTs;
    if (c.stopRampTs !== 0n && range > 0n && c.initialAmpFactor !== c.targetAmpFactor) {
      const interp =
        c.targetAmpFactor >= c.initialAmpFactor
          ? `${c.initialAmpFactor} + Math.mulDiv(${c.targetAmpFactor - c.initialAmpFactor}, ctx.timestamp() - ${c.startRampTs}, ${range})`
          : `${c.initialAmpFactor} - Math.mulDiv(${c.initialAmpFactor - c.targetAmpFactor}, ctx.timestamp() - ${c.startRampTs}, ${range})`;
      lines.push(`  if (ctx.timestamp() < ${c.stopRampTs}) { amp${i} = ${interp} }`);
    }

    // dy = dstRes - y - 1 (the -1 rounding buffer), fee on the OUTPUT side.
    // The dstRes > y guard mirrors the on-chain checked_subs: without it a
    // paused/dust quote would wrap and falsely win the best scan.
    lines.push(
      `  const d${i} = stableD(amp${i}, srcRes${i}, dstRes${i});`,
      `  const y${i} = stableY(amp${i}, srcRes${i} + ${amountIn}, d${i});`,
      `  let q${i} = 0;`,
      `  if (paused${i} === 0 && dstRes${i} > y${i}) {`,
      `    const dy${i} = dstRes${i} - y${i} - 1;`,
      `    q${i} = dy${i} - Math.mulDiv(dy${i}, ${c.tradeFeeNumerator}, ${c.tradeFeeDenominator});`,
      `  }`,
    );
    return lines.join("\n");
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = asSaberConfig(cfg);
    assertU64AmountIn(amountIn);

    // tag 0x01 | amount_in u64 LE | minimum_amount_out u64 LE (= 1: the
    // recipe's post-swap outAta delta check enforces the real bound).
    const data = new Uint8Array(17);
    data[0] = 0x01;
    new DataView(data.buffer).setBigUint64(1, amountIn, true);
    data[9] = 1;

    return {
      programId: SABER_STABLESWAP_PROGRAM_ID,
      data,
      accounts: [
        { ref: c.pool, address: c.pool },
        { ref: c.swapAuthority, address: c.swapAuthority },
        { ref: user.owner, signer: true },
        { ref: user.inAta, writable: true },
        { ref: c.vaultA, address: c.vaultA, writable: true },
        { ref: c.vaultB, address: c.vaultB, writable: true },
        { ref: user.outAta, writable: true },
        { ref: c.adminFeeB, address: c.adminFeeB, writable: true },
        { ref: TOKEN_PROGRAM, address: TOKEN_PROGRAM },
      ],
    };
  },

  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint {
    const c = asSaberConfig(cfg);
    if (amountIn < 0n)
      throw new Error(`saber-stableswap amountIn must be non-negative, got ${amountIn}`);
    if (amountIn === 0n) return 0n; // on-chain amount_in == 0 is a no-op success
    if (amountIn > U64_MAX)
      throw new Error(`saber-stableswap amountIn must fit u64, got ${amountIn}`);

    const poolData = state[c.pool];
    if (poolData === undefined)
      throw new Error(`saber-stableswap referenceQuote state is missing pool ${c.pool}`);
    const vaultAData = state[c.vaultA];
    if (vaultAData === undefined)
      throw new Error(`saber-stableswap referenceQuote state is missing vault ${c.vaultA}`);
    const vaultBData = state[c.vaultB];
    if (vaultBData === undefined)
      throw new Error(`saber-stableswap referenceQuote state is missing vault ${c.vaultB}`);

    if (poolData[1] !== 0) return 0n; // paused — the fragment quotes 0

    const srcReserve = readUintLE(vaultAData, 64, 8);
    const dstReserve = readUintLE(vaultBData, 64, 8);
    // compute_d divides by each balance; on-chain an empty vault fails with
    // CalculationFailure, so the pool is simply not quotable.
    if (srcReserve === 0n || dstReserve === 0n) {
      throw new Error(`saber-stableswap pool ${c.pool} has an empty reserve`);
    }

    const amp = computeAmpFactor(c, now);
    const d = computeD(amp, srcReserve, dstReserve);
    const y = computeY(amp, srcReserve + amountIn, d);
    if (y > U64_MAX)
      throw new Error(`saber-stableswap pool ${c.pool} compute_y result exceeds u64`);

    if (dstReserve <= y) return 0n; // checked_sub would fail on-chain — no output
    const dy = dstReserve - y - 1n;
    const dyFee = (dy * c.tradeFeeNumerator) / c.tradeFeeDenominator;
    return dy - dyFee;
  },
};
