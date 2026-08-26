/**
 * Raydium CP-Swap (CPMM, non-OpenBook constant product) venue adapter.
 *
 * Byte layout, quote recipe and swap encoding follow docs/svm-venues.md,
 * source-verified for program CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C (raydium-cp-swap
 * commit 78f254e): reserves are the SPL vault balances minus the PoolState
 * protocol/fund/creator fee accumulators, trade_fee_rate and creator_fee_rate
 * come from AmmConfig (/1e6, ceil on the fee), and the creator fee lands on the
 * input or output side per PoolState.creator_fee_on. Pools created before the
 * creator-fee upgrade carry zeroed creator fields, so the unified formula is
 * safe everywhere.
 *
 * Overflow bound: every product is (u64 amount) * (u64 reserve or 1e6 rate),
 * < 2^128 — far below both the engine's 256-bit wrap point and Number/bigint
 * precision concerns, matching the program's own u128 curve math.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { ceilDiv, readUintLE } from '../math.js';
import { parseMintExtensions } from '../../token-extensions.js';
import type {
  AccountBytesMap,
  AccountLoader,
  PoolConfig,
  SvmVenueAdapter,
  SwapUser,
  VenueAccount,
  VenueSwap,
} from '../types.js';

const SLUG = 'raydium-cp-swap';
const PROGRAM_ID = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
/** PDA ["vault_and_lp_mint_auth_seed"] — vault and lp-mint authority. */
const AUTHORITY = 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// sha256("account:PoolState")[0..8] / sha256("account:AmmConfig")[0..8].
const POOL_STATE_DISCRIMINATOR = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];
const AMM_CONFIG_DISCRIMINATOR = [0xda, 0xf4, 0x21, 0x68, 0xcb, 0xcb, 0x2b, 0x6f];
// sha256("global:swap_base_input")[0..8].
const SWAP_BASE_INPUT_DISCRIMINATOR = [143, 190, 90, 218, 196, 30, 51, 222];

const POOL_STATE_SIZE = 637;
const AMM_CONFIG_SIZE = 236;

/** Fee rates are parts-per-million of amount (trade) or output (creator-on-output). */
const FEE_RATE_DENOMINATOR = 1_000_000n;

// PoolState offsets (repr(C, packed), byte sums over the declared field order).
const POOL_OFFSETS = {
  ammConfig: 8,
  token0Vault: 72,
  token1Vault: 104,
  token0Mint: 168,
  token1Mint: 200,
  token0Program: 232,
  token1Program: 264,
  observationKey: 296,
  status: 329,
  protocolFeesToken0: 341,
  protocolFeesToken1: 349,
  fundFeesToken0: 357,
  fundFeesToken1: 365,
  openTime: 373,
  creatorFeeOn: 389,
  enableCreatorFee: 390,
  creatorFeesToken0: 397,
  creatorFeesToken1: 405,
} as const;

// AmmConfig offsets (borsh, declared field order).
const CONFIG_OFFSETS = { tradeFeeRate: 12, creatorFeeRate: 108 } as const;

/** SPL token account (Tokenkeg and Token-2022): mint @0, amount u64 LE @64. */
const VAULT_MINT_OFFSET = 0;
const VAULT_AMOUNT_OFFSET = 64;

export interface RaydiumCpSwapPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  ammConfig: Address;
  token0Vault: Address;
  token1Vault: Address;
  token0Mint: Address;
  token1Mint: Address;
  token0Program: Address;
  token1Program: Address;
  observation: Address;
  /** Bitfield; bit2 (value 4) = swap disabled. Gated at fetch time. */
  status: number;
  /** Unix seconds; the program rejects swaps while now < openTime. */
  openTime: bigint;
  /** 0 = BothToken (creator fee on input), 1 = OnlyToken0, 2 = OnlyToken1. */
  creatorFeeOn: number;
  /** When false the effective creator fee rate is 0 regardless of AmmConfig. */
  enableCreatorFee: boolean;
  /** AmmConfig.trade_fee_rate, parts per 1e6 of amount_in (snapshot; the quote re-reads it live). */
  tradeFeeRate: bigint;
  /** AmmConfig.creator_fee_rate, parts per 1e6 (snapshot; the quote re-reads it live). */
  creatorFeeRate: bigint;
  /** Swap direction: true = ZeroForOne (token_0 in, token_1 out). fetchPoolConfig defaults to true; flip for the reverse direction. */
  inputIsToken0: boolean;
}

