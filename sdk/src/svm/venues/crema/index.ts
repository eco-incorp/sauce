/**
 * Crema Finance (`crema.finance`) — a Solana CLMM whose account layout, tick
 * math and swap-step fee model are a BYTE-IDENTICAL clone of Orca Whirlpool's
 * (program `CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR`; TypeScript SDK
 * `@cremafinance/crema-sdk-v2`, mirrored verbatim in the community fork
 * `github.com/jup-ag/crema-clmm-sdk-v2` this module's layout/math was
 * cross-verified against). 27 pools live on mainnet at integration time
 * (`getProgramAccounts` filtered on `dataSize:748`) — thin, per the venue
 * brief; shipped anyway, survivorship (the relative-depth filter) decides.
 *
 * LAYOUT — Clmmpool account (748 bytes total incl. 8-byte Anchor
 * discriminator; VALIDATED against a real mainnet dump, pool
 * `DV569UDdnjkYWJDnpJfJZE4HyzYKYyRGowtdPQrFUZpm`, SOL/USDC ts=50):
 * discriminator sha256('account:Clmmpool')[0..8] = aa a0 21 7a 95 d9 b7 f4 @0,
 * clmm_config pubkey@8, token_a (MINT) pubkey@40, token_b (MINT) pubkey@72,
 * token_a_vault pubkey@104, token_b_vault pubkey@136, tick_spacing u16@168,
 * tick_spacing_seed [u8;2]@170, fee_rate u16@172, liquidity u128@174,
 * current_sqrt_price u128@190, current_tick_index i32@206,
 * fee_growth_global_{a,b} u128@210/226, fee_protocol_token_{a,b} u64@242/250,
 * bump [u8;1]@258, rewarder_infos [Rewarder;3]@259 (160 bytes each = 480),
 * rewarder_last_updated_time u64@739, is_pause bool@747. Every offset here was
 * confirmed field-for-field against the live account (clmm_config/token_a/
 * token_b/vaults decode to real, sensible pubkeys; tick_spacing_seed ==
 * tick_spacing's own LE bytes).
 *
 * TickArray account (8556 bytes, FIXED length — unlike DefiTuna's
 * Whirlpool-lineage variable-length encoding, Crema keeps Whirlpool's own
 * fixed-stride design): discriminator sha256('account:TickArray')[0..8] =
 * 45 61 bd be 6e 07 42 bb (IDENTICAL bytes to Whirlpool's own TickArray
 * discriminator — Anchor's discriminator is a pure function of the account
 * TYPE NAME, and Crema's IDL names it `TickArray` too), array_index u16@8,
 * tick_spacing u16@10, clmmpool pubkey@12, ticks[64]@44 (133 bytes/tick:
 * is_initialized bool + index i32 + sqrt_price u128 + liquidity_net i128 +
 * liquidity_gross u128 + fee_growth_outside_{a,b} u128 + reward_growth_outside
 * [u128;3] = 1+4+16+16+16+16+16+48). Confirmed against 5 live tick arrays: the
 * `array_index`/`tick_spacing`/`clmmpool` header fields decode exactly as
 * expected, and every initialized tick's on-chain `sqrt_price` matches
 * `whirlpoolSqrtPriceAtTick(index)` (the SAME Q64.64 bit-table math this
 * module reuses from orca-whirlpool) bit-for-bit.
 *
 * TickArrayMap account (876 bytes: 8-byte disc + an 868-byte BITMAP, one bit
 * per possible array index, up to 6944 slots) — THE KEY STRUCTURAL DIVERGENCE
 * FROM WHIRLPOOL/DEFITUNA: Crema's own swap-account-selection helper
 * (`math/clmm.ts`'s `getSwapTickArrays`, the code path the real client SDK
 * uses to build a live transaction) does NOT walk consecutive array indices —
 * it SCANS THE BITMAP for the nearest ALLOCATED array in the walk direction,
 * SKIPPING any unallocated index in between, collecting up to 3. This module
 * replicates that scan exactly (`resolveWindow` below) rather than
 * Whirlpool/DefiTuna's plain ±1/±2-consecutive convention — using the
 * consecutive convention here would ship the WRONG tick array PDAs whenever a
 * gap exists between allocated arrays (confirmed live: the validation pool's
 * bitmap has only 16 of 6944 possible bits set, e.g. arrays 128-135 then a
 * gap to 138, then 153, then 277 — dense assumption would miss real
 * liquidity). `TickUtil.getArrayIndex`/`getStartTickIndex` (array index <->
 * tick-range mapping) anchor array 0 at `MIN_TICK_INDEX + (443636 %
 * tickSpacing)` — NOT at tick 0 the way Whirlpool's own convention does —
 * confirmed by deriving the PDA for the computed index and finding the real
 * account there with a matching `array_index` field.
 *
 * PDA seeds (`utils/pda.ts`): tick_array_map = ['tick_array_map', pool];
 * tick_array = ['tick_array', pool, arrayIndex as 2-byte LE] — ARRAY INDEX,
 * not Whirlpool's start-tick-as-ASCII-STRING scheme. clmm_config is not a
 * PDA at all here — it's a plain pubkey FIELD on the pool account (read
 * directly, no derivation).
 *
 * Swap instruction (`swap`, Anchor discriminator sha256('global:swap')[0..8]
 * = f8 c6 9e 91 e1 75 87 c8 — IDENTICAL bytes to Whirlpool's own `swap` disc,
 * again because Anchor's discriminator depends only on the snake_case
 * instruction NAME): args are `a_to_b: bool, by_amount_in: bool, amount: u64,
 * amount_limit: u64, sqrt_price_limit: u128` — NOTE THE ARG ORDER: the two
 * bools sit BEFORE `amount`, unlike Whirlpool's `amount` first. Accounts:
 * clmm_config(r), clmmpool(w), token_a(r, MINT), token_b(r, MINT),
 * account_a(w, user ATA), account_b(w, user ATA), token_a_vault(w),
 * token_b_vault(w), tick_array_map(w), owner(signer), token_program(r), then
 * up to 3 tick arrays as remaining accounts (w) in walk order. `account_a`/
 * `account_b` are ALWAYS the user's token-A/token-B accounts respectively
 * (fixed by MINT, not by input/output side) — `a_to_b` alone selects debit
 * vs credit internally.
 *
 * VALIDATED bit-exact against the REAL crema.so binary (dumped from
 * mainnet-beta) executing on this module's own mainnet snapshot
 * (test/svm/fixtures/crema/) via LiteSVM — NOT a disclosed-residual case
 * like DefiTuna's: every size below matched the real program to the last
 * digit once the harness compared against a FRESH copy of the pool state per
 * size (an earlier pass of this validation reused one mutated LiteSVM
 * instance across sizes and manufactured a spurious ~2% "residual" purely
 * from comparing against stale, already-swapped state — a test-methodology
 * bug, not a venue quirk; corrected before these numbers were pinned). A
 * second real bug this validation caught (fixed, not disclosed-residual):
 * `liquidity_net`'s tick-relative byte offset is 21 here (index + sqrt_price
 * precede it — see the Tick field list above), NOT 1 the way orca-whirlpool's
 * own Tick struct packs it; reusing whirlpool's offset verbatim silently read
 * sqrt_price bytes as liquidity_net and manufactured a spurious "exhausted"
 * abort on the FIRST tick crossing, at any size that crossed one.
 *   aToB (SOL -> USDC): 0.05 SOL -> 3_664_448; 0.2 SOL -> 14_638_354 (crosses
 *     tick -26150); 1 SOL -> 72_681_306 (crosses -26150); 5 SOL -> 351_168_050
 *     (crosses -26150, -26650) — all bit-exact.
 *   bToA (USDC -> SOL): 50/200 USDC -> 675_134_472 / 2_653_858_762 lamports
 *     SOL, bit-exact. At 1000 USDC the real program continues realizing
 *     12_246_501_046 (crossing -25850/-25800/-25350/-24650 then on into the
 *     NEXT shipped tick array) while this ladder's off-chain model returns 0
 *     (self-deactivates): CREMA_MAX_BOUNDARIES(4) is entirely consumed by
 *     array0's own four upward ticks before the scan ever reaches array1's
 *     content, even though array1's account already rides the transaction —
 *     the SAME shared-budget-across-arrays limitation orca-whirlpool's own
 *     header documents (a fixed boundary count, not per-array), not a defect
 *     introduced here. Backstopped by minOut like every other venue's
 *     quote-vs-window-capacity edge in this repo.
 * A genuinely venue-specific-FEELING but actually general mechanism worth
 * recording for whoever next builds a synthetic-state CLMM harness (found
 * while validating bToA above, off the committed test path — this repo's
 * shipped real-CPI lane, the consuming app realcpi e2e test, only exercises this
 * venue's aToB direction, matching every sibling venue cell there): crediting
 * a native-mint (wSOL) OUTPUT account during a real swap CPI moves REAL
 * LAMPORTS out of the vault (not just the SPL "amount" data field the way a
 * plain non-native transfer does) — a LiteSVM fixture whose wSOL vault is
 * given only the generic rent-exempt-minimum lamports (what
 * `fixtureAccounts()` assigns by default, ignoring each account's true
 * captured balance) throws `UnbalancedInstruction` the moment a bToA swap
 * tries to pay it out. The fix is giving the vault its REAL lamports
 * (rent-exempt reserve + its own stated wSOL `amount` field) before a bToA
 * real-CPI run. This is not Crema-specific (it is how wrapped SOL generally
 * works), but every existing venue's real-CPI cell in this repo happens to
 * sell SOL rather than buy it, so this had not been hit before.
 *
 * Gates (named errors, everything else is a live read):
 * - account size / discriminator (pool, tick array, tick array map);
 * - non-Tokenkeg mints (the swap ix's `token_program` account is a single
 *   fixed program — Tokenkeg only, no Token-2022 variant in this IDL);
 * - `is_pause` set on the pool (an administrative halt — not a drift
 *   condition, a real venue-level shutdown; loud, not a self-drop class);
 * - a direction with NO shipped boundaries and no edge (readable === 0) —
 *   wired via SvmWindowDriftError like orca-whirlpool/meteora-dlmm.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  MAX_TICK_INDEX,
  MIN_TICK_INDEX,
  whirlpoolSqrtPriceAtTick,
} from "../orca-whirlpool/tick-math.js";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "crema";
export const CREMA_PROGRAM_ID = address("CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export const CLMMPOOL_ACCOUNT_SIZE = 748;
/** sha256('account:Clmmpool')[0..8]. */
export const CLMMPOOL_DISCRIMINATOR = [0xaa, 0xa0, 0x21, 0x7a, 0x95, 0xd9, 0xb7, 0xf4];
export const TICK_ARRAY_ACCOUNT_SIZE = 8556;
/** sha256('account:TickArray')[0..8] — byte-identical to orca-whirlpool's own (name-derived, not program-derived). */
export const TICK_ARRAY_DISCRIMINATOR = [0x45, 0x61, 0xbd, 0xbe, 0x6e, 0x07, 0x42, 0xbb];
export const TICK_ARRAY_MAP_ACCOUNT_SIZE = 876;
/** sha256('account:TickArrayMap')[0..8]. */
export const TICK_ARRAY_MAP_DISCRIMINATOR = [0x6c, 0xcb, 0x30, 0xa5, 0x74, 0xd5, 0x60, 0xdd];
export const TICK_ARRAY_SIZE = 64;
export { MAX_TICK_INDEX, MIN_TICK_INDEX };

