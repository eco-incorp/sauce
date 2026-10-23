/**
 * Trends (label `"Trends"` in Jupiter's `program-id-to-label` map,
 * `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`) — a
 * pump.fun-style bonding-curve launchpad. Anchor program id
 * `CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz`, on-chain IDL name
 * `bonding_curve`. Every field offset, every formula, and every fee constant
 * below was derived from LIVE mainnet reads — zero guesswork, zero vendored
 * docs — as follows (fully reproducible: public RPC, no API key):
 *
 * 1. **The IDL itself is on-chain.** Anchor programs store their IDL at the
 *    deterministic `create_with_seed(find_program_address([], programId).0,
 *    "anchor:idl", programId)` address — for this program that resolves to
 *    `A66SjFD23xu9WSUp9kn4nPohwyejWfutmrrTLjfowBSs`, a 3,170-byte `IdlAccount`
 *    (matches the brief's byte count exactly) whose payload is a zlib-deflated
 *    JSON IDL. Decoding it (disc(8) + authority(32) + data_len(u32) +
 *    zlib-inflate) gives the EXACT `Pool`/`Config` account layouts, every
 *    instruction's accounts/args/discriminators, and the full error table —
 *    below, not reverse-engineered from bytes.
 * 2. **Pool account** (`bytemuck`, `repr(C)`, 312 bytes total incl. the
 *    8-byte Anchor discriminator `f19a6d0411b16dbc`): `creator` pubkey@8,
 *    `base_mint`@40, `base_vault`@72, `quote_vault`@104, `base_reserve`
 *    u64@136, `quote_reserve` u64@144, `virtual_base_reserve` u64@152,
 *    `virtual_quote_reserve` u64@160, `creator_fee` u64@168 (cumulative
 *    UNCLAIMED creator fee, still sitting in quote_vault — NOT part of the
 *    tradeable reserve), `protocol_fee` u64@176 (same, protocol's cut),
 *    `is_migrated` u8@184 (0/1). Confirmed field-for-field against 1,737 real
 *    pool accounts (`getProgramAccounts` filtered on `dataSize:312`) — every
 *    `base_mint` decodes to a real mint ending in the vanity suffix `TRND`,
 *    every `base_vault`/`quote_vault` decodes to real SPL/Token-2022 accounts
 *    matching `base_mint`/wSOL.
 * 3. **`quote_mint` is a hardcoded Anchor `address` constraint
 *    (`So11111111111111111111111111111111111111112`), not a stored field** —
 *    every Trends pool quotes against wSOL exclusively (confirmed via the
 *    `swap` instruction's IDL account list AND every sampled live transaction).
 *    So the pool account carries only ONE mint (`base_mint`@40) — there is no
 *    `mintBOffset` to filter on in `SVM_FAMILY_FILTERS`; see
 *    `discovery.ts`'s `SvmFamilyFilter.fixedMintB`, added for exactly this
 *    shape.
 * 4. **The curve: constant product over (real + virtual) reserves,
 *    pump.fun-style.** `virtual_base_reserve`/`virtual_quote_reserve` ARE the
 *    live pricing reserves (read directly, no derivation needed); the
 *    invariant `virtual_base_reserve · virtual_quote_reserve = k` holds
 *    per-trade (verified: a real SELL's `new_vbr = vbr_pre + amount_in`
 *    EXACTLY, decoded from the program's own `emit_cpi!` `SwapEvent` self-CPI
 *    log — see point 5). `virtual_X_reserve − X_reserve` (X = base or quote)
 *    is a per-pool CONSTANT set at creation (observed both 0 (base) / 20 SOL
 *    (quote) and 73,000,000 tokens (base) / 30 SOL (quote) "tiers" live on
 *    mainnet, confirmed constant across a pool's full trade history by
 *    replaying its transactions) — this module never bakes a tier constant,
 *    it re-derives the live offset every quote from
 *    `virtual_X_reserve − X_reserve`, so any tier (or a value the program
 *    adds later) is handled identically.
 * 5. **The fee model and the exact-match validation.** The `swap` instruction
 *    (Anchor discriminator `sha256('global:swap')[0..8]` = `[248, 198, 158,
 *    145, 225, 117, 135, 200]`) emits a self-CPI `SwapEvent`
 *    (`emit_cpi!`, outer discriminator `e445a52e51cb9a1d` + event discriminator
 *    `40c6cde8260871e2`, both from the on-chain IDL) carrying
 *    `{amount_in, actual_amount_in, actual_amount_out, creator_fee,
 *    protocol_fee, referral_fee, base_reserve, quote_reserve,
 *    virtual_base_reserve, virtual_quote_reserve}` — ALL post-trade. Decoding
 *    this event from real mainnet transactions (`getTransaction`,
 *    `innerInstructions`) and reconciling against the transaction's own
 *    `pre/postTokenBalances` gave every number in this file, bit-exact:
 *      - SELL (`base_reserve`/`quote_reserve` untouched by fee-accrual
 *        confusion once cross-checked: `vault balance = quote_reserve +
 *        creator_fee(cumulative) + protocol_fee(cumulative)`, confirmed
 *        exactly on a real trade: 2,365,303,595 = 2,248,318,259 + 23,867,048
 *        + 93,118,288): `grossOut = floor(vqr·amountIn / (vbr+amountIn))`
 *        (a real 9,019,958,233,576-token sell, sig `3KUgMY5k…`, matched
 *        `gross=294,062,703` exactly against the event's
 *        `actualOut+creatorFee+protocolFee+referralFee`); `fee =
 *        floor(gross·200/10000)` (exactly 2.00000...% on every sampled
 *        trade, `creator_fee` alone is ALWAYS `floor(gross·100/10000)`
 *        exact across every one of 7 sampled real sells); `actualOut =
 *        gross − fee`.
 *      - BUY (sig `4btBYQ4w…`, a clean 150,000,000-lamport buy on a virgin
 *        pool, `base_reserve` pre = 1e15 exactly, `quote_reserve` pre = 0):
 *        `fee = floor(amountIn·200/10000)` (exactly 3,000,000 = 2% of
 *        150,000,000), `effIn = amountIn − fee` (147,000,000, matches the
 *        event's `actual_amount_in` exactly), `actualOut =
 *        floor(vbr·effIn/(vqr+effIn))` (matched the event's
 *        `actual_amount_out` = 5,232,062,891,830 to the last atom).
 *      - `referral_fee` (an optional kickback account, `Option<Account>`
 *        Anchor-encoded — absent ⇒ the caller passes the PROGRAM'S OWN id as
 *        the sentinel, confirmed via a real no-referral tx's account list)
 *        is 0 whenever this module's `buildSwapV2` runs (it never supplies a
 *        referral account) — the creator/protocol split of the remaining fee
 *        is then an exact 50/50 (`creator_fee === protocol_fee` on every
 *        sampled no-referral trade), irrelevant to this module either way:
 *        only the TOTAL 2% (creator+protocol+referral) leaves the tradeable
 *        reserve, and `min_amount_out=1` (like every ladder here) defers the
 *        real floor to the recipe's own terminal outAta delta check.
 *      - **This module's SELL fee is `floor(gross·200/10000)` applied ONCE**
 *        (not creator/protocol each floored independently, which is what the
 *        real program does) — measured across 8 independent real sell
 *        transactions, this is a SAFE LOWER BOUND on the real output: the
 *        real total fee is NEVER larger than this module's single floor, so
 *        the predicted `actualOut` is either bit-exact (7 of 8 sampled) or
 *        exactly 1 raw atomic unit BELOW the real realized output (1 of 8,
 *        `test/svm/venues/trends.test.ts`'s dAVAhNb2… case) — never above.
 *        BUY has no such gap: the input-side fee is a single floor on both
 *        sides, matched bit-exact on every sampled example.
 * 6. **Real-reserve capacity clamp (SATURATING, not collapsing).** The curve
 *    alone would happily promise up to `virtual_X_reserve` of output even
 *    when the REAL `base_reserve`/`quote_reserve` (what the vault can
 *    actually pay out) is far smaller — exactly the failure class the
 *    obric-v2/meteora-damm-v2/orca-legacy-token-swap headers warn against
 *    ("a model MORE favourable than the venue's own math… wins elections").
 *    Since `virtual_X = X + offset` with a per-pool CONSTANT `offset` (point
 *    4), the largest deliverable gross input has a closed form:
 *      - SELL: `grossOut <= quote_reserve` ⟺ `amountIn <= quote_reserve ·
 *        virtual_base_reserve / quoteOffset` (quoteOffset = vqr−qr; 0 ⇒
 *        uncapped — the curve's own asymptote already respects the real
 *        reserve when offset is 0, since then vqr==qr exactly).
 *      - BUY: fee is charged on the INPUT, so the real constraint is on
 *        EFFECTIVE input (`effIn <= base_reserve · virtual_quote_reserve /
 *        baseOffset`); converting that to a GROSS-input cap (the unit
 *        `capacityInputVar` must report) needs inverting `effIn(x) = x −
 *        floor(x·200/10000)`. Exploiting `floor(x/50)` structure:
 *        `grossCap = effCap + floor(effCap/49)` is the EXACT (brute-force
 *        verified, 0 to 20,000 and spot-checked well beyond) largest `x`
 *        with `effIn(x) <= effCap` — no bounded search loop needed on-chain.
 * 7. **`is_migrated`** (offset 184) is the loud, unambiguous gate — a
 *    migrated pool no longer trades on the curve at all (see the IDL's
 *    `AlreadyMigrated`/`PoolCompleted` errors); this module rejects it in
 *    `fetchPoolConfig`. There is a SEPARATE reserve-threshold "pool
 *    completed, not yet migrated" state (`PoolCompleted`, error 6007) this
 *    module does NOT gate on — no threshold constant is exposed anywhere
 *    on-chain (not in `Pool`, not in the all-zero-padding `Config`), so it is
 *    presumably a hardcoded program constant; a pool in that narrow window
 *    would self-drop the SAME way any other live-state race does (the
 *    recipe's minOut floor + the merge's per-cook fresh-state read), not a
 *    gate this adapter can add without guessing a number.
 * 8. **Base mint is Token-2022 in the wild** (every sampled pool):
 *    `detectBaseTokenProgram` mirrors pumpswap's mint-length/TLV-scan
 *    convention (82 bytes ⇒ classic Tokenkeg; else scan Token-2022 TLV
 *    extensions, REJECTING a `TransferFeeConfig` extension — vault deltas
 *    would silently diverge from the quoted amount). `quote_token_program`
 *    is always classic Tokenkeg (wSOL is a classic mint).
 * 9. **`config` (seeds `["config"]`) / `pool_authority` (a hardcoded Anchor
 *    `address` constraint) / `event_authority` (seeds `["__event_authority"]`)
 *    are GLOBAL constants, not per-pool** — confirmed identical across two
 *    unrelated pools' real swap transactions — so this module hardcodes them
 *    (like pumpswap hardcodes its own global PDAs) rather than re-deriving a
 *    PDA on every `fetchPoolConfig`.
 *
 * No absolute floor/depth surprises for a virgin pool: `depthReserves` uses
 * the VIRTUAL reserves (always substantial — 1e15/20-30e9 raw at genesis),
 * not the real ones, because a brand-new pool's real `quote_reserve` is
 * genuinely 0 (nobody has sold into it yet) which would zero BOTH
 * directions' `isqrt(reserveIn·reserveOut)` depth if real reserves were used
 * — incorrectly filtering out a pool that is, in fact, immediately buyable.
 * The real-reserve capacity clamp above (point 6) is what actually protects
 * against over-promising; depth is purely the coarse liveness/significance
 * signal the relative-depth survivor gate uses.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig } from "../types.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "trends";
export const TRENDS_PROGRAM_ID = address("CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz");
export const WSOL_MINT = address("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/** Global `config` PDA (seeds `["config"]`) — same account for every pool (verified live). */
export const TRENDS_CONFIG_PDA = address("BMejsRsPsaMypBsexufEmEGh8vjxfp2CMVHZE2PTTetj");
/** Global `pool_authority` — a hardcoded Anchor `address` constraint, identical for every pool. */
export const TRENDS_POOL_AUTHORITY = address("C6B7knNSF8X8YfW54D8jQvM3VUCifsphHEQZSCyAERoE");
/** Global `event_authority` PDA (seeds `["__event_authority"]`) — same for every pool. */
export const TRENDS_EVENT_AUTHORITY = address("87jkvJSERNjGmzftppK4Kt4Trv6tDh25K66aatP9esXQ");

