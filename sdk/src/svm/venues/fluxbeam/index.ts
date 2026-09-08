/**
 * FluxBeam (program `FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X`) — a
 * permissionless constant-product AMM factory, Token-2022-capable on both
 * legs. Byte layout is IDENTICAL to spl-token-swap's `SwapV1` (the same
 * 324-byte, no-discriminator `SwapVersion::pack` shape `orca-legacy-token-swap`
 * already decodes — `version(1)+is_initialized(1)+bump_seed(1)+token_program(32)
 * +token_a(32)+token_b(32)+pool_mint(32)+token_a_mint(32)+token_b_mint(32)
 * +pool_fee_account(32)+Fees(8×u64=64)+SwapCurve(curve_type u8 + 32-byte
 * calculator)`), CONFIRMED byte-for-byte against two real mainnet pools:
 *   - `CZEZDGDkzsn4zTfdw6XRm4U1o6GatotMhhRmVEzdwGS3` (SOL/USDC, curve_type 0,
 *     trade_fee 20/1000, owner_trade_fee 5/1000, classic Tokenkeg legs) —
 *     this repo's off-chain quote matched Jupiter's own `dexes=FluxBeam`
 *     single-venue quote BIT-EXACT at 0.1/1/5 SOL.
 *   - `M6N5wxWzSjwpPzH1F7YMNfGxHDfuM88Ey7KAruAxn5N` (a Token-2022
 *     TransferFeeConfig mint `BHHyGwamPG2sihrP4qTs6c5T88DB65oqoBpTQc8kdPS7` /
 *     SOL, bps=200 i.e. 2%, maximumFee effectively unreachable) — the wire
 *     transfer-fee model below (see `qFluxBeam`) is what makes this repo's
 *     quote match the real program's realized output on that pool; without
 *     it the quote overshoots by exactly the 2% wire fee the vault never
 *     actually receives. Jupiter itself refuses to quote this specific mint
 *     (`TOKEN_NOT_TRADABLE`, a risk-list policy, not a math question), so the
 *     cross-check for THIS pool is the real-CPI LiteSVM lane
 *     (test/svm/venues/fluxbeam.test.ts + the realcpi e2e cell), not Jupiter.
 *
 * REAL-CPI PROOF (the consuming app realcpi e2e test's `fluxbeam` cells, SAUCE_VENUE_PROGRAMS-
 * gated): the actual mainnet `fluxbeam.so` binary, executed via LiteSVM on the two real pools above
 * through the full production `svmRoute` compile path, realizes OUTPUT bit-exact to this ladder's
 * predicted quote on BOTH pools (71_656_795 at 1 SOL classic; 197 at ~1.95e9 raw wire-fee-mint
 * input) — the load-bearing invariant `minOut` enforces. DISCLOSED, MEASURED, and NOT a quoting
 * error: the real binary's own internal transfer sizing pulls a few raw units LESS than the
 * instructed `amount_in` from the user's account on BOTH pools (6 units on the classic pool with no
 * fee involved at all; ~0.49% on the wire-fee pool) — the un-pulled remainder simply stays in the
 * user's own account (never lost, never double-counted), and OUTPUT is unaffected either way; see
 * that test file's `expectedDebit` param and its cell-level comments for the exact pinned numbers.
 *
 * The Clock sysvar (`SysvarC1ock11111111111111111111111111111111`, epoch @ offset 16) is read
 * OFF-CHAIN, lazily, only when a leg mint carries a TransferFeeConfig extension — never checked in
 * as a fixture file: a real dump of this widely-shared sysvar address, loaded into a harness that
 * pins its OWN clock (every jest engine harness in this repo does, via `startEngine`), silently
 * overwrote that pin and broke an UNRELATED family's time-dependent measurement (meteora-dlmm's
 * dynamic fee) the one time this was tried — see the git history of
 * the consuming app cu e2e test and test/svm/venues/fluxbeam.test.ts for the concrete lesson:
 * synthesize sysvar/canonical-mint bytes in-memory in tests instead of dumping them to disk.
 *
 * The stored `token_program` field (offset 3) is NOT a per-leg signal — on
 * BOTH sampled pools it reads the Token-2022 program even though the SOL/USDC
 * pool's actual leg mints are classic Tokenkeg. FluxBeam always mints its LP
 * token (`pool_mint`) under Token-2022 regardless of what the trade legs use,
 * and that field is for the pool_mint/pool_fee_account CPIs only (accounts 7/8
 * below) — the real per-leg token programs (accounts 11/12) were recovered by
 * decoding a live inner CPI instruction (see the swap-account-order note on
 * `buildSwapV2`), not from any pool-stored field.
 *
 * DIRECTION: AtoB ONLY (mintA in, mintB out) — the SAME scope limitation this
 * repo already accepts for `orca-legacy-token-swap`. Every real swap sampled
 * on `CZEZDGDkzsn4zTfdw6XRm4U1o6GatotMhhRmVEzdwGS3` traded SOL(A)->USDC(B); no
 * live B->A instance was found to confirm whether the trailing mint/
 * token-program accounts (9-13) reorder for the reverse direction (unlike
 * accounts 4/5, whose swap does flip which vault is `swap_source` per
 * spl-token-swap convention) — FluxBeam's own program is closed-source, so
 * guessing that order for a real swap CPI risks a wrong-program transfer
 * rather than a clean revert. Both mint orderings are still discovered
 * (`SVM_FAMILY_FILTERS` queries both), so a pool is simply dropped when the
 * requested pair is the reverse of its stored A/B order — exactly like
 * orca-legacy-token-swap today.
 *
 * TOKEN-2022 MINT DETECTION: `AccountLoader` returns only account BYTES (no
 * owner), and unlike raydium-cp-swap's `PoolState` (which stores each leg's
 * owning program explicitly, added specifically for Token-2022 support),
 * FluxBeam's pool account carries no per-leg program field at all. The
 * classic Tokenkeg program's `Mint::unpack` requires EXACTLY 82 bytes — it
 * cannot create or read an account of any other length — so any mint account
 * longer than 82 bytes MUST be owned by Token-2022 (that program is the only
 * one supporting the longer, extension-carrying layout); `scanMint` uses this
 * as a SOUND (not merely heuristic) direction. The one residual gap runs the
 * other way: a Token-2022 mint deployed with ZERO extensions is also exactly
 * 82 bytes and is indistinguishable from a classic mint by data alone, so it
 * would be mis-tagged Tokenkeg here. This is a disclosed, narrow residual —
 * no extension means no different transfer behavior either way except the
 * CPI's target program id, and a bare-extensionless Token-2022 mint actively
 * trading on a permissionless AMM is vanishingly unlikely (the entire reason
 * to mint under Token-2022 over classic is to use an extension) — a
 * misclassification there fails the swap CPI loudly (wrong owning program),
 * never silently mis-quotes.
 *
 * TRANSFER-FEE TIER SELECTION: a Token-2022 `TransferFeeConfig` extension
 * carries an `older`/`newer` double-buffered fee (the newer only takes effect
 * once the cluster's epoch reaches `newer.epoch`, so an authority's fee change
 * cannot apply retroactively mid-epoch). `fetchPoolConfig` resolves the
 * ACTIVE tier at fetch time by reading the live Clock sysvar
 * (`SysvarC1ock11111111111111111111111111111111`, epoch @ offset 16) — fetched
 * lazily, only when a leg mint actually carries the extension — and bakes the
 * resolved bps/maximumFee as compile-time params, the SAME treatment this
 * repo already gives `orca-legacy-token-swap`'s (also nominally admin-settable
 * but never re-read live) trade/owner fee numerators. A fee bumped between
 * fetch and cook is the same class of drift every venue's quote already has
 * relative to live execution, backstopped by `minOut` — not a new gap.
 *
 * A TransferHook (ExtensionType 14) or NonTransferable (ExtensionType 9)
 * extension on either leg self-drops the WHOLE pool (`fetchPoolConfig`
 * throws): a hook can run arbitrary logic requiring extra accounts this
 * adapter does not attach, and a non-transferable mint cannot be swapped at
 * all — both are the venue-robustness "one bad pool never kills a cook"
 * self-drop class already used throughout this recipe.
 */
