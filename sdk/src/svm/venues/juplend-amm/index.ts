/**
 * JupLend AMM venue adapter — Jupiter Lend's on-chain "Dex" program
 * (`jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd`), a Fluid-style AMM that
 * quotes directly off a shared lending-protocol reserve rather than a
 * standalone pool of tokens: swapping token X out of the Dex is implemented
 * as the Dex borrowing (or withdrawing supplied collateral of) X from the
 * shared Liquidity program (`jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC`) —
 * confirmed by the `swap_in`/`swap_out` account list carrying
 * `dex_supply_position_token_{0,1}` / `dex_borrow_position_token_{0,1}`
 * alongside the usual pool/vault accounts.
 *
 * SOURCE-VERIFIED, not guessed: this program has no published Rust source
 * (Anchor IDL only, from the public `jup-ag/jupiter-lend` repo's
 * `target/idl/{dex,liquidity,oracle}.json`) — every byte offset and PDA seed
 * below was independently derived from that IDL AND cross-checked against
 * live mainnet state (8 real `Dex` pools, their `TokenReserve`/`RateModel`/
 * `UserSupplyPosition`/`UserBorrowPosition` accounts, decoded and inspected
 * on 2026-07-31):
 *   - `Dex` (329 bytes, disc `ec1eb550d1d919a3`): token_0@11/token_1@43 (32B
 *     pubkeys), decimals@75/76, center_price@109 (u128, 1e15-scaled — the
 *     scale and orientation were confirmed against REAL economics: the
 *     SOL/JitoSOL pool's stored value (~1.29e15) matches the known
 *     jitoSOL-appreciates-vs-SOL exchange rate exactly when read as
 *     "token0 raw units per 1 token1 raw unit"), is_smart_collateral_enabled@141,
 *     is_smart_debt_enabled@142, fee@143 (u32, ppm — same 1e6 convention as
 *     every other ppm-fee family in this SDK), token_0/1_max_utilization@214/216,
 *     center_price_address@166 (a peg-oracle config PDA; `Pubkey::default()`
 *     ⇒ a hard, non-shifting manual peg — see the shift-active gate below),
 *     is_center_price_shift_active@218.
 *   - `TokenReserve` (192 bytes, disc `15123b8778141f0c`, owned by the
 *     LIQUIDITY program, one per mint, SHARED across every Dex trading that
 *     mint): mint@8, vault@40 (both 32B pubkeys) — this adapter only reads
 *     the vault pubkey off it (see the module doc's capacity note for why
 *     the reserve's aggregate totals are NOT used for pricing or capacity).
 *   - `UserSupplyPosition` / `UserBorrowPosition` (132 / 120 bytes, owned by
 *     the liquidity program, PDA `["user_{supply,borrow}_position", mint,
 *     dex]` — the Dex registers ITSELF as the "protocol"/"user" identity
 *     against the shared reserve): both share `amount@73` (u64, current
 *     utilized amount) and a ceiling field @81 (u64 — `withdrawal_limit` for
 *     supply, `debt_ceiling` for borrow) at the SAME offset, since the first
 *     four fields (protocol, mint, with_interest, amount) are identical.
 *     `debt_ceiling`/`withdrawal_limit` minus `amount` is exactly the
 *     capacity the real program enforces before reverting
 *     (`DexDebtLimitReached` / `DexWithdrawalLimitReached`, dex.json's own
 *     error catalog) — the ladder's capacity cap (see ladder.ts).
 * PDA seeds (liquidity.json's own declared seeds, confirmed by DERIVING
 * every one of them and finding the result ALREADY LIVE on mainnet with the
 * expected owner): reserve `["reserve", mint]`, rate_model `["rate_model",
 * mint]`, liquidity `["liquidity"]` (one global singleton), user supply/
 * borrow position as above — all under the liquidity program.
 *
 * SCOPE / WHAT THIS ADAPTER DOES NOT MODEL (documented, one-sided-safe —
 * mirrors this SDK's own Obric-V2 fee-rebate omission and WooFi's
 * conservative-cap precedent, `predicted <= what the real curve can
 * deliver`, never the reverse):
 *   - `is_center_price_shift_active` pools are REJECTED at fetchPoolConfig.
 *     Those pools re-derive their price via a live CPI into the oracle
 *     program (Chainlink Data Streams, per oracle.json's instruction set) —
 *     a live, off-chain-signed-report-driven price this adapter cannot
 *     cheaply reproduce, and (unlike the EVM Fluid family in this repo's
 *     sibling recipes package, which quotes via a live on-chain
 *     quote-differencing CPI) the SVM ladder architecture has no live-CPI
 *     quoting primitive — every ladder fragment must be a pure function of
 *     account BYTES. Pools with a manually-set, non-shifting peg
 *     (`center_price_address == Pubkey::default()`, confirmed live on 3 of
 *     the 8 discovered pools) are fully modeled: their center_price is a
 *     plain, live-read state field.
 *   - The swap's exact "smart collateral vs smart debt" ROUTING SPLIT (the
 *     real program picks, per-trade, how much of the swap routes through
 *     each of its two internal sub-pools, per an internal price-equalizing
 *     split — Fluid's own EVM source shows this as `_swapRoutingIn`/
 *     imaginary-reserve geometric-mean math) is NOT reproduced. This
 *     adapter instead prices the swap at the Dex's own flat, live
 *     center_price (fee-adjusted) — a legitimate first-order model for a
 *     protocol whose own docs and Dex naming describe it as pricing
 *     LST/stable/yield-bearing pairs around a slowly-drifting peg (every
 *     one of the 8 discovered pools is such a pair), and it is bounded by
 *     the REAL, byte-verified position-ceiling cap above so it self-drops
 *     rather than over-promise past the enforced limit.
 *   - Only ONE of `is_smart_collateral_enabled` / `is_smart_debt_enabled`
 *     is modeled (whichever the Dex has enabled for this token); no
 *     discovered pool has both. If a future pool enables both, this adapter
 *     prefers the collateral (supply) position and simply ignores the extra
 *     debt-side capacity — understating capacity, never overstating it.
 *   - Token-2022 mints ARE supported (one discovered pool's token_0 is a
 *     Token-2022 mint) via the SAME extension-scanning gate this SDK's
 *     pumpswap adapter uses (rejects a TransferFeeConfig extension, whose
 *     transfer-time haircut would desync the vault delta from the quoted
 *     amount).
 *
 * VALIDATION METHOD (2026-07-31): every byte offset and PDA seed above was
 * proven against LIVE mainnet-beta state (getProgramAccounts / getAccountInfo
 * over the public RPC) — not merely transcribed from the IDL. The full
 * swap_in account list (24 accounts) was built and round-tripped through
 * `simulateTransaction` (impersonated real funded signers, `sigVerify:
 * false`) for BOTH a smart-collateral pool (SOL/JitoSOL) and a smart-debt
 * pool (USDC/USDT): in both cases the transaction ran deep into the
 * program's real business logic (11-50k CU consumed) past every Anchor
 * account/owner/discriminator check, which is the strong evidence this
 * adapter's account list is correct. The exact swap OUTPUT (the
 * collateral/debt routing split) could not be independently reproduced
 * end-to-end without the closed-source Rust — see the scope note above for
 * why, and ladder.ts's header for the resulting quote model and its
 * one-sided-safe capacity bound.
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
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from "../types.js";
import { JUPITER_LEND_LIQUIDITY_PROGRAM_ID } from "../jupiter-lend-earn/index.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "juplend-amm";

export const JUPLEND_AMM_PROGRAM_ID = address("jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd");
// Same on-chain program as jupiter-lend-earn's `JUPITER_LEND_LIQUIDITY_PROGRAM_ID`
// ('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC') — JupLend AMM and Jupiter Lend
// Earn are two adapters over the same underlying Jupiter Lend liquidity program.
// Re-exported under this family's own name for this module's call sites, but
// sourced from the one place the address is declared to avoid two independent
// literals drifting apart.
export const JUPLEND_LIQUIDITY_PROGRAM_ID = JUPITER_LEND_LIQUIDITY_PROGRAM_ID;
export const JUPLEND_ORACLE_PROGRAM_ID = address("jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc");

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** sha256('account:Dex')[0..8] — verified live against 8 real mainnet accounts. */
const DEX_DISCRIMINATOR = [236, 30, 181, 80, 209, 217, 25, 163];
const DEX_ACCOUNT_SIZE = 329;

