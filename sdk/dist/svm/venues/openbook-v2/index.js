/**
 * OpenBook V2 — a permissionless CLOB (Serum/OpenBook lineage), manifest-shaped:
 * a k-level best-first walk over shipped resting orders, ship-and-verify
 * exactly like `manifest` (see `@eco-incorp/sauce-sdk/svm`'s manifest ladder),
 * but over a genuinely DIFFERENT on-chain layout — OpenBook keeps the two
 * order-book sides in their OWN accounts (BookSide), not embedded in the
 * market, and settles via a real Anchor CPI (`placeTakeOrder`) rather than a
 * self-contained custom instruction.
 *
 * Program id opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb. Layout — FREE from
 * the on-chain IDL (github.com/openbook-dex/openbook-v2, `idl/openbook_v2.json`)
 * and independently BYTE-VERIFIED against the real Market/BookSide struct
 * definitions (every offset below re-derived field-by-field from the IDL and
 * cross-checked against `const_assert_eq!(size_of::<BookSide>(), 90944)` in
 * `programs/openbook-v2/src/state/orderbook/bookside.rs` and the 848-byte
 * on-chain `dataSize` filter — both match exactly):
 *
 * Market account (848 bytes total, INCLUDING the 8-byte Anchor discriminator
 * at @0): bump@8, baseDecimals@9, quoteDecimals@10, bids@200, asks@232,
 * eventHeap@264, oracleA@296 (NonZeroPubkeyOption — 32 bytes, zero = None),
 * oracleB@328, quoteLotSize@448 (i64), baseLotSize@456 (i64), makerFee@480
 * (i64, ppm; >=0 means NO taker-fee rebate to the maker, i.e. no discount to
 * model — see the fee section below), takerFee@488 (i64, ppm, always >= 0),
 * baseMint@576, quoteMint@608, marketBaseVault@640, marketQuoteVault@680;
 * openOrdersAdmin@88 and timeExpiry@48 gate participation (see fetchPoolConfig).
 *
 * BookSide account (one PER SIDE — bids and asks are SEPARATE accounts, unlike
 * manifest's single self-contained market): roots[2]@8 (OrderTreeRoot =
 * {maybeNode: u32, leafCount: u32}, 8 bytes each — index 0 is the `Fixed`
 * order tree, index 1 `OraclePegged`), nodes (OrderTreeNodes) starting @312;
 * within OrderTreeNodes the `nodes: [AnyNode; 1024]` array itself starts at a
 * FURTHER +528 offset (orderTreeType(1)+padding(3)+bumpIndex(4)+freeListLen(4)+
 * freeListHead(4)+reserved(512)), so a tree-node absolute offset is
 * `840 + nodeIndex*88` (AnyNode = tag(1)+data(87), 88 bytes; a LeafNode's
 * `key` (u128 LE) sits at nodeOffset+8, `quantity` (i64) at nodeOffset+56,
 * `timeInForce` (u16) at nodeOffset+2). Total 90952 bytes (312 + 90640),
 * matching size_of::<BookSide>()=90944 plus the 8-byte discriminator exactly.
 *
 * THE LADDER IS THE FIXED-TREE ONLY, best-first over the FULL 128-BIT KEY (not
 * price alone): `key = (price_lots << 64) | tie_break`, and per
 * bookside.rs's own doc comment ("smallest to highest for asks; highest to
 * smallest for bids") ties at one price level still have a real time-priority
 * order the venue enforces — VALIDATED empirically (see below): sorting by
 * price_lots alone picks the WRONG subset of same-priced orders whenever a
 * price level is shared by more than the shipped window's order count,
 * silently under-filling a "saturate the whole window" cook (measured on a
 * REAL mainnet book with 14 same-priced bid levels behind a 4-order window).
 * OraclePegged-tree liquidity is NEVER modelled (the effective price of a
 * pegged order depends on a live oracle read this ladder does not perform) —
 * this is a strict UNDERESTIMATE (the real walk can only deliver >= what this
 * ladder predicts on a book that also carries pegged makers), never a
 * favourable-error risk. Orders with `timeInForce != 0` (can expire) are
 * dropped from the shipped window entirely at prepare time — the real venue
 * actively prunes expired orders out of the match (`DROP_EXPIRED_ORDER_LIMIT`
 * in book.rs), so counting one at prepare time and having it vanish by cook
 * time would silently overstate liquidity; TIF=0 (GTC) orders can only be
 * removed by a fill or a cancel, both already covered by the live key-match
 * self-drop below.
 *
 * PER-ORDER LIVE DRIFT CHECK: the fragment ships (nodeOffset, key, priceLots)
 * per level and re-reads the LIVE 128-bit key at nodeOffset+8 (one 16-byte
 * accountUint, same width class as manifest's own price read) — an exact
 * match proves the slot still holds THE SAME resting order (key encodes
 * price AND placement order; free-list slot reuse after a fill/cancel gets a
 * fresh key), then re-reads LIVE quantity (order sizes only ever shrink while
 * resting, never grow). A mismatch STOPS the walk at that level (the same
 * class as manifest's sequence-number check / whirlpool's missing-tick gate).
 *
 * MATCH MATH — restricted to exactly what `placeTakeOrder` (Market order
 * type, no OpenOrdersAccount) actually executes, independently re-derived
 * from `programs/openbook-v2/src/{state/orderbook/book.rs,
 * instructions/place_take_order.rs}` and EMPIRICALLY VALIDATED bit-exact
 * against the REAL openbook-v2 binary (dumped from mainnet-beta) executing
 * on REAL mainnet Market/BookSide state via LiteSVM, at 3+ sizes per
 * direction (small / medium / saturating-the-whole-shipped-window) AND with
 * a realistic nonzero taker/maker fee (a market's `takerFee`/`makerFee` are
 * per-market constants — the fee arithmetic below was validated by patching
 * a real market's fee fields to nonzero and re-running the same real CPI):
 *
 * - baseIn (sell base, taker side = Ask, opposes the BIDS tree, best = HIGHEST
 *   key first): `max_base_lots` is the real constraint (uncapped quote side);
 *   walk full-or-partial matches best-first; `quoteTakenNative = Σ(matchBase
 *   * priceLots) * quoteLotSize`; a market's maker rebate
 *   (`market.maker_fee < 0` only — makerRebatePpm is 0 whenever makerFee is
 *   non-negative, the common case, PRE-COMPUTED at prepare time so the
 *   fragment never branches on the sign) nets OFF the taker's proceeds:
 *   `output = quoteTakenNative - floor(quoteTakenNative * makerRebatePpm / 1e6)`.
 *   Surprisingly (confirmed via the REAL CPI, not just the source read): the
 *   ASK-side settlement in `place_take_order` does NOT separately deduct
 *   `takerFee` from the taker's quote proceeds — only `makerRebatePpm` (a
 *   distinct, usually-zero, per-market negative-maker-fee rebate) nets off
 *   the literal token transfer; `takerFee` only feeds `market.fees_accrued`
 *   bookkeeping in this instruction path, not this instruction's OWN token
 *   movement. Do not "fix" this to also subtract takerFee — that would
 *   silently move the quote OFF the value the real CPI settles.
 * - quoteIn (buy base, taker side = Bid, opposes the ASKS tree, best = LOWEST
 *   key first): the real constraint is quote, applied via OpenBook's own
 *   `subtract_taker_fees` UPFRONT budget shrink — `remainingQuoteLots =
 *   floor(floor(x / quoteLotSize) * 1e6 / (1e6 + takerFeePpm))` — this is
 *   the ONLY place takerFee enters a quoteIn quote (the taker's effective
 *   buying power is reduced up front; there is no separate fee line-item
 *   subtracted from the delivered base). `output = ΣmatchBase * baseLotSize`
 *   (no further adjustment); the actual quote DEBITED (`consumedInput`, what
 *   the merge's capacityInputVar reports) is `Σ(matchBase*priceLots)*
 *   quoteLotSize + floor(that * makerRebatePpm / 1e6)` — i.e. even a fully
 *   absorbed (non-capacity-bound) quoteIn fill structurally consumes LESS
 *   than the caller's nominal `x` by the taker-fee fraction: this is NOT a
 *   capacity artefact, it is the real per-trade fee tax, and reporting it
 *   honestly (rather than pretending consumedInput===x whenever the book has
 *   depth) is what capacityInputVar's contract calls for.
 * Both walks self-cap (SATURATE at the shipped window's real depth) rather
 * than collapse to 0 past capacity — the same contract meteora-damm-v2 /
 * orca-legacy-token-swap / manifest all fixed for the identical −788.8bps
 * class of hazard: `capacityInputVar` always reports the PRODUCTIVE input
 * actually absorbed, never the raw (possibly-unreachable) grid span.
 *
 * CPI: `placeTakeOrder` (Anchor disc `sha256("global:place_take_order")[..8]`),
 * PlaceOrderType::Market (index 3 — ignores `price_lots`/the `priceLots` arg
 * entirely and matches at ANY price up to the size caps, exactly like
 * manifest's own `out_atoms=1`/no-independent-price-floor philosophy — the
 * recipe's own minOut/priceLimit are the real floor, not a per-CPI price
 * bound) with `limit` (max maker orders touched) baked to the shipped order
 * count — CRITICAL: a looser `limit` lets the real walk continue matching
 * PAST the shipped window (measured directly: a `limit` bigger than the
 * window size delivered MORE than this ladder ever quoted, a real but
 * unaccounted-for surplus that would desync the merge's own bookkeeping of
 * what this slot consumed). `side`/`orderType`/the uncapped opposite-side cap
 * are baked into the prefix/suffix (never runtime-patched — none of them
 * depend on the traded amount); the ONE runtime-patched u64 is
 * `max_base_lots` (baseIn) or `max_quote_lots_including_fees` (quoteIn).
 *
 * THE ATOMS-VS-LOTS PATCH GAP (why `fill[slot]` gets reassigned in
 * emitFinalQuote): the `patch: 'in'` amount convention always writes the merge's
 * raw ATOM-denominated fill share verbatim (`le8(fill[slot])`, see
 * codegen.ts) — every existing venue's CPI amount field IS atom-denominated,
 * so this has never needed a conversion hook. OpenBook's `max_base_lots`/
 * `max_quote_lots_including_fees` are LOT-denominated (a market-specific
 * power-of-ten divisor), so the raw atom count is the WRONG value to write
 * there. There is no venue-supplied transform in the patch path, so
 * `emitFinalQuote`'s LAST emitted statement reassigns the shared `fill[slot]`
 * local itself (`fill[slot] = fill[slot] / lotSizeConst`) — AFTER computing
 * this slot's predicted-output quote (which reads the ORIGINAL atom value
 * first) and BEFORE codegen's own `if (fill[slot] > 0 && p[slot] > 0)` CPI
 * guard / `le8(fill[slot])` patch line run (both execute in a later,
 * strictly-after codegen pass over all slots — see codegen.ts's two
 * sequential `slots.forEach` loops). This is SOUND for every consumer that
 * matters (the minOut/predicted-output checks and the terminal realized-delta
 * floor never read `fill[]`, only `p[i]`/the outAta delta) with ONE disclosed
 * side effect: the raw returndata's `fill[slot]` word reports LOTS, not
 * atoms, for an engaged openbook-v2 slot (every other slot's `fill[]` stays
 * atom-denominated) — a caller reconciling `Σfill[i] <= amountIn` numerically
 * must special-case this venue's slot the same way it would need to for any
 * lot-quantised venue's *executed* size not equalling its *offered* size.
 *
 * Both directions and the atoms/lots patch were EMPIRICALLY VALIDATED end to
 * end (LiteSVM + the real dumped openbook-v2.so, real mainnet Market/
 * BookSide/vault state, a real user ATA pair) at 3+ sizes per direction,
 * including full-window saturation and a realistic nonzero fee — see
 * test/svm/venues/openbook-v2.test.ts and the real-CPI suite.
 *
 * Gates (self-drop, named errors caught by the orchestrator's TOCTOU):
 * - wrong account size (not 848 for the market, not 90952 for a BookSide) —
 *   fetch-time, an unrelated/stale/upgraded account layout;
 * - `openOrdersAdmin` configured (nonzero) — this recipe carries no
 *   third-party admin signer, so such a market can never be taken via
 *   `placeTakeOrder` from here; fetch-time gate;
 * - `timeExpiry != 0 && now >= timeExpiry` — an expired market; the FAMILIES
 *   gate (mirrors meteora-damm-v2's activation-point pattern, which also
 *   needs `now` and so cannot live in fetchPoolConfig's own signature);
 * - a direction with NO shippable Fixed-tree TIF=0 orders — `SvmWindowDriftError`,
 *   wired via the FAMILIES gate exactly like manifest's empty-window case.
 */
