/**
 * WhaleStreet — a closed-source Solana AMM (program
 * `FW6zUqn4iKRaeopwwhwsquTY6ABWLLgjxtrC3VPnaWBf`, Jupiter label `"WhaleStreet"`
 * per `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`),
 * 5.7M/7d, 0.8M/24h real volume per the integration brief this venue was
 * scoped from. No on-chain IDL ships for this program — everything below is
 * recovered by live account/transaction archaeology, the same method used
 * for obric-v2/solfi-v2/scorch.
 *
 * ── DISCOVERY (a live `getProgramAccounts`, owner=program, no filters) ──
 * Found exactly 4 live pools at the time of this integration, ALL a fixed
 * 605-byte "pool" account: `2EeB1sfELZykmHvms37B9G2mKmrAZ6S7NcsamiyjaJW6`,
 * `8K1JEwrRYwBcvsFNtkFo41fnA2nhfeQ8twrQwvqvt1Xp`,
 * `FMcPAGCC8rDsLEFAp3WufXpuhRMqnaXuAJqxN5hU2ZeA`,
 * `Hhugr5Bw2NpmM4zKgDcQpypnVG7UPjcFFtHeaTbz764h` (the SOL/USDC pool Jupiter
 * itself routed every quote below through). Byte offsets (below) were
 * ground-truthed by scanning ALL FOUR accounts for embedded pubkeys
 * (`getMultipleAccounts`, checking which candidate 32-byte windows resolve to
 * a real on-chain account) and cross-checking owners:
 *
 *   [22:54)   mintA   (owner = Tokenkeg — a real SPL mint; WSOL on 3 of 4 pools)
 *   [54:86)   vaultA  (owner = Tokenkeg — an SPL token account holding mintA)
 *   [95:127)  a Pyth-v2-format account (magic 0xa1b2c3d4, owner
 *             `FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH`, Pyth's mainnet
 *             price-oracle program) — see "OBSERVED BUT UNUSED" below.
 *   [137:169) mintB   (USDC on all 4 pools observed)
 *   [169:201) vaultB
 *   [210:242) a second Pyth-v2 account (USDC's; IDENTICAL address across all
 *             4 pools, since mintB is USDC on every one observed)
 *   [260:292) a further Tokenkeg-owned, Mint-shaped (82-byte rent) account,
 *             UNIQUE per pool (plausibly an LP/fee mint) — not decoded, not
 *             needed by anything below.
 *   [301:397) three System-Program-owned pubkeys, IDENTICAL across all 4
 *             pools (plausibly a shared treasury/authority) — not decoded,
 *             not part of the swap account list evidenced below.
 *
 * OBSERVED BUT UNUSED — the embedded Pyth-v2 feeds are DEAD, not live: a
 * live read of the SOL feed at `[95:127)`'s address
 * (`H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG`, itself Pyth's well-known
 * mainnet SOL/USD price account) has `last_slot_`/`valid_slot_` frozen at
 * 281,687,928 / 299,058,481 while the cluster's current slot at read time was
 * ~436,477,xxx — many tens of millions of slots stale (Pyth's own crank
 * abandoned this legacy v2 account format years before this integration).
 * Its stored `price`/`expo` (SOL ≈ $119.23, USDC ≈ $1.00) are accordingly an
 * ancient snapshot, not a live rate. This model does NOT read either feed —
 * see "QUOTE MODEL" below for what it reads instead, and for why a plain
 * raw-vault-ratio price is *also* unsafe here.
 *
 * ── SWAP CPI — reverse-engineered via REAL `simulateTransaction` calls
 * against the DEPLOYED program (sigVerify:false, replaceRecentBlockhash,
 * innerInstructions:true), routed through Jupiter's OWN aggregator
 * (`lite-api.jup.ag/swap/v1/{quote,swap}`, `onlyDirectRoutes=true,
 * dexes=WhaleStreet`) so the exact bytes are Jupiter's real, currently-valid
 * construction, not a guess — on the `Hhugr5Bw2Np...` SOL/USDC pool, at 4
 * sizes (0.5, 1, 1 again, 2 SOL sells) plus one 100-USDC buy (the reverse
 * direction) ──
 *
 * ACCOUNTS (8, order load-bearing, IDENTICAL across all 5 samples/both
 * directions — confirmed via the transaction's own address-lookup-table
 * resolution, not just the label the simulator printed):
 *   0 pool         (writable)
 *   1 user mintA-side ATA (writable) — source when selling mintA, dest when buying it
 *   2 user mintB-side ATA (writable) — mirror of account 1
 *   3 vaultA       (writable)
 *   4 vaultB       (writable)
 *   5 owner        (signer, writable)
 *   6 token program (Tokenkeg, read-only)
 *   7 instructions sysvar (read-only)
 * Account POSITIONS do not swap when direction reverses (both the 1 SOL
 * sell and the 100 USDC buy sample carry this exact 8-account shape/order);
 * direction is therefore selected inside the (unrecovered — see below)
 * instruction data, not by account order.
 *
 * INSTRUCTION DATA — 42 bytes total. `byte[0] = 0x01` plus a further 8-byte
 * tag (`20ac01b7b55270e6`) were IDENTICAL across every one of the 5 samples
 * (3 sizes + a repeat + the reverse direction) — this 9-byte prefix is
 * real and reproducible, but was only cross-checked on ONE pool
 * (`Hhugr5Bw2Np...`), not against a second pool, so it may be pool-specific
 * rather than a global Anchor-style discriminator. The remaining 33 bytes
 * are NOT recovered: exhaustively checked (every 4- and 8-byte-wide window,
 * every offset) against amountIn and the realized outAmount via plain
 * little-endian, XOR-with-a-fixed-mask, and affine-mod-2^64 hypotheses —
 * none matched at any offset, across 3 independent sizes. What IS clear:
 * the SAME amount at the SAME pool/direction produces byte-identical output
 * across two separate requests a minute apart for the first ~25 of those 33
 * bytes (a deterministic, amount-dependent encoding), while the LAST 8 bytes
 * differ between those same two identical-amount requests (a per-request
 * nonce/anti-replay value). Cracking either was not possible in the time
 * available — same class of gap as this repo's `humidifi` venue (a
 * per-transaction encoding this integration cannot reproduce) and `scorch`
 * (a price transform "not recovered in the time available"). `buildSwapV2`
 * below therefore emits the REAL, validated prefix/account plan but an
 * EMPTY (incomplete) suffix — it does not compile into a working real
 * trade — and the recipe-side gate on this family self-drops every
 * candidate so a cook can never select it until this is resolved.
 *
 * CU — MEASURED directly from the real CPI (not a LiteSVM stand-in: the
 * simulator's own per-program "consumed" log line for WhaleStreet's
 * top-level invocation), across all 5 real samples: 95,403 / 95,404 / 95,416
 * / 95,417 CU selling SOL->USDC (0.5, 2, repeat-1, 1 SOL) and 74,561 CU
 * buying USDC->SOL (100 USDC). CU is measured on the final native path at
 * request time (simulateBundle), not baked into any per-family constant.
 *
 * ── QUOTE MODEL — deliberately conservative, NOT WhaleStreet's real curve ──
 * REJECTED FIRST HYPOTHESIS (kept as a citable mistake, not a footnote):
 * pricing directly off the two vaults' raw SPL balances. Live state at
 * capture time: vaultA (WSOL) = 1,892,908,784,339 raw (~1892.91 SOL), vaultB
 * (USDC) = 164,646,915,519 raw (~164,646.92 USDC) — raw ratio implies ~86.98
 * USDC/SOL. The REAL, simulated executed rate across 3 real trades (below)
 * is ~72.96 USDC/SOL — the raw ratio is ~19.2% ABOVE the real rate, i.e. a
 * plain constant-product-over-raw-balances model would be a gross
 * FAVOURABLE mispricing, the exact hazard this integration guards against.
 * This pool's real pricing is evidently NOT its own raw vault ratio (nor,
 * per "OBSERVED BUT UNUSED" above, the embedded — dead — oracle accounts);
 * WhaleStreet has some other, undisclosed pricing mechanism this
 * integration cannot read.
 *
 * REAL calibration data (the venue's own REALIZED output — read from the
 * simulated CPI's inner SPL `transfer` instruction, not the /quote
 * estimate — for 3 real sells on the same live pool/vault state above):
 *   500,000,000 raw SOL  -> 36,479,962 raw USDC  (72.9599 USDC/SOL)
 *   1,000,000,000 raw SOL -> 72,960,538 raw USDC  (72.9605 USDC/SOL)
 *   2,000,000,000 raw SOL -> 145,919,821 raw USDC (72.9599 USDC/SOL)
 * (plus a wide-size sanity-only /quote estimate: 500,000,000,000 raw SOL ->
 * 36,460,084,432 raw USDC, 72.9202 USDC/SOL — a QUOTE, not a simulated fill,
 * used only to confirm the rate stays flat, not as a calibration point).
 * The rate is nearly FLAT across 4 orders of magnitude of size — this reads
 * as an oracle/PMM-anchored venue with very little reserve-depth decay
 * within normal trade sizes, not a thin constant-product pool.
 *
 * THE SHIPPED MODEL: a plain symmetric constant-product curve over the two
 * LIVE raw vault balances, with the OUTPUT side haircut by a fixed 30%
 * (`OUT_HAIRCUT_NUM/DEN = 7/10`) before the curve runs. Real depth is real,
 * on-chain, verifiable state, and a flat haircut on the OUTPUT side pins the
 * curve's initial marginal rate safely BELOW the real rate without needing
 * to know WhaleStreet's real formula. 0.7 * 86.98 ≈ 60.9 USDC/SOL initial
 * marginal rate — comfortably (~16.5%) below every one of the 4 real rates
 * measured above (72.92-72.96), with margin to spare over the ~19.2% the
 * raw ratio itself was too high by. Monotone + concave by construction (a
 * standard CP curve) — `predicted <= realized` holds at all 3 real sizes.
 * The real on-chain CPI (once its instruction payload is someday recovered)
 * still executes WhaleStreet's OWN pricing regardless of this model's
 * accuracy — this curve only shapes off-chain election/sizing.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueLadder,
  SwapUser,
  VenueAccount,
} from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'whalestreet';
export const WHALESTREET_PROGRAM_ID = address('FW6zUqn4iKRaeopwwhwsquTY6ABWLLgjxtrC3VPnaWBf');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_INSTRUCTIONS = address('Sysvar1nstructions1111111111111111111111111');

const POOL_ACCOUNT_SIZE = 605;
export const WHALESTREET_OFF_MINT_A = 22;
export const WHALESTREET_OFF_VAULT_A = 54;
export const WHALESTREET_OFF_MINT_B = 137;
export const WHALESTREET_OFF_VAULT_B = 169;
/** SPL token account `amount` field offset (Tokenkeg layout). */
const AMOUNT_OFF = 64;