// Clmmpool offsets (declared-field order, Borsh-packed, no padding).
const OFF_CLMM_CONFIG = 8;
const OFF_MINT_A = 40;
const OFF_MINT_B = 72;
const OFF_VAULT_A = 104;
const OFF_VAULT_B = 136;
export const OFF_TICK_SPACING = 168;
export const OFF_FEE_RATE = 172;
export const OFF_LIQUIDITY = 174;
export const OFF_SQRT_PRICE = 190;
export const OFF_TICK_CURRENT = 206;
const OFF_IS_PAUSE = 747;

// TickArray offsets.
export const OFF_TA_ARRAY_INDEX = 8;
const OFF_TA_TICK_SPACING = 10;
export const OFF_TA_TICKS = 44;
export const TICK_LEN = 133;
// TickArrayMap: 8-byte disc + 868-byte bitmap, one bit per possible array index.
const TICK_ARRAY_MAP_BITMAP_OFFSET = 8;
const TICK_ARRAY_MAP_MIN_BIT_INDEX = 0;
const TICK_ARRAY_MAP_MAX_BIT_INDEX = 868 * 8 - 1; // 6943

/** Shipped initialized-tick boundaries per direction — same budget class as orca-whirlpool/raydium-clmm. */
export const CREMA_MAX_BOUNDARIES = 4;
/** Up to 3 tick-array PDAs ride a window, same as orca-whirlpool/raydium-clmm/defituna. */
const CREMA_MAX_ARRAYS = 3;

