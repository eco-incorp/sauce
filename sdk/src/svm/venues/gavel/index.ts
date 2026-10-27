/**
 * Gavel / "Plasma" (Ellipsis Labs sr-AMM, program `srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi`) —
 * a sandwich-resistant constant-product AMM. This is NOT a CLOB: the whole
 * pool state (a fixed-size `PoolAccount`, no dynamic order book) fits one
 * account, so the quote is fully closed-form and needs no off-chain-shipped
 * window/levels at all.
 *
 * SOURCE: the program's account layout and instruction format below were
 * confirmed against REAL mainnet state (`CcWf5D6BhUTv2tD4ebFFcmCdTUgBWMc8CqqoJvFHGGXi`,
 * the IBRL/wSOL launch pool): the discriminator decoded to the pinned
 * constant below, and base/quote decimals (6/9) and mints matched the real
 * IBRL/wSOL pair.
 *
 * ── Account layout (`PoolHeader` + `Amm`, `#[repr(C)]` + `bytemuck::Pod`,
 *    cast directly from account bytes at offset 0 — `initialize.rs`'s
 *    `try_from_bytes_mut::<PoolAccount>(&mut pool_bytes)`, no prefix) ──
 *
 * `PoolHeader`: discriminator([u8;8])@0, sequence_number(u64)@8,
 * base_params(TokenParams)@16, quote_params(TokenParams)@88,
 * fee_recipients(ProtocolFeeRecipients, 264 bytes)@160,
 * swap_sequence_number(u64)@424, padding@432 — 528 bytes total.
 * `TokenParams` (72 bytes): decimals(u32)@0, vault_bump(u32)@4,
 * mint_key(Pubkey)@8, vault_key(Pubkey)@40.
 * `Amm` starts at 528 (528 % 16 == 0, so this holds regardless of the
 * platform alignment of the `I80F48`/`i128` `reward_factor` field):
 * fee_in_bps(u32)@528, protocol_allocation_in_pct(u32)@532,
 * lp_vesting_window(u64)@536, reward_factor(i128)@544, total_lp_shares(u64)@560,
 * slot_snapshot(u64)@568, base_reserves_snapshot(u64)@576,
 * quote_reserves_snapshot(u64)@584, base_reserves(u64)@592,
 * quote_reserves(u64)@600, cumulative_quote_lp_fees(u64)@608,
 * cumulative_quote_protocol_fees(u64)@616 — 624 bytes total (GAVEL_POOL_SIZE).
 * All offsets confirmed by decoding 112 real mainnet pools via
 * getProgramAccounts (memcmp on the discriminant + dataSize 624) and finding
 * sane fee_in_bps (25/30 bps)/reserves/decimals at every one.
 *
 * fee_in_bps is IMMUTABLE post-init (no admin instruction in
 * `PlasmaInstruction` mutates it — only `WithdrawProtocolFees`, a payout, and
 * `WithdrawLpFees`), so it is baked as a compile-time PARAM (like fluxbeam's
 * trade-fee numerators) rather than re-read live each trade.
 *
 * WHY THIS IS COMPUTABLE ON-CHAIN WITHOUT A SHIPPED WINDOW (unlike
 * manifest/phoenix's order books): `slot_snapshot` / `*_reserves_snapshot` /
 * `base_reserves` / `quote_reserves` are all FIXED-OFFSET fields on the ONE
 * pool account already being read — no tree walk. The one missing datum
 * (`Clock::get()?.slot`, the LIVE current slot) is read via SauceScript's
 * `ctx.blockNumber()`, which the SVM engine profile documents as having a
 * fork-parity analog for every EVM chain op (the compiler's saucer/
 * svm-profile.js) — EMPIRICALLY CONFIRMED here (not merely trusted from that
 * comment) by compiling `function main(){ return abi.encode(ctx.blockNumber(),
 * ctx.timestamp()) }` for target 'svm' and executing it on the real engine.so
 * inside a LiteSVM harness pinned via `svm.warpToSlot(1000)` +
 * `svm.setClock(new Clock(1000, 0n, 0n, 0n, 12345n))`: it returned
 * `(1000, 12345)` — `ctx.blockNumber()` is exactly the Solana slot, `ctx.timestamp()`
 * exactly the Clock's unix_timestamp, independently steerable (the SAME
 * mechanism `solfi-v2` already established for its own live-slot read — see
 * `the consuming app cu e2e test`'s `SOLFI_SLOT` comment). So `referenceQuote`'s
 * `now` parameter, for THIS family, is the CURRENT SLOT (not a unix
 * timestamp) — the same convention solfi-v2 set; `now` absent defaults to 0n
 * (same as solfi-v2), which — since a real `slot_snapshot` is always > 0
 * once a pool has ever swapped — takes the "trust the stored snapshot"
 * branch, never the reset.
 *
 * ── Swap CPI (`PlasmaInstruction::Swap` = 0, instruction.rs) ──
 *
 * Accounts (shank-declared): [0] `plasma_program` (this program's own id,
 * readonly — self-CPI for event logging, the same idiom manifest/phoenix
 * use), [1] `log_authority` (readonly PDA seeds=[b"log"], hardcoded in
 * lib.rs as `37zgQb6PjFuxah6R8CTk67gEvLrpqPQ61E7vh9ARPGFD` and asserted there
 * by a `check_pda` test), [2] `pool` (writable), [3] `trader` (signer, NOT
 * writable), [4] `base_account` (trader's, writable), [5] `quote_account`
 * (trader's, writable), [6] `base_vault` (writable), [7] `quote_vault`
 * (writable), [8] `token_program`. `token_program` is HARDCODED to
 * `spl_token::id()` in every account loader in this program
 * (validation/loaders.rs) — classic-Tokenkeg only, no Token-2022 path exists,
 * so (unlike fluxbeam) mints are gated to exactly 82 bytes with no
 * SOUND-vs-heuristic ambiguity.
 *
 * Data: ONE leading instruction-selector byte (`PlasmaInstruction::Swap as
 * u8` = 0 — easy to miss since `Swap`'s own variant tag is ALSO 0, but it is
 * a separate byte the entrypoint's dispatch consumes before `SwapParams` is
 * even parsed; a real-CPI run without it dispatched into `AddLiquidity`,
 * `PlasmaInstruction::to_vec`'s `vec![*self as u8]` confirms the shape) then
 * Borsh `SwapParams { side: Side, swap_type: SwapType }` — `Side` is a unit
 * enum (`Buy=0, Sell=1` by declaration order in amm.rs), `SwapType` an enum
 * whose `ExactIn{amount_in: u64, min_amount_out: u64}` variant is tag 0
 * (declaration order in processor/swap.rs). Full wire: `[ix tag=0 (Swap)]
 * [side u8][swap_type tag=0 u8][amount_in u64 LE (patched)][min_amount_out
 * u64 LE = 1]` — venue-level min_out is 1, the recipe's own terminal outAta
 * delta check is the real floor (the solswap/manifest/phoenix discipline).
 * PROVEN against the real dumped mainnet binary — see
 * `the consuming app realcpi e2e test`'s `gavel` quadrilateral.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "gavel";

export const GAVEL_PROGRAM_ID = address("srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** u64 LE @0 — accounts.rs POOL_ACCOUNT_DISCRIMINATOR ([116,210,187,119,196,196,52,137]). */
export const GAVEL_POOL_DISCRIMINANT = 9_886_743_430_086_513_268n;
/** PoolHeader (528) + Amm (96) — bytemuck::Pod, cast at offset 0, no prefix. */
export const GAVEL_POOL_SIZE = 624;
/** processor/swap.rs / lib.rs — the sr-AMM snapshot rotates every 4 slots (~1.6-2s). */
export const GAVEL_LEADER_SLOT_WINDOW = 4n;

