/**
 * Sanctum stake-pool family — four on-chain program deploys of the SAME
 * SPL-Stake-Pool-lineage bytecode (Jupiter's `program-id-to-label` labels ALL
 * FOUR "Sanctum"): `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` (the
 * canonical public `spl-stake-pool` program — confirmed live via scnSOL,
 * JitoSOL, BNSOL below), `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY`
 * (confirmed live via dSOL), `SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn`
 * (confirmed live via jupSOL), and `stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq`
 * (zero `getProgramAccounts`-visible pools as of 2026-07-31 — a spare/reserve
 * deploy Sanctum keeps ready; wired anyway per this repo's no-premature-
 * gating policy, so a future pool created under it self-activates with no
 * code change). One adapter factory (`makeSanctumStakePoolLadder`) serves
 * all four — the account layout and instruction ABI are byte-identical
 * across the four deploys.
 *
 * LAYOUT — the public `solana-program/stake-pool` `StakePool` struct
 * (`program/src/state.rs`), Borsh-serialized. NOT a fixed-offset struct in
 * the general case: `next_epoch_fee`/`next_stake_withdrawal_fee`/
 * `next_sol_withdrawal_fee` are `FutureEpoch<Fee>` (1-byte tag, +16 bytes iff
 * `One`/`Two`) and `preferred_deposit_validator_vote_address`/
 * `preferred_withdraw_validator_vote_address`/`sol_deposit_authority`/
 * `sol_withdraw_authority` are `Option<Pubkey>` (1-byte tag, +32 iff `Some`)
 * — so this decoder is a SEQUENTIAL CURSOR, not a fixed-offset table,
 * correctly handling any pool regardless of which optional fields are set
 * (measured live: 2,288 of 2,306 `getProgramAccounts`-visible pools across
 * the three active programs are the "everything None" 611-byte shape, but
 * the cursor decodes the other sizes — 664/1024/2320 bytes observed live —
 * identically; `stake_pool.is_valid()`'s own account_type==1 gate, mirrored
 * here as the leading byte check, is the only shape precondition). Crucially,
 * `total_lamports`/`pool_token_supply` sit BEFORE every optional field
 * (offsets 258/266 are universal constants regardless of what's Some/None
 * later in the struct) — the two live values this adapter's on-chain
 * fragment reads at cook time — so the compiled shape needs no per-pool
 * offset variance at all; `sol_deposit_fee` (which DOES sit after the
 * variable-length prefix) is read once off-chain at fetch time and ridden
 * as a per-trade PARAM instead, exactly like raydium-amm-v4's fee bps.
 *
 * QUOTE MATH — ground-truthed against the REAL deployed program, not
 * reverse-engineered: `calc_pool_tokens_for_deposit`/
 * `calc_pool_tokens_sol_deposit_fee`/`Fee::apply` in the SAME public
 * `program/src/state.rs` give the exact closed form —
 * `minted = floor(x * pool_token_supply / total_lamports)` (or `= x` when
 * either is 0, the bootstrap case) and `fee = ceil(minted * sol_deposit_fee
 * .numerator / sol_deposit_fee.denominator)` (0 if `denominator == 0`),
 * `out = minted - fee`. Validated 2026-07-31 via `simulateTransaction`
 * (`sigVerify:false`, `accounts:` state read-back) against FOUR real
 * mainnet pools spanning all three currently-live programs — BNSOL
 * (`SPoo1…`), JitoSOL (`SPoo1…`), jupSOL (`SPMBzs…`), dSOL (`SP12tW…`) — at
 * three sizes each (0.001 / ~0.14 / 1–3 SOL): the manager's own token
 * account was used as depositor+dest+referrer (any existing wallet works
 * for a dry-run CPI; nothing was submitted for real), and every one of the
 * 11 sampled deliveries matched this formula bit-for-bit. The formula is
 * exactly affine in `x` (monotone AND concave trivially — no curvature to
 * misrepresent on a coarse ladder), so `defaultRungs` is pinned at the
 * framework floor (`MIN_RUNGS` = 2): a straight line loses nothing to a
 * coarser grid. This adapter is conservative on the fee rounding
 * specifically: it computes `ceil` via `floor + 1` whenever the fee is
 * nonzero (never re-deriving the exact remainder, which would need a second
 * wide multiply this repo's `Math.mulDiv` intrinsic doesn't expose) — this
 * NEVER over-predicts the real payout (ceil ≥ true ceil always), matching
 * the "a model more favourable than reality is a liveness hazard" rule; the
 * TS `referenceQuote` mirrors the exact same rounding, so the two stay
 * lockstep even though the last-lamport-of-fee case is a deliberate,
 * documented pessimistic simplification versus the real program's own
 * remainder-exact ceiling.
 *
 * A REAL, LIVE gate this adapter enforces and the validation run above
 * surfaced directly: `process_deposit_sol` reverts
 * (`StakeListAndPoolOutOfDate`, custom error 0x11) whenever
 * `last_update_epoch < clock.epoch` — i.e. a pool whose daily crank hasn't
 * run yet THIS epoch cannot accept a deposit at all. Three of the small/mid
 * pools sampled during validation hit exactly this revert; the three
 * majors (BNSOL/JitoSOL/jupSOL/dSOL) were current. Because a launched CPI
 * failure aborts the whole cook on SVM (no execution-time catch — see
 * the consuming app SVM README's parity verdicts), this MUST be a prepare-time
 * self-drop, not an on-chain guard: `fetchPoolConfig` reads the Clock
 * sysvar via the SAME `load` (a second, ordinary account read — the same
 * multi-read pattern obric-v2's fetch already uses for its price feeds) and
 * throws when the pool is stale, exactly like every other family's
 * out-of-scope gate.
 *
 * DIRECTION — SOL deposit only (`DepositSol`, ix tag 14). The reverse
 * (`WithdrawSol`) pays out NATIVE lamports to a wallet, not an SPL account,
 * and is explicitly deferred (this venue's own integration plan calls for
 * implementing deposit first and self-dropping withdraw for now — no
 * `REVERSE_DIRECTION` entry, `applyDirection` throws on any non-default
 * direction, same shape as orca-legacy-token-swap/saber-stableswap/
 * meteora-damm-v1-stable).
 *
 * ACCOUNTS ARE NATIVE-SOL, NOT `inAta` — a DELIBERATE, DOCUMENTED deviation
 * from every sibling family. `DepositSol`'s `from_user_lamports_info` is a
 * plain System-owned wallet debited via a raw `system_instruction::transfer`
 * CPI (`processor.rs`'s `sol_transfer`) — NOT an SPL token account; a wSOL
 * ATA is Token-Program-owned and the System Program's transfer instruction
 * hard-rejects a non-System-owned source (`ExternalAccountLamportSpend`),
 * so `user.inAta` cannot serve this role at all, and there is no partial
 * "unwrap some of my wSOL ATA into lamports" SPL primitive to bridge it
 * (`CloseAccount` reclaims a whole account's lamports, never a slice). This
 * adapter instead debits `user.owner` — the SAME wallet already attached as
 * signer for every other family's token-authority role, and the
 * Solana-idiomatic way every real SOL-deposit integration (Sanctum's own
 * UI, Jupiter's stake widget) sources the deposit lamports directly from
 * the connected wallet rather than a pre-wrapped ATA. `user.outAta` (the
 * LST destination) and `owner` (signer) are the only `SwapUser` refs this
 * family uses; `inAta` is unused. `mints()` still reports `inMint =`
 * the well-known wSOL mint for pair-matching (this is the recipe's only
 * vocabulary for "the user is trading SOL"), so the caveat that follows is
 * real and worth stating plainly rather than glossing over: in the
 * `amountIn=0` balance-input sentinel specifically, "amountIn" is derived
 * on-chain from `inAta`'s LIVE balance alone (see the consuming app SVM README),
 * so this family's owner-wallet-sourced contribution is NOT reflected in
 * that derivation — a sized (`amountIn>0`) request has no such gap (the
 * merge never assigns any slot more than the trade's own declared budget,
 * regardless of which underlying account physically funds it, and the
 * signer's signature on the whole transaction is the consent boundary for
 * whatever it debits from their own wallet either way).
 *
 * CPI — `DepositSol(u64)`: tag `14` (`StakePoolInstruction`'s 15th variant,
 * confirmed against `program/src/instruction.rs`, not the `15` a naive
 * off-by-one read of the enum would produce) ++ patched amount, no trailing
 * bytes (no on-chain min-out param on the plain variant — this repo's own
 * terminal outAta delta check is the real bound, matching every other
 * family). Ten accounts, order confirmed against BOTH `instruction.rs`'s
 * doc comment and a live simulated + a real historical DepositStake tx's
 * withdraw-authority account (bit-identical to this file's own PDA
 * derivation): stake pool (w), withdraw authority (r), reserve stake (w),
 * depositor (`user.owner`, signer, w), dest pool-token account
 * (`user.outAta`, w), manager fee account (w), referrer fee account (w —
 * this adapter reuses the pool's own manager fee account as referrer, a
 * standard no-referral-program integrator default: it is guaranteed to
 * already be a valid token account of the right mint, so it needs no extra
 * account from the caller), pool mint (w), system program, token program.
 * `withdraw_authority` is `create_program_address([pool, "withdraw",
 * [stake_withdraw_bump_seed]], programId)` — the STORED bump, not a fresh
 * `find_program_address` search (`lib.rs`'s `AUTHORITY_WITHDRAW = b"withdraw"`
 * literal); this file's derivation matched a real, unrelated, live
 * DepositStake transaction's own withdraw-authority account bit-for-bit
 * during validation.
 *
 * CU — `../budget.ts` cites the measurement method (real `simulateTransaction`
 * runs against four live mainnet pools, ~11.3k–11.9k CU for the CPI itself)
 * and the calibration this file's header does not repeat.
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { sha256 } from "../../../bytes.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

export const SANCTUM_STAKE_POOL_PROGRAM_ID = address("SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy");
export const SANCTUM_STAKE_POOL_2_PROGRAM_ID = address(
  "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY",
);
export const SANCTUM_STAKE_POOL_3_PROGRAM_ID = address(
  "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn",
);
export const SANCTUM_STAKE_POOL_4_PROGRAM_ID = address(
  "stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq",
);

const CLOCK_SYSVAR = address("SysvarC1ock11111111111111111111111111111111");
/** The recipe-wide vocabulary for "the user is trading SOL" — see module header's ACCOUNTS caveat. */
export const WSOL_MINT = address("So11111111111111111111111111111111111111112");

