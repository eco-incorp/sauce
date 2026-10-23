/**
 * Phoenix CLOB adapter (SvmRoute ladder fragment v2) — an order-book venue,
 * the SAME integration shape as the `manifest` family the SDK barrel already
 * ships (see `manifest`'s ladder for the sibling this file mirrors): the
 * quote is the venue's own taker IOC match, a best-first walk over resting
 * orders SHIPPED by `fetchPhoenixConfig` off-chain and verified LIVE in the
 * fragment. The SDK ships no `phoenix` ladder — this module is new, added
 * directly in this recipe (the established pattern for a venue the SDK
 * doesn't carry, see `the consuming app humidifi venue module`/`tesserav.ts` on their
 * own branches).
 *
 * Phoenix has NO on-chain IDL registry entry, but its market layout is the
 * OPEN-SOURCE Ellipsis Labs `phoenix-v1` crate (github.com/Ellipsis-Labs/
 * phoenix-v1) plus its `sokoban` red-black-tree/node-allocator dependency
 * (github.com/Ellipsis-Labs/sokoban, published as `lib-sokoban`, pinned
 * `=0.3.0` by phoenix-v1's Cargo.toml) — transcribed below, not
 * reverse-engineered. Every offset, discriminant and formula is cited
 * against that source and cross-verified against a REAL mainnet SOL/USDC
 * market dump (`4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg`, 1,723,488
 * bytes — a "large" market-size tier): the discriminant decoded to
 * 8167313896524341111 (matches `phoenix-v1/src/program/accounts.rs`'s own
 * `check_discriminants` test), `base_mint`/`quote_mint` decoded to the real
 * WSOL/USDC mints, and three sample quotes (sell 1/10/50 SOL against the
 * live bid side) landed within a few bps of the live top-of-book price,
 * monotonically worsening with size — see `docs/phoenix-evidence.md`.
 *
 * ── Market account layout ──
 *
 * `MarketHeader` (accounts.rs), `#[repr(C)]`, 576 bytes (matches phoenix-sdk's
 * own MARKET_HEADER_SIZE convention): discriminant(u64)@0, status(u64)@8,
 * MarketSizeParams{bids_size,asks_size,num_seats: u64 each}@16 (24 bytes),
 * TokenParams (decimals:u32, vault_bump:u32, mint:Pubkey, vault:Pubkey — 72
 * bytes) `base_params`@40, `base_lot_size`(u64)@112, `quote_params`
 * (TokenParams)@120, `quote_lot_size`(u64)@192,
 * `tick_size_in_quote_atoms_per_base_unit`(u64)@200, authority(Pubkey)@208,
 * fee_recipient(Pubkey)@240, market_sequence_number(u64)@272,
 * successor(Pubkey)@280, raw_base_units_per_base_unit(u32)@312, padding to
 * 576. Immediately after the header, `FIFOMarket<TraderId,BIDS_SIZE,
 * ASKS_SIZE,NUM_SEATS>` (markets/fifo.rs): a 256-byte `_padding`, then
 * base_lots_per_base_unit(u64)@+256, tick_size_in_quote_lots_per_base_unit
 * (u64)@+264, order_sequence_number(u64)@+272, taker_fee_bps(u64)@+280,
 * collected_quote_lot_fees(u64)@+288, unclaimed_quote_lot_fees(u64)@+296,
 * then `bids`/`asks`/`traders` RedBlackTrees back to back — so EVERY field
 * up to and including the start of `bids` sits at a MARKET-INVARIANT
 * absolute offset (576+256+48 = 880), regardless of BIDS_SIZE/ASKS_SIZE
 * (those only affect how big the bids/asks regions ARE, never where they
 * START). Only the `asks` tree's start depends on `bids_size` (it varies
 * per market-size tier), so that one offset is computed per-pool and baked
 * into `PhoenixPoolConfig`.
 *
 * `RedBlackTree<K,V,MAX_SIZE>` (sokoban/src/red_black_tree.rs): root(u32)@0,
 * padding[u32;3]@4, then `NodeAllocator<RBNode<K,V>,MAX_SIZE,4>`
 * (node_allocator.rs) @16: size(u64)@0, bump_index(u32)@8,
 * free_list_head(u32)@12, then `nodes[MAX_SIZE]` @16 (asserted by the
 * crate's own `assert_proper_alignemnt`) — so a tree's node array starts at
 * `treeOffset + 32`. Each `Node<RBNode<FIFOOrderId,FIFORestingOrder>,4>` is
 * 64 bytes: `registers:[u32;4]` (Left@0/Right@4/Parent@8/Color@12 — `pub
 * const COLOR: u32 = Field::Value as u32` in red_black_tree.rs) then the
 * 48-byte `RBNode` value at +16: `FIFOOrderId{price_in_ticks:u64@0,
 * order_sequence_number:u64@8}` (16 bytes) + `FIFORestingOrder{trader_index:
 * u64@0,num_base_lots:u64@8,last_valid_slot:u64@16,
 * last_valid_unix_timestamp_in_seconds:u64@24}` (32 bytes) = 48. A node's
 * 1-based index `i` (as stored in the Left/Right/Parent registers, and
 * `NodeAllocator::get(i)` reads `nodes[i-1]`) maps to an absolute byte
 * offset of `nodesBase + (i-1)*64`.
 *
 * `FIFOOrderId`'s `Ord` (fifo.rs) is SIDE-DEPENDENT: for a Bid entry,
 * `self < other` iff `self.price_in_ticks > other.price_in_ticks` (higher
 * price sorts first), so `get_min()` on the `bids` tree returns the
 * HIGHEST-price resting bid; for an Ask entry the comparison is the
 * ordinary ascending one, so `get_min()` on `asks` returns the LOWEST-price
 * resting ask. Both are exactly "best resting order" for a taker on that
 * side. The in-order SUCCESSOR of the tree's min (climb via the Parent
 * register exactly like `manifest`'s off-chain `nextLower` walk — standard
 * BST successor, mathematically identical to sokoban's own stack-based
 * forward iterator) visits every further resting order best-first, which is
 * exactly the taker's match order (`match_order`, fifo.rs, always reads
 * `book.get_min()` first and would continue via the same successor chain
 * were the walk not IOC-bounded).
 *
 * ── Taker match / fee math (fifo.rs `match_order` + `place_order_inner`,
 *    quantities.rs is all plain u64/u128, no fixed-point) — TRANSCRIBED,
 *    not approximated ──
 *
 * The taker order is an `OrderPacket::ImmediateOrCancel` "market" order
 * (`price_in_ticks: None` ⇒ `limit_price_in_ticks` = Ticks::MAX for a Bid /
 * Ticks::MIN for an Ask, so it always crosses while the book is non-empty —
 * no on-chain price-floor check to replicate here; the merge's own
 * priceLimit/avgPriceLimit cut rungs upstream of this ladder, exactly like
 * every other family). Exactly one of `num_base_lots`/`num_quote_lots` is
 * set (the other 0):
 * - Bid (buy base, quote in): `base_lot_budget = BaseLots::MAX` (unbounded);
 *   `adjusted_quote_lot_budget` = the FEE-ADJUSTED input —
 *   `adjusted_quote_lot_budget_post_fee_adjustment_for_buys(quote_lots_in *
 *   base_lots_per_base_unit)`, itself
 *   `floor(rawAdjustedQL * u64::MAX / (compute_fee(u64::MAX) + u64::MAX))`
 *   — PROVABLY `<= rawAdjustedQL <= u64::MAX` (the fee-adjustment factor is
 *   always `>= u64::MAX`), so this can never overflow/downcast-fail for any
 *   real `quote_lots_in` — the venue's own `.unwrap_or(u64::MAX)` fallback
 *   for a failed downcast is provably unreachable here, so this module
 *   applies it unconditionally with no sentinel/clamp needed (UNLIKE
 *   `manifest`, whose per-ORDER price*size product can genuinely overflow
 *   u64 for an adversarial resting order — Phoenix's PER-LEVEL product
 *   `price_in_ticks * tick_size_in_quote_lots_per_base_unit *
 *   num_base_lots` is likewise bounded: any order actually resting in the
 *   book already had this SAME product checked at placement time
 *   (`quote_lots_to_lock`), so a live resting order's product can never
 *   overflow either — no SENT-sentinel class needed at all for this
 *   family).
 * - Ask (sell base, base in): `base_lot_budget = base_lots_in` (the exact
 *   input); `adjusted_quote_lot_budget = AdjustedQuoteLots::MAX`
 *   (unbounded).
 *
 * Per opposite-book level (price P ticks, size S lots — `quotedAdjQL = P *
 * tick_size_in_quote_lots_per_base_unit * S`): if `S <= base_budget &&
 * quotedAdjQL <= aq_budget`, the WHOLE level matches (full remove); else the
 * order's own budget binds — `base_to_remove = min(base_budget, aq_budget /
 * (P * tick_size_in_quote_lots_per_base_unit))` (floor div; NEVER a
 * cliff-collapse-to-0 case: `aq_budget`/`base_budget` are both PROVABLY
 * non-negative decreasing accumulators, so `base_to_remove` saturates
 * gracefully at whichever budget binds first) — and the walk terminates.
 *
 * After the walk, `compute_fee(x) = ceil(x * taker_fee_bps / 10000)`
 * (`(x*bps+9999)/10000`, `taker_fee_bps` read LIVE — see below) and
 * `feeLots = ceil(compute_fee(matchedAdjQL) / base_lots_per_base_unit)`
 * (a "round to nearest whole base unit's worth of fee, in lots" —
 * `round_adjusted_quote_lots_up(x)/BLPBU == (x+BLPBU-1)/BLPBU`, since the
 * cancelling `*BLPBU` in `round_..._up`'s own definition and the outer
 * `/BLPBU` collapse to one integer division). Then:
 * - Ask (sell): `quote_lots_out = floor(matchedAdjQL/BLPBU) - feeLots`
 *   (`round_adjusted_quote_lots_down(x)/BLPBU == x/BLPBU`, the same
 *   cancellation); a degenerate (dust) trade where `feeLots` would exceed
 *   the floored lots is clamped to 0 rather than replicating the real
 *   program's u64 underflow abort — see `emitWalk`'s note.
 * - Bid (buy): `quote_lots_in_consumed = ceil(matchedAdjQL/BLPBU) + feeLots`
 *   — always `<= quote_lots_in` (the productive input, for the
 *   `capacityInputVar` booking).
 *
 * `taker_fee_bps` is read LIVE (once per slot, in `emitSetup`) rather than
 * baked at prepare time: nothing in the deployed instruction set mutates it
 * post-initialization (no `ChangeFee`-style admin instruction exists in
 * `PhoenixInstruction`, only `ChangeFeeRecipient`, which moves the payout
 * destination, not the rate) — so baking it would already be safe — but the
 * extra `accountUint` read is one word for a fee-correctness guarantee with
 * no drift-gate downside, unlike the lot-size/tick-size/base_lots_per_base_unit
 * constants below, which never change post-init and stay compile-time
 * literals to save the read.
 *
 * ── Expiry / drift (mirrors `manifest`'s documented window semantics) ──
 *
 * FIFORestingOrder carries `last_valid_slot`/`last_valid_unix_timestamp_in_
 * seconds` (0 = no expiration). Phoenix has NO "global order" concept (that
 * complexity is `manifest`-specific), so the only off-chain window boundary
 * is: stop shipping at the first order with a nonzero expiry field (the
 * in-VM model carries no clock, exactly the class of stop `manifest`'s own
 * window already establishes for its own TIF orders) — the venue may still
 * match a live, unexpired TIF order beyond the shipped prefix (favorable,
 * `minOut` enforced). A shipped order's `order_sequence_number` is the
 * drift-invariant identity anchor (stable across partial fills, unique
 * across the free-list reuse a fill/cancel/eviction causes): the fragment
 * re-reads it live per shipped order and STOPS the walk at the first
 * mismatch, exactly like `manifest`.
 *
 * ── Swap CPI (`PhoenixInstruction::Swap` = 0, instruction.rs) ──
 *
 * Accounts (shank-declared, no seat needed — `Swap` is a pure taker,
 * distinct from `SwapWithFreeFunds`): [0] `phoenix_program` (this program's
 * own id, readonly — Phoenix self-CPIs instruction 15 for event logging),
 * [1] `log_authority` (readonly; the PDA seeds=[b"log"], hardcoded in
 * `phoenix-v1/src/lib.rs` as `7aDTsspkQNGKmrexAN7FLx9oxU3iPczSSvHNggyuqYkR`
 * and asserted there by `phoenix_log_authority::check_pda`), [2] `market`
 * (writable), [3] `trader` (signer, NOT writable — `Swap` never touches the
 * trader's lamports beyond the tx fee itself), [4] `base_account` (writable),
 * [5] `quote_account` (writable), [6] `base_vault` (writable), [7]
 * `quote_vault` (writable), [8] `token_program`. Data: Borsh
 * `[disc=0][OrderPacket::ImmediateOrCancel{...}]` — `ImmediateOrCancel` is
 * variant tag 2 (declaration order in order_schema/order_packet.rs:
 * PostOnly=0, Limit=1, ImmediateOrCancel=2); `side` is `Side::Bid=0`/
 * `Side::Ask=1` (enums.rs); `self_trade_behavior` is `CancelProvide=1`
 * (enums.rs: Abort=0, CancelProvide=1, DecrementTake=2) — chosen over the
 * default-looking `Abort` specifically BECAUSE `Abort` makes `match_order`
 * return `None`, which the processor treats as instruction failure
 * (aborting the whole cook): `CancelProvide` can never abort on a
 * (astronomically unlikely, since the recipe's own `trader` signer never
 * places resting orders here) self-trade, matching this repo's
 * venue-robustness philosophy of never letting one venue's edge case kill
 * the cook. `price_in_ticks: None`, `min_base_lots_to_fill`/
 * `min_quote_lots_to_fill: 0` (Phoenix's OWN partial-fill floor is
 * deliberately disarmed — the recipe's SINGLE terminal outAta-delta check
 * is the sole floor authority across every slot, the solswap/manifest
 * discipline), `match_limit: None`, `client_order_id: 0`,
 * `use_only_deposited_funds: false`, `last_valid_slot`/
 * `last_valid_unix_timestamp_in_seconds: None`.
 *
 * The patched runtime amount is in ATOMS (like every other family's
 * `fill[i]`), but `num_base_lots`/`num_quote_lots` are in LOTS
 * (`base_lot_size`/`quote_lot_size` atoms per lot — NOT 1:1, e.g. the real
 * SOL/USDC market has `base_lot_size = 1_000_000` — unlike every existing
 * family, none of which has a coarser native accounting unit than atoms).
 * `codegen.ts`'s new `SvmRouteSlot.patchDivisorIn` hook (additive, unset
 * for every other family) floor-divides the patched value by the pool's
 * `direction`-appropriate lot size before it is written into the
 * instruction bytes — `the consuming app SVM solver entry` sets it only for `phoenix`
 * slots.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountBytesMap, AccountLoader, PoolConfig } from "../types.js";
import { makeTreeWalkBudget } from "../tree-walk.js";
import type { SpendHop } from "../tree-walk.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "phoenix";

export const PHOENIX_PROGRAM_ID = address("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** MarketHeader — accounts.rs. Fixed 576-byte header preceding the FIFOMarket body. */
const HEADER_SIZE = 576;
/** u64 LE @0 — accounts.rs `check_discriminants` asserts this exact value for MarketHeader. */
export const MARKET_DISCRIMINANT = 8_167_313_896_524_341_111n;
const OFF_BIDS_SIZE = 16;
const OFF_ASKS_SIZE = 24;
const OFF_BASE_DECIMALS = 40;
const OFF_BASE_MINT = 48;
const OFF_BASE_VAULT = 80;
const OFF_BASE_LOT_SIZE = 112;
const OFF_QUOTE_DECIMALS = 120;
const OFF_QUOTE_MINT = 128;
const OFF_QUOTE_VAULT = 160;
const OFF_QUOTE_LOT_SIZE = 192;

