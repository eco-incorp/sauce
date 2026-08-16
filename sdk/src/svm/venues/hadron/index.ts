/**
 * Hadron (SvmRoute venue — no on-chain IDL, no public docs). Program
 * `HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8` (Jupiter's own label-map
 * program id -> label, "Hadron"). Recovered entirely via live account reads
 * + real-transaction archaeology (`getSignaturesForAddress` +
 * `getTransaction`, ~6,000 recent signatures scanned, 97 real swap CPIs
 * found across 4 actively-traded pools) plus real `simulateTransaction`
 * probes (`sigVerify:false`) against the DEPLOYED program on real mainnet
 * state, 2026-07-31 — see ladder.ts's "QUOTE MODEL — evidence" section for
 * the measured numbers this file's registry comes from.
 *
 * ── SHAPE: ORACLE-ANCHORED INVENTORY (obric-style), NOT pool-resident CP ──
 * Every real pair account ("PAIR", 724 bytes, one per listed (mintA,mintB)
 * combination — 129 real PAIR accounts found via a full `getProgramAccounts`
 * dump) is priced from a PER-ASSET oracle field, not from its own two vault
 * balances: on the live jitoSOL/WSOL pool the raw vault ratio was
 * ~0.0657 WSOL-per-jitoSOL while every real/simulated swap executed at
 * ~1.292 WSOL-per-jitoSOL — a ~19.6x gap, conclusively ruling out a
 * constant-product read of the vaults (the SAME conclusion Scorch's own
 * file reached, there by a much smaller ~20% gap). The measured rate was
 * also near-FLAT across a 40x size range (1.29214 @ 0.05 SOL down to
 * 1.29208 @ 2 SOL, jitoSOL->WSOL) — the live per-mint oracle field is the
 * ~ONLY driver of price; the vault balance's real role is purely a hard
 * CAPACITY ceiling (a 50 SOL probe against the same pool — whose WSOL vault
 * held only ~3 WSOL — reverted `Custom(7)` rather than partially filling,
 * exactly the "vault balance as the cap" shape this integration's brief
 * named up front).
 *
 * ── ACCOUNT LAYOUT ──
 * PAIR (724 bytes, owned by this program): mintA @41 (32B), mintB @73 (32B),
 * a per-asset "role-B" record's OWN address @106 (32B, right after mintB —
 * ground-truthed: this is EXACTLY `accounts[4]` of every real swap CPI on
 * that pair, for 4 different pools/mint-pairs). mintA's OWN per-asset
 * records (`accounts[3]`/`accounts[5]`/`accounts[15]` of the real CPI — a
 * 128-byte "AssetConfig", a variable-length ~3.9-11.6KB "growing" history
 * account, and a 998-byte "meta" account) are NOT embedded anywhere in the
 * PAIR bytes (an exhaustive substring search over the full 724 bytes found
 * none of the three) and are not derivable via any PDA seed scheme this
 * pass could recover (~40 seed-literal x order x tag-byte combinations
 * tried against `getProgramDerivedAddress`, all misses) — they are vendored
 * per known mintA below (`HADRON_ASSET_REGISTRY`), the same "vendor what
 * can't be derived" shape as Scorch's `SCORCH_ASSET_CONFIGS`. mintB's own
 * per-asset "role-B" 56-byte record, in contrast, IS embedded in the PAIR
 * account (@106) and needs no vendoring.
 *
 * The 686-byte "global" account is NOT a single protocol-wide singleton — 3
 * of our 4 real pools shared one global address but the 4th (ORCA/USDC)
 * used a DIFFERENT one — so it is vendored per-mintA alongside the rest of
 * the registry, not hardcoded as a constant.
 *
 * vaultA/vaultB are the pool PDA's OWN standard Associated Token Accounts
 * (verified: `findAssociatedTokenPda({owner: pool, mint})` reproduces the
 * real vault address exactly for 2 different pools/4 different mints) — no
 * vendoring needed. The fee-destination account is likewise a standard ATA
 * of a single, fixed, venue-wide fee-treasury wallet
 * (`HADRON_FEE_AUTHORITY`) for whichever mint is the trade's INPUT —
 * verified exact against 3 different mints' real fee-destination addresses
 * from real landed transactions.
 *
 * SCOPE: this adapter only serves the SPECIFIC (mintA, mintB) pairing each
 * registry entry validates the price field against (see
 * `HADRON_ASSET_REGISTRY`) — real gPA census shows WSOL alone appears as
 * mintA in 30 of the 129 real PAIR accounts, spread across dozens of
 * distinct mintB partners we have NOT validated the field's units for; a
 * pool whose mintB does not match the registered quote self-drops with a
 * named error rather than risk a wrong-denominated rate (the "one bad
 * candidate never kills discovery" convention). The 4 registered pairs
 * (jitoSOL/WSOL, USDC/USDT, WSOL/USDC, ORCA/USDC) are exactly the ones this
 * pass could ground-truth.
 *
 * See ladder.ts for the swap instruction / account list, the quote model +
 * its evidence, and the measured CU.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import type { AccountLoader, PoolConfig, VenueAccount } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'hadron';

export const HADRON_PROGRAM_ID = address('HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8');
export const HADRON_TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const HADRON_CLOCK_SYSVAR = address('SysvarC1ock11111111111111111111111111111111');
/**
 * Single venue-wide fee-treasury wallet — the fee-destination account for
 * ANY input mint is `findAssociatedTokenPda({owner: HADRON_FEE_AUTHORITY,
 * mint})`, verified exact against 3 different mints' real fee-destination
 * addresses observed in real landed transactions.
 */