/** sha256('account:UserBorrowPosition')[0..8]. */
const USER_BORROW_POSITION_DISCRIMINATOR = [73, 126, 65, 123, 220, 126, 197, 24];
const USER_BORROW_POSITION_SIZE = 120;
/** sha256('account:UserSupplyPosition')[0..8]. */
const USER_SUPPLY_POSITION_DISCRIMINATOR = [202, 219, 136, 118, 61, 177, 21, 146];
const USER_SUPPLY_POSITION_SIZE = 132;

// Dex account field offsets (absolute, disc included) — see module doc.
export const OFF_TOKEN_0 = 11;
export const OFF_TOKEN_1 = 43;
export const OFF_TOKEN_0_DECIMALS = 75;
export const OFF_TOKEN_1_DECIMALS = 76;
export const OFF_CENTER_PRICE = 109; // u128
export const OFF_SMART_COLLATERAL_ENABLED = 141;
export const OFF_SMART_DEBT_ENABLED = 142;
export const OFF_FEE = 143; // u32, ppm
export const OFF_CENTER_PRICE_ADDRESS = 166;
export const OFF_IS_CENTER_PRICE_SHIFT_ACTIVE = 218;
export const OFF_SWAP_AND_ARBITRAGE_PAUSED = 219;

// UserSupplyPosition / UserBorrowPosition shared field offsets.
export const OFF_POSITION_AMOUNT = 73; // u64
export const OFF_POSITION_CEILING = 81; // u64 (debt_ceiling | withdrawal_limit)

