/**
 * Shared decode/math/PDA helpers for the two Stabble AMM programs
 * (`stabble-stable-swap` and `stabble-weighted-swap`) — sibling Anchor
 * programs sharing one `Vault` custody program and one `Pool` account shape
 * (variable-length `tokens: Vec<PoolToken>`), reverse-engineered from the
 * public `stabbleorg/amm_v1` (on-chain programs) and `stabbleorg/amm-sdk`
 * (math + off-chain decode/quote reference, incl. `#[test]` vectors used to
 * verify this port) repos on GitHub. Program ids, account layouts and swap
 * math below are cited against that source, not guessed from IDLs.
 *
 * Pool layout (both variants, `programs/{stable,weighted}-swap/src/state/pool.rs`):
 *   disc(8) | owner:Pubkey@8 | vault:Pubkey@40 | mint:Pubkey@72 |
 *   authority_bump:u8@104 | is_active:bool@105 | <variant fields> |
 *   tokens:Vec<PoolToken>@<tokensOffset> | pending_owner:Option<Pubkey> | max_supply:u64
 * Stable variant fields @106: amp_initial_factor:u16, amp_target_factor:u16,
 *   ramp_start_ts:i64, ramp_stop_ts:i64, swap_fee:u64 — tokensOffset 134.
 * Weighted variant fields @106: invariant:u64, swap_fee:u64 — tokensOffset 122.
 * PoolToken (stable, 50B): mint:Pubkey|decimals:u8|scaling_up:bool|scaling_factor:u64|balance:u64.
 * PoolToken (weighted, 58B): same + weight:u64 (normalized, ONE-scale).
 * `balance` is the pool's OWN cached ledger, scaled to 9 decimals ("wrapped") —
 * NOT a live SPL token-account read; quoting needs only the Pool account.
 *
 * Vault layout (`programs/vault/src/state/vault.rs`):
 *   disc(8) | admin:Pubkey@8 | withdraw_authority:Pubkey@40 |
 *   withdraw_authority_bump:u8@72 | authority_bump:u8@73 | is_active:bool@74 |
 *   beneficiary:Pubkey@75 | beneficiary_fee:u64@107 | pending_admin:Option<Pubkey>@115
 * `withdraw_authority` is a STORED pubkey (read directly, never re-derived —
 * it is NOT `find_program_address(["withdraw_authority", vault])` under
 * either program, verified against live mainnet Vault accounts: the derived
 * bump does not match the stored `withdraw_authority_bump`). `vault_authority`
 * (the ATA owner for the vault's token accounts) IS
 * `create_program_address(["vault_authority", vault, [authority_bump]], VAULT_PROGRAM_ID)`
 * — verified against live mainnet vaults (derived bump == stored authority_bump).
 *
 * Swap math (`process_swap` in `instructions/swap.rs`, both variants — the v1
 * `swap` entry point, not `swap_v2`: no Token-2022/transfer-fee accounts, one
 * fewer account, and this repo only targets plain SPL-Token mints for now —
 * `fetchPoolConfig` rejects Token-2022-owned mints):
 *   balanceIn = calcWrappedAmount(amountIn, tokenInIndex)
 *   balanceOutWithoutFee = <family-specific invariant math>(balances, inIdx, outIdx, balanceIn)
 *   amountOutBalance = mulDown(balanceOutWithoutFee, complement(swapFee))
 *   amountOut = calcUnwrappedAmount(amountOutBalance, tokenOutIndex)
 * `beneficiary_fee` only reslices the ALREADY-DEDUCTED swap fee between the
 * pool and the vault's beneficiary — it never reduces `amountOut` further, so
 * quoting needs no Vault-account read for the swap MATH (only for the CPI's
 * account list: `withdrawAuthority`/`authorityBump`/`beneficiary`).
 */
