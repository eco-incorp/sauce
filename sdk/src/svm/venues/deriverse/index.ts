/**
 * Deriverse venue adapter (program DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD) —
 * a hybrid CLOB + embedded constant-product AMM. No IDL/docs exist; this
 * adapter was built by reading Deriverse's own public repos: the `drv-models`
 * common-types crate (github.com/deriverse/drv-smart-contract-common, MIT/
 * public, tag v0.2.68 — `InstrAccountHeader`'s exact `#[repr(C)]` layout, the
 * `Swap` instruction's `SwapData` encoding and account order) and the
 * `jupiter-deriverse` aggregator adapter (github.com/deriverse/jupiter-deriverse)
 * — a REFERENCE IMPLEMENTATION of the venue's own quote math (`amm.rs`,
 * `lib.rs`'s `quote()`), which this adapter's formula is transcribed from and
 * deliberately NARROWS (see below).
 *
 * WHAT WE MODEL (and what we deliberately don't): each Deriverse "instrument"
 * (a market between an `asset` token and a `crncy` token) carries an EMBEDDED
 * constant-product AMM directly in its header — `asset_tokens`/`crncy_tokens`
 * (raw reserves) and `k = asset_tokens * crncy_tokens` is the invariant used
 * throughout `amm.rs`'s `get_amm_qty`/`get_amm_sum`/`get_reversed_amm_*`. The
 * SAME instrument ALSO carries a resting-order CLOB (bid/ask "lines", walked
 * by `order_book.rs`) that Jupiter's `quote()` interleaves with the AMM by
 * price. This adapter models ONLY the embedded AMM leg and ignores the book
 * entirely — a pool with real resting-order depth is under-quoted here, NEVER
 * over-quoted (empirically confirmed: cross-checked against Jupiter's own
 * `dexes=Deriverse`-filtered quote at three sizes on the live wSOL/USDC
 * instrument, our AMM-only figure sat within ~10-15bps of Jupiter's number at
 * a 0.1 SOL trade and increasingly BELOW it at 1/5 SOL, exactly the signature
 * of excluded book depth becoming material at size — see ladder.ts's header
 * for the numbers). A pair whose embedded AMM is empty (`asset_tokens ==
 * crncy_tokens == 0`, real for at least one live pair) quotes 0 here even
 * though Jupiter fills it purely from the book — a correct, disclosed
 * under-quote, not a bug.
 *
 * FEE MODEL: `spot_fee_rate`/`fixed_fee_rate`/`day_volatility` are read once
 * at fetchPoolConfig time and folded into ONE conservative `feePpm` cfg
 * param (see `conservativeFeePpm`'s doc) rather than read live — the
 * dynamic (day_volatility-scaled) fee component is an f64 field with no
 * cheap on-chain integer decode, so it is baked off-chain with a documented
 * safety margin (2x + a flat floor) that only ever widens the fee, never
 * narrows it, keeping the baked snapshot conservative against both
 * volatility drift and an unmodelled/nonzero protocol `swap_fee_rate`.
 *
 * CIRCUIT BREAKER: the real `Swap`/`NewSpotOrder` path stops filling once
 * the AMM's own marginal price would move beyond ±(last_px >> 3) (or >> 4
 * for `SimilarAssets` pairs) from the instrument's `last_px` — ladder.ts
 * enforces the TIGHTER `>> 4` bound unconditionally via a live isqrt-based
 * capacity clamp (mirrors obric-v2's capacity-clamp shape), so a large
 * trade SATURATES at the breaker instead of a pure, unclamped curve
 * over-promising past what the real instruction would ever deliver.
 *
 * SCOPE GATE: Tokenkeg-only. Mint addresses come straight from the
 * instrument header; the VAULT addresses do not (a Deriverse `TokenState`
 * bookkeeping PDA per mint carries the real vault in its own
 * `program_address` field, distinct from the TokenState PDA itself — see
 * fetchPoolConfig), so resolving the swap CPI's account list needs two
 * extra one-time reads (never repeated per quote — the ladder's live
 * reads are the pool account alone). Both legs are assumed classic Tokenkeg
 * (one token program for the whole swap), matching raydium-amm-v4/
 * obric-v2's own "Tokenkeg-only, no Token-2022" scope note; a Token-2022
 * transfer-fee mint would desync the wire amount from the curve and is out
 * of scope for this first integration.
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
import { getAddressCodec, getAddressEncoder } from "@solana/kit";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type { Address } from "@solana/kit";
import { accountDataLoader } from "../../loader.js";
import type {
  OwnedAccountLoader,
  PoolConfig,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "deriverse";

export const DERIVERSE_PROGRAM_ID = "DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD" as Address;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/**
 * `find_program_address([b"ndxnt"], programId)` — ONE PDA for the whole
 * program (drv-smart-contract-common's `DRVS_SEED`), independent of any
 * pool. Hardcoded (verified against mainnet via an offline PDA derivation,
 * not read from any account) exactly like raydium-amm-v4's `AMM_AUTHORITY`.
 */
