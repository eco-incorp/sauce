/**
 * Metric venue adapter (program `Bvs46DPFxiFE6YHxLDLD6QAUcmy51FyRVPZJusPxLk3j`) — a closed-source,
 * oracle-priced PMM. No IDL, no docs: the account layout below was recovered by scanning the
 * deployed program's own accounts (`getProgramAccounts`) and cross-referencing a real landed swap's
 * account list; the price mechanism was recovered by isolating the swap's own internal CPI.
 *
 * PRICE MECHANISM (the thing that makes this venue different from every other prop-AMM already in
 * this tree): Metric's swap does NOT price itself from a plaintext account field. Mid-swap it CPIs
 * a SEPARATE oracle program (`CvGnk4HouriGypBTZhYc76esyN5kWBepWueYVeSpR1L1`) with instruction data
 * `[0x02, feedIndex]` and gets back 32 bytes of RETURN DATA: two u128 LE Q64.64 fixed-point prices
 * (bid, then ask), quote-per-base. `feedIndex` (the oracle config account's own byte at +135) was
 * checked across 8 candidate values (0/1/10/17/18/19/20/21) — all return the IDENTICAL 32 bytes, so
 * it is a single-feed account and the byte is not load-bearing; any value works.
 *
 * A standalone, single-instruction `simulateTransaction` (sigVerify:false) that calls ONLY the
 * oracle program directly (no Metric CPI wrapper needed to observe the price) reproduces this
 * exactly: 3,398 CU, and — on the live USDC/USDT pool this adapter was ground-truthed against —
 * decoded bid/ask sat at approximately 1.00078 / 1.00079 (a ~1bp spread), consistent with a
 * cross-checked venue on the same pair the same minute.
 *
 * THE ORACLE RETURN DATA CANNOT BE REPRODUCED FROM PLAIN ACCOUNT BYTES (unlike zerofi's IEEE-754
 * oracle, or obric-v2's plaintext level): a byte-for-byte scan of the price account's own 849 bytes
 * for the measured bid/ask u128 values found no match at any offset. The oracle's internal price
 * transform is closed and unrecovered. This has one real consequence for this adapter's shape,
 * unlike every OTHER adapter in this tree: `fetchPoolConfig` cannot derive the price from
 * `AccountLoader` byte reads alone — decoding it requires actually EXECUTING the oracle's own CPI
 * (a capability `AccountLoader`, a plain byte-getter, does not have). `fetchPoolConfig` therefore
 * takes an explicit, OPTIONAL, but REQUIRED-IN-PRACTICE `fetchOracleQuote` callback: a
 * caller-supplied function that runs the oracle CPI (via `simulateTransaction` against a real RPC,
 * or a LiteSVM execution in a test) and returns its raw 32-byte return data. This keeps
 * `fetchPoolConfig` itself free of any RPC/simulate dependency (it still only calls `load`), while
 * making the one genuinely-CPI-only value an explicit, typed, refuse-don't-guess input rather than
 * a silently-wrong byte-scan guess. Missing `fetchOracleQuote` throws, naming the gate — the same
 * "refuse, don't guess" posture zerofi's fee catalog and authority table already use.
 *
 * The baked (bid, ask) become part of `MetricPoolConfig` (`paramsFor`-visible) and are what the
 * emitted fragment's quote math uses. The emitted
 * fragment issues NO on-chain oracle CPI — it multiplies by the baked scale and caps at a reserve
 * fraction. That is deliberate and load-bearing: the oracle program CAN revert
 * post-invoke() (measured live, not hypothetical — program error Custom:20 when its price account
 * is stale), and SVM's CATCH is PRE-FLIGHT-ONLY, so an in-quote CPI revert would abort the WHOLE
 * cook — every co-merged venue's fill, not just this slot. A baked scale can never revert, so this
 * quote can never take down a cook; `minOut` is the sole atomic backstop, the same read-off-chain-
 * and-bake posture zerofi/WOOFi/BisonFi already use. If a later pass recovers the oracle's byte
 * transform, the off-chain read collapses to a plain account decode — a simplification, not a
 * redesign. (The venue's OWN swap instruction still prices via the oracle — its business, only when
 * Metric is elected — a normal per-slot swap failure, never a quote-time whole-cook abort.)
 *
 * POOL ACCOUNT LAYOUT (variable length — 8 distinct sizes observed across a live sweep, 780 through
 * 1932 bytes, gcd of the size deltas 36 — a variable-length tail this adapter does not decode; see
 * the caveat below):
 *   +74   mintA (32B)          +106  vaultA (32B, SPL)
 *   +138  mintB (32B)          +170  vaultB (32B, SPL)
 *   +234  oracleConfig (32B, oracle-program-owned)
 *
 * ORACLE CONFIG ACCOUNT: oracle-program-owned, 277 bytes on the ground-truth pool. The paired
 * PRICE account (a DIFFERENT oracle-program-owned account, NOT embedded in the pool itself) sits at
 * a fixed byte offset inside the oracle config account — recovered directly (`Buffer.indexOf` of the
 * known price account's raw pubkey bytes into the known oracle config's raw bytes): offset 103.
 *
 * SWAP INSTRUCTION (disc `0x01`, 27 bytes: `[0x01] ++ amountIn:u64 LE ++ [0x01] ++ direction:u8
 * (1 = mintA in / 0 = mintB in) ++ minOut:u128 LE`). 15 accounts, FIXED order regardless of
 * direction:
 *   0 owner (signer)     1 pool (writable)      2 mintA            3 mintB
 *   4 vaultA (writable)  5 vaultB (writable)    6 userAtaA (writable, ALWAYS mintA's side)
 *   7 userAtaB (writable, ALWAYS mintB's side)  8 tokenProgram(A)  9 tokenProgram(B)
 *   10 systemProgram      11 self (this program's own id)  12 oracleProgram
 *   13 oracleConfig       14 priceAccount
 *
 * CAPACITY: the pool's variable-length tail (36-byte stride) is a real depth/bin model this
 * adapter does NOT decode (unresolved — see the module doc's own caveat on this). Rather than
 * assume the flat oracle price holds at unbounded size (measured flat only across the oracle
 * itself, never against the venue's real fill depth), the ladder caps every quote at
 * `liveReserveOut / CAP_DIVISOR` — the same conservative, deliberately-narrow posture zerofi's own
 * `CAP_DIVISOR` doc explains for the identical reason (an unmeasured true depth model + a flat
 * price is unsafe unbounded; a reserve-fraction ceiling is a safe, real, measurable substitute).
 * Tokenkeg-only (both mints on the ground-truth pool are plain Tokenkeg; a Token-2022 leg is out of
 * scope, unverified against this adapter, matching every other Tokenkeg-only adapter's own scope
 * note).
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from '../types.js';

const SLUG = 'metric';
export const METRIC_PROGRAM_ID = address('Bvs46DPFxiFE6YHxLDLD6QAUcmy51FyRVPZJusPxLk3j');
export const METRIC_ORACLE_PROGRAM_ID = address('CvGnk4HouriGypBTZhYc76esyN5kWBepWueYVeSpR1L1');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

// Pool account layout (see module doc — ground-truthed against a live pool).
export const OFF_MINT_A = 74;
export const OFF_VAULT_A = 106;
export const OFF_MINT_B = 138;
export const OFF_VAULT_B = 170;
export const OFF_ORACLE_CONFIG = 234;
const POOL_MIN_LENGTH = OFF_ORACLE_CONFIG + 32;

/** Byte offset of the paired price account's pubkey inside the oracle config account. */
export const PRICE_ACCOUNT_OFFSET_IN_ORACLE_CONFIG = 103;
const ORACLE_CONFIG_MIN_LENGTH = PRICE_ACCOUNT_OFFSET_IN_ORACLE_CONFIG + 32;