import { createHash } from 'node:crypto';
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, isOffCurveAddress } from '@solana/kit';
import { readUintLE } from './math.js';
export const STABLE_SWAP_PROGRAM_ID = address('swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ');
export const WEIGHTED_SWAP_PROGRAM_ID = address('swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW');
export const STABBLE_VAULT_PROGRAM_ID = address('vo1tWgqZMjG61Z2T9qUaMYKqZ75CYzMuaZ2LZP1n7HV');
export const STABBLE_TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const STABBLE_TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const STABBLE_ATA_PROGRAM_ID = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
/** sha256("account:Pool")[..8] — shared by BOTH variants (Anchor discriminators are name-, not program-, keyed; verified against live pool accounts of both programs). */
export const STABBLE_POOL_DISCRIMINATOR = new Uint8Array([0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc]);
/** sha256("account:Vault")[..8]. */
export const STABBLE_VAULT_DISCRIMINATOR = new Uint8Array([0xd3, 0x08, 0xe8, 0x2b, 0x02, 0x98, 0x75, 0x77]);
/** sha256("global:swap")[..8] — the v1 `swap(amount_in: Option<u64>, minimum_amount_out: u64)` entry point. */
export const STABBLE_SWAP_DISCRIMINATOR = new Uint8Array([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);
export const STABBLE_ONE = 1000000000n; // fixed-point SCALE=9 (both variants' `fixed_math::ONE`)
const U64_MAX = (1n << 64n) - 1n;
// ---- Balancer-style fixed-point helpers (bn::safe_math::CheckedMulDiv semantics) ----
/** floor(a*n/d) — the engine's DIV rule (a zero divisor yields 0, never throws), matched here for parity with the on-chain fragment. */
export function mulDivDown(a, n, d) {
    if (d === 0n)
        return 0n;
    return (a * n) / d;
}
/** ceil(a*n/d), 0 on a zero divisor (engine DIV-rule parity). */
export function mulDivUp(a, n, d) {
    if (d === 0n)
        return 0n;
    return (a * n + d - 1n) / d;
}
/** ceil(a/d), 0 on a zero divisor (engine DIV-rule parity). */
export function divUpRaw(a, d) {
    if (d === 0n)
        return 0n;
    return (a + d - 1n) / d;
}
export function mulDown(a, b) {
    return mulDivDown(a, b, STABBLE_ONE);
}
export function mulUp(a, b) {
    return mulDivUp(a, b, STABBLE_ONE);
}
export function divDown(a, b) {
    return mulDivDown(a, STABBLE_ONE, b);
}
export function divUp(a, b) {
    return mulDivUp(a, STABBLE_ONE, b);
}
export function complement(a) {
    return a >= STABBLE_ONE ? 0n : STABBLE_ONE - a;
}
export function calcWrappedAmount(amount, token) {
    if (token.scalingFactor === 1n)
        return amount;
    return token.scalingUp ? amount * token.scalingFactor : amount / token.scalingFactor;
}
export function calcUnwrappedAmount(amount, token) {
    if (token.scalingFactor === 1n)
        return amount;
    return token.scalingUp ? amount / token.scalingFactor : amount * token.scalingFactor;
}
export function calcRoundedAmount(amount, token) {
    if (token.scalingUp)
        return amount;
    return (amount / token.scalingFactor) * token.scalingFactor;
}
function decodeTokensVec(data, offset, tokenSize, weighted) {
    const count = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
    let cursor = offset + 4;
    const pubkey = getAddressDecoder();
    const tokens = [];
    for (let i = 0; i < count; i++) {
        const mint = pubkey.decode(data, cursor);
        const decimals = data[cursor + 32];
        const scalingUp = data[cursor + 33] !== 0;
        const scalingFactor = readUintLE(data, cursor + 34, 8);
        const balance = readUintLE(data, cursor + 42, 8);
        const token = { mint, decimals, scalingUp, scalingFactor, balance };
        if (weighted)
            token.weight = readUintLE(data, cursor + 50, 8);
        tokens.push(token);
        cursor += tokenSize;
    }
    return tokens;
}
export function decodeStabbleVault(pool, data) {
    if (data === null)
        throw new Error(`stabble vault account (pool ${pool}'s vault) not found`);
    if (data.length < 115)
        throw new Error(`stabble vault account for pool ${pool} is ${data.length} bytes, expected >= 115`);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== STABBLE_VAULT_DISCRIMINATOR[i]) {
            throw new Error(`stabble vault account for pool ${pool} has the wrong discriminator`);
        }
    }
    const pubkey = getAddressDecoder();
    return {
        admin: pubkey.decode(data, 8),
        withdrawAuthority: pubkey.decode(data, 40),
        withdrawAuthorityBump: data[72],
        authorityBump: data[73],
        isActive: data[74] !== 0,
        beneficiary: pubkey.decode(data, 75),
        beneficiaryFee: readUintLE(data, 107, 8),
    };
}
export function decodeStabblePoolCommon(pool, data, programLabel, tokensOffset, tokenSize, weighted, minLength) {
    if (data === null)
        throw new Error(`${programLabel} pool account ${pool} not found`);
    if (data.length < minLength) {
        throw new Error(`${programLabel} pool account ${pool} data is ${data.length} bytes, expected at least ${minLength}`);
    }
    for (let i = 0; i < 8; i++) {
        if (data[i] !== STABBLE_POOL_DISCRIMINATOR[i]) {
            throw new Error(`${programLabel} pool account ${pool} has the wrong discriminator`);
        }
    }
    const pubkey = getAddressDecoder();
    const vault = pubkey.decode(data, 40);
    const mint = pubkey.decode(data, 72);
    const authorityBump = data[104];
    const isActive = data[105] !== 0;
    const tokens = decodeTokensVec(data, tokensOffset, tokenSize, weighted);
    if (tokens.length < 2)
        throw new Error(`${programLabel} pool ${pool} has fewer than 2 tokens`);
    for (const t of tokens) {
        if (t.mint === STABBLE_TOKEN_2022_PROGRAM_ID) {
            // never true (mint address != program id) — real gate is in fetchPoolConfig via a mint-owner check.
        }
    }
    return { vault, mint, authorityBump, isActive, tokens };
}
/**
 * sha256(seeds... || programId || "ProgramDerivedAddress") — the raw
 * create_program_address with a KNOWN bump (never find_program_address:
 * would be wrong if the stored bump isn't the canonical one, and here it's
 * always read straight off the Vault account, never searched).
 */