function cpConfig(cfg: PoolConfig): RaydiumCpSwapPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`raydium-cp-swap adapter got a '${cfg.venue}' pool config`);
  return cfg as RaydiumCpSwapPoolConfig;
}

/**
 * Token-2022 mint TLV scan for the TransferFeeConfig extension (type 1): a
 * transfer-fee mint changes wire amounts on both swap legs, so such pools are
 * out of scope. Layout: 82-byte base mint padded to 165, account-type byte at
 * 165 (1 = Mint), then repeated [type u16 LE, length u16 LE, value] entries.
 */
function hasTransferFeeExtension(mint: Uint8Array): boolean {
  if (mint.length <= 165) return false;
  let offset = 166;
  while (offset + 4 <= mint.length) {
    const type = mint[offset] | (mint[offset + 1] << 8);
    if (type === 0) break; // Uninitialized — trailing padding
    if (type === 1) return true; // TransferFeeConfig
    const length = mint[offset + 2] | (mint[offset + 3] << 8);
    offset += 4 + length;
  }
  return false;
}

function requireU64Amount(amountIn: bigint): void {
  if (amountIn <= 0n || amountIn >= 1n << 64n) {
    throw new Error(`raydium-cp-swap amountIn must be a positive u64, got ${amountIn}`);
  }
}

function u64le(value: bigint): number[] {
  const bytes: number[] = [];
  for (let i = 0n; i < 8n; i++) bytes.push(Number((value >> (8n * i)) & 0xffn));
  return bytes;
}

/** Input-side vs output-side account/offset selection for one direction. */
function sides(cfg: RaydiumCpSwapPoolConfig) {
  const token0 = {
    vault: cfg.token0Vault,
    mint: cfg.token0Mint,
    program: cfg.token0Program,
    protocolFees: POOL_OFFSETS.protocolFeesToken0,
    fundFees: POOL_OFFSETS.fundFeesToken0,
    creatorFees: POOL_OFFSETS.creatorFeesToken0,
  };
  const token1 = {
    vault: cfg.token1Vault,
    mint: cfg.token1Mint,
    program: cfg.token1Program,
    protocolFees: POOL_OFFSETS.protocolFeesToken1,
    fundFees: POOL_OFFSETS.fundFeesToken1,
    creatorFees: POOL_OFFSETS.creatorFeesToken1,
  };
  return cfg.inputIsToken0 ? { input: token0, output: token1 } : { input: token1, output: token0 };
}

/** creator_fee_on semantics: 0 = both tokens (always on input), 1 = only token_0, 2 = only token_1. */
function creatorFeeOnInput(cfg: RaydiumCpSwapPoolConfig): boolean {
  return (
    cfg.creatorFeeOn === 0 ||
    (cfg.creatorFeeOn === 1 && cfg.inputIsToken0) ||
    (cfg.creatorFeeOn === 2 && !cfg.inputIsToken0)
  );
}