/** `swap`'s single-byte discriminator. */
export const METRIC_SWAP_DISCRIMINATOR = 0x01;

/**
 * Conservative quotable-capacity divisor (see module doc) — the ladder never quotes more than
 * `liveReserveOut / CAP_DIVISOR` output. Mirrors zerofi's own CAP_DIVISOR precedent and rationale:
 * the venue's real depth model (the pool's own variable-length bin tail) is unrecovered, so an
 * unbounded flat-price quote would be unsafe; this is a deliberately conservative substitute, not a
 * measured true capacity.
 */
export const CAP_DIVISOR = 20n;

/**
 * Conservative quote haircut, in parts-per-million, folded into the baked scale so the quote is a
 * lower bound on the realized fill (never an over-quote).
 *
 * WHY IT EXISTS — a measured, not guessed, correction. A paired-differential simulation of the REAL
 * swap on real mainnet pools (impersonating a funded recent trader; sizes spanning 667x — 3, 100 and
 * 2000 tokens — pinned to one context slot) found the raw oracle-price prediction (`in * bid/2^64`)
 * OVER-quotes the realized output by a small, strikingly SIZE-INDEPENDENT margin: 3, 3 and 4 ppm at
 * x = 3, 100, 2000 tokens respectively. Size-independence is the decisive result — it confirms this
 * oracle-priced PMM fills at a flat price with NO slippage curve (a capacity-aware bin-walk would
 * address slippage that measurably does not exist here), so the flat stateless rung is correct and
 * the only correction needed is this small constant offset. The offset itself is the oracle's own
 * bid/ask micro-spread plus price drift between the off-chain bake and the on-chain cook slot, not a
 * curve.
 *
 * The haircut is set an order of magnitude above the measured ~4 ppm so `predicted <= realized`
 * holds with margin across the whole measured size range AND absorbs additional bake-to-cook oracle
 * micro-drift over a real routing window. Priced INTO the scale (not deducted afterward), so
 * `continuousFees` stays the identity — the same convention zerofi/obric-v2 use. An under-quote is
 * safe (at worst Metric is not elected when it was marginally best); an over-quote is the hazard
 * this removes, because Metric's own swap reverts if its `minOut` is unmet and the engine's CATCH is
 * pre-flight-only, so an over-optimistic quote is a whole-cook-abort risk, not just a bad fill.
 */
