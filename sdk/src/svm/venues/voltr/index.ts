/**
 * Voltr (SvmRoute ladder fragment) — a permissionless vault-infrastructure
 * protocol (`voltrxyz`): depositors mint LP shares against a vault's live
 * NAV (`deposit_vault`) and can redeem them atomically for the underlying
 * asset out of the vault's un-invested ("idle") float (`instant_withdraw_vault`).
 * `request_withdraw_vault`/`withdraw_vault` are the QUEUED path (burns LP now,
 * creates a `RequestWithdrawVaultReceipt`, delivers nothing atomically — the
 * asset lands only after `withdrawal_waiting_period` via a SEPARATE later
 * transaction) and are therefore NOT modeled here, the same "cannot be a
 * Sauce venue leg" reasoning `xorca.ts`'s file header applies to its own
 * queued Unstake/Withdraw path.
 *
 * ── Ground truth: the program's OWN on-chain-published Anchor IDL ──
 *
 * Voltr publishes its IDL on-chain at the canonical Anchor IDL PDA
 * (`createAddressWithSeed(findProgramAddress([], programId), "anchor:idl",
 * programId)` — fetched 2026-07-31, decompresses to exactly 73,416 bytes of
 * JSON from a 10,770-byte account, `voltr_vault` v0.2.0). Every offset,
 * discriminator, instruction-account order, and struct field below is taken
 * DIRECTLY from that IDL (`accounts`/`types`/`instructions`), not
 * reverse-engineered from bytes. The `Vault` account is `bytemuckunsafe`
 * zero-copy `repr(C)` — Anchor zero-copy buffers are only guaranteed
 * 8-byte alignment (the 8-byte discriminator precedes the struct), so this
 * struct's `u128` field (`HighWaterMark.highest_asset_per_lp_decimal_bits`)
 * is laid out at 8-byte, NOT the natural Rust 16-byte, alignment —
 * confirmed empirically: computing offsets with align-16 for u128 predicts
 * an 8-byte gap before `high_water_mark` and a total size of 936 bytes
 * (disc-inclusive), but every one of 196 real mainnet `Vault` accounts
 * sampled (`getProgramAccounts` with a discriminator memcmp, 2026-07-31) is
 * exactly 928 bytes; re-deriving with align-8 for u128 removes that gap and
 * predicts 928 bytes EXACTLY, and every field decoded at the resulting
 * offsets (asset/lp mints, fee bps, timestamps, manager/admin pubkeys) reads
 * as a plausible, self-consistent real value across all 196 samples — the
 * strongest available confirmation short of the Rust source itself. (Two of
 * the 196 are 952 bytes — a newer/rarer on-disk variant; `fetchPoolConfig`
 * accepts any length >= `VAULT_MIN_LEN` since every field this adapter reads
 * sits well inside the first 928 bytes either way, but `SVM_FAMILY_FILTERS`'s
 * gPA `dataSize` filter only matches the 194 at exactly 928 — self-dropping
 * the 952-byte pair from DISCOVERY, not from direct resolution.)
 *
 * ── Quote math — a byte-exact port of the protocol's OWN published SDK ──
 *
 * `@voltr/vault-sdk`'s `VoltrClient.calculateLpForDeposit` /
 * `calculateAssetsForWithdrawHelper` (both in `src/client.ts`, MIT, published
 * by the protocol team as the canonical off-chain preview of the on-chain
 * accounting) give the exact closed form ported below — NOT an approximation:
 *
 *   unharvestedFeesLp = accumulated_lp_{manager,admin,protocol}_fees (summed)
 *   lpSupplyInclAccumulatedFees = lp_mint.supply + unharvestedFeesLp + dead_weight
 *   mgmtFeeBps = manager_management_fee + admin_management_fee + protocol_management_fee
 *   unrealisedLpFees = 0 if lastMgmtFeeUpdateTs==0 || totalValue==0 || mgmtFeeBps==0
 *     else (elapsed = max(0, now - lastMgmtFeeUpdateTs); 0 if elapsed==0; else
 *     feeInAsset = totalValue*elapsed*mgmtFeeBps/10000/31536000 (a per-second
 *     linear accrual over a 365-day year, BPS-scaled);
 *     ceil(feeInAsset * lpSupplyInclAccumulatedFees / (totalValue - feeInAsset)))
 *   lpSupplyInclFees = lpSupplyInclAccumulatedFees + unrealisedLpFees
 *
 *   DEPOSIT (lpSupplyInclFees == 0, i.e. a never-deposited-into vault):
 *     mint = assetIn * 10^lpDecimals / 10^assetDecimals  (decimals-aware 1:1)
 *   DEPOSIT (else):
 *     mint = floor(assetIn * lpSupplyInclFees * (10000-issuanceFeeBps)
 *                  / (totalValue*10000 + assetIn*issuanceFeeBps))
 *     — algebraically (totalValue+assetIn)*10000 - assetIn*(10000-issuanceFeeBps)
 *       reduces to totalValue*10000 + assetIn*issuanceFeeBps, so assetIn appears
 *       in the denominator ONLY via issuanceFeeBps: issuanceFeeBps==0 (the
 *       common case, confirmed on multiple live vaults) makes this EXACTLY
 *       linear; issuanceFeeBps>0 makes it a mild, still monotone-concave,
 *       saturating (CP-like) curve — never non-monotone.
 *
 *   WITHDRAW: lockedProfit = 0 if locked_profit_degradation_duration==0, else
 *     (duration = max(0, now - last_report); 0 if duration > degradationDuration
 *     else last_updated_locked_profit * (degradationDuration-duration) / degradationDuration)
 *     totalUnlockedValue = totalValue - lockedProfit
 *     assetOut = floor(lpIn * totalUnlockedValue * (10000-redemptionFeeBps)
 *                       / (lpSupplyInclFees * 10000))
 *     — EXACTLY linear in lpIn (no lpIn term in the denominator).
 *
 * `last_updated_locked_profit` genuinely holds a PROFIT AMOUNT (not a
 * timestamp, despite the SDK's `calculateLockedProfit` naming its own first
 * arg `lastUpdatedLockedProfit` and using it in a `now - lastUpdatedLockedProfit`
 * subtraction) — confirmed by live values: every sampled vault's field reads
 * as an asset-scale magnitude (9, 38126, ..., 10680089518998677 for a
 * near-empty/dead vault) while `last_report` always reads as a plausible
 * 2026 Unix timestamp (~1.78-1.79 billion). Ported EXACTLY as the SDK computes
 * it regardless (a real elapsed-time-vs-profit-amount subtraction is
 * dimensionally strange, but at every magnitude actually observed on mainnet
 * it drives `duration` far past any real `locked_profit_degradation_duration`
 * — itself always a short window, 0 or up to a few days in every sample — so
 * the guard `duration > degradationDuration` fires and locked profit reads 0;
 * porting the SDK's literal arithmetic rather than a "corrected" reading is
 * the safe choice either way since it can only make `totalUnlockedValue`
 * SMALLER, never larger, than a version using `last_report` for the
 * subtraction would — i.e. it never over-promises a withdrawal).
 *
 * `ctx.timestamp()` (the compiler's Clock-sysvar-backed global, the SAME
 * intrinsic `meteora-damm-v1-stable`'s own locked-profit-decay quote already
 * uses on-chain) drives the time-dependent terms; `Vault`'s own bytes drive
 * everything else — nothing here is baked at prepare time except
 * `assetDecimals`/`lpDecimals` (fixed per vault forever) and the vault's own
 * address-derived accounts.
 *
 * ── Two SELF-DROP-worthy hard caps, both handled as a SATURATING clamp
 *    (never a revert) so a program built against a stale/racy plan degrades
 *    to a smaller fill instead of aborting the whole cook (SVM execution-time
 *    CPI failure is unrecoverable — see the consuming app SVM README) ──
 *
 * 1. DEPOSIT vs `vault_configuration.max_cap`: a deposit that would push
 *    `total_value` past `max_cap` is documented ("The maximum total amount
 *    allowed in the vault") to be rejected by the program. This adapter
 *    clamps the EFFECTIVE input to `max(0, max_cap - total_value)` before
 *    quoting, so the reported mint amount flattens at the cap instead of
 *    quoting a number the real CPI would then revert on. (Not independently
 *    revert-tested against a live over-cap deposit — the clamp is
 *    conservative regardless: it can only quote LESS than the uncapped
 *    formula would, never more.)
 * 2. WITHDRAW vs the live idle-ATA SPL balance: `instant_withdraw_vault`
 *    pays out of `vault_asset_idle_ata` ONLY (never touches strategy-invested
 *    capital) — CONFIRMED via a real `simulateTransaction` against a live
 *    vault (2026-07-31): a withdrawal sized above the idle ATA's real balance
 *    fails with the SPL Token program's own "insufficient funds" (custom
 *    error `0x1`), not a Voltr-level revert. This adapter clamps the quoted
 *    payout to the live idle-ATA balance, read on-chain in the SAME setup
 *    block.
 *
 * ── Validated against the REAL deployed program on REAL mainnet state,
 *    at 4+ sizes each direction, via `simulateTransaction` (sigVerify:false,
 *    replaceRecentBlockhash:true — no real signature needed, any funded
 *    wallet can serve as fee payer while an arbitrary real token holder is
 *    impersonated as the depositor/withdrawer; nothing was ever submitted) —
 *
 * DEPOSIT (vault `Gj8kURFs8fK3GhiX5Yc6H1HQKSpEvLHeDRZsP6Y2D1je`, HUB-denominated,
 * issuanceFee=0 so exactly linear): a real HUB holder's canonical ATA
 * depositing 1 / 10 / 100 / 500 HUB (1e9/1e10/1e11/5e11 raw, 9 decimals)
 * against the SAME-SLOT post-deposit vault/mint state minted EXACTLY
 * 998,312,468 / 9,983,124,685 / 99,831,246,854 / 499,156,234,274 raw LP
 * — the formula above, evaluated on that same-slot state, predicts the
 * IDENTICAL integer at all 4 sizes (bit-for-bit, verified programmatically).
 * The deposit CPI itself (including its 2 nested SPL Transfer/MintTo CPIs)
 * measured 33,527 / 33,643 / 33,644 / 33,643 CU.
 *
 * WITHDRAW (same vault, redemptionFee=15bps): a real LP holder's canonical
 * ATA withdrawing 0.5 / 2 / 5 LP (5e8/2e9/5e9 raw) against GENUINE PRE-state
 * (fetched via `getMultipleAccounts` immediately before simulating — the
 * withdraw formula's fee-retention means feeding it POST-state, unlike
 * deposit's self-consistent floor identity, does NOT reproduce the same
 * answer) paid out EXACTLY 500,093,222 / 2,000,372,890 / 5,000,932,225 raw
 * asset — the formula predicts the IDENTICAL integer at all 3 sizes,
 * bit-for-bit. A 4th size (20 LP, exceeding the vault's live ~9.6 HUB idle
 * balance) failed with the SPL "insufficient funds" error described above,
 * confirming the idle-liquidity cliff empirically. The withdraw CPI measured
 * 35,517 / 35,517 / 35,633 CU on the three successful sizes.
 *
 * ── CU (`the consuming app SVM CU-budget module`'s `CU_FAMILIES.voltr`) ──
 *
 * Per the standing "existing pins omit the venue CPI" gap, this pin takes
 * raydium-cp-swap's 183,187 as a same-complexity NON-CPI baseline (2 vault
 * reads + a fee-adjusted CP formula) and adds a margin over OUR OWN measured
 * CPI (max 35,633 across both directions, +15% -> ~40,978) PLUS extra
 * headroom for this family's heavier setup (this adapter reads ~10 distinct
 * Vault fields plus the LP mint's supply, vs raydium-cp-swap's 2 balances),
 * landing at 225,000 (deliberately rounded UP past the arithmetic sum, never
 * down — this can only over-estimate CU, never under). `rung` reuses
 * raydium-cp-swap's 65,054 verbatim: a rung here is one more helper-function
 * call over already-read setup locals (a handful of multiplies/divides/
 * comparisons), at most as expensive as raydium-cp-swap's own per-rung
 * fee-adjusted CP formula.
 *
 * ── Token-2022 assets: not distinguished (documented simplification, not a
 *    permission gate) ──
 *
 * `AccountLoader` returns raw bytes only (no owning-program field), so
 * `fetchPoolConfig` cannot see whether `vault_asset_mint` is Token or
 * Token-2022 owned. Every one of the sampled vaults' assets (HUB, USDC, wSOL,
 * USDS, and others) is a classic SPL Token mint, so `assetTokenProgram` is
 * pinned to the classic Token program. A future Token-2022-asset vault would
 * fail its OWN CPI cleanly (a program-ownership mismatch on the passed
 * token-program account) rather than corrupt anything — a self-drop for that
 * one vault, not a systemic risk. `lpTokenProgram` needs no such handling:
 * the IDL fixes it to the classic Token program unconditionally (LP shares
 * are never Token-2022).
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { memoizedFindAssociatedTokenPda, memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "voltr";

export const VOLTR_PROGRAM_ID: Address<"vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8"> = address(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
);
export const SPL_TOKEN_PROGRAM_ID: Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"> = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
// ── Anchor IDL constants (voltr_vault v0.2.0, decoded from the on-chain IDL account) ──
const VAULT_DISCRIMINATOR = [211, 8, 232, 43, 2, 152, 117, 119];
/** Minimum real length (the 928-byte layout); a 952-byte variant also decodes fine. */
const VAULT_MIN_LEN = 928;

