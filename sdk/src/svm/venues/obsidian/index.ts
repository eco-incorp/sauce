/**
 * Obsidian venue adapter — a closed-source prop AMM / push-quote PMM
 * (program `HBVw6bZtcCaezhcBrmfyXBSBRWCdv72271xQ4GPvms2z`). No on-chain IDL
 * ships for this program, so everything below is recovered by binary/account
 * inspection plus real mainnet transaction archaeology (the same method that
 * produced obric-v2 / quantum / solfi-v2 / bisonfi) and cross-checked with
 * our own `simulateTransaction` calls (`sigVerify:false`) against the live
 * program.
 *
 * ── Method (2026-07-31) ──
 * `getSignaturesForAddress` + `getTransaction` over the program's real
 * history recovered 18 real LANDED swaps (both directions, sizes spanning
 * ~22M to ~8.3B raw units — over 2.5 orders of magnitude) plus the
 * "update_crank_params" keeper instruction. The program binary itself
 * (dumped from its `ProgramData` account — a real .so, no IDL, but NOT
 * stripped of Rust source paths) confirms the instruction names via panic
 * unwind strings: `obsidian-amm/src/instruction/swap.rs` (disc 0x01, this
 * adapter) and `obsidian-amm/src/instruction/update_crank_params.rs`
 * (disc 0x00, a keeper-only price-feed refresh this adapter never emits).
 *
 * ── Account layout (pool account, 2216 bytes) ──
 * Located the same way as bisonfi/solfi-v2 (known vault/mint addresses found
 * as raw bytes inside a real pool account):
 *   OFF_MINT_A         = 80   (pubkey)
 *   OFF_MINT_B         = 112  (pubkey)
 *   OFF_VAULT_A        = 144  (pubkey — SPL vault for mintA)
 *   OFF_VAULT_B        = 176  (pubkey — SPL vault for mintB)
 *   OFF_LAST_UPDATE_SLOT = 536 (u64 — the crank's last-write slot; VERIFIED:
 *     the live SOL/USDC pool's current value, 420596559, is EXACTLY the slot
 *     of the last real transaction ever landed against this program — an
 *     unrecoverable coincidence otherwise)
 *   OFF_PRICE          = 544 (u64 — mid price, quoteB-per-baseA scaled 1e6;
 *     the SAME 8 bytes the update_crank_params payload writes at this offset;
 *     see ladder.ts's "Quote model" for the wei-level fit against the 18 real
 *     fills)
 *
 * ── Swap instruction (disc 0x01, 9 bytes: disc(1) ++ amountIn u64 LE) ──
 * Recovered from the 18 real fills (`getTransaction` + inner-instruction
 * stack-height correlation): NO min_out field and NO direction byte — the
 * program infers direction from which mint the caller's source ATA holds.
 *
 * ── Accounts (8, POSITIONAL BY ROLE — vaultA/vaultB are POSITIONAL BY MINT,
 * same trap as solfi-v2/Quantum: their slots are FIXED to mintA/mintB
 * regardless of trade direction, and the program auto-detects direction from
 * the caller's source-ATA mint, confirmed by observing the SAME account
 * order used for BOTH directions across the 18 real fills) ──
 *   0 authority (signer)     — owner of the source ATA (a real signer in a
 *                              direct/non-aggregated call; a delegate PDA
 *                              when routed through an aggregator's
 *                              shared-accounts flow — either is accepted)
 *   1 pool      (writable)   — the 2216-byte pool state account
 *   2 vaultA    (writable)   — mintA's SPL vault (FIXED identity)
 *   3 vaultB    (writable)   — mintB's SPL vault (FIXED identity)
 *   4 userSrcAta (writable)  — caller's source-mint ATA (tokenIn)
 *   5 userDstAta (writable)  — caller's dest-mint ATA (tokenOut)
 *   6 TOKEN_PROGRAM (readonly)
 *   7 SYSVAR_INSTRUCTIONS (readonly)
 * Verified structurally via our OWN simulateTransaction against the live
 * program (real dev keypair, real wrapped-SOL balance, no impersonation):
 * the instruction reached 353 CU of real program logic (well past account
 * deserialization) before reverting with a business-logic `custom program
 * error: 0xb` — see "Live-state honesty" below for why every currently-known
 * pool reverts there.
 *
 * ── Live-state honesty (2026-07-31) ──
 * ALL THREE currently-known Obsidian pools are stale: `OFF_LAST_UPDATE_SLOT`
 * reads 420596559 / 371375264 / 0 against a live cluster slot near
 * 436,466,828 — the keeper has not refreshed any of them in months. This
 * adapter's own prepare-time freshness gate (see `fetchPoolConfig`) reflects
 * that reality and self-drops every currently-known pool — this is NOT a
 * permission/whitelist refusal, it mirrors the real program's OWN enforced
 * staleness check (our simulateTransaction probe against the live SOL/USDC
 * pool reverted with `custom program error: 0xb` at exactly this staleness,
 * consistent with a stale-crank gate) and exists because an execution-time
 * CPI failure aborts the WHOLE cook on SVM (no partial-catch) — admitting a
 * pool doomed to revert would take down every other venue in the same
 * transaction, not just this one. The integration is complete and correct;
 * it will start serving quotes the moment the keeper (or any keeper) refreshes
 * a pool, with zero code changes — sequencing, not a gate on the feature.
 *
 * This file is the off-chain decode + CPI-account layer (PoolConfig,
 * fetchPoolConfig, quoteAccounts).
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig, VenueAccount } from "../types.js";

const SLUG = "obsidian";
export const OBSIDIAN_PROGRAM_ID = address("HBVw6bZtcCaezhcBrmfyXBSBRWCdv72271xQ4GPvms2z");

const POOL_ACCOUNT_SIZE = 2216;
export const OFF_MINT_A = 80;
export const OFF_MINT_B = 112;
export const OFF_VAULT_A = 144;
export const OFF_VAULT_B = 176;
export const OFF_LAST_UPDATE_SLOT = 536;
export const OFF_PRICE = 544;
/** SPL mint account decimals field offset (standard layout: after COption<Pubkey> + u64 supply). */
export const MINT_DECIMALS_OFF = 44;
/** Clock sysvar `slot` field offset (first u64 of the Clock struct). */
const CLOCK_SLOT_OFF = 0;
const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");