import { address } from '@solana/kit';
import { readUintLE } from '../math.js';
const SLUG = 'openbook-v2';
export const OPENBOOK_V2_PROGRAM_ID = address('opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb');
export const MARKET_ACCOUNT_SIZE = 848;
export const BOOKSIDE_ACCOUNT_SIZE = 90952;
/** Absolute byte offset of `nodes[0]` within a BookSide account (312 + 528). */
const NODES_BASE = 840;
/** Size in bytes of one AnyNode / tree-array slot. */
const NODE_SIZE = 88;
const TAG_INNER = 1;
const TAG_LEAF = 2;
/** Offsets within a LeafNode-tagged AnyNode (relative to the node's own base). */
const OFF_LEAF_TIF = 2;
const OFF_LEAF_KEY = 8;
/** Shipped resting-order window depth per direction — a heavy fixed setup cost (unrolled live
 * reads over a 90KB BookSide account), same 'stable'/degrade-first class as manifest/whirlpool. */
export const OPENBOOK_V2_MAX_ORDERS = 4;
/** Two's-complement i64 read (readUintLE is unsigned-only) — needed for `makerFee`, which the
 * venue documents as signable (`maker_fee < 0` means part of the taker fee rebates to the maker). */
function readInt64LE(data, offset) {
    const raw = readUintLE(data, offset, 8);
    const SIGN_BIT = 1n << 63n;
    return raw >= SIGN_BIT ? raw - (1n << 64n) : raw;
}
function readPubkeyIsZero(data, offset) {
    for (let i = 0; i < 32; i++)
        if (data[offset + i] !== 0)
            return false;
    return true;
}
/** Best-first order over the FULL 128-bit key: descending for bids (highest key first), ascending
 * for asks (lowest key first) — see the header's bookside.rs citation for why price alone is unsafe. */