/**
 * The REAL, validated 9-byte instruction-data prefix — opcode 0x01 plus an
 * 8-byte tag observed identical across all 5 real captured samples (3
 * sizes + a repeat + the reverse direction) on the ONE pool this
 * integration validated against. See the module doc's "INSTRUCTION DATA".
 */
export const WHALESTREET_IX_PREFIX = Uint8Array.from([0x01, 0x20, 0xac, 0x01, 0xb7, 0xb5, 0x52, 0x70, 0xe6]);

/** Conservative haircut on the modeled OUTPUT side — see the module doc's "QUOTE MODEL". */
const OUT_HAIRCUT_NUM = 7n;
const OUT_HAIRCUT_DEN = 10n;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface WhalestreetPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA in / mintB out, 1 = mintB in / mintA out. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
}

function whalestreetConfig(cfg: PoolConfig): WhalestreetPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as WhalestreetPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

export async function fetchWhalestreetPoolConfig(load: AccountLoader, pool: Address): Promise<WhalestreetPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
  }
  const mintA = pubkeyAt(data, WHALESTREET_OFF_MINT_A);
  const mintB = pubkeyAt(data, WHALESTREET_OFF_MINT_B);
  // This venue's swap CPI is legacy-SPL (Tokenkeg) only. Detect a Token-2022
  // (or otherwise un-routable) mint per side and GRACEFULLY SELF-DROP the pool
  // (the SvmRoute orchestrator catches a fetchPoolConfig throw and drops the
  // venue). The LEGACY path is byte-identical; an unreadable mint falls back to
  // the legacy assumption.
  for (const mint of [mintA, mintB]) {
    const mintData = await load(mint);
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }
  return {
    venue: SLUG,
    pool,
    direction: 0,
    mintA,
    mintB,
    vaultA: pubkeyAt(data, WHALESTREET_OFF_VAULT_A),
    vaultB: pubkeyAt(data, WHALESTREET_OFF_VAULT_B),
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = whalestreetConfig(base);
  return [
    { ref: 'vaultA', address: cfg.vaultA },
    { ref: 'vaultB', address: cfg.vaultB },
  ];
}

/** Partial v1-shaped helper (fetchPoolConfig/quoteAccounts only) — this venue is ladder-only (v2); see whalestreetLadder below for the full adapter surface. */
export const whalestreet = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: WHALESTREET_PROGRAM_ID,
  fetchPoolConfig: fetchWhalestreetPoolConfig,
  quoteAccounts,
};