// FIFOMarket body (markets/fifo.rs), absolute offsets = HEADER_SIZE + 256 (the
// struct's own leading `_padding: [u64;32]`) + the field's position.
const BODY_FIELDS = HEADER_SIZE + 256; // 832
const OFF_BASE_LOTS_PER_BASE_UNIT = BODY_FIELDS; // 832
const OFF_TICK_SIZE_QUOTE_LOTS = BODY_FIELDS + 8; // 840
export const OFF_TAKER_FEE_BPS = BODY_FIELDS + 24; // 856 — market-invariant, read LIVE
const BIDS_TREE_ROOT = BODY_FIELDS + 48; // 880 — market-invariant (bids ALWAYS starts here)
/** Node array start of the `bids` tree — market-invariant (the allocator header is fixed size). */
export const BIDS_NODES_BASE = BIDS_TREE_ROOT + 32; // 912

/** Node stride: registers[4] (16 bytes) + RBNode{FIFOOrderId(16) + FIFORestingOrder(32)} (48 bytes). */
const NODE_SIZE = 64;
const NODE_OFF_PRICE = 16; // price_in_ticks u64
const NODE_OFF_SEQ = 24; // order_sequence_number u64
const NODE_OFF_SIZE = 40; // num_base_lots u64
const NODE_OFF_LAST_VALID_SLOT = 48; // u64
const NODE_OFF_LAST_VALID_TS = 56; // u64

