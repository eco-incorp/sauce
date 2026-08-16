/**
 * LemmingsFi venue adapter — a closed-source, no-on-chain-IDL push-oracle AMM
 * (program `BQEJZUB4CzoT6UhRffoCkqCyqQNrCPCSGHcPEmsdbEsX`, Anchor-based —
 * confirmed by a real `AnchorError` log path, see "STALENESS" below). No IDL
 * account exists at the standard Anchor PDA (this program owns only 3
 * accounts total on all of mainnet: two 310-byte pools + one 76-byte global
 * config — confirmed by a full `getProgramAccounts` sweep), so every byte
 * offset and instruction field below is recovered by direct account/
 * transaction archaeology: locating a real pool's own known vault/mint
 * addresses as raw bytes inside its account (the same method obric-v2 /
 * solfi-v2 used), cross-checked against 394 real landed swaps
 * (`getSignaturesForAddress` + `getTransaction` on the pool's own SPL vaults
 * — filtering on the VAULT, not the pool, cleanly separates real swaps from
 * the keeper's `UpdateOracle` spam, which never touches a vault) and
 * validated with our own `simulateTransaction` calls (`sigVerify:false`)
 * against the deployed program.
 *
 * ── Pool account (310 bytes) ──
 *   offset 0   : 8-byte Anchor discriminator
 *   offset 8   : mintA (32 bytes) — the "base" mint
 *   offset 40  : mintB (32 bytes) — the "quote" mint
 *   offset 72  : vaultA (32 bytes) — mintA's SPL token vault
 *   offset 104 : vaultB (32 bytes) — mintB's SPL token vault
 *   offset 168 : priceTick, u64 LE — see "PRICING MODEL" below
 *   offset 184 : lastUpdateTs, u64 LE, Unix seconds — EXACT match to the
 *                blockTime of the most recent `UpdateOracle` call in every
 *                sample checked (dozens, two different pools)
 *   offset 192 : lastUpdateSlot, u64 LE — EXACT match to that same call's slot
 * (offsets 176/200/202 are additional `UpdateOracle`-written fields that do
 * NOT correlate with the realized swap price in any of 394 real trades
 * spanning 5 distinct price epochs — see PRICING MODEL; not used here.)
 *
 * ── PRICING MODEL — a solved, exact formula (not a haircut-guarded
 * approximation like humidifi's) ──
 * This is a push-oracle design: an off-chain keeper periodically calls
 * `UpdateOracle` (disc `70 29 d1 12 f8 e2 fc bc`, 28-byte data: disc ++ 2×u64
 * ++ 2×u16) to write a fresh price tick into the pool account; `Swap` reads
 * that tick live and prices the trade off it — the pool's OWN vault-balance
 * RATIO is NOT the price (measured live: the raw ratio implied ~1.82
 * USDC/GEOD at capture time vs. a real traded rate of ~0.12-0.15 USDC/GEOD, a
 * ~13x gap — using the ratio directly would be a ~13x-FAVOURABLE error in
 * the GEOD-in/USDC-out direction, the exact hazard this integration's brief
 * warns about). The vault ratio is only used here for the relative-depth
 * capacity signal, never for pricing.
 *
 * The `priceTick` (offset 168) turned out to encode price EXACTLY:
 * `price (mintB per mintA, natural/whole-token units) = (priceTick + 2) / 1000`
 * — solved by correlating 394 real (amountIn, amountOut) pairs (found by
 * filtering the pool's own vault signature history for real SPL transfers,
 * not `UpdateOracle` calls, which touch no vault) against the `priceTick`
 * active at trade time, across 5 distinct price epochs (119, 121, 122, 123,
 * and the pool's current 131) in BOTH directions:
 *   - a=123 (tick+2=125): 5 independent trades, amountOut/amountIn = EXACTLY
 *     8000/1 (integer, zero remainder) every time — `1e6/(a+2)`.
 *   - a=122,121,119: matched to 5-6 significant digits against the SAME
 *     `1e6/(a+2)` formula (1e6/124=8064.516129…, 1e6/123=8130.080996…,
 *     1e6/121=8264.462809…) — the tiny residual (<3e-6 relative) is
 *     consistent with the real venue's own integer truncation, not a
 *     modeling error.
 *   - the 2 real GEOD-in/USDC-out trades found solve back to `a+2=125`
 *     (124.999998, 124.999998) to the same precision, confirming the
 *     formula is symmetric/exact in BOTH directions.
 * Generalized to arbitrary mint decimals (this venue's sampled mints are
 * GEOD=9dp / USDC=6dp, giving the `1e6` constant above as
 * `1000 * 10^(decA-decB)`):
 *   mintA-out (mintB in) = floor(mintBIn * K / (priceTick + 2))
 *   mintB-out (mintA in) = floor(mintAIn * (priceTick + 2) / K)
 *   where K = 1000 * 10^decA / 10^decB, reduced to an integer numerator/
 *   denominator pair (kNum, kDen) — computed OFF-CHAIN once per pool from
 *   each mint's own `decimals` byte (standard SPL Mint layout, offset 44)
 *   and threaded through as ladder PARAMS (paramCount 2), never baked into
 *   the compiled fragment as a literal — so a future LemmingsFi pool with a
 *   different decimals pair reuses the SAME compiled shape.
 * No fee/spread beyond this is detectable in the samples (every match is
 * exact or truncation-level), so no additional haircut is applied — this
 * ladder replicates the real math rather than approximating it, the same
 * epistemic tier as obric-v2/solfi-v2, not humidifi's "curve unrecoverable,
 * haircut a proxy" tier. A CAPACITY CLAMP against the live output-vault
 * balance still applies (a huge order the venue's own vault cannot fund
 * would revert the real CPI; capped to the same amount here) — concave-by-
 * construction (linear-then-flat), monotone non-decreasing.
 *
 * ── STALENESS — a REAL, MEASURED, currently-active self-drop condition ──
 * The pool's `UpdateOracle` keeper (previously pinging every ~6s, 24/7, for
 * months — pool2 alone shows 15,000+ calls in a 27-hour window) stopped
 * 2026-05-09 (well over two months before this integration): `lastUpdateTs`
 * on the ONLY currently-populated pool has not advanced since. Constructing
 * our own `Swap` instruction (correct discriminator/accounts/data — see
 * below) and `simulateTransaction`-ing it against the REAL deployed program
 * at 6 sizes across both directions reproduces the SAME real, on-chain,
 * business-logic revert every time:
 *   `AnchorError thrown in programs/lemmingsfi/src/instructions/
 *    swap_common.rs:74. Error Code: StaleOracle. Error Number: 6003.`
 * — proof the instruction format below is byte-correct (the program parses
 * it and reaches its OWN logic, not an accounts/data-shape rejection) AND
 * that a cook including this venue TODAY would revert the CPI. Since an SVM
 * CPI failure aborts the whole transaction (no per-venue catch/re-route at
 * execution time), `gate` (wired in the consuming app SVM solver entry's `FAMILIES.
 * lemmingsfi.gate`) self-drops any candidate whose `lastUpdateTs` is more
 * than `STALE_AFTER_SECONDS` old — a SEQUENCING condition, not a permanent
 * disable: the instant the keeper posts a fresh tick, `lastUpdateTs`
 * advances and this venue re-admits itself with zero code changes. 60s is
 * chosen deliberately STRICT (well under the keeper's own historical ~6s
 * cadence) so an admitted candidate is essentially guaranteed to still be
 * fresh by cook time; the real on-chain threshold itself is not recovered
 * (no live/fresh pool was available to bisect it against), so erring
 * stricter is the only safe direction.
 *
 * ── Swap instruction — TWO discriminators exist; this adapter uses the
 * PERMISSIONLESS one ──
 * Real transaction history shows two distinct swap-family discriminators on
 * this program:
 *   - `Swap2` (`41 4b 3f 4c eb 5b 5b 88`, 26-byte data): its 9th account is
 *     `8xeaWCsJYxRoudEZGJWURdfrtFhLYZz9b4iHJnW5tb3d`, a fixed
 *     partner/integrator account every real `Swap2` sample requires as a
 *     cosigner — a signer this recipe cannot produce autonomously.
 *   - `Swap` (`f8 c6 9e 91 e1 75 87 c8`, 25-byte data): its 9th account is
 *     the PUBLIC `Sysvar1nstructions1111111111111111111111111` — no special
 *     signer, fully permissionless. THIS is the instruction this adapter
 *     emits (never `Swap2`), so LemmingsFi needs no whitelist/partner
 *     cosign to execute for real.
 * `Swap`'s 25-byte data: `disc(8) ++ packed(8) ++ zero(9)`. `packed` (u64 LE)
 * is NOT the plain amountIn — it is `(amountIn << 8) | directionBit`,
 * PROVEN exactly (integer division, zero remainder) across all 394 real
 * samples: `packed / 256n === amountIn` and `packed % 256n === directionBit`
 * (0 = mintB-in/mintA-out, 1 = mintA-in/mintB-out) for every one. The 9
 * trailing zero bytes (min-out + padding, never observed non-zero in any
 * real sample) are emitted as-is; the recipe's own terminal realized-delta
 * `minOut` check is the real floor. Reproducing this exact left-shifted
 * encoding needs a small, additive codegen extension
 * (`SvmRouteSlot.patchMultiplierIn`) since the existing patch pipeline
 * (XOR, then optional divide) had no multiply step; every other family
 * leaves it unset and is byte-for-byte unaffected.
 *
 * ── Accounts (9, fixed order regardless of direction) ──
 *   0 signer (writable, signer) — the trader
 *   1 config (readonly) — `6DZQsK3i1YtvyQCsWxZpY1Ski8dmSjqYnjCUPQiMqT1Z`, the
 *     ONLY 76-byte account this program owns anywhere on mainnet — a
 *     program-wide singleton (both pools' real swaps use this SAME address)
 *   2 pool (writable)
 *   3 vaultA (writable)
 *   4 vaultB (writable)
 *   5 user ata for mintA (writable)
 *   6 user ata for mintB (writable)
 *   7 TOKEN_PROGRAM (readonly)
 *   8 Sysvar1nstructions (readonly)
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountBytesMap, AccountLoader, PoolConfig, SwapUser, VenueAccount } from '../types.js';
import { readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'lemmingsfi';
export const LEMMINGSFI_PROGRAM_ID: Address<'BQEJZUB4CzoT6UhRffoCkqCyqQNrCPCSGHcPEmsdbEsX'> = address(
  'BQEJZUB4CzoT6UhRffoCkqCyqQNrCPCSGHcPEmsdbEsX',
);
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_INSTRUCTIONS = address('Sysvar1nstructions1111111111111111111111111');
/**
 * The program's only 76-byte owned account, anywhere — a global singleton
 * both real pools' real swaps pass as account[1]. See file header.
 */
