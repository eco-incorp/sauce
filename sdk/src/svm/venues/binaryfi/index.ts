/**
 * BinaryFi venue adapter — a closed-source program (program
 * `B72M6nyCLFgWiJtAN4naUTminMiTmyGcEqQHXwVeRdht`, Jupiter's own label
 * "BinaryFi" per `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`
 * in the sauce-recipes repo).
 * No on-chain Anchor IDL ships for this program, so everything below is
 * recovered by transaction archaeology (`getSignaturesForAddress` +
 * `getTransaction`) plus direct account-byte inspection, cross-checked
 * against MANY real mainnet swaps and the program's own `getProgramAccounts`
 * state — the same method that produced obric-v2/quantum/solfi-v2/scorch/
 * bisonfi.
 *
 * ── What this program actually is (evidence, not the name) ──
 * The overwhelming majority of the program's on-chain traffic (>90% of a
 * 1,000-signature recent sample, ~63 real seconds of mainnet time) is a
 * SEPARATE, single high-frequency keeper instruction (disc 0x04) that
 * touches up to 15 "Market" state accounts per call and moves NO tokens at
 * all (`preTokenBalances`/`postTokenBalances` empty, zero inner
 * instructions) — consistent with the "BinaryFi" name: a binary/derivative
 * pricing engine periodically marking many markets from an external
 * reference. That instruction is NOT wired here — it settles/marks
 * positions, not a swap, and nothing about it is safe or useful to a
 * spot-swap recipe.
 *
 * Separately, a MUCH rarer instruction (disc 0x08, found by following
 * `getSignaturesForAddress` on a Market's own vault-authority PDA rather
 * than the program id — the keeper spam otherwise drowns it out) is a
 * genuine two-mint SPL transfer: it pulls `amountIn` of the market's quote
 * mint from a caller-provided ATA into the market's own quote vault, and
 * pushes `amountOut` of the market's asset mint from the market's own asset
 * vault to a caller-provided destination ATA — real, CPI-verified token
 * movement, confirmed on 24+ real historical fills. THIS is the leg wired
 * below.
 *
 * ── Why this is still priced as an event-conditional product, not a plain
 * spot AMM (the maintainer's own fallback applies) ──
 * A naive constant-product model over the market's LIVE vault reserves was
 * checked against those 24 real fills and is UNSAFE: at one real, observed
 * reserve state the CP-off-reserves estimate would have promised 6.77x the
 * REAL fill (108,429,866,928 modeled vs 16,016,568,246 real, on the
 * `GWqUcqoZtjq8K6H48YvcHJMEGq8CahNDGMuz3iqU4ESA` market — see
 * `./asset-configs.ts`'s header for the full probe table). Meanwhile
 * the REAL per-fill rate (assetOut/quoteIn, raw units) stayed inside an
 * ~5.2% band across 4+ orders of magnitude of trade size AND reserve state
 * that itself varied by 5+ orders of magnitude — i.e. the fill price is
 * driven by an external reference (almost certainly the same keeper feed
 * that marks the "Market" accounts), NOT by the vault's own reserve ratio.
 * A vault-ratio CP quote is therefore not merely inexact here, it is
 * UNSOUND: there is no fixed haircut that makes it safe in general, because
 * the reserve ratio has no bounded relationship to the real price (unlike
 * scorch/humidifi/bisonfi, where CP-off-reserves is a genuine, if imprecise,
 * proxy for the real curve).
 *
 * The safe, general fallback this shape calls for — "if the payoff is
 * event-conditional, wire only the spot leg and gate the rest out of the
 * universe" — is applied at PER-MARKET granularity: the real swap CPI
 * (100% ground-truthed, always executes correctly on-chain regardless of our
 * off-chain estimate) is wired for every BinaryFi market, but the OFF-CHAIN
 * quote only serves markets with a directly-measured, conservative
 * per-asset floor rate in `./asset-configs.ts` — a vendored,
 * recapturable directory in the same shape as scorch's `asset-configs.ts`,
 * just for a PRICE floor instead of an account address. A market whose
 * asset mint has no calibrated entry is dropped from discovery at fetch
 * time (a named error, self-drops just that one pool) rather than served
 * with a meaningless universal constant — 21 of the 22 live markets
 * currently fall in this bucket and will simply not be served until
 * independently measured and added to the directory.
 *
 * ── Market account layout (666 bytes, discriminator `f7ede3f5d7c3de46`) ──
 * Recovered by locating the KNOWN vault-authority/mint/vault addresses of a
 * real market as raw bytes inside its own account (confirmed identically
 * across 4 distinct markets):
 *   OFF_VAULT_AUTHORITY = 10  (pubkey, 32 bytes — PER-MARKET, not a program
 *                              constant: two different markets were measured
 *                              carrying two different vault-authority PDAs)
 *   OFF_ASSET_MINT      = 42  (pubkey, 32 bytes)
 *   OFF_QUOTE_MINT      = 74  (pubkey, 32 bytes — always USDC/USDT/wSOL in
 *                              the 22 live markets observed)
 *   OFF_ASSET_VAULT     = 106 (pubkey, 32 bytes — a real SPL token account)
 *   OFF_QUOTE_VAULT     = 138 (pubkey, 32 bytes — a real SPL token account)
 * `getProgramAccounts` on the program returns exactly 23 owned accounts: the
 * 22 markets above plus ONE distinct 430-byte account
 * (`AR7uY4Uzn8Zhzvb1XiqfoejuVYgimFAVTwnFBqTnGznS`) that never appears inside
 * any market's own bytes — a single global config account, present as a
 * fixed account in every observed swap.
 *
 * ── Swap instruction (disc 0x08, 17 bytes) — reverse-engineered from 24+
 * real landed swaps on the `GWqUcqoZtjq8...` market, all routed through a
 * third-party aggregator (`T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT`) ──
 *   byte 0      : discriminator, 0x08 (the only variant this adapter's
 *                 evidence covers)
 *   bytes 1..9  : amountIn, u64 LE (EXACT — confirmed against the quote
 *                 vault's real balance delta on 5 independently
 *                 cross-checked fills)
 *   bytes 9..17 : 0 in every one of the 24 real samples (min_out /
 *                 unused — kept 0, like every sibling adapter in this file
 *                 family; Sauce's own minOut/priceLimit remain the real
 *                 floor)
 *
 * ── Accounts (13, direction FIXED — every real sample observed the SAME
 * quote-in/asset-out direction; see the direction note below) ──
 *   0  user.owner   (writable, signer)  — the trade's authority
 *   1  CONFIG                            (readonly)  — the global config account
 *   2  market       (writable)           — the 666-byte market account
 *   3  vaultAuthority (readonly, PDA)     — per-market, signs the payout leg
 *   4  assetMint                          (readonly)
 *   5  quoteMint                          (readonly)
 *   6  assetVault    (writable)           — market's own asset-mint vault
 *   7  quoteVault    (writable)           — market's own quote-mint vault
 *   8  user.inAta    (writable)           — caller's quote-mint ATA (source)
 *   9  user.outAta   (writable)           — caller's asset-mint ATA (dest)
 *   10 TOKEN_PROGRAM  (readonly, listed TWICE — verified against real chain
 *      data, not a transcription artifact, same pattern as bisonfi/scorch)
 *   11 TOKEN_PROGRAM  (readonly)
 *   12 SYSVAR_INSTRUCTIONS (readonly)
 * Writable/signer flags above are read directly off a real transaction's own
 * top-level account-meta list (the CPI's account refs are also present
 * there via an address lookup table), not assumed.
 *
 * ── Direction: ONLY the proven leg is wired ──
 * Every one of the 24 real samples is quote-in / asset-out (buying the
 * asset with the market's quote currency). No reverse-direction (asset-in /
 * quote-out) fill was ever observed, and given the event-conditional pricing
 * evidence above, this adapter does NOT assume symmetry — the consuming
 * recipe's `applyDirection` throws on anything but the default direction,
 * the same "single proven direction, no assumed mirror" pattern
 * `saber-stableswap`/`meteora-damm-v1-stable` already use for an entirely
 * different (curve-shape) reason.
 *
 * ── Quote model — a per-asset conservative FLAT RATE, capped at the live
 * asset vault balance (NOT a constant-product curve — see the module header
 * above for why CP is unsound here) ──
 * `referenceQuote`/`emitQuoteCall` compute `min(x * floorRateNum /
 * floorRateDen, liveAssetVaultBalance)` — piecewise-linear and concave (flat
 * marginal rate below the live cap, zero marginal beyond it), monotone
 * non-decreasing, and `quote(0) === 0`. The live cap is a genuine, always-
 * true Token-Program invariant (a vault can never pay out more than it
 * holds) so capping there can only ever make the model MORE conservative,
 * never less. The floor rate itself is a per-asset constant from
 * `./asset-configs.ts`, deliberately far below every real observed
 * fill rate (see that file for the calibration). Real execution always
 * calls the real CPI, so a conservative off-chain estimate costs only a
 * missed optimization (this venue is under-elected relative to its true
 * depth), never a fund-safety issue — the same one-sided-safe convention
 * `depthReserves` (liveness/relative-depth filtering) follows elsewhere in
 * this file family: it reads the REAL, un-haircut vault balances, since
 * that gate cares about "is there any inventory here", not price.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountBytesMap, AccountLoader, PoolConfig, SwapUser, VenueAccount } from '../types.js';
import { BINARYFI_ASSET_FLOOR_RATES } from './asset-configs.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'binaryfi';

export const BINARYFI_PROGRAM_ID = address('B72M6nyCLFgWiJtAN4naUTminMiTmyGcEqQHXwVeRdht');
/** Single global config account, shared by every market (see file header). */
export const BINARYFI_CONFIG = address('AR7uY4Uzn8Zhzvb1XiqfoejuVYgimFAVTwnFBqTnGznS');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR_INSTRUCTIONS = address('Sysvar1nstructions1111111111111111111111111');