export interface CremaBoundary {
  /** Index (0..2) into this window's `tickArrays`/`startTicks` — NOT the real Crema array index. */
  arrayIndex: number;
  /** Slot offset (0..63) within that tick array. */
  offset: number;
  tick: number;
  sqrtPrice: bigint;
}

export interface CremaWindow {
  tickArrays: [Address, Address, Address];
  /** Real Crema array indices the 3 slots above resolve to (bitmap-scan order, may be non-consecutive). */
  arrayIndices: [number, number, number];
  startTicks: [number, number, number];
  boundaries: CremaBoundary[];
  edge: { tick: number; sqrtPrice: bigint } | null;
  /** Contiguous PREFIX of tickArrays that existed as real, valid TickArray accounts at prepare. */
  readable: number;
}

export interface CremaPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  direction: "aToB" | "bToA";
  tokenMintA: Address;
  tokenMintB: Address;
  tokenVaultA: Address;
  tokenVaultB: Address;
  clmmConfig: Address;
  tickArrayMap: Address;
  tickSpacing: number;
  feeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  windows: { aToB: CremaWindow; bToA: CremaWindow };
}

const readI32 = (data: Uint8Array, offset: number): number => {
  const u = Number(readUintLE(data, offset, 4));
  return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
};
function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}
function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}
async function deriveTickArrayMapPda(pool: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(CREMA_PROGRAM_ID, [
    new TextEncoder().encode("tick_array_map"),
    getAddressEncoded(pool),
  ]);
}
async function deriveTickArrayPda(pool: Address, arrayIndex: number): Promise<Address> {
  const idxBytes = new Uint8Array(2);
  idxBytes[0] = arrayIndex & 0xff;
  idxBytes[1] = (arrayIndex >> 8) & 0xff;
  return memoizedGetProgramDerivedAddress(CREMA_PROGRAM_ID, [
    new TextEncoder().encode("tick_array"),
    getAddressEncoded(pool),
    idxBytes,
  ]);
}

