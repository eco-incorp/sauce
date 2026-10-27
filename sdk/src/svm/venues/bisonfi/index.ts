/**
 * BisonFi venue adapter (program `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`) —
 * a closed-source, keeper-oracle-priced AMM. No on-chain IDL ships for this
 * program; everything below was recovered by account/byte inspection and
 * cross-checked directly against LIVE mainnet state (a full `getProgramAccounts`
 * sweep of all 18 live pools, `getSignaturesForAddress` + `getTransaction`
 * archaeology on 6 real landed swaps, and a real keeper price-push
 * transaction), not merely against a single fixture.
 *
 * ── Pool account (2048 bytes, FIXED size — confirmed on all 18 live pools) ──
 *   OFF_VAULT_A = 120  (pubkey, 32 bytes — SPL vault for "mint A")
 *   OFF_VAULT_B = 152  (pubkey, 32 bytes — SPL vault for "mint B")
 *   OFF_MINT_A  = 184  (pubkey, 32 bytes)
 *   OFF_MINT_B  = 216  (pubkey, 32 bytes)
 * Live-verified (2026-08-03) on pool `8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo`:
 * mintA decodes to `So1111...1112` (wSOL), mintB to `EPjFWdd5...Dt1v` (USDC) —
 * "mint A" is consistently the base side, "mint B" the quote side, across
 * every pool this adapter reads.
 *
 * ── Price is a PLAIN fixed-point field in the pool account, not an external
 * oracle account and not the vault ratio ──
 *   PRICE_OFFSET = 838, u64 LE, Q24.40 (i.e. divide by 2^40), HUMAN units:
 *   quote-per-whole-base (e.g. USDC per whole SOL, not per lamport/native
 *   unit). Verified 2026-08-03 by decoding this field on THREE live pools
 *   quoting the same base (wSOL) against three DIFFERENT quote mints:
 *   73.494367 (8FnX3x, wSOL/USDC), 73.547394 (6b5Lxe, wSOL/USD1), 73.553899
 *   (FJnaii, wSOL/USDT) — agreement within ~8bps across independent pools,
 *   which a vault-ratio read could never produce (vault ratios on this venue
 *   span ~11 orders of magnitude venue-wide — inventory, not a price signal).
 *   A cbBTC/USDC pool (`2vPjbP...`) read 63,473.13 the same pass, consistent
 *   with the live BTC/SOL cross. This field is read LIVE on-chain (not
 *   baked) — see PARAMS below for what IS baked.
 *
 * ── Freshness gate: a nanosecond keeper timestamp sits in the SAME account ──
 *   TS_OFFSET = 88, u64 LE, UNIX NANOSECONDS. A live `getProgramAccounts`
 *   sweep of all 18 pools (2026-08-03) splits cleanly into two populations:
 *   six pools age 0-1s (actively kept fresh: `2vPjbP`, `6b5Lxe`, `8FnX3x`,
 *   `AfaA4C`, `DSzgmz`, `FJnaii`) and the rest 5.8M-10.7M SECONDS stale
 *   (weeks to months: `51FQwj`, `AWVYnC`, `7ZTpmq`, `FC9pWt`, `4XkEAU`,
 *   `Gsu4Wm`, `9fLzyy`, `4X3seJ`, `6U1kWA`, `CKc2gy`) — no middle ground.
 *   The stale pools' own stored prices are visibly wrong (e.g. three stale
 *   wSOL pools read 82.47/82.56/86.25/86.59 against the ~73.5 live cross
 *   above) — quoting them unconditionally would be a favourable-error
 *   hazard, not a merely-stale one. `STALE_SECONDS` below (60s) comfortably
 *   separates the two populations (the live set never exceeded 1s in this
 *   sample; the stale set's SHORTEST gap was ~1.6 million seconds) while
 *   tolerating ordinary keeper/RPC jitter. Corroborated independently: a
 *   real keeper price-push transaction (disc 0x14, 97 bytes, accounts
 *   `[signer, SysvarClock, pool, pool, pool]`) carries a payload whose bytes
 *   are found verbatim inside the pool account at `TS_OFFSET`/`PRICE_OFFSET`
 *   (offset by a fixed 824-byte record-to-account delta) — this field really
 *   is the keeper's own push timestamp, not an unrelated counter.
 *
 * ── Per-direction fee, also plaintext in the pool account ──
 *   Two conspicuously-round u16 LE values sit at FEE_BPS_OFF_A (852, applies
 *   when mint A is the input) and FEE_BPS_OFF_B (860, mint B in) — measured
 *   51 (0.51%) at both offsets on `8FnX3x`, in basis points. Read LIVE (same
 *   account, zero extra account locks), applied as a ppm haircut
 *   (`feeBps * 100`). Cross-checked against a real landed swap on this same
 *   pool (sig `4XJar73F...`, 2026-08-03): amountIn 500,000,005 lamports SOL,
 *   realized output 36,740,653 raw USDC => implied realized price
 *   73.481292 USDC/SOL, within ~0.02% of the pool's own stored PRICE_OFFSET
 *   read moments later (73.494367) — i.e. the realized rate already tracks
 *   the plaintext price field almost exactly, and applying the on-chain
 *   51bps byte as an ADDITIONAL haircut on top keeps this ladder's modeled
 *   quote conservatively BELOW the real fill (predicted <= realized), the
 *   same one-sided-safe posture every oracle-priced family in this tree
 *   uses. The exact semantics of the 179-value neighbour byte (offset 856)
 *   were not resolved and are not relied upon.
 *
 * ── Swap instruction (disc 0x07, 19 bytes) — reconfirmed against 6 REAL
 * landed swaps (both directions represented in the broader sample; the
 * decoded amountIn matched the vault's own SPL balance delta exactly on
 * every one) ──
 *   byte 0      : 0x07 (disc)
 *   bytes 1..9  : amountIn, u64 LE (patched at runtime)
 *   bytes 9..17 : minOut, u64 LE — every real sample carries 0 here; this
 *                 adapter writes 1 instead (the consuming app's own terminal
 *                 outAta-delta check is the real floor; every other ladder
 *                 in this tree uses the identical minOut=1 convention, and 1
 *                 is strictly MORE restrictive than the real venue's own 0,
 *                 never less)
 *   byte 17     : direction (0 = mint A in / mint B out, 1 = reverse)
 *   byte 18     : a flag byte — **CORRECTED against fresh on-chain evidence**:
 *                 all 6 real landed swaps sampled 2026-08-03 (both
 *                 directions) carry 0x04 here, never 0x00; this adapter
 *                 fixes it at 0x04 accordingly.
 *
 * ── Accounts (9, fixed order) ──
 *   0 owner (signer)         1 pool (writable)        2 vaultA (writable)
 *   3 vaultB (writable)      4 userAtaA (writable)    5 userAtaB (writable)
 *   6 TOKEN_PROGRAM          7 TOKEN_PROGRAM (twice — real-chain-confirmed)
 *   8 feeTag (readonly, NOT a signer)
 *
 * ── Account 8 is a caller-chosen read-only tag, NOT a required co-signer ──
 * The address a prior integration attempt (`docs/bisonfi-evidence.md`)
 * treated as a mandatory venue-wide signer (`8xeaWCsJ...`) is, on inspection,
 * a bare System-Program-owned account with zero data (`owner =
 * 11111111111111111111111111111111`, `size = 0`) sitting at ix index 8 in a
 * real landed swap — an index past `numRequiredSignatures`, i.e. NOT a
 * signer in that transaction, and a program cannot check anything about a
 * zero-byte account's contents. This adapter passes the CALLER's OWN owner
 * pubkey at that slot (read-only, not a signer) rather than the old
 * hardcoded address — there is no signer this program cannot control.
 *
 * ── Capacity ──
 * No true venue depth model was recovered (as with every other keeper/prop
 * AMM in this tree); this ladder saturates at `liveVaultOutBalance /
 * CAP_DIVISOR` (5% of the live output vault, the same conservative
 * flat-ceiling convention `zerofi`/`denali` use) rather than claiming an
 * unbounded linear quote.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig, VenueAccount } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "bisonfi";
export const BISONFI_PROGRAM_ID = address("BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi");
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export const POOL_ACCOUNT_SIZE = 2048;
export const OFF_VAULT_A = 120;
export const OFF_VAULT_B = 152;
export const OFF_MINT_A = 184;
export const OFF_MINT_B = 216;
/** u64 LE, Q24.40 (divide by 2^40), human quote(mintB)-per-whole-base(mintA) — see module doc. */
export const PRICE_OFFSET = 838;
/** u64 LE, unix NANOSECONDS — the keeper's own last-push timestamp (see module doc). */
export const TS_OFFSET = 88;
/** u16 LE, basis points — fee charged when mint A is the input side. */
export const FEE_BPS_OFF_A = 852;
/** u16 LE, basis points — fee charged when mint B is the input side. */
export const FEE_BPS_OFF_B = 860;
/** SPL token account `amount` field offset (standard layout). */
export const AMOUNT_OFF = 64;

