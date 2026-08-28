/**
 * spl-token-swap FORKS — six independently-deployed programs that all run the
 * SAME open-source `solana-labs/solana-program-library` `token-swap` codebase
 * (Token Swap itself, DexLab, Saros, Orca's ORIGINAL v1 fork, Penguin, StepN's
 * Dooar): the identical 324-byte `SwapVersion::SwapV1` account layout (no
 * discriminator, manual `Pack`), the identical `Swap` instruction (tag 1,
 * `[amount_in u64 LE][minimum_amount_out u64 LE]`, the same 10-account order),
 * and the identical constant-product-with-fees math the sibling
 * `orca-legacy-token-swap` adapter (itself a
 * SEPARATE spl-token-swap fork at program `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP`)
 * already decodes and quotes — see that adapter's header for the shared
 * derivation. The only thing that differs PER FORK is the deployed program id
 * (which changes both the `create_program_address` swap-authority PDA domain
 * and the CPI target), so this module is a single parameterized factory
 * instantiated once per program id below, not six copies of the math.
 *
 * GROUND TRUTH for the six program ids: Jupiter's own `program-id-to-label`
 * capture (`benchmark/adapters/fixtures/jupiter-program-id-to-label.json`) —
 * `SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8` "Token Swap",
 * `DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N` "DexLab",
 * `SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr` "Saros",
 * `DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1` "Orca V1" (a GENUINELY
 * DIFFERENT program from "Orca V2"'s `9W959D...` — confirmed live, see
 * `benchmark/adapters/_svm-venues.ts`'s prior no-analogue note, now
 * superseded by this wiring),
 * `PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP` "Penguin",
 * `Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j` "StepN". Live pool counts at
 * this 324-byte layout (measured 2026-07-31 via a keyless `getProgramAccounts`
 * memcmp sweep, `curve_type` (offset 291) filtered to 0 = constant product):
 * DexLab 2,097 / Saros 554 / Token Swap 339 / Orca V1 31 / Penguin 29 /
 * StepN 6 pools.
 *
 * FIVE of the six are FULLY WIRED and real-CPI proven at 3+ sizes each
 * against their own real mainnet fixture pool and their own real dumped
 * binary (see the consuming app realcpi e2e test): token-swap-v1,
 * orca-v1, penguin, stepn, and (2026-08-03, see `saros`'s own doc comment
 * below for the conservative-margin resolution) saros. The remaining ONE —
 * dexlab — is WIRED (program id, discovery filter, CU entry, all exercised
 * the same as the other five) but GATED: `fetchPoolConfig` throws
 * unconditionally for every pool of that family (see
 * `makeSplTokenSwapForkAdapter`'s `unresolvedGate` parameter, and its own
 * doc comment below for exactly what
 * real-CPI testing found and why it isn't safe to guess at). A gated family
 * can never enter the electable universe (`resolveSvmPoolSpec` drops any
 * `fetchPoolConfig` throw) — so this is a zero-risk placeholder for a
 * follow-up, not a shipped-but-wrong integration.
 *
 * The spl-token-swap STABLE curve (`curve_type` nonzero, an amplification
 * coefficient in the calculator blob) is explicitly OUT OF SCOPE here, same
 * as `orca-legacy-token-swap` — `fetchPoolConfig` throws on any nonzero
 * `curve_type` rather than silently mis-pricing a stable pool with CP math.
 */