export const raydiumCpSwap = {
  slug: SLUG,
  kind: 'constant-product',
  programId: address(PROGRAM_ID),

  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<RaydiumCpSwapPoolConfig> {
    const codec = getAddressCodec();
    const pubkey = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

    const data = await load(pool);
    if (data === null) throw new Error(`raydium-cp-swap pool ${pool} not found`);
    if (data.length !== POOL_STATE_SIZE) {
      throw new Error(`raydium-cp-swap pool ${pool} data is ${data.length} bytes, expected ${POOL_STATE_SIZE}`);
    }
    for (let i = 0; i < 8; i++) {
      if (data[i] !== POOL_STATE_DISCRIMINATOR[i]) {
        throw new Error(`raydium-cp-swap pool ${pool} has a wrong discriminator (not a PoolState account)`);
      }
    }

    const status = Number(readUintLE(data, POOL_OFFSETS.status, 1));
    if ((status & 4) !== 0) {
      throw new Error(`raydium-cp-swap pool ${pool} swap is disabled (status ${status} has bit 2 set)`);
    }
    const openTime = readUintLE(data, POOL_OFFSETS.openTime, 8);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < openTime) {
      throw new Error(`raydium-cp-swap pool ${pool} is not open yet (open_time ${openTime}, now ${now})`);
    }

    const ammConfig = pubkey(data, POOL_OFFSETS.ammConfig);
    const configData = await load(ammConfig);
    if (configData === null) throw new Error(`raydium-cp-swap amm config ${ammConfig} not found`);
    if (configData.length !== AMM_CONFIG_SIZE) {
      throw new Error(`raydium-cp-swap amm config ${ammConfig} data is ${configData.length} bytes, expected ${AMM_CONFIG_SIZE}`);
    }
    for (let i = 0; i < 8; i++) {
      if (configData[i] !== AMM_CONFIG_DISCRIMINATOR[i]) {
        throw new Error(`raydium-cp-swap amm config ${ammConfig} has a wrong discriminator (not an AmmConfig account)`);
      }
    }

    const cfg: RaydiumCpSwapPoolConfig = {
      venue: SLUG,
      pool,
      ammConfig,
      token0Vault: pubkey(data, POOL_OFFSETS.token0Vault),
      token1Vault: pubkey(data, POOL_OFFSETS.token1Vault),
      token0Mint: pubkey(data, POOL_OFFSETS.token0Mint),
      token1Mint: pubkey(data, POOL_OFFSETS.token1Mint),
      token0Program: pubkey(data, POOL_OFFSETS.token0Program),
      token1Program: pubkey(data, POOL_OFFSETS.token1Program),
      observation: pubkey(data, POOL_OFFSETS.observationKey),
      status,
      openTime,
      creatorFeeOn: Number(readUintLE(data, POOL_OFFSETS.creatorFeeOn, 1)),
      enableCreatorFee: readUintLE(data, POOL_OFFSETS.enableCreatorFee, 1) !== 0n,
      tradeFeeRate: readUintLE(configData, CONFIG_OFFSETS.tradeFeeRate, 8),
      creatorFeeRate: readUintLE(configData, CONFIG_OFFSETS.creatorFeeRate, 8),
      inputIsToken0: true,
    };

    // Vault integrity: each pool vault must exist and hold the declared mint.
    const vaultPairs = [
      [cfg.token0Vault, cfg.token0Mint],
      [cfg.token1Vault, cfg.token1Mint],
    ] as const;
    const vaultDatas = await Promise.all(vaultPairs.map(([vault]) => load(vault)));
    for (let vi = 0; vi < vaultPairs.length; vi++) {
      const [vault, mint] = vaultPairs[vi]!;
      const vaultData = vaultDatas[vi]!;
      if (vaultData === null) throw new Error(`raydium-cp-swap vault ${vault} not found`);
      if (vaultData.length < VAULT_AMOUNT_OFFSET + 8) {
        throw new Error(`raydium-cp-swap vault ${vault} data is ${vaultData.length} bytes, expected an SPL token account`);
      }
      const vaultMint = pubkey(vaultData, VAULT_MINT_OFFSET);
      if (vaultMint !== mint) {
        throw new Error(`raydium-cp-swap vault ${vault} holds mint ${vaultMint}, expected ${mint}`);
      }
    }

    // Token-2022 transfer-fee gate: a transfer-fee extension on either mint
    // changes wire amounts on that leg, so the classic quote formula is wrong.
    const t22Entries = [
      [cfg.token0Program, cfg.token0Mint, 'token_0'],
      [cfg.token1Program, cfg.token1Mint, 'token_1'],
    ] as const;
    // Only Token-2022 mints are actually read; a legacy (Tokenkeg) leg issues no
    // load, so pre-loading never adds an RPC — it only coalesces the two-T22 case.
    const t22MintDatas = await Promise.all(
      t22Entries.map(([program, mint]) => (program === TOKEN_2022_PROGRAM ? load(mint) : Promise.resolve(null))),
    );
    for (let ti = 0; ti < t22Entries.length; ti++) {
      const [program, mint, side] = t22Entries[ti]!;
      if (program !== TOKEN_2022_PROGRAM) continue;
      const mintData = t22MintDatas[ti]!;
      if (mintData === null) {
        throw new Error(`raydium-cp-swap ${side} mint ${mint} is token-2022 but could not be loaded to check transfer-fee extensions`);
      }
      // Un-routable (blocking) extensions self-drop: a NonTransferable or
      // default-frozen mint cannot move through a plain transferChecked.
      // Advisory extensions (PermanentDelegate / ConfidentialTransfer) are NOT
      // blocking, so a zero-fee/advisory-only T22 mint still routes.
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(`raydium-cp-swap ${side} mint ${mint} is un-routable: ${blocking.join('; ')}`);
      }
      if (hasTransferFeeExtension(mintData)) {
        // TODO(t22-fee-netting): raydium-cp-swap's program deducts the input
        // transfer fee before the trade fee/curve and nets the output transfer
        // fee, so this is a determinable two-leg net (net(amountIn) into the
        // curve, net(grossOut) to the user). It is left as a rejection because
        // netting only referenceQuote would desync it from the un-netted
        // on-chain election fragment (emitQuote), and netting emitQuote too
        // needs the mint's fee TLV read on-chain plus the current Solana epoch
        // to pick the active fee schedule — out of scope for this pass. Keep
        // the safe self-limiting rejection rather than risk a favourable
        // mis-quote.
        throw new Error(`raydium-cp-swap ${side} mint ${mint} has a token-2022 transfer-fee extension (wire amounts diverge from the quote)`);
      }
    }

    return cfg;
  },

  quoteAccounts(base: PoolConfig): VenueAccount[] {
    const cfg = cpConfig(base);
    // Refs are the base58 addresses themselves: unique across pools and venues,
    // and shared reads (e.g. two pools on one AmmConfig) dedupe in the plan.
    return [
      { ref: cfg.pool, address: cfg.pool },
      { ref: cfg.ammConfig, address: cfg.ammConfig },
      { ref: cfg.token0Vault, address: cfg.token0Vault },
      { ref: cfg.token1Vault, address: cfg.token1Vault },
    ];
  },

  emitQuote(base: PoolConfig, i: number, amountIn: bigint): string {
    const cfg = cpConfig(base);
    requireU64Amount(amountIn);

    const { input, output } = sides(cfg);
    const pool = JSON.stringify(cfg.pool);
    const config = JSON.stringify(cfg.ammConfig);
    const reserve = (side: typeof input, name: string) =>
      `  const ${name}${i} = accountUint(${JSON.stringify(side.vault)}, ${VAULT_AMOUNT_OFFSET}, 8)` +
      ` - accountUint(${pool}, ${side.protocolFees}, 8)` +
      ` - accountUint(${pool}, ${side.fundFees}, 8)` +
      ` - accountUint(${pool}, ${side.creatorFees}, 8);`;

    // Fee rates are admin-mutable (update_amm_config), so they are read live
    // from AmmConfig; creator_fee_on/enable_creator_fee are pool-creation-time
    // constants, so the fee-side branch is resolved at generation time.
    const tradeRate = `accountUint(${config}, ${CONFIG_OFFSETS.tradeFeeRate}, 8)`;
    const creatorRate = `accountUint(${config}, ${CONFIG_OFFSETS.creatorFeeRate}, 8)`;
    const ceil = (product: string) => `(${product} + ${FEE_RATE_DENOMINATOR - 1n}) / ${FEE_RATE_DENOMINATOR}`;

    const lines = [reserve(input, 'rin'), reserve(output, 'rout')];
    if (creatorFeeOnInput(cfg)) {
      // total_fee = ceil(amount_in * (trade_fee_rate + creator_fee_rate_eff) / 1e6), then x*y curve.
      const rate = cfg.enableCreatorFee ? `(${tradeRate} + ${creatorRate})` : tradeRate;
      lines.push(
        `  const fee${i} = ${ceil(`${amountIn} * ${rate}`)};`,
        `  const net${i} = ${amountIn} - fee${i};`,
        `  const q${i} = Math.mulDiv(net${i}, rout${i}, rin${i} + net${i});`,
      );
    } else {
      // trade fee on input, creator fee ceil'd out of the swapped output.
      lines.push(
        `  const fee${i} = ${ceil(`${amountIn} * ${tradeRate}`)};`,
        `  const net${i} = ${amountIn} - fee${i};`,
        `  const os${i} = Math.mulDiv(net${i}, rout${i}, rin${i} + net${i});`,
        `  const q${i} = os${i} - ${cfg.enableCreatorFee ? `(${ceil(`os${i} * ${creatorRate}`)})` : '0'};`,
      );
    }
    return lines.join('\n');
  },

  buildSwap(base: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const cfg = cpConfig(base);
    requireU64Amount(amountIn);
    const { input, output } = sides(cfg);

    // swap_base_input: disc(8) + amount_in u64 LE + minimum_amount_out u64 LE.
    // min_out is 1 — the recipe's post-swap outAta delta check enforces the
    // real bound (and 1 keeps the no-explicit-zero-output-check quirk closed).
    const data = Uint8Array.from([...SWAP_BASE_INPUT_DISCRIMINATOR, ...u64le(amountIn), ...u64le(1n)]);

    const fixed = (address: Address, writable?: boolean): VenueAccount =>
      writable ? { ref: address, address, writable: true } : { ref: address, address };
    return {
      programId: address(PROGRAM_ID),
      data,
      accounts: [
        { ref: user.owner, signer: true },
        fixed(address(AUTHORITY)),
        fixed(cfg.ammConfig),
        fixed(cfg.pool, true),
        { ref: user.inAta, writable: true },
        { ref: user.outAta, writable: true },
        fixed(input.vault, true),
        fixed(output.vault, true),
        fixed(input.program),
        fixed(output.program),
        fixed(input.mint),
        fixed(output.mint),
        fixed(cfg.observation, true),
      ],
    };
  },

  referenceQuote(base: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint {
    const cfg = cpConfig(base);
    requireU64Amount(amountIn);

    const bytes = (address: Address): Uint8Array => {
      const data = state[address];
      if (data === undefined) throw new Error(`raydium-cp-swap referenceQuote is missing account ${address}`);
      return data;
    };
    const pool = bytes(cfg.pool);
    const config = bytes(cfg.ammConfig);

    // Live gates, mirroring the program: swap bit and open_time come from the
    // state snapshot, not from the (possibly older) fetched config.
    const status = Number(readUintLE(pool, POOL_OFFSETS.status, 1));
    if ((status & 4) !== 0) {
      throw new Error(`raydium-cp-swap pool ${cfg.pool} swap is disabled (status ${status} has bit 2 set)`);
    }
    const openTime = readUintLE(pool, POOL_OFFSETS.openTime, 8);
    if (now < openTime) {
      throw new Error(`raydium-cp-swap pool ${cfg.pool} is not open yet (open_time ${openTime}, now ${now})`);
    }

    // reserve_side = vault.amount - protocol_fees - fund_fees - creator_fees;
    // the program errors when a vault holds less than its accrued fees.
    const reserve = (vault: Address, protocolFees: number, fundFees: number, creatorFees: number): bigint => {
      const value =
        readUintLE(bytes(vault), VAULT_AMOUNT_OFFSET, 8) -
        readUintLE(pool, protocolFees, 8) -
        readUintLE(pool, fundFees, 8) -
        readUintLE(pool, creatorFees, 8);
      if (value < 0n) throw new Error(`raydium-cp-swap vault ${vault} balance is below its accrued fees`);
      return value;
    };
    const r0 = reserve(cfg.token0Vault, POOL_OFFSETS.protocolFeesToken0, POOL_OFFSETS.fundFeesToken0, POOL_OFFSETS.creatorFeesToken0);
    const r1 = reserve(cfg.token1Vault, POOL_OFFSETS.protocolFeesToken1, POOL_OFFSETS.fundFeesToken1, POOL_OFFSETS.creatorFeesToken1);
    const [reserveIn, reserveOut] = cfg.inputIsToken0 ? [r0, r1] : [r1, r0];

    const tradeFeeRate = readUintLE(config, CONFIG_OFFSETS.tradeFeeRate, 8);
    const enableCreatorFee = readUintLE(pool, POOL_OFFSETS.enableCreatorFee, 1) !== 0n;
    const creatorFeeRate = enableCreatorFee ? readUintLE(config, CONFIG_OFFSETS.creatorFeeRate, 8) : 0n;
    const creatorFeeOn = Number(readUintLE(pool, POOL_OFFSETS.creatorFeeOn, 1));
    const feeOnInput =
      creatorFeeOn === 0 ||
      (creatorFeeOn === 1 && cfg.inputIsToken0) ||
      (creatorFeeOn === 2 && !cfg.inputIsToken0);

    if (feeOnInput) {
      const totalFee = ceilDiv(amountIn * (tradeFeeRate + creatorFeeRate), FEE_RATE_DENOMINATOR);
      const net = amountIn - totalFee;
      return (net * reserveOut) / (reserveIn + net);
    }
    const tradeFee = ceilDiv(amountIn * tradeFeeRate, FEE_RATE_DENOMINATOR);
    const net = amountIn - tradeFee;
    const outSwapped = (net * reserveOut) / (reserveIn + net);
    return outSwapped - ceilDiv(outSwapped * creatorFeeRate, FEE_RATE_DENOMINATOR);
  },
} satisfies SvmVenueAdapter;