/** u64::MAX — BaseLots::MAX / AdjustedQuoteLots::MAX (the venue's own "unbounded" budget value). */
const U64_MAX = (1n << 64n) - 1n;

/**
 * Shipped top-of-book levels per direction. Half of manifest's 16 (a
 * heavier per-level walk: two budget checks plus the fee-adjusted-budget
 * setup) — MEASURED (not guessed): 588,522 CU @2 rungs / 831,135 CU @4
 * rungs on the real engine against the checked-in real SOL/USDC fixture
 * (`the consuming app cu e2e test`, `CU_FAMILIES.phoenix` in budget.ts), both
 * comfortably under the ~1.19M admission budget with room for a companion
 * slot. At this depth the shipped bid window alone absorbs ~713 SOL before
 * exhausting (see `docs/phoenix-evidence.md`) — far beyond a typical trade
 * — so 8 is not a binding liquidity constraint at this snapshot; raise it
 * only if a future measurement shows CU headroom AND a real market where 8
 * levels genuinely caps absorption.
 */
export const PHOENIX_MAX_ORDERS = 8;
export interface PhoenixOrder {
  /** 1-based sokoban node index (register value, NOT a byte offset). */
  nodeIndex: number;
  /** Monotonic per-order id — the drift-invariant live identity anchor. */
  orderSequenceNumber: bigint;
}