import { createHash } from 'node:crypto';
import { getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import type { AccountBytesMap, AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from '../types.js';

// SwapVersion::pack writes version at byte 0 and the 323-byte SwapV1 body at
// bytes 1..: 1 + 323 = 324, no discriminator, no padding — identical across
// every spl-token-swap deployment (see module header).
const POOL_SIZE = 324;

/**
 * Little-endian unsigned field read (the TS mirror of the compiler's
 * accountUint(ref, offset, width)) and ceiling division — the same tiny pure
 * helpers `@eco-incorp/sauce-sdk/svm`'s venue adapters use internally
 * (`venues/math.js`, not part of the package's public `/svm` barrel export,
 * so re-implemented here rather than deep-imported).
 */
function readUintLE(data: Uint8Array, offset: number, width: number): bigint {
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}

/** Ceiling division: smallest q with q * b >= a. Non-negative dividends only. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export interface SplTokenSwapForkPoolConfig extends PoolConfig {
  /** Swap-authority PDA: create_program_address([pool, [bump_seed@2]], THIS fork's program). */
  swapAuthority: Address;
  /** token_program_id @3. */
  tokenProgram: Address;
  /** Vault of the input mint (token_a @35 — quote direction is A -> B). */
  vaultIn: Address;
  /** Vault of the output mint (token_b @67). */
  vaultOut: Address;
  /** pool_mint @99 — writable in the swap ix (owner fee is minted as LP tokens). */
  poolMint: Address;
  /** pool_fee_account @195 — pool-mint token account receiving the owner fee. */
  poolFeeAccount: Address;
  /** token_a_mint @131. */
  inputMint: Address;
  /** token_b_mint @163. */
  outputMint: Address;
  /** trade_fee_numerator @227 / trade_fee_denominator @235. */
  tradeFeeNumerator: bigint;
  tradeFeeDenominator: bigint;
  /** owner_trade_fee_numerator @243 / owner_trade_fee_denominator @251. */
  ownerTradeFeeNumerator: bigint;
  ownerTradeFeeDenominator: bigint;
  /** bump_seed @2 — the stored (not necessarily canonical) swap-authority nonce. */
  bumpSeed: number;
}

/**
 * fees.rs calculate_fee: zero when the rate or the amount is zero, otherwise
 * floor(x * n / d) but at least 1 raw unit — identical across every
 * spl-token-swap deployment (same open-source `fees.rs`).
 */
function swapFee(x: bigint, numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n || x === 0n) return 0n;
  const fee = (x * numerator) / denominator;
  return fee === 0n ? 1n : fee;
}

/** Fees are baked into the emitted quote, so netIn is compile-time for a fixed amountIn. */
function netAmountIn(slug: string, cfg: SplTokenSwapForkPoolConfig, amountIn: bigint): bigint {
  if (amountIn <= 0n || amountIn >= 1n << 64n) {
    throw new Error(`${slug} amountIn must be a positive u64, got ${amountIn}`);
  }
  const tradeFee = swapFee(amountIn, cfg.tradeFeeNumerator, cfg.tradeFeeDenominator);
  const ownerFee = swapFee(amountIn, cfg.ownerTradeFeeNumerator, cfg.ownerTradeFeeDenominator);
  const netIn = amountIn - tradeFee - ownerFee;
  if (netIn <= 0n) throw new Error(`${slug} amountIn ${amountIn} is consumed entirely by fees`);
  return netIn;
}

/**
 * create_program_address for the STORED bump (a pool may have been
 * initialized with a non-canonical nonce, so find-style derivation is wrong
 * here — see orca-legacy-token-swap's identical note). No on-curve rejection:
 * the pool exists on-chain with this bump under THIS fork's program id, so
 * the derivation is already known to be off-curve.
 */
function deriveSwapAuthority(programId: Address, pool: Address, bumpSeed: number): Address {
  const codec = getAddressCodec();
  return codec.decode(
    createHash('sha256')
      .update(new Uint8Array(codec.encode(pool)))
      .update(Uint8Array.of(bumpSeed))
      .update(new Uint8Array(codec.encode(programId)))
      .update('ProgramDerivedAddress')
      .digest(),
  );
}

const poolRef = (slug: string, cfg: SplTokenSwapForkPoolConfig, role: string): string => `${slug}:${cfg.pool}:${role}`;

export interface SplTokenSwapForkAdapter {
  slug: string;
  kind: 'constant-product';
  programId: Address;
  fetchPoolConfig(load: AccountLoader, pool: Address): Promise<SplTokenSwapForkPoolConfig>;
  quoteAccounts(cfg: SplTokenSwapForkPoolConfig): VenueAccount[];
  emitQuote(cfg: SplTokenSwapForkPoolConfig, i: number, amountIn: bigint): string;
  buildSwap(cfg: SplTokenSwapForkPoolConfig, user: SwapUser, amountIn: bigint): VenueSwap;
  referenceQuote(cfg: SplTokenSwapForkPoolConfig, state: AccountBytesMap, amountIn: bigint, _now: bigint): bigint;
}

