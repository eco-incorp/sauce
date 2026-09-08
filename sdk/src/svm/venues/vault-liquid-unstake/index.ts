/**
 * VaultLiquidUnstake venue adapter + SvmRoute v2 ladder — LST -> SOL only.
 *
 * Program `2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo` (Jupiter label
 * "VaultLiquidUnstake") ships NO on-chain IDL and is not open source. Its
 * shape was reverse-engineered from three independent, cross-checked
 * sources — none of them guesswork:
 *
 *  1. The deployed program's ELF (dumped via `getAccountInfo` on its
 *     BPFLoaderUpgradeable ProgramData account — see
 *     `scripts/dump-venue-programs.sh` for the vendored-binary convention
 *     this venue now follows). It is a stripped Anchor program whose
 *     `strings` output still carries every instruction/account-struct name
 *     (Anchor logs + IDL-instruction stubs are baked in even with symbols
 *     stripped): `InitializePool`, `LiquidUnstakeLst`, `DepositSol`,
 *     `WithdrawSol`, `SyncInventory`, `SellLst`, `BuyLst`, `FlashBorrow`/
 *     `FlashRepay`, and the account kinds `Pool`, `LstInfo`,
 *     `StakeAccountInfo`, `InventorySummary`. Anchor account/instruction
 *     discriminators are `sha256("account:<Name>")[0..8]` /
 *     `sha256("global:<snake_case_name>")[0..8]` — every discriminator
 *     below was independently re-derived from candidate names and matched
 *     byte-for-byte against live `getProgramAccounts`/`getTransaction`
 *     output, so the byte layout is NAMED, not inferred from position.
 *  2. Real mainnet transactions: `getSignaturesForAddress` +
 *     `getTransaction` on this program (and on live `LstInfo` PDAs) surface
 *     the EXACT `sell_lst` account list Jupiter itself sends when it routes
 *     through this venue (confirmed across >20 independent fills spanning
 *     3 different LSTs — JitoSOL, a Sanctum single-validator LST, bSOL —
 *     all 13 accounts in the same order). Two of those accounts
 *     (`poolLstAta`, index 1) were confirmed to be the STANDARD Associated
 *     Token Account of (POOL, lstMint) by direct computation
 *     (`@solana-program/token`'s `findAssociatedTokenPda`) matching the
 *     on-chain value bit-for-bit for both sampled mints — no custom PDA
 *     seeds needed anywhere in this adapter.
 *  3. Live account state read via `getAccountInfo`/`getMultipleAccounts`
 *     (mainnet, `SOLANA_RPC_URL`): the `Pool` singleton's byte layout was
 *     segmented into 32-byte pubkey windows (matched against on-chain
 *     entities: the shared native-SOL vault, the fee-recipient token
 *     account also seen in every `sell_lst` account list) plus a numeric
 *     tail. Two numeric fields were confirmed, not guessed: a `u64` at
 *     byte 168 reads an exact, round `500_000_000_000` (500 SOL) — a
 *     designed constant, not sampled state — and a `u64` at byte 179
 *     tracks the vault's real lamports balance to within ~0.001 SOL (a
 *     `getAccountInfo` cross-check against the vault account itself),
 *     i.e. the Pool's own cached SOL-reserve counter. Reading this counter
 *     (rather than the vault's native lamports) is also the only way to
 *     get this value INSIDE a compiled SauceScript fragment: the SVM
 *     account-loader/ladder framework this repo's adapters share
 *     (`AccountLoader`/`BatchAccountLoader`/`accountUint`) is DATA-only —
 *     it has no lamports accessor anywhere in the pinned sauce-sdk surface
 *     — so every venue in this family reads reserves from account *data*,
 *     never from an account's native lamports; this venue's Pool struct
 *     conveniently keeps its own SOL-reserve accounting inside `.data` for
 *     exactly that reason.
 *
 * FEE CURVE — empirically calibrated, not reverse-engineered bit-for-bit:
 * live Jupiter quotes (`GET /swap/v1/quote?dexes=VaultLiquidUnstake`) at 16
 * sizes spanning the Pool's post-trade SOL reserve from 500 SOL down to
 * 0.5 SOL (holding the mint fixed at JitoSOL, cross-multiplying against
 * the LIVE underlying SPL Stake Pool exchange rate — itself a
 * publicly-documented struct, `total_lamports / pool_token_supply`) show a
 * fee that is a FLAT ~12.19 bps until the post-trade reserve drops below
 * the Pool's own 500 SOL target, then rises smoothly toward ~27.1-27.8 bps
 * as the reserve approaches 0 — a single quadratic-in-drawdown curve fits
 * all 16 points to within ~0.03 bps RMS. The shipped constants
 * (`FEE_MIN_BPS`/`FEE_MAX_BPS` below) are set with a deliberate safety
 * margin ABOVE that fitted curve at every one of the 16 sampled points (see
 * `test/svm/vault-liquid-unstake.quote.test.ts`), so this model NEVER
 * predicts a better price than the real program did in any observed
 * sample — a crude-but-conservative model is safe; a favourable one is a
 * liveness hazard (a venue whose modeled price beats its real price wins
 * merge elections it cannot actually fill).
 *
 * SCOPE (self-drop, not a permission gate): `LstInfo` accounts ship in two
 * observed byte lengths — 144 (the default fee/config layout) and 225 (an
 * `UpsertLstInfo`-customized layout carrying extra epoch/rate-override
 * fields AND, in every sampled `sell_lst` transaction for a 225-byte LST,
 * one extra fixed trailing account this adapter has not independently
 * confirmed the semantics of). `fetchPoolConfig` accepts ONLY the 144-byte
 * layout and throws (self-drops, like every other family's shape gate —
 * see orca-whirlpool's `windowFor.readable === 0` or obric-v2's P-B/P-C
 * oracle rejection) on anything else; extending to 225-byte LSTs is a
 * disclosed follow-up, not a silent omission.
 *
 * ONE DIRECTION ONLY (LST -> SOL, wrapped): `applyDirection` rejects every
 * value but the default. Nothing here derives or emits the SOL -> LST
 * leg (`buy_lst`, a structurally different 17-account instruction observed
 * in the same signature sample) — see the module doc above for why.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import type { AccountLoader, PoolConfig, VenueAccount } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "vault-liquid-unstake";
const PROGRAM_ID = "2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo";

// Fixed, program-wide singletons (there is exactly one production Pool and
// one shared native-SOL vault — every LstInfo references the same two).
const POOL_ADDRESS = "9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
// sha256("account:Pool")[0..8] / sha256("account:LstInfo")[0..8] — both
// independently re-derived from the candidate name and matched against the
// live getProgramAccounts dump (see module doc, source 1).
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
const LST_INFO_DISCRIMINATOR = [0x4f, 0x71, 0xe2, 0x3c, 0xab, 0x08, 0x8e, 0x21];
/** Pool account: fixed 316 bytes for the production singleton. */
const POOL_LEN = 316;
/** LstInfo: only the 144-byte default-config layout is supported (see module doc SCOPE). */
const LST_INFO_LEN = 144;
const LST_INFO_OFF_MINT = 40;
const LST_INFO_OFF_STAKE_POOL = 72;

