/**
 * Manifest CLOB venue — market decoding, scope gates and the prepare-declared
 * TOP-OF-BOOK ORDER WINDOW for the SvmRoute ladder fragment (./ladder.ts).
 * Like orca-whirlpool this family is LADDER-ONLY (adapter contract v2): a CLOB
 * quote is a best-first walk over a red-black tree of resting orders that lives
 * inside ONE market account, which does not fit the one-adapter-one-pool v1
 * shape — so there is no SvmVenueAdapter here and the venue is not in the v1
 * registry.
 *
 * Layout source-verified against github.com/CKS-Systems/manifest
 * (programs/manifest/src/state/{market,resting_order}.rs, lib/src/
 * red_black_tree.rs, program/{instruction,processor/swap}.rs, quantities.rs)
 * AND a mainnet dump of the SOL/USDC market ENhU8LsaR7... (238,896 bytes,
 * sdk/test/svm/fixtures/manifest/): MarketFixed = 256 bytes, discriminant
 * (u64 LE @0) = 4859840929024028656; the dynamic byte array after the header
 * holds 80-byte blocks (a 16-byte red-black-tree node overhead + a 64-byte
 * RestingOrder / ClaimedSeat payload) interleaved as three RB trees (bids,
 * asks, seats) + a free list — the "hypertree". A RestingOrder payload:
 * price QuoteAtomsPerBaseAtom (u128 LE = price * 1e18) @+0, num_base_atoms u64
 * @+16, sequence_number u64 @+24, trader_index u32 @+32, last_valid_slot u32
 * @+36, is_bid u8 @+40, order_type u8 @+41. All integers little-endian.
 *
 * THE WINDOW (the pinned Phase 2 CLOB design, the whirlpool net-cache thesis
 * transplanted to a book): an in-VM red-black-tree successor walk is
 * unaffordable AND unbounded on the interpreter (get_next_lower_index chases
 * parent/child pointers with a data-dependent inner loop — the same class as
 * whirlpool's rejected in-VM tick discovery). So prepare walks the tree
 * OFF-CHAIN from the side's best index (bids_best for a base-in sell, asks_best
 * for a quote-in buy) following the venue's own get_next_lower_index taker
 * order, and ships up to MANIFEST_MAX_ORDERS price levels as per-trade cfg
 * params — each level a (block DataIndex, sequence_number) pair. Everything
 * value-bearing stays LIVE: the fragment reads each shipped order's price and
 * num_base_atoms from the market account at cook time. The sequence_number is
 * the drift-invariant identity anchor: a monotonic per-order counter, stable
 * across partial fills (reduce() keeps the block + seq, only shrinks the size),
 * unique across the free-list reuse a cancel/fill would cause. Drift semantics:
 * - a shipped order partially filled since prepare: exact (live size read);
 * - a shipped order fully filled / cancelled (block freed or reused): the live
 *   sequence_number no longer matches → the fragment STOPS the walk there and
 *   deactivates the remaining shipped levels (conservative — the venue may fill
 *   from levels that moved up, favorable, minOut enforced);
 * - a NEW better limit order inside the shipped range: the model misses it — a
 *   better price only improves the realized output, minOut enforced (favorable,
 *   like the whirlpool new-tick-in-a-gap case);
 * - the whole shipped set consumed (trade exceeds top-of-book depth): the venue
 *   SELF-DEACTIVATES past capacity (quote clamps, no out-of-window fallback).
 *
 * Gates (named errors, everything else is a live read):
 * - account size / discriminant;
 * - non-classic-SPL mints (the Swap ix is Tokenkeg-only here; a Token-2022
 *   market needs the optional mint accounts + swap_v2-style plumbing — a
 *   follow-up, mirroring the whirlpool Tokenkeg gate);
 * - a direction with NO shippable levels (empty book side — nothing to walk).
 *
 * GLOBAL orders (order_type 3) draw from a separate global account the swap
 * would need extra accounts for; a taker IOC order BREAKS at the first global
 * maker when those accounts are absent (place_order / impact_base_atoms). So
 * the off-chain walk STOPS at the first global order (never shipping past it) —
 * exactly reproducing the venue's taker halt. EXPIRING orders (last_valid_slot
 * != 0) are also a stop: the in-VM model carries no clock, so the walk ships
 * only the non-expiring (last_valid_slot == 0) prefix; the venue may match an
 * expiring order beyond it (favorable) — minOut enforced.
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
import { makeTreeWalkBudget } from '../tree-walk.js';
import type { SpendHop } from '../tree-walk.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'manifest';

export const MANIFEST_PROGRAM_ID = address('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** MarketFixed size — the dynamic RB-tree/free-list region begins here. */
export const MARKET_FIXED_SIZE = 256;
/** sha256-independent packed discriminant (u64 LE @0) — MARKET_FIXED_DISCRIMINANT. */
export const MARKET_DISCRIMINANT = 4_859_840_929_024_028_656n;
/** Price is stored as QuoteAtomsPerBaseAtom.inner = price * 1e18 (u128 LE). */
export const PRICE_D18 = 1_000_000_000_000_000_000n;

