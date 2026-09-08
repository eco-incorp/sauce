/**
 * PumpSwap (pump.fun AMM) venue adapter — constant-product over raw SPL vault
 * balances (nothing subtracted: protocol/creator/buyback fees leave to their
 * own ATAs at swap time and the LP fee stays in the vault). Layouts follow the
 * official Anchor IDL, quote math the official SDK, both verified byte-exact
 * against mainnet simulation events (see the pumpswap section of
 * docs/svm-venues.md).
 *
 * Fees come from the fee program's FeeConfig PDA, re-read on every
 * fetchPoolConfig (they are admin-mutable): non-canonical pools pay flat_fees;
 * canonical pump pools (pool.creator == pump bonding curve's pool-authority
 * PDA for the base mint) pay the market-cap fee tier. The tier is selected
 * from fetch-time reserves and baked into the emitted quote — staleness across
 * a tier boundary is covered by the recipe's post-swap outAta delta check.
 *
 * exactIn directions: 'quoteToBase' (default, instruction buy_exact_quote_in)
 * and 'baseToQuote' (instruction sell) — flip PumpswapPoolConfig.direction to
 * sell. Both quote formulas bake the fee arithmetic off-chain where it only
 * depends on compile-time constants, so the in-VM fragment reads exactly two
 * accounts: the pool's base and quote vault amounts (u64 LE at offset 64).
 *
 * Overflow bound (docs/svm-venues.md: all reserve/amount fields are SPL u64): every
 * in-VM product is u64 * u64-or-bps < 2^128, far inside the engine's 256-bit
 * wrap-free range; Math.mulDiv is used for the invariant products anyway.
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { ceilDiv, readUintLE } from "../math.js";
import { parseMintExtensions } from "../../token-extensions.js";
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from "../types.js";

export const PUMPSWAP_PROGRAM_ID = address("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const FEE_PROGRAM = address("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const GLOBAL_CONFIG = address("ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw");
const FEE_CONFIG = address("5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx");
const EVENT_AUTHORITY = address("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
const GLOBAL_VOLUME_ACCUMULATOR = address("C2aFPdENg4A2HQsmrd5rTw5TaYBX5Ku887cWjbFKtZpw");
const PUMP_BONDING_PROGRAM = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/** Pubkey::default — a pool with this coin_creator pays no creator fee. */
const DEFAULT_PUBKEY = address("11111111111111111111111111111111");

const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
const GLOBAL_CONFIG_DISCRIMINATOR = [149, 8, 156, 202, 160, 252, 176, 217];
const FEE_CONFIG_DISCRIMINATOR = [143, 52, 146, 187, 219, 123, 76, 155];
const BUY_EXACT_QUOTE_IN_DISCRIMINATOR = [198, 46, 21, 82, 180, 217, 232, 112];
const SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173];

/**
 * user_volume_accumulator (buy path only) is a PDA over the user's own wallet
 * address — ['user_volume_accumulator', user] under the amm program — so the
 * adapter cannot resolve it from pool state. buildSwap attaches it under this
 * ref for the caller to resolve.
 */
export const USER_VOLUME_ACCUMULATOR_REF = "pumpswap-user-volume-accumulator";

const BPS = 10_000n;
const U64_MAX = (1n << 64n) - 1n;

export interface PumpswapPoolConfig extends PoolConfig {
  venue: "pumpswap";
  /** exactIn side: 'quoteToBase' = buy_exact_quote_in (default), 'baseToQuote' = sell. */
  direction: "quoteToBase" | "baseToQuote";
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  baseTokenProgram: Address;
  quoteTokenProgram: Address;
  coinCreator: Address;
  /** creator == pump bonding curve pool-authority PDA — selects tiered fees. */
  canonical: boolean;
  /** Selected at fetch time: flat_fees, or the market-cap tier for canonical pools. */
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
  /** GlobalConfig.disable_flags (bit3 buy, bit4 sell). */
  disableFlags: number;
  protocolFeeRecipient: Address;
  protocolFeeRecipientTokenAccount: Address;
  coinCreatorVaultAuthority: Address;
  coinCreatorVaultAta: Address;
  /** ['pool-v2', base_mint] PDA, attached only when coin_creator is set. */
  poolV2?: Address;
  buybackFeeRecipient: Address;
  buybackFeeRecipientTokenAccount: Address;
}