export const HADRON_FEE_AUTHORITY = address('7Ly5vZTDz2ZJGrqTa9gCP2NWjFDvnxSLVQEdmvMcVaVn');

export const HADRON_PAIR_ACCOUNT_SIZE = 724;
export const HADRON_OFF_MINT_A = 41;
export const HADRON_OFF_MINT_B = 73;
/** mintB's own "role-B" record address sits right after mintB in the PAIR account. */
export const HADRON_OFF_ASSET_CFG_B = 106;

/** SPL token account `amount` field offset (standard layout). */
export const HADRON_AMOUNT_OFF = 64;
export const HADRON_SPL_TOKEN_ACCOUNT_SIZE = 165;

/** Live oracle price field inside mintA's 128-byte AssetConfig — see ladder.ts's header. */
export const HADRON_PRICE_OFFSET = 40;
/** Q32.32 fixed-point scale the price field is carried in. */
export const HADRON_PRICE_SCALE = 1n << 32n;

/** Measured EXACT on both directions of both validated pairs — see ladder.ts's header. */
export const HADRON_FEE_PPM = 10n;
export const HADRON_PPM_DENOM = 1_000_000n;
/** Kept fraction after the conservative safety haircut (99.7% kept, 30 bps cut) — see ladder.ts's header. */
export const HADRON_HAIRCUT_PPM = 997_000n;

/**
 * Vendored per-mintA registry: the 3 auxiliary per-asset accounts that
 * cannot be derived from the PAIR account or any recovered PDA seed
 * (`assetCfgA`/`growingA`/`metaA`), plus the pair-scoped `global` config,
 * PLUS the ONE mintB the live oracle price field at `assetCfgA`'s
 * `HADRON_PRICE_OFFSET` has been ground-truthed against (see file header
 * "SCOPE") — a pool whose live mintB differs self-drops rather than reuse
 * the field for an unvalidated denomination.
 */
interface HadronAssetEntry {
  mintB: Address;
  assetCfgA: Address;
  growingA: Address;
  metaA: Address;
  global: Address;
}

const JITOSOL = address('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const WSOL = address('So11111111111111111111111111111111111111112');
const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const ORCA_MINT = address('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE');

const GLOBAL_SOL_FAMILY = address('63sGvdACSA2Kvf4yr7n7SFEJ9V1yAVVyyduPU3br8Lyt');
const GLOBAL_ORCA = address('6G1G2MiWuy5bsjpMnMTSKKxDm4qTkdShBPaxxQxwzZcX');

export const HADRON_ASSET_REGISTRY: Partial<Record<Address, HadronAssetEntry>> = {
  // jitoSOL/WSOL — PRIMARY evidence: 8 real simulateTransaction probes,
  // both directions, 4 sizes each (0.05-2 SOL / 0.001-0.5 SOL), all
  // successful; plus 8 real historical landed transactions.
  [JITOSOL]: {
    mintB: WSOL,
    assetCfgA: address('BKWdoS5GN6J9YFxANmdfb3rtcYUT8M4Hr6axB7j8pFDy'),
    growingA: address('ESRUJyvNhxCPSn1nEHYhNXBkkL61J5Veeeq7UTdkPiQe'),
    metaA: address('FDAzdHWFX9rawHp5o7phRH7BNnpCi24zRefusqC52Fqk'),
    global: GLOBAL_SOL_FAMILY,
  },
  // USDC/USDT — corroborating evidence: 1 real historical landed swap
  // (reciprocal-price cross-check within 0.006%).
  [USDC]: {
    mintB: USDT,
    assetCfgA: address('3GgL9m1MgRmypkky12wCzyCxuhjoWjVNHA94Ut4ve9UT'),
    growingA: address('2uxsuJWbihusTkcpM8nfAxEpDduBTcXXepGHCrPafc54'),
    metaA: address('B44mBtfYWxM7RJsTaZi5DF2gqVEQgjRKGrSutnAsFbym'),
    global: GLOBAL_SOL_FAMILY,
  },
  // WSOL/USDC — accounts + price-field mechanism confirmed (same field
  // shape/offset); no dedicated multi-size simulateTransaction probe.
  [WSOL]: {
    mintB: USDC,
    assetCfgA: address('8xZwN7U2CTWFcmfYAChE53d9S5nLWPGyrSbGJRRaQjFZ'),
    growingA: address('2RE24ajCYdtQw1YsCzM8RArfFuAazkRVgFMtPHPSfgJg'),
    metaA: address('2jCfc7sBuKEpSk7jt268oMvZwEQ2tDhrHaWBQJzao1JE'),
    global: GLOBAL_SOL_FAMILY,
  },
  // ORCA/USDC — accounts + price-field mechanism confirmed (same field
  // shape/offset); the one pair whose `global` config differs from the
  // other three (see file header) — no dedicated multi-size probe.
  [ORCA_MINT]: {
    mintB: USDC,
    assetCfgA: address('3xDWGsT3MduCMkmWHx3wCDkvcTZp6RSRHHZ9xqjB79Ai'),
    growingA: address('2dNY3WaTKfDVT6UUk1aJ7bLEeJp3oEhLt2KFsuq8bBRZ'),
    metaA: address('DawjQYpFYjB3svWRTeGTk97jDw4orwv447tTtTKJZyUs'),
    global: GLOBAL_ORCA,
  },
};

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface HadronPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'AtoB' (default, mintA in) | 'BtoA'. */
  direction: 'AtoB' | 'BtoA';
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  assetCfgA: Address;
  assetCfgB: Address;
  growingA: Address;
  metaA: Address;
  global: Address;
  feeVaultA: Address;
  feeVaultB: Address;
}