export const DERIVERSE_AUTH = "5QLXhNtkVUEtCyzZ6C1iAavT2x6c6t6LdJcSwVnqWEii" as Address;

const VERSION = 1;
// account_type tags (drv-smart-contract-common state/types.rs).
const TAG_INSTR = 7;
const TAG_SPOT_CLIENT_INFOS = 12;
const TAG_SPOT_BIDS_TREE = 14;
const TAG_SPOT_ASKS_TREE = 15;
const TAG_SPOT_BID_ORDERS = 16;
const TAG_SPOT_ASK_ORDERS = 17;
const TAG_SPOT_LINES = 18;

/**
 * The front slice of `InstrAccountHeader` this adapter reads (1064 bytes,
 * drv-smart-contract-common v0.2.68). The LIVE deployed account is larger
 * (2344 bytes observed on both checked instruments) — the extra bytes are
 * unread reserved tail space (candle/history buffers not yet promoted to
 * named fields), exactly the pattern jupiter-deriverse's own
 * `AccountsHolder::from_account` relies on (`&data[0..size_of::<T>()]`).
 * fetchPoolConfig accepts anything >= this size, never an exact match.
 */
export const INSTR_ACCOUNT_HEADER_MIN_SIZE = 1064;

/**
 * TokenState (drv-smart-contract-common state/token.rs): discriminator(8) +
 * address(32) + program_address(32) + id(4) + mask(4) + reserved(4) +
 * base_crncy_index(4) = 88 bytes, verified against real mainnet dumps
 * (wSOL/USDC/USDT all decode to exactly 88 bytes). `program_address` (the
 * REAL vault SPL token account, distinct from the TokenState PDA itself) is
 * at offset 40.
 */
const TOKEN_STATE_SIZE = 88;
const OFF_TOKEN_STATE_PROGRAM_ADDRESS = 40;

// InstrAccountHeader field offsets — all within the STABLE PREFIX (< byte
// 480, before asset_mint/crncy_mint), verified against real mainnet accounts
// by locating the wSOL/USDC and USDT/USDC instruments' own mint bytes at
// offsets 416/448 (see ladder.ts's header for the full derivation note).
const OFF_DISCRIMINATOR_TAG = 0; // u32
const OFF_DISCRIMINATOR_VERSION = 4; // u32
const OFF_INSTR_ID = 8; // u32
const OFF_ASSET_TOKEN_ID = 12; // u32
const OFF_CRNCY_TOKEN_ID = 16; // u32
export const OFF_MASK = 28; // u32
export const OFF_LAST_PX = 32; // i64
export const OFF_ASSET_TOKENS = 144; // i64
export const OFF_CRNCY_TOKENS = 152; // i64
const OFF_MAPS_ADDRESS = 352; // Pubkey
const OFF_ASSET_MINT = 416; // Pubkey
const OFF_CRNCY_MINT = 448; // Pubkey
export const OFF_DEC_FACTOR = 800; // i64
const OFF_FIXED_FEE_RATE = 1024; // f64
const OFF_SPOT_FEE_RATE = 1058; // u8

