/**
 * Saber Decimal Wrapper venue adapter (SvmRoute ladder fragment, adapter
 * contract v2) — program `DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB`
 * (`saber-hq/saber-periphery`'s `add-decimals` program, source verified —
 * see below). This is NOT a priced AMM: it is an EXACT, FIXED-RATE 1:multiplier
 * conversion between an "underlying" SPL mint and a "wrapper" SPL mint that
 * exists purely to give the underlying more decimals (a Saber stableswap pool
 * needs both sides at the same decimal scale, so a token with fewer decimals
 * than its pair is wrapped through here first). Zero fee, zero slippage,
 * zero curve — the ENTIRE quote is one multiply (deposit) or one floor-divide
 * (withdraw). Because Saber pools are an already-served family
 * (`saber-stableswap`), this venue multiplies the REACH of that existing
 * coverage rather than adding a standalone market: any underlying token can
 * now route through its decimal wrapper into (or out of) a Saber pool that
 * only lists the wrapped mint.
 *
 * ── Source verified against `saber-hq/saber-periphery`'s
 * `programs/add-decimals/src/lib.rs` (`declare_id!` matches the program id
 * above) ──
 *
 *   pub struct WrappedToken {          // #[account], Anchor 8-byte disc first
 *       pub decimals: u8,              // @8  (offset AFTER the 8-byte disc)
 *       pub multiplier: u64,           // @9  == 10^(wrapper.decimals - underlying.decimals)
 *       pub wrapper_underlying_mint: Pubkey,    // @17
 *       pub wrapper_underlying_tokens: Pubkey,  // @49  (the vault SPL token account)
 *       pub wrapper_mint: Pubkey,               // @81
 *       __nonce: u8,                            // @113 (bump seed, unused here)
 *   }                                            // LEN = 8 + 106 = 114 bytes total
 *
 *   to_wrapped_amount(x)    = multiplier.checked_mul(x)   // deposit: underlying -> wrapped
 *   to_underlying_amount(x) = x.checked_div(multiplier)   // withdraw: wrapped -> underlying (floors; the
 *                                                          // un-recovered remainder, "dust", stays UN-BURNED
 *                                                          // in the caller's wrapped-token account)
 *
 * Ground-truthed against 22 REAL mainnet WrappedToken accounts (all 114
 * bytes, decimals 8-15, multiplier 10-1_000_000, every underlying/vault/
 * wrapper-mint field a live, real pubkey) via `getProgramAccounts`
 * (`dataSize: 114`), and against a REAL landed on-chain `deposit` call
 * (signature `3rvS6p6y...BDB6`, slot 436160738, pool
 * `AnKLLfpMcceM6YXtJ9nGxYekVXqfWy8WNsMZXoQTCVQk`): the inner instruction's
 * data decodes to discriminator `f223c68952e1f2b6` (== `sha256("global:deposit")[0..8]`,
 * computed independently) followed by `amountIn=21252713` LE u64 — exactly
 * the vault's measured pre/post balance delta — and its account list is
 * `[wrapper, wrapper_mint, wrapper_underlying_tokens, owner(signer),
 * user_underlying_tokens, user_wrapped_tokens, token_program, <one extra
 * account appended by the caller's own router, ignored — Anchor's Accounts
 * struct only consumes the 7 it declares>]`, matching `UserStake` below
 * field-for-field. `withdraw`'s discriminator (`sha256("global:withdraw")[0..8]`
 * = `b712469c946da122`) is the same computation, unexercised by that specific
 * transaction but identical in derivation and instruction shape (disc(8) ++
 * amount u64 LE(8), no suffix — `withdraw`'s single arg is `max_burn_amount`,
 * the wrapped amount to spend; the real burn floors to a multiple of
 * `multiplier`, same as `to_underlying_amount` below).
 *
 * ── UserStake (both `deposit` and `withdraw`) — 7 accounts, fixed order ──
 *   0 wrapper                  (readonly)         — the WrappedToken PDA ("pool")
 *   1 wrapper_mint              (mut)              — the wrapped SPL mint
 *   2 wrapper_underlying_tokens (mut)              — the vault (SPL token account)
 *   3 owner                     (signer)            — authority over the user's two token accounts
 *   4 user_underlying_tokens    (mut)
 *   5 user_wrapped_tokens       (mut)
 *   6 token_program             (readonly)
 * `deposit`: 4=inAta (underlying), 5=outAta (wrapped). `withdraw`: 4=outAta
 * (underlying), 5=inAta (wrapped) — the swap direction flips which user ATA
 * plays which role; the account POSITIONS never change.
 *
 * ── Capacity / self-drop (the vault is the ONLY real constraint) ──
 * `withdraw` cannot pay out more underlying than the vault
 * (`wrapper_underlying_tokens`) actually holds — the real program's SPL
 * transfer would fail past that. `deposit` cannot mint past `u64::MAX` total
 * wrapped supply — and because the program's own invariant keeps
 * `wrapped_supply == multiplier * vault_balance` at all times (every deposit/
 * withdraw pair moves both sides by the same multiplier-scaled amount), the
 * live vault balance alone reconstructs BOTH caps with no extra account
 * read. Both directions clamp their OWN output to this real ceiling — never
 * favourable, never negative — so a rung asking for more than the venue can
 * deliver quotes the flat ceiling instead of a wrong (too-generous) number;
 * the merge simply doesn't over-elect this slot's share past what the real
 * CPI would actually pay out.
 *
 * ── CU ── see `../../../../the consuming app SVM CU-budget module`'s (sauce-recipes)
 * `CU_FAMILIES['saber-decimals-wrapper']` for the measured coefficients —
 * this SDK package carries the adapter only, not the recipe's own CU model.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type {
  AccountBytesMap,
  AccountLoader,
  LadderSwapTemplate,
  PoolConfig,
  SvmVenueLadder,
  SwapUser,
  VenueAccount,
} from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'saber-decimals-wrapper';
export const SABER_DECIMALS_WRAPPER_PROGRAM_ID = address('DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** WrappedToken account layout (8-byte Anchor disc, then the fields below). */
const WRAPPED_TOKEN_SIZE = 114;
export const OFF_DECIMALS = 8;
export const OFF_MULTIPLIER = 9;
export const OFF_UNDERLYING_MINT = 17;
export const OFF_UNDERLYING_TOKENS = 49;
export const OFF_WRAPPER_MINT = 81;
/** Standard SPL token account amount field offset. */
const VAULT_AMOUNT_OFFSET = 64;