/**
 * One adapter per deployed spl-token-swap fork — SAME math/layout as
 * orca-legacy-token-swap (see module header), parameterized only by the
 * fork's own program id (the CPI target AND the swap-authority PDA domain).
 *
 * `unresolvedGate`, when passed, makes `fetchPoolConfig` throw UNCONDITIONALLY
 * for every pool of this family (naming the reason) — the SAME mechanism
 * `orca-legacy-token-swap` uses to keep its stable-curve pools out of the
 * electable universe (see that adapter's `curve_type` check), just applied to
 * the WHOLE family instead of a per-pool byte. `resolveSvmPoolSpec` catches
 * any `fetchPoolConfig` throw and drops the candidate — one venue's gate
 * never breaks discovery or any other family, and (critically) it means the
 * family is WIRED (program id, discovery filter, CU entry all present and
 * exercised) while being STRUCTURALLY UNABLE to enter a cook until the gate
 * is lifted, so there is zero production revert/mispricing risk from an
 * unresolved integration question. See ./index.ts's `dexlab`/`saros`
 * instantiations below for the two currently gated forks and exactly what
 * each is waiting on.
 */
export function makeSplTokenSwapForkAdapter(slug: string, programId: Address, unresolvedGate?: string): SplTokenSwapForkAdapter {
  return {
    slug,
    kind: 'constant-product',
    programId,
    async fetchPoolConfig(load, pool) {
      if (unresolvedGate !== undefined) {
        throw new Error(`${slug} pool ${pool}: family gated pending resolution — ${unresolvedGate}`);
      }
      const data = await load(pool);
      if (data === null) throw new Error(`${slug} pool ${pool} account not found`);
      if (data.length !== POOL_SIZE) {
        throw new Error(`${slug} pool ${pool} data must be ${POOL_SIZE} bytes (SwapVersion::SwapV1), got ${data.length}`);
      }
      if (data[0] !== 1) throw new Error(`${slug} pool ${pool} version must be 1 (SwapV1), got ${data[0]}`);
      if (data[1] !== 1) throw new Error(`${slug} pool ${pool} is not initialized`);
      // The stable curve (curve_type != 0, amp in the calculator blob) is out
      // of scope — see module header.
      if (data[291] !== 0) {
        throw new Error(`${slug} pool ${pool} curve_type must be 0 (constant product), got ${data[291]}`);
      }
      const codec = getAddressCodec();
      const pubkey = (offset: number): Address => codec.decode(data.subarray(offset, offset + 32));
      const u64 = (offset: number): bigint => readUintLE(data, offset, 8);
      const tradeFeeNumerator = u64(227);
      const tradeFeeDenominator = u64(235);
      const ownerTradeFeeNumerator = u64(243);
      const ownerTradeFeeDenominator = u64(251);
      for (const [name, numerator, denominator] of [
        ['trade', tradeFeeNumerator, tradeFeeDenominator],
        ['owner trade', ownerTradeFeeNumerator, ownerTradeFeeDenominator],
      ] as const) {
        if (numerator !== 0n && denominator === 0n) {
          throw new Error(`${slug} pool ${pool} ${name} fee denominator is 0 with nonzero numerator ${numerator}`);
        }
      }
      const bumpSeed = data[2];
      return {
        venue: slug,
        pool,
        swapAuthority: deriveSwapAuthority(programId, pool, bumpSeed),
        // token_program_id @3 — the classic spl-token-swap `Swap` ix takes ONE
        // token program used for BOTH vaults and the pool mint, so a per-side
        // program does not exist for this family: a pool mixing legacy + T22
        // mints cannot function under this program. This reads the pool's own
        // stored program (legacy OR Token-2022), so a T22 pool threads T22 here
        // with no hardcoded-legacy assumption — buildSwap forwards it verbatim.
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
      return [
        { ref: poolRef(slug, cfg, 'vault-in'), address: cfg.vaultIn },
        { ref: poolRef(slug, cfg, 'vault-out'), address: cfg.vaultOut },
      ];
    },
    emitQuote(cfg, i, amountIn) {
      const netIn = netAmountIn(slug, cfg, amountIn);
      const vaultIn = JSON.stringify(poolRef(slug, cfg, 'vault-in'));
      const vaultOut = JSON.stringify(poolRef(slug, cfg, 'vault-out'));
      return [
        `const rIn${i} = accountUint(${vaultIn}, 64, 8);`,
        `const rOut${i} = accountUint(${vaultOut}, 64, 8);`,
        `const q${i} = rOut${i} - (rIn${i} * rOut${i} + rIn${i} + ${netIn - 1n}) / (rIn${i} + ${netIn});`,
      ].join('\n');
    },
    buildSwap(cfg, user, amountIn) {
      if (amountIn <= 0n || amountIn >= 1n << 64n) {
        throw new Error(`${slug} amountIn must be a positive u64, got ${amountIn}`);
      }
      const data = new Uint8Array(17);
      data[0] = 1;
      new DataView(data.buffer).setBigUint64(1, amountIn, true);
      new DataView(data.buffer).setBigUint64(9, 1n, true);
      return {
        programId,
        data,
        accounts: [
          { ref: poolRef(slug, cfg, 'pool'), address: cfg.pool },
          { ref: poolRef(slug, cfg, 'authority'), address: cfg.swapAuthority },
          { ref: user.owner, signer: true },
          { ref: user.inAta, writable: true },
          { ref: poolRef(slug, cfg, 'vault-in'), address: cfg.vaultIn, writable: true },
          { ref: poolRef(slug, cfg, 'vault-out'), address: cfg.vaultOut, writable: true },
          { ref: user.outAta, writable: true },
          { ref: poolRef(slug, cfg, 'pool-mint'), address: cfg.poolMint, writable: true },
          { ref: poolRef(slug, cfg, 'fee-account'), address: cfg.poolFeeAccount, writable: true },
          { ref: poolRef(slug, cfg, 'token-program'), address: cfg.tokenProgram },
        ],
      };
    },
    referenceQuote(cfg, state, amountIn, _now) {
      const vaults: Uint8Array[] = [];
      for (const vault of [cfg.vaultIn, cfg.vaultOut]) {
        const data = state[vault];
        if (data === undefined) throw new Error(`${slug} vault ${vault} missing from state`);
        vaults.push(data);
      }
      const rsIn = readUintLE(vaults[0], 64, 8);
      const rsOut = readUintLE(vaults[1], 64, 8);
      const netIn = netAmountIn(slug, cfg, amountIn);
      const invariant = rsIn * rsOut;
      const newIn = rsIn + netIn;
      if (invariant / newIn === 0n) throw new Error(`${slug} swap fails on-chain (zero quotient)`);
      const newOut = ceilDiv(invariant, newIn);
      const amountOut = rsOut - newOut;
      if (amountOut === 0n) throw new Error(`${slug} swap fails on-chain (zero output)`);
      return amountOut;
    },
  };
}

/** Token Swap — the original solana-labs/solana-program-library deployment. */
export const TOKEN_SWAP_V1_PROGRAM_ID = 'SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8' as Address;
export const tokenSwapV1 = makeSplTokenSwapForkAdapter('token-swap-v1', TOKEN_SWAP_V1_PROGRAM_ID);

/**
 * DexLab — GATED (see `unresolvedGate` above): a real-CPI probe against the
 * live mainnet binary (a real SOL/USDC pool, `4KizLX56YSbTtc8NJQWDBz3iiwSTpJRHFUXAvB4v6MM3`,
 * dumped 2026-07-31) shows the deployed `Swap` instruction reads MORE than
 * the standard spl-token-swap 10 (or 11, with the optional host-fee account)
 * accounts — it still fails `NotEnoughAccountKeys` with 10 or 11 provided,
 * and only clears that check at 14 (10 + 4 arbitrary dummy reads), at which
 * point it fails a DIFFERENT (custom code 24) check — meaning DexLab's fork
 * genuinely extends the account list with something this repo hasn't
 * identified (no public source was available to cross-reference). Gated
 * rather than guessed at: a wrong account list here would revert every
 * dexlab cook in production, and DexLab is otherwise the single
 * deepest-liquidity fork of the six (2,097 live constant-product pools).
 */
export const DEXLAB_PROGRAM_ID = 'DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N' as Address;
export const dexlab = makeSplTokenSwapForkAdapter(
  'dexlab',
  DEXLAB_PROGRAM_ID,
  'Swap instruction needs >11 accounts on the real deployed binary (confirmed via real-CPI probe); exact extra account(s) not yet identified',
);

/**
 * Saros — UN-GATED (2026-08-03; was gated, see git history for the original
 * `unresolvedGate` text). The original real-CPI probe against the live
 * mainnet binary (a real WSOL/USDC pool,
 * `Djxfn7zWFxFqYgwesXfq8BeAirfXwfhQmNcCousXh7G7`, dumped 2026-07-31) found
 * the same fee-MODEL divergence this comment used to describe: REALIZED
 * output across 14 independently-sampled real trades (27,995 to 6,089,579
 * raw units) implies an effective swap fee of a clean, reproducible ~4 bps —
 * NOT the 30 bps the pool's own on-chain `owner_trade_fee` field states
 * (`trade_fee` reads 0 bps). The account layout is confirmed correct up
 * through `pool_fee_account` (the swap only succeeds because that key check
 * passes) — this is a genuine fee-MODEL divergence, not a decode bug: Saros's
 * deployed program evidently does not compute the swap fee the vanilla
 * spl-token-swap way from the fields at these offsets, and no public source
 * was available to determine the real rule (the likely explanation, not
 * confirmed: the stored `owner_trade_fee` sizes how many LP tokens this fork
 * mints to `pool_fee_account` — confirmed growing consistent with invariant
 * growth on every sampled trade — while the amount actually deducted from
 * the trader's output is governed by a separate, unrecovered constant).
 *
 * Rather than continue gating on an unresolved exact rule, this adapter
 * deliberately keeps the generic `makeSplTokenSwapForkAdapter` formula
 * (the STORED, higher trade+owner fee rates as the netIn deduction) as a
 * MEASURED, DELIBERATE safety margin: across all 14 sampled trades this
 * model's predicted output was strictly <= the real realized output every
 * time (margins of ~0.05%-0.26% of the trade) — never an over-promise, so
 * quoting it is safe for election (a worse model never wins a share it
 * doesn't deserve), the same closed-source-fork trade-off `gamma`'s
 * dynamic-fee ceiling already makes. Proven end-to-end against the real
 * deployed binary in LiteSVM at 2 and 4 rungs plus three additional sizes
 * (`predicted <= realized` at every sampled size, never `===`, unlike the
 * `orca-legacy-token-swap`/`token-swap-v1`/etc. siblings this fork's math was
 * cloned from) — see the consuming app realcpi e2e test's `saros`
 * describeWith block in sauce-recipes.
 */
export const SAROS_PROGRAM_ID = 'SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr' as Address;
export const saros = makeSplTokenSwapForkAdapter('saros', SAROS_PROGRAM_ID);

/**
 * Orca V1 — the ORIGINAL Orca token-swap deployment, a DIFFERENT program from
 * the already-wired `orca-legacy-token-swap` ("Orca V2",
 * `9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP`). Confirmed distinct live
 * (routePlan ammKey `6fTRDD7sYxCN7oyoSQaN1AWC3P2m8A6gVZzGrpej9DvL`, owner
 * `DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1`).
 */
export const ORCA_V1_PROGRAM_ID = 'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1' as Address;
export const orcaV1 = makeSplTokenSwapForkAdapter('orca-v1', ORCA_V1_PROGRAM_ID);

/** Penguin. */
export const PENGUIN_PROGRAM_ID = 'PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP' as Address;
export const penguin = makeSplTokenSwapForkAdapter('penguin', PENGUIN_PROGRAM_ID);

/** StepN (Dooar). */
export const STEPN_PROGRAM_ID = 'Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j' as Address;
export const stepn = makeSplTokenSwapForkAdapter('stepn', STEPN_PROGRAM_ID);
