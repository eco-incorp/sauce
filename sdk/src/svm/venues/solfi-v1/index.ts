/**
 * SolFi V1 (SvmRoute ladder fragment) — a from-scratch binary
 * reverse-engineering of the v1 sibling of `solfi-v2` (`sdk`'s
 * `svm/venues/solfi-v2`, imported here as `solfiV2`). The SDK ships no
 * `solfi-v1` ladder; this module is local, not a port.
 *
 * ── What was recovered (all re-derivable — see `docs/solfi-v1-evidence.md`
 *    for the exact RPC calls, transaction signatures and the LiteSVM method
 *    used to validate against the REAL deployed program) ──
 *
 * 1. Program: `SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe` (BPF Upgradeable,
 *    ProgramData `3nqYTC2hJ4qt7M2VKFTt5D55qApcLGGYx6DQCgykqfU9`). 40 live pool
 *    accounts (`getProgramAccounts`, all 2800 bytes) + one 352-byte account
 *    (unused by this adapter).
 * 2. Pool account layout (plaintext, no XOR obfuscation, no separate oracle
 *    account — unlike solfi-v2 — confirmed across ALL 40 discovered pools):
 *    mintA @2664, mintB @2696, vaultA @2736, vaultB @2768 (each 32-byte
 *    pubkeys, mintA/mintB standard SPL Mint accounts, vaultA/vaultB standard
 *    SPL Token accounts whose own `owner` field is the pool itself).
 * 3. The swap instruction (disc 0x07, 18 bytes: disc(1) || amountIn u64 LE ||
 *    minOut u64 LE || direction u8) is BYTE-IDENTICAL to solfi-v2's
 *    documented "v1 swap CPI" format (see `solfiV2`'s module doc — v2's own
 *    binary carries a back-compat disc-0x07 path for exactly this shape).
 *    Independently re-verified two ways: (a) decoded from a REAL mainnet
 *    transaction CPI-ing into this exact program
 *    (`4jnyvSdLmApuQZQfXJp9LMgqfTgtRR7oRd6Hq86oTyaMnzH2w7NqtfK7KPvwDDrUKreT9D
 *    c9AR9aiQ3crKrxRpGp`, inner index 2 of a Jupiter route, pool
 *    `rfynE6GWHaTkeYgXrZtF2FNMLg48VuKARogcDgeNpHX`); (b) built from scratch
 *    and driven through the REAL dumped program via LiteSVM. The 8-account
 *    order — [authority (READONLY signer — the token accounts' owner, not
 *    writable), pool (w), vaultA (w), vaultB (w), userA (w), userB (w), token
 *    program, Instructions sysvar] — is likewise verified both ways; userA/
 *    userB are POSITIONAL BY MINT (same trap as solfi-v2/Quantum).
 * 4. **All 40 discovered pools currently hold ZERO balance in at least one
 *    vault** (verified via `getMultipleAccounts` on every vault, 2026-07-31
 *    — liquidity has fully migrated to v2). This venue is DEAD on mainnet
 *    TODAY, not unreadable or unintegrable — see the module's closing note
 *    and CLAUDE.md's "no premature gating": the standard relative-depth
 *    liveness filter (`depthReserves` below, reading LIVE vault balances)
 *    self-drops every one of them the same way an emptied pool on ANY other
 *    family would, with zero special-casing. If the maker ever refunds a
 *    pool this wiring picks it up with no further code change.
 * 5. **A genuine on-chain staleness gate exists and independently blocks
 *    live execution today.** Every discovered pool's last real activity is
 *    a slot from ~2025 (verified: mainnet `Clock` vs. these pools' own
 *    embedded last-swap-slot fields); driving the REAL program via LiteSVM
 *    at the CURRENT cluster clock reverts with a custom program error (23)
 *    until the clock is rolled back to (approximately) the pool's own last
 *    activity — a classic push-price staleness check. This adapter's
 *    OFF-CHAIN quote model does not depend on it (see #6 — the model never
 *    reads a timestamp), but a REAL on-chain execution against a pool whose
 *    maker has stopped publishing price updates would revert the whole
 *    atomic cook — the same platform-wide "CPI failure aborts the tx"
 *    property every SVM family already carries (see CLAUDE.md's settled SVM
 *    parity verdicts); the zero-reserve self-drop above is what actually
 *    keeps this from firing today, not a claim that staleness can never
 *    recur once a pool is refunded.
 *
 * ── Pricing model (deliberately conservative — see #6) ──
 *
 * The real quote is a proprietary, per-pool piecewise schedule (a
 * concave, monotone curve: average realized rate falls smoothly from an
 * unimpacted small-trade rate down to a floor as size grows, then stays
 * FLAT at that floor — empirically characterized against the REAL deployed
 * program via LiteSVM at ~30 sizes spanning 9 orders of magnitude, both
 * directions, on the one pool below). The exact byte-level schedule (the
 * spline-like knot table this repo's solfi-v2 sibling had to fully recover)
 * was NOT fully cracked in the time available for this integration — rather
 * than guess at it (a favorable error wins merge elections it cannot back
 * up, see CLAUDE.md's dust-K1 note), this ships the VERIFIED FLOOR rate as
 * a flat, per-pool, per-direction constant: `quote(x) = min(floorRate·x,
 * liveVaultOutBalance)`. Every one of the ~30 sampled sizes (1e3 to 1e15 raw
 * units, both directions) realized an output AT OR ABOVE this floor, so the
 * model never over-promises. It is trivially monotone and concave (a
 * straight line clamped by a constant is concave), so it cannot trigger the
 * "coarse ladder gets allocated ZERO" failure mode.
 *
 * REFUSE, DON'T GUESS (mirrors solfi-v2's per-pool `POOL_K`): a pool whose
 * floor rate has not been independently verified this way throws at
 * `fetchPoolConfig` rather than borrowing another pool's fit — see
 * `SOLFI_V1_POOL_RATES` below. Extend by repeating the LiteSVM sweep
 * documented in `docs/solfi-v1-evidence.md` against a new pool.
 *
 * ── CU (`the consuming app SVM CU-budget module`'s `CU_FAMILIES['solfi-v1']`) ──
 *
 * MEASURED, not modeled: the REAL program invoked directly in LiteSVM
 * (program dumped from the deployed ProgramData, no engine wrapper)
 * consumed 39,309-39,686 CU across the sampled sizes (both directions) once
 * the staleness gate is satisfied. The pin adds this measurement,
 * margin-padded (+~12%, 45,000), on top of raydium-cp-swap's 183,187
 * same-complexity analog (this fragment's own setup is actually LIGHTER —
 * one live vault read, not two, since the quote does not depend on
 * reserves) rather than reusing a placeholder, per the standing "existing
 * pins omit the venue CPI" gap.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig } from "../types.js";

const SLUG = "solfi-v1";

export const SOLFI_V1_PROGRAM_ID: Address<"SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe"> = address(
  "SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe",
);

export const POOL_ACCOUNT_SIZE = 2800;

// Verified across all 40 discovered pools (docs/solfi-v1-evidence.md) — plaintext, no XOR.
export const OFF_MINT_A = 2664;
export const OFF_MINT_B = 2696;
export const OFF_VAULT_A = 2736;
export const OFF_VAULT_B = 2768;
/**
 * The verified conservative floor rate for a pool + direction: real realized
 * output is >= (num/den)·amountIn at every sampled size (see the module doc
 * and docs/solfi-v1-evidence.md for the raw LiteSVM sweep this was derived
 * from — NOT a claim about the venue's real fee/impact schedule, a safety
 * floor sized so the model never over-promises).
 */