/** floor division toward negative infinity (Crema's own TickUtil.getMinIndex/getArrayIndex). */
const floorDiv = (a: number, b: number): number => Math.floor(a / b);
/** TickUtil.getMinIndex: array 0 is anchored here, NOT at tick 0 (Whirlpool's convention). */
function minIndexFor(tickSpacing: number): number {
  return MIN_TICK_INDEX + (Math.abs(MIN_TICK_INDEX) % tickSpacing);
}
function arrayIndexOf(tick: number, tickSpacing: number): number {
  return floorDiv(tick - minIndexFor(tickSpacing), TICK_ARRAY_SIZE * tickSpacing);
}
function startTickOf(arrayIndex: number, tickSpacing: number): number {
  return minIndexFor(tickSpacing) + TICK_ARRAY_SIZE * tickSpacing * arrayIndex;
}

function bitmapBitSet(mapData: Uint8Array, index: number): boolean {
  const byteIdx = TICK_ARRAY_MAP_BITMAP_OFFSET + Math.floor(index / 8);
  const bit = index % 8;
  return ((mapData[byteIdx] ?? 0) >> bit) % 2 === 1;
}

/**
 * Scan the TickArrayMap bitmap for up to CREMA_MAX_ARRAYS allocated array
 * indices in the walk direction, SKIPPING unallocated ones (see header — this
 * is Crema's own `getSwapTickArrays` behavior, not Whirlpool's plain
 * consecutive-index convention). Then, for each selected array, scan its 64
 * ticks for initialized-tick boundaries in walk order: the array containing
 * the reference tick (aToB: tickCurrentIndex; bToA: tickCurrentIndex + 1 —
 * Crema's own `computeSwap`'s `firstTickIndex`) gets the partial from-here
 * scan; any OTHER selected array (reached by skipping a gap, or a later one)
 * gets its FULL span, since it lies entirely ahead of the live tick either
 * way.
 */
