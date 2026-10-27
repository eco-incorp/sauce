/**
 * Virtuals Protocol bonding curve (program `5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki`,
 * Jupiter label `"Virtuals"` — see `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`).
 * The PRE-migration curve every Virtuals-launched token trades on before it graduates to a
 * Meteora DAMM v1 pool (`create_meteora_pool`/`initialize_meteora_accounts` — out of scope here,
 * a distinct venue once the pool graduates).
 *
 * GROUND-TRUTHED against the program's own on-chain Anchor IDL (fetched from the IDL account —
 * `createAddressWithSeed(getProgramDerivedAddress([], program).0, "anchor:idl", program)` — 5,654
 * raw bytes, 2,805 zlib-compressed, 23,037 decompressed) and validated with REAL
 * `simulateTransaction` (`sigVerify:false`, impersonating real token holders — no assumptions,
 * no third-party SDK) against the REAL deployed program on REAL mainnet pool state. See
 * "VALIDATION" below.
 *
 * `VirtualsPool` account (disc `sha256("account:VirtualsPool")[:8]` = 477605cb05628774) is a
 * FIXED 90 bytes: creator pubkey@8, mint pubkey@40, virtual_y u64@72, graduation_x u64@80,
 * state (u8 enum: 0 Initialized, 1 Active, 2 Graduated, 3 Migrated)@88, bump u8@89. Sampled 16
 * live pools: `virtual_y` and `graduation_x` were IDENTICAL across every one
 * (6_000_000_000_000 / 125_000_000_000_000 raw) — but both are read LIVE off the pool account
 * (never hardcoded), since nothing in the IDL rules out a future launch changing them.
 *
 * UNLIKE every other bonding-curve family this recipe already serves (pumpswap, the pump.fun
 * classic curve): `VirtualsPool` stores only ONE mint. The quote side is always the program's own
 * VIRTUAL SPL mint (`3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y`, decimals 9) — a fixed
 * protocol-wide constant baked into every `buy`/`sell` account list (`user_virtuals_ata`'s ATA
 * derivation seeds a hardcoded mint pubkey the program's own IDL bakes in, confirmed by decoding
 * the ATA PDA's seed constants), never a per-pool field. `real_x` (the base-token reserve) and
 * `real_y` (the VIRTUAL reserve) are likewise NOT stored on the pool account at all — they are
 * the pool's own SPL vault balances (`vpool_token_ata`/`vpool_virtuals_ata`, standard ATAs of the
 * pool PDA), read live like raydium-cp-swap/obric-v2's vault reads (`accountUint(ref, 64, 8)`).
 * `token_program` is a FIXED classic-Tokenkeg constraint in the IDL itself (`buy`/`sell`'s
 * `token_program` account carries an `address` constraint, not a `path` — Token-2022 mints are
 * therefore impossible to launch through this program; no token-program detection is needed).
 *
 * FEE MODEL: a flat 1% (100 bps of 10000) protocol fee, paid ENTIRELY to a single fixed sink
 * (`platform_prototype_virtuals_ata`, the ATA of the hardcoded `platform_prototype`
 * `933jV351WDG23QTcHPqLFJxyYRrEPWRTR3qoPWi3jwEL` over the VIRTUAL mint) — there is no
 * creator-fee split (unlike pump.fun) and no FeeConfig/market-cap tier account anywhere in the
 * IDL's 8 instructions, confirming the rate is a compiled-in program constant, not
 * chain-configurable. `claim_fees` sweeps it later; irrelevant to quoting.
 *
 * BUY is EXACT-OUTPUT (unusual — every other bonding-curve family this recipe serves is
 * exact-input): `buy(amount, max_amount_out)` — `amount` is the EXACT number of base tokens the
 * caller receives, `max_amount_out` is (despite the name) a MAX-COST cap on VIRTUAL spent, not an
 * output bound. Empirically fit against the real program (see VALIDATION):
 *   dy = floor(effY * dx / (realX - dx))          [effY = virtual_y + realY, the live vault]
 *   fee = floor(dy / 100)
 *   cost = dy + fee                                [paid entirely by the caller; the vault's
 *                                                    OWN virtuals balance increases by dy only —
 *                                                    the fee routes straight to the platform ATA,
 *                                                    confirmed by the vault/fee-ATA deltas below]
 * This recipe's ladder needs the INVERSE (given a VIRTUAL budget `x`, the exact-output venue's
 * own patched arg IS `amount`, not `x` — see `buildSwapV2`'s `patch: 'out'`): the largest `dx`
 * with `cost(dx) <= x`. Closed form, no search loop:
 *   dyTarget = 100*floor(x/101) + min(x - 101*floor(x/101), 99)   [max dy s.t. dy+floor(dy/100)<=x
 *                                                                   — a contiguous 100-wide block
 *                                                                   per 101-wide cost step, see the
 *                                                                   PR's derivation]
 *   dx = floor(realX * (dyTarget+1) / (effY+dyTarget+1))          [inverted at the dyTarget+1
 *                                                                   threshold — dx(dy) as usually
 *                                                                   inverted lands at the BOTTOM of
 *                                                                   dy's forward-map plateau, not
 *                                                                   the top; evaluating at dy+1
 *                                                                   and NOT subtracting lands
 *                                                                   exactly on the top, i.e. the
 *                                                                   true max]
 *   clamp dx to realX-1, then a single forward re-check (recompute cost(dx) with the REAL forward
 *   formula and decrement by 1 if it exceeds x) — belt-and-suspenders: proven to never trigger
 *   across 200,000 randomized (eff_y, real_x, x) trials spanning 1 to 1e18 in each dimension, but
 *   kept because it makes the safety property (never overspend the merge's allocated share x)
 *   true BY CONSTRUCTION rather than by trusting the closed form alone.
 *
 * SELL is exact-input, the usual shape: `sell(amount, min_amount_out)` — `amount` = exact base
 * tokens sold. Empirically fit (see VALIDATION):
 *   gross = ceil(effY * dx / (realX + dx))         [the vault's virtuals balance DECREASES by
 *                                                    exactly gross — confirmed by the vault delta]
 *   fee = floor(gross / 100)                       [floor of the CEIL'd gross — confirmed at a
 *                                                    dx chosen so floor(gross) and ceil(gross)
 *                                                    straddle a /100 boundary; the CEIL'd value is
 *                                                    what actually gets divided]
 *   net = gross - fee                              [paid to the seller]
 *
 * VALIDATION (`test/svm/venues/virtuals.test.ts` pins these): REAL `simulateTransaction` calls
 * (`sigVerify:false`, impersonating real VIRTUAL/token holders — no synthetic accounts) against
 * the REAL deployed program, pool `135Q44ShcCmWzaHZDJY25GejVQ4xwcgX9MzAEqE1eaFY` (mint
 * `CYShT7m7JGrbfMu6XAmt2XDz4zjsV8i9LnHisihjvirt`, virtual_y=6_000_000_000_000,
 * real_x=999_000_000_000_000, real_y=6_006_006_001 throughout — an untraded-since-launch pool,
 * so every call below reads the SAME live state):
 *   BUY   1,000 tokens exact-out  -> cost 6,072,144 raw VIRTUAL (vault +6,012,024, platform fee +60,120)
 *   BUY   100,000 tokens exact-out -> cost 607,274,607 raw VIRTUAL (vault +601,261,988, fee +6,012,619)
 *   BUY   5,000,000 tokens exact-out -> cost 332,326,275 raw VIRTUAL... (vault +30,211,297,816, fee +302,112,978)
 *   BUY   50,000,000 tokens exact-out -> vault +316,438,672,602, fee +3,164,386,726
 *   SELL  1,000 raw tokens    -> net 5,953 raw VIRTUAL (fee delta +60 — the CEIL'd-gross/100 case)
 *   SELL  100,000,000 raw tokens -> net 595,190 (fee delta +6,012)
 *   SELL  500,000,000 raw tokens -> net 2,975,948 (fee delta +30,060)
 *   SELL  16,468/16,469/16,470 raw tokens (chosen so floor(gross) sits at a `%100==99` boundary,
 *     the ONE case that disambiguates floor-then-fee from ceil-then-fee) -> net 99, fee delta +1
 *     for all three (gross=100 via ceil, not 99 via floor) — this is the case that proves the
 *     CEIL, not just a coincidence at round numbers.
 * The BUY-side inverse was independently boundary-tested (not just forward-fit): for 4 budgets
 * (1 / 50 / 1,000 / 7,000 VIRTUAL — the last exceeding the pool's ENTIRE effective liquidity,
 * ~6,006 VIRTUAL, at the time), `buy(dx, max_amount_out=budget)` SUCCEEDS and
 * `buy(dx+1, max_amount_out=budget)` REVERTS with the program's own `SlippageExceeded` (Anchor
 * error 6008) — proving `dx` is the EXACT maximum the budget affords, not merely "some safe
 * value under budget".
 *
 * Volume: 18,025 live VirtualsPool accounts discovered via getProgramAccounts at integration
 * time (dataSize 90 + the account discriminator), of which only ~1-in-100 sampled were still
 * `Active` (state=1) — most have already graduated. This ladder gates on `state === 1` at
 * fetch time (an Initialized/Graduated/Migrated pool's `buy`/`sell` would revert on-chain, and a
 * live CPI failure aborts the whole cook — the SAME prepare-time-only gate meteora-damm-v2 uses
 * for its own activation check, not a new risk class). A pool that graduates between our
 * off-chain prepare and the cook's on-chain execution is the SAME accepted drift class every
 * state-gated SVM family already carries.
 */
import { getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type { AccountLoader, OwnedAccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "virtuals" as const;

export const VIRTUALS_PROGRAM_ID = address_("5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki");
const TOKEN_PROGRAM = address_("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address_("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** The program's own quote SPL mint — fixed, baked into every buy/sell account list (see header). */
export const VIRTUALS_MINT = address_("3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y");
/** Fixed protocol fee sink — the ONLY account `buy`/`sell`'s IDL pins to a literal `address`. */
const PLATFORM_PROTOTYPE = address_("933jV351WDG23QTcHPqLFJxyYRrEPWRTR3qoPWi3jwEL");

/** sha256("account:VirtualsPool")[0..8]. */
const VIRTUALS_POOL_DISCRIMINATOR = [71, 118, 5, 203, 5, 98, 135, 116];
export const POOL_ACCOUNT_SIZE = 90;
function address_(s: string): Address {
  return s as unknown as Address;
}
function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}
function pubkeyAt(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
async function ata(owner: Address, mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  return memoizedGetProgramDerivedAddress(ATA_PROGRAM, [
    new Uint8Array(enc.encode(owner)),
    new Uint8Array(enc.encode(TOKEN_PROGRAM)),
    new Uint8Array(enc.encode(mint)),
  ]);
}
async function loadAccount(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`virtuals ${what} ${addr} not found`);
  return data;
}

export interface VirtualsPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** exactIn side: 'quoteToBase' (default, buy — VIRTUAL in, token out) | 'baseToQuote' (sell). */
  direction: "quoteToBase" | "baseToQuote";
  baseMint: Address;
  /** Read live off the pool account (see header) — NOT hardcoded despite being identical across
   *  every sampled pool. */
  virtualY: bigint;
  vpoolTokenAta: Address;
  vpoolVirtualsAta: Address;
  platformPrototypeVirtualsAta: Address;
}

export const virtuals = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: VIRTUALS_PROGRAM_ID,
  async fetchPoolConfig(owned: OwnedAccountLoader, pool: Address): Promise<VirtualsPoolConfig> {
    const load = accountDataLoader(owned);
    const data = await loadAccount(load, pool, "pool");
    if (!hasDiscriminator(data, VIRTUALS_POOL_DISCRIMINATOR)) {
      throw new Error(`virtuals pool ${pool} discriminator mismatch (not a VirtualsPool account)`);
    }
    if (data.length < POOL_ACCOUNT_SIZE) {
      throw new Error(
        `virtuals pool ${pool} data is ${data.length} bytes, expected at least ${POOL_ACCOUNT_SIZE}`,
      );
    }
    const state = data[88]!;
    if (state !== 1) {
      throw new Error(
        `virtuals pool ${pool} is not Active (state=${state}; 0=Initialized 2=Graduated 3=Migrated)`,
      );
    }
    const baseMint = pubkeyAt(data, 40);
    const virtualY = readUintLE(data, 72, 8);

    // The IDL pins `token_program` to a literal classic-Tokenkeg address, so a
    // Token-2022 base mint cannot be launched through this program (see header).
    // Detect one defensively anyway (by the mint's OWNER: an extensionless
    // Token-2022 mint is byte-identical to a legacy one) and GRACEFULLY
    // SELF-DROP the pool (the SvmRoute orchestrator catches a fetchPoolConfig
    // throw and drops the venue). The LEGACY path is byte-identical; an
    // unreadable mint falls back to the legacy assumption.
    const _mints = [baseMint];
    const _mintAccounts = await Promise.all(_mints.map((m) => owned(m)));
    for (let _i = 0; _i < _mints.length; _i++) {
      const m = _mints[_i]!;
      const account = _mintAccounts[_i]!;
      if (account === null) continue;
      const mintData = account.data;
      if (classifyMintProgram(m, mintData, account.owner) === TOKEN_2022_PROGRAM_ID) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${m} is Token-2022 (this venue's swap is legacy-SPL only)`,
        );
      }
      const { blocking } = parseMintExtensions(mintData);
      if (blocking.length > 0) {
        throw new Error(
          `${SLUG}: dropping pool ${pool} — mint ${m} is un-routable: ${blocking.join("; ")}`,
        );
      }
    }

    const [vpoolTokenAta, vpoolVirtualsAta, platformPrototypeVirtualsAta] = await Promise.all([
      ata(pool, baseMint),
      ata(pool, VIRTUALS_MINT),
      ata(PLATFORM_PROTOTYPE, VIRTUALS_MINT),
    ]);

    return {
      venue: SLUG,
      pool,
      direction: "quoteToBase",
      baseMint,
      virtualY,
      vpoolTokenAta,
      vpoolVirtualsAta,
      platformPrototypeVirtualsAta,
    };
  },
};
