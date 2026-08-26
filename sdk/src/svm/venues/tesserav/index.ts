/**
 * TesseraV venue adapter (program `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`)
 * — a closed-source prop-AMM. No on-chain IDL / published SDK exists, so this
 * adapter is built from a live-mainnet reverse-engineering pass (real
 * `getAccountInfo`/`getTransaction` reads, a `solana program dump`, and
 * LiteSVM replays of the deployed binary against cloned mainnet state — see
 * ./ladder.ts's header for the exact evidence and the honest exactness
 * caveat).
 *
 * ACCOUNT SHAPE (pool `FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n`, the live
 * SOL/USDC market, 1264 bytes, confirmed stable across multiple live
 * snapshots on 2026-07-31):
 *
 *   24   mintA   32B          56   mintB   32B
 *   120  lastUpdateSlot  u64 LE (matches the live cluster slot at every
 *        snapshot taken — an off-chain maker bot rewrites the ladder on a
 *        near-continuous cadence, confirmed by a separate direct top-level
 *        instruction to this program carrying an ~700-byte opaque payload and
 *        touching only 2 accounts, 408-412 CU, no logs — an oracle/ladder
 *        PUSH, not a swap)
 *   144  mid           u64 LE, scaled 1e15: `mid = round(1e15 * A_raw_per_B_raw)`
 *        — i.e. mid/1e15 is mintA-raw-units per mintB-raw-unit. Empirically
 *        matched: 1e15/mid ≈ the measured wSOL→USDC raw exchange rate to
 *        within ~0.03-0.1% across independently fetched snapshots (the
 *        residual is consistent with real price drift between fetches, not a
 *        derivation error — see ladder.ts).
 *   168  ladder A→B (sell mintA, buy mintB): 10 populated slots, stride 24:
 *          +0 price (ppm of 1e6, non-increasing across slots)
 *          +8 flag (observed constant 1 — kind/liveness marker, unmodeled)
 *          +16 cum (OUTPUT=mintB raw units for this level)
 *        then zero-padded slots (a 0-price slot terminates the walkable
 *        prefix, same convention this SDK already uses for quantum/manifest).
 *   640  ladder B→A (sell mintB, buy mintA), same 10-slot/24-byte-stride
 *        shape but fields REORDERED: +0 cum (OUTPUT=mintA raw units), +8
 *        price (ppm — numerically IDENTICAL to the A→B slot at the same
 *        index, confirmed byte-for-byte on every snapshot taken), +16 flag.
 *
 * This adapter ships ONLY the best (index-0) slot of whichever direction is
 * requested — see ladder.ts's header for why a single-slot model is the
 * correct, conservative MVP here (level-0 capacity dwarfed every size this
 * pass could test, up to 100 SOL notional, with no measurable curve
 * degradation) and the plan to extend to the full 10-slot walk.
 *
 * SWAP CPI (verified by real `sendTransaction`/`simulateTransaction` replays
 * in LiteSVM against a cloned mainnet pool, both via a real Jupiter `route`
 * CPI AND via a from-scratch native passthrough program — see ladder.ts):
 *   ix data:  tag(1B)=0x10 ++ direction(1B, 1=A→B / 0=B→A) ++
 *             amountIn(u64 LE) ++ minOut(u64 LE)
 *   accounts: [auth, pool(w), owner(signer), vaultA(w), vaultB(w),
 *              userSrcAta(w), userDstAta(w), mintA, mintB, tokenProgram,
 *              tokenProgram (again — an unused Token-2022 slot on this pool),
 *              instructionsSysvar]
 *
 * INTROSPECTION IS NOT A CALLER ALLOWLIST (measured, not assumed). Calling
 * this instruction as the transaction's OUTERMOST instruction reverts (custom
 * 0xffff / 0x5, ~34-37k CU, size-independent — an early guard). Calling it as
 * a CPI from a real Jupiter `route` succeeds; calling it as a CPI from a
 * freshly-generated, never-before-seen program id (a from-scratch native
 * passthrough, deployed nowhere) ALSO succeeds (verified: 46,908 CU, real
 * output credited). So the Instructions-sysvar read gates "must be CPI'd, not
 * top-level" only — the SAME shape as this SDK's own engine (`execute_from_
 * account` always CPIs a venue swap, never top-level) — NOT a caller
 * allowlist like Quantum's (see quantum/index.ts's own "hardcoded list of 15
 * aggregator ids" finding — a DIFFERENT, and stricter, gate that TesseraV
 * does not share). Confirm this holds on every re-verification pass; it is
 * the load-bearing fact that makes this venue buildable at all.
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
  */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'tesserav';

