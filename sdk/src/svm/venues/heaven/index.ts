/**
 * Heaven DEX ladder — a launchpad AMM (`HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o`)
 * that pairs every launched token (`token_a`) against wrapped SOL (`token_b`),
 * priced by a VIRTUAL-reserve constant product: `LiquidityPoolState.reserve.{token_a,token_b}`
 * are the pricing reserves, decoupled from the token accounts' literal SPL
 * balances (Heaven pools SOL into a protocol-wide treasury — auto-staked into
 * Marinade mSOL above `auto_staking_threshold_bps` — rather than locking it
 * 1:1 per pool; `token_a`'s reserve DOES track its vault balance exactly,
 * only `token_b`'s is virtual). "No bonding curve, virtual SOL" per Heaven's
 * own docs; confirmed byte-exact against real state below.
 *
 * GROUND TRUTH: no official on-chain IDL account or public docs repo. Layout,
 * discriminators and the swap account list come from a third-party Anchor IDL
 * capture (github.com/tenequm/solana-idls, `idl/heaven.json`, 32 instructions/
 * 5 accounts) cross-checked against a maintained aggregator CPI crate
 * (github.com/blueshift-gg/beethoven, `crates/swap/heaven`) — INDEPENDENTLY
 * CONFIRMED against the real deployed program:
 *   - `LiquidityPoolState`'s bytemuck repr(C) layout (this module's OFFSET_*
 *     constants) was computed field-by-field from the IDL's type tree and
 *     verified byte-exact against a REAL 2,304-byte pool account
 *     (`EkU9zGSkUnVVK6nhmPSqnxqcKPzt1PicrCjdxSbWo9uA`, the LIGHT/SOL pool) —
 *     every decoded pubkey (vaults, protocol_config, mints) matched a real
 *     landed transaction's own account list exactly, and `LiquidityPoolTokenInfo.owner`
 *     was confirmed to BE the token program id for that side (not a
 *     mint-authority-style owner) by matching it against the real CPI's
 *     token_a_program/token_b_program accounts.
 *   - the swap account list (16 accounts: the 14-account IDL shape plus the
 *     Chainlink store program + its SOL/USD feed, appended — no `event_authority`,
 *     unlike a stock Anchor CPI-event tail) and the `buy`/`sell` instruction
 *     wire format (disc(8) ++ patched amount u64 LE ++ min_out u64 LE=1 ++
 *     event-string-len u32 LE=0, 28 bytes) were PROVEN via two real landed
 *     mainnet transactions (one `sell` — 2,695.81 LIGHT -> 0.0438 SOL net,
 *     150 bps combined fee, matched to the EXACT LAMPORT; one `buy`) plus
 *     FOUR real `simulateTransaction` dry-runs (sigVerify:false, no funds
 *     moved, an existing funded mainnet wallet's own ATAs) at 0.01/0.1/1/5
 *     SOL against the SAME LIGHT/SOL pool's then-live reserves — matching
 *     this ladder's formula to 6-7 significant figures, the tiny residual
 *     (~1e-7 relative) fully attributable to ordinary state drift on a
 *     continuously-traded pool between the state read and the simulate call
 *     (same class of drift the carrot integration's dry-runs measured at
 *     ~0.04% — this venue's is two orders of magnitude tighter).
 *
 * FEE MODEL (see FeeBrackets/SlotFeeBrackets below): FIVE independent fee
 * TYPES (protocol/LP/creator/creator-protocol-share/reflection), each with
 * its own market-cap-tiered bps schedule (`FeeConfigurationMode.Global` reads
 * the schedule off the singleton `ProtocolConfig`; `.Local` reads the pool's
 * OWN copy, both decoded identically here). The real `sell` trade proved the
 * EXACT rounding rule: each of the (up to five) selected fees is
 * `floor(gross * bps / 10000)` INDEPENDENTLY, then SUMMED and subtracted from
 * the gross constant-product output — NOT `floor(gross * totalBps / 10000)`
 * (that combined form was off by 1-2 lamports against the same real trade;
 * per-component floor-then-sum matched to the last lamport). Market cap is
 * priced the SAME way pump.fun's own SDK derives it (this repo's own
 * `pumpswap` ladder's `marketCap = quoteReserve * baseMintSupply / baseReserve`
 * comment) converted to USD via the live Chainlink SOL/USD feed
 * (`CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt` — universal across every
 * Heaven pool, confirmed by 3+ independent third-party Heaven-specific bots
 * hardcoding the same address) — resolved and BAKED ONCE at fetch time (the
 * SAME staleness contract as `pumpswap`'s own market-cap fee-tier bake: the
 * recipe's terminal outAta delta check covers a tier boundary crossing
 * between fetch and cook).
 *
 * ANTI-SNIPE SELF-DROP: `SlotFeeBrackets` is a per-fee-type, slot-offset-keyed
 * fee schedule active only for `max_slot_offset` slots (~seconds) after pool
 * creation ("a six-second sniper tax on new launches" per Heaven's own docs) —
 * a fast-decaying regime this adapter does not attempt to model (a favourable
 * error here would be exactly the "model more favourable than the venue's own
 * math" liveness hazard). `fetchHeavenPoolConfig` reads the live Clock sysvar
 * and self-drops the WHOLE pool (throws) if ANY fee type's slot-offset window
 * (pool-local OR protocol-level, whichever `fee_configuration_mode` names) is
 * still active. Every pool this adapter has been validated against is old
 * enough that this never fires; it exists so a brand-new launch is refused
 * loudly rather than mispriced.
 *
 * SELF-DROP SCOPE (fetchPoolConfig throws, caught by `resolveSvmPoolSpec`):
 * pool type other than `LiquidityPoolType::Standard` (2) — the only type this
 * adapter has decoded/validated; `taxable_side_type` other than 0 (the only
 * value observed); `token_b.mint` other than wrapped SOL (the Chainlink
 * market-cap conversion assumes a SOL-denominated quote side); EITHER mint
 * carrying an ACTIVE (nonzero bps) Token-2022 `TransferFeeConfig` extension —
 * narrower than `pumpswap`'s blanket presence-reject, because Heaven's own
 * launched tokens routinely carry the extension at a currently-zero rate (the
 * real `sell` trade above IS one such token, LIGHT itself, and its vault delta
 * matched the user's ATA delta exactly, proving zero effective fee at that
 * rate) — rejecting on mere presence would refuse most real Heaven launches,
 * defeating the point; rejecting only a NONZERO rate is the correctness-scoped
 * version of the same gate.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { parseMintExtensions } from "../../token-extensions.js";

export const HEAVEN_PROGRAM_ID = address("HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o");

const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WSOL_MINT = address("So11111111111111111111111111111111111111112");
const CHAINLINK_SOL_USD_FEED = address("CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt");

const POOL_DISCRIMINATOR = [190, 158, 220, 130, 15, 162, 132, 252];

const MINT_SUPPLY_OFFSET = 36;
/** Token-2022 mint TLV area (see pumpswap's `detectTokenProgram` for the same convention). */
const MINT_ACCOUNT_TYPE_OFFSET = 165;
const MINT_TLV_START = 166;
const EXTENSION_TRANSFER_FEE_CONFIG = 1;
/** Within a TransferFeeConfig extension's 108-byte payload: two `TransferFee{epoch(8),max(8),bps(2)}`
 *  records — `older` at data-relative offset 72, `newer` at 90 (each 18 bytes: epoch, max_fee, bps). */
