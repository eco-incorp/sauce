/**
 * Scorch (SvmRoute venue, closed-source-binary reverse-engineering — no on-chain IDL; the same
 * RE method used for the WITHDRAWN BisonFi integration attempt, see docs/bisonfi-evidence.md —
 * this file does not import from it, the shared lineage is methodology only).
 *
 * PROGRAM SHAPE (ground-truthed against mainnet, 2026-07-31 — no source, no
 * IDL, no public docs; recovered via `solana program dump` + ELF strings +
 * real historical transaction decode, see the ledger below):
 *
 *   - CORE (`ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch`, Jupiter's own
 *     label-map program id for "Scorch") is a PURE PRICING/ACCOUNTING
 *     program: it owns the pool state (PairConfig/AssetConfig/a single
 *     global oracle account) and computes a quote + updates internal
 *     accounting, but never itself calls the token program — every real
 *     transaction shows zero nested CPIs under its own invoke frame.
 *   - ROUTER (`SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn`) is the actual
 *     custodian: it holds the pair's inventory in two vault token accounts
 *     under a single GLOBAL vault-authority PDA
 *     (`EHcege7dok1iYs7SxL2XzDPvhg6XzMVcx2V5SkMUurJP`, confirmed identical
 *     across two unrelated pairs — a program-wide singleton, not per-pair),
 *     pulls the input from the caller, CPIs into CORE for the quote, and
 *     pushes the output based on CORE's returned u64. THIS is the program
 *     our swap CPI targets — CORE alone would price a trade but move no
 *     funds.
 *
 * Both programs, plus the global oracle account, were dumped/read directly
 * off mainnet-beta and are what `test/svm/fixtures/scorch/` replays; six
 * live-mainnet historical transactions (both directions) and six FRESH
 * `simulateTransaction` probes against real, live pool state (three sizes
 * per direction: 1, 500 and 20,000 whole tokens) all executed cleanly with
 * the exact account list + instruction encoding this file emits — see
 * `docs/svm-venues.md`'s Scorch section for the full transcript.
 *
 * INSTRUCTION FORMAT (ROUTER's own swap ix, NOT a Jupiter-specific shim —
 * two independent unrelated pairs were observed calling the SAME program
 * with the SAME account shape): `[u8 disc=0x02][u8 subtag][16-byte
 * commitment][u64 LE amountIn][u64 LE minOut]`. Two subtag/commitment modes
 * were observed in the wild: `0xa0` + a large, hash-like 16-byte value (an
 * apparent price-commitment digest — the exact preimage was not recovered),
 * and `0x80` + an all-zero 16-byte value (no commitment). `0x80`+zero is
 * PROVEN LIVE-WORKING via the fresh simulate probes above (both directions,
 * three sizes each, on real current mainnet state) and is what this adapter
 * emits — the simpler, ground-truthed encoding, not a guess.
 *
 * PRICING MODEL (why the off-chain estimate is deliberately conservative):
 * CORE's true price comes from the oracle account (4130 bytes, layout NOT
 * recovered within this pass — a full oracle decode is future work). The
 * pool's OWN vault-reserve ratio is measurably NOT the trade price: for the
 * live JupSOL/pump pair on 2026-07-31, raw vault ratio was ~0.780 (jupSOL
 * per pump) while the REAL simulated swap rate was ~0.622 — a ~20% gap,
 * confirming this is an oracle-priced PMM, not a plain constant-product
 * pool. Rather than assert a specific mid-price we cannot back with a
 * decoded oracle read, `referenceQuote`/`emitQuoteCall` model a
 * constant-product curve over the LIVE vault reserves with a fixed 30%
 * conservative haircut (`SCORCH_HAIRCUT_PPM`) on top of the raw
 * reserve-ratio price — chosen so the modeled price stays BELOW the one
 * observed real rate by a comfortable margin (0.7 * 0.780 = 0.546 vs the
 * real 0.622) rather than tuned to match it exactly. This is intentionally
 * one-sided: a venue that looks WORSE than reality costs a missed
 * optimization (the merge under-uses it); a venue that looks BETTER than
 * reality wins elections it cannot honor (the documented "favourable error"
 * hazard) — so the haircut only ever pushes the wrong way when it is safe
 * to. `depthReserves` (liveness/relative-depth filtering) reads the REAL,
 * un-haircut vault balances — that gate cares about "is there any inventory
 * here", not price. Real execution always calls the real CPI, so a
 * mispriced off-chain estimate affects split QUALITY, never fund safety
 * (the recipe's minOut/priceLimit floor is unaffected by this file).
 * TODO: decode the oracle account layout and replace the haircut with a
 * real price read (would tighten the estimate; never required for safety).
 *
 * AssetConfig resolution: the router's account list needs both pair mints'
 * AssetConfig addresses, which are neither embedded in PairConfig nor
 * derivable via any PDA seed scheme this pass could recover (see
 * ./scorch-asset-configs.ts's header for what was tried) — resolved via a
 * vendored, recapturable directory instead.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountLoader, PoolConfig, VenueAccount } from '../types.js';
import { SCORCH_ASSET_CONFIGS } from './asset-configs.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'scorch';

/** CORE — pool state owner + pricing engine. This is `SVM_VENUE_PROGRAM_IDS.scorch`. */
export const SCORCH_CORE_PROGRAM_ID = address('ojh19ojaKduoJZuaJADhcVGp4xt1TcdAvZmpVsCorch');
/** ROUTER — the real custodian; the swap CPI's actual CALL target. */
export const SCORCH_ROUTER_PROGRAM_ID = address('SCoRcH8c2dpjvcJD6FiPbCSQyQgu3PcUAWj2Xxx3mqn');
// PairConfig (658 bytes, owned by CORE): tag(1)=0x02, flag(1), reserved(12)=0xff*12,
// idxA(u16 LE)@14, mintA(32)@16, vaultA(32)@48, idxB(u16 LE)@80, mintB(32)@82,
// vaultB(32)@114, an 8-byte tail @146 of unrecovered semantics, zero-padded to 658.
// Validated against 5 real mainnet PairConfig accounts spanning 2 distinct pairs.
const PAIR_CONFIG_SIZE = 658;
const PAIR_TAG = 0x02;
const OFF_MINT_A = 16;
const OFF_VAULT_A = 48;
const OFF_MINT_B = 82;
const OFF_VAULT_B = 114;

