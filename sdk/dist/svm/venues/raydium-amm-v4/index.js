/**
 * Raydium AMM v4 (legacy hybrid AMM) venue adapter — constant-product exactIn
 * quoting with the 25/10000 swap fee ceil-charged on input, floor on output.
 *
 * Scope gate: ONLY pools with status 6 (SwapOnly) or 7 (WaitingTrade) are
 * quotable. For those the on-chain program uses
 * calc_total_without_take_pnl_no_orderbook (raydium-amm math.rs:322):
 * reserves = vault SPL amount minus AmmInfo.need_take_pnl_* — bit-exact from
 * three accounts, no Serum open-orders term. Status 1/5 pools (orderbook
 * enabled) additionally fold in open-orders totals plus an event-queue walk
 * and are rejected here. The swap CPI is swap_base_in_v2 (discriminator 0x10,
 * 8 accounts, no market accounts), which enforces the same restriction
 * on-chain.
 *
 * AmmInfo is #[repr(C, packed)], no discriminator: all offsets absolute from
 * byte 0, all integers little-endian.
 */
import { address, getAddressCodec } from '@solana/kit';
import { ceilDiv, readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'raydium-amm-v4';
const PROGRAM_ID = address('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
// create_program_address([b"amm authority", [nonce]], programId) — one PDA for
// the whole program (AUTHORITY_AMM, processor.rs:111), pinned mainnet value.
const AMM_AUTHORITY = address('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
// AmmInfo field offsets (state.rs AmmInfo, layout table in docs/svm-venues.md).
const AMM_INFO_SIZE = 752;
const OFF_STATUS = 0;
const OFF_COIN_DECIMALS = 32;
const OFF_PC_DECIMALS = 40;
const OFF_SWAP_FEE_NUMERATOR = 176;
const OFF_SWAP_FEE_DENOMINATOR = 184;
const OFF_NEED_TAKE_PNL_COIN = 192;
const OFF_NEED_TAKE_PNL_PC = 200;
const OFF_POOL_OPEN_TIME = 224;
const OFF_COIN_VAULT = 336;
const OFF_PC_VAULT = 368;
const OFF_COIN_MINT = 400;
const OFF_PC_MINT = 432;
// SPL token account: 165 bytes, mint @0, amount u64 LE @64.
const SPL_TOKEN_ACCOUNT_SIZE = 165;
const OFF_SPL_MINT = 0;
const OFF_SPL_AMOUNT = 64;
const U64_MAX = (1n << 64n) - 1n;
const poolRef = (cfg) => `${SLUG}:${cfg.pool}`;
const coinVaultRef = (cfg) => `${SLUG}:${cfg.pool}:coin-vault`;
const pcVaultRef = (cfg) => `${SLUG}:${cfg.pool}:pc-vault`;
function asConfig(cfg) {
    if (cfg.venue !== SLUG)
        throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
    return cfg;
}
function checkAmountIn(amountIn) {
    if (amountIn <= 0n)
        throw new Error(`${SLUG} amountIn must be positive, got ${amountIn}`);
    if (amountIn > U64_MAX)
        throw new Error(`${SLUG} amountIn must fit u64, got ${amountIn}`);
}
/** amount_in - ceil(amount_in * fee_num / fee_den) — checked_ceil_div, processor.rs:2396-2400. */
function afterFee(amountIn, feeNumerator, feeDenominator) {
    return amountIn - ceilDiv(amountIn * feeNumerator, feeDenominator);
}
async function loadVault(load, vault, side, expectedMint) {
    const data = await load(vault);
    if (data === null)
        throw new Error(`${SLUG} ${side} vault account ${vault} not found`);
    if (data.length !== SPL_TOKEN_ACCOUNT_SIZE) {
        throw new Error(`${SLUG} ${side} vault ${vault} must be a ${SPL_TOKEN_ACCOUNT_SIZE}-byte SPL token account, got ${data.length} bytes`);
    }
    const mint = getAddressCodec().decode(data.slice(OFF_SPL_MINT, OFF_SPL_MINT + 32));
    if (mint !== expectedMint) {
        throw new Error(`${SLUG} ${side} vault ${vault} mint ${mint} does not match pool ${side} mint ${expectedMint}`);
    }
}
export const raydiumAmmV4 = {
    slug: SLUG,
    kind: 'constant-product',
    programId: PROGRAM_ID,
    async fetchPoolConfig(load, pool) {
        const data = await load(pool);
        if (data === null)
            throw new Error(`${SLUG} pool account ${pool} not found`);
        if (data.length !== AMM_INFO_SIZE) {
            throw new Error(`${SLUG} pool ${pool} data must be ${AMM_INFO_SIZE} bytes (AmmInfo), got ${data.length}`);
        }
        // Orderbook gate: only status 6 (SwapOnly) and 7 (WaitingTrade) quote from
        // vaults minus need_take_pnl alone; status 1/5 reserves include Serum
        // open-orders + event-queue terms, status 2/3/4 have no swap permission.
        const status = readUintLE(data, OFF_STATUS, 8);
        if (status !== 6n && status !== 7n) {
            throw new Error(`${SLUG} pool ${pool} status ${status} is not quotable: only status 6 (SwapOnly) and 7 (WaitingTrade) swap without the orderbook`);
        }
        // Status 7 (WaitingTrade) rejects swaps on-chain until pool_open_time;
        // referenceQuote re-checks it against the live state snapshot.
        const poolOpenTime = readUintLE(data, OFF_POOL_OPEN_TIME, 8);
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (status === 7n && now < poolOpenTime) {
            throw new Error(`${SLUG} pool ${pool} is not open yet (pool_open_time ${poolOpenTime}, now ${now})`);
        }
        const codec = getAddressCodec();
        const pubkey = (offset) => codec.decode(data.slice(offset, offset + 32));
        const coinMint = pubkey(OFF_COIN_MINT);
        const pcMint = pubkey(OFF_PC_MINT);
        const coinVault = pubkey(OFF_COIN_VAULT);
        const pcVault = pubkey(OFF_PC_VAULT);
        await loadVault(load, coinVault, 'coin', coinMint);
        await loadVault(load, pcVault, 'pc', pcMint);
        // Token-2022 safety: swap_base_in_v2 carries a single legacy-SPL (Tokenkeg)
        // token program, so a Token-2022 mint (or one carrying an un-routable
        // extension) SELF-DROPS the pool via a thrown, clearly-described error — the
        // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue.
        // The legacy path stays byte-identical: a classic 82-byte mint classifies as
        // legacy → no throw, and an unreadable mint (not vendored by a fixture) falls
        // back to legacy (this keeps the existing vault-only fixtures green).
        for (const mint of [coinMint, pcMint]) {
            const mintData = await load(mint);
            if (mintData === null)
                continue;
            if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
                throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
            }
            const { blocking } = parseMintExtensions(mintData);
            if (blocking.length > 0) {
                throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
            }
        }
        return {
            venue: SLUG,
            pool,
            status,
            poolOpenTime,
            coinDecimals: Number(readUintLE(data, OFF_COIN_DECIMALS, 8)),
            pcDecimals: Number(readUintLE(data, OFF_PC_DECIMALS, 8)),
            swapFeeNumerator: readUintLE(data, OFF_SWAP_FEE_NUMERATOR, 8),
            swapFeeDenominator: readUintLE(data, OFF_SWAP_FEE_DENOMINATOR, 8),
            coinVault,
            pcVault,
            coinMint,
            pcMint,
            inputIsCoin: true,
        };
    },
    quoteAccounts(cfg) {
        const c = asConfig(cfg);
        return [
            { ref: poolRef(c), address: c.pool },
            { ref: coinVaultRef(c), address: c.coinVault },
            { ref: pcVaultRef(c), address: c.pcVault },
        ];
    },
    emitQuote(cfg, i, amountIn) {
        const c = asConfig(cfg);
        checkAmountIn(amountIn);
        // The fee side of the quote is all compile-time constants, so it folds
        // off-chain; only the live reserve reads stay in-VM.
        const inAfterFee = afterFee(amountIn, c.swapFeeNumerator, c.swapFeeDenominator);
        if (inAfterFee <= 0n) {
            throw new Error(`${SLUG} amountIn ${amountIn} is consumed entirely by the ${c.swapFeeNumerator}/${c.swapFeeDenominator} swap fee`);
        }
        // reserves = vault amount (u64 LE @64) - need_take_pnl_* (AmmInfo @192/@200),
        // the no-orderbook path (math.rs:322). All operands are u64, so the product
        // rOut * inAfterFee stays under 2^128 — far from the engine's 256-bit wrap —
        // and matches the program's U128 floor division (math.rs:373) exactly.
        const pool = JSON.stringify(poolRef(c));
        const rIn = `accountUint(${JSON.stringify(c.inputIsCoin ? coinVaultRef(c) : pcVaultRef(c))}, ${OFF_SPL_AMOUNT}, 8) - accountUint(${pool}, ${c.inputIsCoin ? OFF_NEED_TAKE_PNL_COIN : OFF_NEED_TAKE_PNL_PC}, 8)`;
        const rOut = `accountUint(${JSON.stringify(c.inputIsCoin ? pcVaultRef(c) : coinVaultRef(c))}, ${OFF_SPL_AMOUNT}, 8) - accountUint(${pool}, ${c.inputIsCoin ? OFF_NEED_TAKE_PNL_PC : OFF_NEED_TAKE_PNL_COIN}, 8)`;
        return [
            `const rayV4In${i} = ${rIn};`,
            `const rayV4Out${i} = ${rOut};`,
            `const q${i} = rayV4Out${i} * ${inAfterFee} / (rayV4In${i} + ${inAfterFee});`,
        ].join('\n');
    },
    buildSwap(cfg, user, amountIn) {
        const c = asConfig(cfg);
        checkAmountIn(amountIn);
        // swap_base_in_v2: byte0 = 0x10; amount_in u64 LE; minimum_amount_out
        // u64 LE (1 — the recipe's post-swap delta check enforces the real bound).
        const data = new Uint8Array(17);
        data[0] = 0x10;
        new DataView(data.buffer).setBigUint64(1, amountIn, true);
        new DataView(data.buffer).setBigUint64(9, 1n, true);
        return {
            programId: PROGRAM_ID,
            data,
            accounts: [
                { ref: 'token-program', address: TOKEN_PROGRAM },
                { ref: poolRef(c), address: c.pool, writable: true },
                { ref: `${SLUG}:authority`, address: AMM_AUTHORITY },
                { ref: coinVaultRef(c), address: c.coinVault, writable: true },
                { ref: pcVaultRef(c), address: c.pcVault, writable: true },
                { ref: user.inAta, writable: true },
                { ref: user.outAta, writable: true },
                { ref: user.owner, signer: true },
            ],
        };
    },
    referenceQuote(cfg, state, amountIn, now) {
        const c = asConfig(cfg);
        checkAmountIn(amountIn);
        const pool = state[c.pool];
        if (pool === undefined)
            throw new Error(`${SLUG} referenceQuote state is missing pool account ${c.pool}`);
        const vaultIn = state[c.inputIsCoin ? c.coinVault : c.pcVault];
        const vaultOut = state[c.inputIsCoin ? c.pcVault : c.coinVault];
        if (vaultIn === undefined || vaultOut === undefined) {
            throw new Error(`${SLUG} referenceQuote state is missing vault account ${vaultIn === undefined ? (c.inputIsCoin ? c.coinVault : c.pcVault) : (c.inputIsCoin ? c.pcVault : c.coinVault)}`);
        }
        const status = readUintLE(pool, OFF_STATUS, 8);
        if (status !== 6n && status !== 7n) {
            throw new Error(`${SLUG} pool ${c.pool} status ${status} is not quotable: only status 6 (SwapOnly) and 7 (WaitingTrade) swap without the orderbook`);
        }
        const poolOpenTime = readUintLE(pool, OFF_POOL_OPEN_TIME, 8);
        if (status === 7n && now < poolOpenTime) {
            throw new Error(`${SLUG} pool ${c.pool} is not open yet: pool_open_time ${poolOpenTime}, now ${now}`);
        }
        // calc_total_without_take_pnl_no_orderbook (math.rs:322).
        const rIn = readUintLE(vaultIn, OFF_SPL_AMOUNT, 8) - readUintLE(pool, c.inputIsCoin ? OFF_NEED_TAKE_PNL_COIN : OFF_NEED_TAKE_PNL_PC, 8);
        const rOut = readUintLE(vaultOut, OFF_SPL_AMOUNT, 8) - readUintLE(pool, c.inputIsCoin ? OFF_NEED_TAKE_PNL_PC : OFF_NEED_TAKE_PNL_COIN, 8);
        if (rIn <= 0n || rOut <= 0n)
            throw new Error(`${SLUG} pool ${c.pool} has empty reserves (in ${rIn}, out ${rOut})`);
        // swap_token_amount_base_in (math.rs:373): floor(rOut * inAfterFee / (rIn + inAfterFee)).
        const inAfterFee = afterFee(amountIn, readUintLE(pool, OFF_SWAP_FEE_NUMERATOR, 8), readUintLE(pool, OFF_SWAP_FEE_DENOMINATOR, 8));
        if (inAfterFee <= 0n)
            throw new Error(`${SLUG} amountIn ${amountIn} is consumed entirely by the swap fee`);
        const out = (rOut * inAfterFee) / (rIn + inAfterFee);
        if (out === 0n || out >= rOut) {
            throw new Error(`${SLUG} pool ${c.pool} swap would revert on-chain (amount_out ${out}, reserve_out ${rOut})`);
        }
        return out;
    },
};
//# sourceMappingURL=index.js.map