const TRANSFER_FEE_OLDER_OFFSET = 72;
const TRANSFER_FEE_NEWER_OFFSET = 90;

// LiquidityPoolState (bytemuck repr(C), disc(8) + 2,296 bytes = 2,304 total) — absolute byte
// offsets INCLUDING the 8-byte discriminator, computed from the IDL type tree and verified
// byte-exact against a real 2,304-byte pool account (module header).
const POOL_SIZE = 2304;
const OFF_INFO_TYPE = 90; // LiquidityPoolInfo.r#type (u8) — LiquidityPoolType::Standard == 2.
const OFF_MCAP_FEES_BASE = 96; // pool-LOCAL LiquidityPoolMarketCapBasedFees (5 x 72-byte FeeBrackets groups).
const OFF_RESERVE_A = 456; // LiquidityPoolReserve.token_a (u64) — the PRICING reserve (== vault balance).
const OFF_RESERVE_B = 464; // LiquidityPoolReserve.token_b (u64) — the VIRTUAL pricing reserve (module header).
const OFF_CREATED_AT_SLOT = 632; // u64 — anti-snipe window base.
const OFF_TOKEN_A_VAULT = 664; // pubkey
const OFF_TOKEN_B_VAULT = 696; // pubkey
const OFF_PROTOCOL_CONFIG = 728; // pubkey
const OFF_TOKEN_A = 792; // LiquidityPoolTokenInfo { mint: pubkey@0, decimals: u8@32, owner(=token program): pubkey@33 }, 65 bytes
const OFF_TOKEN_B = 857; // same shape
const OFF_TAXABLE_SIDE_TYPE = 938; // u8
const OFF_FEE_CONFIGURATION_MODE = 941; // u8 — FeeConfigurationMode::Global(0) | Local(1)
const OFF_SLOT_FEES_BASE = 956; // pool-LOCAL LiquidityPoolSlotOffsetBasedFees (5 x 262-byte SlotFeeBrackets groups)