export function hadronConfig(cfg: PoolConfig): HadronPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as HadronPoolConfig;
}

export async function fetchHadronConfig(load: AccountLoader, pool: Address): Promise<HadronPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== HADRON_PAIR_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${HADRON_PAIR_ACCOUNT_SIZE}`);
  }
  const mintA = pubkeyAt(data, HADRON_OFF_MINT_A);
  const mintB = pubkeyAt(data, HADRON_OFF_MINT_B);
  const assetCfgB = pubkeyAt(data, HADRON_OFF_ASSET_CFG_B);

  const entry = HADRON_ASSET_REGISTRY[mintA];
  if (entry === undefined) {
    throw new Error(
      `${SLUG} pool ${pool}: mintA ${mintA} is not in the known asset registry — refresh HADRON_ASSET_REGISTRY in sdk/src/svm/venues/hadron/index.ts`,
    );
  }
  if (entry.mintB !== mintB) {
    throw new Error(
      `${SLUG} pool ${pool}: mintA ${mintA}'s registered/validated quote mint is ${entry.mintB}, but this pool's mintB is ${mintB} — ` +
        'the live oracle price field is denominated against the REGISTERED quote only, so an unvalidated pairing self-drops',
    );
  }

  // The swap CPI's token program is classic Tokenkeg, so detect a Token-2022
  // or un-routable mint via the shared data-shape resolver and SELF-DROP the
  // pool (the thrown error is the graceful-drop signal the SvmRoute orchestrator
  // catches). The LEGACY path is byte-identical: a classic 82-byte mint
  // classifies Tokenkeg with no extensions and this block is a no-op.
  for (const mint of [mintA, mintB]) {
    const mintData = await load(mint);
    if (mintData === null) continue; // an unreadable mint falls back to the legacy assumption
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const [vaultA] = await findAssociatedTokenPda({ owner: pool, mint: mintA, tokenProgram: HADRON_TOKEN_PROGRAM });
  const [vaultB] = await findAssociatedTokenPda({ owner: pool, mint: mintB, tokenProgram: HADRON_TOKEN_PROGRAM });
  const [feeVaultA] = await findAssociatedTokenPda({ owner: HADRON_FEE_AUTHORITY, mint: mintA, tokenProgram: HADRON_TOKEN_PROGRAM });
  const [feeVaultB] = await findAssociatedTokenPda({ owner: HADRON_FEE_AUTHORITY, mint: mintB, tokenProgram: HADRON_TOKEN_PROGRAM });

  const vaultAData = await load(vaultA);
  if (vaultAData === null) throw new Error(`${SLUG} pool ${pool}: vaultA ${vaultA} does not exist`);
  if (vaultAData.length !== HADRON_SPL_TOKEN_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool}: vaultA ${vaultA} has unexpected size ${vaultAData.length} (want ${HADRON_SPL_TOKEN_ACCOUNT_SIZE} — token-2022 vaults are not supported)`,
    );
  }
  const vaultBData = await load(vaultB);
  if (vaultBData === null) throw new Error(`${SLUG} pool ${pool}: vaultB ${vaultB} does not exist`);
  if (vaultBData.length !== HADRON_SPL_TOKEN_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool}: vaultB ${vaultB} has unexpected size ${vaultBData.length} (want ${HADRON_SPL_TOKEN_ACCOUNT_SIZE} — token-2022 vaults are not supported)`,
    );
  }

  return {
    venue: SLUG,
    pool,
    direction: 'AtoB',
    mintA,
    mintB,
    vaultA,
    vaultB,
    assetCfgA: entry.assetCfgA,
    assetCfgB,
    growingA: entry.growingA,
    metaA: entry.metaA,
    global: entry.global,
    feeVaultA,
    feeVaultB,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = hadronConfig(base);
  return [
    { ref: 'price', address: cfg.assetCfgA },
    { ref: 'vaultA', address: cfg.vaultA },
    { ref: 'vaultB', address: cfg.vaultB },
  ];
}

export const hadron = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: HADRON_PROGRAM_ID,
  fetchPoolConfig: fetchHadronConfig,
  quoteAccounts,
};