export const METRIC_QUOTE_HAIRCUT_PPM = 50n;

/** SPL Mint `decimals` byte offset. */
const MINT_DECIMALS_OFFSET = 44;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface MetricPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA -> mintB (bid applies), 1 = mintB -> mintA (ask, reciprocal, applies). */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  oracleConfig: Address;
  priceAccount: Address;
  tokenProgramA: Address;
  tokenProgramB: Address;
  decimalsA: number;
  decimalsB: number;
  /** Baked oracle read (32-byte off-chain oracle-read return data, u128 LE halves) — see module doc. */
  bidQ64: bigint;
  askQ64: bigint;
  /**
   * This direction's baked scale, already decimals-adjusted, haircut-folded
   * (`METRIC_QUOTE_HAIRCUT_PPM`, so `out` is a conservative lower bound) and gcd-reduced:
   * `out = in * scaleNum / scaleDen`.
   */
  scaleNum: bigint;
  scaleDen: bigint;
  /** This direction's baked price (bidQ64 for dir 0, askQ64 for dir 1) — informational; the quote uses scaleNum/scaleDen. */
  bakedPrice: bigint;
}

function metricConfig(cfg: PoolConfig): MetricPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  const c = cfg as MetricPoolConfig;
  if (c.direction !== 0 && c.direction !== 1) {
    throw new Error(`${SLUG} direction must be 0 or 1, got '${String(c.direction)}'`);
  }
  return c;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

/**
 * Fold a Q64.64 price (quote-per-base atoms-agnostic) plus the two mints' decimals into a
 * gcd-reduced (num, den) atoms-to-atoms scale: `outAtoms = inAtoms * num / den`.
 * `reciprocal` computes the OTHER direction's scale from the SAME price (division, not a second
 * baked value) — mirrors zerofi's ieee754ScaleParams direction-flip (swap num<->den AND which side
 * carries the decimals adjustment).
 *
 * A `METRIC_QUOTE_HAIRCUT_PPM` haircut is folded in (num scaled down by `(1e6 - haircut)/1e6`) so
 * the result is a lower bound on the realized fill — see that constant's doc for the measurement
 * that sized it. The haircut rides in the exact (num, den) pair, so `referenceQuote` stays lamport-
 * exact against the SAME params the emitted fragment uses.
 */