/** 1 raw-unit-per-raw-unit price scale (empirically confirmed — see module doc). */
export const CENTER_PRICE_SCALE = 1_000_000_000_000_000n; // 1e15
export const FEE_SCALE = 1_000_000n; // ppm

export interface JuplendAmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** true ⇒ token0 in / token1 out; false ⇒ token1 in / token0 out. */
  swap0to1: boolean;
  token0: Address;
  token1: Address;
  tokenProgram0: Address;
  tokenProgram1: Address;
  /** Liquidity-program TokenReserve PDAs (`["reserve", mint]`), one per mint. */
  tokenReserve0: Address;
  tokenReserve1: Address;
  /** Each mint's shared-liquidity vault (read off its TokenReserve.vault field). */
  vault0: Address;
  vault1: Address;
  /** `["rate_model", mint]` PDAs — carried through untouched for the swap CPI. */
  rateModel0: Address;
  rateModel1: Address;
  /** `["liquidity"]` — one global singleton. */
  liquidity: Address;
  /** Whichever of supply/borrow position this Dex uses (see class doc). */
  positionKind: "supply" | "borrow";
  /** `["user_{supply,borrow}_position", mint, dex]` PDAs for BOTH mints. */
  position0: Address;
  position1: Address;
  /** Dex.fee, ppm (1e6 scale). */
  feePpm: bigint;
}

const codec = getAddressDecoder();
const encoder = getAddressEncoder();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

async function pda(seeds: (string | Uint8Array)[], programAddress: Address): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

/**
 * Which token program owns a mint, from the mint account bytes alone (no
 * `owner` field on AccountLoader reads): a classic SPL mint is exactly 82
 * bytes; anything else must be token-2022 TLV. A plain / advisory-only
 * Token-2022 mint (PermanentDelegate, ConfidentialTransfer — PYUSD/USDG carry
 * these and trade fine) routes exactly like a legacy mint; a genuinely
 * un-routable extension set (NonTransferable / DefaultAccountState=frozen)
 * self-drops, and a TransferFeeConfig-bearing mint is dropped (see the
 * TODO below).
 */
