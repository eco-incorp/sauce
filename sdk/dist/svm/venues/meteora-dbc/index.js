/**
 * Meteora Dynamic Bonding Curve (DBC) venue adapter.
 *
 * DBC is a permissionless bonding-curve launcher: a `VirtualPool` account
 * holds LIVE state (current sqrt_price, base/quote reserves, a volatility
 * tracker) while its paired `PoolConfig` account holds the IMMUTABLE curve
 * shape — up to 20 `LiquidityDistributionConfig` points, each
 * `{sqrt_price, liquidity}`, plus `sqrt_start_price` and `migration_sqrt_price`
 * — and the fee schedule (a base-fee scheduler, linear or exponential decay
 * over time, plus an optional volatility-based dynamic fee).
 *
 * MATH (verified against the program source, github.com/MeteoraAg/
 * dynamic-bonding-curve, and cross-checked lamport-for-lamport against the
 * official `@meteora-ag/dynamic-bonding-curve-sdk`'s `swapQuoteExactIn` on
 * REAL mainnet pool state — see the venue test for the worked examples):
 * each curve point is a Uniswap-v3-style constant-product BAND in Q64.64
 * sqrt-price space (`x*y = L^2`), walked from the live `sqrt_price` toward
 * the next boundary. `get_next_sqrt_price_from_{base,quote}_amount_in` and
 * `get_delta_amount_{base,quote}_unsigned` are the exact program formulas
 * (see ladder.ts's header for the closed forms this adapter/ladder use).
 *
 * SCOPE (this adapter quotes the SINGLE ACTIVE SEGMENT — the curve band
 * that contains the pool's LIVE sqrt_price at fetch time — and SATURATES
 * (never collapses) once a trade's capacity would cross into the next
 * segment; the same accepted capacity-clamp tradeoff every other windowed
 * SVM family in this repo already ships — orca-whirlpool / raydium-clmm /
 * meteora-dlmm / manifest / meteora-damm-v2). A trade that would need a
 * SECOND segment simply gets less output than the real curve could give
 * past this window, never more — see ladder.ts's capacityInputVar.
 *
 * GATED OUT (self-drop at fetchPoolConfig, never a crash, never a whole-cook
 * failure — one venue's scope limit never kills a cook):
 * - `is_migrated != 0` (already graduated to DAMM — trade the migrated pool
 *   as meteora-damm-v2/meteora-damm-v1-stable instead) or the curve is
 *   already complete (`quote_reserve >= migration_quote_threshold`, or the
 *   live sqrt_price is already at/past `migration_sqrt_price` — nothing left
 *   to buy).
 * - `base_fee_mode == RateLimiter` (2): an amount-dependent, quadratic fee
 *   curve requiring a `sqrt` to invert from excluded amount — out of scope
 *   for THIS pass (mirrors the precedent every other family sets: quote what
 *   is cleanly closed-form, gate the exotic variant — meteora-damm-v2
 *   rejects rate-limiter/scheduled fees entirely for the same reason).
 * - A fee-scheduler in force (`period_frequency != 0`) on a SLOT-typed
 *   `activation_type` (0): a slot number is not live-readable in-VM (no
 *   `block.slot` — only `ctx.timestamp()`), the SAME gate meteora-damm-v2
 *   already applies to slot-typed activation points.
 * - Either mint is Token-2022 with a transfer-fee extension (wire amounts
 *   would desync from the curve math) — the same `assertNoTransferFee` TLV
 *   scan every Token-2022-capable family in this repo already runs.
 * - A `TransferHookPool`-discriminator account (a DIFFERENT Anchor account
 *   type sharing PoolState's byte layout but requiring extra transfer-hook
 *   remaining-accounts this adapter does not model) fails the VirtualPool
 *   discriminator check and is dropped like any other decode failure.
 *
 * Byte offsets below were computed from the Rust `#[account(zero_copy)]`
 * struct field order (SBF target: `u128` aligns to 8, not 16 — confirmed by
 * matching the program's own `const_assert_eq!(PoolState::INIT_SPACE, 416)` /
 * `const_assert_eq!(PoolConfig::INIT_SPACE, 1040)` exactly) and then
 * VALIDATED against real mainnet account dumps (discriminators match, and
 * the known offsets --- base_mint@136, base_vault@168, quote_vault@200,
 * base_reserve@232, quote_reserve@240 on VirtualPool; quote_mint@8,
 * token_decimal@235 on PoolConfig --- land exactly where the const_assert
 * arithmetic predicts).
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
  */