const ACCOUNT_TYPE_STAKE_POOL = 1;
const OFF_TOTAL_LAMPORTS = 258;
class Cursor {
  private o = 0;
  constructor(private readonly buf: Uint8Array) {}
  offset(): number {
    return this.o;
  }
  u8(): number {
    const v = this.buf[this.o];
    if (v === undefined) throw new Error("sanctum-stake-pool: truncated account data");
    this.o += 1;
    return v;
  }
  u64(): bigint {
    if (this.o + 8 > this.buf.length) throw new Error("sanctum-stake-pool: truncated account data");
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.buf[this.o + i]!);
    this.o += 8;
    return v;
  }
  pubkey(): Address {
    if (this.o + 32 > this.buf.length)
      throw new Error("sanctum-stake-pool: truncated account data");
    const slice = this.buf.subarray(this.o, this.o + 32);
    this.o += 32;
    return getAddressDecoder().decode(slice);
  }
  fee(): { numerator: bigint; denominator: bigint } {
    const denominator = this.u64();
    const numerator = this.u64();
    return { numerator, denominator };
  }
  /** `FutureEpoch<Fee>`: tag 0 = None, 1/2 = One/Two(Fee). */
  skipFutureEpochFee(): void {
    const tag = this.u8();
    if (tag === 0) return;
    if (tag === 1 || tag === 2) {
      this.fee();
      return;
    }
    throw new Error(`sanctum-stake-pool: unexpected FutureEpoch<Fee> tag ${tag}`);
  }
  /** `Option<Pubkey>`: tag 0 = None, 1 = Some. */
  optionPubkey(): Address | undefined {
    const tag = this.u8();
    if (tag === 0) return undefined;
    if (tag === 1) return this.pubkey();
    throw new Error(`sanctum-stake-pool: unexpected Option<Pubkey> tag ${tag}`);
  }
}