function detectTokenProgram(mint: Address, data: Uint8Array): Address {
  if (data.length === 82) return TOKEN_PROGRAM;
  if (data.length < 166) {
    throw new Error(
      `juplend-amm mint ${mint} data is ${data.length} bytes, not a token mint layout`,
    );
  }
  if (data[165] !== 1) {
    throw new Error(
      `juplend-amm mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`,
    );
  }
  const ext = parseMintExtensions(data);
  if (ext.blocking.length > 0) {
    throw new Error(`juplend-amm gate: mint ${mint} is un-routable (${ext.blocking.join("; ")})`);
  }
  // TODO(t22-fee-netting): a TransferFeeConfig mint is DROPPED, not netted.
  // This adapter's quote/ladder was relocated to the recipes package (see the
  // module doc), so there is no referenceQuote here to net the fee on both
  // legs; dropping self-limits (never over-quotes). Add the netting in the
  // recipes ladder to serve fee-bearing pools.
  if (ext.transferFee) {
    throw new Error(
      `juplend-amm gate: mint ${mint} carries a token-2022 TransferFeeConfig extension (vault deltas would not match user amounts)`,
    );
  }
  return TOKEN_2022_PROGRAM;
}

function juplendAmmConfig(cfg: PoolConfig): JuplendAmmPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`juplend-amm adapter got a config for venue '${cfg.venue}'`);
  return cfg as JuplendAmmPoolConfig;
}