export interface PhoenixWindow {
  /** Best-first resting orders (walk order) — the taker's match sequence. */
  orders: PhoenixOrder[];
}

export interface PhoenixPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'baseIn' (default) sells base for quote (matches BIDS); 'quoteIn' buys base with quote (matches ASKS). */
  direction: "baseIn" | "quoteIn";
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  baseDecimals: number;
  quoteDecimals: number;
  /** Atoms per base lot (immutable post-init — no admin instruction mutates it). */
  baseLotSize: bigint;
  /** Atoms per quote lot (immutable post-init). */
  quoteLotSize: bigint;
  /** Base lots per whole base unit (immutable post-init). */
  baseLotsPerBaseUnit: bigint;
  /** Quote lots per base unit per tick (immutable post-init). */
  tickSizeInQuoteLotsPerBaseUnit: bigint;
  /** Node array start of the `asks` tree — per-market (depends on `bids_size`). */
  asksNodesBase: number;
  /** Direction-keyed prepare-declared order windows (see the header). */
  windows: { baseIn: PhoenixWindow; quoteIn: PhoenixWindow };
}

/** The direction's window (the ladder adapter and the orchestrator gate read through this). */
export function phoenixWindowFor(cfg: PhoenixPoolConfig): PhoenixWindow {
  return cfg.direction === "baseIn" ? cfg.windows.baseIn : cfg.windows.quoteIn;
}