export const LEMMINGSFI_CONFIG: Address<'6DZQsK3i1YtvyQCsWxZpY1Ski8dmSjqYnjCUPQiMqT1Z'> = address(
  '6DZQsK3i1YtvyQCsWxZpY1Ski8dmSjqYnjCUPQiMqT1Z',
);

const POOL_ACCOUNT_SIZE = 310;
export const OFF_MINT_A = 8;
export const OFF_MINT_B = 40;
export const OFF_VAULT_A = 72;
export const OFF_VAULT_B = 104;
export const OFF_PRICE_TICK = 168;
export const OFF_LAST_UPDATE_TS = 184;
/** Standard SPL Mint layout: `decimals` is a single byte at offset 44. */
const MINT_DECIMALS_OFFSET = 44;
const MINT_ACCOUNT_MIN_SIZE = 45;
/** Standard SPL token account layout: live `amount` u64 LE at offset 64. */
const AMOUNT_OFF = 64;

/** `price (mintB per mintA, natural units) = (priceTick + PRICE_TICK_BIAS) / PRICE_TICK_SCALE`. */
const PRICE_TICK_BIAS = 2n;
const PRICE_TICK_SCALE = 1000n;

/**
 * Self-drop threshold — see the file header's STALENESS section. Deliberately
 * far stricter than the keeper's own historical ~6s cadence; the real
 * on-chain threshold is not independently recovered.
 */