function sortBestFirst(orders, descending) {
    const sorted = [...orders].sort((a, b) => {
        if (a.key === b.key)
            return 0;
        if (descending)
            return a.key > b.key ? -1 : 1;
        return a.key < b.key ? -1 : 1;
    });
    return sorted;
}
/** Walks the Fixed order tree (root index 0) of a BookSide account, collecting every LeafNode with
 * timeInForce === 0 (see the header: TIF>0 orders are dropped rather than modelled). */
function walkFixedTree(data) {
    const maybeNode = readUintLE(data, 8, 4);
    const leafCount = readUintLE(data, 12, 4);
    const out = [];
    if (leafCount === 0n)
        return out;
    const stack = [Number(maybeNode)];
    let visited = 0;
    const BOUND = 4096; // 1024 slots, generous bound against a malformed/cyclic tree
    while (stack.length > 0) {
        if (++visited > BOUND)
            throw new Error(`${SLUG}: BookSide tree walk exceeded ${BOUND} visits — refusing to loop`);
        const idx = stack.pop();
        const nodeOffset = NODES_BASE + idx * NODE_SIZE;
        const tag = Number(readUintLE(data, nodeOffset, 1));
        if (tag === TAG_LEAF) {
            const tif = Number(readUintLE(data, nodeOffset + OFF_LEAF_TIF, 2));
            if (tif !== 0)
                continue;
            const key = readUintLE(data, nodeOffset + OFF_LEAF_KEY, 16);
            const priceLots = key >> 64n;
            out.push({ nodeOffset, key, priceLots });
        }
        else if (tag === TAG_INNER) {
            const childrenOff = nodeOffset + 1 + 3 + 4 + 16;
            stack.push(Number(readUintLE(data, childrenOff, 4)));
            stack.push(Number(readUintLE(data, childrenOff + 4, 4)));
        }
        // Uninitialized / FreeNode / LastFreeNode: dead end, nothing to do.
    }
    return out;
}
export async function fetchOpenBookV2Config(load, pool) {
    const market = await load(pool);
    if (market === null)
        throw new Error(`${SLUG} market ${pool} does not exist`);
    if (market.length !== MARKET_ACCOUNT_SIZE) {
        throw new Error(`${SLUG} market ${pool} has unexpected size ${market.length} (want ${MARKET_ACCOUNT_SIZE})`);
    }
    if (!readPubkeyIsZero(market, 88)) {
        throw new Error(`${SLUG} market ${pool} has a configured openOrdersAdmin — no third-party signer available`);
    }
    const timeExpiry = readInt64LE(market, 48);
    const baseDecimals = Number(readUintLE(market, 9, 1));
    const quoteDecimals = Number(readUintLE(market, 10, 1));
    const bidsAccount = decodeAddressFrom(market, 200);
    const asksAccount = decodeAddressFrom(market, 232);
    const eventHeap = decodeAddressFrom(market, 264);
    const oracleAZero = readPubkeyIsZero(market, 296);
    const oracleBZero = readPubkeyIsZero(market, 328);
    const oracleA = oracleAZero ? undefined : decodeAddressFrom(market, 296);
    const oracleB = oracleBZero ? undefined : decodeAddressFrom(market, 328);
    const quoteLotSize = readUintLE(market, 448, 8);
    const baseLotSize = readUintLE(market, 456, 8);
    const makerFeeRaw = readInt64LE(market, 480);
    const takerFeePpm = readUintLE(market, 488, 8); // always >= 0 by the venue's own invariant
    const makerRebatePpm = makerFeeRaw >= 0n ? 0n : -makerFeeRaw;
    const baseMint = decodeAddressFrom(market, 576);
    const quoteMint = decodeAddressFrom(market, 608);
    const marketBaseVault = decodeAddressFrom(market, 640);
    const marketQuoteVault = decodeAddressFrom(market, 680);
    const marketAuthority = decodeAddressFrom(market, 16);
    const bidsData = await load(bidsAccount);
    const asksData = await load(asksAccount);
    if (bidsData === null || bidsData.length !== BOOKSIDE_ACCOUNT_SIZE) {
        throw new Error(`${SLUG} market ${pool} bids account is missing or the wrong size`);
    }
    if (asksData === null || asksData.length !== BOOKSIDE_ACCOUNT_SIZE) {
        throw new Error(`${SLUG} market ${pool} asks account is missing or the wrong size`);
    }
    const bidsWindow = sortBestFirst(walkFixedTree(bidsData), true).slice(0, OPENBOOK_V2_MAX_ORDERS);
    const asksWindow = sortBestFirst(walkFixedTree(asksData), false).slice(0, OPENBOOK_V2_MAX_ORDERS);
    return {
        venue: SLUG,
        pool,
        direction: 'baseIn',
        baseMint,
        quoteMint,
        bidsAccount,
        asksAccount,
        eventHeap,
        marketBaseVault,
        marketQuoteVault,
        marketAuthority,
        baseDecimals,
        quoteDecimals,
        baseLotSize,
        quoteLotSize,
        takerFeePpm,
        makerRebatePpm,
        timeExpiry,
        oracleA,
        oracleB,
        windows: { baseIn: { orders: bidsWindow }, quoteIn: { orders: asksWindow } },
    };
}
// --- account address decode (32 raw bytes -> base58 Address) --------------
// The SDK barrel does not re-export @solana/kit's address codec, and pulling
// in @solana/kit's getAddressCodec here would be an extra direct dependency
// this recipe does not otherwise need for a pure-decode path — bs58-encode
// the 32 raw bytes ourselves (the SAME alphabet/algorithm @solana/kit uses)
// and validate through `address()`, which is already imported.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let leadingZeros = 0;
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++)
        leadingZeros++;
    let out = '1'.repeat(leadingZeros);
    for (let i = digits.length - 1; i >= 0; i--)
        out += BASE58_ALPHABET[digits[i]];
    return out === '' ? '1' : out;
}
function decodeAddressFrom(data, offset) {
    return address(base58Encode(data.subarray(offset, offset + 32)));
}
//# sourceMappingURL=index.js.map