/** nodesBase for the direction's book side ('baseIn' matches bids, 'quoteIn' matches asks). */
function nodesBaseFor(cfg: PhoenixPoolConfig): number {
  return cfg.direction === "baseIn" ? BIDS_NODES_BASE : cfg.asksNodesBase;
}

function readU64(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]!);
  return v;
}
function readU32(data: Uint8Array, offset: number): number {
  return (
    data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)
  );
}

function hasDiscriminant(data: Uint8Array): boolean {
  return readU64(data, 0) === MARKET_DISCRIMINANT;
}

// ---------------------------------------------------------------------------
// Off-chain red-black-tree walk (standard BST successor via Left/Right/Parent
// registers — mathematically identical to sokoban's own stack-based forward
// iterator; see the header). Every pointer hop draws from the caller's
// whole-walk budget; unaffordable in-VM.
// ---------------------------------------------------------------------------

function nodeAbs(nodesBase: number, nodeIndex: number): number {
  return nodesBase + (nodeIndex - 1) * NODE_SIZE;
}
const regLeft = (data: Uint8Array, nodesBase: number, i: number): number =>
  readU32(data, nodeAbs(nodesBase, i) + 0);
const regRight = (data: Uint8Array, nodesBase: number, i: number): number =>
  readU32(data, nodeAbs(nodesBase, i) + 4);
const regParent = (data: Uint8Array, nodesBase: number, i: number): number =>
  readU32(data, nodeAbs(nodesBase, i) + 8);

function findMin(data: Uint8Array, nodesBase: number, idx: number, spendHop: SpendHop): number {
  let cur = idx;
  while (regLeft(data, nodesBase, cur) !== 0) {
    spendHop();
    cur = regLeft(data, nodesBase, cur);
  }
  return cur;
}

function successor(data: Uint8Array, nodesBase: number, idx: number, spendHop: SpendHop): number {
  const right = regRight(data, nodesBase, idx);
  if (right !== 0) return findMin(data, nodesBase, right, spendHop);
  let cur = idx;
  for (;;) {
    spendHop();
    const parent = regParent(data, nodesBase, cur);
    if (parent === 0) return 0;
    if (regLeft(data, nodesBase, parent) === cur) return parent;
    cur = parent;
  }
}

/**
 * Walk a book side best-first from its tree root, collecting the shippable
 * prefix: up to PHOENIX_MAX_ORDERS non-expiring (last_valid_slot === 0 AND
 * last_valid_unix_timestamp_in_seconds === 0), positive-size orders. Stops at
 * the first EXPIRING order (the in-VM model carries no clock — mirrors
 * manifest's identical stop) or the first zero-size tombstone (v1 never
 * actually leaves one mid-tree per fifo.rs's own comments, but skip-and-
 * continue costs nothing and matches manifest's defensive posture).
 * `spendHop` is the whole-walk iteration budget — a market whose tree
 * registers cycle exhausts it and throws rather than spinning.
 */