export function metricScaleParams(
  priceQ64: bigint,
  decimalsIn: number,
  decimalsOut: number,
  reciprocal: boolean,
): { num: bigint; den: bigint } {
  if (priceQ64 <= 0n) throw new Error(`${SLUG} price must be positive, got ${priceQ64}`);
  const d = decimalsOut - decimalsIn;
  const decNum = d >= 0 ? 10n ** BigInt(d) : 1n;
  const decDen = d >= 0 ? 1n : 10n ** BigInt(-d);
  let num: bigint;
  let den: bigint;
  if (!reciprocal) {
    // outAtoms = inAtoms * price / 2^64, decimals-adjusted.
    num = priceQ64 * decNum;
    den = (1n << 64n) * decDen;
  } else {
    // outAtoms = inAtoms * 2^64 / price, decimals-adjusted.
    num = (1n << 64n) * decNum;
    den = priceQ64 * decDen;
  }
  // Fold the conservative haircut into the exact ratio (never a rounded float): out is now a lower
  // bound on the realized fill, so predicted <= realized on every measured cell.
  num *= 1_000_000n - METRIC_QUOTE_HAIRCUT_PPM;
  den *= 1_000_000n;
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export const metric = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: METRIC_PROGRAM_ID,

  /**
   * Off-chain gate + decode. `pool` is the variable-length pool account (see module doc — only the
   * fixed 266-byte prefix is read; the trailing bin tail is not decoded). `fetchOracleQuote` is
   * REQUIRED in practice (throws when absent): it must run the oracle program's `[0x02, feedByte]`
   * read (any feedByte — see module doc) against `(oracleConfig, priceAccount)` and return its raw
   * 32-byte CPI return data — a capability plain `AccountLoader` byte reads cannot provide. The
   * consuming app supplies this via a real `simulateTransaction` (or a LiteSVM execution in tests);
   * this adapter stays free of any RPC/simulate dependency itself.
   */
  async fetchPoolConfig(
    load: AccountLoader,
    pool: Address,
    direction: 0 | 1 = 0,
    fetchOracleQuote?: (oracleProgram: Address, oracleConfig: Address, priceAccount: Address) => Promise<Uint8Array>,
  ): Promise<MetricPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
    if (data.length < POOL_MIN_LENGTH) {
      throw new Error(`${SLUG} pool ${pool} account is ${data.length} bytes, too short for the fixed layout (need >= ${POOL_MIN_LENGTH})`);
    }

    const mintA = pubkeyAt(data, OFF_MINT_A);
    const mintB = pubkeyAt(data, OFF_MINT_B);
    const vaultA = pubkeyAt(data, OFF_VAULT_A);
    const vaultB = pubkeyAt(data, OFF_VAULT_B);
    const oracleConfig = pubkeyAt(data, OFF_ORACLE_CONFIG);

    const oracleConfigData = await load(oracleConfig);
    if (oracleConfigData === null) throw new Error(`${SLUG} pool ${pool} oracleConfig ${oracleConfig} account not found`);
    if (oracleConfigData.length < ORACLE_CONFIG_MIN_LENGTH) {
      throw new Error(
        `${SLUG} pool ${pool} oracleConfig ${oracleConfig} is ${oracleConfigData.length} bytes, too short to hold the price account pubkey at offset ${PRICE_ACCOUNT_OFFSET_IN_ORACLE_CONFIG}`,
      );
    }
    const priceAccount = pubkeyAt(oracleConfigData, PRICE_ACCOUNT_OFFSET_IN_ORACLE_CONFIG);

    const [mintAData, mintBData] = await Promise.all([load(mintA), load(mintB)]);
    if (mintAData === null || mintBData === null) {
      throw new Error(`${SLUG} pool ${pool} mint account(s) not found`);
    }
    if (mintAData.length < MINT_DECIMALS_OFFSET + 1 || mintBData.length < MINT_DECIMALS_OFFSET + 1) {
      throw new Error(`${SLUG} pool ${pool} mint account(s) too short to be an SPL mint`);
    }
    const decimalsA = mintAData[MINT_DECIMALS_OFFSET];
    const decimalsB = mintBData[MINT_DECIMALS_OFFSET];

    if (fetchOracleQuote === undefined) {
      throw new Error(
        `${SLUG} pool ${pool} has no fetchOracleQuote supplied — this venue's price cannot be derived from account ` +
          `bytes alone (the oracle's transform is closed/unrecovered, see module doc); the caller must run the ` +
          `oracle CPI (simulateTransaction / LiteSVM) and pass its 32-byte return data`,
      );
    }
    const quoteBytes = await fetchOracleQuote(METRIC_ORACLE_PROGRAM_ID, oracleConfig, priceAccount);
    if (quoteBytes.length !== 32) {
      throw new Error(`${SLUG} pool ${pool} oracle CPI returned ${quoteBytes.length} bytes, expected 32 (bid:u128 LE ++ ask:u128 LE)`);
    }
    const bidQ64 = readUintLE(quoteBytes, 0, 16);
    const askQ64 = readUintLE(quoteBytes, 16, 16);

    const bakedPrice = direction === 0 ? bidQ64 : askQ64;
    const { num: scaleNum, den: scaleDen } =
      direction === 0
        ? metricScaleParams(bidQ64, decimalsA, decimalsB, false)
        : metricScaleParams(askQ64, decimalsB, decimalsA, true);

    return {
      venue: SLUG,
      pool,
      direction,
      mintA,
      mintB,
      vaultA,
      vaultB,
      oracleConfig,
      priceAccount,
      tokenProgramA: TOKEN_PROGRAM,
      tokenProgramB: TOKEN_PROGRAM,
      decimalsA,
      decimalsB,
      bidQ64,
      askQ64,
      scaleNum,
      scaleDen,
      bakedPrice,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = metricConfig(cfg);
    const vaultOut = c.direction === 0 ? c.vaultB : c.vaultA;
    return [
      { ref: c.oracleConfig, address: c.oracleConfig },
      { ref: c.priceAccount, address: c.priceAccount },
      { ref: vaultOut, address: vaultOut },
    ];
  },

  /**
   * v1 swap CPI (amount baked). disc(1) ++ amountIn u64 LE ++ [1] ++ direction u8 ++ minOut u128 LE=1.
   */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = metricConfig(cfg);
    const U64_MAX = (1n << 64n) - 1n;
    if (amountIn <= 0n || amountIn > U64_MAX) {
      throw new Error(`${SLUG} buildSwap amountIn must be a positive u64, got ${amountIn}`);
    }
    const data = new Uint8Array(27);
    data[0] = METRIC_SWAP_DISCRIMINATOR;
    for (let b = 0; b < 8; b++) data[1 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[9] = 1;
    data[10] = c.direction === 0 ? 1 : 0;
    data[11] = 1; // minOut u128 LE = 1 (the consuming app's terminal delta owns the real bound)
    return {
      programId: METRIC_PROGRAM_ID,
      data,
      accounts: metricSwapAccounts(c, user, (ref, addr, w) => fixed(ref, addr, w)),
    };
  },
};

