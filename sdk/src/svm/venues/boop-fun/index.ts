/**
 * Boop.fun bonding curve (program `boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4`) — an Anchor
 * launchpad curve, structurally the same FAMILY as the pump.fun bonding curve (already wired as
 * `pumpfun-bonding-curve`): virtual+real SOL reserves against a real, depleting token reserve,
 * a flat swap fee, `buy_token`/`sell_token` CPIs. A DIFFERENT program, DIFFERENT account layout,
 * DIFFERENT (simpler, single-tier) fee model — its own family.
 *
 * GROUND TRUTH: the on-chain Anchor IDL (pulled from the program's own IDL account via the
 * standard `createAddressWithSeed(findProgramAddress([], program).0, "anchor:idl", program)`
 * derivation — 13,008 raw bytes / 7,288 zlib-compressed, 68,033 decompressed) gives every
 * discriminator, PDA seed and account order below EXACTLY (no guessing): `BondingCurve` disc
 * `17b7f83760d8ac60`, `buy_token` disc `8a7f0e5b26577369` (args `buy_amount:u64,
 * amount_out_min:u64`), `sell_token` disc `6d3d28bbe6b087ae` (args `sell_amount:u64,
 * amount_out_min:u64`), `Config` disc `9b0caae01efacc82`. Every PDA seed (`bonding_curve`,
 * `bonding_curve_vault`, `bonding_curve_sol_vault`, `trading_fees_vault`, `config`,
 * `vault_authority`) is the program's own declared seed list, not reverse-engineered.
 *
 * BONDING-CURVE ACCOUNT (`BondingCurve`, 125 fixed bytes — matches the IDL's field list
 * exactly, confirmed against real fetched pool accounts):
 *   creator pubkey @8   mint pubkey @40   virtual_sol_reserves u64 @72
 *   virtual_token_reserves u64 @80 (DEPRECATED, see damping_term below — never read)
 *   graduation_target u64 @88   graduation_fee u64 @96
 *   sol_reserves u64 @104   token_reserves u64 @112
 *   damping_term u8 @120   swap_fee_basis_points u8 @121
 *   token_for_stakers_basis_points u16 @122 (a later distribution split, irrelevant to the
 *   trader's own realized amount — never read)   status (BondingCurveStatus enum, u8) @124
 * UNLIKE the already-wired pump.fun bonding curve, the mint IS embedded (@40) — no PDA-hint
 * plumbing is needed for `fetchPoolConfig` itself; only DISCOVERY (finding a candidate pool
 * address for a requested mint pair) needs the forward PDA derivation, because the account has no
 * second stored mint to memcmp against (the quote side is always native SOL) — see
 * `withBoopFunDiscovery` in the recipes repo's `the consuming app SVM discovery module`.
 *
 * TWO CURVE FORMULAS SHARE ONE ACCOUNT SHAPE — `damping_term` SELECTS WHICH (the IDL's own doc
 * comment on `virtual_token_reserves`: "virtual token reserves is deprecated, we now use the xyk
 * formula instead and it only requires virtual sol reserves ... to maintain backwards
 * compatibility, if damping term is 30, we use the old formula"). MEASURED live (5 real
 * `simulateTransaction`/on-chain-log validations below, `damping_term=31` throughout — the
 * CURRENT `Config` default, confirmed by reading `Config` directly): the CURRENT formula is a
 * plain constant-product AMM with the SOL side carrying a static virtual offset and the token
 * side using the REAL depleting reserve directly, no virtual buffer:
 *   x = virtual_sol_reserves + sol_reserves     (virtual_sol_reserves is a DEPLOY-TIME CONSTANT —
 *       confirmed unchanged across multiple real trades on the same curve; it is NOT updated
 *       per-trade the way pump.fun's own virtual reserves are)
 *   y = token_reserves                          (real, depletes on every BUY)
 *   BUY  (quoteToBase, buy_token):  fee = floor(buyAmount * feeBps / 10000); net = buyAmount - fee;
 *        tokensOut = floor(y * net / (x + net))
 *   SELL (baseToQuote, sell_token): gross = floor(x * tokensIn / (y + tokensIn));
 *        fee = floor(gross * feeBps / 10000); solOut = gross - fee
 * `damping_term == 30` (LEGACY, pre-migration curves) uses a MEASURABLY DIFFERENT formula — real
 * `damping_term=30` trades diverge from the formula above by ~0.2-0.3% of output, a REAL
 * difference, not rounding noise (measured against 7 real historical trades). This module does
 * NOT model the legacy formula and REJECTS any `damping_term == 30` pool with a named gate error
 * — a real, disclosed narrowing (see the pump.fun bonding curve's own mayhem/cashback scope note
 * for the same shape of decision), not a refusal: every currently-deployable curve (`Config`'s own
 * default is 31) is served.
 *
 * VALIDATION (`test/svm/venues/boop-fun.test.ts`, recipes repo, pins these as golden values) —
 * REAL evidence at THREE-PLUS sizes, both directions, against the ACTUAL deployed program on REAL
 * mainnet state:
 *   - 2 REAL historical settled trades decoded from the program's own `TokenBoughtEvent` self-CPI
 *     log (disc `4759de7cd7c0e68a`): pool `8uwipGAmbqzLFt6hky77C9YWEJzycLf9vgceEJyN1M7e` (mint
 *     `KiHEYcvu2tSyVo4Ts9WwddcrhtqH1D8GACja1hVboop`), buyAmount 987,032 -> amountOut 33,197,204,730,517
 *     (net fee 9,970) and, immediately after (same curve, updated reserves), buyAmount 1,047,302 ->
 *     amountOut 35,221,877,455,153 (fee 10,578) — both reproduce EXACT or within 1 raw unit (a
 *     genuine ~1e-13-relative on-chain rounding quirk that ALWAYS rounds in the trader's favor by
 *     one raw token unit — this module's floor formula is the conservative, safe-direction bound).
 *   - 1 REAL historical settled SELL decoded from the program's own `TokenSoldEvent` self-CPI log
 *     (disc `ccefb64df1334d42`): pool `EXK9CcBLz2zn9QViPPCSGf9kJpPKvh33o7EGngeDuXXX` (mint
 *     `EoFuCULaVELP5uESnvNJr3pkbyiVsd1qHGg7cViboop`), tokensIn 331,765,048,721,254 -> solOut
 *     9,768,440 (fee 98,671), reproduced BIT-EXACT.
 *   - 3 CONTROLLED `simulateTransaction` calls (`sigVerify:false`, impersonating the protocol's own
 *     fee-recipient wallet `8QwU16Xe4BPyUD9MktHtgVjQQ5fAwywb9Zd5Hg1YTauF`, which genuinely holds
 *     ~2,908 SOL on mainnet — no fabricated state) against the SAME REAL pool at THREE SIZES
 *     spanning 3 orders of magnitude — 0.01 SOL (10,000,000 lamports, EXACT), 1 SOL (1,000,000,000
 *     lamports, within 1 raw unit) and 5 SOL (5,000,000,000 lamports, within 1 raw unit) — every
 *     one reproducing the program's own `TokenBoughtEvent` log.
 *   - 1 CHAINED buy-then-sell simulation (2 SOL in, then sell every resulting token straight back
 *     in the SAME transaction): the realized `TokenSoldEvent.amountOut` (1,960,200,000 lamports)
 *     matches this module's predicted SELL net EXACTLY, even though the intermediate `gross`
 *     figure is 1 raw unit off (the same on-chain rounding quirk noted above, which cancels out
 *     through the fee floor here).
 *
 * CPI SHAPE (from the same on-chain IDL — 13 accounts for `buy_token`, 12 for `sell_token`, in
 * this EXACT order; Anchor CPI account order is load-bearing):
 *   buy_token:  mint, bonding_curve(w), trading_fees_vault(w), bonding_curve_vault(w),
 *     bonding_curve_sol_vault(w), recipient_token_account(w), buyer(w,signer), config,
 *     vault_authority, wsol, system_program, token_program, associated_token_program
 *   sell_token: mint, bonding_curve(w), trading_fees_vault(w), bonding_curve_vault(w),
 *     bonding_curve_sol_vault(w), seller_token_account(w), seller(w,signer), recipient(w),
 *     config, system_program, token_program, associated_token_program
 *
 * `bonding_curve_sol_vault` is a PLAIN SYSTEM ACCOUNT (owner = System Program, zero data —
 * confirmed live) holding NATIVE LAMPORTS, not a wSOL token account; `trading_fees_vault` IS a
 * real SPL token account (owner = Token Program, mint = wSOL — confirmed live via a real
 * `syncNative` inner instruction). NEITHER `buy_token` nor `sell_token` reads a buyer/seller-side
 * wSOL account at all: a REAL mainnet transaction shows the program pulling the trade's SOL
 * DIRECTLY from the `buyer` signer's native lamport balance via a nested `system_program::transfer`
 * (there is no classic-vs-`_v2` split to route around here, unlike pump.fun's own bonding curve —
 * this program has exactly one buy/sell instruction pair and it is native-SOL-settled both ways).
 * CONSEQUENCE FOR A RECIPE'S SwapUser CONTRACT (real, disclosed, not a defect): a BUY's SOL leg is
 * sourced from `user.owner`'s OWN NATIVE LAMPORT BALANCE (never `user.inAta` — the account is
 * simply unused on the BUY side), and a SELL's SOL leg is credited directly to `user.owner`'s
 * native balance too (via `recipient`, never `user.outAta`). The TOKEN side of both directions
 * uses the normal `inAta`/`outAta` SPL contract. `config`/`vault_authority` are fixed, deploy-time
 * PDAs (`["config"]` / `["vault_authority"]`, no per-pool seed) — hardcoded below, verified live.
 *
 * SCOPE (a real, disclosed narrowing): `damping_term == 30` legacy curves (above) and any
 * non-`Trading`-status curve (graduated / mid-migration — `buy_token`/`sell_token` would not
 * target the right venue anymore) both self-drop with a named gate error. `Config.is_paused`
 * (the protocol-wide circuit breaker, offset 8 in `Config`, right after its own 8-byte
 * discriminator — read BEFORE the variable-length `operators` vec, so no vec parsing is needed)
 * is checked and gates loudly too: since SVM execution-time CPI catch/re-route is a platform
 * impossibility (a launched CPI failure aborts the WHOLE cook, not just this slot), a paused
 * protocol MUST be caught at fetch/prepare time, not left to fail on-chain. Only classic (Tokenkeg,
 * 82-byte mint account) base mints are served — the CPI supplies exactly ONE `token_program`
 * account (no separate base/quote token-program slot the way `pumpswap` has), so a Token-2022
 * base mint has no correct program to route its own transfer through; such a mint is rejected with
 * a named gate error rather than silently mis-targeted.
 */
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountBytesMap, AccountLoader, PoolConfig, SwapUser, VenueAccount } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'boop-fun' as const;