// MarketFixed offsets (state/market.rs declared order, repr(C)).
export const OFF_BASE_MINT_DECIMALS = 9;
export const OFF_QUOTE_MINT_DECIMALS = 10;
const OFF_BASE_MINT = 16;
const OFF_QUOTE_MINT = 48;
const OFF_BASE_VAULT = 80;
const OFF_QUOTE_VAULT = 112;
export const OFF_BIDS_ROOT = 156;
export const OFF_BIDS_BEST = 160;
export const OFF_ASKS_ROOT = 164;
export const OFF_ASKS_BEST = 168;

// Block layout: 16-byte RBNode overhead then the 64-byte RestingOrder payload.
// Offsets are RELATIVE TO the block base (= MARKET_FIXED_SIZE + DataIndex).
const BLOCK_SIZE = 80;
export const OFF_NODE_LEFT = 0;
export const OFF_NODE_RIGHT = 4;
export const OFF_NODE_PARENT = 8;
export const OFF_ORDER_PRICE = 16; // u128 LE = price * 1e18
export const OFF_ORDER_SIZE = 32; // num_base_atoms u64
export const OFF_ORDER_SEQ = 40; // sequence_number u64
export const OFF_ORDER_LAST_VALID_SLOT = 52; // u32
export const OFF_ORDER_IS_BID = 56; // u8
export const OFF_ORDER_TYPE = 57; // u8

/** u32::MAX — the tree/free-list null pointer (state/hypertree.rs). */
export const NIL = 0xffff_ffff;
/** OrderType::Global — draws from a separate global account; a taker halts at it. */
export const ORDER_TYPE_GLOBAL = 3;
/** RestingOrder.last_valid_slot sentinel for "no expiration". */
export const NO_EXPIRATION_LAST_VALID_SLOT = 0;

/**
 * Shipped top-of-book levels per direction. Each level is ~2 cfg words
 * (DataIndex + sequence_number) + one walk iteration; sized against the
 * interpreter's per-order cost (measured in budget.ts / the CU suite). Moves
 * in lockstep with the fragment's unrolled setup (ladder.ts) and the mirror.
 */
export const MANIFEST_MAX_ORDERS = 16;

export interface ManifestOrder {
  /** Byte offset of the order's block within the dynamic region (DataIndex). */
  dataIndex: number;
  /** Monotonic per-order id — the drift-invariant live identity anchor. */
  sequenceNumber: bigint;
}

export interface ManifestWindow {
  /** Best-first resting orders (walk order) — the taker's match sequence. */
  orders: ManifestOrder[];
}

export interface ManifestPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'baseIn' (default) sells base for quote; 'quoteIn' buys base with quote. */
  direction: 'baseIn' | 'quoteIn';
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  baseDecimals: number;
  quoteDecimals: number;
  /** Direction-keyed prepare-declared order windows (see the header). */
  windows: { baseIn: ManifestWindow; quoteIn: ManifestWindow };
}

// --- off-chain red-black-tree helpers over the raw market bytes ---
const nodeBase = (dataIndex: number): number => MARKET_FIXED_SIZE + dataIndex;
const treeLeft = (data: Uint8Array, idx: number): number => Number(readUintLE(data, nodeBase(idx) + OFF_NODE_LEFT, 4));
const treeRight = (data: Uint8Array, idx: number): number => Number(readUintLE(data, nodeBase(idx) + OFF_NODE_RIGHT, 4));
const treeParent = (data: Uint8Array, idx: number): number => Number(readUintLE(data, nodeBase(idx) + OFF_NODE_PARENT, 4));

function isLeftChild(data: Uint8Array, idx: number): boolean {
  const parent = treeParent(data, idx);
  return parent !== NIL && treeLeft(data, parent) === idx;
}

/**
 * The venue's get_next_lower_index (red_black_tree.rs): the in-order
 * predecessor in the tree's Ord, which — because the tree's max is the BEST
 * order (bids Ord by price, asks Ord by inverse price) — is the taker's next
 * match. Every pointer hop draws from the caller's whole-walk budget;
 * unaffordable in-VM.
 */
function nextLower(data: Uint8Array, idx: number, spendHop: SpendHop): number {
  if (idx === NIL) return NIL;
  const left = treeLeft(data, idx);
  if (left !== NIL) {
    let cur = left;
    while (treeRight(data, cur) !== NIL) {
      spendHop();
      cur = treeRight(data, cur);
    }
    return cur;
  }
  let cur = idx;
  while (isLeftChild(data, cur)) {
    spendHop();
    cur = treeParent(data, cur);
  }
  return treeParent(data, cur);
}

/**
 * Walk a book side best-first, collecting the shippable prefix: non-global,
 * non-expiring orders up to MANIFEST_MAX_ORDERS. STOPS at the first global
 * order (the venue's IOC taker halts there without the global accounts) or the
 * first expiring order (the in-VM model carries no clock). Skips zero-size
 * orders (the venue removes them mid-walk) but keeps walking past them.
 * `spendHop` is the whole-walk iteration budget — a market whose tree pointers
 * cycle exhausts it and throws rather than spinning.
 */