export const STALE_AFTER_SECONDS = 60n;

/** `Swap` — the permissionless instruction (see file header); NOT `Swap2`. */
const SWAP_DISCRIMINATOR = Uint8Array.from([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);
/** 9 zero bytes: min_out(8) + one padding byte, never observed non-zero. */
const SWAP_TAIL = new Uint8Array(9);

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Reduced (num, den) for `1000 * 10^decA / 10^decB`. */
function priceScaleFactor(decA: number, decB: number): { kNum: bigint; kDen: bigint } {
  let num = PRICE_TICK_SCALE * 10n ** BigInt(decA);
  let den = 10n ** BigInt(decB);
  const g = gcd(num, den);
  if (g > 1n) {
    num /= g;
    den /= g;
  }
  return { kNum: num, kDen: den };
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface LemmingsFiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintB in / mintA out, 1 = mintA in / mintB out. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  /** Reduced `1000 * 10^decA / 10^decB` — see file header "PRICING MODEL". */
  kNum: bigint;
  kDen: bigint;
  /** Live at fetch time — the recipe-side `gate` re-checks it against `now`. */
  lastUpdateTs: bigint;
}

function lemmingsfiConfig(cfg: PoolConfig): LemmingsFiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as LemmingsFiPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

function mintDecimalsFrom(mint: Address, data: Uint8Array | null): number {
  if (data === null) throw new Error(`${SLUG} mint ${mint} account not found`);
  if (data.length < MINT_ACCOUNT_MIN_SIZE) {
    throw new Error(`${SLUG} mint ${mint} account is ${data.length} bytes, too small for an SPL Mint`);
  }
  return data[MINT_DECIMALS_OFFSET];
}

export async function fetchLemmingsFiPoolConfig(load: AccountLoader, pool: Address): Promise<LemmingsFiPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
  }
  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);
  // Load each mint ONCE — the same bytes serve both T22 detection and the
  // decimals read below. The `Swap` ix is legacy-SPL only (Tokenkeg account[7]),
  // so SELF-DROP a Token-2022 mint (or one carrying an un-routable extension) by
  // throwing — the SvmRoute orchestrator catches a fetchPoolConfig throw and
  // drops the venue. An unreadable mint would fail the decimals read below anyway.
  const [mintAData, mintBData] = await Promise.all([load(mintA), load(mintB)]);
  for (const [mint, mintData] of [
    [mintA, mintAData],
    [mintB, mintBData],
  ] as const) {
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }
  const decA = mintDecimalsFrom(mintA, mintAData);
  const decB = mintDecimalsFrom(mintB, mintBData);
  const { kNum, kDen } = priceScaleFactor(decA, decB);
  return {
    venue: SLUG,
    pool,
    direction: 0,
    mintA,
    mintB,
    vaultA: pubkeyAt(data, OFF_VAULT_A),
    vaultB: pubkeyAt(data, OFF_VAULT_B),
    kNum,
    kDen,
    lastUpdateTs: readUintLE(data, OFF_LAST_UPDATE_TS, 8),
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = lemmingsfiConfig(base);
  return [
    { ref: 'vaultA', address: cfg.vaultA },
    { ref: 'vaultB', address: cfg.vaultB },
  ];
}

export const lemmingsfi = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: LEMMINGSFI_PROGRAM_ID,
  fetchPoolConfig: fetchLemmingsFiPoolConfig,
  quoteAccounts,
};