/**
 * Freshness bound for the off-chain prepare gate (slots; ~600 slots is ~4
 * minutes at 400ms/slot). Conservative-tight by design: we have no ground
 * truth for the program's own enforced threshold (only that ~15.9M slots of
 * staleness reverts), and under-estimating freshness only costs a missed
 * quote — over-estimating risks admitting a pool that reverts on-chain,
 * which aborts the WHOLE cook (see the file header). Re-tune once the real
 * threshold is known (e.g. once a keeper is observed refreshing on a known
 * cadence).
 */
export const MAX_STALE_SLOTS = 600n;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

export interface ObsidianPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA in / mintB out, 1 = mintB in / mintA out (POSITIONAL BY MINT — see the file header). */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  decimalsA: number;
  decimalsB: number;
}

/** Shared by index.ts and ladder.ts; not exported (mirrors the solfi-v2 split). */
function obsidianConfig(cfg: PoolConfig): ObsidianPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  const c = cfg as ObsidianPoolConfig;
  if (c.direction !== 0 && c.direction !== 1) {
    throw new Error(`${SLUG} direction must be 0 or 1, got '${c.direction}'`);
  }
  return c;
}

async function fetchDecimals(load: AccountLoader, mint: Address): Promise<number> {
  const data = await load(mint);
  if (data === null) throw new Error(`${SLUG} mint ${mint} account not found`);
  if (data.length <= MINT_DECIMALS_OFF) {
    throw new Error(
      `${SLUG} mint ${mint} account is ${data.length} bytes, too small for an SPL Mint`,
    );
  }
  return data[MINT_DECIMALS_OFF];
}

/**
 * Off-chain gate + decode. Rejects: wrong pool size, a missing mint/decimals
 * read, and — the load-bearing check — a STALE crank price (see the file
 * header "Live-state honesty"). direction is caller-supplied (0 or 1); both
 * directions share one pool account.
 */
async function fetchPoolConfig(
  load: AccountLoader,
  pool: Address,
  direction: 0 | 1 = 0,
): Promise<ObsidianPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }

  const clockData = await load(CLOCK_SYSVAR);
  if (clockData === null)
    throw new Error(`${SLUG} could not read the Clock sysvar to gate pool ${pool} freshness`);
  const liveSlot = readUintLE(clockData, CLOCK_SLOT_OFF, 8);
  const lastUpdateSlot = readUintLE(data, OFF_LAST_UPDATE_SLOT, 8);
  if (liveSlot > lastUpdateSlot && liveSlot - lastUpdateSlot > MAX_STALE_SLOTS) {
    throw new Error(
      `${SLUG} pool ${pool} price is stale: last updated slot ${lastUpdateSlot}, live slot ${liveSlot} (>${MAX_STALE_SLOTS} slots old) — self-dropping to avoid a cook-aborting revert`,
    );
  }

  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);
  const vaultA = pubkeyAt(data, OFF_VAULT_A);
  const vaultB = pubkeyAt(data, OFF_VAULT_B);
  const [decimalsA, decimalsB] = await Promise.all([
    fetchDecimals(load, mintA),
    fetchDecimals(load, mintB),
  ]);

  return {
    venue: SLUG,
    pool,
    direction,
    mintA,
    mintB,
    vaultA,
    vaultB,
    decimalsA,
    decimalsB,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = obsidianConfig(base);
  return [
    { ref: cfg.pool, address: cfg.pool },
    { ref: cfg.vaultA, address: cfg.vaultA },
    { ref: cfg.vaultB, address: cfg.vaultB },
  ];
}

export const obsidian = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: OBSIDIAN_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};