function asPumpswapConfig(cfg: PoolConfig): PumpswapPoolConfig {
  if (cfg.venue !== "pumpswap") {
    throw new Error(`pumpswap adapter got a '${cfg.venue}' pool config for pool ${cfg.pool}`);
  }
  return cfg as PumpswapPoolConfig;
}

function hasDiscriminator(data: Uint8Array, discriminator: number[]): boolean {
  return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}

function pubkeyAt(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}

async function pda(seeds: (string | Uint8Array)[], programAddress: Address): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

async function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return pda(
    [
      new Uint8Array(encoder.encode(owner)),
      new Uint8Array(encoder.encode(tokenProgram)),
      new Uint8Array(encoder.encode(mint)),
    ],
    ASSOCIATED_TOKEN_PROGRAM,
  );
}

/**
 * Which token program serves this mint, from its account data alone: a classic
 * layout is exactly 82 bytes (assumed Tokenkeg — an extensionless token-2022
 * mint is indistinguishable, and every pump token-2022 mint carries
 * extensions), anything longer must be token-2022 TLV. Gate (documented in
 * docs/svm-venues.md): a TransferFeeConfig extension makes vault deltas
 * diverge from user amounts, so such mints are rejected.
 */
function detectTokenProgram(mint: Address, data: Uint8Array): Address {
  if (data.length === 82) return TOKEN_PROGRAM;
  if (data.length < 166) {
    throw new Error(`pumpswap mint ${mint} data is ${data.length} bytes, not a token mint layout`);
  }
  if (data[165] !== 1) {
    throw new Error(
      `pumpswap mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`,
    );
  }
  // Un-routable (blocking) extensions self-drop the pool: a NonTransferable or
  // default-frozen mint genuinely cannot move through a plain transferChecked,
  // so it can never route. PermanentDelegate / ConfidentialTransfer are NOT
  // blocking (PYUSD/USDG carry them and trade fine) — parseMintExtensions keeps
  // those out of `blocking`, so a zero-fee/advisory-only T22 mint still routes.
  const { blocking } = parseMintExtensions(data);
  if (blocking.length > 0) {
    throw new Error(`pumpswap gate: mint ${mint} is un-routable — ${blocking.join("; ")}`);
  }
  let offset = 166;
  while (offset + 4 <= data.length) {
    const extensionType = data[offset] | (data[offset + 1] << 8);
    const extensionLength = data[offset + 2] | (data[offset + 3] << 8);
    if (extensionType === 0) break; // uninitialized tail
    if (extensionType === 1) {
      // TODO(t22-fee-netting): a TransferFeeConfig makes the vault delta diverge
      // from the user amount on both legs. Correct handling nets the fee via
      // netTransferAmount on BOTH the on-chain election fragment (emitQuote) AND
      // referenceQuote so the two stay consistent (netting only referenceQuote
      // would desync it from the elected quote), and needs the mint's fee TLV
      // read on-chain in SauceScript. That coordinated change is out of scope
      // for this pass; keep the safe self-limiting rejection so a fee-bearing
      // pool simply drops out rather than risk a favourable mis-quote.
      throw new Error(
        `pumpswap gate: mint ${mint} carries a token-2022 TransferFeeConfig extension (vault deltas would not match user amounts)`,
      );
    }
    offset += 4 + extensionLength;
  }
  return TOKEN_2022_PROGRAM;
}

interface FeeTier {
  marketCapThreshold: bigint;
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}

/** FeeTier borsh entries: u128 LE threshold + three u64 LE bps, 40 bytes each, vec at offset 65. */
function parseFeeTiers(data: Uint8Array): FeeTier[] {
  const count = Number(readUintLE(data, 65, 4));
  const tiers: FeeTier[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 69 + i * 40;
    if (offset + 40 > data.length) {
      throw new Error(
        `pumpswap fee config declares ${count} fee tiers but tier ${i} overruns its ${data.length}-byte data`,
      );
    }
    tiers.push({
      marketCapThreshold: readUintLE(data, offset, 16),
      lpFeeBps: readUintLE(data, offset + 16, 8),
      protocolFeeBps: readUintLE(data, offset + 24, 8),
      creatorFeeBps: readUintLE(data, offset + 32, 8),
    });
  }
  return tiers;
}

