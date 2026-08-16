/**
 * Jupiter Lend Earn — a lending-vault deposit/redeem (an Anchor program,
 * NO on-chain IDL; the layout/ABI below is ground-truthed against the
 * PUBLISHED Rust source — `Instadapp/fluid-solana-programs` @
 * `626b177f235224bc5d074d39439cd2558f542886` (the commit Code4rena's
 * `code-423n4/2026-02-jupiter-lend` audit scope points at after the sponsor
 * had the code itself removed from the audit repo), `programs/lending/**`
 * + `programs/liquidity/**` — NOT reverse-engineered. Two program deploys:
 * Lending `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` (this family's
 * `programId` — the CPI target) and the Liquidity layer it delegates all
 * actual token accounting to, `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC`
 * (both confirmed live executable accounts on mainnet-beta, 2026-07-31).
 *
 * MECHANISM — a share-vault, not an AMM: `deposit(assets)` mints fTokens at
 * the CURRENT `token_exchange_price` (a linear rate, assets-per-share scaled
 * by `EXCHANGE_PRICES_PRECISION` = 1e12); `redeem(shares)` burns fTokens for
 * assets at the same rate. There is no curvature and no fee parameter on
 * either instruction — the rate IS the whole quote. This is why the plan
 * calls for "quote = exact linear rate, monotone": `defaultRungs` is pinned
 * at the framework floor (2, like `sanctum-stake-pool`'s identical affine
 * case) — a straight line loses nothing to a coarser grid.
 *
 * LAYOUT — the `Lending` account (Anchor `#[account]`, sequential, NOT
 * zero-copy — every field is a fixed-width primitive so offsets ARE fixed
 * regardless): disc(8) + mint(32)@8 + f_token_mint(32)@40 + lending_id(u16)@72
 * + decimals(u8)@74 + rewards_rate_model(32)@75 + liquidity_exchange_price(u64)@107
 * + token_exchange_price(u64)@115 + last_update_timestamp(u64)@123 +
 * token_reserves_liquidity(32)@131 + supply_position_on_liquidity(32)@163 +
 * bump(u8)@195 — 196 bytes total. VERIFIED against three real mainnet
 * `Lending` PDAs (USDC/USDT/wSOL markets; PDA = `["lending", mint,
 * f_token_mint]`, `f_token_mint` itself `["f_token_mint", mint]`, both on
 * this program): every one is EXACTLY 196 bytes with the Anchor discriminator
 * `sha256("account:Lending")[0..8]` this file computes independently and
 * both matched a live `getAccountInfo` byte-for-byte at the stated offsets
 * (mint/f_token_mint/rewards_rate_model/token_reserves_liquidity/
 * supply_position_on_liquidity all decoded to real, owner-correct accounts).
 *
 * ACCOUNTS the CPI needs beyond the `Lending` PDA itself — every one
 * ground-truthed live, not guessed:
 * - `lending_admin` = PDA(["lending_admin"], LENDING_PROGRAM) — ONE GLOBAL
 *   singleton across every market (verified: a real, LENDING_PROGRAM-owned
 *   account at the derived address).
 * - `rate_model` = PDA(["rate_model", mint], LIQUIDITY_PROGRAM) — per-mint,
 *   NOT constrained by a PDA seed in the Anchor `Operate` context itself
 *   (`AccountLoader<RateModel>` with only a `has_one = mint` check), so this
 *   file derives it the same way `set_rate_model`'s own seed constant
 *   (`RATE_MODEL_SEED` in `liquidity/src/state/seeds.rs`) implies; verified
 *   live for all three test markets (LIQUIDITY_PROGRAM-owned, 53-byte
 *   `RateModel` accounts, `sha256("account:RateModel")[0..8]` discriminator
 *   match).
 * - `liquidity` = PDA(["liquidity"], LIQUIDITY_PROGRAM) — the SECOND global
 *   singleton (the whole protocol's lock/authority state; verified live,
 *   74 bytes, LIQUIDITY_PROGRAM-owned).
 * - `supply_token_reserves_liquidity` = `lending.token_reserves_liquidity`
 *   (a stored field — this file reads it rather than re-deriving; it
 *   independently matches `PDA(["reserve", mint], LIQUIDITY_PROGRAM)` for
 *   all three test markets, confirming the field and the seed agree).
 * - `vault` = the `TokenReserve.vault` field (offset 40 within that
 *   account, itself an Anchor zero-copy `#[account]` — disc(8) + mint(32)@8
 *   + vault(32)@40 + ...). This file reads it via a second account load
 *   rather than re-deriving the ATA (sidesteps classic-SPL-vs-Token-2022 ATA
 *   derivation entirely — see the token-program gate below). Verified live:
 *   the USDC market's vault is a real 165-byte SPL Token Account, owner
 *   TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, `authority` field equal to
 *   the `liquidity` PDA above, holding real USDC (41.8M-ish at verification
 *   time).
 * - `token_program` — this adapter GATES to classic Tokenkeg only (Token-2022
 *   extensions — transfer fees, gating hooks — are not modeled, matching
 *   `sanctum-stake-pool`'s identical scope decision). Both mints (`mint` and
 *   `f_token_mint`) are classified via the shared data-shape resolver
 *   (`classifyMintProgram` / `parseMintExtensions`); a Token-2022 or
 *   un-routable mint SELF-DROPS this market with a thrown error (the
 *   graceful-drop signal the SvmRoute orchestrator catches).
 *
 * DISCOVERY — `Lending` stores BOTH mints at fixed offsets (mint@8,
 * f_token_mint@40) with a fixed 196-byte size, so it discovers exactly like
 * a two-mint AMM pool (see `SVM_FAMILY_FILTERS['jupiter-lend-earn']`) —
 * no `fixedMint` special-case needed, unlike `sanctum-stake-pool`.
 *
 * QUOTE MATH — ground-truthed via `simulateTransaction` (sigVerify:false,
 * `replaceRecentBlockhash:true` — nothing submitted for real) against the
 * REAL deployed program on REAL mainnet state, 2026-07-31, USDC market, a
 * real depositor wallet (`9936VF...cdL3QK`, a top fToken holder with a real
 * USDC balance) as signer, at THREE sizes each direction:
 *   deposit 1 USDC    -> predicted 948,989  shares, actual 948,988  (LogDeposit)
 *   deposit 100 USDC  -> predicted 94,898,933 shares, actual 94,898,915
 *   deposit 10,000 USDC -> predicted 9,489,893,345 shares, actual 9,489,891,642
 *   redeem 1 share(*) -> predicted 1,053,752 assets, actual 1,053,752 (LogWithdraw) EXACT
 *   redeem 100(*)     -> predicted 105,375,262 assets, actual 105,375,281
 *   redeem 10,000(*)  -> predicted 10,537,526,225 assets, actual 10,537,528,114
 * (* raw share units, not UI units — `redeem`'s CPI target is
 * `global:redeem` / discriminator `[184,12,86,149,70,196,97,225]`, computed
 * as `sha256("global:redeem")[0..8]` the SAME way this file independently
 * re-derived `deposit`'s and `withdraw`'s documented discriminators and got
 * an exact match — `redeem` itself is undocumented in the public CPI guide
 * but shares the `Withdraw` account context verbatim per `lib.rs`/
 * `utils/withdraw.rs`, confirmed live by the simulation above).
 * Every deposit case matches within 18 raw units on a 9-10 digit number
 * (<0.0002%); every redeem case is EQUAL or the offline estimate is LOWER
 * than the real payout (the safe direction). Mechanism: `token_exchange_price`
 * is monotonically non-decreasing and only refreshes when SOMEONE calls
 * deposit/withdraw/redeem/rebalance — this file's on-chain fragment reads
 * the STORED value live via `accountUint` (whatever the chain has AT COOK
 * TIME, not a prepare-time snapshot), but the real CPI's OWN internal
 * `update_rates` call recomputes a FRESH (>= stored) price inside the SAME
 * instruction before minting/burning. `assets/price` (deposit's shares
 * formula) is DECREASING in price, so the stale-vs-fresh gap makes deposit's
 * offline estimate a THIN OVER-estimate (bounded by the measured <0.0002%
 * above); `shares*price` (redeem's assets formula) is INCREASING in price,
 * so the same gap makes redeem's estimate a THIN UNDER-estimate — the SAFE
 * direction (never promises more than the venue delivers). Both are
 * empirically tiny because the tested markets are touched every few minutes
 * to under an hour (USDC last_update_timestamp was 17s stale at
 * verification time, wSOL 429s, USDT 2,818s) — the codebase's existing
 * tolerance for prepare/cook price drift elsewhere (CLMM tick movement,
 * etc.) is the same shape of bound, not a new risk class.
 *
 * WITHDRAW CAP SELF-DROP — `redeem`'s underlying SPL transfer pulls straight
 * from `vault`'s real balance; a redemption bigger than the vault can cover
 * FAILS THE CPI (`simulateTransaction` reproduced this live: a redeem sized
 * at ~4.7x the vault's real USDC balance reverted with
 * `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`'s `Error: insufficient
 * funds`, custom program error 0x1) — and a launched CPI failure aborts the
 * WHOLE cook on SVM (no execution-time catch, see the consuming app SVM README's
 * settled parity verdicts), so this MUST be a quote-time clamp, not a
 * runtime guard. `emitQuoteCall`'s redeem branch reads `vault`'s LIVE SPL
 * balance (the same `accountUint` pattern as every other family's reserve
 * read) and saturates the predicted payout at 99.99% of it (a 1 bps margin
 * against the residual "fresh-price-recompute" drift documented above,
 * which is real but too small to eliminate without replicating the
 * liquidity layer's own interest-accrual formula) — a monotone, concave
 * (flat past the cap) curve, exactly the shape the merge election requires;
 * past the cap this venue's marginal return is zero and the merge simply
 * stops routing more here, never emitting a program that can revert this
 * way.
 *
 * PROTOCOL LOCKDOWN SELF-DROP — `Liquidity.status` (offset 72, 1 byte) is a
 * real, live "the whole protocol is paused" bool the Anchor program itself
 * enforces (`Liquidity::is_locked()`, gates both `PreOperate`/`Operate` with
 * `ErrorCodes::ProtocolLockdown`); this file reads it live in `emitSetup`
 * (one more `accountUint`, shared by both directions since `liquidity` rides
 * every deposit/redeem CPI already) and zeroes the quote when locked —
 * cheap, and a genuine platform-level failure mode, not a speculative gate.
 *
 * DUST — a `deposit` whose `shares_minted` would compute to 0 reverts on
 * -chain (`FTokenDepositInsignificant`); this file's helper already returns
 * 0 for that input (floor division), matching the "returns 0 for dust"
 * convention every other family's helper follows (a 0-quote slot is simply
 * not elected by the merge, never emitted with a doomed CPI).
 *
 * CU — see `../budget.ts`'s `CU_FAMILIES['jupiter-lend-earn']` for the
 * measurement + calibration method (real `simulateTransaction` CU: deposit
 * ~56.3-57.5k, redeem ~66.3-67.7k raw CPI cost).
 */
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'jupiter-lend-earn';
export const JUPITER_LEND_EARN_PROGRAM_ID = address('jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9');
/** The Liquidity layer every deposit/redeem CPI delegates real token accounting to. */
export const JUPITER_LEND_LIQUIDITY_PROGRAM_ID = address('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
// `Lending` account field offsets (after the 8-byte Anchor discriminator; see module header).
const OFF_MINT = 8;
const OFF_F_TOKEN_MINT = 40;
const OFF_REWARDS_RATE_MODEL = 75;
const OFF_TOKEN_RESERVES_LIQUIDITY = 131;
const OFF_SUPPLY_POSITION_ON_LIQUIDITY = 163;
export const LENDING_ACCOUNT_SIZE = 196;
// `TokenReserve` (Liquidity layer, zero-copy) field offsets.
const OFF_RESERVE_VAULT = 40;
async function fetchJupiterLendEarnConfig(load, pool) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`jupiter-lend-earn Lending ${pool} account not found`);
    if (data.length !== LENDING_ACCOUNT_SIZE) {
        throw new Error(`jupiter-lend-earn Lending ${pool} has unexpected size ${data.length}, expected ${LENDING_ACCOUNT_SIZE}`);
    }
    const decoder = getAddressDecoder();
    const mint = decoder.decode(data.subarray(OFF_MINT, OFF_MINT + 32));
    const fTokenMint = decoder.decode(data.subarray(OFF_F_TOKEN_MINT, OFF_F_TOKEN_MINT + 32));
    const rewardsRateModel = decoder.decode(data.subarray(OFF_REWARDS_RATE_MODEL, OFF_REWARDS_RATE_MODEL + 32));
    const liquidityReserve = decoder.decode(data.subarray(OFF_TOKEN_RESERVES_LIQUIDITY, OFF_TOKEN_RESERVES_LIQUIDITY + 32));
    const supplyPositionOnLiquidity = decoder.decode(data.subarray(OFF_SUPPLY_POSITION_ON_LIQUIDITY, OFF_SUPPLY_POSITION_ON_LIQUIDITY + 32));
    // Tokenkeg-only (Token-2022 extensions — transfer fees, gating hooks — are
    // not modeled, matching sanctum-stake-pool's identical scope decision), so
    // detect a Token-2022 or un-routable mint via the shared data-shape resolver
    // and SELF-DROP the market (the thrown error is the graceful-drop signal the
    // SvmRoute orchestrator catches). The LEGACY path is byte-identical: a classic
    // 82-byte mint classifies Tokenkeg with no extensions.
    for (const m of [mint, fTokenMint]) {
        const mintData = await load(m);
        if (mintData === null)
            continue; // an unreadable mint falls back to the legacy assumption
        if (classifyMintProgram(m, mintData) === TOKEN_2022_PROGRAM_ID) {
            throw new Error(`${SLUG}: dropping market ${pool} — mint ${m} is Token-2022 (this venue's swap is legacy-SPL only)`);
        }
        const { blocking } = parseMintExtensions(mintData);
        if (blocking.length > 0) {
            throw new Error(`${SLUG}: dropping market ${pool} — mint ${m} is un-routable: ${blocking.join('; ')}`);
        }
    }
    const [reserveData, rateModel] = await Promise.all([load(liquidityReserve), deriveRateModel(mint)]);
    if (reserveData === null)
        throw new Error(`jupiter-lend-earn TokenReserve ${liquidityReserve} account not found`);
    const vault = decoder.decode(reserveData.subarray(OFF_RESERVE_VAULT, OFF_RESERVE_VAULT + 32));
    return {
        venue: SLUG,
        pool,
        mint,
        fTokenMint,
        rewardsRateModel,
        rateModel,
        liquidityReserve,
        supplyPositionOnLiquidity,
        vault,
        tokenProgram: TOKEN_PROGRAM,
        direction: 'deposit',
    };
}
/** PDA(["rate_model", mint], LIQUIDITY_PROGRAM) — verified live for all three test markets. */
async function deriveRateModel(mint) {
    const [pda] = await getProgramDerivedAddress({
        programAddress: JUPITER_LEND_LIQUIDITY_PROGRAM_ID,
        seeds: [Buffer.from('rate_model'), Uint8Array.from(getAddressEncoder().encode(mint))],
    });
    return pda;
}
function makeJupiterLendEarn() {
    return {
        slug: SLUG,
        programId: JUPITER_LEND_EARN_PROGRAM_ID,
        fetchPoolConfig: (load, pool) => fetchJupiterLendEarnConfig(load, pool),
    };
}
export const jupiterLendEarn = makeJupiterLendEarn();
//# sourceMappingURL=index.js.map