export interface SolfiV1FloorRate {
  num: bigint;
  den: bigint;
}

/**
 * Per-pool, per-direction verified floor rates. A pool absent here THROWS at
 * `fetchPoolConfig` (see `fetchSolfiV1Config`) — never borrowed from another
 * pool, mirroring solfi-v2's `POOL_K`. direction 0 = mintA -> mintB, 1 =
 * mintB -> mintA (matches the on-chain instruction's direction byte).
 *
 * '65ZHSArs...'-style single-pool coverage today: the only pool this
 * integration's LiteSVM sweep verified (docs/solfi-v1-evidence.md). Extend
 * by running the same sweep against another pool's real bytes.
 */
export const SOLFI_V1_POOL_RATES: Record<string, { 0: SolfiV1FloorRate; 1: SolfiV1FloorRate }> = {
  // A8C3xu...pump / USDC pool. Verified 2026-07-31 via LiteSVM against the
  // REAL deployed program (program.so dumped from ProgramData
  // 3nqYTC2hJ4qt7M2VKFTt5D55qApcLGGYx6DQCgykqfU9) at ~30 sizes spanning 9
  // orders of magnitude, both directions — see docs/solfi-v1-evidence.md.
  rfynE6GWHaTkeYgXrZtF2FNMLg48VuKARogcDgeNpHX: {
    0: { num: 9_648_266_337n, den: 100_000_000_000n }, // A -> B floor (measured 96482663370 out / 1e12 in)
    1: { num: 1_679_058_126_523n, den: 200_000_000_000n }, // B -> A floor (measured 8395290632615 out / 1e12 in)
  },
};

export interface SolfiV1PoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA -> mintB, 1 = mintB -> mintA. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  rate0: SolfiV1FloorRate;
  rate1: SolfiV1FloorRate;
}

const ADDRESS_CODEC = getAddressCodec();

/**
 * Off-chain gate + decode: pool size, mint/vault pubkeys (plaintext, fixed
 * offsets — verified across all 40 discovered pools), and the per-pool
 * verified floor rate (REQUIRED — see `SOLFI_V1_POOL_RATES`; a pool not yet
 * independently verified throws rather than guessing).
 */
export async function fetchSolfiV1Config(
  load: AccountLoader,
  pool: Address,
  direction: 0 | 1 = 0,
): Promise<SolfiV1PoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} account is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  const rates = SOLFI_V1_POOL_RATES[pool as unknown as string];
  if (rates === undefined) {
    throw new Error(
      `${SLUG}: pool ${pool} has no independently-verified floor rate (SOLFI_V1_POOL_RATES) — ` +
        "a sibling pool's fit is never borrowed; see the consuming app solfi-v1 venue module for how to add one",
    );
  }
  const pubkeyAt = (offset: number): Address =>
    ADDRESS_CODEC.decode(data.subarray(offset, offset + 32));
  return {
    venue: SLUG,
    pool,
    direction,
    mintA: pubkeyAt(OFF_MINT_A),
    mintB: pubkeyAt(OFF_MINT_B),
    vaultA: pubkeyAt(OFF_VAULT_A),
    vaultB: pubkeyAt(OFF_VAULT_B),
    rate0: rates[0],
    rate1: rates[1],
  };
}