export const POOL_ACCOUNT_SIZE = 312;
/** sha256('account:Pool')[0..8] (the `bonding_curve` Pool account — see module header point 2). */
export const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
const OFF_BASE_MINT = 40;
const OFF_BASE_VAULT = 72;
const OFF_QUOTE_VAULT = 104;
const OFF_IS_MIGRATED = 184;

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}

/**
 * Mirrors pumpswap's `detectTokenProgram` convention: a classic Tokenkeg mint
 * is always exactly 82 bytes; anything longer is Token-2022, whose TLV
 * extension tail (starting at byte 166) is scanned for a `TransferFeeConfig`
 * extension (type 1) — REJECTED, since a transfer fee would make vault
 * deltas diverge from the quoted/user amount.
 */
function detectBaseTokenProgram(mint: Address, data: Uint8Array): Address {
  if (data.length === 82) return TOKEN_PROGRAM;
  if (data.length < 166) {
    throw new Error(
      `${SLUG}: base mint ${mint} data is ${data.length} bytes, not a recognizable mint layout`,
    );
  }
  if (data[165] !== 1) {
    throw new Error(
      `${SLUG}: base mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`,
    );
  }
  // A NonTransferable / DefaultAccountState=frozen base mint genuinely cannot
  // route — self-drop it. PermanentDelegate/Confidential are advisories (a
  // routable T22 mint keeps routing), never blocking.
  const { blocking } = parseMintExtensions(data);
  if (blocking.length > 0) {
    throw new Error(`${SLUG}: gate: base mint ${mint} is un-routable: ${blocking.join("; ")}`);
  }
  let offset = 166;
  while (offset + 4 <= data.length) {
    const extensionType = data[offset]! | (data[offset + 1]! << 8);
    const extensionLength = data[offset + 2]! | (data[offset + 3]! << 8);
    if (extensionType === 0) break; // uninitialized tail
    if (extensionType === 1) {
      // TODO(t22-fee-netting): the base mint's transfer fee is REJECTED rather
      // than fee-netted. This is a WSOL-quoted bonding curve whose reserves are
      // read live and whose real-reserve capacity clamp assumes the full
      // requested amount lands in the vault; a mint-level transfer fee breaks
      // that assumption in a way simple leg-netting (net(amount, cfg, epoch) per
      // leg) does not cleanly model, and this facade exposes no referenceQuote /
      // epoch to net against anyway. Rejecting self-limits (safe); a wrong net
      // silently mis-quotes — so keep the no-op (reject) path.
      throw new Error(
        `${SLUG}: gate: base mint ${mint} carries a token-2022 TransferFeeConfig extension (vault deltas would not match the quoted amount)`,
      );
    }
    offset += 4 + extensionLength;
  }
  return TOKEN_2022_PROGRAM;
}

