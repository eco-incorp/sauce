/**
 * Helium Network Treasury (SvmRoute venue) — the on-chain `TreasuryManagementV0`
 * program (`treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5`, Jupiter's own label
 * "Helium Network" — `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`
 * in the recipes repo), a REAL Anchor program with a PUBLISHED IDL/source
 * (`github.com/helium/helium-program-library/tree/master/programs/treasury-management`,
 * `programs/circuit-breaker` for the companion breaker) — no binary reverse-engineering
 * needed for this one, unlike most of the venues alongside it.
 *
 * ── What this venue actually is ──
 * A ONE-WAY treasury redemption: burn a Helium subDAO's sub-token (IOT or MOBILE — the
 * only two `TreasuryManagementV0` accounts that exist on mainnet today, confirmed via a
 * live `getProgramAccounts` sweep of the program filtered on the account discriminator,
 * 2026-07-31) to receive a proportional share of the subDAO's HNT treasury, on a
 * deterministic bonding curve. There is NO reverse instruction on this program (minting
 * a subDAO token is a completely different program/flow) — `applyDirection` (recipe
 * side, `the consuming app SVM solver entry`'s `FAMILIES['helium-treasury']`) rejects anything but the
 * one real direction.
 *
 * ── The curve (`programs/treasury-management/src/curve.rs`) ──
 * `TreasuryManagementV0.curve` is `Curve::ExponentialCurveV0 { k: u128 }` (the type's
 * only variant — Borsh tags it 0 regardless), and `redeem_v0`'s handler computes (sell
 * branch, `programs/treasury-management/src/instructions/redeem_v0.rs`):
 *
 *   redeemed = R * (1 − ((S − dS) / S)^(1+k))
 *
 * where R = the treasury's live HNT balance, S = the sub-token's live total supply, dS =
 * the amount burned. BOTH real mainnet treasuries read `k = 0` (confirmed by decoding the
 * live account bytes below), collapsing the curve to EXACT linear-proportional
 * redemption: `redeemed = R * dS / S`. This is implemented EXACTLY (no haircut, no
 * approximation) via `Math.mulDiv` — unlike most of this venue's siblings, which model an
 * unrecovered/obfuscated real curve conservatively, this one has a published formula we
 * can replicate bit-for-bit. VALIDATED against the REAL deployed program via
 * `simulateTransaction` (`sigVerify:false`) on REAL mainnet state, at 3 sizes on EACH of
 * the two live pools (1 / 1,000 / 100,000 IOT and 2 / 5,000 / 500,000 MOBILE, spanning
 * ~5-6 orders of magnitude) — all 6 real deltas matched the `R*dS/S` prediction EXACTLY
 * (see the recipes repo's `test/svm/fixtures/helium-treasury/*.json` for the captured
 * account bytes these probes were run against). A NONZERO `k` (a curve shape with zero
 * live examples on mainnet as of this writing) is REJECTED at fetch time with a named
 * error rather than guessed at — see `fetchPoolConfig` below.
 *
 * ── The windowed circuit breaker (`programs/circuit-breaker/src/{state,window}.rs`) ──
 * Every real `redeemed` transfer out of the treasury is gated by an
 * `AccountWindowedCircuitBreakerV0` PDA (seeds `["account_windowed_breaker", treasury]`,
 * program `circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g`): `enforce_window` computes
 * `threshold = get_threshold(config, treasury.amount)` (Percent: `treasury.amount *
 * config.threshold / u64::MAX`; Absolute: `config.threshold` flat) and reverts
 * `CircuitBreakerTriggered` if `amount + decayed_prev(last_window) > threshold`. This
 * ladder's CPI IS that real transfer, so a quote that ignores the breaker would predict
 * (and could try to admit) an amount the real CPI simply refuses — so the breaker state
 * is read live and used as the ladder cap plus the depth self-drop.
 *
 * This fragment (like every other family here, and like `manifest`/`meteora-damm-v2`'s
 * own documented "the in-VM model carries no clock") does NOT decay the window on-chain
 * — `time_decay_previous_value` only ever REDUCES `last_aggregated_value` as real time
 * elapses, so treating the RAW, undecayed `last_aggregated_value` as the current usage is
 * a purely CONSERVATIVE (never-favourable) approximation of the real, decayed value at
 * any later instant: `available := max(0, threshold(R) − lastAggRaw)` UNDER-estimates the
 * real available capacity, so a quote/cook built on it can never request more than the
 * real breaker would allow, regardless of how much real time passes between prepare and
 * cook, or of any other caller's redemption changing `R`/`lastAgg` in the meantime (both
 * are read LIVE via `accountUint` at cook time, not baked from a prepare-time snapshot —
 * only `thresholdType`/`threshold` themselves are baked params, since they are admin
 * config that changes about as often as any other venue's baked fee rate, and
 * `windowSizeSeconds` is not needed at all under the zero-decay convention). The cap
 * SELF-DROPS this venue via the ordinary relative-depth path (`depthReserves` reports a
 * cap-bounded `reserveOut`) rather than a hard prepare-time throw — the SAME shape every
 * other capacity-clamped ladder in this file already uses, so a near-exhausted window
 * just naturally attracts a shrinking share instead of poisoning the whole compile.
 * (Both real mainnet windows measured comfortably open — ~49.12T/39.9B and larger for
 * MOBILE — so a live trip could not be demonstrated against real funds in this pass
 * without control of a multi-billion-token wallet; the enforcement formula itself is
 * transcribed directly from the published Rust source, not guessed.)
 *
 * ── Freeze gate ──
 * `TreasuryManagementV0.freezeUnixTime` permanently disables `redeem_v0` once reached
 * (`redeem_v0.rs`: `if freeze_unix_time <= now { revert Frozen }`). Both real treasuries
 * read `i64::MAX` (never frozen) as of this writing; gated at prepare time (the recipe
 * side's `FAMILIES['helium-treasury'].gate`) the same way `meteora-damm-v2`/
 * `meteora-damm-v1-stable` gate their own activation timestamps — a JS-side
 * `now: bigint` check, no on-chain clock read (this in-VM model carries no clock,
 * matching the rest of this file).
 *
 * ── Account layout (all offsets ground-truthed against the real deployed accounts,
 *    decoded directly from a live RPC read) ──
 * `TreasuryManagementV0` (Anchor account, 8-byte disc `446f78d1106ed73b` = the running
 * SHA-256 discriminator; 228 bytes allocated total, only the first 162 bytes are ever
 * written — `init`'s `space = 8 + size_of::<TreasuryManagementV0>() + 60` pads the rest
 * with zeros, confirmed by reading the tail of both real accounts):
 *   treasuryMint(32)@8, supplyMint(32)@40, authority(32)@72, treasury(32)@104,
 *   curveTag(1)@136, k(u128 LE, 16)@137, freezeUnixTime(i64 LE, 8)@153, bumpSeed(1)@161.
 * `AccountWindowedCircuitBreakerV0` (8-byte disc `860b45645a84aebb`; 212 bytes allocated,
 * 138 meaningful):
 *   tokenAccount(32)@8, authority(32)@40, owner(32)@72, windowSizeSeconds(u64)@104,
 *   thresholdType(1)@112 (0=Percent, 1=Absolute), threshold(u64)@113,
 *   lastAggregatedValue(u64)@121, lastUnixTimestamp(i64)@129, bumpSeed(1)@137.
 * Both discriminators are `sha256("account:<TypeName>")[0..8]`, matching Anchor's own
 * convention.
 *
 * ── CPI shape (`redeem_v0`, disc `sha256("global:redeem_v0")[0..8]` =
 *    `eb7fab8b774deb76`; args `{ amount: u64, expected_output_amount: u64 }`, Borsh) ──
 * 10 accounts, in the EXACT order `redeem_v0.rs`'s `#[derive(Accounts)]` struct declares
 * them: treasury_management, treasury_mint, supply_mint(w), treasury(w),
 * circuit_breaker(w), from(w, the user's supply-mint ATA — burned), to(w, the user's
 * treasury-mint ATA — credited), owner(signer), circuit_breaker_program, token_program.
 * `expected_output_amount` is set to 0 here (this recipe's own `minOut`/`priceLimit` are
 * the floor, matching every other ladder's own venue-level `min_out = 1`-equivalent
 * convention — see `LadderSwapTemplate`'s own doc comment). Internally `redeem_v0`
 * CPIs into `token_program::burn` then `circuit_breaker_program::transfer_v0` (which
 * itself CPIs into `token_program::transfer`) — both nested CPIs reuse accounts already
 * present in this top-level instruction's own account list, so nothing extra is needed
 * here. MEASURED (real `simulateTransaction`, `sigVerify:false`, against the deployed
 * programs, 2026-07-31 — 6 real probes, 3 sizes on EACH pool): 117,051-122,704 CU for
 * the WHOLE top-level `treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5` invocation (which
 * subsumes both nested CPI programs) — see the recipes repo's `the consuming app SVM CU-budget module`'s
 * `CU_FAMILIES['helium-treasury']` for how that measurement becomes the CU pin.
 */
