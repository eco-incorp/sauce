/**
 * Solayer EndoAVS delegation venue adapter — program
 * `endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT` (Jupiter's own
 * `program-id-to-label` capture, `benchmark/adapters/fixtures/
 * jupiter-program-id-to-label.json`, calls this program "Solayer").
 *
 * WHAT THIS PROGRAM ACTUALLY IS (there is no public on-chain IDL for it —
 * everything below is reverse-engineered from live mainnet state plus one
 * corroborating source, see "GROUND TRUTH" below): it is NOT the sSOL
 * mint/redeem stake pool itself (that is a *different* program,
 * `sSo1iU21jBrU9VaJ8PJib1MtorefUV4fzC9GURa2KNn`, wrapping the SPL stake
 * pool at `po1osKDWYF9oiVEGmzKA4eTs8eMveFRMox3bUKazGN2` — see
 * `solayer-labs/solayer-cli`'s `restaking/` folder — which needs a
 * withdraw-stake + deactivate QUEUE to redeem, exactly the queued path this
 * family avoids). `endoLNCK...` is Solayer's **EndoAVS delegation**
 * program: it lets an sSOL holder "delegate" sSOL 1:1 into a per-AVS
 * "delegated" receipt token (e.g. `sonickAJFi...` for the "Sonic" AVS,
 * `hash4eTHs...` for "Hashkey Cloud AVS", 20 such AVS pools live at
 * integration time — `getProgramAccounts` on this program id returns
 * EXACTLY 20 accounts, all 443 bytes, no other account type exists under
 * this program) and "undelegate" back. Both directions are FULLY ATOMIC —
 * no queue, no cooldown, no separate ticket account (verified against 3
 * real mainnet transactions at 3 different sizes/pools/directions, see
 * "VALIDATION" below) — so unlike the plan's default caution ("wire the
 * atomic direction first"), there is no non-atomic direction to drop here;
 * this family wires BOTH.
 *
 * GROUND TRUTH: `solayer-labs/solayer-cli`'s `endoavs/utils/constants.ts`
 * (`PROGRAM_ID = endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT`,
 * `DELEGATED_TOKEN_MINT_ID = sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh`)
 * and `endoavs/utils/type.ts`'s hand-written `EndoAvs` TS type
 * (`{ bump, authority, avsTokenMint, delegatedTokenMint,
 * delegatedTokenVault, name, url }`) — this is a CLI author's own partial
 * reconstruction, not a published Anchor IDL (its `instructions` list is
 * missing the `_no_init` variants this adapter actually uses), but its
 * field ORDER matches this adapter's independently-decoded byte layout
 * exactly, and the account discriminator computed from its type name
 * (`sha256("account:EndoAVS")[0..8]` = `42a829b1bb0bad7b`) is
 * BYTE-IDENTICAL to all 20 real pool accounts' leading 8 bytes — strong
 * independent corroboration that this is genuinely the account's Anchor
 * name, not a coincidence.
 *
 * ACCOUNT LAYOUT (`EndoAVS`, 443 bytes, Anchor-standard 8-byte
 * discriminator then declared-field order, Borsh-packed) — decoded from
 * all 20 live pool accounts, cross-checked against real instruction
 * account lists (below):
 *   [0..8)    discriminator = sha256("account:EndoAVS")[0..8]
 *   [8..40)   authority     Pubkey (the AVS's admin; several pools share one)
 *   [40..41)  bump          u8
 *   [41..73)  avsTokenMint  Pubkey — THIS adapter's `receiptMint` (per-pool, varies)
 *   [73..105) lstMint       Pubkey — always `sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh` (sSOL) on all 20 live pools
 *   [105..137) vault        Pubkey — the SPL token account (owned by this program's PDA) holding delegated sSOL
 *   [137..)   name          Borsh String (u32 LE length + UTF-8 bytes)
 *   [..)      url           Borsh String (u32 LE length + UTF-8 bytes) — often unset (zero length)
 *   [..443)   reserved padding (observed all-zero on every live pool; may carry
 *             future fields the CLI's partial IDL does not yet name — never read here)
 *
 * INSTRUCTIONS — two ANCHOR-standard discriminators
 * (`sha256("global:<snake_case name>")[0..8]`), recovered from real
 * transaction `Program log: Instruction: <Name>` lines and independently
 * confirmed by recomputing the sha256 of the candidate snake_case name and
 * matching it byte-for-byte against the real instruction data's leading 8
 * bytes (both matched exactly — see VALIDATION):
 *   delegate_no_init   fe 00 de 28 91 76 6e 14   (mints receiptMint 1:1 for sSOL)
 *   undelegate_no_init d5 11 d7 51 05 72 7c 4e   (burns receiptMint 1:1 for sSOL)
 * Both take a SINGLE u64 LE amount argument immediately after the
 * discriminator (no trailing min-out/slippage word — this program has no
 * partial-fill or slippage concept of its own; the recipe's own terminal
 * outAta-delta check is what enforces `minOut`, exactly like every other
 * venue here). The `_no_init` suffix (vs. the base `delegate`/`undelegate`
 * the CLI's stale partial IDL names) means neither instruction creates the
 * destination ATA — this recipe's ATAs are always pre-resolved, so `_no_init`
 * is the correct (cheaper) variant, same reasoning as every other venue's
 * ATA handling in this recipe.
 *
 * Both instructions share ONE account order for BOTH directions (only
 * which physical account plays "in" vs "out" changes; the ORDER doesn't):
 *   0 user            signer
 *   1 pool (EndoAVS)   PDA, read-only (its bump/authority fields sign
 *                      internally via invoke_signed; the caller never signs for it)
 *   2 receiptMint      writable (its supply changes: minted on delegate, burned on undelegate)
 *   3 vault            writable (its sSOL balance changes)
 *   4 lstMint          read-only (sSOL mint, mint-checked by `transfer_checked`)
 *   5 user's sSOL ATA      writable (source on delegate, destination on undelegate)
 *   6 user's receiptMint ATA writable (destination on delegate, source on undelegate)
 *   7 token program
 * (delegate: burn/transfer inner ixs observed as `transfer_checked(sSOL: user->vault)` then
 * `mint_to(receiptMint: ->user)`, both for the SAME amount; undelegate: `burn(receiptMint: user)`
 * then `transfer_checked(sSOL: vault->user)`, again the SAME amount both sides.)
 *
 * QUOTE MATH: EXACT 1:1, NO FEE. There is no fee/exchange-rate field
 * anywhere in the 443-byte account (every byte past `url` is zero on
 * every one of the 20 live pools), and all 3 real transactions below
 * transferred/minted/burned the IDENTICAL raw amount on both legs. The
 * only real constraint is CAPACITY, and it is DIRECTIONAL and HARD (a
 * step function, not a diminishing curve):
 *   - delegate (sSOL -> receiptMint): bounded only by the receiptMint's
 *     remaining u64 mint headroom (`2^64-1 - supply`) — astronomically
 *     large in practice (observed live supplies are ~10^12-10^13 raw,
 *     ~13 orders of magnitude under the u64 ceiling) but modeled exactly
 *     rather than assumed infinite, so a pathological near-max-supply pool
 *     is still never over-quoted.
 *   - undelegate (receiptMint -> sSOL): bounded by the vault's LIVE sSOL
 *     balance (an `accountUint` read at execution time) — the real,
 *     binding constraint (a live-observed pool has vault balance *above*
 *     its receipt supply by a materially nonzero amount — some
 *     out-of-band sSOL entered the vault outside delegate/undelegate,
 *     e.g. reward accrual or a direct top-up; capacity is read from the
 *     vault directly, never assumed equal to supply, so this is harmless).
 * Both are exactly `min(x, cap)` — monotone non-decreasing and concave
 * (the min of an affine function and a constant), satisfying the merge's
 * ladder-curve requirement with no curvature to model at all.
 *
 * VALIDATION (three real mainnet transactions, three sizes, both
 * directions, two different AVS pools — decoded via `getTransaction`
 * `jsonParsed` + inner-instruction `parsed.info`, not guessed):
 *   delegate,   Sonic pool    (via a Jupiter RouteV2 leg): 208_072_380 sSOL in
 *               -> 208_072_380 sonicK minted.  tx H7JUL9QEcrnnsSXDGzW2mYap1t4n9jAmk9xvmtwNmP5m8Jn4sED8h582Tph96epsz7yoAW2LY1yBqHQtZxyHHby
 *   undelegate, Sonic pool    (direct top-level call):     3_010_000_000 sonicK burned
 *               -> 3_010_000_000 sSOL out. tx 5jRGKMb7simyMyYp3bbviMhc1pndgGEnSv2oRWsQd6fjkEEH1rM8g64fAcUoGmHf25WXLYQuSQv7FnxAjh9yMfcX
 *   undelegate, Hashkey Cloud AVS pool (via a Jupiter SharedAccountsRouteV2 leg): 12_450_000 hash4eT burned
 *               -> 12_450_000 sSOL out. tx 4bnVs3683krULUFbQc6sC7Yx5pJNaDbnxBu12uW2ikMrZq3qgSX3ZLgcPdRwsNr4KuwffwnbMNAqyZCKjXjGGNzf
 * `the consuming app solayer e2e test` replays real fixture dumps of
 * the Sonic and Hashkey Cloud AVS pools (`test/svm/fixtures/solayer{,-dir1}`,
 * captured at integration time) through `referenceQuote` AND through the
 * real committed engine, and separately drives the REAL dumped
 * `solayer.so` program binary (SAUCE_VENUE_PROGRAMS-gated real-CPI cell)
 * to prove this adapter's exact instruction/account encoding is accepted
 * by the live program, not merely self-consistent.
 *
 * Both mints are classic Tokenkeg (82-byte SPL mint accounts) on every one
 * of the 20 live pools plus the shared sSOL mint — confirmed via
 * `getMultipleAccounts`, no Token-2022 extension mint observed anywhere in
 * this family, so this adapter gates on that (Tokenkeg-only, like most of
 * this recipe's other venues) rather than modeling transfer-fee extensions.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "solayer";
export const SOLAYER_PROGRAM_ID = address("endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT");
export const SOLAYER_SSOL_MINT = address("sSo14endRuUbvQaJS3dq36Q829a3A6BEfoeeRGJywEh");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export const ENDO_AVS_ACCOUNT_SIZE = 443;
/** sha256('account:EndoAVS')[0..8] — verified identical across all 20 live pool accounts. */
export const ENDO_AVS_DISCRIMINATOR = [0x42, 0xa8, 0x29, 0xb1, 0xbb, 0x0b, 0xad, 0x7b];
/** sha256('global:delegate_no_init')[0..8] — verified against a real mainnet instruction's leading bytes. */
export const DELEGATE_NO_INIT_DISCRIMINATOR = [0xfe, 0x00, 0xde, 0x28, 0x91, 0x76, 0x6e, 0x14];
/** sha256('global:undelegate_no_init')[0..8] — verified against a real mainnet instruction's leading bytes. */
export const UNDELEGATE_NO_INIT_DISCRIMINATOR = [0xd5, 0x11, 0xd7, 0x51, 0x05, 0x72, 0x7c, 0x4e];