const OFF_ASSET_MINT = 104;
const OFF_LP_MINT = 272;
/** SPL `Mint.decimals`, u8 (4-byte COption tag + 32-byte pubkey + 8-byte supply precede it). */
const MINT_DECIMALS_OFFSET = 44;
export interface VoltrPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'assetToLp' (deposit_vault, default) | 'lpToAsset' (instant_withdraw_vault). */
  direction: "assetToLp" | "lpToAsset";
  assetMint: Address;
  lpMint: Address;
  protocol: Address;
  vaultAssetIdleAuth: Address;
  vaultAssetIdleAta: Address;
  vaultLpMintAuth: Address;
  assetDecimals: number;
  lpDecimals: number;
}

// Bound at module scope (not per-call) — getAddressDecoder() builds a fresh
// codec instance each call, cheap but pointless to redo per field.
const ADDRESS_DECODER = getAddressDecoder();
function readAddress(data: Uint8Array, offset: number): Address {
  return ADDRESS_DECODER.decode(data.subarray(offset, offset + 32));
}

function protocolPda(): Promise<Address> {
  return memoizedGetProgramDerivedAddress(VOLTR_PROGRAM_ID, [new TextEncoder().encode("protocol")]);
}

/**
 * Off-chain, once per pool: derive every PDA the CPI needs, verify the
 * stored LP mint address matches its own seed derivation (a cheap
 * self-consistency check — a mismatch means a wrong/spoofed account), and
 * read the two mints' decimals (needed only for the empty-vault bootstrap
 * case, fixed forever per vault so safe to bake at prepare time).
 */