import { address, getAddressCodec, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountBytesMap, AccountLoader, PoolConfig, SvmVenueLadder, SwapUser, VenueAccount } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'helium-treasury';

/** `TreasuryManagementV0`'s own program — recipe-side `SVM_VENUE_PROGRAM_IDS['helium-treasury']`. */
export const HELIUM_TREASURY_PROGRAM_ID = address('treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5');
/** The companion `circuit-breaker` program every treasury's transfer is CPI-gated through. */
export const HELIUM_CIRCUIT_BREAKER_PROGRAM_ID = address('circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// ── TreasuryManagementV0 layout (see module doc) ──
const MGMT_DISC = 0x3bd76e10d1786f44n; // sha256("account:TreasuryManagementV0")[0..8], LE-read for the equality check below
const MGMT_ACCOUNT_SIZE = 228;
const OFF_TREASURY_MINT = 8;
const OFF_SUPPLY_MINT = 40;
const OFF_TREASURY = 104;
const OFF_CURVE_TAG = 136;
const OFF_CURVE_K = 137;
const OFF_FREEZE_UNIX_TIME = 153;

// ── AccountWindowedCircuitBreakerV0 layout (see module doc) ──
const CB_DISC = 0xbbae845a64450b86n; // sha256("account:AccountWindowedCircuitBreakerV0")[0..8], LE-read
const CB_ACCOUNT_SIZE = 212;
const OFF_CB_TOKEN_ACCOUNT = 8;
const OFF_CB_OWNER = 72;
const OFF_CB_THRESHOLD_TYPE = 112;
const OFF_CB_THRESHOLD = 113;
const OFF_CB_LAST_AGG = 121;

/** Standard SPL Token account `amount` field offset. */
const TOKEN_AMOUNT_OFFSET = 64;
const SPL_TOKEN_ACCOUNT_SIZE = 165;
/** Standard SPL Mint `supply` field offset. */
const MINT_SUPPLY_OFFSET = 36;
const SPL_MINT_SIZE = 82;

/** `u64::MAX` — the denominator `ThresholdType::Percent` divides by (`window.rs::get_threshold`). */
export const U64_MAX = 18446744073709551615n;

export interface HeliumTreasuryPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  treasuryMint: Address;
  supplyMint: Address;
  treasury: Address;
  circuitBreaker: Address;
  /** 0 = Percent (of the treasury's live balance), 1 = Absolute — `ThresholdType`. */
  thresholdType: 0 | 1;
  threshold: bigint;
  freezeUnixTime: bigint;
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

function heliumTreasuryConfig(cfg: PoolConfig): HeliumTreasuryPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as HeliumTreasuryPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

export async function fetchHeliumTreasuryPoolConfig(load: AccountLoader, pool: Address): Promise<HeliumTreasuryPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} treasury management ${pool} does not exist`);
  if (data.length !== MGMT_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} treasury management ${pool} has unexpected size ${data.length} (want ${MGMT_ACCOUNT_SIZE})`);
  }
  const disc = readUintLE(data, 0, 8);
  if (disc !== MGMT_DISC) {
    throw new Error(`${SLUG} treasury management ${pool} has unexpected discriminator ${disc.toString(16)} (want ${MGMT_DISC.toString(16)})`);
  }

  const treasuryMint = pubkeyAt(data, OFF_TREASURY_MINT);
  const supplyMint = pubkeyAt(data, OFF_SUPPLY_MINT);
  const treasury = pubkeyAt(data, OFF_TREASURY);
  const curveTag = data[OFF_CURVE_TAG];
  const k = readUintLE(data, OFF_CURVE_K, 16);
  const freezeUnixTime = BigInt.asIntN(64, readUintLE(data, OFF_FREEZE_UNIX_TIME, 8));

  if (curveTag !== 0) {
    throw new Error(`${SLUG} treasury management ${pool} has an unknown curve variant tag ${curveTag} (Curve has exactly one Borsh variant, tag 0)`);
  }
  if (k !== 0n) {
    // Both real mainnet treasuries (IOT, MOBILE) read k=0 (linear-proportional redemption,
    // R*dS/S, implemented exactly below) — see the module doc. A nonzero k needs the general
    // R*(1-((S-dS)/S)^(1+k)) power expansion, which this ladder does not implement (no live
    // example exists to validate against): reject cleanly rather than guess a formula nobody
    // can verify against real state — drop just this one pool, never the whole family.
    throw new Error(`${SLUG} treasury management ${pool} has curve k=${k} (nonzero-k curves are not yet supported — extend this adapter's power computation once a real k!=0 treasury exists to validate against)`);
  }

  const [circuitBreaker] = await getProgramDerivedAddress({
    programAddress: HELIUM_CIRCUIT_BREAKER_PROGRAM_ID,
    seeds: [new TextEncoder().encode('account_windowed_breaker'), new Uint8Array(getAddressEncoder().encode(treasury))],
  });

  const treasuryData = await load(treasury);
  if (treasuryData === null) throw new Error(`${SLUG} treasury management ${pool}: treasury token account ${treasury} does not exist`);
  if (treasuryData.length !== SPL_TOKEN_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} treasury management ${pool}: treasury ${treasury} has unexpected size ${treasuryData.length} (want ${SPL_TOKEN_ACCOUNT_SIZE} — token-2022 vaults are not supported)`);
  }
  const treasuryMintField = pubkeyAt(treasuryData, 0);
  if (treasuryMintField !== treasuryMint) {
    throw new Error(`${SLUG} treasury management ${pool}: treasury ${treasury} mint ${treasuryMintField} does not match treasuryMint ${treasuryMint}`);
  }

  // The redeem_v0 burn/transfer path is Tokenkeg-only (token_program is
  // hardcoded to spl_token::id()), so detect a Token-2022 or un-routable mint
  // via the shared data-shape resolver and SELF-DROP this treasury (the thrown
  // error is the graceful-drop signal the SvmRoute orchestrator catches). The
  // LEGACY path is byte-identical: a classic 82-byte mint classifies Tokenkeg
  // with no extensions.
  for (const mint of [treasuryMint, supplyMint]) {
    const mintData = await load(mint);
    if (mintData === null) continue; // an unreadable mint falls back to the legacy assumption
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping treasury ${pool} — mint ${mint} is Token-2022 (this venue's redeem is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping treasury ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const cbData = await load(circuitBreaker);
  if (cbData === null) throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} does not exist`);
  if (cbData.length !== CB_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} has unexpected size ${cbData.length} (want ${CB_ACCOUNT_SIZE})`);
  }
  const cbDisc = readUintLE(cbData, 0, 8);
  if (cbDisc !== CB_DISC) {
    throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} has unexpected discriminator ${cbDisc.toString(16)} (want ${CB_DISC.toString(16)})`);
  }
  const cbTokenAccount = pubkeyAt(cbData, OFF_CB_TOKEN_ACCOUNT);
  if (cbTokenAccount !== treasury) {
    throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} tokenAccount ${cbTokenAccount} does not match treasury ${treasury}`);
  }
  const cbOwner = pubkeyAt(cbData, OFF_CB_OWNER);
  if (cbOwner !== pool) {
    throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} owner ${cbOwner} does not match treasury management ${pool}`);
  }
  const thresholdTypeByte = cbData[OFF_CB_THRESHOLD_TYPE];
  if (thresholdTypeByte !== 0 && thresholdTypeByte !== 1) {
    throw new Error(`${SLUG} treasury management ${pool}: circuit breaker ${circuitBreaker} has unknown thresholdType ${thresholdTypeByte}`);
  }
  const threshold = readUintLE(cbData, OFF_CB_THRESHOLD, 8);

  return {
    venue: SLUG,
    pool,
    treasuryMint,
    supplyMint,
    treasury,
    circuitBreaker,
    thresholdType: thresholdTypeByte as 0 | 1,
    threshold,
    freezeUnixTime,
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like gamma/heaven). */
export const heliumTreasury = {
  slug: SLUG,
  programId: HELIUM_TREASURY_PROGRAM_ID,
  fetchPoolConfig: fetchHeliumTreasuryPoolConfig,
};