async function resolveWindow(
  load: AccountLoader,
  pool: Address,
  tickArrayMapData: Uint8Array,
  tickCurrentIndex: number,
  tickSpacing: number,
  aToB: boolean,
): Promise<CremaWindow> {
  const firstTickIndex = aToB ? tickCurrentIndex : tickCurrentIndex + 1;
  const startArrayIndex = arrayIndexOf(firstTickIndex, tickSpacing);

  // Bitmap-driven scan first (skips unallocated indices — see header), then,
  // if the valid range is exhausted before finding CREMA_MAX_ARRAYS, pad by
  // CONTINUING the same monotonic scan ignoring the bitmap. Both phases visit
  // each index at most once, so `arrayIndices` is always distinct — padding
  // with a REPEATED index would derive the SAME PDA twice, double-counting
  // that array's boundaries in the walk and passing a duplicate writable
  // account into the swap ix.
  const arrayIndices: number[] = [];
  let cursor = startArrayIndex;
  const inRange = (i: number) =>
    aToB ? i >= TICK_ARRAY_MAP_MIN_BIT_INDEX : i <= TICK_ARRAY_MAP_MAX_BIT_INDEX;
  const step = aToB ? -1 : 1;
  while (inRange(cursor) && arrayIndices.length < CREMA_MAX_ARRAYS) {
    if (bitmapBitSet(tickArrayMapData, cursor)) arrayIndices.push(cursor);
    cursor += step;
  }
  cursor =
    arrayIndices.length > 0
      ? arrayIndices[arrayIndices.length - 1]! + step
      : startArrayIndex + step;
  while (arrayIndices.length < CREMA_MAX_ARRAYS && inRange(cursor)) {
    arrayIndices.push(cursor);
    cursor += step;
  }
  // Only possible when the tick range itself is smaller than CREMA_MAX_ARRAYS
  // arrays (an extreme tickSpacing) — pad with the last valid boundary index
  // (duplicate PDAs here fail the fetch-validity check identically on both
  // slots, so `readable` still stops correctly; there is nothing further to
  // read either way).
  while (arrayIndices.length < CREMA_MAX_ARRAYS)
    arrayIndices.push(arrayIndices[arrayIndices.length - 1] ?? startArrayIndex);

  const tickArrays = (await Promise.all(
    arrayIndices.map((idx) => deriveTickArrayPda(pool, idx)),
  )) as [Address, Address, Address];
  const startTicks = arrayIndices.map((idx) => startTickOf(idx, tickSpacing)) as [
    number,
    number,
    number,
  ];

  // Batch the whole window into ONE coalesced round instead of an outward
  // serial walk: `arrayIndices` (and thus every tick-array PDA above) is fully
  // enumerated from the bitmap + monotonic pad before any load, so nothing
  // here depends on a prior array's bytes. Registering every load()
  // synchronously lets the coalescing loader fold them into a single
  // getMultipleAccounts. allSettled preserves the break-on-first-invalid
  // contract exactly — a rejection is re-thrown only if the readable prefix
  // reaches it, and a miss/rejection past the break (incl. the padded
  // duplicate-PDA slots) degrades to the same readable prefix as before.
  const loaded = await Promise.allSettled(tickArrays.map((addr) => load(addr)));
  const arrays: Uint8Array[] = [];
  let readable = 0;
  for (let i = 0; i < CREMA_MAX_ARRAYS; i++) {
    const settled = loaded[i]!;
    if (settled.status === "rejected") throw settled.reason;
    const data = settled.value;
    const valid =
      data !== null &&
      data.length === TICK_ARRAY_ACCOUNT_SIZE &&
      hasDiscriminator(data, TICK_ARRAY_DISCRIMINATOR) &&
      Number(readUintLE(data, OFF_TA_ARRAY_INDEX, 2)) === arrayIndices[i] &&
      Number(readUintLE(data, OFF_TA_TICK_SPACING, 2)) === tickSpacing;
    if (!valid) break;
    arrays.push(data as Uint8Array);
    readable += 1;
  }

  const boundaries: CremaBoundary[] = [];
  let maxStopped = false;
  for (let a = 0; a < readable && !maxStopped; a++) {
    const data = arrays[a]!;
    const start = startTicks[a]!;
    const isReferenceArray = arrayIndices[a] === startArrayIndex;
    let offset: number;
    if (isReferenceArray) {
      const raw = floorDiv(tickCurrentIndex - start, tickSpacing);
      offset = aToB ? raw : raw + 1;
    } else {
      offset = aToB ? TICK_ARRAY_SIZE - 1 : 0;
    }
    while (offset >= 0 && offset < TICK_ARRAY_SIZE) {
      const cell = OFF_TA_TICKS + offset * TICK_LEN;
      if (data[cell] === 1) {
        const tick = start + offset * tickSpacing;
        boundaries.push({ arrayIndex: a, offset, tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) });
        if (boundaries.length === CREMA_MAX_BOUNDARIES) {
          maxStopped = true;
          break;
        }
      }
      offset += aToB ? -1 : 1;
    }
  }

  let edge: { tick: number; sqrtPrice: bigint } | null = null;
  if (readable > 0 && !maxStopped) {
    const lastStart = startTicks[readable - 1]!;
    let tick: number;
    if (aToB) {
      tick = Math.max(lastStart, MIN_TICK_INDEX);
    } else {
      tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
      if (lastStart + TICK_ARRAY_SIZE * tickSpacing > MAX_TICK_INDEX) tick = MAX_TICK_INDEX;
    }
    edge = { tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) };
  }

  return {
    tickArrays,
    arrayIndices: arrayIndices as [number, number, number],
    startTicks,
    boundaries,
    edge,
    readable,
  };
}