/**
 * Conservative haircut on the raw vault-reserve-ratio price (parts per
 * million of the naive constant-product output) — see this file's top
 * docblock for the measured justification. 300,000 = keep 70% of the naive
 * CP output.
 */
export const SCORCH_HAIRCUT_PPM = 300_000n;
export interface ScorchPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'AtoB' (default, mintA in / mintB out) | 'BtoA'. */
  direction: 'AtoB' | 'BtoA';
  mintA: Address;
  vaultA: Address;
  assetConfigA: Address;
  mintB: Address;
  vaultB: Address;
  assetConfigB: Address;
}

function b58Address(bytes: Uint8Array, offset: number): Address {
  // The 32-byte pubkey slice, re-encoded through `address()` so callers get a
  // real branded Address — no direct base58 dependency needed here.
  return address(b58encode(bytes.subarray(offset, offset + 32)));
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
  return B58_ALPHABET[0].repeat(pad) + s;
}

function scorchConfig(cfg: PoolConfig): ScorchPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as ScorchPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

export const scorch = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: SCORCH_CORE_PROGRAM_ID,

  /**
   * Reads the PairConfig account directly (mints + vaults; both mints' known
   * AssetConfig addresses resolved via the vendored directory). Throws a
   * clear, named error — never silently mis-decodes — on wrong size/tag, a
   * missing AssetConfig entry (a not-yet-snapshotted asset), or a
   * non-classic (likely token-2022) vault; any of those drops just this ONE
   * pool from discovery, per the venue-robustness convention.
   */
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<ScorchPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`scorch pool ${pool} does not exist`);
    if (data.length !== PAIR_CONFIG_SIZE) {
      throw new Error(`scorch pool ${pool} has unexpected size ${data.length} (want ${PAIR_CONFIG_SIZE})`);
    }
    if (data[0] !== PAIR_TAG) throw new Error(`scorch pool ${pool} has unexpected tag ${data[0]} (want ${PAIR_TAG})`);

    const mintA = b58Address(data, OFF_MINT_A);
    const vaultA = b58Address(data, OFF_VAULT_A);
    const mintB = b58Address(data, OFF_MINT_B);
    const vaultB = b58Address(data, OFF_VAULT_B);

    // The ROUTER's swap CPI moves both sides through the classic Tokenkeg
    // program, so a Token-2022 mint (or one carrying an un-routable extension)
    // must SELF-DROP. Detect the real token program per mint via the shared
    // data-shape resolver (replacing the old vault-size T22 proxy); the thrown
    // error IS the graceful drop (this ONE pool leaves discovery, per the
    // venue-robustness convention). LEGACY path unchanged: a classic 82-byte
    // mint classifies Tokenkeg, parses no extensions, config built as before. An
    // unreadable mint falls back to the legacy assumption.
    const mints = [mintA, mintB];
    const mintDatas = await Promise.all(mints.map((mint) => load(mint)));
    for (let mi = 0; mi < mints.length; mi++) {
      const mint = mints[mi]!;
      const mintData = mintDatas[mi]!;
      if (mintData === null) continue;
      if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(`scorch: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(`scorch: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
      }
    }

    const assetConfigAStr = SCORCH_ASSET_CONFIGS[mintA];
    const assetConfigBStr = SCORCH_ASSET_CONFIGS[mintB];
    if (assetConfigAStr === undefined) {
      throw new Error(
        `scorch pool ${pool}: no known AssetConfig for mint ${mintA} — refresh the consuming app scorch-asset-configs venue module`,
      );
    }
    if (assetConfigBStr === undefined) {
      throw new Error(
        `scorch pool ${pool}: no known AssetConfig for mint ${mintB} — refresh the consuming app scorch-asset-configs venue module`,
      );
    }

    // Vault structural existence check (the T22-vault size proxy that used to
    // live here is superseded by the per-mint Token-2022 detection above).
    const vaultEntries = [
      ['A', vaultA],
      ['B', vaultB],
    ] as const;
    const vaultBytesList = await Promise.all(vaultEntries.map(([, vault]) => load(vault)));
    for (let vi = 0; vi < vaultEntries.length; vi++) {
      const [role, vault] = vaultEntries[vi]!;
      const vaultBytes = vaultBytesList[vi]!;
      if (vaultBytes === null) throw new Error(`scorch pool ${pool}: vault${role} ${vault} does not exist`);
    }

    return {
      venue: SLUG,
      pool,
      direction: 'AtoB',
      mintA,
      vaultA,
      assetConfigA: address(assetConfigAStr),
      mintB,
      vaultB,
      assetConfigB: address(assetConfigBStr),
    };
  },

  quoteAccounts(base: PoolConfig): VenueAccount[] {
    const cfg = scorchConfig(base);
    return [
      { ref: `${cfg.pool}:vaultA`, address: cfg.vaultA },
      { ref: `${cfg.pool}:vaultB`, address: cfg.vaultB },
    ];
  },
};

