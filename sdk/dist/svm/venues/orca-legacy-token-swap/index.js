/**
 * Orca legacy token-swap (v2) venue adapter — closed-source fork of the SPL
 * token-swap program (spl-token-swap token-swap-v2.1.0 layout/math): SwapV1
 * pool account (324 bytes, manual Pack, no discriminator), raw SPL vault
 * balances as curve reserves (both fees stay in the vaults; the owner fee is
 * compensated by minting LP tokens to pool_fee_account), input-side fees with
 * the floor-min-1 rule, and a ceiling-divided constant-product curve that
 * rounds against the trader. Constant-product (curve_type == 0) pools only.
 *
 * Quote direction is token A → token B, matching the pinned worked example
 * (SOL in → USDC out on the EGZ7ti... fixture pool).
 */
import { createHash } from 'node:crypto';
import { getAddressCodec } from '@solana/kit';
import { readUintLE, ceilDiv } from '../math.js';
const SLUG = 'orca-legacy-token-swap';
/** Orca v2 fork of spl-token-swap, mainnet (v1 DjVE6... is deprecated and out of scope). */
const PROGRAM_ID = '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP';
// SwapVersion::pack writes version at byte 0 and the 323-byte SwapV1 body at
// bytes 1..: 1 + 323 = 324, no discriminator, no padding.
const POOL_SIZE = 324;
/**
 * fees.rs calculate_fee: zero when the rate or the amount is zero, otherwise
 * floor(x * n / d) but at least 1 raw unit (dust swaps pay 2 units total on
 * the fixture since both rates are nonzero).
 */
function swapFee(x, numerator, denominator) {
    if (numerator === 0n || x === 0n)
        return 0n;
    const fee = (x * numerator) / denominator;
    return fee === 0n ? 1n : fee;
}
/** Fees are baked into the emitted quote, so netIn is compile-time for a fixed amountIn. */
function netAmountIn(cfg, amountIn) {
    if (amountIn <= 0n || amountIn >= 1n << 64n) {
        throw new Error(`${SLUG} amountIn must be a positive u64, got ${amountIn}`);
    }
    const tradeFee = swapFee(amountIn, cfg.tradeFeeNumerator, cfg.tradeFeeDenominator);
    const ownerFee = swapFee(amountIn, cfg.ownerTradeFeeNumerator, cfg.ownerTradeFeeDenominator);
    const netIn = amountIn - tradeFee - ownerFee;
    if (netIn <= 0n)
        throw new Error(`${SLUG} amountIn ${amountIn} is consumed entirely by fees`);
    return netIn;
}
/**
 * create_program_address for the STORED bump (the pool may have been
 * initialized with a non-canonical nonce, so find-style derivation is wrong
 * here). No on-curve rejection: the pool exists on-chain with this bump, so
 * the derivation is already known to be off-curve. Verified on the fixture:
 * sha256(pool || 0xFC || program || 'ProgramDerivedAddress') = JU8km...
 */