// InstrFlag bits (drv-smart-contract-common state/masks.rs).
const MASK_ZERO_FEES = 0x1;
const MASK_FIXED_FEES = 0x2;
export const MASK_SUSPENDED = 0x20;

/** FEE_RATE_STEP (drv-smart-contract-common constants.rs). */
const FEE_RATE_STEP = 0.0005;

function seedById(version: number, tag: number, id1: number, id2: number): Uint8Array {
  const buf = new Uint8Array(16);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, version, true);
  dv.setUint32(4, tag, true);
  dv.setUint32(8, id1, true);
  dv.setUint32(12, id2, true);
  return buf;
}

/** `find_program_address([seed_by_id(VERSION, tag, assetId, crncyId), DERIVERSE_AUTH], programId)`. */
async function spotAcc(tag: number, assetTokenId: number, crncyTokenId: number): Promise<Address> {
  const authBytes = getAddressEncoder().encode(DERIVERSE_AUTH) as Uint8Array;
  return memoizedGetProgramDerivedAddress(DERIVERSE_PROGRAM_ID, [
    seedById(VERSION, tag, assetTokenId, crncyTokenId),
    authBytes,
  ]);
}

function readFloat64LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(offset, true);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readInt64LE(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

/**
 * Bakes ONE conservative fee-ppm constant from a fetch-time snapshot of the
 * instrument's fee inputs. `ZeroFees` (mask bit 0x1) is a protocol invariant
 * that zeros BOTH the AMM fee_rate and the protocol swap_fee_rate (lib.rs's
 * `quote()`, both branches check it first) — trusted exactly, no margin.
 * Otherwise: `FixedFees` (0x2) uses the admin-set static `fixed_fee_rate`;
 * the default case uses the DYNAMIC `day_volatility * spot_fee_rate *
 * FEE_RATE_STEP`, which can drift between this snapshot and the eventual
 * cook (it is a live, per-trade-recalculated statistic, not frozen). Either
 * way the raw ppm is DOUBLED plus a flat +20ppm floor: the margin absorbs
 * (a) day_volatility drift and (b) the deployed binary's protocol-level
 * `swap_fee_rate` (currently the constant 0 in the drv-models crate, but not
 * independently re-derivable from account state, and a bigger assumed fee
 * only ever LOWERS the predicted output — the safe direction; assuming it
 * stays 0 is the unsafe one). This is the ONLY fee derivation this adapter
 * does off-chain; the ladder never reads day_volatility/fixed_fee_rate live.
 */
export function conservativeFeePpm(
  mask: number,
  dayVolatility: number,
  spotFeeRate: number,
  fixedFeeRate: number,
): bigint {
  if ((mask & MASK_ZERO_FEES) !== 0) return 0n;
  const raw =
    (mask & MASK_FIXED_FEES) !== 0 ? fixedFeeRate : dayVolatility * spotFeeRate * FEE_RATE_STEP;
  if (!Number.isFinite(raw) || raw < 0) return 20n; // defensive floor on a garbage read
  const ppm = Math.ceil(raw * 1_000_000) * 2 + 20;
  return BigInt(ppm);
}

export interface DeriversePoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'sell' (default, asset in / crncy out — input_crncy=0) | 'buy' (crncy in / asset out — input_crncy=1). */
  side: "buy" | "sell";
  instrId: number;
  assetTokenId: number;
  crncyTokenId: number;
  assetMint: Address;
  crncyMint: Address;
  /** The instrument's own asset/crncy vault token accounts (a_token_state/b_token_state.program_address). */
  assetVault: Address;
  crncyVault: Address;
  asksTree: Address;
  askOrders: Address;
  bidsTree: Address;
  bidOrders: Address;
  lines: Address;
  mapsAddress: Address;
  clientInfos: Address;
  tokenProgram: Address;
  /** Conservative baked fee (see {@link conservativeFeePpm}), ppm of 1e6. */
  feePpm: bigint;
}