export const juplendAmm = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: JUPLEND_AMM_PROGRAM_ID,

  /**
   * Decode + shape-gate the Dex account, derive every PDA the swap CPI and
   * the ladder need, and pick this Dex's position kind. Rejects: wrong
   * size/discriminator, a paused Dex, an active center-price shift (see
   * module doc), and a Dex with NEITHER smart_collateral nor smart_debt
   * enabled (the real program's own swap can never succeed in that state —
   * `_swapIn`'s routing-amount branch has no route, `DexNoSwapRoute`).
   */
  async fetchPoolConfig(
    load: AccountLoader,
    pool: Address,
    swap0to1 = true,
  ): Promise<JuplendAmmPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`juplend-amm pool ${pool} account not found`);
    if (data.length !== DEX_ACCOUNT_SIZE) {
      throw new Error(
        `juplend-amm pool ${pool} account is ${data.length} bytes, expected ${DEX_ACCOUNT_SIZE}`,
      );
    }
    if (!DEX_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
      throw new Error(`juplend-amm pool ${pool} is not a Dex account (discriminator mismatch)`);
    }
    if (data[OFF_SWAP_AND_ARBITRAGE_PAUSED] !== 0) {
      throw new Error(`juplend-amm pool ${pool} has swap_and_arbitrage_paused set`);
    }
    if (data[OFF_IS_CENTER_PRICE_SHIFT_ACTIVE] !== 0) {
      throw new Error(
        `juplend-amm pool ${pool} has an active center-price shift (requires a live oracle CPI this adapter cannot reproduce — see module doc)`,
      );
    }
    const smartCollateral = data[OFF_SMART_COLLATERAL_ENABLED] !== 0;
    const smartDebt = data[OFF_SMART_DEBT_ENABLED] !== 0;
    if (!smartCollateral && !smartDebt) {
      throw new Error(
        `juplend-amm pool ${pool} has neither smart_collateral nor smart_debt enabled (no swap route)`,
      );
    }
    const positionKind: "supply" | "borrow" = smartCollateral ? "supply" : "borrow";

    const token0 = pubkeyAt(data, OFF_TOKEN_0);
    const token1 = pubkeyAt(data, OFF_TOKEN_1);
    const feePpm = readUintLE(data, OFF_FEE, 4);

    const [mint0Data, mint1Data] = await Promise.all([load(token0), load(token1)]);
    if (mint0Data === null || mint1Data === null)
      throw new Error(`juplend-amm pool ${pool} mint account(s) not found`);
    const tokenProgram0 = detectTokenProgram(token0, mint0Data);
    const tokenProgram1 = detectTokenProgram(token1, mint1Data);

    const [tokenReserve0, tokenReserve1, rateModel0, rateModel1, liquidity] = await Promise.all([
      pda(["reserve", new Uint8Array(encoder.encode(token0))], JUPLEND_LIQUIDITY_PROGRAM_ID),
      pda(["reserve", new Uint8Array(encoder.encode(token1))], JUPLEND_LIQUIDITY_PROGRAM_ID),
      pda(["rate_model", new Uint8Array(encoder.encode(token0))], JUPLEND_LIQUIDITY_PROGRAM_ID),
      pda(["rate_model", new Uint8Array(encoder.encode(token1))], JUPLEND_LIQUIDITY_PROGRAM_ID),
      pda(["liquidity"], JUPLEND_LIQUIDITY_PROGRAM_ID),
    ]);

    const [reserve0Data, reserve1Data] = await Promise.all([
      load(tokenReserve0),
      load(tokenReserve1),
    ]);
    if (reserve0Data === null || reserve1Data === null) {
      throw new Error(`juplend-amm pool ${pool} TokenReserve account(s) not found`);
    }
    const vault0 = pubkeyAt(reserve0Data, 40);
    const vault1 = pubkeyAt(reserve1Data, 40);

    const seedName = positionKind === "supply" ? "user_supply_position" : "user_borrow_position";
    const [position0, position1] = await Promise.all([
      pda(
        [seedName, new Uint8Array(encoder.encode(token0)), new Uint8Array(encoder.encode(pool))],
        JUPLEND_LIQUIDITY_PROGRAM_ID,
      ),
      pda(
        [seedName, new Uint8Array(encoder.encode(token1)), new Uint8Array(encoder.encode(pool))],
        JUPLEND_LIQUIDITY_PROGRAM_ID,
      ),
    ]);
    const [pos0Data, pos1Data] = await Promise.all([load(position0), load(position1)]);
    const expectedDisc =
      positionKind === "supply"
        ? USER_SUPPLY_POSITION_DISCRIMINATOR
        : USER_BORROW_POSITION_DISCRIMINATOR;
    const expectedSize =
      positionKind === "supply" ? USER_SUPPLY_POSITION_SIZE : USER_BORROW_POSITION_SIZE;
    for (const [ref, posData] of [
      ["position0", pos0Data],
      ["position1", pos1Data],
    ] as const) {
      if (posData === null)
        throw new Error(`juplend-amm pool ${pool} ${positionKind} ${ref} account not found`);
      if (posData.length !== expectedSize) {
        throw new Error(
          `juplend-amm pool ${pool} ${positionKind} ${ref} is ${posData.length} bytes, expected ${expectedSize}`,
        );
      }
      if (!expectedDisc.every((byte, i) => posData[i] === byte)) {
        throw new Error(`juplend-amm pool ${pool} ${positionKind} ${ref} discriminator mismatch`);
      }
    }

    return {
      venue: SLUG,
      pool,
      swap0to1,
      token0,
      token1,
      tokenProgram0,
      tokenProgram1,
      tokenReserve0,
      tokenReserve1,
      vault0,
      vault1,
      rateModel0,
      rateModel1,
      liquidity,
      positionKind,
      position0,
      position1,
      feePpm,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = juplendAmmConfig(cfg);
    const positionRef = c.swap0to1 ? c.position1 : c.position0;
    return [
      { ref: c.pool, address: c.pool },
      { ref: positionRef, address: positionRef },
    ];
  },

  /**
   * The full `swap_in` CPI (24 accounts — see module doc's account-list
   * validation). `dex_supply_position_token_{0,1}` / `dex_borrow_position_token_{0,1}`
   * carry the DEX's own program id as the Anchor "None" sentinel for
   * whichever position kind this Dex does not use (proven correct: reaching
   * real business logic past account resolution for both position kinds —
   * see module doc). `amount_out_min` is the recipe-wide venue convention
   * of 1 (the recipe's own outAta delta check owns the real floor).
   */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = juplendAmmConfig(cfg);
    const U64_MAX = (1n << 64n) - 1n;
    if (amountIn <= 0n || amountIn > U64_MAX)
      throw new Error(`juplend-amm buildSwap amountIn must be a positive u64, got ${amountIn}`);
    const data = new Uint8Array(8 + 1 + 8 + 8);
    data.set([141, 172, 10, 208, 69, 9, 56, 154], 0); // sha256('global:swap_in')[0..8]
    data[8] = c.swap0to1 ? 1 : 0;
    let v = amountIn;
    for (let b = 0; b < 8; b++) {
      data[9 + b] = Number(v & 0xffn);
      v >>= 8n;
    }
    data[17] = 1; // amount_out_min = 1
    const make = (r: string, addr: Address, writable?: boolean): VenueAccount =>
      writable ? { ref: r, address: addr, writable: true } : { ref: r, address: addr };
    return {
      programId: JUPLEND_AMM_PROGRAM_ID,
      data,
      accounts: juplendAmmSwapAccounts(c, user, make),
    };
  },
};

