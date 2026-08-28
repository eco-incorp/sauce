/**
 * Mercurial Finance Stable Swap (`stable-swap-n-pool`) — the pre-Meteora
 * multi-token stableswap, program `MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky`
 * (same address on mainnet-beta and devnet; Saber's own `stable-swap`
 * program is a documented fork of this exact codebase, which is why the
 * Newton math below matches saber-stableswap's `ann = amp*2` convention
 * bit-for-bit rather than the generalized Curve `ann = amp*n^n`).
 *
 * Layout source: `mercurial-finance/stable-swap-n-pool-instructions`
 * (`src/state.rs`'s `SwapV2`, `src/instruction.rs`'s `SwapInstruction`) and
 * `mercurial-finance/stable-swap-n-pool-js` (`src/index.ts`'s
 * `FEE_DENOMINATOR = 1e10`, the client account ordering for `Exchange`).
 * `SwapV2` is a Vec-backed struct but every array is declared at its
 * compile-time MAX (`PoolParameter::MAX_N_COINS = 4`), so every pool account
 * is a FIXED 265 bytes (1 version tag + `SwapV2::LEN` 264) regardless of how
 * many of the 4 coin slots are actually in use — `getProgramAccounts`
 * filtered on `dataSize: 265` finds every pool with no memcmp needed (the
 * -32010 the brief warns about is a Helius secondary-index limit on an
 * UNFILTERED gPA call; a plain `dataSize` filter is a primary index and
 * works directly, confirmed live: 24 pools returned in one call).
 *
 * THIS ADAPTER IS 2-COIN ONLY (a deliberate, checked scope limit, not a
 * layout gap): `stableComputeD`/`stableComputeYWarm` (shared with
 * saber-stableswap and meteora-damm-v1-stable) implement the CLASSIC 2-asset
 * invariant (`ann = amp*2`); a genuinely N>2 Mercurial pool (real examples
 * exist on-chain, e.g. 3- and 4-coin USD baskets) needs the generalized
 * N-coin Newton iteration (`ann = amp*n^n`, D/Y summed over every balance),
 * which is different math this repo does not implement. `fetchPoolConfig`
 * throws (self-drops the pool, never emits wrong-math bytecode) whenever
 * `tokens_len !== 2`.
 *
 * PRECISION MULTIPLIERS — the wrinkle Saber's 2-token-only design never
 * needed: each coin slot carries a live `precision_multipliers[i]` (u64,
 * `SetPrecisionMultipliers`-admin-settable) that both aligns decimals AND
 * bakes in a fixed exchange-rate snapshot for yield-bearing pairs (measured
 * live 2026-07-31: the mSOL/SOL pool `MAR1zHjHaQcniE2gXsDptkyKUnNfMEsLBVcfP7vLyv7`
 * carries `[1000, 1128]` — 1.128 being that pool's mSOL/SOL rate at whatever
 * point an admin last called `SetPrecisionMultipliers`, NOT live-updating
 * per-trade). The invariant math runs on VIRTUAL balances
 * `raw_reserve_i * precision_multipliers[i]` — homogeneous-degree-1 in the
 * multiplier choice, so D/Y math is exact for ANY shared scale, and only the
 * de-normalization (`virtual / precision_multipliers[dst]`) and the FEE
 * matter for byte-exactness. VALIDATED against the REAL deployed program
 * (see below) that the fee itself must be taken IN VIRTUAL SPACE before
 * de-normalizing — `dyRaw = floor((dyVirtual - floor(dyVirtual*fn/1e10)) / dstMult)`,
 * NOT `floor(dyVirtual/dstMult) - floor(floor(dyVirtual/dstMult)*fn/1e10)` —
 * the latter is off by up to a few raw units on any pool with a non-unit
 * multiplier (measured +1 raw-unit residual at 2 of 3 tested sizes on the
 * mSOL/SOL pool before the fix; 0 residual after, at all tested sizes on all
 * three real pools below).
 *
 * NO AMP RAMP: unlike Saber (and unlike Curve's usual `start/target/ramp_ts`
 * quad), Mercurial's `SwapV2.amplification_coefficient` is a single live u64
 * that `AdminSetting::SetAmplificationCoefficient` overwrites INSTANTLY —
 * there is no time-interpolated ramp field in the account at all (confirmed
 * from `state.rs`: the struct has no `initial_amp`/`target_amp`/ramp
 * timestamps, only the one field). The fragment therefore just reads amp
 * live, no branch.
 *
 * `admin_fee_numerator` is a stored-but-UNUSED field (`state.rs`'s own doc
 * comment: "Admin fee numerator, not implemented") — every sampled live pool
 * (24, all admin_fee_numerator = 0) confirms it; this adapter never reads it.
 * `FEE_DENOMINATOR` is a fixed protocol constant (`1e10`, from the JS SDK),
 * NOT a per-pool stored field, so it is baked as a compile-time literal.
 *
 * BIDIRECTIONAL: unlike Saber (asymmetric admin-fee-destination account,
 * A->B only in this codebase) and meteora-damm-v1-stable, Mercurial's
 * `Exchange` instruction accounts are fully symmetric — both vaults ride the
 * account list in STORED order regardless of which mint is source/dest, and
 * there is no direction-specific admin-fee account at all. So this adapter
 * serves BOTH `aToB` and `bToA`, doubling real coverage over the Saber
 * precedent for no extra on-chain cost.
 *
 * VALIDATED against the REAL deployed program on REAL mainnet state (LiteSVM
 * `simulateTransaction`, `sigVerify:false` impersonating a real token holder
 * as `userTransferAuthority` — never a funds-moving tx) at 3+ sizes on THREE
 * independent real pools, RE-CONFIRMED at fixture-capture time (2026-07-31;
 * these pools trade continuously — a pool's live reserves are a MOVING
 * TARGET, so `test/svm/venues/mercurial.test.ts`'s pinned numbers are a
 * regression pin against its OWN checked-in fixture snapshot, not a
 * permanent real-time truth — re-derive if the fixtures are ever recaptured):
 *  - `SoLw5ovBPNfodtAbxqEKHLGppyrdB4aZthdGwpfpQgi` (mult=[1,1], SOL vs an
 *    unlabeled SPL mint): 1/10/50 tokens, bit-exact at all three.
 *  - `MAR1zHjHaQcniE2gXsDptkyKUnNfMEsLBVcfP7vLyv7` (SOL/mSOL, mult=[1000,1128]):
 *    1/5/20 mSOL, bit-exact at all three (post-fix; see the fee-rounding note
 *    above for the pre-fix residual).
 *  - `LiDoU8ymvYptqxenJ4YpcURBchn4ef63tcbdznBCKJh` (stSOL/SOL, mult=[1122,1000]):
 *    1/10/30 stSOL, bit-exact at all three.
 * See `test/svm/venues/mercurial.test.ts` for the pinned worked examples.
 *
 * NO `the consuming app realcpi e2e test` CELL (unlike every other SAUCE_VENUE_PROGRAMS-gated
 * venue): driving the real dumped `mercurial.so` through a raw single Exchange
 * CPI in LiteSVM (same pool/accounts/encoding the real-network probe above
 * validates) reproducibly fails a RUNTIME-LEVEL "sum of account balances
 * before and after instruction do not match" check — AFTER the program's own
 * logic (GetFeeAmount, GetDyUnderlying, both inner SPL transfers) already
 * completes correctly and reproduces the exact real-network quote. This is
 * independent of pool / precision-multiplier / lamport magnitude / SPL
 * `is_native` flagging / LiteSVM feature set (all varied individually, zero
 * change in outcome or CU) and is read as a LiteSVM-specific compatibility
 * gap with this one 2021-era non-Anchor binary — `simulateTransaction`
 * against REAL mainnet-beta runs the SAME Agave runtime code path as full
 * execution (unlike LiteSVM's independent reimplementation) and succeeds
 * cleanly, which is why the real-network probe above is trusted as the
 * fund-safety proof. budget.ts's `mercurial` CU_FAMILIES entry documents the
 * real CPI's OWN measured compute cost (61_473 CU, captured before that
 * runtime check fires) and folds it into the pin with a safety margin.
 *
 * Gates: 265-byte account size, version byte == 2 (SwapV2), initialized,
 * exactly 2 coin slots, both vault accounts classic-SPL (165 bytes) and
 * owned by the derived authority. `swap_enabled` is a live-reversible admin
 * toggle (same class as Saber's `is_paused`) — NOT a fetch-time gate; the
 * fragment re-checks it live every trade (a disabled pool quotes 0 and never
 * pays its CPI, the same self-drop-by-zero-quote convention Saber uses).
 */