// ProtocolConfig (bytemuck repr(C), disc(8) + 1,784 bytes = 1,792 total) — same internal group
// shapes as the pool-local copies above, different absolute bases (verified byte-exact, module header).
const PROTOCOL_CONFIG_MCAP_FEES_BASE = 88;
const PROTOCOL_CONFIG_SLOT_FEES_BASE = 476;

// FeeBrackets group: 4 x FeeBracket{market_cap_upper_bound: u64, buy_fee_bps: u32, sell_fee_bps: u32}
// (16 bytes each) + count: u8 @ 64 + 7 bytes padding = 72 bytes.
const FEE_BRACKET_STRIDE = 16;
const FEE_BRACKETS_COUNT_OFFSET = 64;
const FEE_BRACKETS_GROUP_STRIDE = 72;
/** protocol / lp / creator / creator-protocol-share / reflection, in IDL declaration order. */
const MCAP_FEE_TYPE_OFFSETS = [0, 1, 2, 3, 4].map((i) => i * FEE_BRACKETS_GROUP_STRIDE);

// SlotFeeBrackets group: 42 x SlotFeeBracket{buy_fee_bps: u16, sell_fee_bps: u16, slot_offset_upperbound: u16}
// (6 bytes each) + max_slot_offset: u16 @ 252 + max_fee_bps: u16 @ 254 + count: u8 @ 256 + enabled: u8 @ 257
// + 4 bytes padding = 262 bytes.
const SLOT_FEE_MAX_OFFSET_FIELD = 252;
const SLOT_FEE_ENABLED_OFFSET = 257;
const SLOT_FEE_GROUP_STRIDE = 262;
const SLOT_FEE_TYPE_OFFSETS = [0, 1, 2, 3, 4].map((i) => i * SLOT_FEE_GROUP_STRIDE);

const addressDecoder = getAddressDecoder();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  addressDecoder.decode(data.subarray(offset, offset + 32));

async function loadRequired(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`heaven ${what} ${addr} not found`);
  return data;
}

/** One resolved (buyBps, sellBps) fee-type pair — see module header's FEE MODEL note. */
interface HeavenFeeRates {
  protocolBuyBps: bigint;
  protocolSellBps: bigint;
  lpBuyBps: bigint;
  lpSellBps: bigint;
  creatorBuyBps: bigint;
  creatorSellBps: bigint;
  creatorProtocolBuyBps: bigint;
  creatorProtocolSellBps: bigint;
  reflectionBuyBps: bigint;
  reflectionSellBps: bigint;
}