// Market account (666 bytes, owned by the program): tag(8)=f7ede3f5d7c3de46,
// initFlag(1)@8, vaultAuthorityBump(1)@9, vaultAuthority(32)@10,
// assetMint(32)@42, quoteMint(32)@74, assetVault(32)@106, quoteVault(32)@138,
// remaining 496 bytes = round/keeper state this adapter does not read.
// Validated against 4 real mainnet market accounts (2 of them cross-checked
// against their vault token accounts' own on-chain `owner` field).
const MARKET_ACCOUNT_SIZE = 666;
const MARKET_DISCRIMINATOR_HEX = 'f7ede3f5d7c3de46';
const OFF_VAULT_AUTHORITY = 10;
const OFF_ASSET_MINT = 42;
const OFF_QUOTE_MINT = 74;
const OFF_ASSET_VAULT = 106;
const OFF_QUOTE_VAULT = 138;

/** A standard (Tokenkeg) SPL token account's `amount` field offset. */
const VAULT_AMOUNT_OFFSET = 64;
const SPL_TOKEN_ACCOUNT_SIZE = 165;

/** Measurement-only ppm denominator — see `continuousFees` below. */
const FEE_PPM_DENOM = 1_000_000n;

export interface BinaryFiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  vaultAuthority: Address;
  assetMint: Address;
  quoteMint: Address;
  assetVault: Address;
  quoteVault: Address;
  /** Conservative per-asset floor rate (assetOut-raw per quoteIn-raw) — see asset-configs.ts. */
  floorRateNum: bigint;
  floorRateDen: bigint;
}