export function createProgramAddress(seeds, programId) {
    const encoder = getAddressEncoder();
    const h = createHash('sha256');
    for (const seed of seeds)
        h.update(seed);
    h.update(encoder.encode(programId));
    h.update(Buffer.from('ProgramDerivedAddress'));
    const digest = h.digest();
    const decoded = getAddressDecoder().decode(digest);
    if (!isOffCurveAddress(decoded)) {
        throw new Error(`stabble PDA seeds derive an on-curve address under ${programId}`);
    }
    return decoded;
}
/** vault_authority = create_program_address(["vault_authority", vault, [bump]], VAULT_PROGRAM_ID) — verified against live mainnet vaults. */
export function deriveStabbleVaultAuthority(vault, authorityBump) {
    const encoder = getAddressEncoder();
    return createProgramAddress([Buffer.from('vault_authority'), encoder.encode(vault), Uint8Array.of(authorityBump)], STABBLE_VAULT_PROGRAM_ID);
}
/** Canonical ATA(owner, mint) under the classic SPL Token program — a real find_program_address (off-curve search), needed once per pool at fetch time. */
export async function findStabbleAta(owner, mint) {
    const encoder = getAddressEncoder();
    const [ata] = await getProgramDerivedAddress({
        programAddress: STABBLE_ATA_PROGRAM_ID,
        seeds: [encoder.encode(owner), encoder.encode(STABBLE_TOKEN_PROGRAM_ID), encoder.encode(mint)],
    });
    return ata;
}
function assertU64AmountIn(amountIn, label) {
    if (amountIn <= 0n)
        throw new Error(`${label} amountIn must be positive, got ${amountIn}`);
    if (amountIn > U64_MAX)
        throw new Error(`${label} amountIn must fit u64, got ${amountIn}`);
}
export { assertU64AmountIn as assertStabbleU64AmountIn, U64_MAX as STABBLE_U64_MAX };
// ======================================================================
// STABLE: N-token Balancer-style StableMath (libraries/math/src/stable_math.rs)
// — a DIFFERENT formulation from the Curve/Saber 2-coin `stableD`/`stableY`
// helpers this repo already ships (Stabble's own `amplification` carries an
// AMP_PRECISION=1000 factor baked in and its Newton recursion folds N
// balances via a running product, not a fixed 2-term one) — reused verbatim
// only where the SHAPE coincides (N==2 degenerates algebraically close but
// NOT bit-identically, since the intermediate rounding sequence differs), so
// this is a fresh, N-generic port instead. Verified bit-exact against every
// `#[test]` vector in stable_math.rs (2/3/4/5-token invariants, 3 out-given-in
// sizes) before being wired into the ladder fragment below.
// ======================================================================
export const STABLE_AMP_PRECISION = 1000n;
const STABLE_DEFAULT_INV_THRESHOLD = 100n;
const STABLE_BALANCE_THRESHOLD = 1n;
export const STABLE_MIN_TOKENS = 2;
export const STABLE_MAX_TOKENS = 5;
/** calc_invariant — Newton-Raphson D, <=64 rounds, converged when |D - Dprev| <= 100 (NOT 1 — Stabble's own default threshold, distinct from the 2-coin curve's threshold of 1). */
export function stableCalcInvariantN(amplification, balances) {
    const sum0 = balances.reduce((a, b) => a + b, 0n);
    if (sum0 === 0n)
        return 0n;
    const n = BigInt(balances.length);
    const ampTimesTotal = amplification * n;
    let invariant = sum0;
    const balancesTimes = balances.map((b) => b * n);
    for (let round = 0; round < 64; round++) {
        let p = invariant;
        for (const bt of balancesTimes)
            p = mulDivDown(p, invariant, bt);
        const prev = invariant;
        invariant = mulDivDown(mulDivDown(ampTimesTotal, sum0, STABLE_AMP_PRECISION) + p * n, invariant, mulDivDown(ampTimesTotal - STABLE_AMP_PRECISION, invariant, STABLE_AMP_PRECISION) + (n + 1n) * p);
        const diff = invariant > prev ? invariant - prev : prev - invariant;
        if (diff <= STABLE_DEFAULT_INV_THRESHOLD)
            return invariant;
    }
    // Best-effort after 64 rounds — matches the on-chain fragment (no revert
    // path in a quote fragment); real, liquid pools converge in ~5-15 rounds.
    return invariant;
}
/** get_token_balance_given_invariant_n_all_other_balances — <=64 rounds, converged when |Δ| <= 1. */
function stableSolveY(amplification, balances, invariant, excludedBalance, y0) {
    const n = BigInt(balances.length);
    const ampTimesTotal = amplification * n;
    let sum = balances[0];
    let p = balances[0] * n;
    for (let i = 1; i < balances.length; i++) {
        const pI = balances[i] * n;
        p = mulDivDown(p, pI, invariant);
        sum = sum + balances[i];
    }
    sum = sum - excludedBalance;
    const invariant2 = invariant * invariant;
    const c = mulDivUp(invariant2, STABLE_AMP_PRECISION, ampTimesTotal * p) * excludedBalance;
    const b = mulDivDown(invariant, STABLE_AMP_PRECISION, ampTimesTotal) + sum;
    let tokenBalance = y0;
    for (let round = 0; round < 64; round++) {
        const prev = tokenBalance;
        tokenBalance = divUpRaw(tokenBalance * tokenBalance + c, 2n * tokenBalance + b - invariant);
        const diff = tokenBalance > prev ? tokenBalance - prev : prev - tokenBalance;
        if (diff <= STABLE_BALANCE_THRESHOLD)
            return tokenBalance;
    }
    return tokenBalance; // best-effort after 64 rounds — see stableCalcInvariantN
}
/** get_token_balance_given_invariant_n_all_other_balances — cold start (the venue's own initial guess), see stableSolveY for the shared Newton loop. */
export function stableGetBalanceGivenInvariant(amplification, balances, invariant, excludedBalance) {
    const n = BigInt(balances.length);
    const ampTimesTotal = amplification * n;
    let sum = balances[0];
    let p = balances[0] * n;
    for (let i = 1; i < balances.length; i++) {
        const pI = balances[i] * n;
        p = mulDivDown(p, pI, invariant);
        sum = sum + balances[i];
    }
    sum = sum - excludedBalance;
    const invariant2 = invariant * invariant;
    const c = mulDivUp(invariant2, STABLE_AMP_PRECISION, ampTimesTotal * p) * excludedBalance;
    const b = mulDivDown(invariant, STABLE_AMP_PRECISION, ampTimesTotal) + sum;
    const y0 = divUpRaw(invariant2 + c, invariant + b);
    return stableSolveY(amplification, balances, invariant, excludedBalance, y0);
}
/** Ladder warm-start variant: same Newton recursion, starting from a caller-supplied y0 (the previous rung's converged y) instead of the cold initial guess. Passing y0 = invariant reproduces the cold start exactly. */
export function stableGetBalanceGivenInvariantWarm(amplification, balances, invariant, excludedBalance, y0) {
    return stableSolveY(amplification, balances, invariant, excludedBalance, y0);
}
/** calc_out_given_in — the exact-in quote (wrapped units, no fee applied yet). Returns 0 (not throw) on a degenerate/dust input the venue's own checked_sub would fail on, matching the engine's div-by-zero-yields-0 convention used throughout this codebase for quote fragments. */
export function stableCalcOutGivenIn(amplification, balances, tokenIndexIn, tokenIndexOut, amountIn, invariant) {
    const newBalances = balances.map((b, i) => (i === tokenIndexIn ? b + amountIn : b));
    const balanceOut = balances[tokenIndexOut];
    const finalBalanceOut = stableGetBalanceGivenInvariant(amplification, newBalances, invariant, balanceOut);
    if (finalBalanceOut + 1n >= balanceOut)
        return 0n; // checked_sub would fail on-chain
    return balanceOut - finalBalanceOut - 1n;
}
/** get_amplification: linear ramp interpolation, clamped at the ramp window's ends (60s-quantized elapsed, matching the on-chain `checked_div(60)?.checked_mul(60)?`). */
export function stableGetAmplification(ampInitialFactor, ampTargetFactor, rampStartTs, rampStopTs, currentTs) {
    const ai = BigInt(ampInitialFactor);
    const at = BigInt(ampTargetFactor);
    if (currentTs <= rampStartTs)
        return ai * STABLE_AMP_PRECISION;
    if (currentTs >= rampStopTs)
        return at * STABLE_AMP_PRECISION;
    const rampElapsed = ((currentTs - rampStartTs) / 60n) * 60n;
    const rampDuration = rampStopTs - rampStartTs;
    if (at >= ai) {
        const offset = mulDivDown((at - ai) * STABLE_AMP_PRECISION, rampElapsed, rampDuration);
        return ai * STABLE_AMP_PRECISION + offset;
    }
    const offset = mulDivDown((ai - at) * STABLE_AMP_PRECISION, rampElapsed, rampDuration);
    return ai * STABLE_AMP_PRECISION - offset;
}
/**
 * SauceScript SOURCE for a self-contained N-token stable quote helper, FIXED
 * to tokenIndexIn=0, tokenIndexOut=1 (this repo's declared AtoB-only scope —
 * see stabble-stable-swap's module doc). One helper per N (2..5); the ladder
 * dedupes by name, so every pool sharing an N reuses the identical source
 * (the `helpers()` dedupe invariant in ../types.js).
 *
 * A line-for-line transliteration of `stableCalcInvariantN` +
 * `stableGetBalanceGivenInvariant` + `stableCalcOutGivenIn` above (see those
 * for the bit-exact-verified bigint reference this mirrors): D-Newton
 * (<=64 rounds, converge |Δ|<=100) then the excluded-balance Y-Newton
 * (<=64 rounds, converge |Δ|<=1), both COLD (no cross-rung warm-start — the
 * ladder calls this fresh per rung/final quote; see the ladder's module doc
 * for why that tradeoff was made). Ceiling divisions (`checked_mul_div_up`/
 * `checked_div_up` in the Rust source) are emitted as plain
 * `(num + den - 1) / den` — safe without Math.mulDiv's 512-bit path because
 * every product here stays far below 256 bits for realistic pool
 * magnitudes (MAX_SAFE_BALANCE = 3e18 ~ 2^62; D and its square stay under
 * ~2^130, AMP_PRECISION-scaled terms add a handful more bits) — bounds
 * documented in docs/svm-venues.md-style fashion inline below is skipped
 * only because this module doc already states them once for the whole file.
 * A zero divisor anywhere (an empty side) yields 0 (the engine's DIV rule),
 * never a revert — matched here so a degenerate pool quotes 0 instead of
 * poisoning the merge.
 */