export const PRICE_SCALE = 1n << 40n;

/**
 * Freshness bound, seconds — see module doc "Freshness gate": the live
 * population never exceeded 1s of age in a full 18-pool sweep; the stale
 * population's closest gap was ~1.6M seconds. 60s is comfortably inside that
 * gap while tolerating ordinary keeper-push/RPC jitter.
 */
export const STALE_SECONDS = 60n;

/** Conservative quotable-capacity divisor — see module doc "Capacity". */
export const CAP_DIVISOR = 20n;

/** disc(1) ++ amountIn u64 LE (patched) ++ minOut u64 LE(=1) ++ direction(1) ++ flag(1) = 19 bytes. */
export const SWAP_DISCRIMINATOR = 0x07;
/** Byte 18 — see module doc "Swap instruction": every real sample carries 0x04. */
export const TAIL_FLAG = 0x04;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

export interface BisonfiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA in / mintB out, 1 = mintB in / mintA out. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  /**
   * Decimals-adjustment rational baked at fetch time, direction-neutral
   * (see ladder.ts): out = mulDiv(x, livePrice*scaleNum, PRICE_SCALE*scaleDen)
   * for direction 0, and the exact reciprocal for direction 1.
   */
  scaleNum: bigint;
  scaleDen: bigint;
}