export const BOOP_FUN_PROGRAM_ID = address_('boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4');
const WSOL = address_('So11111111111111111111111111111111111111112');
const SYSTEM_PROGRAM = address_('11111111111111111111111111111111');
const TOKEN_PROGRAM = address_('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = address_('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
/** PDA(["config"], PROGRAM) — fixed, deploy-time, verified live. */
const CONFIG = address_('AbgFqRWjGWgUaVrZrLLWU5HDY5dktmAL6zT9aacQW7y1');
/** PDA(["vault_authority"], PROGRAM) — fixed, deploy-time, verified live. */
const VAULT_AUTHORITY = address_('GVVUi6DaocSEAp8ATnXFAPNF5irCWjCvmPCzoaGAf5eJ');

const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const CONFIG_DISCRIMINATOR = [155, 12, 170, 224, 30, 250, 204, 130];
const BUY_TOKEN_DISCRIMINATOR = [138, 127, 14, 91, 38, 87, 115, 105];
const SELL_TOKEN_DISCRIMINATOR = [109, 61, 40, 187, 230, 176, 135, 174];

/** Legacy pre-migration formula sentinel — out of scope, see the module header. */
const LEGACY_DAMPING_TERM = 30;
/** BondingCurveStatus::Trading — the only status this module serves. */
const STATUS_TRADING = 0;
const BPS = 10_000n;

function address_(s: string): Address {
  return s as unknown as Address;
}
function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}
function pubkeyAt(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
async function pda(seeds: (Uint8Array | Address)[], programAddress: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const rawSeeds = seeds.map((s) => (typeof s === 'string' ? new Uint8Array(encoder.encode(s as Address)) : s));
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds: rawSeeds });
  return derived;
}
const SEED = (s: string): Uint8Array => new TextEncoder().encode(s);