import { createHash } from "node:crypto";
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";

const SLUG = "fluxbeam";
export const FLUXBEAM_PROGRAM_ID = address("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X");
const TOKENKEG_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");

/** `SwapVersion::pack` = 1-byte version tag + the 323-byte `SwapV1` body. */
export const FLUXBEAM_POOL_SIZE = 324;

// SwapV1 offsets (identical to orca-legacy-token-swap's — same upstream spl-token-swap layout).
const OFF_VERSION = 0;
const OFF_IS_INITIALIZED = 1;
const OFF_BUMP_SEED = 2;
const OFF_TOKEN_PROGRAM_POOL = 3;
const OFF_VAULT_A = 35;
const OFF_VAULT_B = 67;
const OFF_POOL_MINT = 99;
const OFF_MINT_A = 131;
const OFF_MINT_B = 163;
const OFF_POOL_FEE_ACCOUNT = 195;
const OFF_TRADE_FEE_NUMERATOR = 227;
const OFF_TRADE_FEE_DENOMINATOR = 235;
const OFF_OWNER_TRADE_FEE_NUMERATOR = 243;
const OFF_OWNER_TRADE_FEE_DENOMINATOR = 251;
const OFF_CURVE_TYPE = 291;
/** ExtensionType ordinals this adapter cares about (spl-token-2022's `extension::ExtensionType`). */
const EXT_TRANSFER_FEE_CONFIG = 1;
const EXT_NON_TRANSFERABLE = 9;
const EXT_TRANSFER_HOOK = 14;
/** Base SPL account size Token-2022 pads to before the account-type + TLV tail. */
const TOKEN_2022_BASE_LEN = 165;