/**
 * SauceScript SOURCE for the N-token D-Newton ALONE (calc_invariant) — the
 * ladder's warm-start split of `stableQuoteHelperSource`: an N-token pool's
 * D depends only on the reserves, so it is computed ONCE per trade (in
 * `emitSetup`), not once per rung. Same <=64 rounds / converge |Δ|<=100 as
 * the combined helper; see that function's doc for the ceiling-division and
 * zero-divisor conventions (identical here).
 */
export function stableDHelperSource(n) {
    if (!Number.isInteger(n) || n < STABLE_MIN_TOKENS || n > STABLE_MAX_TOKENS) {
        throw new Error(`stableDHelperSource needs N in [${STABLE_MIN_TOKENS}, ${STABLE_MAX_TOKENS}], got ${n}`);
    }
    const name = `stabbleStableDN${n}`;
    const balParams = Array.from({ length: n }, (_, i) => `bal${i}`).join(', ');
    const sumExpr = Array.from({ length: n }, (_, i) => `bal${i}`).join(' + ');
    const lines = [];
    lines.push(`function ${name}(amp, ${balParams}) {`);
    lines.push(`  const sum = ${sumExpr};`);
    lines.push(`  let d = 0;`);
    lines.push(`  if (sum > 0) {`);
    lines.push(`    const ampN = amp * ${n};`);
    lines.push(`    d = sum;`);
    lines.push(`    let ddiff = 101;`);
    lines.push(`    for (let iter = 0; iter < 64 && ddiff > 100; iter++) {`);
    lines.push(`      let p = d;`);
    for (let i = 0; i < n; i++)
        lines.push(`      p = Math.mulDiv(p, d, bal${i} * ${n});`);
    lines.push(`      const prevD = d;`);
    lines.push(`      d = Math.mulDiv(Math.mulDiv(ampN, sum, 1000) + p * ${n}, d, Math.mulDiv(ampN - 1000, d, 1000) + ${n + 1} * p);`);
    lines.push(`      ddiff = d - prevD;`);
    lines.push(`      if (prevD > d) { ddiff = prevD - d }`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  return d;`);
    lines.push(`}`);
    return { name, source: lines.join('\n') };
}
/**
 * SauceScript SOURCE for the excluded-balance Y-Newton ALONE, WARM-STARTABLE
 * from a caller-supplied `y0` (the ladder's warm-start split of
 * `stableQuoteHelperSource`): identical math to
 * `stableGetBalanceGivenInvariant` EXCEPT the cold initial-guess formula is
 * replaced by the caller's `y0` — passing `y0 = d` (the venue's own cold
 * start) reproduces the venue-exact final quote; a ladder thread the
 * PREVIOUS rung's converged y instead, cutting iterations to ~1-2 (a larger
 * cumulative input means a smaller y, so the previous rung's y still
 * approaches the fixed point from above — exactly `stableYW`'s justification
 * for the 2-coin case, unchanged by generalizing to N tokens). Same
 * ceiling-division / zero-divisor conventions as `stableQuoteHelperSource`.
 */
export function stableYWarmHelperSource(n) {
    if (!Number.isInteger(n) || n < STABLE_MIN_TOKENS || n > STABLE_MAX_TOKENS) {
        throw new Error(`stableYWarmHelperSource needs N in [${STABLE_MIN_TOKENS}, ${STABLE_MAX_TOKENS}], got ${n}`);
    }
    const name = `stabbleStableYWarmN${n}`;
    const balParams = Array.from({ length: n }, (_, i) => `bal${i}`).join(', ');
    const lines = [];
    lines.push(`function ${name}(amp, ${balParams}, amountIn, d, y0) {`);
    lines.push(`  const ampN = amp * ${n};`);
    lines.push(`  const newBal0 = bal0 + amountIn;`);
    const sum2Terms = ['newBal0', ...Array.from({ length: n - 1 }, (_, i) => `bal${i + 1}`)];
    lines.push(`  let sum2 = ${sum2Terms.join(' + ')};`);
    lines.push(`  let p2 = newBal0 * ${n};`);
    for (let i = 1; i < n; i++)
        lines.push(`  p2 = Math.mulDiv(p2, bal${i} * ${n}, d);`);
    lines.push(`  sum2 = sum2 - bal1;`);
    lines.push(`  const d2 = d * d;`);
    lines.push(`  const cNum = d2 * 1000;`);
    lines.push(`  const cDen = ampN * p2;`);
    lines.push(`  let c = 0;`);
    // Plain ceil-div `(a+b-1)/b`, NOT Math.mulDiv — MEASURED: on this engine
    // Math.mulDiv carries a substantial fixed per-call cost that makes it
    // MORE expensive than plain arithmetic for operands that don't need its
    // 512-bit-safe path (our magnitudes here never approach that width) —
    // swapping this loop's ceil-divs and the y*y product to Math.mulDiv
    // measured WORSE (1.2M -> 1.39M CU @ 2 rungs) than plain ops, the opposite
    // of the initial hypothesis. Kept as plain arithmetic throughout; see the
    // ladder's module doc for the full measured comparison.
    lines.push(`  if (cDen > 0) { c = ((cNum + cDen - 1) / cDen) * bal1 }`);
    lines.push(`  const bTerm = Math.mulDiv(d, 1000, ampN) + sum2;`);
    lines.push(`  let y = y0;`);
    lines.push(`  let ydiff = 2;`);
    lines.push(`  for (let iter = 0; iter < 64 && ydiff > 1; iter++) {`);
    lines.push(`    const prevY = y;`);
    lines.push(`    const yNum = y * y + c;`);
    lines.push(`    const yDen = 2 * y + bTerm - d;`);
    lines.push(`    if (yDen > 0) { y = (yNum + yDen - 1) / yDen }`);
    lines.push(`    ydiff = y - prevY;`);
    lines.push(`    if (prevY > y) { ydiff = prevY - y }`);
    lines.push(`  }`);
    lines.push(`  return y;`);
    lines.push(`}`);
    return { name, source: lines.join('\n') };
}
export function stableQuoteHelperSource(n) {
    if (!Number.isInteger(n) || n < STABLE_MIN_TOKENS || n > STABLE_MAX_TOKENS) {
        throw new Error(`stableQuoteHelperSource needs N in [${STABLE_MIN_TOKENS}, ${STABLE_MAX_TOKENS}], got ${n}`);
    }
    const name = `stabbleStableQuoteN${n}`;
    const balParams = Array.from({ length: n }, (_, i) => `bal${i}`).join(', ');
    const sumExpr = Array.from({ length: n }, (_, i) => `bal${i}`).join(' + ');
    const lines = [];
    lines.push(`function ${name}(amp, ${balParams}, amountIn) {`);
    lines.push(`  let result = 0;`);
    lines.push(`  const sum = ${sumExpr};`);
    lines.push(`  if (sum > 0) {`);
    lines.push(`    const ampN = amp * ${n};`);
    lines.push(`    let d = sum;`);
    lines.push(`    let ddiff = 101;`);
    lines.push(`    for (let iter = 0; iter < 64 && ddiff > 100; iter++) {`);
    lines.push(`      let p = d;`);
    for (let i = 0; i < n; i++)
        lines.push(`      p = Math.mulDiv(p, d, bal${i} * ${n});`);
    lines.push(`      const prevD = d;`);
    lines.push(`      d = Math.mulDiv(Math.mulDiv(ampN, sum, 1000) + p * ${n}, d, Math.mulDiv(ampN - 1000, d, 1000) + ${n + 1} * p);`);
    lines.push(`      ddiff = d - prevD;`);
    lines.push(`      if (prevD > d) { ddiff = prevD - d }`);
    lines.push(`    }`);
    lines.push(`    const newBal0 = bal0 + amountIn;`);
    const sum2Terms = ['newBal0', ...Array.from({ length: n - 1 }, (_, i) => `bal${i + 1}`)];
    lines.push(`    let sum2 = ${sum2Terms.join(' + ')};`);
    lines.push(`    let p2 = newBal0 * ${n};`);
    for (let i = 1; i < n; i++)
        lines.push(`    p2 = Math.mulDiv(p2, bal${i} * ${n}, d);`);
    lines.push(`    sum2 = sum2 - bal1;`);
    lines.push(`    const d2 = d * d;`);
    lines.push(`    const cNum = d2 * 1000;`);
    lines.push(`    const cDen = ampN * p2;`);
    lines.push(`    let c = 0;`);
    lines.push(`    if (cDen > 0) { c = ((cNum + cDen - 1) / cDen) * bal1 }`);
    lines.push(`    const bTerm = Math.mulDiv(d, 1000, ampN) + sum2;`);
    lines.push(`    const yDen0 = d + bTerm;`);
    lines.push(`    let y = 0;`);
    lines.push(`    if (yDen0 > 0) { y = (d2 + c + yDen0 - 1) / yDen0 }`);
    lines.push(`    let ydiff = 2;`);
    lines.push(`    for (let iter2 = 0; iter2 < 64 && ydiff > 1; iter2++) {`);
    lines.push(`      const prevY = y;`);
    lines.push(`      const yNum = y * y + c;`);
    lines.push(`      const yDen = 2 * y + bTerm - d;`);
    lines.push(`      if (yDen > 0) { y = (yNum + yDen - 1) / yDen }`);
    lines.push(`      ydiff = y - prevY;`);
    lines.push(`      if (prevY > y) { ydiff = prevY - y }`);
    lines.push(`    }`);
    lines.push(`    if (y + 1 < bal1) { result = bal1 - y - 1 }`);
    lines.push(`  }`);
    lines.push(`  return result;`);
    lines.push(`}`);
    return { name, source: lines.join('\n') };
}
// ======================================================================
// WEIGHTED: Balancer WeightedMath (libraries/math/src/weighted_math.rs)
// ======================================================================
export const WEIGHTED_MAX_IN_RATIO = 300000000n; // 30% of balanceIn — a REAL on-chain capacity cap (calc_out_given_in returns None past it)
export const WEIGHTED_MIN_TOKENS = 2;
export const WEIGHTED_MAX_TOKENS = 4;
const POW_ZERO = 0n;
const POW_ONE = STABBLE_ONE;
const POW_TWO = 2n * STABBLE_ONE;
const POW_THREE = 3n * STABBLE_ONE;
const POW_FOUR = 4n * STABBLE_ONE;
// Internal precision for the general (non-exact-integer-exponent) fractional
// pow approximation: decompose exp = intPart + frac, frac via its binary
// expansion (doubling method), each bit backed by an iterated CEILING square
// root of `base` (base^(2^-k)) at an internal fixed-point scale finer than
// Stabble's own ONE=1e9. Every step (sqrt and multiply) rounds UP, so the
// result is a guaranteed OVER-estimate of the true base^exp — which, fed into
// `balanceOut * (1 - power)`, makes our own amountOut estimate a guaranteed
// UNDER-estimate of the mathematically exact value (never the "favorable
// error" direction). This does NOT bit-match Stabble's own `fixed_exp`
// crate (a Q34.30 CORDIC/Pade powf) — verified against every #[test] vector
// in weighted_math.rs that DOES special-case to an exact integer power
// (ONE/TWO/THREE/FOUR), and measured (not merely reasoned about) against the
// general path at REALISTIC trade sizes via a real cook against the deployed
// program (see the consuming app stabble-weighted e2e test) — Stabble's own
// fixed-point powf loses most of its 30 fractional bits to leading nines
// when a trade is a tiny fraction of the pool, so at THAT (unrealistic,
// sub-0.0001%) extreme it can occasionally exceed the true value by low
// single-digit percent; at realistic SvmRoute trade sizes (low single-digit
// percent of pool depth or more) that regime does not apply and the two
// track closely.
const ISCALE = 10n ** 18n;
const ISCALE_PER_ONE = ISCALE / STABBLE_ONE;
const POW_FRAC_BITS = 64;
/**
 * Integer floor(sqrt(n)), Newton's method. Exported (like every other helper
 * in this module) so its byte-identity and iteration count are directly
 * testable — see stabble-isqrt.test.ts.
 *
 * The seed `1n << ceil(bits/2)` (bits = n's bit length) is picked so the
 * FIRST iterate already sits >= floor(sqrt(n)) for every n >= 2: n < 2^bits
 * implies sqrt(n) < 2^(bits/2) <= 2^ceil(bits/2), so the seed's square,
 * 2^(2*ceil(bits/2)), is >= 2^bits > n. Newton's iteration for floor-sqrt is
 * monotonically non-increasing once started at or above the true root and
 * converges to exactly floor(sqrt(n)) regardless of the starting point (the
 * classical property this loop has always relied on — only the seed changed
 * here) — so the RESULT for every n is unchanged; only the number of
 * iterations needed drops, from ~bits/2 with the old `x = n` seed (each
 * early iteration barely halves x) to ~5-8 total once seeded this close to
 * the root. This matters here specifically because `weightedPowUp`'s
 * fractional-exponent path feeds `sqrtInternalCeil` an ISCALE(1e18)-inflated
 * operand — routinely ~110-130 bits — so the old seed cost ~55-70 slow
 * halving iterations per sqrt call, repeated up to POW_FRAC_BITS(64) times
 * per `weightedPowUp` invocation.
 */
export function isqrtFloor(n) {
    if (n < 0n)
        throw new Error(`isqrtFloor needs a non-negative value, got ${n}`);
    if (n < 2n)
        return n;
    const bits = n.toString(2).length;
    let x = 1n << BigInt((bits + 1) >> 1);
    let y = (x + n / x) / 2n;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2n;
    }
    return x;
}
function isqrtCeil(n) {
    const f = isqrtFloor(n);
    return f * f < n ? f + 1n : f;
}
/** ceil(sqrt(x/ISCALE)) represented at ISCALE. */
function sqrtInternalCeil(xInternal) {
    return isqrtCeil(xInternal * ISCALE);
}
function mulInternalCeil(a, b) {
    return (a * b + ISCALE - 1n) / ISCALE;
}
/** OVER-estimate of base^exponent (base in (0, ONE], exponent >= 0, both ONE(1e9)-scaled). */
export function weightedPowUp(base, exponent) {
    if (exponent === POW_ZERO)
        return STABBLE_ONE;
    if (exponent === POW_ONE)
        return base;
    if (exponent === POW_TWO)
        return mulUp(base, base);
    if (exponent === POW_THREE)
        return mulUp(mulUp(base, base), base);
    if (exponent === POW_FOUR) {
        const sq = mulUp(base, base);
        return mulUp(sq, sq);
    }
    const intPart = exponent / STABBLE_ONE;
    const frac = exponent % STABBLE_ONE;
    const baseInternal = base * ISCALE_PER_ONE;
    let resultInternal = ISCALE;
    if (intPart > 0n) {
        let n = intPart;
        let baseP = baseInternal;
        while (n > 0n) {
            if (n & 1n)
                resultInternal = mulInternalCeil(resultInternal, baseP);
            n >>= 1n;
            if (n > 0n)
                baseP = mulInternalCeil(baseP, baseP);
        }
    }
    if (frac > 0n) {
        let cur = baseInternal;
        let fracRemaining = frac;
        for (let k = 0; k < POW_FRAC_BITS && fracRemaining > 0n; k++) {
            cur = sqrtInternalCeil(cur);
            fracRemaining *= 2n;
            if (fracRemaining >= STABBLE_ONE) {
                fracRemaining -= STABBLE_ONE;
                resultInternal = mulInternalCeil(resultInternal, cur);
            }
        }
    }
    const scaled = (resultInternal + ISCALE_PER_ONE - 1n) / ISCALE_PER_ONE;
    return scaled > STABBLE_ONE ? STABBLE_ONE : scaled; // base<=ONE, exponent>=0 => power<=ONE always; clamp overshoot from the conservative rounding chain
}
/** calc_out_given_in (wrapped units) — null (not throw) once amountIn exceeds MAX_IN_RATIO, the venue's real hard capacity cap (`None` on-chain, would panic the instruction; the ladder must clamp to this, never quote past it). */
export function weightedCalcOutGivenIn(balanceIn, weightIn, balanceOut, weightOut, amountIn) {
    if (amountIn > mulDown(balanceIn, WEIGHTED_MAX_IN_RATIO))
        return null;
    const base = divUp(balanceIn, balanceIn + amountIn);
    const exponent = divDown(weightIn, weightOut);
    const power = weightedPowUp(base, exponent);
    return mulDown(balanceOut, complement(power));
}
/**
 * SauceScript SOURCE mirror of `weightedPowUp` — since `weightIn`/`weightOut`
 * are pool constants (immutable in practice; treated as such here, matching
 * this codebase's convention of baking genuinely-immutable curve constants),
 * the exponent — and therefore the ENTIRE bit-decomposition schedule (how
 * many squarings for the integer part, how many sqrt iterations for the
 * fraction, and which of them land a "multiply into result" — is fully
 * determined at COMPILE TIME. So unlike the runtime loop `weightedPowUp`
 * runs in TS, the emitted fragment needs NO loop and NO data-dependent
 * branch at all: this function TRACES the same schedule off-chain and
 * emits a flat, unrolled sequence of ceiling-sqrt/ceiling-multiply lines —
 * cheaper AND simpler than a generic runtime loop, and naturally short for
 * "nice" ratios (50/50, 80/20, ...) since the fractional remainder can hit
 * exactly 0 after only 1-2 iterations. `baseVar` must already be bound to
 * the ONE(1e9)-scaled runtime base (`divUp(balanceIn, balanceIn+amountIn)`);
 * `out` becomes a `const` holding the ONE-scaled, ceiling-biased power.
 * The three exact-integer special cases (ONE/TWO/THREE/FOUR) reproduce the
 * real program's own fast path bit-for-bit (mulUp composition, no
 * approximation); everything else uses the conservative sqrt ladder (see
 * `weightedPowUp`'s doc for the accuracy/conservatism proof).
 */
export function weightedPowUpSource(weightIn, weightOut, baseVar, out) {
    const exponent = divDown(weightIn, weightOut);
    const mulUpExpr = (a, b) => `((${a} * ${b} + 999999999) / 1000000000)`;
    if (exponent === POW_ZERO)
        return [`const ${out} = 1000000000;`];
    if (exponent === POW_ONE)
        return [`const ${out} = ${baseVar};`];
    if (exponent === POW_TWO)
        return [`const ${out} = ${mulUpExpr(baseVar, baseVar)};`];
    if (exponent === POW_THREE) {
        return [`const ${out}sq = ${mulUpExpr(baseVar, baseVar)};`, `const ${out} = ${mulUpExpr(`${out}sq`, baseVar)};`];
    }
    if (exponent === POW_FOUR) {
        return [`const ${out}sq = ${mulUpExpr(baseVar, baseVar)};`, `const ${out} = ${mulUpExpr(`${out}sq`, `${out}sq`)};`];
    }
    const intPart = exponent / STABBLE_ONE;
    const frac = exponent % STABBLE_ONE;
    const mulInternalCeilExpr = (a, b) => `((${a} * ${b} + 999999999999999999) / ${ISCALE})`;
    const lines = [];
    lines.push(`const ${out}bi = ${baseVar} * ${ISCALE_PER_ONE};`);
    lines.push(`let ${out}r = ${ISCALE};`);
    if (intPart > 0n) {
        let n = intPart;
        let idx = 0;
        lines.push(`let ${out}bp${idx} = ${out}bi;`);
        while (n > 0n) {
            if (n & 1n)
                lines.push(`${out}r = ${mulInternalCeilExpr(`${out}r`, `${out}bp${idx}`)};`);
            n >>= 1n;
            if (n > 0n) {
                lines.push(`let ${out}bp${idx + 1} = ${mulInternalCeilExpr(`${out}bp${idx}`, `${out}bp${idx}`)};`);
                idx++;
            }
        }
    }
    if (frac > 0n) {
        let cur = `${out}bi`;
        let fracRemaining = frac;
        for (let k = 0; k < POW_FRAC_BITS && fracRemaining > 0n; k++) {
            const next = `${out}c${k}`;
            lines.push(`let ${next}s = Math.sqrt(${cur} * ${ISCALE});`);
            lines.push(`if (${next}s * ${next}s < ${cur} * ${ISCALE}) { ${next}s = ${next}s + 1 }`);
            lines.push(`const ${next} = ${next}s;`);
            cur = next;
            fracRemaining *= 2n;
            if (fracRemaining >= STABBLE_ONE) {
                fracRemaining -= STABBLE_ONE;
                lines.push(`${out}r = ${mulInternalCeilExpr(`${out}r`, cur)};`);
            }
        }
    }
    lines.push(`let ${out} = (${out}r + ${ISCALE_PER_ONE - 1n}) / ${ISCALE_PER_ONE};`);
    lines.push(`if (${out} > 1000000000) { ${out} = 1000000000 }`);
    return lines;
}
/**
 * Full weighted-swap core quote (wrapped-space, NO fee applied yet — the
 * caller applies swap_fee, matching the real program's own function
 * boundary): `${outVar}` becomes the wrapped gross output for a wrapped
 * gross-input expression `wrappedXExpr` (0 when the expression is 0, never
 * negative, never throws on a zero/degenerate denominator — matches the
 * engine's DIV rule). `tag` must be unique per call site (rung index or
 * "final") so nested locals across multiple emissions in one fragment don't
 * collide.
 */
export function weightedCoreQuoteLines(tag, balInVar, balOutVar, weightIn, weightOut, wrappedXExpr, outVar) {
    const base = `${tag}base`;
    const lines = [];
    lines.push(`let ${outVar} = 0;`);
    lines.push(`if ((${wrappedXExpr}) > 0 && ${balInVar} > 0) {`);
    lines.push(`  const ${tag}den = ${balInVar} + (${wrappedXExpr});`);
    lines.push(`  const ${base} = (${balInVar} * 1000000000 + ${tag}den - 1) / ${tag}den;`);
    const powLines = weightedPowUpSource(weightIn, weightOut, base, `${tag}pw`);
    lines.push(...powLines.map((l) => `  ${l}`));
    lines.push(`  let ${tag}cpl = 1000000000 - ${tag}pw;`);
    lines.push(`  if (${tag}pw >= 1000000000) { ${tag}cpl = 0 }`);
    lines.push(`  ${outVar} = (${balOutVar} * ${tag}cpl) / 1000000000;`);
    lines.push(`}`);
    return lines;
}
//# sourceMappingURL=stabble-common.js.map