/** sha256("global:deposit")[0..8] — verified against a real landed deposit tx (see the module doc). */
const DEPOSIT_DISCRIMINATOR = [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6];
/** sha256("global:withdraw")[0..8] — same Anchor sighash derivation, same instruction shape. */
const WITHDRAW_DISCRIMINATOR = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

/** u64::MAX — the wrapped mint's total-supply ceiling (deposit-direction headroom). */
const U64_MAX = (1n << 64n) - 1n;

const addressCodec = getAddressCodec();

export type SaberDecimalsWrapperDirection = 'deposit' | 'withdraw';

export interface SaberDecimalsWrapperPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  decimals: number;
  multiplier: bigint;
  underlyingMint: Address;
  vault: Address;
  wrapperMint: Address;
  direction: SaberDecimalsWrapperDirection;
}

function wrapperConfig(cfg: PoolConfig): SaberDecimalsWrapperPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as SaberDecimalsWrapperPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

async function fetchPoolConfig(load: AccountLoader, pool: Address): Promise<SaberDecimalsWrapperPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} wrapper ${pool} account not found`);
  if (data.length !== WRAPPED_TOKEN_SIZE) {
    throw new Error(`${SLUG} wrapper ${pool} account data is ${data.length} bytes, expected ${WRAPPED_TOKEN_SIZE}`);
  }
  const decimals = data[OFF_DECIMALS]!;
  const multiplier = readUintLE(data, OFF_MULTIPLIER, 8);
  if (multiplier === 0n) {
    throw new Error(`${SLUG} wrapper ${pool} has a zero multiplier (not a real initialized WrappedToken)`);
  }
  const underlyingMint = pubkeyAt(data, OFF_UNDERLYING_MINT);
  const vault = pubkeyAt(data, OFF_UNDERLYING_TOKENS);
  const wrapperMint = pubkeyAt(data, OFF_WRAPPER_MINT);
  if (underlyingMint === wrapperMint) {
    throw new Error(`${SLUG} wrapper ${pool} has identical underlying/wrapper mints — corrupt account`);
  }
  // The deposit/withdraw CPI is legacy-SPL (Tokenkeg) only for now, so
  // SELF-DROP a wrapper whose underlying or wrapper mint is Token-2022 (or
  // carries an un-routable extension) — the thrown error is the graceful-drop
  // signal (SvmRoute drops the venue on a fetchPoolConfig throw). An unreadable
  // mint falls back to the legacy assumption, keeping the legacy path unchanged.
  for (const mint of [underlyingMint, wrapperMint]) {
    const mintData = await load(mint);
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping wrapper ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping wrapper ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }
  return {
    venue: SLUG,
    pool,
    decimals,
    multiplier,
    underlyingMint,
    vault,
    wrapperMint,
    direction: 'deposit',
  };
}

function pubkeyAt(data: Uint8Array, offset: number): Address {
  return addressCodec.decode(data.subarray(offset, offset + 32));
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = wrapperConfig(base);
  return [{ ref: 'vault', address: cfg.vault }];
}

export const saberDecimalsWrapper = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: SABER_DECIMALS_WRAPPER_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};