export interface FluxBeamFeeTier {
  epoch: bigint;
  max: bigint;
  bps: bigint;
}
interface MintTiers {
  older: FluxBeamFeeTier;
  newer: FluxBeamFeeTier;
}
interface MintInfo {
  tokenProgram: Address;
  tiers: MintTiers | null;
}

export interface FluxBeamPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  swapAuthority: Address;
  tokenProgramPool: Address;
  vaultA: Address;
  vaultB: Address;
  poolMint: Address;
  mintA: Address;
  mintB: Address;
  poolFeeAccount: Address;
  tokenProgramA: Address;
  tokenProgramB: Address;
  tradeFeeNumerator: bigint;
  tradeFeeDenominator: bigint;
  ownerTradeFeeNumerator: bigint;
  ownerTradeFeeDenominator: bigint;
  /** Wire (Token-2022) transfer fee on the mintA leg — {0n,0n} when classic or fee-less. */
  feeA: { bps: bigint; max: bigint };
  /** Wire (Token-2022) transfer fee on the mintB leg — {0n,0n} when classic or fee-less. */
  feeB: { bps: bigint; max: bigint };
}

function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

/**
 * `create_program_address([pool, bump_seed], program_id)` — the same
 * off-curve PDA scheme spl-token-swap forks use for the swap authority,
 * verified against the REAL authority of both sampled mainnet pools
 * (`Fv9Yjbk4BXV4nwdP3xKaRT3xiSUKTojsKgqSgwvjujLK` for
 * `CZEZDGDkzsn4zTfdw6XRm4U1o6GatotMhhRmVEzdwGS3`, bump 255).
 */
function deriveSwapAuthority(pool: Address, bumpSeed: number): Address {
  const codec = getAddressCodec();
  return codec.decode(
    createHash("sha256")
      .update(getAddressEncoded(pool))
      .update(Uint8Array.of(bumpSeed))
      .update(getAddressEncoded(FLUXBEAM_PROGRAM_ID))
      .update("ProgramDerivedAddress")
      .digest(),
  ) as Address;
}

/**
 * Decodes one leg's mint: the owning token program (SOUND for >82 bytes — see
 * the file header) plus its TransferFeeConfig tiers, if any. Throws on a
 * TransferHook/NonTransferable extension (unsupported — self-drops the pool).
 */
function scanMint(mint: Address, data: Uint8Array): MintInfo {
  if (data.length < 82) {
    throw new Error(`fluxbeam: mint ${mint} is ${data.length} bytes, too short to be an SPL mint`);
  }
  if (data.length === 82) return { tokenProgram: TOKENKEG_PROGRAM, tiers: null };
  // > 82 bytes is possible ONLY under Token-2022 (Tokenkeg's Mint::unpack requires exactly 82).
  if (data.length <= TOKEN_2022_BASE_LEN || data[TOKEN_2022_BASE_LEN] !== 1) {
    // Extended allocation with no parseable extension tail (or an account-type byte other than
    // Mint=1, which should not happen for a real mint) — no fee we can see either way.
    return { tokenProgram: TOKEN_2022_PROGRAM, tiers: null };
  }
  let offset = TOKEN_2022_BASE_LEN + 1;
  let tiers: MintTiers | null = null;
  while (offset + 4 <= data.length) {
    const type = Number(readUintLE(data, offset, 2));
    if (type === 0) break; // Uninitialized — trailing padding
    const length = Number(readUintLE(data, offset + 2, 2));
    const value = offset + 4;
    if (type === EXT_TRANSFER_HOOK) {
      throw new Error(
        `fluxbeam: mint ${mint} carries a TransferHook extension (unsupported — cannot safely CPI without the hook's extra accounts)`,
      );
    }
    if (type === EXT_NON_TRANSFERABLE) {
      throw new Error(`fluxbeam: mint ${mint} is NonTransferable (cannot be swapped)`);
    }
    if (type === EXT_TRANSFER_FEE_CONFIG) {
      // TransferFeeConfig (108 bytes): authority(32)+withdrawAuthority(32)+withheldAmount(8)+
      // older{epoch(8),maximumFee(8),bps(2)}+newer{epoch(8),maximumFee(8),bps(2)}.
      tiers = {
        older: {
          epoch: readUintLE(data, value + 72, 8),
          max: readUintLE(data, value + 80, 8),
          bps: readUintLE(data, value + 88, 2),
        },
        newer: {
          epoch: readUintLE(data, value + 90, 8),
          max: readUintLE(data, value + 98, 8),
          bps: readUintLE(data, value + 106, 2),
        },
      };
    }
    offset += 4 + length;
  }
  return { tokenProgram: TOKEN_2022_PROGRAM, tiers };
}