import { createHash } from 'node:crypto';
import { address, getAddressDecoder, getAddressEncoder, isOffCurveAddress } from '@solana/kit';
import { readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'mercurial';
export const MERCURIAL_PROGRAM_ID = address('MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky');
// Mercurial predates Token-2022; every sampled vault is classic Tokenkeg.
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** 1 (version tag) + SwapV2::LEN (264, PoolParameter::MAX_N_COINS = 4 baked into the fixed-size arrays). */
const SWAP_STATE_LEN = 265;
/** Classic (non-Token-2022) SPL Token Account encoding length. */
const SPL_TOKEN_ACCOUNT_LEN = 165;
// SwapV2 offsets (absolute, i.e. including the leading version-tag byte — see module header).
const OFF_NONCE = 2;
const OFF_TOKENS_LEN = 27;
const OFF_VAULT_A = 71;
const OFF_VAULT_B = 103;
/**
 * create_program_address([pool (32B), [nonce]], programId) — identical
 * scheme to saber-stableswap's `deriveSwapAuthority` (Mercurial's own client
 * derives the SAME seeds via `findProgramAddress([pool], programId)`, whose
 * auto-appended bump IS the stored nonce for any canonically-initialized
 * pool; using the STORED nonce directly, like Saber, is exact even for a
 * hypothetical non-canonical nonce).
 */
async function deriveMercurialAuthority(pool, nonce) {
    const encoder = getAddressEncoder();
    const digest = createHash('sha256')
        .update(encoder.encode(pool))
        .update(Uint8Array.of(nonce))
        .update(encoder.encode(MERCURIAL_PROGRAM_ID))
        .update('ProgramDerivedAddress')
        .digest();
    const authority = getAddressDecoder().decode(digest);
    if (!isOffCurveAddress(authority)) {
        throw new Error(`${SLUG} pool ${pool} nonce ${nonce} derives an on-curve swap authority`);
    }
    return authority;
}
/** Fetch + decode one Mercurial SwapV2 pool, plus its two vaults' mints. Read-only against the loader. */
export async function fetchMercurialPoolConfig(load, pool) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`${SLUG}: pool account ${pool} not found`);
    if (data.length !== SWAP_STATE_LEN) {
        throw new Error(`${SLUG}: pool ${pool} data must be ${SWAP_STATE_LEN} bytes (SwapState), got ${data.length}`);
    }
    if (data[0] !== 2)
        throw new Error(`${SLUG}: pool ${pool} is not SwapV2 (version tag ${data[0]})`);
    if (data[1] !== 1)
        throw new Error(`${SLUG}: pool ${pool} is not initialized`);
    const tokensLen = Number(readUintLE(data, OFF_TOKENS_LEN, 4));
    if (tokensLen !== 2) {
        throw new Error(`${SLUG}: pool ${pool} has ${tokensLen} coin slots — only 2-coin pools are supported (see module header)`);
    }
    const nonce = data[OFF_NONCE];
    const pubkey = getAddressDecoder();
    const vaultA = pubkey.decode(data, OFF_VAULT_A);
    const vaultB = pubkey.decode(data, OFF_VAULT_B);
    const authority = await deriveMercurialAuthority(pool, nonce);
    const [vaultAData, vaultBData] = await Promise.all([load(vaultA), load(vaultB)]);
    if (vaultAData === null)
        throw new Error(`${SLUG}: pool ${pool} vault A ${vaultA} not found`);
    if (vaultBData === null)
        throw new Error(`${SLUG}: pool ${pool} vault B ${vaultB} not found`);
    if (vaultAData.length !== SPL_TOKEN_ACCOUNT_LEN) {
        throw new Error(`${SLUG}: pool ${pool} vault A ${vaultA} is not a classic SPL token account`);
    }
    if (vaultBData.length !== SPL_TOKEN_ACCOUNT_LEN) {
        throw new Error(`${SLUG}: pool ${pool} vault B ${vaultB} is not a classic SPL token account`);
    }
    const mintA = pubkey.decode(vaultAData, 0);
    const mintB = pubkey.decode(vaultBData, 0);
    // Mercurial's `Exchange` ix is legacy-SPL only (Tokenkeg vaults). SELF-DROP a
    // Token-2022 mint (or one carrying an un-routable extension) by throwing — the
    // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue. An
    // unreadable mint falls back to the legacy assumption (keeps existing tests green).
    const _mints = [mintA, mintB];
    const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
    for (let _i = 0; _i < _mints.length; _i++) {
        const mint = _mints[_i];
        const mintData = _mintDatas[_i];
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
    const vaultAOwner = pubkey.decode(vaultAData, 32);
    const vaultBOwner = pubkey.decode(vaultBData, 32);
    if (vaultAOwner !== authority) {
        throw new Error(`${SLUG}: pool ${pool} vault A owner ${vaultAOwner} does not match the derived authority ${authority}`);
    }
    if (vaultBOwner !== authority) {
        throw new Error(`${SLUG}: pool ${pool} vault B owner ${vaultBOwner} does not match the derived authority ${authority}`);
    }
    return {
        venue: SLUG,
        pool,
        direction: 'aToB',
        nonce,
        authority,
        vaultA,
        vaultB,
        mintA,
        mintB,
    };
}
/** Family facade for the recipe orchestrator (ladder-only, like orca-whirlpool/raydium-clmm/saber-stableswap). */
export const mercurial = {
    slug: SLUG,
    programId: MERCURIAL_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM,
    fetchPoolConfig: fetchMercurialPoolConfig,
};
//# sourceMappingURL=index.js.map