export const TESSERAV_PROGRAM_ID = address('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
// The Instructions sysvar constant is shared via ../../cpi-probe.js (already
// barreled at the top svm/index.ts level) — NOT re-declared/re-exported here,
// to avoid a duplicate-export collision at the package barrel (see ladder.ts).

const OFF_MINT_A = 24;
const OFF_MINT_B = 56;
export const OFF_MID = 144;
export const MID_SCALE = 1_000_000_000_000_000n; // 1e15

// A->B ladder (sell mintA for mintB): stride 24, fields (price, flag, cum).
export const OFF_LADDER_AB = 168;
export const AB_STRIDE = 24;
export const AB_OFF_PRICE = 0;
export const AB_OFF_CUM = 16;

// B->A ladder (sell mintB for mintA): stride 24, fields (cum, price, flag).
export const OFF_LADDER_BA = 640;
export const BA_STRIDE = 24;
export const BA_OFF_CUM = 0;
export const BA_OFF_PRICE = 8;

export const TESSERAV_LEVEL_SLOTS = 10;
export const PRICE_PPM_DEN = 1_000_000n;

const VAULT_AMOUNT_OFFSET = 64;

/** Minimum pool account size this adapter reads from (level 9's last byte + 1). */
export const TESSERAV_MIN_POOL_SIZE = OFF_LADDER_BA + TESSERAV_LEVEL_SLOTS * BA_STRIDE;

export interface TesseraVPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'aToB' sells mintA for mintB (ix direction byte 1); 'bToA' is the reverse (byte 0). */
  direction: 'aToB' | 'bToA';
  mintA: Address;
  mintB: Address;
  /** The program's shared vault-authority/registry PDA — read-only in the swap ix. */
  auth: Address;
  vaultA: Address;
  vaultB: Address;
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

/** Level-0 price (ppm of 1e6) for a direction — non-increasing across slots, this adapter ships slot 0 only. */
export function level0PriceOffset(direction: 'aToB' | 'bToA'): number {
  return direction === 'aToB' ? OFF_LADDER_AB + AB_OFF_PRICE : OFF_LADDER_BA + BA_OFF_PRICE;
}

/** Level-0 capacity, in OUTPUT-token raw units, for a direction. */
export function level0CumOffset(direction: 'aToB' | 'bToA'): number {
  return direction === 'aToB' ? OFF_LADDER_AB + AB_OFF_CUM : OFF_LADDER_BA + BA_OFF_CUM;
}

/**
 * Fetch + gate one TesseraV pool. Read-only against the loader. Gates: wrong
 * owner/size, an unprimed mid (0 — a pool the maker bot has never quoted),
 * and a zero/absent level-0 price or capacity (an empty book for this
 * direction — self-drop, not a revert, at the orchestrator layer).
 */
export async function fetchTesseraVConfig(load: AccountLoader, pool: Address, direction: 'aToB' | 'bToA'): Promise<TesseraVPoolConfig> {
  if (direction === 'bToA') {
    // See ladder.ts's header: the reverse swap-CPI account order was never
    // independently verified, and a launched-then-failing CPI aborts the
    // WHOLE cook on SVM (no execution-time catch/re-route here) — so this
    // stays a hard gate, not a self-drop, until a second live replay confirms
    // the shape.
    throw new Error(`${SLUG}: 'bToA' is unverified (see ladder.ts) and is not wired for production use yet`);
  }
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length < TESSERAV_MIN_POOL_SIZE) {
    throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected at least ${TESSERAV_MIN_POOL_SIZE}`);
  }
  const mid = readUintLE(data, OFF_MID, 8);
  if (mid === 0n) throw new Error(`${SLUG}: pool ${pool} has an unprimed mid price (never quoted by the maker)`);
  const price0 = readUintLE(data, level0PriceOffset(direction), 8);
  const cum0 = readUintLE(data, level0CumOffset(direction), 8);
  if (price0 === 0n || cum0 === 0n) {
    throw new Error(`${SLUG}: pool ${pool} has no walkable level-0 for direction ${direction}`);
  }

  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);
  // The swap CPI carries an unused Token-2022 slot but the instruction is
  // legacy-SPL (Tokenkeg) only. Detect a Token-2022 (or otherwise un-routable)
  // mint per side and GRACEFULLY SELF-DROP the pool (the SvmRoute orchestrator
  // catches a fetchPoolConfig throw and drops the venue). The LEGACY path is
  // byte-identical; an unreadable mint falls back to the legacy assumption.
  const _mints = [mintA, mintB];
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

  return {
    venue: SLUG,
    pool,
    direction,
    mintA,
    mintB,
    // The auth/vault trio is a fixed per-pool-pair fact (confirmed constant
    // across every snapshot in this pass) but is NOT stored inline in the
    // pool account — it rides the real swap CPI's account list, which this
    // codebase has no on-chain source for beyond the verified live trace.
    // Until a second pool is dumped to confirm a derivable relationship
    // (PDA seeds, or a pointer elsewhere in the 10240-byte auth account),
    // callers MUST supply it — see ladder.ts's buildSwapV2 doc.
    auth: pool === address('FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n')
      ? address('8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF')
      : (() => {
          throw new Error(
            `${SLUG}: pool ${pool} has no known auth/vault mapping yet — only the SOL/USDC pool ` +
              `FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n was verified in this pass`,
          );
        })(),
    vaultA: address('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV'),
    vaultB: address('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx'),
  };
}

/** Family facade for the recipe orchestrator (ladder-only — not in the v1 registry). */
export const tesserav = {
  slug: SLUG,
  programId: TESSERAV_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchTesseraVConfig,
};