/** Scans one FeeBrackets group (ascending by market_cap_upper_bound) for the bracket covering `marketCapUsd`. */
function selectFeeBracket(
  data: Uint8Array,
  groupBase: number,
  marketCapUsd: bigint,
): { buyBps: bigint; sellBps: bigint } {
  const count = data[groupBase + FEE_BRACKETS_COUNT_OFFSET]!;
  if (count === 0) return { buyBps: 0n, sellBps: 0n };
  let last = { buyBps: 0n, sellBps: 0n };
  for (let i = 0; i < count && i < 4; i++) {
    const o = groupBase + i * FEE_BRACKET_STRIDE;
    const upper = readUintLE(data, o, 8);
    const buyBps = readUintLE(data, o + 8, 4);
    const sellBps = readUintLE(data, o + 12, 4);
    last = { buyBps, sellBps };
    if (marketCapUsd <= upper) return last;
  }
  // Every populated bracket's upper bound was exceeded — fall back to the highest tier rather
  // than throw; the schedule is expected to end in a u64::MAX catchall (observed live).
  return last;
}

function resolveFeeRates(
  data: Uint8Array,
  mcapFeesBase: number,
  marketCapUsd: bigint,
): HeavenFeeRates {
  const [protocolOff, lpOff, creatorOff, creatorProtocolOff, reflectionOff] =
    MCAP_FEE_TYPE_OFFSETS.map((o) => mcapFeesBase + o);
  const protocol = selectFeeBracket(data, protocolOff!, marketCapUsd);
  const lp = selectFeeBracket(data, lpOff!, marketCapUsd);
  const creator = selectFeeBracket(data, creatorOff!, marketCapUsd);
  const creatorProtocol = selectFeeBracket(data, creatorProtocolOff!, marketCapUsd);
  const reflection = selectFeeBracket(data, reflectionOff!, marketCapUsd);
  return {
    protocolBuyBps: protocol.buyBps,
    protocolSellBps: protocol.sellBps,
    lpBuyBps: lp.buyBps,
    lpSellBps: lp.sellBps,
    creatorBuyBps: creator.buyBps,
    creatorSellBps: creator.sellBps,
    creatorProtocolBuyBps: creatorProtocol.buyBps,
    creatorProtocolSellBps: creatorProtocol.sellBps,
    reflectionBuyBps: reflection.buyBps,
    reflectionSellBps: reflection.sellBps,
  };
}

/** True if ANY of the 5 fee types' slot-offset (anti-snipe) window is still active. */
function anySlotWindowActive(
  data: Uint8Array,
  slotFeesBase: number,
  slotsSinceCreation: bigint,
): boolean {
  if (slotsSinceCreation < 0n) return false; // clock/creation-slot mismatch — do not gate on a nonsensical negative.
  for (const typeOff of SLOT_FEE_TYPE_OFFSETS) {
    const base = slotFeesBase + typeOff;
    const enabled = data[base + SLOT_FEE_ENABLED_OFFSET]! !== 0;
    if (!enabled) continue;
    const maxSlotOffset = readUintLE(data, base + SLOT_FEE_MAX_OFFSET_FIELD, 2);
    if (slotsSinceCreation <= maxSlotOffset) return true;
  }
  return false;
}

/**
 * See module header's Token-2022 gate note: reject only the CURRENTLY-EFFECTIVE (nonzero) transfer
 * fee, not mere presence, and not the OTHER schedule entry. A TransferFeeConfig extension always
 * carries both an `older` and a `newer` `TransferFee{epoch, maximum_fee, transfer_fee_basis_points}`
 * — spl-token-2022's OWN activation rule is `newer` is effective once `currentEpoch >=
 * newer.epoch`, else `older` still applies. Taking the max of the two (an earlier revision of this
 * function did) is WRONG, not merely conservative: the real LIGHT mint this adapter was validated
 * against carries `older = {epoch: 831, bps: 150}` / `newer = {epoch: 838, bps: 0}` — a scheduled
 * fee REMOVAL, long past its activation epoch on any pool old enough to have real liquidity (Solana
 * epochs are ~2-3 days; a max() reads this as "150 bps active" and self-drops every such pool,
 * exactly the "refuse for a non-reason" failure mode this campaign is built to avoid.
 */