function readUintLE(bytes: Uint8Array, offset: number, len: number): bigint {
  let v = 0n;
  for (let i = len - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[offset + i]!);
  return v;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n /= 58n;
    s = B58_ALPHABET[r] + s;
  }
  let pad = 0;
  for (const b of bytes) {
    if (b === 0) pad++;
    else break;
  }
  return B58_ALPHABET[0]!.repeat(pad) + s;
}

function b58Address(bytes: Uint8Array, offset: number): Address {
  return address(b58encode(bytes.subarray(offset, offset + 32)));
}

function binaryfiConfig(cfg: PoolConfig): BinaryFiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as BinaryFiPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

export const binaryfi = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: BINARYFI_PROGRAM_ID,

  /**
   * Reads the Market account directly (vault-authority, both mints, both
   * vaults). Throws a clear, named error — never silently mis-decodes — on
   * wrong size/tag or a non-classic (likely token-2022) vault; either drops
   * just this ONE pool from discovery. Separately gates on a calibrated
   * floor rate for the decoded asset mint (`BINARYFI_ASSET_FLOOR_RATES`) —
   * a market whose asset has not been independently measured is dropped
   * the same way, per this file's module header.
   */
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<BinaryFiPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`binaryfi market ${pool} does not exist`);
    if (data.length !== MARKET_ACCOUNT_SIZE) {
      throw new Error(`binaryfi market ${pool} has unexpected size ${data.length} (want ${MARKET_ACCOUNT_SIZE})`);
    }
    const discHex = Buffer.from(data.subarray(0, 8)).toString('hex');
    if (discHex !== MARKET_DISCRIMINATOR_HEX) {
      throw new Error(`binaryfi market ${pool} has unexpected discriminator ${discHex} (want ${MARKET_DISCRIMINATOR_HEX})`);
    }

    const vaultAuthority = b58Address(data, OFF_VAULT_AUTHORITY);
    const assetMint = b58Address(data, OFF_ASSET_MINT);
    const quoteMint = b58Address(data, OFF_QUOTE_MINT);
    const assetVault = b58Address(data, OFF_ASSET_VAULT);
    const quoteVault = b58Address(data, OFF_QUOTE_VAULT);

    // The on-chain swap ix (disc 0x08) is legacy-SPL only (one token_program
    // slot, listed twice), so a Token-2022 mint (or one carrying an un-routable
    // extension) SELF-DROPS this market: the thrown error is the graceful-drop
    // signal the SvmRoute orchestrator catches. An unreadable mint falls back to
    // the legacy assumption (a classic 82-byte mint classifies legacy → no throw
    // → config built byte-identically to before).
    const mintList = [assetMint, quoteMint];
    const mintDatas = await Promise.all(mintList.map((mint) => load(mint)));
    for (let mi = 0; mi < mintList.length; mi++) {
      const mint = mintList[mi]!;
      const mintData = mintDatas[mi];
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(`binaryfi: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(`binaryfi: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
      }
    }

    const floorRate = BINARYFI_ASSET_FLOOR_RATES[assetMint];
    if (floorRate === undefined) {
      throw new Error(
        `binaryfi market ${pool}: no calibrated floor rate for asset mint ${assetMint} — refresh sdk/src/svm/venues/binaryfi/asset-configs.ts`,
      );
    }

    const vaultEntries = [
      ['asset', assetVault],
      ['quote', quoteVault],
    ] as const;
    const vaultDatas = await Promise.all(vaultEntries.map(([, vault]) => load(vault)));
    for (let vi = 0; vi < vaultEntries.length; vi++) {
      const [role, vault] = vaultEntries[vi]!;
      const vaultBytes = vaultDatas[vi];
      if (vaultBytes === null) throw new Error(`binaryfi market ${pool}: ${role}Vault ${vault} does not exist`);
      if (vaultBytes.length !== SPL_TOKEN_ACCOUNT_SIZE) {
        throw new Error(
          `binaryfi market ${pool}: ${role}Vault ${vault} has unexpected size ${vaultBytes.length} (want ${SPL_TOKEN_ACCOUNT_SIZE} — token-2022 vaults are not supported)`,
        );
      }
    }

    return {
      venue: SLUG,
      pool,
      vaultAuthority,
      assetMint,
      quoteMint,
      assetVault,
      quoteVault,
      floorRateNum: floorRate[0],
      floorRateDen: floorRate[1],
    };
  },

  quoteAccounts(base: PoolConfig): VenueAccount[] {
    const cfg = binaryfiConfig(base);
    return [
      { ref: `${cfg.pool}:assetVault`, address: cfg.assetVault },
      { ref: `${cfg.pool}:quoteVault`, address: cfg.quoteVault },
    ];
  },
};