/** Tier scan (docs/svm-venues.md fee selection): below tiers[0] -> tiers[0]; else highest tier with mc >= threshold. */
function pickFeeTier(tiers: FeeTier[], marketCap: bigint): FeeTier {
  if (marketCap < tiers[0].marketCapThreshold) return tiers[0];
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (marketCap >= tiers[i].marketCapThreshold) return tiers[i];
  }
  return tiers[0];
}

async function loadAccount(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`pumpswap ${what} ${addr} not found`);
  return data;
}

/**
 * buy_exact_quote_in effective quote input (docs/svm-venues.md buy
 * formula): strip the fee share off the spendable budget,
 * ceil-rounding each fee component separately, and hand back effQ after the
 * over-budget correction. The on-chain invariant swap then uses effQ - 1.
 */
function buyEffectiveQuoteIn(
  spendable: bigint,
  lp: bigint,
  protocol: bigint,
  creator: bigint,
): bigint {
  const totalFeeBps = lp + protocol + creator;
  let eff = (spendable * BPS) / (BPS + totalFeeBps);
  const fees = ceilDiv(eff * lp, BPS) + ceilDiv(eff * protocol, BPS) + ceilDiv(eff * creator, BPS);
  const over = eff + fees - spendable;
  if (over > 0n) eff -= over;
  // Unverified edge on-chain (docs/svm-venues.md caveats): guard eff >= 2.
  if (eff < 2n)
    throw new Error(
      `pumpswap quote amountIn ${spendable} is too small (effective quote input below 2)`,
    );
  return eff;
}

function writeU64LE(data: Uint8Array, offset: number, value: bigint): void {
  for (let i = 0; i < 8; i++) data[offset + i] = Number((value >> BigInt(8 * i)) & 0xffn);
}

function checkAmountIn(amountIn: bigint): void {
  if (amountIn <= 0n || amountIn > U64_MAX) {
    throw new Error(`pumpswap amountIn must be a positive u64, got ${amountIn}`);
  }
}

const readonly = (addr: Address): VenueAccount => ({ ref: addr, address: addr });
const writable = (addr: Address): VenueAccount => ({ ref: addr, address: addr, writable: true });