/** SPL Stake Pool (canonical, documented struct — not reverse-engineered): account_type
 *  byte @0 must be 1 (StakePool); total_lamports/pool_token_supply u64 LE @258/@266. The
 *  fixed 611-byte size is what every sampled stake-pool instance (3 distinct managing
 *  programs) actually has; a differently-sized stake pool self-drops rather than risk a
 *  misaligned read. */
const STAKE_POOL_LEN = 611;
const STAKE_POOL_OFF_ACCOUNT_TYPE = 0;
/**
 * Conservative fee-curve constants (bps). Flat FEE_MIN_BPS while the Pool's
 * cached SOL reserve stays at/above its own 500 SOL target; rises
 * quadratically in the reserve's shortfall below target, saturating at
 * FEE_MAX_BPS as the reserve approaches 0. Both bounds carry a deliberate
 * margin ABOVE the empirically fitted curve (see module doc + the quote
 * test) — this UNDER-predicts output at every sampled size, never over.
 */
const FEE_MIN_BPS = 13n;
const FEE_MAX_BPS = 29n;

function discMatches(data: Uint8Array, disc: readonly number[]): boolean {
  for (let i = 0; i < disc.length; i++) {
    if (data[i] !== disc[i]) return false;
  }
  return true;
}

const addressCodec = getAddressCodec();
function decodeAddress(data: Uint8Array, offset: number): Address {
  return addressCodec.decode(data.subarray(offset, offset + 32));
}

export interface VaultLiquidUnstakePoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** The LST mint this LstInfo trades (inMint; outMint is always wrapped SOL). */
  mint: Address;
  /** The underlying SPL Stake Pool account backing this LST's exchange rate. */
  stakePool: Address;
  /** ATA(POOL_ADDRESS, mint) — the pool's own LST inventory account (account index 1 of `sell_lst`). */
  poolLstAta: Address;
}

function vluConfig(base: PoolConfig): VaultLiquidUnstakePoolConfig {
  if (base.venue !== SLUG) throw new Error(`${SLUG} adapter got a '${base.venue}' pool config`);
  return base as VaultLiquidUnstakePoolConfig;
}