function resolveWindow(
  data: Uint8Array,
  root: number,
  nodesBase: number,
  spendHop: SpendHop,
): PhoenixWindow {
  const orders: PhoenixOrder[] = [];
  if (root === 0) return { orders };
  let cur = findMin(data, nodesBase, root, spendHop);
  while (cur !== 0 && orders.length < PHOENIX_MAX_ORDERS) {
    const base = nodeAbs(nodesBase, cur);
    const lastValidSlot = readU64(data, base + NODE_OFF_LAST_VALID_SLOT);
    const lastValidTs = readU64(data, base + NODE_OFF_LAST_VALID_TS);
    if (lastValidSlot !== 0n || lastValidTs !== 0n) break; // TIF order — the model carries no clock
    const size = readU64(data, base + NODE_OFF_SIZE);
    if (size > 0n) {
      orders.push({ nodeIndex: cur, orderSequenceNumber: readU64(data, base + NODE_OFF_SEQ) });
    }
    spendHop();
    cur = successor(data, nodesBase, cur, spendHop);
  }
  return { orders };
}

/**
 * Fetch + gate one Phoenix market (account size/discriminant, classic-SPL
 * mints — the Swap ix has no separate mint accounts, so it is Tokenkeg-only,
 * mirroring manifest's identical gate) and freeze both directions' top-of-book
 * order windows. Read-only against the loader.
 */