async function loadAccount(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`boop-fun ${what} ${addr} not found`);
  return data;
}

export interface BoopFunPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** exactIn side: 'quoteToBase' (default, buy_token) | 'baseToQuote' (sell_token). */
  direction: 'quoteToBase' | 'baseToQuote';
  mint: Address;
  /** Static per-curve constant (deploy-time, never mutated per trade — see module header). */
  virtualSolReserves: bigint;
  swapFeeBasisPoints: bigint;
  bondingCurveVault: Address;
  bondingCurveSolVault: Address;
  tradingFeesVault: Address;
}

function asCfg(cfg: PoolConfig): BoopFunPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config for pool ${cfg.pool}`);
  return cfg as BoopFunPoolConfig;
}

export const boopFun = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: BOOP_FUN_PROGRAM_ID,
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<BoopFunPoolConfig> {
    const bcData = await loadAccount(load, pool, 'bonding curve');
    if (!hasDiscriminator(bcData, BONDING_CURVE_DISCRIMINATOR)) {
      throw new Error(`boop-fun pool ${pool} discriminator mismatch (not a BondingCurve account)`);
    }
    if (bcData.length < 125) {
      throw new Error(`boop-fun pool ${pool} data is ${bcData.length} bytes, expected at least 125`);
    }
    const mint = pubkeyAt(bcData, 40);

    // Integrity check (defense in depth beyond the generic owner-verify every caller already
    // performs): the pool account must be its OWN mint's canonical PDA, not merely SOME
    // program-owned BondingCurve-shaped account handed to us by a bad discovery hint.
    const expectedPool = await pda([SEED('bonding_curve'), mint], BOOP_FUN_PROGRAM_ID);
    if (expectedPool !== pool) {
      throw new Error(`boop-fun pool ${pool} does not derive from its own embedded mint ${mint} (expected bonding-curve PDA ${expectedPool})`);
    }

    const dampingTerm = bcData[120]!;
    if (dampingTerm === LEGACY_DAMPING_TERM) {
      throw new Error(`boop-fun pool ${pool} gate: damping_term is ${LEGACY_DAMPING_TERM} (the legacy pre-migration curve formula — unsupported, see the module header)`);
    }
    const status = bcData[124]!;
    if (status !== STATUS_TRADING) {
      throw new Error(`boop-fun pool ${pool} gate: status is ${status}, not Trading (${STATUS_TRADING}) — curve has graduated or is mid-migration`);
    }

    const virtualSolReserves = readUintLE(bcData, 72, 8);
    const swapFeeBasisPoints = BigInt(bcData[121]!);

    const [mintData, configData, bondingCurveVault, bondingCurveSolVault, tradingFeesVault] = await Promise.all([
      loadAccount(load, mint, 'base mint'),
      loadAccount(load, CONFIG, 'config'),
      pda([SEED('bonding_curve_vault'), mint], BOOP_FUN_PROGRAM_ID),
      pda([SEED('bonding_curve_sol_vault'), mint], BOOP_FUN_PROGRAM_ID),
      pda([SEED('trading_fees_vault'), mint], BOOP_FUN_PROGRAM_ID),
    ]);
    // The CPI supplies exactly ONE token_program account (no separate base/quote
    // token-program slot), so the base mint's swap is legacy-SPL only: a
    // Token-2022 base mint (or one carrying an un-routable extension) SELF-DROPS
    // this pool. The thrown error is the graceful-drop signal the SvmRoute
    // orchestrator catches. A classic 82-byte mint classifies legacy → no throw →
    // config built byte-identically to before.
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`boop-fun: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`boop-fun: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
    if (!hasDiscriminator(configData, CONFIG_DISCRIMINATOR)) {
      throw new Error(`boop-fun config ${CONFIG} discriminator mismatch`);
    }
    // is_paused @ offset 8 (right after the 8-byte disc) — the FIRST field, so no need to parse
    // the variable-length `operators` vec that follows it.
    const isPaused = configData[8] !== 0;
    if (isPaused) {
      throw new Error(`boop-fun pool ${pool} gate: protocol Config.is_paused is set`);
    }

    return {
      venue: SLUG,
      pool,
      direction: 'quoteToBase',
      mint,
      virtualSolReserves,
      swapFeeBasisPoints,
      bondingCurveVault,
      bondingCurveSolVault,
      tradingFeesVault,
    };
  },
};

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