function activeTransferFeeBps(mintData: Uint8Array, mint: Address, currentEpoch: bigint): bigint {
  if (mintData.length <= MINT_ACCOUNT_TYPE_OFFSET) return 0n; // classic (82-byte) mint — no extensions possible.
  if (mintData[MINT_ACCOUNT_TYPE_OFFSET] !== 1) {
    throw new Error(
      `heaven mint ${mint} token-2022 account type is ${mintData[MINT_ACCOUNT_TYPE_OFFSET]}, expected 1 (mint)`,
    );
  }
  let offset = MINT_TLV_START;
  while (offset + 4 <= mintData.length) {
    const extensionType = mintData[offset]! | (mintData[offset + 1]! << 8);
    const extensionLength = mintData[offset + 2]! | (mintData[offset + 3]! << 8);
    if (extensionType === 0) break; // uninitialized tail
    const dataStart = offset + 4;
    if (extensionType === EXTENSION_TRANSFER_FEE_CONFIG) {
      const newerEpoch = readUintLE(mintData, dataStart + TRANSFER_FEE_NEWER_OFFSET, 8);
      if (currentEpoch >= newerEpoch) {
        return readUintLE(mintData, dataStart + TRANSFER_FEE_NEWER_OFFSET + 16, 2);
      }
      return readUintLE(mintData, dataStart + TRANSFER_FEE_OLDER_OFFSET + 16, 2);
    }
    offset = dataStart + extensionLength;
  }
  return 0n;
}

export interface HeavenPoolConfig extends PoolConfig {
  venue: "heaven";
  direction: "buy" | "sell";
  tokenAMint: Address;
  tokenBMint: Address;
  tokenAProgram: Address;
  tokenBProgram: Address;
  tokenAVault: Address;
  tokenBVault: Address;
  protocolConfig: Address;
  fees: HeavenFeeRates;
}