export async function fetchPhoenixConfig(
  load: AccountLoader,
  pool: Address,
): Promise<PhoenixPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: market ${pool} not found`);
  if (data.length < HEADER_SIZE + 256 + 48) {
    throw new Error(
      `${SLUG}: market ${pool} has ${data.length} bytes, too small for a MarketHeader + FIFOMarket body`,
    );
  }
  if (!hasDiscriminant(data)) {
    throw new Error(
      `${SLUG}: market ${pool} has a foreign discriminant (not a Phoenix MarketHeader account)`,
    );
  }

  const bidsSize = readU64(data, OFF_BIDS_SIZE);
  const asksSize = readU64(data, OFF_ASKS_SIZE);
  if (bidsSize <= 0n || asksSize <= 0n) {
    throw new Error(
      `${SLUG}: market ${pool} has non-positive book capacity (bids ${bidsSize}, asks ${asksSize})`,
    );
  }
  const bidsTreeSize = 32 + Number(bidsSize) * NODE_SIZE;
  const asksTreeRoot = BIDS_TREE_ROOT + bidsTreeSize;
  const asksNodesBase = asksTreeRoot + 32;

  const baseMint = decodeAddress(data, OFF_BASE_MINT);
  const quoteMint = decodeAddress(data, OFF_QUOTE_MINT);
  // The Swap ix carries no mint account (no transfer_checked plumbing) — it is
  // Tokenkeg-only. Detect the real token program per mint via the shared
  // data-shape resolver instead of a fragile size check, and SELF-DROP a
  // Token-2022 mint or one carrying an un-routable extension. The thrown,
  // clearly-described error IS the graceful drop (SvmRoute catches a
  // fetchPoolConfig throw and drops the venue). The LEGACY path is
  // byte-identical to before: a classic 82-byte mint classifies as Tokenkeg,
  // parses no extensions, and the config is built unchanged. An unreadable mint
  // falls back to the legacy assumption (keeps fixture-only tests green).
  const mints = [baseMint, quoteMint];
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

  const bidsRoot = readU32(data, BIDS_TREE_ROOT);
  const asksRoot = readU32(data, asksTreeRoot);
  // ONE budget for both sides, sized on how many nodes the account can PHYSICALLY
  // hold — never on the declared bids_size/asks_size, which a corrupt account
  // sets freely.
  const spendHop = makeTreeWalkBudget(
    SLUG,
    Math.floor((data.length - BIDS_NODES_BASE) / NODE_SIZE),
  );

  return {
    venue: SLUG,
    pool,
    direction: "baseIn",
    baseMint,
    quoteMint,
    baseVault: decodeAddress(data, OFF_BASE_VAULT),
    quoteVault: decodeAddress(data, OFF_QUOTE_VAULT),
    baseDecimals: data[OFF_BASE_DECIMALS]!,
    quoteDecimals: data[OFF_QUOTE_DECIMALS]!,
    baseLotSize: readU64(data, OFF_BASE_LOT_SIZE),
    quoteLotSize: readU64(data, OFF_QUOTE_LOT_SIZE),
    baseLotsPerBaseUnit: readU64(data, OFF_BASE_LOTS_PER_BASE_UNIT),
    tickSizeInQuoteLotsPerBaseUnit: readU64(data, OFF_TICK_SIZE_QUOTE_LOTS),
    asksNodesBase,
    windows: {
      // base-in sells base -> matches BIDS; quote-in buys base -> matches ASKS.
      baseIn: resolveWindow(data, bidsRoot, BIDS_NODES_BASE, spendHop),
      quoteIn: resolveWindow(data, asksRoot, asksNodesBase, spendHop),
    },
  };
}

function decodeAddress(data: Uint8Array, offset: number): Address {
  // Base58-free decode via a tiny local codec would be overkill — reuse the
  // same approach every other adapter uses via @solana/kit's AddressCodec at
  // the call site would need an import; inline the standard base58 encode
  // instead to avoid a second dependency edge for 32 bytes.
  return b58EncodeAddress(data.subarray(offset, offset + 32));
}

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58EncodeAddress(bytes: Uint8Array): Address {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);
  let out = "";
  while (num > 0n) {
    const rem = num % 58n;
    num /= 58n;
    out = B58_ALPHABET[Number(rem)] + out;
  }
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }
  return address("1".repeat(leadingZeros) + out);
}

/** The Phoenix venue: an on-chain central limit order book. */
export const phoenix = {
  slug: SLUG,
  programId: PHOENIX_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchPhoenixConfig,
};

// ---------------------------------------------------------------------------
// TS mirror of the emitted walk — transcribes fifo.rs `match_order` exactly
// (see the module header for the full derivation). ONE function serves both
// directions: the loop body is identical, only the initial budgets and the
// in/out atom mapping differ.
// ---------------------------------------------------------------------------

interface PhoenixLevel {
  price: bigint; // price_in_ticks
  size: bigint; // num_base_lots
}

function phoenixConfig(cfg: PoolConfig): PhoenixPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as PhoenixPoolConfig;
}

function readLevels(
  market: Uint8Array,
  orders: readonly PhoenixOrder[],
  nodesBase: number,
): PhoenixLevel[] {
  const levels: PhoenixLevel[] = [];
  for (const order of orders) {
    const base = nodeAbs(nodesBase, order.nodeIndex);
    const seqLive = readU64(market, base + NODE_OFF_SEQ);
    if (seqLive !== order.orderSequenceNumber) break; // identity mismatch — stop the walk
    levels.push({
      price: readU64(market, base + NODE_OFF_PRICE),
      size: readU64(market, base + NODE_OFF_SIZE),
    });
  }
  return levels;
}

function effectiveLevels(
  cfg: PhoenixPoolConfig,
  state: AccountBytesMap,
  params: readonly bigint[],
): PhoenixLevel[] {
  const market = state[cfg.pool];
  if (market === undefined)
    throw new Error(`${SLUG} ladder reference is missing account ${cfg.pool}`);
  const nb = Number(params[0] ?? 0n);
  const orders: PhoenixOrder[] = [];
  for (let k = 0; k < nb && k < PHOENIX_MAX_ORDERS; k++) {
    orders.push({ nodeIndex: Number(params[1 + 2 * k]), orderSequenceNumber: params[2 + 2 * k]! });
  }
  return readLevels(market, orders, nodesBaseFor(cfg));
}

function computeFee(x: bigint, feeBps: bigint): bigint {
  return (x * feeBps + 9999n) / 10000n;
}

function buyBudget(quoteLotsIn: bigint, blpbu: bigint, feeBps: bigint): bigint {
  const rawAdj = quoteLotsIn * blpbu;
  const feeAdjMax = computeFee(U64_MAX, feeBps);
  const feeAdjustment = feeAdjMax + U64_MAX;
  return (rawAdj * U64_MAX) / feeAdjustment;
}

/**
 * Exact mirror of the emitted fragment given the SAME cfg + params + live fee
 * the blob was prepared with. `readFee` supplies `taker_fee_bps` from the SAME
 * live account bytes (the fragment reads it live too — see the module header).
 */
export function referenceQuote(
  base: PoolConfig,
  state: AccountBytesMap,
  params: readonly bigint[],
): (x: bigint) => bigint {
  const cfg = phoenixConfig(base);
  const market = state[cfg.pool];
  if (market === undefined)
    throw new Error(`${SLUG} ladder reference is missing account ${cfg.pool}`);
  const feeBps = readU64(market, OFF_TAKER_FEE_BPS);
  const levels = effectiveLevels(cfg, state, params);
  const baseIn = cfg.direction === "baseIn";
  const blpbu = cfg.baseLotsPerBaseUnit;
  const T = cfg.tickSizeInQuoteLotsPerBaseUnit;

  return (x: bigint): bigint => {
    if (x <= 0n) return 0n;
    const lotsIn = baseIn ? x / cfg.baseLotSize : x / cfg.quoteLotSize;
    if (lotsIn <= 0n) return 0n;
    let rb = baseIn ? lotsIn : U64_MAX;
    let ra = baseIn ? U64_MAX : buyBudget(lotsIn, blpbu, feeBps);
    let mb = 0n;
    let mq = 0n;
    for (let k = 0; k < levels.length && rb > 0n && ra > 0n; k++) {
      const level = levels[k]!;
      const den = level.price * T;
      const q = den * level.size;
      if (level.size <= rb && q <= ra) {
        mb += level.size;
        mq += q;
        rb -= level.size;
        ra -= q;
      } else {
        const btr = rb < ra / den ? rb : ra / den;
        mb += btr;
        mq += den * btr;
        break;
      }
    }
    const feeLots = (computeFee(mq, feeBps) + blpbu - 1n) / blpbu;
    if (baseIn) {
      let quoteLotsOut = mq / blpbu - feeLots;
      if (quoteLotsOut < 0n) quoteLotsOut = 0n;
      return quoteLotsOut * cfg.quoteLotSize;
    }
    return mb * cfg.baseLotSize;
  };
}

/** Pointwise mirror of the emitted `lx` capacity booking — the productive gross input consumed. */
export function referenceCapacities(
  base: PoolConfig,
  state: AccountBytesMap,
  params: readonly bigint[],
): (grid: readonly bigint[]) => bigint[] {
  const cfg = phoenixConfig(base);
  const market = state[cfg.pool];
  if (market === undefined)
    throw new Error(`${SLUG} ladder reference is missing account ${cfg.pool}`);
  const feeBps = readU64(market, OFF_TAKER_FEE_BPS);
  const levels = effectiveLevels(cfg, state, params);
  const baseIn = cfg.direction === "baseIn";
  const blpbu = cfg.baseLotsPerBaseUnit;
  const T = cfg.tickSizeInQuoteLotsPerBaseUnit;

  return (grid: readonly bigint[]): bigint[] =>
    grid.map((g) => {
      if (g <= 0n) return 0n;
      const lotsIn = baseIn ? g / cfg.baseLotSize : g / cfg.quoteLotSize;
      if (lotsIn <= 0n) return 0n;
      let rb = baseIn ? lotsIn : U64_MAX;
      let ra = baseIn ? U64_MAX : buyBudget(lotsIn, blpbu, feeBps);
      let mb = 0n;
      let mq = 0n;
      for (let k = 0; k < levels.length && rb > 0n && ra > 0n; k++) {
        const level = levels[k]!;
        const den = level.price * T;
        const q = den * level.size;
        if (level.size <= rb && q <= ra) {
          mb += level.size;
          mq += q;
          rb -= level.size;
          ra -= q;
        } else {
          const btr = rb < ra / den ? rb : ra / den;
          mb += btr;
          mq += den * btr;
          break;
        }
      }
      if (baseIn) return mb * cfg.baseLotSize;
      const feeLots = (computeFee(mq, feeBps) + blpbu - 1n) / blpbu;
      return ((mq + blpbu - 1n) / blpbu + feeLots) * cfg.quoteLotSize;
    });
}

/** Depth for the relative filter: the shipped top-of-book aggregate (atoms). */
export function depthReserves(
  base: PoolConfig,
  state: AccountBytesMap,
): { reserveIn: bigint; reserveOut: bigint } {
  const cfg = phoenixConfig(base);
  const market = state[cfg.pool];
  if (market === undefined) throw new Error(`${SLUG} ladder depth is missing account ${cfg.pool}`);
  const baseIn = cfg.direction === "baseIn";
  const levels = readLevels(market, phoenixWindowFor(cfg).orders, nodesBaseFor(cfg));
  const T = cfg.tickSizeInQuoteLotsPerBaseUnit;
  let reserveInLots = 0n;
  let reserveOutLots = 0n;
  for (const level of levels) {
    const quoteLots = level.price * T * level.size;
    if (baseIn) {
      reserveInLots += level.size;
      reserveOutLots += quoteLots / cfg.baseLotsPerBaseUnit;
    } else {
      reserveInLots += quoteLots / cfg.baseLotsPerBaseUnit;
      reserveOutLots += level.size;
    }
  }
  return baseIn
    ? { reserveIn: reserveInLots * cfg.baseLotSize, reserveOut: reserveOutLots * cfg.quoteLotSize }
    : { reserveIn: reserveInLots * cfg.quoteLotSize, reserveOut: reserveOutLots * cfg.baseLotSize };
}