/** sha256('global:swap_in')[0..8] — exported for buildSwapV2's prefix. */
export const JUPLEND_SWAP_IN_DISCRIMINATOR = [141, 172, 10, 208, 69, 9, 56, 154];

/**
 * The 24-account order `swap_in`/`swap_out` share (see dex.json's IDL).
 * `make(role, addr, writable?)` builds one VenueAccount; `refFor` (default
 * identity) lets buildSwapV2 slot-namespace the pool-owned refs while
 * user-owned refs (owner/inAta/outAta) stay exactly as SwapUser gave them —
 * the same shared-helper shape obric-v2's swapAccounts uses.
 */
export function juplendAmmSwapAccounts(
  c: JuplendAmmPoolConfig,
  user: SwapUser,
  make: (role: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const r = refFor ?? ((role: string): string => role);
  const none = (role: string): VenueAccount => make(r(role), JUPLEND_AMM_PROGRAM_ID);
  const userToken0 = c.swap0to1 ? user.inAta : user.outAta;
  const userToken1 = c.swap0to1 ? user.outAta : user.inAta;
  const supplyPos0 = c.positionKind === "supply" ? make(r("sp0"), c.position0, true) : none("sp0");
  const supplyPos1 = c.positionKind === "supply" ? make(r("sp1"), c.position1, true) : none("sp1");
  const borrowPos0 = c.positionKind === "borrow" ? make(r("bp0"), c.position0, true) : none("bp0");
  const borrowPos1 = c.positionKind === "borrow" ? make(r("bp1"), c.position1, true) : none("bp1");
  return [
    { ref: user.owner, writable: true, signer: true }, // signer
    make(r("dex"), c.pool, true),
    { ref: userToken0, writable: true },
    { ref: userToken1, writable: true },
    { ref: user.owner }, // recipient
    { ref: userToken0, writable: true }, // recipient_token_0_account
    { ref: userToken1, writable: true }, // recipient_token_1_account
    make(r("t0"), c.token0),
    make(r("t1"), c.token1),
    make(r("tr0"), c.tokenReserve0, true),
    make(r("tr1"), c.tokenReserve1, true),
    make(r("rm0"), c.rateModel0),
    make(r("rm1"), c.rateModel1),
    make(r("v0"), c.vault0, true),
    make(r("v1"), c.vault1, true),
    supplyPos0,
    supplyPos1,
    borrowPos0,
    borrowPos1,
    make(r("liq"), c.liquidity),
    make(r("liqp"), JUPLEND_LIQUIDITY_PROGRAM_ID),
    make(r("tp0"), c.tokenProgram0),
    make(r("tp1"), c.tokenProgram1),
    make(r("orc"), JUPLEND_ORACLE_PROGRAM_ID),
  ];
}
