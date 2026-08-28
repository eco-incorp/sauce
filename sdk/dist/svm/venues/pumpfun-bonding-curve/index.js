/**
 * Pump.fun bonding curve (program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) — the
 * PRE-migration constant-product curve every pump.fun token trades on before it
 * graduates to the AMM (`pumpswap`, already wired as its own family — a DISTINCT
 * program and a DISTINCT account, `BondingCurve` vs `Pool`). Jupiter's own label for
 * this program is bare `"Pump.fun"` (`benchmark/adapters/fixtures/jupiter-program-id-to-label.json`),
 * mapped in `benchmark/adapters/_svm-venues.ts`.
 *
 * EVERYTHING below is ground-truthed against REAL mainnet state and a REAL simulated
 * CPI (no assumptions, no third-party SDK): the on-chain Anchor IDL was pulled from
 * the program's own IDL account (`createAddressWithSeed(findProgramAddress([],
 * program).0, "anchor:idl", program)`, 18,938 raw bytes / 9,469 zlib-compressed,
 * 80,901 bytes decompressed — the exact byte counts this module's PR description
 * cites), and every account offset, PDA seed and fee formula below was cross-checked
 * against a live `simulateTransaction` (`sigVerify:false`, impersonating a real
 * whale wallet holding both native SOL and every needed ATA) executed against the
 * REAL deployed program on REAL mainnet state — see "VALIDATION" below.
 *
 * BONDING-CURVE ACCOUNT (`BondingCurve`, disc `sha256("account:BondingCurve")[:8]` =
 * 17b7f83760d8ac60) is a FIXED 115-byte struct when freshly created (older/extended
 * curves can carry extra zeroed tail bytes past 115 from an `extend_account` upgrade
 * — the fields below never move, so this module reads only the fixed prefix):
 *   virtual_token_reserves u64 @8    virtual_quote_reserves u64 @16
 *   real_token_reserves    u64 @24   real_quote_reserves    u64 @32
 *   token_total_supply     u64 @40   complete bool @48   creator pubkey @49
 *   is_mayhem_mode bool @81   is_cashback_coin bool @82   quote_mint pubkey @83
 * `quote_mint` is the SystemProgram sentinel (all-zero) for every CLASSIC
 * native-SOL-quoted curve — the only variant this module serves (SCOPE below).
 *
 * SCOPE (a real, disclosed narrowing, not a refusal): this module serves ONLY
 * classic native-SOL-quoted curves (`quote_mint` == the SystemProgram sentinel —
 * measured live: every actively-traded curve sampled). A curve that opted into an
 * alternate SPL quote mint (`add_quote_mint`, an admin-gated, currently-rare
 * instruction) is REJECTED at fetch time with a named error — it would need the
 * `_v2` instructions' arbitrary-quote-mint accounts (a superset of what is modeled
 * here) and is a natural follow-up, not a blocker for the classic case (464.6M/7d
 * volume this venue plan cites is overwhelmingly classic curves). MAYHEM-mode and
 * CASHBACK-flagged curves are ALSO rejected at fetch time: both add mandatory
 * remaining-account requirements this module's fixed 26/27-account CPI shape does
 * not carry (confirmed live: a mayhem curve's `buy_exact_sol_in`/`sell` needs extra
 * fee-recipient wiring the classic path doesn't, and a cashback curve's `sell` needs
 * a `bonding_curve_v2` remaining account with no documented derivation) — both are a
 * minority of live curves and a clean follow-up, not a reason to block the
 * overwhelming-majority classic case.
 *
 * WHY THE `_v2` INSTRUCTIONS, NOT THE "CLASSIC" NATIVE-SOL ONES: the classic
 * `buy`/`sell`/`buy_exact_sol_in` instructions move NATIVE LAMPORTS directly out of
 * the `user` wallet account (no SPL "quote" token account at all in their account
 * list) — fundamentally incompatible with this recipe's SwapUser.inAta/outAta
 * contract, which every other family assumes is a real SPL token account on BOTH
 * sides. `buy_exact_quote_in_v2`/`sell_v2` are the SAME underlying curve math
 * generalized to an arbitrary SPL `quote_mint` — confirmed live: Jupiter itself
 * routes classic (system-sentinel-quote_mint) curves through `sell_v2` with
 * `quote_mint` hardcoded to wSOL (`So11111111111111111111111111111111111111112`)
 * and `quote_token_program` hardcoded to classic Tokenkeg (real tx
 * `C8i9FBu8JZ5YnjEBLQ9vCgJAi6J7FkBoZerEffeee4tNwjmX3gmb5RyYX58NyCwBm1mbaD318qqJHKsc5dJqUpA`,
 * pool `GTqFKtb4dW5KJFGm1uokLj7eaAmv7C88xfNwh1Krmxtu` / mint
 * `BXZc6HkQFPZBTbCt1wawvLAsYyH7vEGCY4u8DCwEpump`) — so this module does the same:
 * every account is a real SPL ATA (wSOL-denominated on the quote side), fitting the
 * ladder's inAta/outAta contract with ZERO special-casing for native SOL.
 *
 * FEE MODEL (from the program's OWN doc comment on `buy_exact_sol_in`, reproduced
 * verbatim in the decompressed IDL and confirmed byte-exact against 5 real
 * simulated trades — see VALIDATION): `total_bps = protocol_fee_bps +
 * creator_fee_bps` (creator_fee_bps is 0 when the curve has no creator — the
 * DEFAULT_PUBKEY convention the pumpswap adapter already documents); a FeeConfig
 * PDA (`["fee_config", PROGRAM_ID]` under the shared fee program
 * `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` — the SAME account TYPE pumpswap's
 * adapter reads, but at a DIFFERENT, program-namespaced address) carries a
 * market-cap fee-tier vec (mirroring pumpswap's `parseFeeTiers`/`pickFeeTier`,
 * market cap computed from VIRTUAL reserves — pump.fun's own public "market cap"
 * definition, `virtualQuoteReserves/virtualTokenReserves * tokenTotalSupply` — the
 * SAME definition whether or not a trade has happened, unlike pumpswap's canonical
 * branch which uses REAL vault balances for an already-migrated AMM pool).
 * `lp_fee_bps` is ALWAYS 0 for a bonding curve (there is no LP) and is not read.
 *
 *   BUY (quoteToBase, exact wSOL in via `buy_exact_quote_in_v2`):
 *     net = floor(spendable * 10000 / (10000 + total_bps))
 *     fees = ceil(net * protocol_bps / 10000) + ceil(net * creator_bps / 10000)
 *     if net + fees > spendable: net -= (net + fees - spendable)
 *     tokens_out = net < 2 ? 0 : floor((net - 1) * virtual_token / (virtual_quote + net - 1))
 *   SELL (baseToQuote, exact base tokens in via `sell_v2`):
 *     gross = floor(virtual_quote * tokens_in / (virtual_token + tokens_in))
 *     fee = ceil(gross * protocol_bps / 10000) + ceil(gross * creator_bps / 10000)
 *     net_out = fee > gross ? 0 : gross - fee
 *
 * VALIDATION (`test/svm/venues/pumpfun-bonding-curve.test.ts` pins these as golden
 * values): 5 real `simulateTransaction` calls (`sigVerify:false`, impersonating whale
 * `62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV`) against the REAL deployed program
 * on pool `GTqFKtb4dW5KJFGm1uokLj7eaAmv7C88xfNwh1Krmxtu` (mint
 * `BXZc6HkQFPZBTbCt1wawvLAsYyH7vEGCY4u8DCwEpump`, protocol_fee_bps=95,
 * creator_fee_bps=30 throughout), decoding the program's own `TradeEvent` self-CPI
 * log (Anchor event, disc `bddb7fd34ee661ee`) for the REALIZED amount — not a
 * simulated balance delta, the program's OWN reported trade size:
 *   BUY  10,000,000 lamports in @ (vt=1,013,085,213,636,744, vq=31,774,227,494) -> 314,804,458,164 tokens
 *   BUY  50,000,000 lamports in @ (same reserves)                                -> 1,572,068,569,080 tokens
 *   BUY  1,000,000,000 lamports in @ (same reserves)                             -> 30,540,919,244,948 tokens
 *   SELL 500,000,000 tokens in @ (vt=1,006,826,077,267,050, vq=31,971,758,357)    -> gross 15,877 (fee 151 + creator 48)
 *   SELL 50,000,000,000 tokens in @ (same reserves)                              -> gross 1,587,670 (fee 15,083 + creator 4,764)
 * `referenceQuote` below reproduces every one of these bit-for-bit (see the test).
 *
 * CPI SHAPE: `buy_exact_quote_in_v2` (disc `[194,171,28,70,104,77,91,47]`, args
 * spendable_quote_in:u64, min_tokens_out:u64 — 27 accounts) / `sell_v2` (disc
 * `[93,246,130,60,231,233,64,178]`, args amount:u64, min_sol_output:u64 — 26
 * accounts, one fewer: no `global_volume_accumulator`). Both account orders below
 * are the EXACT order confirmed against the real transaction cited above (Anchor
 * CPI account order is load-bearing — a swapped pair silently targets the wrong
 * account). `buyback_fee_recipient` (a fixed per-slot choice from
 * `Global.buyback_fee_recipients[0]`, currently 8 candidates, ANY of which is valid
 * — it only decides where the buyback cut lands, never the quote) and
 * `fee_recipient` (`Global.fee_recipients[0]`) are baked at fetch time; ONLY this
 * "plain" `fee_recipients` set authorizes a CLASSIC (non-mayhem) curve's trade —
 * `Global.reserved_fee_recipients` is the DIFFERENT set mayhem-mode curves check
 * (confirmed live: swapping the two sets flips which curve class authorizes).
 *
 * THE BONDING-CURVE ACCOUNT DOES NOT EMBED ITS OWN MINT (unlike every other wired
 * family's pool account): `BondingCurve`'s 115 fixed bytes have no mint field at
 * all — the account'S OWN ADDRESS is the mint's PDA (`["bonding-curve", mint]`),
 * a ONE-WAY derivation. So `fetchPoolConfig` here needs the mint as an EXPLICIT
 * third argument (`FamilyEntry.fetch`'s `mint` parameter, `SvmRoutePoolSpec.mint`
 * — see the consuming app SVM solver entry) that every other family ignores; the discovery-side
 * fix (deriving the PDA forward from a candidate mint, never scanning by mint
 * offset) lives in `withPumpfunBondingCurveDiscovery` (the consuming app SVM discovery module).
 */
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { readUintLE } from '../math.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'pumpfun-bonding-curve';
export const PUMPFUN_BONDING_CURVE_PROGRAM_ID = address_('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const FEE_PROGRAM = address_('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const WSOL = address_('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM = address_('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = address_('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM = address_('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address_('11111111111111111111111111111111');
/** Pubkey::default — a curve with this creator pays no creator fee (matches pumpswap's convention). */
const DEFAULT_PUBKEY = SYSTEM_PROGRAM;
/** Fixed program PDAs (hardcoded like pumpswap's GLOBAL_CONFIG/FEE_CONFIG — computed once, verified
 *  against real mainnet state; see the module header). */
const GLOBAL = address_('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
/** PDA(["fee_config", PUMPFUN_BONDING_CURVE_PROGRAM_ID], FEE_PROGRAM) — the bonding-curve-specific
 *  FeeConfig (a DIFFERENT address than pumpswap's own `5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx`,
 *  even though both are namespaced under the same fee program). */
const FEE_CONFIG = address_('8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt');
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127];
const FEE_CONFIG_DISCRIMINATOR = [143, 52, 146, 187, 219, 123, 76, 155];
function address_(s) {
    return s;
}
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
async function ata(owner, mint, tokenProgram) {
    return pda([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM);
}
const SEED = (s) => new TextEncoder().encode(s);
/**
 * Which token program owns this mint, from its account data alone (the `AccountLoader`
 * contract has no owner metadata): a classic Tokenkeg mint is EXACTLY 82 bytes; anything
 * longer is token-2022 TLV. Copied from (and kept byte-identical to) the pumpswap
 * adapter's own `detectTokenProgram` — a TransferFeeConfig extension (type 1) is
 * rejected: it would make vault/ATA deltas diverge from the amounts this module's
 * constant-product math assumes.
 */
function detectTokenProgram(mint, data) {
    if (data.length === 82)
        return TOKEN_PROGRAM;
    if (data.length < 166) {
        throw new Error(`pumpfun-bonding-curve mint ${mint} data is ${data.length} bytes, not a token mint layout`);
    }
    if (data[165] !== 1) {
        throw new Error(`pumpfun-bonding-curve mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`);
    }
    // Un-routable (blocking) extensions self-drop: a NonTransferable or
    // default-frozen mint cannot move through a plain transferChecked. Advisory
    // extensions (PermanentDelegate / ConfidentialTransfer) are NOT blocking, so
    // a zero-fee/advisory-only T22 mint still routes.
    const { blocking } = parseMintExtensions(data);
    if (blocking.length > 0) {
        throw new Error(`pumpfun-bonding-curve gate: mint ${mint} is un-routable — ${blocking.join('; ')}`);
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
            throw new Error(`pumpfun-bonding-curve gate: mint ${mint} carries a token-2022 TransferFeeConfig extension (vault/ATA deltas would not match user amounts)`);
        }
        offset += 4 + extensionLength;
    }
    return TOKEN_2022_PROGRAM;
}
/** FeeTier borsh entries: u128 LE threshold + three u64 LE bps (Fees), 40 bytes each, vec at offset 65 —
 *  byte-identical layout to pumpswap's FeeConfig (same shared type, different PDA). */
function parseFeeTiers(data) {
    const count = Number(readUintLE(data, 65, 4));
    const tiers = [];
    for (let i = 0; i < count; i++) {
        const offset = 69 + i * 40;
        if (offset + 40 > data.length) {
            throw new Error(`pumpfun-bonding-curve fee config declares ${count} fee tiers but tier ${i} overruns its ${data.length}-byte data`);
        }
        tiers.push({
            marketCapThreshold: readUintLE(data, offset, 16),
            // lp_fee_bps @ offset+16 is not read — always 0 for a bonding curve, per the
            // program's own buy_exact_sol_in doc formula (only protocol + creator).
            protocolFeeBps: readUintLE(data, offset + 24, 8),
            creatorFeeBps: readUintLE(data, offset + 32, 8),
        });
    }
    return tiers;
}
function pickFeeTier(tiers, marketCap) {
    if (marketCap < tiers[0].marketCapThreshold)
        return tiers[0];
    for (let i = tiers.length - 1; i >= 0; i--) {
        if (marketCap >= tiers[i].marketCapThreshold)
            return tiers[i];
    }
    return tiers[0];
}
async function loadAccount(load, addr, what) {
    const data = await load(addr);
    if (data === null)
        throw new Error(`pumpfun-bonding-curve ${what} ${addr} not found`);
    return data;
}
/**
 * The user-scoped remaining PDAs the CLASSIC v1 adapter shape does not (and cannot,
 * being pool-scoped) precompute: `user_volume_accumulator` and its wSOL ATA. Every
 * caller building a real CPI (or resolving these ladder refs) must derive them from
 * the REAL trading wallet at execute/resolve time — mirroring pumpswap's
 * `USER_VOLUME_ACCUMULATOR_REF` pattern, just two refs instead of one (buy_exact_quote_in_v2
 * / sell_v2 both need the account; sell_v2 additionally needs its ATA at a
 * different fixed position — see buildSwapV2 below).
 */
export const PUMPFUN_BONDING_CURVE_USER_VOLUME_ACCUMULATOR_REF = 'pumpfun-bonding-curve-user-volume-accumulator';
export const PUMPFUN_BONDING_CURVE_ASSOCIATED_USER_VOLUME_ACCUMULATOR_REF = 'pumpfun-bonding-curve-associated-user-volume-accumulator';
/** PDA(["user_volume_accumulator", user], PROGRAM) — resolve at execute time with the real wallet. */
export async function pumpfunBondingCurveUserVolumeAccumulatorPda(user) {
    return pda([SEED('user_volume_accumulator'), user], PUMPFUN_BONDING_CURVE_PROGRAM_ID);
}
/** ATA(userVolumeAccumulator, TOKEN_PROGRAM, wSOL) — resolve at execute time with the real wallet. */
export async function pumpfunBondingCurveAssociatedUserVolumeAccumulator(user) {
    const uva = await pumpfunBondingCurveUserVolumeAccumulatorPda(user);
    return ata(uva, WSOL, TOKEN_PROGRAM);
}
export const pumpfunBondingCurve = {
    slug: SLUG,
    kind: 'constant-product',
    programId: PUMPFUN_BONDING_CURVE_PROGRAM_ID,
    /**
     * `pool` is the bonding-curve PDA (owner-verified against
     * PUMPFUN_BONDING_CURVE_PROGRAM_ID by the generic discovery/compile-path safety
     * net); `mint` is REQUIRED (see the module header on why the account can't embed
     * it) — `the consuming app SVM solver entry`'s FAMILIES entry enforces its presence and throws
     * a named error if a caller omits it.
     */
    async fetchPoolConfig(load, pool, mint) {
        const bcData = await loadAccount(load, pool, 'bonding curve');
        if (!hasDiscriminator(bcData, BONDING_CURVE_DISCRIMINATOR)) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} discriminator mismatch (not a BondingCurve account)`);
        }
        if (bcData.length < 115) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} data is ${bcData.length} bytes, expected at least 115`);
        }
        const complete = bcData[48] !== 0;
        if (complete) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} has completed (migrated) — trade the pumpswap AMM pool instead`);
        }
        const isMayhemMode = bcData[81] !== 0;
        if (isMayhemMode) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} gate: is_mayhem_mode is set (mayhem fee routing is unverified)`);
        }
        const isCashbackCoin = bcData[82] !== 0;
        if (isCashbackCoin) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} gate: is_cashback_coin is set (needs an undocumented bonding_curve_v2 remaining account)`);
        }
        const quoteMint = pubkeyAt(bcData, 83);
        if (quoteMint !== SYSTEM_PROGRAM) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} gate: quote_mint ${quoteMint} is not the native-SOL sentinel (an alt-quote-mint curve needs the _v2 arbitrary-quote-mint superset, unsupported here)`);
        }
        const creator = pubkeyAt(bcData, 49);
        const expectedPool = await pda([SEED('bonding-curve'), mint], PUMPFUN_BONDING_CURVE_PROGRAM_ID);
        if (expectedPool !== pool) {
            throw new Error(`pumpfun-bonding-curve pool ${pool} does not derive from mint ${mint} (expected bonding-curve PDA ${expectedPool})`);
        }
        const [mintData, globalData, feeConfigData] = await Promise.all([
            loadAccount(load, mint, 'base mint'),
            loadAccount(load, GLOBAL, 'global'),
            loadAccount(load, FEE_CONFIG, 'fee config'),
        ]);
        const baseTokenProgram = detectTokenProgram(mint, mintData);
        if (!hasDiscriminator(globalData, GLOBAL_DISCRIMINATOR)) {
            throw new Error(`pumpfun-bonding-curve global ${GLOBAL} discriminator mismatch`);
        }
        if (!hasDiscriminator(feeConfigData, FEE_CONFIG_DISCRIMINATOR)) {
            throw new Error(`pumpfun-bonding-curve fee config ${FEE_CONFIG} discriminator mismatch`);
        }
        // fee_recipients[0] @162 — the "plain" set: VALIDATED live (real simulateTransaction) as the
        // set that authorizes a CLASSIC (non-mayhem) curve's trade; Global.reserved_fee_recipients
        // (a DIFFERENT set, @516) is what mayhem-mode curves check instead — see the module header.
        const feeRecipient = pubkeyAt(globalData, 162);
        // buyback_fee_recipients[0] @741 — any of the 8 candidates is valid (it only decides where the
        // buyback cut lands, never the quote); unlike the classic buy_exact_sol_in/sell instructions
        // (which need all 8 as ambiguous remaining accounts), _v2 bakes exactly ONE into the fixed list.
        const buybackFeeRecipient = pubkeyAt(globalData, 741);
        const tiers = parseFeeTiers(feeConfigData);
        let protocolFeeBps;
        let creatorFeeBps;
        if (tiers.length === 0) {
            throw new Error(`pumpfun-bonding-curve fee config ${FEE_CONFIG} has no fee tiers`);
        }
        else {
            const virtualTokenReserves = readUintLE(bcData, 8, 8);
            const virtualQuoteReserves = readUintLE(bcData, 16, 8);
            const tokenTotalSupply = readUintLE(bcData, 40, 8);
            // pump.fun's own public "market cap" definition: price * total supply, price
            // being the VIRTUAL-reserve marginal spot (see the module header) — unlike
            // pumpswap's canonical branch, which uses REAL AMM vault balances (a
            // bonding curve has no separate "real" spot price; virtual reserves ARE
            // the invariant).
            const marketCap = virtualTokenReserves === 0n ? 0n : (virtualQuoteReserves * tokenTotalSupply) / virtualTokenReserves;
            const tier = pickFeeTier(tiers, marketCap);
            protocolFeeBps = tier.protocolFeeBps;
            creatorFeeBps = tier.creatorFeeBps;
        }
        if (creator === DEFAULT_PUBKEY)
            creatorFeeBps = 0n;
        const [associatedBaseBondingCurve, associatedQuoteBondingCurve, associatedQuoteFeeRecipient, associatedQuoteBuybackFeeRecipient, creatorVault, sharingConfig,] = await Promise.all([
            ata(pool, mint, baseTokenProgram),
            ata(pool, WSOL, TOKEN_PROGRAM),
            ata(feeRecipient, WSOL, TOKEN_PROGRAM),
            ata(buybackFeeRecipient, WSOL, TOKEN_PROGRAM),
            pda([SEED('creator-vault'), creator], PUMPFUN_BONDING_CURVE_PROGRAM_ID),
            pda([SEED('sharing-config'), mint], FEE_PROGRAM),
        ]);
        const associatedCreatorVault = await ata(creatorVault, WSOL, TOKEN_PROGRAM);
        return {
            venue: SLUG,
            pool,
            direction: 'quoteToBase',
            baseMint: mint,
            baseTokenProgram,
            creator,
            protocolFeeBps,
            creatorFeeBps,
            feeRecipient,
            associatedQuoteFeeRecipient,
            buybackFeeRecipient,
            associatedQuoteBuybackFeeRecipient,
            associatedBaseBondingCurve,
            associatedQuoteBondingCurve,
            creatorVault,
            associatedCreatorVault,
            sharingConfig,
        };
    },
};
//# sourceMappingURL=index.js.map