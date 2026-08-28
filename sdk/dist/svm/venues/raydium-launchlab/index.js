/**
 * Raydium LaunchLab (program `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`) — a
 * launchpad bonding-curve AMM: every token trades on a single `PoolState`
 * account against `GlobalConfig`-owned protocol fee params and
 * `PlatformConfig`-owned platform/creator fee params until it migrates to a
 * Raydium AMM/CPMM pool (a DISTINCT program/account this adapter never
 * touches). Jupiter's own label for this program is `"Raydium Launchlab"`
 * (`benchmark/adapters/fixtures/jupiter-program-id-to-label.json`).
 *
 * GROUND TRUTH: the on-chain Anchor IDL was pulled from the program's own IDL
 * account (`createWithSeed(findProgramAddress([], program).0, "anchor:idl",
 * program)`, 14,688 raw bytes / 9,988 zlib-compressed, 68,052 bytes
 * decompressed) and cross-checked field-by-field against a REAL
 * `simulateTransaction` (`sigVerify:false`, impersonating a real funded
 * mainnet wallet) executed against the REAL deployed program on REAL mainnet
 * state — see "VALIDATION" below.
 *
 * POOLSTATE ACCOUNT (disc `sha256("account:PoolState")[:8]` = f7ede3f5d7c3de46)
 * is a FIXED 429-byte struct:
 *   epoch u64@8  auth_bump u8@16  status u8@17  base_decimals u8@18
 *   quote_decimals u8@19  migrate_type u8@20  supply u64@21
 *   total_base_sell u64@29  virtual_base u64@37  virtual_quote u64@45
 *   real_base u64@53  real_quote u64@61  total_quote_fund_raising u64@69
 *   quote_protocol_fee u64@77  platform_fee u64@85  migrate_fee u64@93
 *   vesting_schedule (40 bytes)@101  global_config pubkey@141
 *   platform_config pubkey@173  base_mint pubkey@205  quote_mint pubkey@237
 *   base_vault pubkey@269  quote_vault pubkey@301  creator pubkey@333
 *   token_program_flag u8@365  amm_creator_fee_on u8@366
 *   platform_vesting_share u64@367  padding[54]@375
 * (offsets independently re-derived here from the IDL's own struct layout,
 * not hand-counted — they match the plan's cited base_mint@205/quote_mint@237/
 * base_vault@269/quote_vault@301/token_program_flag@365 exactly).
 *
 * CURVE: `GlobalConfig.curve_type` (u8@16, NOT stored on PoolState itself —
 * only the config referenced by `PoolState.global_config` carries it) selects
 * one of three closed-form curves at pool-CREATION time (Constant=0, Fixed=1,
 * Linear=2 — the raydium-sdk-v2 TS SDK's `Curve.getCurve` switch), but EVERY
 * TRADE after creation runs the SAME constant-product invariant over
 * `(virtual_quote + real_quote, virtual_base - real_base)` regardless of
 * which curve minted the pool's initial virtual reserves — confirmed by
 * `LaunchConstantProductCurve.buyExactIn/sellExactIn`
 * (raydium-sdk-v2/src/raydium/launchpad/curve/constantProductCurve.ts) being
 * the formula EVERY already-created pool's trade path runs, independent of
 * `curve_type`. The Fixed/Linear curve TYPES only differ in how a pool's
 * virtual reserves are DERIVED at `initialize` time (a linear-price curve
 * needs an integer sqrt this SauceScript environment has no intrinsic for on
 * this surface, and neither this adapter nor the reference math needs to
 * reproduce that one-time derivation at all — it only ever reads the
 * ALREADY-BAKED virtual_base/virtual_quote off PoolState). So the constant-
 * product TRADE formula below serves every curve_type transparently, with
 * ONE exception this adapter narrows on: **this module implements the
 * classic constant-product trade path only and does not special-case any
 * curve-type-dependent trade variant that might exist beyond it** — if a
 * future program revision ever branches trade math on curve_type (unverified
 * today; every real pool sampled trades via the one shared formula above),
 * `fetchPoolConfig` has no way to detect that from PoolState alone and this
 * scope note is the disclosed boundary, not a per-pool gate.
 *
 * FEE MODEL: `total_fee_rate = GlobalConfig.trade_fee_rate (u64@27) +
 * PlatformConfig.fee_rate (u64@104) + PlatformConfig.creator_fee_rate
 * (u64@720)` (+ a caller `share_fee_rate` ix arg this adapter always passes
 * 0 for — no referral share claimed), all in ppm-of-1,000,000 (confirmed:
 * FEE_RATE_DENOMINATOR_VALUE = 1_000_000 in raydium-sdk-v2/src/common/fee.ts).
 * BUY (`buy_exact_in`, exact quote in): fee is ceil-taken off the INPUT
 * (`Curve.buyExactIn`'s `calculateFee`), the constant-product formula runs on
 * the net; SELL (`sell_exact_in`, exact base in): fee is ceil-taken off the
 * GROSS OUTPUT (`Curve.sellExactIn`). Both mirrored exactly in `qLaunchlabBuy`/
 * `qLaunchlabSell` below and in `referenceQuote`.
 *
 * CAPACITY (BUY only): a pool sells at most `total_base_sell - real_base`
 * base tokens before it must migrate — `Curve.buyExactIn` clamps to that
 * remainder and recomputes the ACTUAL quote consumed via `buyExactOut`
 * (refunding the caller's excess quote) rather than reverting. This adapter
 * instead SATURATES the raw constant-product quote at that remainder
 * (`raw > cap ? cap : raw`) — monotone non-decreasing, flat past capacity,
 * same shape carrot.ts's `netOut = min(computed, ataBalance_t)` and
 * meteora-damm-v2's SVM ladder fix use (see CLAUDE.md's "a coarse or
 * non-monotone ladder gets allocated ZERO" note) — rather than reproducing
 * the real program's exact-refund boundary transaction bit-for-bit (a single
 * discrete trade at the curve's migration edge, never exercised by any
 * VALIDATION size below, all of which stay far under the pool's remaining
 * capacity). SELL has no analogous cap: the constant-product formula is
 * asymptotically bounded under `virtual_quote + real_quote` for any finite
 * input, so it never needs a clamp.
 *
 * SCOPE / SELF-DROP (fetchPoolConfig throws, caught by `resolveSvmPoolSpec`
 * — one bad pool never kills discovery):
 *   - `status !== 0` (Fund/actively-fundraising bonding-curve phase; Migrate=1
 *     never observed live, Trade=2 is a POST-migration/fully-raised pool that
 *     no longer serves this trade path — measured live: every one of a
 *     12,816-pool status=2 sample already has `real_quote >= total_quote_
 *     fund_raising`, i.e. already at/past its raise cap).
 *   - `GlobalConfig.curve_type !== 0` (Fixed/Linear curve-TYPE pools are not
 *     rejected for their trade math — see the CURVE note above, the shared
 *     formula covers them — but this module has not independently verified a
 *     Fixed/Linear-originated pool trades identically on a REAL
 *     simulateTransaction the way the Constant-curve VALIDATION below did,
 *     so it narrows to curve_type===0 until that's done rather than ship an
 *     unverified path).
 *   - `token_program_flag` outside {0 (Tokenkeg), 1 (Token-2022)}.
 *   - a Token-2022 base mint (flag===1) carrying a `TransferFeeConfig`
 *     extension (type 1) — same rejection pumpswap/pumpfun-bonding-curve
 *     apply, and for the same reason: it would make vault/ATA deltas diverge
 *     from the amounts this module's constant-product math assumes. A
 *     classic Tokenkeg mint (flag===0) is exactly 82 bytes and structurally
 *     cannot carry any extension, so this check only ever fetches the base
 *     mint account when flag===1.
 *   - the quote token program is NOT separately flagged: the IDL's own
 *     `quote_token_program` account carries a FIXED address constraint
 *     (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) — the real program only
 *     ever accepts a classic-Tokenkeg quote mint, so this adapter hardcodes
 *     `TOKEN_PROGRAM` for the quote side unconditionally (no gate needed).
 *
 * ACCOUNTS / REMAINING ACCOUNTS: `buy_exact_in`/`sell_exact_in` (disc
 * `[250,234,13,123,213,156,19,236]` / `[149,39,222,155,211,124,152,26]`, args
 * `amount_in:u64, minimum_amount_out:u64, share_fee_rate:u64`) take the 15
 * IDL-named accounts (payer, `auth` PDA(["vault_auth_seed"]), global_config,
 * platform_config, pool_state, user_base_token, user_quote_token, base_vault,
 * quote_vault, base_mint, quote_mint, base_token_program, quote_token_program,
 * `event_authority` PDA(["__event_authority"]), program) PLUS THREE remaining
 * accounts the IDL does not list at all (confirmed only by reading
 * raydium-sdk-v2's own instruction builder,
 * `src/raydium/launchpad/instrument.ts`'s `buyExactInInstruction` — calling
 * with just the 15 named accounts fails live with Anchor custom error 6018
 * `NotEnoughRemainingAccounts`, reproduced directly): `system_program`, then
 * `platformClaimFeeVault` = PDA([platform_config, quote_mint], PROGRAM) and
 * `creatorClaimFeeVault` = PDA([creator, quote_mint], PROGRAM) — both
 * writable, both lazily create-able by the ix itself when missing (observed
 * live: the sampled pool's creatorClaimFeeVault did not exist pre-trade and
 * the buy still succeeded). A `shareFeeReceiver` remaining account exists in
 * the SDK builder too but only when `share_fee_rate > 0`; this adapter always
 * passes `share_fee_rate = 0` so it is never attached.
 *
 * AUTH/EVENT_AUTHORITY are fixed program-level PDAs (independent of any
 * pool) — computed once and hardcoded here, verified against the derivation
 * live, same convention pumpswap/pumpfun-bonding-curve use for their own
 * fixed PDAs.
 *
 * VALIDATION (`test/svm/venues/raydium-launchlab.test.ts` pins these as
 * golden values): 3 real `simulateTransaction` calls (`sigVerify:false`,
 * impersonating a real wallet with prior activity on this exact pool,
 * `rayvTLcCMDs7P5tgpuoNA6ZYeLERegeCphdqLSgdKms`) against the REAL deployed
 * program on pool `At3uPTXn5xpVfm4DehXCsm85Zzu1xktGV2vQo5TyBW2E` (mint
 * `468p9uWnbsszSHKqPTbF6mYPsDroq7BAozfY4xypbonk`, curve_type=0,
 * trade_fee_rate=2500, platform fee_rate=12500, creator_fee_rate=0 — total
 * 15,000 ppm = 1.5%), reading the realized output from the simulation's
 * POST-state account override (`accounts` param) — not an estimate, the
 * chain's own post-instruction token balance:
 *   BUY   100,000,000 lamports in  (vb=1,073,025,605,596,382,
 *         vq=30,000,852,951, rb=20,781,235,464,257, rq=592,500,002)
 *         -> 3,376,989,672,690 base (58,172 CU for the CPI itself)
 *   BUY 1,000,000,000 lamports in  (same reserves) -> 32,821,873,456,249 base
 *   BUY 5,000,000,000 lamports in  (same reserves) -> 145,904,950,315,636 base
 * `qLaunchlabBuy`/`referenceQuote` below reproduce every one of these
 * bit-for-bit (see the test). A combined buy(2 SOL)-then-sell(50e12 base) in
 * one simulated transaction additionally confirmed the SELL formula
 * bit-exact against the chain's realized net quote-out (1,544,161,703,
 * 46,064 CU for that CPI) over the POST-buy reserves.
 */
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'raydium-launchlab';
function address_(s) {
    return s;
}
export const RAYDIUM_LAUNCHLAB_PROGRAM_ID = address_('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
const TOKEN_PROGRAM = address_('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address_('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const POOL_STATE_DISCRIMINATOR = [247, 237, 227, 245, 215, 195, 222, 70];
const GLOBAL_CONFIG_DISCRIMINATOR = [149, 8, 156, 202, 160, 252, 176, 217];
const PLATFORM_CONFIG_DISCRIMINATOR = [160, 78, 128, 0, 248, 83, 230, 160];
function hasDiscriminator(data, discriminator) {
    return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}
function pubkeyAt(data, offset) {
    return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
async function pda(seeds, programAddress) {
    const encoder = getAddressEncoder();
    const rawSeeds = seeds.map((s) => (typeof s === 'string' ? new Uint8Array(encoder.encode(s)) : s));
    const [derived] = await getProgramDerivedAddress({ programAddress, seeds: rawSeeds });
    return derived;
}
async function loadAccount(load, addr, what) {
    const data = await load(addr);
    if (data === null)
        throw new Error(`${SLUG} ${what} ${addr} not found`);
    return data;
}
/**
 * flag===0 -> classic Tokenkeg (structurally cannot carry any extension, so
 * this never reads the mint at all); flag===1 -> Token-2022, and the mint IS
 * fetched to reject a TransferFeeConfig extension (type 1) — same convention
 * pumpswap/pumpfun-bonding-curve use for their own base-mint gate.
 */
async function resolveBaseTokenProgram(load, mint, flag) {
    if (flag === 0)
        return TOKEN_PROGRAM;
    if (flag !== 1)
        throw new Error(`${SLUG} pool base mint ${mint} has unknown token_program_flag ${flag} (expected 0 or 1)`);
    const data = await loadAccount(load, mint, 'base mint');
    if (data.length === 82)
        return TOKEN_PROGRAM; // no extension room possible
    if (data.length < 166) {
        throw new Error(`${SLUG} base mint ${mint} data is ${data.length} bytes, not a token-2022 mint layout`);
    }
    if (data[165] !== 1) {
        throw new Error(`${SLUG} base mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`);
    }
    // Un-routable (blocking) extensions self-drop: a NonTransferable or
    // default-frozen base mint cannot move through a plain transferChecked.
    // Advisory extensions (PermanentDelegate / ConfidentialTransfer) are NOT
    // blocking, so a zero-fee/advisory-only T22 base mint still routes.
    const { blocking } = parseMintExtensions(data);
    if (blocking.length > 0) {
        throw new Error(`${SLUG} gate: base mint ${mint} is un-routable — ${blocking.join('; ')}`);
    }
    let offset = 166;
    while (offset + 4 <= data.length) {
        const extensionType = data[offset] | (data[offset + 1] << 8);
        const extensionLength = data[offset + 2] | (data[offset + 3] << 8);
        if (extensionType === 0)
            break;
        if (extensionType === 1) {
            // TODO(t22-fee-netting): a TransferFeeConfig makes the vault/ATA delta
            // diverge from the user amount on both legs. Correct handling nets the fee
            // (netTransferAmount) consistently in the on-chain quote fragment AND the
            // TS reference quote, and needs the mint's fee TLV read on-chain — out of
            // scope for this pass. Keep the safe self-limiting rejection so a
            // fee-bearing pool drops out rather than risk a favourable mis-quote.
            throw new Error(`${SLUG} gate: base mint ${mint} carries a token-2022 TransferFeeConfig extension (vault/ATA deltas would not match this ladder's constant-product math)`);
        }
        offset += 4 + extensionLength;
    }
    return TOKEN_2022_PROGRAM;
}
export const raydiumLaunchlab = {
    slug: SLUG,
    kind: 'constant-product',
    programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    async fetchPoolConfig(load, pool) {
        const poolData = await loadAccount(load, pool, 'pool');
        if (!hasDiscriminator(poolData, POOL_STATE_DISCRIMINATOR)) {
            throw new Error(`${SLUG} pool ${pool} discriminator mismatch (not a PoolState account)`);
        }
        if (poolData.length < 429) {
            throw new Error(`${SLUG} pool ${pool} data is ${poolData.length} bytes, expected at least 429`);
        }
        const status = poolData[17];
        if (status !== 0) {
            throw new Error(`${SLUG} pool ${pool} gate: status is ${status}, not 0 (Fund/actively-fundraising) — already migrated or fully raised`);
        }
        const tokenProgramFlag = poolData[365];
        const globalConfig = pubkeyAt(poolData, 141);
        const platformConfig = pubkeyAt(poolData, 173);
        const baseMint = pubkeyAt(poolData, 205);
        const quoteMint = pubkeyAt(poolData, 237);
        const baseVault = pubkeyAt(poolData, 269);
        const quoteVault = pubkeyAt(poolData, 301);
        const creator = pubkeyAt(poolData, 333);
        const [globalData, platformData, baseTokenProgram] = await Promise.all([
            loadAccount(load, globalConfig, 'global config'),
            loadAccount(load, platformConfig, 'platform config'),
            resolveBaseTokenProgram(load, baseMint, tokenProgramFlag),
        ]);
        if (!hasDiscriminator(globalData, GLOBAL_CONFIG_DISCRIMINATOR)) {
            throw new Error(`${SLUG} global config ${globalConfig} discriminator mismatch`);
        }
        if (!hasDiscriminator(platformData, PLATFORM_CONFIG_DISCRIMINATOR)) {
            throw new Error(`${SLUG} platform config ${platformConfig} discriminator mismatch`);
        }
        const curveType = globalData[16];
        if (curveType !== 0) {
            throw new Error(`${SLUG} pool ${pool} gate: global config ${globalConfig} curve_type is ${curveType} (only Constant=0 is implemented; Fixed=1/Linear=2 are unverified)`);
        }
        const [platformVault, creatorVault] = await Promise.all([
            pda([platformConfig, quoteMint], RAYDIUM_LAUNCHLAB_PROGRAM_ID),
            pda([creator, quoteMint], RAYDIUM_LAUNCHLAB_PROGRAM_ID),
        ]);
        return {
            venue: SLUG,
            pool,
            direction: 'quoteToBase',
            globalConfig,
            platformConfig,
            baseMint,
            quoteMint,
            baseVault,
            quoteVault,
            baseTokenProgram,
            platformVault,
            creatorVault,
        };
    },
};
//# sourceMappingURL=index.js.map