function resolveWindow(data: Uint8Array, bestOffset: number, spendHop: SpendHop): ManifestWindow {
  const orders: ManifestOrder[] = [];
  let cur = Number(readUintLE(data, bestOffset, 4));
  while (cur !== NIL && orders.length < MANIFEST_MAX_ORDERS) {
    const base = nodeBase(cur);
    const orderType = data[base + OFF_ORDER_TYPE];
    const lastValidSlot = Number(readUintLE(data, base + OFF_ORDER_LAST_VALID_SLOT, 4));
    if (orderType === ORDER_TYPE_GLOBAL) break; // taker IOC halts at the first global maker
    if (lastValidSlot !== NO_EXPIRATION_LAST_VALID_SLOT) break; // the model carries no clock
    const size = readUintLE(data, base + OFF_ORDER_SIZE, 8);
    if (size > 0n) {
      orders.push({ dataIndex: cur, sequenceNumber: readUintLE(data, base + OFF_ORDER_SEQ, 8) });
    }
    spendHop();
    cur = nextLower(data, cur, spendHop);
  }
  return { orders };
}

function hasDiscriminant(data: Uint8Array): boolean {
  return readUintLE(data, 0, 8) === MARKET_DISCRIMINANT;
}

/**
 * Fetch + gate one Manifest market (see the header for the gate list) and
 * freeze both directions' top-of-book order windows. Read-only against the
 * loader; the whole book is in this one account, so a quote needs no other
 * account.
 */
export async function fetchManifestConfig(load: AccountLoader, pool: Address): Promise<ManifestPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: market account ${pool} not found`);
  if (data.length < MARKET_FIXED_SIZE) {
    throw new Error(`${SLUG}: market ${pool} has ${data.length} bytes, expected >= ${MARKET_FIXED_SIZE}`);
  }
  if (!hasDiscriminant(data)) {
    throw new Error(`${SLUG}: market ${pool} has a foreign discriminant (not a Manifest MarketFixed account)`);
  }

  const codec = getAddressCodec();
  const baseMint = codec.decode(data.subarray(OFF_BASE_MINT, OFF_BASE_MINT + 32));
  const quoteMint = codec.decode(data.subarray(OFF_QUOTE_MINT, OFF_QUOTE_MINT + 32));
  // The on-chain Swap ix here is genuinely Tokenkeg-only (a Token-2022 market
  // needs the optional mint accounts + swap_v2-style plumbing — a per-venue
  // follow-up). So detect the real token program per mint via the shared
  // resolver (data-shape based) instead of the old fragile size check, and
  // SELF-DROP a Token-2022 mint or one carrying an un-routable extension. The
  // drop is expressed as a thrown, clearly-described error — the SvmRoute
  // orchestrator catches a fetchPoolConfig throw and silently drops the venue
  // (the same graceful-degradation path an unsupported direction uses). The
  // LEGACY path is byte-identical to before: a classic mint classifies as
  // Tokenkeg, parses no extensions, and the config is built unchanged.
  const _mints = [baseMint, quoteMint];
  const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
  for (let _i = 0; _i < _mints.length; _i++) {
    const mint = _mints[_i]!;
    const mintData = _mintDatas[_i]!;
    if (mintData === null) throw new Error(`${SLUG}: mint ${mint} of market ${pool} not found`);
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${SLUG}: dropping market ${pool} — mint ${mint} is a Token-2022 mint (the Swap ix is Tokenkeg-only for now)`,
      );
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping market ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  // ONE budget for both sides: the bids and asks trees share the account's
  // block region, so sizing the bound on the whole region covers a full
  // traversal of both of them together (see makeTreeWalkBudget).
  const spendHop = makeTreeWalkBudget(SLUG, Math.floor((data.length - MARKET_FIXED_SIZE) / BLOCK_SIZE));

  return {
    venue: SLUG,
    pool,
    direction: 'baseIn',
    baseMint,
    quoteMint,
    baseVault: codec.decode(data.subarray(OFF_BASE_VAULT, OFF_BASE_VAULT + 32)),
    quoteVault: codec.decode(data.subarray(OFF_QUOTE_VAULT, OFF_QUOTE_VAULT + 32)),
    baseDecimals: data[OFF_BASE_MINT_DECIMALS],
    quoteDecimals: data[OFF_QUOTE_MINT_DECIMALS],
    windows: {
      // base-in sells base -> matches the BIDS; quote-in buys base -> matches the ASKS.
      baseIn: resolveWindow(data, OFF_BIDS_BEST, spendHop),
      quoteIn: resolveWindow(data, OFF_ASKS_BEST, spendHop),
    },
  };
}

/** Family facade for the recipe orchestrator (ladder-only — no v1 adapter, not in the v1 registry). */
export const manifest = {
  slug: SLUG,
  programId: MANIFEST_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchManifestConfig,
};