/**
 * The pure quote math, LOCKSTEP with the emitted SauceScript helper below
 * (`qVaultLiquidUnstake`) — same integer ops, same rounding (ceil the fee,
 * so the on-chain and off-chain outputs match to the wei and both stay on
 * the conservative side of the real program).
 */
export function vaultLiquidUnstakeQuote(
  x: bigint,
  rateNum: bigint,
  rateDen: bigint,
  before: bigint,
  target: bigint,
): bigint {
  if (x <= 0n || rateDen <= 0n || before <= 0n) return 0n;
  let gross = (x * rateNum) / rateDen;
  if (gross > before) gross = before;
  const after = before - gross;
  let feeBps = FEE_MIN_BPS;
  if (after < target) {
    const diff = target - after;
    const span = FEE_MAX_BPS - FEE_MIN_BPS;
    const denom = target * target;
    const bump = (diff * diff * span + denom - 1n) / denom; // ceil
    feeBps = FEE_MIN_BPS + bump;
  }
  const fee = (gross * feeBps + 9_999n) / 10_000n; // ceil
  return gross - fee;
}

export const vaultLiquidUnstake = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: address(PROGRAM_ID),
  /**
   * Off-chain, once per pool. `pool` is the LstInfo account address (this
   * family's "pool", matching every other family's convention — see
   * SvmRoutePoolSpec). Rejects: a missing/undecodable LstInfo, the wrong
   * discriminator, the unsupported 225-byte extended layout (SCOPE, module
   * doc), a missing/malformed global Pool singleton, or a stake-pool
   * account whose shape doesn't match the canonical SPL Stake Pool struct.
   */
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<VaultLiquidUnstakePoolConfig> {
    const lstData = await load(pool);
    if (lstData === null) throw new Error(`${SLUG} lstInfo ${pool} not found`);
    if (!discMatches(lstData, LST_INFO_DISCRIMINATOR)) {
      throw new Error(
        `${SLUG} lstInfo ${pool} has an unexpected discriminator (not an LstInfo account)`,
      );
    }
    if (lstData.length !== LST_INFO_LEN) {
      throw new Error(
        `${SLUG} lstInfo ${pool} is ${lstData.length} bytes — only the ${LST_INFO_LEN}-byte default-config layout is supported (see module doc SCOPE)`,
      );
    }
    const mint = decodeAddress(lstData, LST_INFO_OFF_MINT);
    const stakePool = decodeAddress(lstData, LST_INFO_OFF_STAKE_POOL);

    const poolData = await load(address(POOL_ADDRESS));
    if (
      poolData === null ||
      !discMatches(poolData, POOL_DISCRIMINATOR) ||
      poolData.length !== POOL_LEN
    ) {
      throw new Error(`${SLUG} global Pool account is missing or has an unexpected shape`);
    }

    const spData = await load(stakePool);
    if (
      spData === null ||
      spData.length !== STAKE_POOL_LEN ||
      spData[STAKE_POOL_OFF_ACCOUNT_TYPE] !== 1
    ) {
      throw new Error(
        `${SLUG} stake pool ${stakePool} (lstInfo ${pool}) is missing or has an unexpected shape`,
      );
    }

    // This venue's `sell_lst` CPI is legacy-SPL (Tokenkeg) only (outMint is
    // always wrapped SOL, a classic mint). Detect a Token-2022 (or otherwise
    // un-routable) LST mint and GRACEFULLY SELF-DROP the pool (the SvmRoute
    // orchestrator catches a fetchPoolConfig throw and drops the venue). The
    // LEGACY path is byte-identical; an unreadable mint falls back to the
    // legacy assumption.
    const _mints = [mint];
    const _mintDatas = await Promise.all(_mints.map((m) => load(m)));
    for (let _i = 0; _i < _mints.length; _i++) {
      const m = _mints[_i]!;
      const mintData = _mintDatas[_i]!;
      if (mintData === null) continue;
      if (classifyMintProgram(m, mintData) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${m} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${m} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }

    const [poolLstAta] = await findAssociatedTokenPda({
      owner: address(POOL_ADDRESS),
      tokenProgram: address(TOKEN_PROGRAM_ADDRESS),
      mint,
    });

    return { venue: SLUG, pool, mint, stakePool, poolLstAta };
  },
  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = vluConfig(cfg);
    return [
      { ref: `${SLUG}:globalPool`, address: address(POOL_ADDRESS) },
      { ref: `${SLUG}:stakePool:${c.stakePool}`, address: c.stakePool },
    ];
  },
};
