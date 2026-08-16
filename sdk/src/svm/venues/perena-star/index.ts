/**
 * Perena Star — the junior-tranche staking market of Perena's on-chain lending
 * program ("bankineco", `save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H`). The
 * bank mint for the (currently sole) live tranche is a vanity address
 * literally prefixed `star9ag...` — the "Star" product this venue's label
 * names. Atomic pair: `stake_junior` (bank mint in -> junior share token
 * out) / `instant_unstake_junior` (junior share token in -> bank mint out,
 * fee-charged, immediate). `request_unstake_junior` (+ `fulfill_unstake_junior`)
 * is the QUEUED exit path — genuinely asynchronous (a lockup + a second,
 * separately-signed instruction), out of scope for a single atomic CPI, and
 * not implemented here. `deposit_in_lp`/`withdraw_from_lp` (the bank's OWN
 * `yield_manager`-signed rebalancing into/out of its configured lending
 * platform) are NOT a user-facing swap at all — `yield_manager` must sign,
 * which this recipe cannot do — so they are correctly out of scope, not a gap.
 *
 * LAYOUT — ground-truthed against the REAL on-chain accounts, not just the
 * IDL: the program's on-chain Anchor IDL account (17,482 bytes, fetched via
 * the standard `createWithSeed(findProgramAddress([], programId), "anchor:idl",
 * programId)` PDA) gives the exact struct field order for `TrancheState`
 * (bump, _pad, bank: Pubkey, config: TrancheConfig, accounting:
 * TrancheAccounting, _pad) and `BankState` (bump, bank_index, _pad, config:
 * BankConfig, status: BankStatus, accounting: BankAccounting, mint: BankMint,
 * vaults, _pad); this file hand-decodes both as fixed absolute byte offsets
 * (verified against the ONE live tranche/bank pair on mainnet,
 * `hXfEYpB5FB3ZWjGNc5C5JqLixmGdmZFyjXKJB2xFPgc` / `sM6P4mh53CnG4faN4Fo3seY7wMSAiHdy8o6gKjwQF7A`,
 * TrancheState 448 bytes / BankState 1560 bytes, no `Option<T>`/variable-length
 * fields anywhere in either struct's declared prefix — a true fixed-offset
 * decode, unlike e.g. sanctum-stake-pool's cursor).
 *
 * QUOTE MATH — derived from a REAL `stake_junior` transaction's own log line
 * plus THREE ground-truth `simulateTransaction` runs per direction against
 * the live mainnet tranche (mainnet: `2FgdSkPkoxNrfRuVrpdxbfAYvPbdaBkFM1sosTdLbV6e`
 * for stake — a real bank-mint holder — and `A7iAVavBmUHrYRrXUSkhT72B7riqmvcFDSJGu12xXVhP`
 * for unstake — a real junior-share holder — at 1 / 1,000 / 50,000 tokens
 * each, `sigVerify:false`, nothing submitted for real), with the unstake
 * side additionally cross-checked against the REAL pre/post SPL balance
 * delta (not just the log line) via `simulateTransaction`'s `accounts:`
 * read-back:
 *
 *   STAKE:   value  = floor(amountIn * bankPrice / 1e6)
 *            shares = floor(value * 1e6 / sharePrice)
 *   (log-confirmed bit-for-bit at 1e6 / 1e9 / 5e10 raw bank-mint-in: "Staked
 *   1000000 tokens (value 1083471) -> 1020554 junior shares minted" etc.)
 *
 *   UNSTAKE: gross = floor(sharesIn * sharePrice / 1e6)
 *            fee   = floor(gross * feeBps / 1e4)
 *            net   = gross - fee
 *            out   = floor(net * 1e6 / bankPrice)
 *   (balance-delta-confirmed exactly at 1e6 and 1e9 raw shares-in, and 2
 *   lamports conservative — i.e. UNDER, never over — at 5e10: the live
 *   program's own `fee` is consistently ~1-2 units below this `floor`
 *   formula predicts, per the "Unstake early" log's `fee_value` vs this
 *   formula's own `fee`, at every sampled size; this file deliberately does
 *   NOT chase that last-lamport remainder — same "a model more favourable
 *   than reality is a liveness hazard, plain floor already errs SAFE" call
 *   sanctum-stake-pool's own header makes for its `ceil`-via-`floor+1`.
 *   `feeBps` is `earlyUnstakeFeeBps` normally, or `lowStakeFeeBps` when
 *   `lowStakeFeeEnabled` AND `virtualValue*1e4 < yieldingTvl*lowStakeThresholdBps`
 *   — ground-truthed against `@perena/bankineco-sdk`'s own
 *   `fetchUnstakeFee` (the maintainers' published npm client), which computes
 *   the identical threshold off the identical two fields; that SDK's own
 *   single-ratio `shares*sharePrice/bankPrice` shortcut for the GROSS amount
 *   was checked against the real balance delta and found imprecise by
 *   design (an acceptable off-chain estimate, not lamport-exact) — this file
 *   uses the THREE-step form above instead, which matched the real transfer
 *   exactly at two of three sampled sizes and was safely conservative at the
 *   third.
 *
 * Both `bankPrice` (`BankState.mint.price`) and `sharePrice`
 * (`TrancheState.accounting.share_price`) are ADMIN/YIELD-DRIVEN and read
 * LIVE via `accountUint` (never baked as a compile-time param), exactly like
 * every other family's admin-mutable rate. The formula is EXACTLY affine in
 * the trade amount for a fixed live state (no curvature at all) up to the
 * capacity clamp below, so `defaultRungs` is pinned at the framework floor
 * (2) — a straight line loses nothing to a coarser grid, same call as
 * sanctum-stake-pool's header.
 *
 * CAPACITY — STAKE is genuinely uncapped pool-side (mints proportional
 * shares against whatever the trader can transfer; the live bank's own
 * `max_yielding_tvl` is 0/disabled on the only live bank). UNSTAKE is
 * capped: `instant_unstake_junior` transfers `net` bank-mint tokens OUT of
 * `junior_escrow_ata`, and the escrow can hold LESS than an uncapped
 * `net(sharesIn)` would demand — asking for more than that would abort the
 * whole cook (SVM execution-time catch is a platform impossibility, see
 * README). This adapter computes a CONSERVATIVE capacity in SHARES,
 * `capShares = floor(escrowBalance * bankPrice / sharePrice)`, which is
 * provably safe REGARDLESS of the fee (dropping the fee term only ever
 * INCREASES the true payout bound, so capping on the fee-free upper bound
 * can only under-quote, never over-quote): for any `S <= capShares`,
 * `out(S) <= gross(S) <= S*sharePrice/bankPrice <= escrowBalance` (each `<=`
 * from a `floor` never increasing its input, or from `S <= capShares`'s own
 * definition) — so a fully-filled slot at `capShares` never asks the escrow
 * for more than it holds. This is wired as the ladder framework's
 * `capacityInputVar`/`referenceCapacities` mechanism (see obric-v2 for the
 * same pattern): the codegen books each rung's `dIn` from this cap's own
 * DELTA, so the merge's own patched CPI amount (`fill[i]`) can never exceed
 * `capShares` either, even when this slot is the last one standing with
 * budget still remaining (the "phantom capacity past the real cap" failure
 * mode a plain `emitQuoteCall`-only clamp would NOT prevent, since the
 * merge's `din[]` booking would still use the raw, uncapped grid span for
 * `fill[i]` unless `capacityInputVar` tells it otherwise).
 *
 * SELF-DROP — `BankStatus.is_halted` (protocol-wide) plus the
 * direction-specific `is_halted_deposit` / `is_halted_withdrawal` (both set
 * by `trigger_bank_circuit_breaker`) are read LIVE in the fragment (not just
 * at fetch time — SVM has no execution-time catch, so a flag that flips
 * between prepare and cook must still zero the quote rather than let a
 * doomed CPI launch) and force `capShares` to 0, which floors every rung's
 * quote to 0 and keeps the merge from ever electing this slot — the same
 * "deactivate rather than throw at cook time" shape obric-v2's oracle-status
 * check uses. `fetchPoolConfig` ALSO throws immediately on an
 * ALREADY-halted pool (protocol-wide `is_halted`) so a permanently-dead
 * tranche never enters the universe at all; the direction-specific flags are
 * snapshotted onto the config and re-checked in the family's `gate` hook
 * (the consuming app SVM solver entry) as the same belt-and-suspenders prepare-time
 * shortcut every other family's activation gate uses.
 *
 * ACCOUNTS — both instructions take a SINGLE `u64` arg (`amount`/`shares`)
 * with NO trailing on-chain min-out param, so `suffix` is empty on both
 * (the recipe's own terminal outAta delta check is the real bound, as
 * always). `instant_unstake_junior` additionally declares 8 TRAILING
 * `optional` accounts (a yielding-mint conversion detour this adapter never
 * uses — `target_mint` is always `bank_mint`, the "plain" redemption case).
 * Ground-truthed live: omitting them entirely fails
 * (`AccountNotEnoughKeys`/0xbbd) — Anchor's own generated TS client
 * (`@perena/bankineco-sdk`) instead passes the PROGRAM's OWN id as the
 * "None" sentinel for each of the 8 slots (`accountsPartial({..., vaultState:
 * yr?.vaultState ?? null, ...})`, which that SDK's Anchor version resolves to
 * `programId` on the wire) — confirmed by re-simulating with exactly that
 * (8 trailing `programId` accounts) and observing a clean success at all
 * three sampled sizes, both via `unitsConsumed` and the real balance delta.
 * `junior_mint`/`bank_mint` are assumed classic SPL Token (not Token-2022) —
 * confirmed against the one live tranche's real transactions; the
 * `AccountLoader` this framework's `fetchPoolConfig` receives carries no
 * owner field to detect Token-2022 generically (unlike raydium-cp-swap,
 * whose pool state stores each mint's owning program directly).
 *
 * CU — see ../budget.ts's `perena-star` entry for the measurement citation
 * (real `simulateTransaction` runs against the live mainnet tranche, both
 * instructions, three sizes each).
 */