const fixed = (ref: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref, address: addr, writable: true } : { ref, address: addr };

/**
 * The 15-account order for Metric's `swap` (disc 0x01) — see module doc. `userAtaA`/`userAtaB`
 * ride FIXED slots 6/7 regardless of direction (always mintA's / mintB's side respectively); the
 * direction BYTE in the instruction data (not account order) tells the program which way to move
 * value.
 */
export function metricSwapAccounts(
  c: MetricPoolConfig,
  user: SwapUser,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const r = refFor ?? ((role: string) => role);
  const userAtaA = c.direction === 0 ? user.inAta : user.outAta;
  const userAtaB = c.direction === 0 ? user.outAta : user.inAta;
  return [
    { ref: user.owner, signer: true },
    make(r('pool'), c.pool, true),
    make(r('ma'), c.mintA),
    make(r('mb'), c.mintB),
    make(r('va'), c.vaultA, true),
    make(r('vb'), c.vaultB, true),
    { ref: userAtaA, writable: true },
    { ref: userAtaB, writable: true },
    make(r('tpa'), c.tokenProgramA),
    make(r('tpb'), c.tokenProgramB),
    make(r('sys'), SYSTEM_PROGRAM),
    make(r('self'), METRIC_PROGRAM_ID),
    make(r('oracleProg'), METRIC_ORACLE_PROGRAM_ID),
    make(r('oracleConfig'), c.oracleConfig, true),
    make(r('price'), c.priceAccount, true),
  ];
}