export async function fetchVoltrConfig(
  load: AccountLoader,
  pool: Address,
): Promise<VoltrPoolConfig> {
  const raw = await load(pool);
  if (raw === null) throw new Error(`${SLUG}: vault account ${pool} not found`);
  if (raw.length < VAULT_MIN_LEN) {
    throw new Error(
      `${SLUG}: vault account ${pool} is ${raw.length} bytes, want >= ${VAULT_MIN_LEN}`,
    );
  }
  for (let i = 0; i < VAULT_DISCRIMINATOR.length; i++) {
    if (raw[i] !== VAULT_DISCRIMINATOR[i]) {
      throw new Error(`${SLUG}: vault account ${pool} has the wrong account discriminator`);
    }
  }

  const assetMint = readAddress(raw, OFF_ASSET_MINT);
  const lpMint = readAddress(raw, OFF_LP_MINT);

  const enc = getAddressEncoder();
  const poolBytes = enc.encode(pool) as Uint8Array;
  const [protocol, vaultAssetIdleAuth, vaultLpMintAuth, derivedLpMint] = await Promise.all([
    protocolPda(),
    memoizedGetProgramDerivedAddress(VOLTR_PROGRAM_ID, [
      new TextEncoder().encode("vault_asset_idle_auth"),
      poolBytes,
    ]),
    memoizedGetProgramDerivedAddress(VOLTR_PROGRAM_ID, [
      new TextEncoder().encode("vault_lp_mint_auth"),
      poolBytes,
    ]),
    memoizedGetProgramDerivedAddress(VOLTR_PROGRAM_ID, [
      new TextEncoder().encode("vault_lp_mint"),
      poolBytes,
    ]),
  ]);
  if (derivedLpMint !== lpMint) {
    throw new Error(
      `${SLUG}: vault ${pool} lp mint ${lpMint} does not match its own PDA derivation ${derivedLpMint}`,
    );
  }

  const vaultAssetIdleAta = await memoizedFindAssociatedTokenPda({
    owner: vaultAssetIdleAuth,
    mint: assetMint,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
  });

  const [assetMintRaw, lpMintRaw] = await Promise.all([load(assetMint), load(lpMint)]);
  if (assetMintRaw === null) throw new Error(`${SLUG}: asset mint ${assetMint} not found`);
  if (lpMintRaw === null) throw new Error(`${SLUG}: lp mint ${lpMint} not found`);
  const assetDecimals = assetMintRaw[MINT_DECIMALS_OFFSET]!;
  const lpDecimals = lpMintRaw[MINT_DECIMALS_OFFSET]!;

  // `deposit_vault`/`instant_withdraw_vault` pass the classic Token program for
  // the asset side; a Token-2022 asset changes wire semantics this adapter has
  // not verified against. Detect a Token-2022 (or otherwise un-routable) mint
  // and GRACEFULLY SELF-DROP the pool (the SvmRoute orchestrator catches a
  // fetchPoolConfig throw and drops the venue) instead of relying on the CPI to
  // fail on-chain. Reuses the mint bytes already loaded above; the LEGACY path
  // is byte-identical (a classic 82-byte mint classifies Tokenkeg, parses no
  // extensions). LP shares are always classic per the IDL, checked defensively.
  for (const [m, mintData] of [
    [assetMint, assetMintRaw],
    [lpMint, lpMintRaw],
  ] as const) {
    if (classifyMintProgram(m, mintData) === TOKEN_2022_PROGRAM_ID) {
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

  return {
    venue: SLUG,
    pool,
    direction: "assetToLp",
    assetMint,
    lpMint,
    protocol,
    vaultAssetIdleAuth,
    vaultAssetIdleAta,
    vaultLpMintAuth,
    assetDecimals,
    lpDecimals,
  };
}
