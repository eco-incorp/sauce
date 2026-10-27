/**
 * Aldrin AMM — two sibling Anchor programs off the classic spl-token-swap-
 * style constant-product curve (input-side trade fee + owner fee, both
 * floored with the standard "min 1 raw unit if the numerator is nonzero"
 * rule, then a ceiling-divided constant-product quote). SLUG `aldrin` = V1
 * (program `AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6`, CP-only — the
 * on-chain account carries no curve-selector field at all). SLUG
 * `aldrin-v2` = V2 (program `CURVGoZn8zycx6FXwwevgBTB2gVvdbGTEpvMJDbgs2t4`),
 * whose pool account additionally carries a `curveType` byte (0 = the same
 * constant product, 1 = a StableSwap curve driven by an external `curve`
 * account) — measured live 2026-07-31 via `getProgramAccounts` filtered to
 * the 474-byte pool layout: 301 of 304 live pools are curveType 0, 3 are
 * curveType 1. This adapter implements CP for both programs and
 * SELF-DROPS a curveType-1 V2 pool (fetchPoolConfig throws a named error,
 * which the recipe's per-pool discovery gate turns into a drop, exactly
 * like every other family's out-of-scope gate) rather than approximating
 * the StableSwap curve with CP math.
 *
 * LAYOUT — not reverse-engineered, lifted from the published
 * `@aldrin_exchange/sdk` npm package (`pools/layout.ts`'s
 * `POOL_LAYOUT`/`POOL_V2_LAYOUT`, borsh via `@solana/buffer-layout`). Both
 * are Anchor accounts: the leading 8 bytes are
 * `sha256("account:Pool")[0..8]` = `f19a6d0411b16dbc` — byte-identical to
 * this repo's own `pumpswap` adapter's "Pool" discriminator (an Anchor
 * account discriminator is a function of the struct NAME alone, not the
 * program, so two unrelated programs both naming their pool struct "Pool"
 * collide on purpose). V1 span 441 bytes (21 live pools, ALL
 * discriminator-valid). V2 span 474 bytes (304 live pools at the dataSize
 * filter; 26 of those are all-zero/closed accounts that still match the
 * size — `fetchPoolConfig` gates on the discriminator byte-for-byte, not
 * merely on account length, so a closed pool self-drops instead of
 * decoding garbage).
 *
 * QUOTE MATH — ground-truthed against SIX REAL SETTLED MAINNET SWAPS (three
 * on a V1 pool, three on a V2 curveType=0 pool), not derived from the
 * published SDK's own client-side estimate (which is NOT usable ground
 * truth: `tokenSwap.ts`'s `resolveSwapInputs` applies NO fee at all to its
 * `CURVE.PRODUCT` estimate, and stubs `CURVE.STABLE` as
 * `minIncomeAmount = outcomeAmount` — not a real quote either way). Each of
 * the six was read via `getTransaction`'s `preTokenBalances`/
 * `postTokenBalances` at the pool's own two vault accounts (the vault
 * delta, not the trader's external float account, which in every sampled
 * tx was shared across other unrelated instructions in the same
 * searcher-bundled transaction and carried a few raw units of unrelated
 * noise): given the pool's pre-swap reserves and its own stored fee
 * fractions, the formula below reproduced the realized output EXACTLY in
 * all six cases, at sizes from ~5.35M to ~63.4M raw units. That formula is
 * BYTE-IDENTICAL to this repo's own `orca-legacy-token-swap` adapter's
 * `qOrca` — unsurprising, Aldrin's V1 program is a documented fork of the
 * same spl-token-swap lineage Orca's V2 program forked too.
 *
 * SWAP CPI — `SWAP_INSTRUCTION_LAYOUT` is
 * `[disc(8) global:swap][tokens u64 LE][minTokens u64 LE][side u8]`;
 * disc = `sha256("global:swap")[0..8]` = `f8c69e91e17587c8` (also lifted
 * from the SDK, confirmed byte-identical against the raw instruction data
 * of the same six validation transactions). `tokens` is the exact
 * specified INPUT regardless of side (all six real txs had a pool-vault
 * delta matching `tokens`, modulo the unrelated-instruction noise above).
 * `side` selects direction over a FIXED base/quote account order: Ask (1)
 * = base in / quote out (all six validation txs used this side), Bid (0) =
 * quote in / base out (the SDK's own `side: isInverted ? SIDE.ASK :
 * SIDE.BID` mapping in `tokenSwap.ts` — the reverse direction is untested
 * against a real transaction here, but the invariant is a symmetric CP
 * curve over a fixed account list with no other source of asymmetry, so
 * flipping which vault is read as the input reserve is the only change).
 * Venue-level min_out is always 1 — the recipe's post-swap outAta delta
 * check enforces the real bound, matching every other family.
 *
 * V1 swap accounts (10): pool, poolSigner, poolMint(w), baseVault(w),
 * quoteVault(w), feePoolTokenAccount(w), owner(signer),
 * userBaseTokenAccount(w), userQuoteTokenAccount(w), TOKEN_PROGRAM.
 * V2 (11) inserts `curve` (readonly, stored on the pool account — required
 * by the V2 program's account list even for a CP pool, though this adapter
 * never reads its contents). `poolSigner` is stored directly as a pubkey
 * FIELD on the pool account (unlike orca-legacy-token-swap's stored-bump
 * `create_program_address` dance) — no PDA derivation needed, the fetch
 * just reads it.
 *
 * CU — `CU_FAMILIES` in `../budget.ts` cites the measurement method (a
 * standalone LiteSVM real-binary-CPI harness against the same two real
 * mainnet pools this file's header validated, calibrated against this
 * repo's own pinned `orca-legacy-token-swap` baseline measured the same
 * way) rather than repeating it here.
 *
 * KNOWN, MEASURED, SAFE-DIRECTION QUIRK — the real program does not always
 * debit EXACTLY `tokens` from the user: a raw hand-built instruction (no
 * the consuming app engine involved) against the SAME V1 pool this file validates,
 * at seven sizes from 10M to 1B raw units, measured the ACTUAL debit
 * (verified equal to the vault's own credit — both sides agree) falling 0
 * to 12 raw units SHORT of the requested `tokens`, NEVER over, and
 * non-monotone in size (1_000_000_000 -> short 1; 100_000_000 -> short 12;
 * 123_456_789 -> short 0) — not a simple proportional rounding term this
 * adapter can reproduce bit-exactly without Aldrin's own source. It does
 * NOT affect the predicted output (a <=12-unit shift in netIn against
 * multi-billion-unit reserves cannot move the floored CP quote — confirmed:
 * the realized output matched the prediction exactly at every size tested)
 * and is economically identical to the ordinary "partial fill" case
 * SvmRoute already handles structurally on SVM (the un-entered input
 * simply never leaves the user's own `inAta` — there is no pot to
 * reconcile). `the consuming app realcpi e2e test`'s `aldrin`/
 * `aldrin-v2` cells assert this bound explicitly (`runQuad`'s `inputSlack`
 * parameter) rather than exact-debit equality, unlike every other family.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";

export const ALDRIN_V1_PROGRAM_ID = address("AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6");
export const ALDRIN_V2_PROGRAM_ID = address("CURVGoZn8zycx6FXwwevgBTB2gVvdbGTEpvMJDbgs2t4");
/** sha256("account:Pool")[0..8] — shared with this repo's pumpswap adapter; see module header. */
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
const POOL_V1_SIZE = 441;
const POOL_V2_SIZE = 474;
// Offsets into POOL_FIELDS_COMMON (identical prefix on both versions).
const OFF_POOL_MINT = 40;
const OFF_BASE_VAULT = 72;
const OFF_BASE_MINT = 104;
const OFF_QUOTE_VAULT = 136;
const OFF_QUOTE_MINT = 168;
const OFF_POOL_SIGNER = 200;
const OFF_FEE_POOL_TOKEN_ACCOUNT = 361;
const OFF_TRADE_FEE_NUMERATOR = 393;
const OFF_TRADE_FEE_DENOMINATOR = 401;
const OFF_OWNER_FEE_NUMERATOR = 409;
const OFF_OWNER_FEE_DENOMINATOR = 417;
// V2-only trailer.
const OFF_CURVE_TYPE = 441;
const OFF_CURVE = 442;
const CURVE_TYPE_PRODUCT = 0;

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= discriminator.length && discriminator.every((byte, i) => data[i] === byte);
}