function heavenConfig(cfg: PoolConfig): HeavenPoolConfig {
  if (cfg.venue !== "heaven")
    throw new Error(`heaven ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as HeavenPoolConfig;
}

async function fetchHeavenPoolConfig(
  load: AccountLoader,
  pool: Address,
): Promise<HeavenPoolConfig> {
  const data = await loadRequired(load, pool, "pool");
  if (data.length !== POOL_SIZE)
    throw new Error(`heaven pool ${pool} is ${data.length} bytes, expected ${POOL_SIZE}`);
  if (!POOL_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error(
      `heaven pool ${pool} discriminator mismatch (not a LiquidityPoolState account)`,
    );
  }

  const poolType = data[OFF_INFO_TYPE]!;
  if (poolType !== 2) {
    throw new Error(
      `heaven pool ${pool} has unvalidated pool type ${poolType} (only LiquidityPoolType::Standard(2) is supported)`,
    );
  }
  const taxableSideType = data[OFF_TAXABLE_SIDE_TYPE]!;
  if (taxableSideType !== 0) {
    throw new Error(
      `heaven pool ${pool} has unvalidated taxable_side_type ${taxableSideType} (only 0 is supported)`,
    );
  }

  const tokenAMint = pubkeyAt(data, OFF_TOKEN_A);
  const tokenAProgram = pubkeyAt(data, OFF_TOKEN_A + 33);
  const tokenBMint = pubkeyAt(data, OFF_TOKEN_B);
  const tokenBProgram = pubkeyAt(data, OFF_TOKEN_B + 33);
  if (tokenBMint !== WSOL_MINT) {
    throw new Error(
      `heaven pool ${pool} quotes ${tokenBMint} as token_b, not wrapped SOL — the Chainlink market-cap conversion assumes a SOL-denominated quote side`,
    );
  }

  const tokenAVault = pubkeyAt(data, OFF_TOKEN_A_VAULT);
  const tokenBVault = pubkeyAt(data, OFF_TOKEN_B_VAULT);
  const protocolConfigAddr = pubkeyAt(data, OFF_PROTOCOL_CONFIG);
  const createdAtSlot = readUintLE(data, OFF_CREATED_AT_SLOT, 8);
  const feeMode = data[OFF_FEE_CONFIGURATION_MODE]!; // 0 = Global (ProtocolConfig), 1 = Local (this account)

  const [clockData, protocolConfigData, tokenAMintData, tokenBMintData, chainlinkData] =
    await Promise.all([
      loadRequired(load, CLOCK_SYSVAR, "Clock sysvar"),
      loadRequired(load, protocolConfigAddr, "protocol config"),
      loadRequired(load, tokenAMint, "token_a mint"),
      loadRequired(load, tokenBMint, "token_b mint"),
      loadRequired(load, CHAINLINK_SOL_USD_FEED, "chainlink SOL/USD feed"),
    ]);

  const currentSlot = readUintLE(clockData, 0, 8);
  const currentEpoch = readUintLE(clockData, 16, 8); // Clock.epoch — see activeTransferFeeBps's doc.
  const slotsSinceCreation = currentSlot - createdAtSlot;
  // Anti-snipe self-drop (module header): check BOTH the pool-local and protocol-level slot
  // schedules regardless of feeMode — conservative (never worse than checking one), and cheap
  // (both accounts are already loaded above).
  if (
    anySlotWindowActive(data, OFF_SLOT_FEES_BASE, slotsSinceCreation) ||
    anySlotWindowActive(protocolConfigData, PROTOCOL_CONFIG_SLOT_FEES_BASE, slotsSinceCreation)
  ) {
    throw new Error(
      `heaven pool ${pool} is within its anti-snipe slot-offset window (created_at_slot ${createdAtSlot}, current ${currentSlot}) — fee schedule is not modeled during this window`,
    );
  }

  // Un-routable extension self-drop: a NonTransferable or DefaultAccountState=
  // frozen mint genuinely cannot be swapped through a plain transferChecked, so
  // drop the whole pool. PermanentDelegate / ConfidentialTransfer are advisories
  // (routable), never blocking — parseMintExtensions already scopes this
  // correctly. Legacy (82-byte) mints and token_b (gated to wrapped SOL) parse
  // to blocking:[], so this is a no-op on the legacy path.
  for (const [mintData, mint, side] of [
    [tokenAMintData, tokenAMint, "token_a"],
    [tokenBMintData, tokenBMint, "token_b"],
  ] as const) {
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(
        `heaven pool ${pool}: ${side} mint ${mint} is un-routable: ${blocking.join("; ")}`,
      );
    }
  }

  const tokenAFeeBps =
    tokenAProgram === TOKEN_2022_PROGRAM
      ? activeTransferFeeBps(tokenAMintData, tokenAMint, currentEpoch)
      : 0n;
  const tokenBFeeBps =
    tokenBProgram === TOKEN_2022_PROGRAM
      ? activeTransferFeeBps(tokenBMintData, tokenBMint, currentEpoch)
      : 0n;
  // A ZERO effective-bps Token-2022 mint (e.g. LIGHT's scheduled fee REMOVAL —
  // see activeTransferFeeBps's doc) ROUTES with a quote byte-identical to legacy.
  // Only an ACTIVE (nonzero) fee self-drops.
  // TODO(t22-fee-netting): net the fee on both legs in the consuming app's Heaven
  // quote fragment (POOL receives net(amountIn, feeOfInputMint); USER receives
  // net(grossOut, feeOfOutputMint)) instead of self-dropping. This fetch-only
  // adapter has no referenceQuote here (Heaven's 5-fee-type virtual-reserve quote
  // lives in the consuming app), so netting it in-repo is not possible with
  // confidence — kept as a self-drop (safe self-limit; a wrong netting would
  // silently mis-quote).
  if (tokenAFeeBps > 0n || tokenBFeeBps > 0n) {
    throw new Error(
      `heaven pool ${pool}: an ACTIVE Token-2022 transfer fee is configured (token_a ${tokenAFeeBps} bps, token_b ${tokenBFeeBps} bps) — vault deltas would not match user amounts`,
    );
  }

  const mintSupply = readUintLE(tokenAMintData, MINT_SUPPLY_OFFSET, 8);
  const reserveA = readUintLE(data, OFF_RESERVE_A, 8);
  const reserveB = readUintLE(data, OFF_RESERVE_B, 8);
  const chainlinkDecimals = chainlinkData[138]!; // Transmissions.decimals (module header's Chainlink layout).
  const chainlinkPrice = latestChainlinkPrice(chainlinkData);

  // marketCapUsd = (reserveB_lamports * mintSupply_raw / reserveA_raw) [virtual SOL market cap,
  // raw lamports] * chainlinkPrice / 10^(9 + chainlinkDecimals) [-> whole USD dollars] — kept as
  // ONE combined BigInt fraction (no intermediate floor) to minimize rounding loss; see module
  // header's FEE MODEL note. mintSupply/reserveA is a dimensionless ratio (both are token_a's own
  // raw base units), so this is correct regardless of tokenADecimals — no decimals-scale term
  // needed. reserveA == 0 is a degenerate/drained pool — treat as $0 market cap (falls to the
  // lowest bracket) rather than dividing by zero; such a pool has zero depth anyway and is dropped
  // by the relative-depth filter regardless. token_b is gated to wrapped SOL above, so its
  // decimals (9) is a protocol constant, not a per-pool value.
  const marketCapUsd =
    reserveA === 0n
      ? 0n
      : (reserveB * mintSupply * chainlinkPrice) /
        (reserveA * 10n ** BigInt(9 + Number(chainlinkDecimals)));

  const mcapFeesBase = feeMode === 1 ? OFF_MCAP_FEES_BASE : PROTOCOL_CONFIG_MCAP_FEES_BASE;
  const mcapFeesSource = feeMode === 1 ? data : protocolConfigData;
  const fees = resolveFeeRates(mcapFeesSource, mcapFeesBase, marketCapUsd);

  return {
    venue: "heaven",
    pool,
    direction: "buy",
    tokenAMint,
    tokenBMint,
    tokenAProgram,
    tokenBProgram,
    tokenAVault,
    tokenBVault,
    protocolConfig: protocolConfigAddr,
    fees,
  };
}

// Chainlink `Transmissions` feed account (chainlink-solana store program) — Borsh-tight header
// (disc(8) + version(1) + state(1) + owner(32) + proposed_owner(32) + writer(32) + description(32)
// + decimals(1)@138 + flagging_threshold(4) + latest_round_id(4) + granularity(1) + live_length(4)@148
// + live_cursor(4)@152 + historical_cursor(4)@156), then a fixed HEADER_SIZE=192-byte reserved region
// (disc + 192 = 200), then the live ring buffer: `Transmission{slot:u64, timestamp:u32, _pad:u32,
// answer:i128, _pad:u64, _pad:u64}` (48 bytes each). Verified byte-exact against the real universal
// feed account (module header): decimals=8, live_length=1, slot/timestamp within seconds of "now".
const CHAINLINK_HEADER_TOTAL = 200;
const CHAINLINK_TRANSMISSION_SIZE = 48;
function latestChainlinkPrice(data: Uint8Array): bigint {
  const liveLength = readUintLE(data, 148, 4);
  const liveCursor = readUintLE(data, 152, 4);
  if (liveLength === 0n) throw new Error("heaven chainlink feed has no live transmissions");
  const idx = (liveCursor + liveLength - 1n) % liveLength;
  const off = CHAINLINK_HEADER_TOTAL + Number(idx) * CHAINLINK_TRANSMISSION_SIZE;
  const answer = readSignedI128LE(data, off + 16);
  if (answer <= 0n) throw new Error("heaven chainlink feed reports a non-positive SOL/USD price");
  return answer;
}
function readSignedI128LE(data: Uint8Array, offset: number): bigint {
  const unsigned = readUintLE(data, offset, 16);
  const signBit = 1n << 127n;
  return unsigned >= signBit ? unsigned - (signBit << 1n) : unsigned;
}

export const heaven = {
  slug: "heaven" as const,
  programId: HEAVEN_PROGRAM_ID,
  fetchPoolConfig: (load: AccountLoader, pool: Address): Promise<HeavenPoolConfig> =>
    fetchHeavenPoolConfig(load, pool),
};

export function heavenMints(base: PoolConfig): { inMint: Address; outMint: Address } {
  const c = heavenConfig(base);
  return c.direction === "buy"
    ? { inMint: c.tokenBMint, outMint: c.tokenAMint }
    : { inMint: c.tokenAMint, outMint: c.tokenBMint };
}

export function heavenApplyDirection(
  base: PoolConfig,
  direction: string | undefined,
): HeavenPoolConfig {
  const c = heavenConfig(base);
  if (direction === undefined || direction === "buy") return c;
  if (direction === "sell") return { ...c, direction: "sell" };
  throw new Error(`heaven direction must be 'buy' or 'sell', got '${direction}'`);
}