export const pumpswapAdapter = {
  slug: "pumpswap",
  kind: "constant-product",
  programId: PUMPSWAP_PROGRAM_ID,

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<PumpswapPoolConfig> {
    const poolData = await loadAccount(load, pool, "pool");
    if (!hasDiscriminator(poolData, POOL_DISCRIMINATOR)) {
      throw new Error(`pumpswap pool ${pool} discriminator mismatch (not a pump amm Pool account)`);
    }
    // Core fields run through lp_supply at 203..211; pools shorter than 243
    // predate coin_creator, which then reads as Pubkey::default (observed
    // sizes in docs/svm-venues.md).
    if (poolData.length < 211) {
      throw new Error(
        `pumpswap pool ${pool} data is ${poolData.length} bytes, expected at least 211`,
      );
    }
    const creator = pubkeyAt(poolData, 11);
    const baseMint = pubkeyAt(poolData, 43);
    const quoteMint = pubkeyAt(poolData, 75);
    const baseVault = pubkeyAt(poolData, 139);
    const quoteVault = pubkeyAt(poolData, 171);
    const coinCreator = poolData.length >= 243 ? pubkeyAt(poolData, 211) : DEFAULT_PUBKEY;
    const isMayhemMode = poolData.length >= 244 && poolData[243] !== 0;
    const isCashbackCoin = poolData.length >= 245 && poolData[244] !== 0;
    if (isMayhemMode) {
      throw new Error(
        `pumpswap pool ${pool} gate: is_mayhem_mode is set (mayhem fee routing is unverified)`,
      );
    }
    if (isCashbackCoin) {
      throw new Error(
        `pumpswap pool ${pool} gate: is_cashback_coin is set (cashback swaps need user-derived remaining accounts)`,
      );
    }

    const [
      globalConfigData,
      feeConfigData,
      baseMintData,
      quoteMintData,
      baseVaultData,
      quoteVaultData,
    ] = await Promise.all([
      loadAccount(load, GLOBAL_CONFIG, "global config"),
      loadAccount(load, FEE_CONFIG, "fee config"),
      loadAccount(load, baseMint, "base mint"),
      loadAccount(load, quoteMint, "quote mint"),
      loadAccount(load, baseVault, "base vault"),
      loadAccount(load, quoteVault, "quote vault"),
    ]);

    if (!hasDiscriminator(globalConfigData, GLOBAL_CONFIG_DISCRIMINATOR)) {
      throw new Error(`pumpswap global config ${GLOBAL_CONFIG} discriminator mismatch`);
    }
    // disable_flags (bit3 buy, bit4 sell) gate only the direction they disable.
    // fetchPoolConfig always returns direction 'quoteToBase' (the caller flips
    // it to 'baseToQuote' for sells), so gating a disabled buy HERE would drop
    // a pool that is still a perfectly valid sell venue. The check is deferred
    // to buildSwap, where the resolved direction is known.
    const disableFlags = globalConfigData[56];
    if (!hasDiscriminator(feeConfigData, FEE_CONFIG_DISCRIMINATOR)) {
      throw new Error(`pumpswap fee config ${FEE_CONFIG} discriminator mismatch`);
    }

    const baseTokenProgram = detectTokenProgram(baseMint, baseMintData);
    const quoteTokenProgram = detectTokenProgram(quoteMint, quoteMintData);

    // Canonical pump pools (creator == the bonding curve's pool-authority PDA
    // for the base mint) pay the market-cap fee tier; everything else pays
    // flat_fees (docs/svm-venues.md fee selection).
    const encoder = getAddressEncoder();
    const poolAuthority = await pda(
      ["pool-authority", new Uint8Array(encoder.encode(baseMint))],
      PUMP_BONDING_PROGRAM,
    );
    const canonical = creator === poolAuthority;

    let lpFeeBps: bigint;
    let protocolFeeBps: bigint;
    let creatorFeeBps: bigint;
    if (canonical) {
      const tiers = parseFeeTiers(feeConfigData);
      if (tiers.length === 0) throw new Error(`pumpswap fee config ${FEE_CONFIG} has no fee tiers`);
      const baseReserve = readUintLE(baseVaultData, 64, 8);
      const quoteReserve = readUintLE(quoteVaultData, 64, 8);
      const baseMintSupply = readUintLE(baseMintData, 36, 8);
      if (baseReserve === 0n) {
        throw new Error(
          `pumpswap pool ${pool} base vault is empty, cannot compute the market-cap fee tier`,
        );
      }
      const marketCap = (quoteReserve * baseMintSupply) / baseReserve;
      const tier = pickFeeTier(tiers, marketCap);
      lpFeeBps = tier.lpFeeBps;
      protocolFeeBps = tier.protocolFeeBps;
      creatorFeeBps = tier.creatorFeeBps;
    } else {
      lpFeeBps = readUintLE(feeConfigData, 41, 8);
      protocolFeeBps = readUintLE(feeConfigData, 49, 8);
      creatorFeeBps = readUintLE(feeConfigData, 57, 8);
    }
    if (coinCreator === DEFAULT_PUBKEY) creatorFeeBps = 0n;

    const protocolFeeRecipient = pubkeyAt(globalConfigData, 57);
    const buybackFeeRecipient = pubkeyAt(globalConfigData, 643);
    const coinCreatorVaultAuthority = await pda(
      ["creator_vault", new Uint8Array(encoder.encode(coinCreator))],
      PUMPSWAP_PROGRAM_ID,
    );
    const [
      protocolFeeRecipientTokenAccount,
      coinCreatorVaultAta,
      buybackFeeRecipientTokenAccount,
      poolV2,
    ] = await Promise.all([
      ata(protocolFeeRecipient, quoteMint, quoteTokenProgram),
      ata(coinCreatorVaultAuthority, quoteMint, quoteTokenProgram),
      ata(buybackFeeRecipient, quoteMint, quoteTokenProgram),
      coinCreator === DEFAULT_PUBKEY
        ? Promise.resolve(undefined)
        : pda(["pool-v2", new Uint8Array(encoder.encode(baseMint))], PUMPSWAP_PROGRAM_ID),
    ]);

    return {
      venue: "pumpswap",
      pool,
      direction: "quoteToBase",
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
      baseTokenProgram,
      quoteTokenProgram,
      coinCreator,
      canonical,
      lpFeeBps,
      protocolFeeBps,
      creatorFeeBps,
      disableFlags,
      protocolFeeRecipient,
      protocolFeeRecipientTokenAccount,
      coinCreatorVaultAuthority,
      coinCreatorVaultAta,
      poolV2,
      buybackFeeRecipient,
      buybackFeeRecipientTokenAccount,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = asPumpswapConfig(cfg);
    return [
      { ref: c.baseVault, address: c.baseVault },
      { ref: c.quoteVault, address: c.quoteVault },
    ];
  },

  emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string {
    const c = asPumpswapConfig(cfg);
    checkAmountIn(amountIn);
    // Account model (RS/svm target): the fragment reads through main()'s ordered
    // `Account` params, not `accountUint("<address>", …)` string refs. Param `acc<k>`
    // is `quoteAccounts()[k]` — base vault is slot 0, quote vault slot 1 — so the
    // emitted manifest slots come back in that order. `accountUint` lowered to CAST_LE,
    // so `svm.sload(…).toLe()` is the exact endianness match (SPL amount@64 is u64 LE).
    const lines = [
      `  const psBase${i} = svm.sload(acc0, 64, 8).toLe();`,
      `  const psQuote${i} = svm.sload(acc1, 64, 8).toLe();`,
    ];
    if (c.direction === "quoteToBase") {
      // The fee arithmetic only involves compile-time constants, so it folds
      // off-chain and the live quote is one invariant division over the
      // reserves (with the on-chain effQ - 1, docs/svm-venues.md buy formula).
      const inAmount =
        buyEffectiveQuoteIn(amountIn, c.lpFeeBps, c.protocolFeeBps, c.creatorFeeBps) - 1n;
      lines.push(
        `  const q${i} = Math.mulDiv(psBase${i}, ${inAmount}, psQuote${i} + ${inAmount});`,
      );
    } else {
      // sell: fees are per-component ceilDiv on the OUTPUT, so they need the
      // live quoteOut; ceilDiv(x * bps, 10000) == (x * bps + 9999) / 10000.
      lines.push(
        `  const psOut${i} = Math.mulDiv(psQuote${i}, ${amountIn}, psBase${i} + ${amountIn});`,
      );
      const feeTerms = [c.lpFeeBps, c.protocolFeeBps, c.creatorFeeBps]
        .filter((bps) => bps > 0n)
        .map((bps) => ` - (psOut${i} * ${bps} + 9999) / 10000`)
        .join("");
      lines.push(`  const q${i} = psOut${i}${feeTerms};`);
    }
    return lines.join("\n");
  },

  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = asPumpswapConfig(cfg);
    checkAmountIn(amountIn);
    const sell = c.direction === "baseToQuote";
    // Gate only the resolved direction: bit3 disables buys, bit4 disables sells.
    const disabled = sell ? c.disableFlags & (1 << 4) : c.disableFlags & (1 << 3);
    if (disabled !== 0) {
      throw new Error(
        `pumpswap gate: ${sell ? "sells" : "buys"} are disabled (global config disable_flags ${c.disableFlags})`,
      );
    }

    // buy_exact_quote_in: disc + spendable_quote_in u64 + min_base_amount_out
    // u64 + track_volume OptionBool (1 byte, 0x00 = false) = 25 bytes.
    // sell: disc + base_amount_in u64 + min_quote_amount_out u64 = 24 bytes.
    // min_out is 1 — the recipe's post-swap delta check enforces the bound.
    const data = new Uint8Array(sell ? 24 : 25);
    data.set(sell ? SELL_DISCRIMINATOR : BUY_EXACT_QUOTE_IN_DISCRIMINATOR, 0);
    writeU64LE(data, 8, amountIn);
    writeU64LE(data, 16, 1n);

    // buy receives base, sell receives quote.
    const userBaseAta = sell ? user.inAta : user.outAta;
    const userQuoteAta = sell ? user.outAta : user.inAta;
    const accounts: VenueAccount[] = [
      writable(c.pool),
      { ref: user.owner, writable: true, signer: true },
      readonly(GLOBAL_CONFIG),
      readonly(c.baseMint),
      readonly(c.quoteMint),
      { ref: userBaseAta, writable: true },
      { ref: userQuoteAta, writable: true },
      writable(c.baseVault),
      writable(c.quoteVault),
      readonly(c.protocolFeeRecipient),
      writable(c.protocolFeeRecipientTokenAccount),
      readonly(c.baseTokenProgram),
      readonly(c.quoteTokenProgram),
      readonly(SYSTEM_PROGRAM),
      readonly(ASSOCIATED_TOKEN_PROGRAM),
      readonly(EVENT_AUTHORITY),
      readonly(PUMPSWAP_PROGRAM_ID),
      writable(c.coinCreatorVaultAta),
      readonly(c.coinCreatorVaultAuthority),
    ];
    if (!sell) {
      accounts.push(readonly(GLOBAL_VOLUME_ACCUMULATOR));
      accounts.push({ ref: USER_VOLUME_ACCUMULATOR_REF, writable: true });
    }
    accounts.push(readonly(FEE_CONFIG), readonly(FEE_PROGRAM));
    // Remaining accounts (order per docs/svm-venues.md): pool-v2 PDA when a coin creator
    // is set, then ALWAYS the buyback recipient pair (error 6058 otherwise).
    if (c.poolV2 !== undefined) accounts.push(readonly(c.poolV2));
    accounts.push(readonly(c.buybackFeeRecipient), writable(c.buybackFeeRecipientTokenAccount));

    return { programId: PUMPSWAP_PROGRAM_ID, data, accounts };
  },

  // Written from the docs/svm-venues.md quote formulas (buy and sell),
  // deliberately NOT sharing the emitQuote fold above so the two stay
  // independently derived.
  referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, _now: bigint): bigint {
    const c = asPumpswapConfig(cfg);
    checkAmountIn(amountIn);
    const baseVaultData = state[c.baseVault];
    const quoteVaultData = state[c.quoteVault];
    if (baseVaultData === undefined)
      throw new Error(`pumpswap referenceQuote is missing base vault ${c.baseVault} in state`);
    if (quoteVaultData === undefined)
      throw new Error(`pumpswap referenceQuote is missing quote vault ${c.quoteVault} in state`);
    const baseReserve = readUintLE(baseVaultData, 64, 8);
    const quoteReserve = readUintLE(quoteVaultData, 64, 8);

    if (c.direction === "quoteToBase") {
      // effQ = floor(spendable * 10000 / (10000 + totalFeeBps)); each fee
      // component ceil-rounded separately; shrink effQ by any over-budget;
      // baseOut = floor(B * (effQ - 1) / (Q + (effQ - 1))).
      const totalFeeBps = c.lpFeeBps + c.protocolFeeBps + c.creatorFeeBps;
      let eff = (amountIn * BPS) / (BPS + totalFeeBps);
      const fees =
        ceilDiv(eff * c.lpFeeBps, BPS) +
        ceilDiv(eff * c.protocolFeeBps, BPS) +
        ceilDiv(eff * c.creatorFeeBps, BPS);
      const over = eff + fees - amountIn;
      if (over > 0n) eff -= over;
      if (eff < 2n)
        throw new Error(
          `pumpswap quote amountIn ${amountIn} is too small (effective quote input below 2)`,
        );
      const inAmount = eff - 1n;
      return (baseReserve * inAmount) / (quoteReserve + inAmount);
    }

    // sell: quoteOut = floor(Q * baseIn / (B + baseIn)); user receives
    // quoteOut minus each fee component ceil-rounded separately.
    const quoteOut = (quoteReserve * amountIn) / (baseReserve + amountIn);
    return (
      quoteOut -
      ceilDiv(quoteOut * c.lpFeeBps, BPS) -
      ceilDiv(quoteOut * c.protocolFeeBps, BPS) -
      ceilDiv(quoteOut * c.creatorFeeBps, BPS)
    );
  },
} satisfies SvmVenueAdapter;