export interface SanctumStakePoolConfig extends PoolConfig {
  venue:
    "sanctum-stake-pool" | "sanctum-stake-pool-2" | "sanctum-stake-pool-3" | "sanctum-stake-pool-4";
  poolMint: Address;
  reserveStake: Address;
  managerFeeAccount: Address;
  /** `create_program_address([pool, "withdraw", [bump]], programId)` — computed once at fetch time. */
  withdrawAuthority: Address;
  solDepositFeeNumerator: bigint;
  solDepositFeeDenominator: bigint;
  /** Fixed at the framework's single `direction` value — this family only quotes SOL -> LST. */
  direction: "solToLst";
}

function withdrawAuthorityAddress(programId: Address, pool: Address, bump: number): Address {
  const decoder = getAddressDecoder();
  // create_program_address(seeds=[pool, "withdraw", [bump]], programId):
  // sha256(seed_1 || ... || programId || "ProgramDerivedAddress").
  return decoder.decode(
    sha256(
      getPubkeyBytes(pool),
      "withdraw",
      Uint8Array.of(bump),
      getPubkeyBytes(programId),
      "ProgramDerivedAddress",
    ),
  );
}

// @solana/kit's Address is a branded base58 string; decoding it back to raw
// bytes for the PDA hash needs the matching encoder — the only place in the
// adapter that needs raw pubkey bytes rather than an opaque Address.
function getPubkeyBytes(addr: Address): Uint8Array {
  return Uint8Array.from(getAddressEncoder().encode(addr));
}