export interface TrendsPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'quoteToBase' (default, BUY: pay wSOL, receive base) | 'baseToQuote' (SELL: pay base, receive wSOL). */
  direction: "quoteToBase" | "baseToQuote";
  baseMint: Address;
  baseVault: Address;
  quoteVault: Address;
  baseTokenProgram: Address;
}

/** Fetch + decode one Pool account. Read-only against the loader; reserves are read LIVE on-chain
 *  at swap time (see emitSetup) — nothing about the curve state is baked here. */
export async function fetchTrendsPoolConfig(
  load: AccountLoader,
  pool: Address,
): Promise<TrendsPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} has ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  if (!hasDiscriminator(data, POOL_DISCRIMINATOR)) {
    throw new Error(
      `${SLUG}: pool ${pool} has a foreign discriminator (not a bonding_curve Pool account)`,
    );
  }
  if (data[OFF_IS_MIGRATED] !== 0) {
    throw new Error(
      `${SLUG}: pool ${pool} has migrated (is_migrated = true) — no more swaps on the curve`,
    );
  }

  const codec = getAddressCodec();
  const baseMint = codec.decode(data.subarray(OFF_BASE_MINT, OFF_BASE_MINT + 32)) as Address;
  const baseVault = codec.decode(data.subarray(OFF_BASE_VAULT, OFF_BASE_VAULT + 32)) as Address;
  const quoteVault = codec.decode(data.subarray(OFF_QUOTE_VAULT, OFF_QUOTE_VAULT + 32)) as Address;

  const mintData = await load(baseMint);
  if (mintData === null)
    throw new Error(`${SLUG}: base mint ${baseMint} of pool ${pool} not found`);
  const baseTokenProgram = detectBaseTokenProgram(baseMint, mintData);

  return {
    venue: SLUG,
    pool,
    direction: "quoteToBase",
    baseMint,
    baseVault,
    quoteVault,
    baseTokenProgram,
  };
}

/** The Trends venue: a bonding-curve token launchpad. */
export const trends = {
  slug: SLUG,
  programId: TRENDS_PROGRAM_ID,
  fetchPoolConfig: fetchTrendsPoolConfig,
};
