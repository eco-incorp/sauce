import { readUintLE } from '../math.js';
import { assertStabbleU64AmountIn, calcUnwrappedAmount, calcWrappedAmount, complement, decodeStabblePoolCommon, decodeStabbleVault, deriveStabbleVaultAuthority, findStabbleAta, mulDown, STABBLE_SWAP_DISCRIMINATOR, STABBLE_TOKEN_PROGRAM_ID, STABBLE_VAULT_PROGRAM_ID, WEIGHTED_MAX_IN_RATIO, WEIGHTED_MAX_TOKENS, WEIGHTED_SWAP_PROGRAM_ID, weightedCalcOutGivenIn, weightedCoreQuoteLines, } from '../stabble-common.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'stabble-weighted-swap';
// Weighted variant field offsets (see ../stabble-common.ts module doc).
const INVARIANT_OFFSET = 106;
const SWAP_FEE_OFFSET = 114;
const TOKENS_OFFSET = 122;
const TOKEN_SIZE = 58;
const WEIGHT_SUB_OFFSET = 50;
const BAL_SUB_OFFSET = 42;
const POOL_MIN_LENGTH = 126;
function asWeightedConfig(cfg) {
    if (cfg.venue !== SLUG)
        throw new Error(`stabble-weighted-swap adapter got a config for venue '${cfg.venue}'`);
    return cfg;
}
export const stabbleWeightedSwap = {
    slug: SLUG,
    kind: 'constant-product', // no discrete window/Newton — a closed-form curve, same bucket as CP families for CU/oracle purposes
    programId: WEIGHTED_SWAP_PROGRAM_ID,
    async fetchPoolConfig(load, pool) {
        const data = await load(pool);
        const common = decodeStabblePoolCommon(pool, data, SLUG, TOKENS_OFFSET, TOKEN_SIZE, true, POOL_MIN_LENGTH);
        if (common.tokens.length > WEIGHTED_MAX_TOKENS) {
            throw new Error(`${SLUG} pool ${pool} has ${common.tokens.length} tokens, expected at most ${WEIGHTED_MAX_TOKENS}`);
        }
        if (!common.isActive)
            throw new Error(`${SLUG} pool ${pool} is not active`);
        const vaultData = await load(common.vault);
        const vault = decodeStabbleVault(pool, vaultData);
        if (!vault.isActive)
            throw new Error(`${SLUG} pool ${pool}'s vault ${common.vault} is not active`);
        const vaultAuthority = deriveStabbleVaultAuthority(common.vault, vault.authorityBump);
        const [tokenA, tokenB] = common.tokens;
        // This venue's v1 `swap` entry point is legacy-SPL (Tokenkeg) only — no
        // Token-2022/transfer-fee accounting (see the module doc SCOPE). Detect a
        // Token-2022 (or otherwise un-routable) mint per side and GRACEFULLY
        // SELF-DROP the pool: the SvmRoute orchestrator catches a fetchPoolConfig
        // throw and drops the venue. The LEGACY path is byte-identical — a classic
        // 82-byte mint classifies as Tokenkeg, parses no extensions, and the config
        // is built exactly as before; an unreadable mint (a fixture that does not
        // vendor it) falls back to the legacy assumption.
        for (const mint of [tokenA.mint, tokenB.mint]) {
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
        const vaultTokenA = await findStabbleAta(vaultAuthority, tokenA.mint);
        const vaultTokenB = await findStabbleAta(vaultAuthority, tokenB.mint);
        const beneficiaryTokenOut = await findStabbleAta(vault.beneficiary, tokenB.mint);
        const tokens = [
            { ...tokenA, weight: tokenA.weight, vaultTokenAccount: vaultTokenA },
            { ...tokenB, weight: tokenB.weight, vaultTokenAccount: vaultTokenB },
        ];
        return {
            venue: SLUG,
            pool,
            vault: common.vault,
            authorityBump: common.authorityBump,
            isActive: common.isActive,
            swapFee: readUintLE(data, SWAP_FEE_OFFSET, 8),
            tokens,
            vaultAuthority,
            withdrawAuthority: vault.withdrawAuthority,
            beneficiary: vault.beneficiary,
            beneficiaryTokenOut,
        };
    },
    quoteAccounts(cfg) {
        const c = asWeightedConfig(cfg);
        return [{ ref: c.pool, address: c.pool }];
    },
    emitQuote(cfg, i, amountIn) {
        const c = asWeightedConfig(cfg);
        assertStabbleU64AmountIn(amountIn, `${SLUG} emitQuote`);
        const pool = JSON.stringify(c.pool);
        const [tokenIn, tokenOut] = c.tokens;
        const wrappedIn = calcWrappedAmount(amountIn, tokenIn);
        const lines = [
            `  const bal0_${i} = accountUint(${pool}, ${TOKENS_OFFSET + 4 + BAL_SUB_OFFSET}, 8);`,
            `  const bal1_${i} = accountUint(${pool}, ${TOKENS_OFFSET + 4 + TOKEN_SIZE + BAL_SUB_OFFSET}, 8);`,
            `  const fee${i} = accountUint(${pool}, ${SWAP_FEE_OFFSET}, 8);`,
        ];
        const xcapExpr = `Math.mulDiv(bal0_${i}, ${WEIGHTED_MAX_IN_RATIO}, 1000000000)`;
        lines.push(`  let wrapped${i} = ${wrappedIn};`);
        lines.push(`  if (wrapped${i} > ${xcapExpr}) { wrapped${i} = ${xcapExpr} }`);
        const core = weightedCoreQuoteLines(`q${i}_`, `bal0_${i}`, `bal1_${i}`, tokenIn.weight, tokenOut.weight, `wrapped${i}`, `rawOut${i}`);
        lines.push(...core.map((l) => `  ${l}`));
        lines.push(`  const netOut${i} = Math.mulDiv(rawOut${i}, 1000000000 - fee${i}, 1000000000);`);
        const unwrapExpr = tokenOut.scalingFactor === 1n
            ? `netOut${i}`
            : tokenOut.scalingUp
                ? `netOut${i} / ${tokenOut.scalingFactor}`
                : `netOut${i} * ${tokenOut.scalingFactor}`;
        lines.push(`  const q${i} = ${unwrapExpr};`);
        return lines.join('\n');
    },
    buildSwap(cfg, user, amountIn) {
        const c = asWeightedConfig(cfg);
        assertStabbleU64AmountIn(amountIn, `${SLUG} buildSwap`);
        const [tokenIn, tokenOut] = c.tokens;
        const data = new Uint8Array(25);
        data.set(STABBLE_SWAP_DISCRIMINATOR, 0);
        data[8] = 1;
        new DataView(data.buffer).setBigUint64(9, amountIn, true);
        new DataView(data.buffer).setBigUint64(17, 1n, true);
        return {
            programId: WEIGHTED_SWAP_PROGRAM_ID,
            data,
            accounts: [
                { ref: user.owner, signer: true },
                { ref: user.inAta, writable: true },
                { ref: user.outAta, writable: true },
                { ref: tokenIn.vaultTokenAccount, address: tokenIn.vaultTokenAccount, writable: true },
                { ref: tokenOut.vaultTokenAccount, address: tokenOut.vaultTokenAccount, writable: true },
                { ref: c.beneficiaryTokenOut, address: c.beneficiaryTokenOut, writable: true },
                { ref: c.pool, address: c.pool, writable: true },
                { ref: c.withdrawAuthority, address: c.withdrawAuthority },
                { ref: c.vault, address: c.vault },
                { ref: c.vaultAuthority, address: c.vaultAuthority },
                { ref: STABBLE_VAULT_PROGRAM_ID, address: STABBLE_VAULT_PROGRAM_ID },
                { ref: STABBLE_TOKEN_PROGRAM_ID, address: STABBLE_TOKEN_PROGRAM_ID },
            ],
        };
    },
    referenceQuote(cfg, state, amountIn) {
        const c = asWeightedConfig(cfg);
        if (amountIn < 0n)
            throw new Error(`${SLUG} amountIn must be non-negative, got ${amountIn}`);
        if (amountIn === 0n)
            return 0n;
        assertStabbleU64AmountIn(amountIn, `${SLUG} referenceQuote`);
        const poolData = state[c.pool];
        if (poolData === undefined)
            throw new Error(`${SLUG} referenceQuote state is missing pool ${c.pool}`);
        const [tokenIn, tokenOut] = c.tokens;
        const bal0 = readUintLE(poolData, TOKENS_OFFSET + 4 + BAL_SUB_OFFSET, 8);
        const bal1 = readUintLE(poolData, TOKENS_OFFSET + 4 + TOKEN_SIZE + BAL_SUB_OFFSET, 8);
        const swapFee = readUintLE(poolData, SWAP_FEE_OFFSET, 8);
        const wrappedIn = calcWrappedAmount(amountIn, tokenIn);
        const cap = mulDown(bal0, WEIGHTED_MAX_IN_RATIO);
        const clamped = wrappedIn > cap ? cap : wrappedIn;
        const rawOut = weightedCalcOutGivenIn(bal0, tokenIn.weight, bal1, tokenOut.weight, clamped) ?? 0n;
        const netOut = mulDown(rawOut, complement(swapFee));
        return calcUnwrappedAmount(netOut, tokenOut);
    },
};
export { INVARIANT_OFFSET as STABBLE_WEIGHTED_INVARIANT_OFFSET, WEIGHT_SUB_OFFSET };
//# sourceMappingURL=index.js.map