import { address, getAddressDecoder } from '@solana/kit';
import type { Address } from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

export const PERENA_STAR_PROGRAM_ID = address('save8RQVPMWNTzU18t3GBvBkN9hT7jsGjiCQ28FpD9H');

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TRANCHE_STATE_DISCRIMINATOR = Uint8Array.from([212, 231, 254, 24, 238, 63, 92, 105]);
const BANK_STATE_DISCRIMINATOR = Uint8Array.from([16, 169, 126, 99, 35, 169, 73, 200]);

const TRANCHE_STATE_SIZE = 448;
const BANK_STATE_SIZE = 1560;

// TrancheState absolute byte offsets (8-byte Anchor discriminator included).
const OFF_TRANCHE_BANK = 16; // pubkey
const OFF_MINT = 48; // pubkey — TrancheConfig.mint (the bank mint, "senior" token)
const OFF_SHARE_MINT = 80; // pubkey — TrancheConfig.share_mint (the junior share token)
// BankState absolute byte offsets (8-byte Anchor discriminator included).
const OFF_IS_HALTED = 152; // u8 (PodBool)
const OFF_IS_HALTED_DEPOSIT = 153; // u8 (PodBool)
const OFF_IS_HALTED_WITHDRAWAL = 154; // u8 (PodBool)
function readUintLE(data: Uint8Array, offset: number, width: number): bigint {
  if (offset + width > data.length) throw new Error('perena-star: truncated account data');
  let v = 0n;
  for (let i = width - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]!);
  return v;
}