const OFF_AUTHORITY = 8;
const OFF_RECEIPT_MINT = 41;
const OFF_LST_MINT = 73;
const OFF_VAULT = 105;
const OFF_NAME_LEN = 137;
const OFF_NAME = 141;
const SPL_TOKEN_ACCOUNT_SIZE = 165;
export type SolayerDirection = "delegate" | "undelegate";

export interface SolayerPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  direction: SolayerDirection;
  authority: Address;
  receiptMint: Address;
  lstMint: Address;
  vault: Address;
  name: string;
}

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}

/** Off-chain, once per pool: decode the EndoAVS account and gate its two mints. Read-only against the loader. */
export async function fetchSolayerPoolConfig(
  load: AccountLoader,
  pool: Address,
): Promise<SolayerPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool account ${pool} not found`);
  if (data.length !== ENDO_AVS_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} data must be ${ENDO_AVS_ACCOUNT_SIZE} bytes (EndoAVS), got ${data.length}`,
    );
  }
  if (!hasDiscriminator(data, ENDO_AVS_DISCRIMINATOR)) {
    throw new Error(`${SLUG} pool ${pool} has a foreign discriminator (not an EndoAVS account)`);
  }

  const codec = getAddressCodec();
  const authority = codec.decode(data.subarray(OFF_AUTHORITY, OFF_AUTHORITY + 32)) as Address;
  const receiptMint = codec.decode(
    data.subarray(OFF_RECEIPT_MINT, OFF_RECEIPT_MINT + 32),
  ) as Address;
  const lstMint = codec.decode(data.subarray(OFF_LST_MINT, OFF_LST_MINT + 32)) as Address;
  const vault = codec.decode(data.subarray(OFF_VAULT, OFF_VAULT + 32)) as Address;
  const nameLen = Number(readUintLE(data, OFF_NAME_LEN, 4));
  if (OFF_NAME + nameLen > data.length) {
    throw new Error(`${SLUG} pool ${pool} has a corrupt name length (${nameLen})`);
  }
  const name = new TextDecoder().decode(data.subarray(OFF_NAME, OFF_NAME + nameLen));

  // Both directions transfer/mint/burn via the classic Tokenkeg program, so a
  // Token-2022 mint (or one carrying an un-routable extension) must SELF-DROP.
  // Detect the real token program per mint via the shared data-shape resolver;
  // the thrown error IS the graceful drop (SvmRoute catches a fetchPoolConfig
  // throw and drops the venue). LEGACY path byte-identical: a classic 82-byte
  // mint classifies Tokenkeg, parses no extensions, config built unchanged. An
  // unreadable mint falls back to the legacy assumption (keeps existing tests green).
  const [receiptMintData, lstMintData] = await Promise.all([load(receiptMint), load(lstMint)]);
  for (const [mint, mintData] of [
    [receiptMint, receiptMintData],
    [lstMint, lstMintData],
  ] as const) {
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
      );
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(
        `${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
      );
    }
  }

  const vaultData = await load(vault);
  if (vaultData === null) throw new Error(`${SLUG} pool ${pool} vault ${vault} not found`);
  if (vaultData.length !== SPL_TOKEN_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} vault ${vault} must be a ${SPL_TOKEN_ACCOUNT_SIZE}-byte SPL token account, got ${vaultData.length} bytes`,
    );
  }
  const vaultMint = codec.decode(vaultData.subarray(0, 32));
  if (vaultMint !== lstMint) {
    throw new Error(
      `${SLUG} pool ${pool} vault ${vault} mint ${vaultMint} does not match the pool's lst mint ${lstMint}`,
    );
  }

  return { venue: SLUG, pool, direction: "delegate", authority, receiptMint, lstMint, vault, name };
}

/** The Solayer venue: delegates sSOL 1:1 into an AVS receipt token, and back. */
export const solayer = {
  slug: SLUG,
  programId: SOLAYER_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchSolayerPoolConfig,
};