function deriveSwapAuthority(pool, bumpSeed) {
    const codec = getAddressCodec();
    return codec.decode(createHash('sha256')
        .update(new Uint8Array(codec.encode(pool)))
        .update(Uint8Array.of(bumpSeed))
        .update(new Uint8Array(codec.encode(PROGRAM_ID)))
        .update('ProgramDerivedAddress')
        .digest());
}
const poolRef = (cfg, role) => `${SLUG}:${cfg.pool}:${role}`;
export const orcaLegacyTokenSwap = {
    slug: SLUG,
    kind: 'constant-product',
    programId: PROGRAM_ID,
    async fetchPoolConfig(load, pool) {
        const data = await load(pool);
        if (data === null)
            throw new Error(`${SLUG} pool ${pool} account not found`);
        if (data.length !== POOL_SIZE) {
            throw new Error(`${SLUG} pool ${pool} data must be ${POOL_SIZE} bytes (SwapVersion::SwapV1), got ${data.length}`);
        }
        if (data[0] !== 1)
            throw new Error(`${SLUG} pool ${pool} version must be 1 (SwapV1), got ${data[0]}`);
        if (data[1] !== 1)
            throw new Error(`${SLUG} pool ${pool} is not initialized`);
        // Orca's fork also ran stable pools (nonzero curve_type, amp in the
        // calculator blob) — this adapter grounds only the constant-product curve.
        if (data[291] !== 0) {
            throw new Error(`${SLUG} pool ${pool} curve_type must be 0 (constant product), got ${data[291]}`);
        }
        const codec = getAddressCodec();
        const pubkey = (offset) => codec.decode(data.subarray(offset, offset + 32));
        const u64 = (offset) => readUintLE(data, offset, 8);
        const tradeFeeNumerator = u64(227);
        const tradeFeeDenominator = u64(235);
        const ownerTradeFeeNumerator = u64(243);
        const ownerTradeFeeDenominator = u64(251);
        for (const [name, numerator, denominator] of [
            ['trade', tradeFeeNumerator, tradeFeeDenominator],
            ['owner trade', ownerTradeFeeNumerator, ownerTradeFeeDenominator],
        ]) {
            if (numerator !== 0n && denominator === 0n) {
                throw new Error(`${SLUG} pool ${pool} ${name} fee denominator is 0 with nonzero numerator ${numerator}`);
            }
        }
        // Per-side token program: the legacy spl-token-swap program stores ONE
        // token_program_id (@3) for the whole pool and CPIs both legs through it —
        // there is no per-mint program to thread, and this reads the pool's own
        // stored program (not a hardcoded legacy id), so a pool created against
        // Token-2022 is threaded correctly. The constant-product referenceQuote/
        // emitQuote read only the raw vault balances (SPL token account amount @64,
        // identical on both token programs), so a zero-fee Token-2022 pool quotes
        // byte-identically to a legacy one.
        // TODO(t22-fee-netting): this adapter never fetches the mint accounts, so a
        // Token-2022 TransferFeeConfig on a leg is neither detected nor netted. Such
        // a pool would over-quote (the wire haircut is unmodeled). Adding netting
        // needs a mint fetch (to read the fee config + current epoch) plus matching
        // netting in BOTH referenceQuote and emitQuote — deferred; these legacy
        // pools are legacy-token in practice, so the exposure is negligible today.
        const bumpSeed = data[2];
        return {
            venue: SLUG,
            pool,
            swapAuthority: deriveSwapAuthority(pool, bumpSeed),
            tokenProgram: pubkey(3),
            vaultIn: pubkey(35),
            vaultOut: pubkey(67),
            poolMint: pubkey(99),
            inputMint: pubkey(131),
            outputMint: pubkey(163),
            poolFeeAccount: pubkey(195),
            tradeFeeNumerator,
            tradeFeeDenominator,
            ownerTradeFeeNumerator,
            ownerTradeFeeDenominator,
            bumpSeed,
        };
    },
    quoteAccounts(cfg) {
        // Reserves ARE the raw vault balances (nothing to subtract): fees remain
        // in the vaults as tokens. Fee rates are immutable SwapV1 fields, baked
        // from cfg — the quote reads only the two vault amounts.
        return [
            { ref: poolRef(cfg, 'vault-in'), address: cfg.vaultIn },
            { ref: poolRef(cfg, 'vault-out'), address: cfg.vaultOut },
        ];
    },
    emitQuote(cfg, i, amountIn) {
        const netIn = netAmountIn(cfg, amountIn);
        // amountOut = rsOut - ceil(rsIn * rsOut / (rsIn + netIn)), ceiled via
        // (num + den - 1) / den. Reserves are u64, so rsIn * rsOut <= 2^128 and
        // nothing here approaches the engine's 256-bit wrap ("All arithmetic in
        // u128" — docs/svm-venues.md); no Math.mulDiv needed.
        // Account model (RS/svm target): reads go through main()'s ordered `Account`
        // params, not `accountUint("<address>", …)` string refs. Param `acc<k>` is
        // `quoteAccounts()[k]` — vault-in is slot 0, vault-out slot 1 — and `accountUint`
        // lowered to CAST_LE, so `svm.sload(…).toLe()` is the exact endianness match.
        return [
            `const rIn${i} = svm.sload(acc0, 64, 8).toLe();`,
            `const rOut${i} = svm.sload(acc1, 64, 8).toLe();`,
            `const q${i} = rOut${i} - (rIn${i} * rOut${i} + rIn${i} + ${netIn - 1n}) / (rIn${i} + ${netIn});`,
        ].join('\n');
    },
    buildSwap(cfg, user, amountIn) {
        if (amountIn <= 0n || amountIn >= 1n << 64n) {
            throw new Error(`${SLUG} amountIn must be a positive u64, got ${amountIn}`);
        }
        // SwapInstruction::Swap: [tag=1][amount_in u64 LE][minimum_amount_out u64
        // LE]. min_out is 1 — the recipe's post-swap delta check enforces the
        // real bound.
        const data = new Uint8Array(17);
        data[0] = 1;
        new DataView(data.buffer).setBigUint64(1, amountIn, true);
        new DataView(data.buffer).setBigUint64(9, 1n, true);
        return {
            programId: PROGRAM_ID,
            data,
            // instruction.rs Swap account list 0-9; the optional host fee account
            // (10) is omitted.
            accounts: [
                { ref: poolRef(cfg, 'pool'), address: cfg.pool },
                { ref: poolRef(cfg, 'authority'), address: cfg.swapAuthority },
                { ref: user.owner, signer: true },
                { ref: user.inAta, writable: true },
                { ref: poolRef(cfg, 'vault-in'), address: cfg.vaultIn, writable: true },
                { ref: poolRef(cfg, 'vault-out'), address: cfg.vaultOut, writable: true },
                { ref: user.outAta, writable: true },
                { ref: poolRef(cfg, 'pool-mint'), address: cfg.poolMint, writable: true },
                { ref: poolRef(cfg, 'fee-account'), address: cfg.poolFeeAccount, writable: true },
                { ref: poolRef(cfg, 'token-program'), address: cfg.tokenProgram },
            ],
        };
    },
    referenceQuote(cfg, state, amountIn, _now) {
        const vaults = [];
        for (const vault of [cfg.vaultIn, cfg.vaultOut]) {
            const data = state[vault];
            if (data === undefined)
                throw new Error(`${SLUG} vault ${vault} missing from state`);
            vaults.push(data);
        }
        // SPL token account amount, u64 LE @64 — raw balances are the reserves.
        const rsIn = readUintLE(vaults[0], 64, 8);
        const rsOut = readUintLE(vaults[1], 64, 8);
        const netIn = netAmountIn(cfg, amountIn);
        const invariant = rsIn * rsOut;
        const newIn = rsIn + netIn;
        // checked_ceil_div maps a zero floor-quotient to None before ceiling.
        if (invariant / newIn === 0n)
            throw new Error(`${SLUG} swap fails on-chain (zero quotient)`);
        const newOut = ceilDiv(invariant, newIn);
        const amountOut = rsOut - newOut;
        if (amountOut === 0n)
            throw new Error(`${SLUG} swap fails on-chain (zero output)`);
        return amountOut;
    },
};
//# sourceMappingURL=index.js.map