export interface PerenaStarPoolConfig extends PoolConfig {
  venue: 'perena-star';
  bank: Address;
  bankMint: Address;
  juniorMint: Address;
  escrowAta: Address;
  lockedSharesAta: Address;
  /** Prepare-time snapshot of BankStatus — re-checked live in the fragment (see module header). */
  isHaltedDeposit: boolean;
  isHaltedWithdrawal: boolean;
  /** 'stake' (default, bank mint in / junior shares out) | 'unstake' (junior shares in / bank mint out). */
  direction: 'stake' | 'unstake';
}

async function fetchPerenaStarPoolConfig(load: AccountLoader, pool: Address): Promise<PerenaStarPoolConfig> {
  const decoder = getAddressDecoder();
  const pubkey = (data: Uint8Array, offset: number): Address => decoder.decode(data.subarray(offset, offset + 32));

  const trancheData = await load(pool);
  if (trancheData === null) throw new Error(`perena-star tranche ${pool} not found`);
  if (trancheData.length !== TRANCHE_STATE_SIZE) {
    throw new Error(`perena-star tranche ${pool} data is ${trancheData.length} bytes, expected ${TRANCHE_STATE_SIZE}`);
  }
  for (let i = 0; i < 8; i++) {
    if (trancheData[i] !== TRANCHE_STATE_DISCRIMINATOR[i]) {
      throw new Error(`perena-star tranche ${pool} has a wrong discriminator (not a TrancheState account)`);
    }
  }

  const bank = pubkey(trancheData, OFF_TRANCHE_BANK);
  const bankMint = pubkey(trancheData, OFF_MINT);
  const juniorMint = pubkey(trancheData, OFF_SHARE_MINT);

  // Token-2022 safety: stake_junior/instant_unstake_junior move both mints via a
  // legacy-SPL (Tokenkeg) token program, so a Token-2022 mint (or one carrying an
  // un-routable extension) SELF-DROPS the pool via a thrown, clearly-described
  // error — the SvmRoute orchestrator catches a fetchPoolConfig throw and drops
  // the venue. The legacy path stays byte-identical: a classic 82-byte mint
  // classifies as legacy → no throw, and an unreadable mint (not vendored by a
  // fixture) falls back to legacy.
  for (const mint of [bankMint, juniorMint]) {
    const mintData = await load(mint);
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`perena-star: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`perena-star: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const bankData = await load(bank);
  if (bankData === null) throw new Error(`perena-star bank ${bank} not found`);
  if (bankData.length !== BANK_STATE_SIZE) {
    throw new Error(`perena-star bank ${bank} data is ${bankData.length} bytes, expected ${BANK_STATE_SIZE}`);
  }
  for (let i = 0; i < 8; i++) {
    if (bankData[i] !== BANK_STATE_DISCRIMINATOR[i]) {
      throw new Error(`perena-star bank ${bank} has a wrong discriminator (not a BankState account)`);
    }
  }
  const bankMintFromBank = pubkey(bankData, 320);
  if (bankMintFromBank !== bankMint) {
    throw new Error(`perena-star bank ${bank} mint ${bankMintFromBank} does not match tranche config mint ${bankMint}`);
  }
  const isHalted = readUintLE(bankData, OFF_IS_HALTED, 1) !== 0n;
  if (isHalted) {
    throw new Error(`perena-star tranche ${pool} is halted (BankStatus.is_halted, snapshot at fetch time)`);
  }
  const isHaltedDeposit = readUintLE(bankData, OFF_IS_HALTED_DEPOSIT, 1) !== 0n;
  const isHaltedWithdrawal = readUintLE(bankData, OFF_IS_HALTED_WITHDRAWAL, 1) !== 0n;

  const [escrowAta] = await findAssociatedTokenPda({ owner: pool, mint: bankMint, tokenProgram: TOKEN_PROGRAM });
  const [lockedSharesAta] = await findAssociatedTokenPda({ owner: pool, mint: juniorMint, tokenProgram: TOKEN_PROGRAM });

  return {
    venue: 'perena-star',
    pool,
    bank,
    bankMint,
    juniorMint,
    escrowAta,
    lockedSharesAta,
    isHaltedDeposit,
    isHaltedWithdrawal,
    direction: 'stake',
  };
}

export const perenaStar = {
  slug: 'perena-star' as const,
  programId: PERENA_STAR_PROGRAM_ID,
  fetchPoolConfig: fetchPerenaStarPoolConfig,
};