export type AldrinDirection = "baseToQuote" | "quoteToBase";

export interface AldrinPoolConfig extends PoolConfig {
  venue: "aldrin" | "aldrin-v2";
  version: 1 | 2;
  poolMint: Address;
  baseTokenVault: Address;
  baseTokenMint: Address;
  quoteTokenVault: Address;
  quoteTokenMint: Address;
  poolSigner: Address;
  feePoolTokenAccount: Address;
  tradeFeeNumerator: bigint;
  tradeFeeDenominator: bigint;
  ownerTradeFeeNumerator: bigint;
  ownerTradeFeeDenominator: bigint;
  /** V2 only — the external curve account the swap ix attaches (CP pools never read from it). */
  curve?: Address;
  direction: AldrinDirection;
}

async function fetchAldrinPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
  version: 1 | 2,
): Promise<AldrinPoolConfig> {
  const load = accountDataLoader(owned);
  const slug = version === 1 ? "aldrin" : "aldrin-v2";
  const data = await load(pool);
  if (data === null) throw new Error(`${slug} pool ${pool} account not found`);
  const expectedSize = version === 1 ? POOL_V1_SIZE : POOL_V2_SIZE;
  if (data.length !== expectedSize) {
    throw new Error(`${slug} pool ${pool} data must be ${expectedSize} bytes, got ${data.length}`);
  }
  if (!hasDiscriminator(data, POOL_DISCRIMINATOR)) {
    throw new Error(
      `${slug} pool ${pool} is not an initialized Aldrin Pool account (bad Anchor discriminator)`,
    );
  }
  if (version === 2) {
    const curveType = data[OFF_CURVE_TYPE];
    if (curveType !== CURVE_TYPE_PRODUCT) {
      throw new Error(
        `${slug} pool ${pool} curveType must be ${CURVE_TYPE_PRODUCT} (constant product), got ${curveType} — StableSwap curves are not implemented by this adapter`,
      );
    }
  }

  const decoder = getAddressDecoder();
  const pubkeyAt = (offset: number): Address => decoder.decode(data.subarray(offset, offset + 32));
  const u64 = (offset: number): bigint => readUintLE(data, offset, 8);

  const tradeFeeNumerator = u64(OFF_TRADE_FEE_NUMERATOR);
  const tradeFeeDenominator = u64(OFF_TRADE_FEE_DENOMINATOR);
  const ownerTradeFeeNumerator = u64(OFF_OWNER_FEE_NUMERATOR);
  const ownerTradeFeeDenominator = u64(OFF_OWNER_FEE_DENOMINATOR);
  for (const [name, numerator, denominator] of [
    ["trade", tradeFeeNumerator, tradeFeeDenominator],
    ["owner trade", ownerTradeFeeNumerator, ownerTradeFeeDenominator],
  ] as const) {
    if (numerator !== 0n && denominator === 0n) {
      throw new Error(
        `${slug} pool ${pool} ${name} fee denominator is 0 with nonzero numerator ${numerator}`,
      );
    }
  }

  return {
    venue: slug,
    pool,
    version,
    poolMint: pubkeyAt(OFF_POOL_MINT),
    baseTokenVault: pubkeyAt(OFF_BASE_VAULT),
    baseTokenMint: pubkeyAt(OFF_BASE_MINT),
    quoteTokenVault: pubkeyAt(OFF_QUOTE_VAULT),
    quoteTokenMint: pubkeyAt(OFF_QUOTE_MINT),
    poolSigner: pubkeyAt(OFF_POOL_SIGNER),
    feePoolTokenAccount: pubkeyAt(OFF_FEE_POOL_TOKEN_ACCOUNT),
    tradeFeeNumerator,
    tradeFeeDenominator,
    ownerTradeFeeNumerator,
    ownerTradeFeeDenominator,
    curve: version === 2 ? pubkeyAt(OFF_CURVE) : undefined,
    direction: "baseToQuote",
  };
}

export const aldrin = {
  slug: "aldrin" as const,
  programId: ALDRIN_V1_PROGRAM_ID,
  fetchPoolConfig: (owned: OwnedAccountLoader, pool: Address): Promise<AldrinPoolConfig> =>
    fetchAldrinPoolConfig(owned, pool, 1),
};

export const aldrinV2 = {
  slug: "aldrin-v2" as const,
  programId: ALDRIN_V2_PROGRAM_ID,
  fetchPoolConfig: (owned: OwnedAccountLoader, pool: Address): Promise<AldrinPoolConfig> =>
    fetchAldrinPoolConfig(owned, pool, 2),
};