import { address, getAddressCodec } from '@solana/kit';
import { ceilDiv, readUintLE } from '../math.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'meteora-dbc';
export const METEORA_DBC_PROGRAM_ID = address('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
/** Constant PDA ['pool_authority'] — owner-authority of both vaults (verified against the official SDK's hardcoded constant). */
export const METEORA_DBC_POOL_AUTHORITY = address('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
/** Constant PDA ['__event_authority'] (Anchor `#[event_cpi]`). */
export const METEORA_DBC_EVENT_AUTHORITY = address('8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const POOL_ACCOUNT_SIZE = 424;
const CONFIG_ACCOUNT_SIZE = 1048;
/** sha256('account:VirtualPool')[0..8]. */
const POOL_DISCRIMINATOR = [0xd5, 0xe0, 0x05, 0xd1, 0x62, 0x45, 0x77, 0x5c];
/** sha256('account:PoolConfig')[0..8]. */
const CONFIG_DISCRIMINATOR = [0x1a, 0x6c, 0x0e, 0x7b, 0x74, 0xe6, 0x81, 0x2b];
/** sha256('global:swap')[0..8]. */
export const METEORA_DBC_SWAP_DISCRIMINATOR = [248, 198, 158, 145, 225, 117, 135, 200];
const MAX_CURVE_POINTS = 20;
const CURVE_POINT_SIZE = 32;
const Q128 = 1n << 128n;
export const METEORA_DBC_FEE_DENOMINATOR = 1000000000n;
export const METEORA_DBC_MAX_FEE_NUMERATOR = 990000000n;
const U64_MAX = (1n << 64n) - 1n;
// VirtualPool (PoolState) offsets — see the file header derivation.
const OFF_VOL_ACCUMULATOR = 40; // u128 (VolatilityTracker.volatility_accumulator)
const OFF_CONFIG_PTR = 72; // Pubkey
const OFF_BASE_MINT = 136; // Pubkey
const OFF_BASE_VAULT = 168; // Pubkey
const OFF_QUOTE_VAULT = 200; // Pubkey
const OFF_BASE_RESERVE = 232; // u64
const OFF_QUOTE_RESERVE = 240; // u64
const OFF_SQRT_PRICE = 280; // u128
const OFF_ACTIVATION_POINT = 296; // u64
const OFF_IS_MIGRATED = 305; // u8
// PoolConfig offsets — see the file header derivation.
const OFF_QUOTE_MINT = 8; // Pubkey
const OFF_CLIFF_FEE_NUMERATOR = 104; // u64 (PoolFeesConfig.baseFee.cliffFeeNumerator)
const OFF_PERIOD_FREQUENCY = 112; // u64 (baseFee.secondFactor)
const OFF_REDUCTION_FACTOR = 120; // u64 (baseFee.thirdFactor)
const OFF_NUMBER_OF_PERIOD = 128; // u16 (baseFee.firstFactor)
const OFF_BASE_FEE_MODE = 130; // u8: 0 Linear, 1 Exponential, 2 RateLimiter
const OFF_DYN_INITIALIZED = 136; // u8
const OFF_DYN_VARIABLE_FEE_CONTROL = 148; // u32
const OFF_DYN_BIN_STEP = 152; // u16
const OFF_COLLECT_FEE_MODE = 232; // u8: 0 QuoteToken, 1 OutputToken
const OFF_ACTIVATION_TYPE = 234; // u8: 0 Slot, 1 Timestamp
const OFF_TOKEN_TYPE = 237; // u8: base mint token program flag (0 SPL, 1 Token-2022)
const OFF_QUOTE_TOKEN_FLAG = 238; // u8: quote mint token program flag
const OFF_MIGRATION_QUOTE_THRESHOLD = 264; // u64
const OFF_MIGRATION_SQRT_PRICE = 280; // u128
const OFF_SQRT_START_PRICE = 392; // u128
const OFF_CURVE = 408; // [{sqrtPrice: u128, liquidity: u128}; 20]
const codec = getAddressCodec();
const pubkeyAt = (data, offset) => codec.decode(data.subarray(offset, offset + 32));
function decodePool(pool, data) {
    if (data.length !== POOL_ACCOUNT_SIZE) {
        throw new Error(`meteora-dbc pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
    }
    if (!POOL_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
        throw new Error(`meteora-dbc pool ${pool} is not a VirtualPool account (discriminator mismatch)`);
    }
    return {
        config: pubkeyAt(data, OFF_CONFIG_PTR),
        baseMint: pubkeyAt(data, OFF_BASE_MINT),
        baseVault: pubkeyAt(data, OFF_BASE_VAULT),
        quoteVault: pubkeyAt(data, OFF_QUOTE_VAULT),
        sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
        baseReserve: readUintLE(data, OFF_BASE_RESERVE, 8),
        quoteReserve: readUintLE(data, OFF_QUOTE_RESERVE, 8),
        activationPoint: readUintLE(data, OFF_ACTIVATION_POINT, 8),
        volatilityAccumulator: readUintLE(data, OFF_VOL_ACCUMULATOR, 16),
        isMigrated: data[OFF_IS_MIGRATED],
    };
}
function decodeConfig(configAddr, data) {
    if (data.length !== CONFIG_ACCOUNT_SIZE) {
        throw new Error(`meteora-dbc config ${configAddr} account data is ${data.length} bytes, expected ${CONFIG_ACCOUNT_SIZE}`);
    }
    if (!CONFIG_DISCRIMINATOR.every((byte, i) => data[i] === byte)) {
        throw new Error(`meteora-dbc config ${configAddr} is not a PoolConfig account (discriminator mismatch)`);
    }
    const curve = [];
    for (let i = 0; i < MAX_CURVE_POINTS; i++) {
        const off = OFF_CURVE + CURVE_POINT_SIZE * i;
        const sqrtPrice = readUintLE(data, off, 16);
        const liquidity = readUintLE(data, off + 16, 16);
        if (sqrtPrice === 0n && liquidity === 0n)
            break;
        curve.push({ sqrtPrice, liquidity });
    }
    return {
        quoteMint: pubkeyAt(data, OFF_QUOTE_MINT),
        cliffFeeNumerator: readUintLE(data, OFF_CLIFF_FEE_NUMERATOR, 8),
        periodFrequency: readUintLE(data, OFF_PERIOD_FREQUENCY, 8),
        reductionFactor: readUintLE(data, OFF_REDUCTION_FACTOR, 8),
        numberOfPeriod: readUintLE(data, OFF_NUMBER_OF_PERIOD, 2),
        baseFeeMode: data[OFF_BASE_FEE_MODE],
        dynInitialized: data[OFF_DYN_INITIALIZED],
        variableFeeControl: readUintLE(data, OFF_DYN_VARIABLE_FEE_CONTROL, 4),
        binStep: readUintLE(data, OFF_DYN_BIN_STEP, 2),
        collectFeeMode: data[OFF_COLLECT_FEE_MODE],
        activationType: data[OFF_ACTIVATION_TYPE],
        tokenType: data[OFF_TOKEN_TYPE],
        quoteTokenFlag: data[OFF_QUOTE_TOKEN_FLAG],
        migrationQuoteThreshold: readUintLE(data, OFF_MIGRATION_QUOTE_THRESHOLD, 8),
        migrationSqrtPrice: readUintLE(data, OFF_MIGRATION_SQRT_PRICE, 16),
        sqrtStartPrice: readUintLE(data, OFF_SQRT_START_PRICE, 16),
        curve,
    };
}
/** Smallest k with sqrtPrice <= curve[k].sqrtPrice — the segment the live price currently sits in. -1 when price is at/past the last point (curve complete). */
function activeSegment(curve, sqrtPrice) {
    for (let k = 0; k < curve.length; k++) {
        if (sqrtPrice <= curve[k].sqrtPrice)
            return k;
    }
    return -1;
}
function tokenProgramFor(pool, side, flag) {
    if (flag === 0)
        return TOKEN_PROGRAM;
    if (flag === 1)
        return TOKEN_2022_PROGRAM;
    throw new Error(`meteora-dbc pool ${pool} ${side} token flag=${flag} is not a known token program flag`);
}
/**
 * Token-2022 mint routability gate (shared across every Token-2022-capable
 * family in this repo). A plain / advisory-only mint (PermanentDelegate,
 * ConfidentialTransfer — PYUSD/USDG carry these and trade fine) routes exactly
 * like a legacy mint. A NonTransferable / DefaultAccountState=frozen mint
 * genuinely cannot move through a plain transferChecked, so it self-drops. A
 * TransferFeeConfig mint is dropped (see the TODO) rather than netted.
 */
async function assertRoutableMint(load, pool, side, mint) {
    const data = await load(mint);
    if (data === null) {
        throw new Error(`meteora-dbc pool ${pool} ${side} mint ${mint} not found (required to inspect token-2022 extensions)`);
    }
    const ext = parseMintExtensions(data);
    if (ext.blocking.length > 0) {
        throw new Error(`meteora-dbc pool ${pool} ${side} mint ${mint} is un-routable: ${ext.blocking.join('; ')}`);
    }
    // TODO(t22-fee-netting): a fee-bearing mint is REJECTED, not netted. Netting
    // must be applied IDENTICALLY in referenceQuote AND the in-VM emitQuote
    // fragment (the triangle invariant this venue enforces), across the
    // epoch-scheduled, max_fee-capped spl-token-2022 fee curve — a materially
    // larger change deferred here. Dropping self-limits (safe), never over-quotes.
    if (ext.transferFee) {
        throw new Error(`meteora-dbc pool ${pool} ${side} mint ${mint} has a token-2022 transfer-fee extension`);
    }
}
function dbcConfig(cfg) {
    if (cfg.venue !== SLUG)
        throw new Error(`meteora-dbc adapter got a config for venue '${cfg.venue}'`);
    const c = cfg;
    if (c.direction !== 'quoteToBase' && c.direction !== 'baseToQuote') {
        throw new Error(`meteora-dbc direction must be 'quoteToBase' or 'baseToQuote', got '${c.direction}'`);
    }
    return c;
}
function checkAmountIn(construct, amountIn) {
    if (amountIn <= 0n || amountIn > U64_MAX) {
        throw new Error(`${construct} amountIn must be a positive u64, got ${amountIn}`);
    }
}
export const meteoraDbc = {
    slug: SLUG,
    kind: 'sqrt-price',
    programId: METEORA_DBC_PROGRAM_ID,
    /**
     * Off-chain gate + segment selection (named errors on every out-of-scope
     * variant — see the file header "GATED OUT" list).
     */
    async fetchPoolConfig(load, pool) {
        const poolData = await load(pool);
        if (poolData === null)
            throw new Error(`meteora-dbc pool ${pool} account not found`);
        const p = decodePool(pool, poolData);
        if (p.isMigrated !== 0) {
            throw new Error(`meteora-dbc pool ${pool} is already migrated (is_migrated=${p.isMigrated}) — trade the migrated venue instead`);
        }
        const configData = await load(p.config);
        if (configData === null)
            throw new Error(`meteora-dbc pool ${pool} config ${p.config} account not found`);
        const c = decodeConfig(p.config, configData);
        if (c.baseFeeMode >= 2) {
            throw new Error(`meteora-dbc pool ${pool} base_fee_mode=${c.baseFeeMode} (rate-limiter) is amount-dependent and not supported`);
        }
        if (c.periodFrequency !== 0n && c.activationType === 0) {
            throw new Error(`meteora-dbc pool ${pool} has an active slot-based fee scheduler (activation_type=Slot) — slot number is not live-readable in-VM`);
        }
        if (c.curve.length === 0) {
            throw new Error(`meteora-dbc pool ${pool} has no curve points configured`);
        }
        if (p.quoteReserve >= c.migrationQuoteThreshold) {
            throw new Error(`meteora-dbc pool ${pool} curve is already complete (quote_reserve ${p.quoteReserve} >= threshold ${c.migrationQuoteThreshold})`);
        }
        if (p.sqrtPrice >= c.migrationSqrtPrice) {
            throw new Error(`meteora-dbc pool ${pool} live sqrt_price is already at/past migration_sqrt_price — nothing left to buy`);
        }
        const segIdx = activeSegment(c.curve, p.sqrtPrice);
        if (segIdx < 0) {
            throw new Error(`meteora-dbc pool ${pool} live sqrt_price ${p.sqrtPrice} is past every configured curve point`);
        }
        const tokenBaseProgram = tokenProgramFor(pool, 'base', c.tokenType);
        const tokenQuoteProgram = tokenProgramFor(pool, 'quote', c.quoteTokenFlag);
        if (c.tokenType === 1)
            await assertRoutableMint(load, pool, 'base', p.baseMint);
        if (c.quoteTokenFlag === 1)
            await assertRoutableMint(load, pool, 'quote', c.quoteMint);
        return {
            venue: SLUG,
            pool,
            direction: 'quoteToBase',
            config: p.config,
            baseMint: p.baseMint,
            quoteMint: c.quoteMint,
            baseVault: p.baseVault,
            quoteVault: p.quoteVault,
            tokenBaseProgram,
            tokenQuoteProgram,
            segIdx,
            curveLength: c.curve.length,
        };
    },
    quoteAccounts(cfg) {
        const c = dbcConfig(cfg);
        return [
            { ref: c.pool, address: c.pool },
            { ref: c.config, address: c.config },
        ];
    },
    /** v1 (amount-baked) quote fragment — the closed-form single-segment CP math (see ladder.ts for the parametric/live-read version this mirrors). */
    emitQuote(cfg, i, amountIn) {
        const c = dbcConfig(cfg);
        if (!Number.isInteger(i) || i < 0)
            throw new Error(`meteora-dbc emitQuote index must be a non-negative integer, got ${i}`);
        checkAmountIn('meteora-dbc emitQuote', amountIn);
        // Account model (RS/svm target): quoteAccounts() attaches [pool, config], so
        // the pool binds to main()'s acc0 and the config to acc1; every read is
        // svm.sload(acc<k>, off, w).toLe() (accountUint lowered to CAST_LE — .toLe()
        // is the exact endianness match), and block.timestamp becomes ctx.timestamp().
        const poolU = (off, w) => `svm.sload(acc0, ${off}, ${w}).toLe()`;
        const cfgU = (off, w) => `svm.sload(acc1, ${off}, ${w}).toLe()`;
        const upperOff = OFF_CURVE + CURVE_POINT_SIZE * c.segIdx;
        const lowerOff = c.segIdx === 0 ? OFF_SQRT_START_PRICE : OFF_CURVE + CURVE_POINT_SIZE * (c.segIdx - 1);
        const lines = [
            `const s${i}sp = ${poolU(OFF_SQRT_PRICE, 16)};`,
            `const s${i}cliff = ${cfgU(OFF_CLIFF_FEE_NUMERATOR, 8)};`,
            `const s${i}freq = ${cfgU(OFF_PERIOD_FREQUENCY, 8)};`,
            `let s${i}f = s${i}cliff;`,
            `if (s${i}freq !== 0) {`,
            `  const s${i}act = ${poolU(OFF_ACTIVATION_POINT, 8)};`,
            `  let s${i}per = 0;`,
            `  if (ctx.timestamp() >= s${i}act) { s${i}per = (ctx.timestamp() - s${i}act) / s${i}freq }`,
            `  const s${i}np = ${cfgU(OFF_NUMBER_OF_PERIOD, 2)};`,
            `  if (s${i}per > s${i}np) { s${i}per = s${i}np }`,
            `  const s${i}red = ${cfgU(OFF_REDUCTION_FACTOR, 8)};`,
            `  s${i}f = s${i}cliff - s${i}red * s${i}per;`,
            '}',
            `if (${cfgU(OFF_DYN_INITIALIZED, 1)} === 1) {`,
            `  const s${i}va = ${poolU(OFF_VOL_ACCUMULATOR, 16)};`,
            `  const s${i}bs = ${cfgU(OFF_DYN_BIN_STEP, 2)};`,
            `  const s${i}vfc = ${cfgU(OFF_DYN_VARIABLE_FEE_CONTROL, 4)};`,
            `  const s${i}vv = s${i}va * s${i}bs;`,
            `  s${i}f = s${i}f + (s${i}vv * s${i}vv * s${i}vfc + 99999999999) / 100000000000;`,
            '}',
            `if (s${i}f > ${METEORA_DBC_MAX_FEE_NUMERATOR}) { s${i}f = ${METEORA_DBC_MAX_FEE_NUMERATOR} }`,
        ];
        if (c.direction === 'quoteToBase') {
            lines.push(`const s${i}up0 = ${cfgU(upperOff, 16)};`, `const s${i}mig = ${cfgU(OFF_MIGRATION_SQRT_PRICE, 16)};`, `let s${i}up = s${i}up0;`, `if (s${i}mig < s${i}up) { s${i}up = s${i}mig }`, `const s${i}liq = ${cfgU(upperOff + 16, 16)};`, `let s${i}cap = 0;`, `if (s${i}up > s${i}sp) { s${i}cap = (s${i}liq * (s${i}up - s${i}sp) + ${Q128 - 1n}) / ${Q128} }`, `if (s${i}freq !== 0) { if (ctx.timestamp() < ${poolU(OFF_ACTIVATION_POINT, 8)}) { s${i}cap = 0 } }`, `let s${i}x = ${amountIn};`, `if (s${i}x > s${i}cap) { s${i}x = s${i}cap }`, `const s${i}cfm = ${cfgU(OFF_COLLECT_FEE_MODE, 1)};`, `let s${i}din = s${i}x;`, `if (s${i}cfm === 0) { s${i}din = s${i}x - (s${i}x * s${i}f + 999999999) / 1000000000 }`, `const s${i}nx = s${i}sp + (s${i}din * ${Q128}) / s${i}liq;`, `const s${i}g = (s${i}liq * (s${i}nx - s${i}sp)) / (s${i}sp * s${i}nx);`, `let q${i} = s${i}g;`, `if (s${i}cfm !== 0) { q${i} = s${i}g - (s${i}g * s${i}f + 999999999) / 1000000000 }`);
        }
        else {
            lines.push(`const s${i}lo = ${cfgU(lowerOff, 16)};`, `const s${i}liq = ${cfgU(upperOff + 16, 16)};`, `let s${i}cap = 0;`, `if (s${i}sp > s${i}lo) { s${i}cap = (s${i}liq * (s${i}sp - s${i}lo) + s${i}lo * s${i}sp - 1) / (s${i}lo * s${i}sp) }`, `if (s${i}freq !== 0) { if (ctx.timestamp() < ${poolU(OFF_ACTIVATION_POINT, 8)}) { s${i}cap = 0 } }`, `let s${i}x = ${amountIn};`, `if (s${i}x > s${i}cap) { s${i}x = s${i}cap }`, `const s${i}den = s${i}liq + s${i}x * s${i}sp;`, `const s${i}nx = (s${i}liq * s${i}sp + s${i}den - 1) / s${i}den;`, `const s${i}g = (s${i}liq * (s${i}sp - s${i}nx)) / ${Q128};`, `let q${i} = s${i}g - (s${i}g * s${i}f + 999999999) / 1000000000;`);
        }
        return lines.join('\n');
    },
    buildSwap(cfg, user, amountIn) {
        const c = dbcConfig(cfg);
        checkAmountIn('meteora-dbc buildSwap', amountIn);
        // disc(8) ++ amount_in u64 LE ++ minimum_amount_out u64 LE (= 1; the
        // recipe's post-swap outAta delta check enforces the real bound).
        const data = new Uint8Array(24);
        data.set(METEORA_DBC_SWAP_DISCRIMINATOR, 0);
        for (let b = 0; b < 8; b++)
            data[8 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
        data[16] = 1;
        const fixed = (addr, writable = false) => (writable ? { ref: addr, address: addr, writable: true } : { ref: addr, address: addr });
        return {
            programId: METEORA_DBC_PROGRAM_ID,
            data,
            accounts: [
                fixed(METEORA_DBC_POOL_AUTHORITY),
                fixed(c.config),
                fixed(c.pool, true),
                { ref: user.inAta, writable: true },
                { ref: user.outAta, writable: true },
                fixed(c.baseVault, true),
                fixed(c.quoteVault, true),
                fixed(c.baseMint),
                fixed(c.quoteMint),
                { ref: user.owner, signer: true },
                fixed(c.tokenBaseProgram),
                fixed(c.tokenQuoteProgram),
                // Anchor-optional referral_token_account: the program id readonly is
                // the none-placeholder (no referral flow in this recipe).
                fixed(METEORA_DBC_PROGRAM_ID),
                fixed(METEORA_DBC_EVENT_AUTHORITY),
                fixed(METEORA_DBC_PROGRAM_ID),
            ],
        };
    },
    referenceQuote(cfg, state, amountIn, now) {
        const c = dbcConfig(cfg);
        const poolData = state[c.pool];
        const configData = state[c.config];
        if (poolData === undefined)
            throw new Error(`meteora-dbc pool ${c.pool} missing from state`);
        if (configData === undefined)
            throw new Error(`meteora-dbc config ${c.config} missing from state`);
        checkAmountIn('meteora-dbc referenceQuote', amountIn);
        const p = decodePool(c.pool, poolData);
        const cfgD = decodeConfig(c.config, configData);
        const q = quoteSingleSegment(c, p, cfgD, amountIn, now);
        return q.output;
    },
};
// ── shared closed-form math (mirrored exactly by ladder.ts's emitted fragment) ──
/** total_fee_numerator = min(base(period-decayed) + variable(volatility), cap). */
export function dbcFeeNumerator(cliffFeeNumerator, periodFrequency, activationPoint, numberOfPeriod, reductionFactor, dynInitialized, binStep, variableFeeControl, volatilityAccumulator, now) {
    let fee = cliffFeeNumerator;
    if (periodFrequency !== 0n) {
        let period = 0n;
        if (now >= activationPoint)
            period = (now - activationPoint) / periodFrequency;
        if (period > numberOfPeriod)
            period = numberOfPeriod;
        fee = cliffFeeNumerator - reductionFactor * period;
    }
    if (dynInitialized === 1) {
        const scaled = volatilityAccumulator * binStep;
        fee += ceilDiv(scaled * scaled * variableFeeControl, 100000000000n);
    }
    return fee > METEORA_DBC_MAX_FEE_NUMERATOR ? METEORA_DBC_MAX_FEE_NUMERATOR : fee;
}
/** Whether the fee-scheduler's activation gate has not yet been reached (capacity must clamp to 0 — the real program's fee calc would underflow-revert). */
function notYetActive(periodFrequency, activationPoint, now) {
    return periodFrequency !== 0n && now < activationPoint;
}
/** The single-active-segment closed-form quote both directions share (see the file header). Amount-parametric, used by both emitQuote (amountIn baked) and the ladder (amountIn a live merge value). */
export function quoteSingleSegment(cfg, p, c, amountIn, now) {
    const feeNumerator = dbcFeeNumerator(c.cliffFeeNumerator, c.periodFrequency, p.activationPoint, c.numberOfPeriod, c.reductionFactor, c.dynInitialized, c.binStep, c.variableFeeControl, p.volatilityAccumulator, now);
    const seg = c.curve[cfg.segIdx];
    if (seg === undefined)
        return { output: 0n, saturated: true, feeNumerator };
    const liquidity = seg.liquidity;
    const inactive = notYetActive(c.periodFrequency, p.activationPoint, now);
    if (cfg.direction === 'quoteToBase') {
        const upperBoundRaw = seg.sqrtPrice;
        const upperBound = c.migrationSqrtPrice < upperBoundRaw ? c.migrationSqrtPrice : upperBoundRaw;
        let capacity = 0n;
        if (upperBound > p.sqrtPrice)
            capacity = ceilDiv(liquidity * (upperBound - p.sqrtPrice), Q128);
        if (inactive)
            capacity = 0n;
        const x = amountIn > capacity ? capacity : amountIn;
        const feesOnInput = c.collectFeeMode === 0; // QuoteToken
        let din = x;
        if (feesOnInput)
            din = x - ceilDiv(x * feeNumerator, METEORA_DBC_FEE_DENOMINATOR);
        if (liquidity === 0n || din === 0n)
            return { output: 0n, saturated: amountIn > capacity, feeNumerator };
        const nextSqrtPrice = p.sqrtPrice + (din << 128n) / liquidity;
        const grossOut = (liquidity * (nextSqrtPrice - p.sqrtPrice)) / (p.sqrtPrice * nextSqrtPrice);
        const output = feesOnInput ? grossOut : grossOut - ceilDiv(grossOut * feeNumerator, METEORA_DBC_FEE_DENOMINATOR);
        return { output, saturated: amountIn > capacity, feeNumerator };
    }
    const lowerBound = cfg.segIdx === 0 ? c.sqrtStartPrice : c.curve[cfg.segIdx - 1].sqrtPrice;
    let capacity = 0n;
    if (p.sqrtPrice > lowerBound)
        capacity = ceilDiv(liquidity * (p.sqrtPrice - lowerBound), lowerBound * p.sqrtPrice);
    if (inactive)
        capacity = 0n;
    const x = amountIn > capacity ? capacity : amountIn;
    if (liquidity === 0n || x === 0n)
        return { output: 0n, saturated: amountIn > capacity, feeNumerator };
    const den = liquidity + x * p.sqrtPrice;
    const nextSqrtPrice = ceilDiv(liquidity * p.sqrtPrice, den);
    const grossOut = (liquidity * (p.sqrtPrice - nextSqrtPrice)) >> 128n;
    const output = grossOut - ceilDiv(grossOut * feeNumerator, METEORA_DBC_FEE_DENOMINATOR);
    return { output, saturated: amountIn > capacity, feeNumerator };
}
/** Closed-form capacity (max productive amountIn) for the active segment, in the given direction — exported for the ladder's referenceCapacities and for tests. */
export function dbcCapacity(cfg, p, c, now) {
    const seg = c.curve[cfg.segIdx];
    if (seg === undefined)
        return 0n;
    const inactive = notYetActive(c.periodFrequency, p.activationPoint, now);
    if (inactive)
        return 0n;
    if (cfg.direction === 'quoteToBase') {
        const upperBound = c.migrationSqrtPrice < seg.sqrtPrice ? c.migrationSqrtPrice : seg.sqrtPrice;
        if (upperBound <= p.sqrtPrice)
            return 0n;
        return ceilDiv(seg.liquidity * (upperBound - p.sqrtPrice), Q128);
    }
    const lowerBound = cfg.segIdx === 0 ? c.sqrtStartPrice : c.curve[cfg.segIdx - 1].sqrtPrice;
    if (p.sqrtPrice <= lowerBound)
        return 0n;
    return ceilDiv(seg.liquidity * (p.sqrtPrice - lowerBound), lowerBound * p.sqrtPrice);
}
/** Internal decode, re-exported for the ladder module (same package, no public API surface change). */
export { decodePool as __decodeMeteoraDbcPool, decodeConfig as __decodeMeteoraDbcConfig, activeSegment as __meteoraDbcActiveSegment };
export { OFF_SQRT_PRICE as METEORA_DBC_OFF_SQRT_PRICE, OFF_ACTIVATION_POINT as METEORA_DBC_OFF_ACTIVATION_POINT, OFF_VOL_ACCUMULATOR as METEORA_DBC_OFF_VOL_ACCUMULATOR, OFF_CLIFF_FEE_NUMERATOR as METEORA_DBC_OFF_CLIFF_FEE_NUMERATOR, OFF_PERIOD_FREQUENCY as METEORA_DBC_OFF_PERIOD_FREQUENCY, OFF_REDUCTION_FACTOR as METEORA_DBC_OFF_REDUCTION_FACTOR, OFF_NUMBER_OF_PERIOD as METEORA_DBC_OFF_NUMBER_OF_PERIOD, OFF_DYN_INITIALIZED as METEORA_DBC_OFF_DYN_INITIALIZED, OFF_DYN_VARIABLE_FEE_CONTROL as METEORA_DBC_OFF_DYN_VARIABLE_FEE_CONTROL, OFF_DYN_BIN_STEP as METEORA_DBC_OFF_DYN_BIN_STEP, OFF_COLLECT_FEE_MODE as METEORA_DBC_OFF_COLLECT_FEE_MODE, OFF_MIGRATION_SQRT_PRICE as METEORA_DBC_OFF_MIGRATION_SQRT_PRICE, OFF_SQRT_START_PRICE as METEORA_DBC_OFF_SQRT_START_PRICE, OFF_CURVE as METEORA_DBC_OFF_CURVE, CURVE_POINT_SIZE as METEORA_DBC_CURVE_POINT_SIZE, };
//# sourceMappingURL=index.js.map