export function bisonfiConfig(cfg: PoolConfig): BisonfiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  return cfg as BisonfiPoolConfig;
}

/** SPL Mint `decimals` byte offset. */
const MINT_DECIMALS_OFFSET = 44;

async function fetchPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
  direction: 0 | 1 = 0,
): Promise<BisonfiPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);
  const [mintAAccount, mintBAccount] = await Promise.all([owned(mintA), owned(mintB)]);
  if (mintAAccount === null || mintBAccount === null) {
    throw new Error(`${SLUG} pool ${pool} mint account(s) not found`);
  }
  const mintAData = mintAAccount.data;
  const mintBData = mintBAccount.data;
  if (mintAData.length < MINT_DECIMALS_OFFSET + 1 || mintBData.length < MINT_DECIMALS_OFFSET + 1) {
    throw new Error(`${SLUG} pool ${pool} mint account(s) too short to be an SPL mint`);
  }
  // This venue's on-chain swap ix is legacy-SPL (Tokenkeg) only, so a
  // Token-2022 mint (or one carrying an un-routable extension) SELF-DROPS the
  // pool via a thrown error (the SvmRoute orchestrator catches it and drops the
  // venue). The mint's token program is its OWNER (an extensionless Token-2022
  // mint is byte-identical to a legacy one); a Tokenkeg-owned mint classifies
  // legacy → no throw → config built byte-identically to before.
  for (const [mint, account] of [
    [mintA, mintAAccount],
    [mintB, mintBAccount],
  ] as const) {
    const mintData = account.data;
    if (classifyMintProgram(mint, mintData, account.owner) === TOKEN_2022_PROGRAM_ID) {
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
  const decimalsA = mintAData[MINT_DECIMALS_OFFSET];
  const decimalsB = mintBData[MINT_DECIMALS_OFFSET];
  const d = decimalsB - decimalsA;
  const scaleNum = d >= 0 ? 10n ** BigInt(d) : 1n;
  const scaleDen = d >= 0 ? 1n : 10n ** BigInt(-d);
  return {
    venue: SLUG,
    pool,
    direction,
    vaultA: pubkeyAt(data, OFF_VAULT_A),
    vaultB: pubkeyAt(data, OFF_VAULT_B),
    mintA,
    mintB,
    scaleNum,
    scaleDen,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = bisonfiConfig(base);
  const vaultOut = cfg.direction === 0 ? cfg.vaultB : cfg.vaultA;
  return [
    { ref: cfg.pool, address: cfg.pool },
    { ref: vaultOut, address: vaultOut },
  ];
}

/** The BisonFi venue: a closed-source AMM priced by a keeper-pushed oracle. */
export const bisonfi = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: BISONFI_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};