/** Fetch + decode one Clmmpool and freeze both directions' boundary windows. Read-only against the loader. */
export async function fetchCremaPoolConfig(
  load: AccountLoader,
  pool: Address,
): Promise<CremaPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== CLMMPOOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} has ${data.length} bytes, expected ${CLMMPOOL_ACCOUNT_SIZE}`,
    );
  }
  if (!hasDiscriminator(data, CLMMPOOL_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a Clmmpool account)`);
  }
  if (data[OFF_IS_PAUSE] === 1) {
    throw new Error(`${SLUG}: pool ${pool} is administratively paused (is_pause = true)`);
  }

  const codec = getAddressCodec();
  const clmmConfig = codec.decode(data.subarray(OFF_CLMM_CONFIG, OFF_CLMM_CONFIG + 32)) as Address;
  const tokenMintA = codec.decode(data.subarray(OFF_MINT_A, OFF_MINT_A + 32)) as Address;
  const tokenMintB = codec.decode(data.subarray(OFF_MINT_B, OFF_MINT_B + 32)) as Address;
  // The swap ix's token_program account is a single fixed program (Tokenkeg) —
  // legacy-SPL only. A Token-2022 mint (or one carrying an un-routable extension)
  // SELF-DROPS this pool: the thrown error is the graceful-drop signal the
  // SvmRoute orchestrator catches. An unreadable mint falls back to the legacy
  // assumption (a classic 82-byte mint classifies legacy → no throw → config
  // built byte-identically to before).
  const mintList = [tokenMintA, tokenMintB];
  const mintDatas = await Promise.all(mintList.map((mint) => load(mint)));
  for (let mi = 0; mi < mintList.length; mi++) {
    const mint = mintList[mi]!;
    const mintData = mintDatas[mi];
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

  const tickSpacing = Number(readUintLE(data, OFF_TICK_SPACING, 2));
  const tickCurrentIndex = readI32(data, OFF_TICK_CURRENT);
  const tickArrayMap = await deriveTickArrayMapPda(pool);
  const mapData = await load(tickArrayMap);
  if (mapData === null)
    throw new Error(`${SLUG}: tick array map ${tickArrayMap} of pool ${pool} not found`);
  if (mapData.length !== TICK_ARRAY_MAP_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: tick array map ${tickArrayMap} has ${mapData.length} bytes, expected ${TICK_ARRAY_MAP_ACCOUNT_SIZE}`,
    );
  }
  if (!hasDiscriminator(mapData, TICK_ARRAY_MAP_DISCRIMINATOR)) {
    throw new Error(
      `${SLUG}: tick array map ${tickArrayMap} has a foreign discriminator (not a TickArrayMap account)`,
    );
  }

  const [aToB, bToA] = await Promise.all([
    resolveWindow(load, pool, mapData as Uint8Array, tickCurrentIndex, tickSpacing, true),
    resolveWindow(load, pool, mapData as Uint8Array, tickCurrentIndex, tickSpacing, false),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: "aToB",
    tokenMintA,
    tokenMintB,
    tokenVaultA: codec.decode(data.subarray(OFF_VAULT_A, OFF_VAULT_A + 32)) as Address,
    tokenVaultB: codec.decode(data.subarray(OFF_VAULT_B, OFF_VAULT_B + 32)) as Address,
    clmmConfig,
    tickArrayMap,
    tickSpacing,
    feeRate: Number(readUintLE(data, OFF_FEE_RATE, 2)),
    liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
    sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
    tickCurrentIndex,
    windows: { aToB, bToA },
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like orca-whirlpool/raydium-clmm). */
export const crema = {
  slug: SLUG,
  programId: CREMA_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchCremaPoolConfig,
};