async function fetchSanctumStakePoolConfig(
  load: AccountLoader,
  pool: Address,
  programId: Address,
  slug: SanctumStakePoolConfig["venue"],
): Promise<SanctumStakePoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${slug} pool ${pool} account not found`);

  const c = new Cursor(data);
  const accountType = c.u8();
  if (accountType !== ACCOUNT_TYPE_STAKE_POOL) {
    throw new Error(
      `${slug} pool ${pool} account_type must be ${ACCOUNT_TYPE_STAKE_POOL} (StakePool), got ${accountType}`,
    );
  }
  c.pubkey(); // manager
  c.pubkey(); // staker
  c.pubkey(); // stake_deposit_authority
  const stakeWithdrawBumpSeed = c.u8();
  c.pubkey(); // validator_list
  const reserveStake = c.pubkey();
  const poolMint = c.pubkey();
  const managerFeeAccount = c.pubkey();
  c.pubkey(); // token_program_id — no longer gated here; the mint T22 detection below supersedes it

  // DepositSol mints the LST to the user via the classic Tokenkeg program, so a
  // Token-2022 pool mint (or one carrying an un-routable extension) must
  // SELF-DROP. Detect the real token program from the mint's own account via the
  // shared data-shape resolver, replacing the old stored-token_program_id guard;
  // the thrown error IS the graceful drop (SvmRoute catches a fetchPoolConfig
  // throw and drops the venue). LEGACY path unchanged: a classic 82-byte mint
  // classifies Tokenkeg, parses no extensions, config built as before. An
  // unreadable mint falls back to the legacy assumption (keeps existing tests green).
  const poolMintData = await load(poolMint);
  if (poolMintData !== null) {
    if (classifyMintProgram(poolMint, poolMintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${slug}: dropping pool ${pool} — mint ${poolMint} is Token-2022 (this venue's swap is legacy-SPL only)`,
      );
    }
    const { blocking } = parseMintExtensions(poolMintData);
    if (blocking.length > 0) {
      throw new Error(
        `${slug}: dropping pool ${pool} — mint ${poolMint} is un-routable: ${blocking.join("; ")}`,
      );
    }
  }
  if (c.offset() !== OFF_TOTAL_LAMPORTS) {
    // total_lamports/pool_token_supply are meant to sit at fixed offsets —
    // this only fails if a future stake-pool version reorders the struct
    // prefix, in which case the on-chain fragment's baked accountUint
    // offsets below would silently read the wrong field. Fail loudly.
    throw new Error(
      `${slug} pool ${pool}: unexpected prefix length ${c.offset()}, expected total_lamports at ${OFF_TOTAL_LAMPORTS}`,
    );
  }
  c.u64(); // total_lamports (read LIVE on-chain via accountUint, not baked)
  c.u64(); // pool_token_supply (read LIVE on-chain via accountUint, not baked)
  c.u64(); // last_update_epoch (re-derived below via a fresh cursor read — see note)
  c.u64(); // lockup.unix_timestamp
  c.u64(); // lockup.epoch
  c.pubkey(); // lockup.custodian
  c.fee(); // epoch_fee
  c.skipFutureEpochFee(); // next_epoch_fee
  c.optionPubkey(); // preferred_deposit_validator_vote_address
  c.optionPubkey(); // preferred_withdraw_validator_vote_address
  c.fee(); // stake_deposit_fee
  c.fee(); // stake_withdrawal_fee
  c.skipFutureEpochFee(); // next_stake_withdrawal_fee
  c.u8(); // stake_referral_fee
  const solDepositAuthority = c.optionPubkey();
  const solDepositFee = c.fee();

  if (solDepositAuthority !== undefined) {
    throw new Error(
      `${slug} pool ${pool} requires a sol_deposit_authority signature — permissioned pools are not implemented by this adapter`,
    );
  }
  if (solDepositFee.numerator !== 0n && solDepositFee.denominator === 0n) {
    throw new Error(
      `${slug} pool ${pool} sol_deposit_fee denominator is 0 with nonzero numerator ${solDepositFee.numerator}`,
    );
  }

  // Re-read last_update_epoch directly (fixed offset 274, right after
  // pool_token_supply) rather than threading it out of the sequential
  // cursor above, and gate it against the LIVE cluster epoch: DepositSol
  // reverts (StakeListAndPoolOutOfDate, custom error 0x11) whenever the
  // pool's stored snapshot predates the current epoch — see module header.
  const lastUpdateEpoch = readU64(data, OFF_TOTAL_LAMPORTS + 16);
  const clockData = await load(CLOCK_SYSVAR);
  if (clockData === null) throw new Error("sanctum-stake-pool: Clock sysvar account not found");
  const currentEpoch = readU64(clockData, 16);
  if (lastUpdateEpoch < currentEpoch) {
    throw new Error(
      `${slug} pool ${pool} is stale (last_update_epoch ${lastUpdateEpoch} < current epoch ${currentEpoch}) — needs its crank run this epoch before it can accept a deposit`,
    );
  }

  return {
    venue: slug,
    pool,
    poolMint,
    reserveStake,
    managerFeeAccount,
    withdrawAuthority: withdrawAuthorityAddress(programId, pool, stakeWithdrawBumpSeed),
    solDepositFeeNumerator: solDepositFee.numerator,
    solDepositFeeDenominator: solDepositFee.denominator,
    direction: "solToLst",
  };
}

function readU64(buf: Uint8Array, offset: number): bigint {
  if (offset + 8 > buf.length) throw new Error("sanctum-stake-pool: truncated account data");
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(buf[offset + i]!);
  return v;
}

function makeSanctumStakePool(slug: SanctumStakePoolConfig["venue"], programId: Address) {
  return {
    slug,
    programId,
    fetchPoolConfig: (load: AccountLoader, pool: Address): Promise<SanctumStakePoolConfig> =>
      fetchSanctumStakePoolConfig(load, pool, programId, slug),
  };
}

export const sanctumStakePool = makeSanctumStakePool(
  "sanctum-stake-pool",
  SANCTUM_STAKE_POOL_PROGRAM_ID,
);
export const sanctumStakePool2 = makeSanctumStakePool(
  "sanctum-stake-pool-2",
  SANCTUM_STAKE_POOL_2_PROGRAM_ID,
);
export const sanctumStakePool3 = makeSanctumStakePool(
  "sanctum-stake-pool-3",
  SANCTUM_STAKE_POOL_3_PROGRAM_ID,
);
export const sanctumStakePool4 = makeSanctumStakePool(
  "sanctum-stake-pool-4",
  SANCTUM_STAKE_POOL_4_PROGRAM_ID,
);