const activeTier = (tiers: MintTiers, epoch: bigint): FluxBeamFeeTier =>
  epoch >= tiers.newer.epoch ? tiers.newer : tiers.older;

export async function fetchFluxBeamPoolConfig(
  load: AccountLoader,
  pool: Address,
): Promise<FluxBeamPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool ${pool} account not found`);
  if (data.length !== FLUXBEAM_POOL_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} data must be ${FLUXBEAM_POOL_SIZE} bytes (SwapVersion::SwapV1), got ${data.length}`,
    );
  }
  if (data[OFF_VERSION] !== 1)
    throw new Error(`${SLUG}: pool ${pool} version must be 1 (SwapV1), got ${data[OFF_VERSION]}`);
  if (data[OFF_IS_INITIALIZED] !== 1) throw new Error(`${SLUG}: pool ${pool} is not initialized`);
  if (data[OFF_CURVE_TYPE] !== 0) {
    throw new Error(
      `${SLUG}: pool ${pool} curve_type must be 0 (constant product), got ${data[OFF_CURVE_TYPE]}`,
    );
  }

  const codec = getAddressCodec();
  const pubkey = (offset: number): Address =>
    codec.decode(data.subarray(offset, offset + 32)) as Address;
  const u64 = (offset: number): bigint => readUintLE(data, offset, 8);

  const bumpSeed = data[OFF_BUMP_SEED]!;
  const mintA = pubkey(OFF_MINT_A);
  const mintB = pubkey(OFF_MINT_B);
  const tradeFeeNumerator = u64(OFF_TRADE_FEE_NUMERATOR);
  const tradeFeeDenominator = u64(OFF_TRADE_FEE_DENOMINATOR);
  const ownerTradeFeeNumerator = u64(OFF_OWNER_TRADE_FEE_NUMERATOR);
  const ownerTradeFeeDenominator = u64(OFF_OWNER_TRADE_FEE_DENOMINATOR);
  for (const [name, numerator, denominator] of [
    ["trade", tradeFeeNumerator, tradeFeeDenominator],
    ["owner trade", ownerTradeFeeNumerator, ownerTradeFeeDenominator],
  ] as const) {
    if (numerator !== 0n && denominator === 0n) {
      throw new Error(
        `${SLUG}: pool ${pool} ${name} fee denominator is 0 with nonzero numerator ${numerator}`,
      );
    }
  }

  const [mintAData, mintBData] = await Promise.all([load(mintA), load(mintB)]);
  if (mintAData === null) throw new Error(`${SLUG}: mint ${mintA} of pool ${pool} not found`);
  if (mintBData === null) throw new Error(`${SLUG}: mint ${mintB} of pool ${pool} not found`);
  const infoA = scanMint(mintA, mintAData);
  const infoB = scanMint(mintB, mintBData);

  let epoch = 0n;
  if (infoA.tiers !== null || infoB.tiers !== null) {
    const clockData = await load(CLOCK_SYSVAR);
    if (clockData === null)
      throw new Error(
        `${SLUG}: could not read the Clock sysvar to resolve pool ${pool}'s active transfer-fee tier`,
      );
    epoch = readUintLE(clockData, 16, 8);
  }
  const feeA = infoA.tiers === null ? { bps: 0n, max: 0n } : activeTier(infoA.tiers, epoch);
  const feeB = infoB.tiers === null ? { bps: 0n, max: 0n } : activeTier(infoB.tiers, epoch);

  return {
    venue: SLUG,
    pool,
    swapAuthority: deriveSwapAuthority(pool, bumpSeed),
    tokenProgramPool: pubkey(OFF_TOKEN_PROGRAM_POOL),
    vaultA: pubkey(OFF_VAULT_A),
    vaultB: pubkey(OFF_VAULT_B),
    poolMint: pubkey(OFF_POOL_MINT),
    mintA,
    mintB,
    poolFeeAccount: pubkey(OFF_POOL_FEE_ACCOUNT),
    tokenProgramA: infoA.tokenProgram,
    tokenProgramB: infoB.tokenProgram,
    tradeFeeNumerator,
    tradeFeeDenominator,
    ownerTradeFeeNumerator,
    ownerTradeFeeDenominator,
    feeA: { bps: feeA.bps, max: feeA.max },
    feeB: { bps: feeB.bps, max: feeB.max },
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like orca-legacy-token-swap). */
export const fluxbeam = {
  slug: SLUG,
  programId: FLUXBEAM_PROGRAM_ID,
  fetchPoolConfig: fetchFluxBeamPoolConfig,
};