const OFF_BASE_DECIMALS = 16;
const OFF_BASE_MINT = 24;
const OFF_BASE_VAULT = 56;
const OFF_QUOTE_DECIMALS = 88;
const OFF_QUOTE_MINT = 96;
const OFF_QUOTE_VAULT = 128;
const OFF_FEE_IN_BPS = 528;
const OFF_TOTAL_LP_SHARES = 560;
const OFF_BASE_RESERVES = 592;
const OFF_QUOTE_RESERVES = 600;

export interface GavelPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'baseIn' (default) sells base for quote; 'quoteIn' buys base with quote. */
  direction: "baseIn" | "quoteIn";
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  baseDecimals: number;
  quoteDecimals: number;
  /** bps, immutable post-init — baked as a compile-time param. */
  feeInBps: bigint;
}

function decodeAddress(data: Uint8Array, offset: number): Address {
  return getAddressCodec().decode(data.subarray(offset, offset + 32)) as Address;
}

/**
 * Fetch + gate one Gavel/Plasma pool: discriminant + size, a live LP-share /
 * reserve liveness gate (mirrors every other family's "one bad pool never
 * kills a cook" self-drop), and classic-SPL-only mints (the program's own
 * token_program is hardcoded to Tokenkeg — see the module header).
 */
export async function fetchGavelConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<GavelPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool ${pool} account not found`);
  if (data.length !== GAVEL_POOL_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} must be ${GAVEL_POOL_SIZE} bytes (PoolHeader+Amm), got ${data.length}`,
    );
  }
  if (readUintLE(data, 0, 8) !== GAVEL_POOL_DISCRIMINANT) {
    throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a Gavel PoolAccount)`);
  }

  const totalLpShares = readUintLE(data, OFF_TOTAL_LP_SHARES, 8);
  const baseReserves = readUintLE(data, OFF_BASE_RESERVES, 8);
  const quoteReserves = readUintLE(data, OFF_QUOTE_RESERVES, 8);
  if (totalLpShares <= 0n || baseReserves <= 0n || quoteReserves <= 0n) {
    throw new Error(
      `${SLUG}: pool ${pool} is uninitialized or drained (lpShares=${totalLpShares}, base=${baseReserves}, quote=${quoteReserves})`,
    );
  }

  const baseMint = decodeAddress(data, OFF_BASE_MINT);
  const quoteMint = decodeAddress(data, OFF_QUOTE_MINT);
  // The Swap ix's token_program is hardcoded to spl_token::id() in every
  // loader (validation/loaders.rs) — Tokenkeg-only, so a Token-2022 mint (or
  // one carrying an un-routable extension) cannot actually be swapped here.
  // Detect via the mint's OWNER (an extensionless Token-2022 mint is
  // byte-identical to a legacy one) and SELF-DROP such a pool (the
  // thrown error is the graceful-drop signal the SvmRoute orchestrator catches).
  // The LEGACY path is byte-identical: a Tokenkeg-owned mint classifies as
  // Tokenkeg, parses no extensions, and the config is built unchanged.
  const mintList = [baseMint, quoteMint];
  const mintAccounts = await Promise.all(mintList.map((mint) => owned(mint)));
  for (let mi = 0; mi < mintList.length; mi++) {
    const mint = mintList[mi]!;
    const account = mintAccounts[mi];
    if (account === null) continue; // an unreadable mint falls back to the legacy assumption
    const mintData = account.data;
    if (classifyMintProgram(mint, mintData, account.owner) === TOKEN_2022_PROGRAM_ID) {
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
    direction: "baseIn",
    baseMint,
    quoteMint,
    baseVault: decodeAddress(data, OFF_BASE_VAULT),
    quoteVault: decodeAddress(data, OFF_QUOTE_VAULT),
    baseDecimals: Number(readUintLE(data, OFF_BASE_DECIMALS, 4)),
    quoteDecimals: Number(readUintLE(data, OFF_QUOTE_DECIMALS, 4)),
    feeInBps: readUintLE(data, OFF_FEE_IN_BPS, 4),
  };
}

/** The Gavel venue: Ellipsis Labs' sandwich-resistant constant-product AMM. */
export const gavel = {
  slug: SLUG,
  programId: GAVEL_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchGavelConfig,
};