function deriverseConfig(cfg: PoolConfig): DeriversePoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  const c = cfg as DeriversePoolConfig;
  if (c.side !== "buy" && c.side !== "sell")
    throw new Error(`${SLUG} side must be 'buy' or 'sell', got '${c.side}'`);
  return c;
}

export const deriverse = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: DERIVERSE_PROGRAM_ID,

  /**
   * Off-chain gate + decode. Rejects: too-short account data, a non-INSTR
   * discriminator or an unrecognized schema version (defends the fixed
   * offsets above against a future account-layout migration), and an empty
   * `dec_factor` (would divide by zero in the curve). An empty embedded AMM
   * (`asset_tokens == crncy_tokens == 0`, a real live case — the pair trades
   * purely off its resting book) is NOT rejected here: it is a live-state
   * fact the ladder's own enable gate reads every quote, exactly like a
   * drained obric-v2/raydium pool.
   */
  async fetchPoolConfig(owned: OwnedAccountLoader, pool: Address): Promise<DeriversePoolConfig> {
    const load = accountDataLoader(owned);
    const data = await load(pool);
    if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
    if (data.length < INSTR_ACCOUNT_HEADER_MIN_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool} account is ${data.length} bytes, expected at least ${INSTR_ACCOUNT_HEADER_MIN_SIZE} (InstrAccountHeader)`,
      );
    }
    const tag = readUint32LE(data, OFF_DISCRIMINATOR_TAG);
    const version = readUint32LE(data, OFF_DISCRIMINATOR_VERSION);
    if (tag !== TAG_INSTR) {
      throw new Error(
        `${SLUG} pool ${pool} is not an Instrument account (discriminator tag ${tag}, expected ${TAG_INSTR})`,
      );
    }
    if (version !== VERSION) {
      throw new Error(
        `${SLUG} pool ${pool} is schema version ${version}, this adapter only decodes version ${VERSION}`,
      );
    }

    const decFactor = readInt64LE(data, OFF_DEC_FACTOR);
    if (decFactor <= 0n)
      throw new Error(`${SLUG} pool ${pool} has a non-positive dec_factor (${decFactor})`);

    const instrId = readUint32LE(data, OFF_INSTR_ID);
    const assetTokenId = readUint32LE(data, OFF_ASSET_TOKEN_ID);
    const crncyTokenId = readUint32LE(data, OFF_CRNCY_TOKEN_ID);
    const mask = readUint32LE(data, OFF_MASK);
    const dayVolatility = readFloat64LE(data, 344);
    const spotFeeRate = data[OFF_SPOT_FEE_RATE];
    const fixedFeeRate = readFloat64LE(data, OFF_FIXED_FEE_RATE);
    const feePpm = conservativeFeePpm(mask, dayVolatility, spotFeeRate, fixedFeeRate);

    const codec = getAddressCodec();
    const pubkeyAt = (offset: number): Address => codec.decode(data.subarray(offset, offset + 32));
    const assetMint = pubkeyAt(OFF_ASSET_MINT);
    const crncyMint = pubkeyAt(OFF_CRNCY_MINT);
    const mapsAddress = pubkeyAt(OFF_MAPS_ADDRESS);

    // Both legs are assumed classic Tokenkeg (see the SCOPE GATE note above):
    // this venue's Swap ix is legacy-SPL only, so a Token-2022 mint (or one
    // carrying an un-routable extension) must SELF-DROP the pool rather than be
    // silently assumed legacy. The thrown error IS the graceful-drop signal
    // (the SvmRoute orchestrator catches it and drops the venue). The mint's
    // token program is its OWNER (an extensionless Token-2022 mint is
    // byte-identical to a legacy one). An unreadable mint falls back to the
    // legacy assumption, keeping the classic path byte-identical.
    const mintList = [assetMint, crncyMint];
    const mintAccounts = await Promise.all(mintList.map((mint) => owned(mint)));
    for (let mi = 0; mi < mintList.length; mi++) {
      const mint = mintList[mi]!;
      const mintAccount = mintAccounts[mi];
      if (mintAccount === null) continue;
      const mintData = mintAccount.data;
      if (classifyMintProgram(mint, mintData, mintAccount.owner) === TOKEN_2022_PROGRAM_ID) {
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

    // asset/crncy VAULTS are NOT the TokenState PDA itself — TokenState is a
    // small Deriverse bookkeeping record (id/decimals/mask) whose OWN
    // `program_address` field (offset 40, 32 bytes) names the real SPL
    // token account holding the instrument's reserves. Conflating the two
    // (using the TokenState PDA directly as the vault) would attach the
    // wrong account to the Swap CPI — verified against real mainnet TokenState
    // dumps (wSOL/USDC/USDT), where the PDA and program_address differ.
    const [
      assetTokenStateAddr,
      crncyTokenStateAddr,
      asksTree,
      askOrders,
      bidsTree,
      bidOrders,
      lines,
      clientInfos,
    ] = await Promise.all([
      spotAccForMint(assetMint),
      spotAccForMint(crncyMint),
      spotAcc(TAG_SPOT_ASKS_TREE, assetTokenId, crncyTokenId),
      spotAcc(TAG_SPOT_ASK_ORDERS, assetTokenId, crncyTokenId),
      spotAcc(TAG_SPOT_BIDS_TREE, assetTokenId, crncyTokenId),
      spotAcc(TAG_SPOT_BID_ORDERS, assetTokenId, crncyTokenId),
      spotAcc(TAG_SPOT_LINES, assetTokenId, crncyTokenId),
      spotAcc(TAG_SPOT_CLIENT_INFOS, assetTokenId, crncyTokenId),
    ]);
    const [assetTokenStateData, crncyTokenStateData] = await Promise.all([
      load(assetTokenStateAddr),
      load(crncyTokenStateAddr),
    ]);
    if (assetTokenStateData === null)
      throw new Error(`${SLUG} pool ${pool} asset TokenState ${assetTokenStateAddr} not found`);
    if (crncyTokenStateData === null)
      throw new Error(`${SLUG} pool ${pool} crncy TokenState ${crncyTokenStateAddr} not found`);
    if (assetTokenStateData.length < TOKEN_STATE_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool} asset TokenState ${assetTokenStateAddr} is ${assetTokenStateData.length} bytes, expected at least ${TOKEN_STATE_SIZE}`,
      );
    }
    if (crncyTokenStateData.length < TOKEN_STATE_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool} crncy TokenState ${crncyTokenStateAddr} is ${crncyTokenStateData.length} bytes, expected at least ${TOKEN_STATE_SIZE}`,
      );
    }
    const assetVault = codec.decode(
      assetTokenStateData.subarray(
        OFF_TOKEN_STATE_PROGRAM_ADDRESS,
        OFF_TOKEN_STATE_PROGRAM_ADDRESS + 32,
      ),
    );
    const crncyVault = codec.decode(
      crncyTokenStateData.subarray(
        OFF_TOKEN_STATE_PROGRAM_ADDRESS,
        OFF_TOKEN_STATE_PROGRAM_ADDRESS + 32,
      ),
    );

    return {
      venue: SLUG,
      pool,
      side: "sell",
      instrId,
      assetTokenId,
      crncyTokenId,
      assetMint,
      crncyMint,
      assetVault,
      crncyVault,
      asksTree,
      askOrders,
      bidsTree,
      bidOrders,
      lines,
      mapsAddress,
      clientInfos,
      tokenProgram: TOKEN_PROGRAM,
      feePpm,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = deriverseConfig(cfg);
    return [{ ref: c.pool, address: c.pool }];
  },

  /** v1 swap CPI (amount baked) — the unified `Swap` instruction (tag 26). */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = deriverseConfig(cfg);
    const U64_MAX = (1n << 64n) - 1n;
    if (amountIn <= 0n || amountIn > U64_MAX)
      throw new Error(`${SLUG} buildSwap amountIn must be a positive u64, got ${amountIn}`);
    const data = new Uint8Array(32);
    const dv = new DataView(data.buffer);
    data[0] = 26; // SwapInstruction::INSTRUCTION_NUMBER
    data[1] = c.side === "buy" ? 1 : 0; // input_crncy
    // bytes 2..4 padding_u16 = 0
    dv.setUint32(4, c.instrId, true);
    dv.setBigInt64(8, 0n, true); // price = 0 (no caller-supplied limit; the program applies its own last_px-derived breaker)
    dv.setBigInt64(16, amountIn, true); // amount
    dv.setBigInt64(24, 1n, true); // min_amount_out = 1 (the recipe's terminal delta owns the real bound)
    return {
      programId: DERIVERSE_PROGRAM_ID,
      data,
      accounts: deriverseSwapAccounts(c, user, (ref, addr, w) => fixed(ref, addr, w)),
    };
  },
};

/** `new_token_acc`: `find_program_address([mint[0..28] ++ VERSION_LE, DERIVERSE_AUTH], programId)`. */
async function spotAccForMint(mint: Address): Promise<Address> {
  const mintBytes = getAddressEncoder().encode(mint);
  const seed = new Uint8Array(32);
  seed.set(mintBytes.subarray(0, 28), 0);
  new DataView(seed.buffer).setUint32(28, VERSION, true);
  const authBytes = getAddressEncoder().encode(DERIVERSE_AUTH) as Uint8Array;
  return memoizedGetProgramDerivedAddress(DERIVERSE_PROGRAM_ID, [seed, authBytes]);
}

const fixed = (ref: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref, address: addr, writable: true } : { ref, address: addr };

/**
 * The 14-account order for Deriverse's `Swap` (disc 26 — SwapInstruction::
 * MIN_ACCOUNTS), shared by v1 buildSwap and v2 buildSwapV2: [signer, asset
 * mint, crncy mint, asset vault, crncy vault, instrument, {asks_tree,
 * ask_orders} on buy / {bids_tree, bid_orders} on sell, lines, maps, client
 * infos, asset-side user ATA, crncy-side user ATA, token program]. User ATAs
 * are POSITIONAL BY MINT (asset vs crncy), not by direction — the same trap
 * documented on solfi-v2/quantum.
 */
export function deriverseSwapAccounts(
  c: DeriversePoolConfig,
  user: SwapUser,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const r = refFor ?? ((role: string): string => role);
  const buy = c.side === "buy";
  const userAsset = buy ? user.outAta : user.inAta;
  const userCrncy = buy ? user.inAta : user.outAta;
  return [
    { ref: user.owner, signer: true, writable: true },
    make(r("am"), c.assetMint),
    make(r("cm"), c.crncyMint),
    make(r("av"), c.assetVault, true),
    make(r("cv"), c.crncyVault, true),
    make(r("instr"), c.pool, true),
    ...(buy
      ? [make(r("askt"), c.asksTree, true), make(r("asko"), c.askOrders, true)]
      : [make(r("bidt"), c.bidsTree, true), make(r("bido"), c.bidOrders, true)]),
    make(r("lines"), c.lines, true),
    make(r("maps"), c.mapsAddress, true),
    make(r("ci"), c.clientInfos, true),
    { ref: userAsset, writable: true },
    { ref: userCrncy, writable: true },
    make(r("tp"), c.tokenProgram),
  ];
}
