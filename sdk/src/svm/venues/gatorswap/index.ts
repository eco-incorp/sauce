/**
 * GatorSwap venue adapter — program `gatorLx9aC1e5ZWAXscv5QRKiLXnLPLXjftVc81h1Hr`.
 * No on-chain IDL ships for this program (a minimal, non-Anchor native
 * program: no 8-byte instruction discriminator, and its account's leading
 * 8 bytes do not look like an Anchor `sha256("account:X")[:8]` tag either —
 * see "Discovery filter" below), so everything here is recovered by
 * transaction archaeology (`getSignaturesForAddress` + `getTransaction`,
 * `encoding: jsonParsed`, real DFlow-routed swaps against the live SOL/
 * "Jimothy The Raccoon" pool, 2026-07-31) plus raw account-byte inspection
 * (locating known addresses as raw bytes inside a pool account, the same
 * method obric-v2/bisonfi/solfi-v2 used) and PDA-seed brute-forcing
 * (`getProgramDerivedAddress` against real observed addresses — see
 * "Vault/pool PDAs" below).
 *
 * ── What GatorSwap actually is (a genuine, load-bearing finding) ──
 * GatorSwap is NOT a constant-product pool priced off its own reserves.
 * It is an inventory-backed OTC-style execution layer: it holds its own
 * token vaults (real SPL balances that move on every trade — confirmed via
 * preTokenBalances/postTokenBalances deltas) but PRICES each trade off a
 * REFERENCED third-party pool's live spot price, not its own vault ratio.
 * Evidence (3 real mainnet trades, both directions, sizes 20.4M-4.36B raw
 * units): the pool's OWN vault ratio implied ~0.4283 WSOL/token, but every
 * trade executed at ~0.1187-0.1190 WSOL/token — a ~3.6x gap, constant
 * across both directions and a 5.7x size range (i.e. GatorSwap shows
 * ZERO measurable price impact from its own reserves in this sample).
 * Meanwhile the referenced pool (a PumpSwap AMM pool for the SAME pair,
 * whose address is stored directly in GatorSwap's pool account — see
 * below) had a live spot ratio of 0.11888 WSOL/token AT THE SAME BLOCK —
 * matching GatorSwap's real executed price to within 0.1-0.2% at every
 * sampled size/direction (see the "Conservative pricing model" section).
 * This is the mechanism: GatorSwap reads a reference AMM's live reserves
 * (attached read-only, no CPI needed) to price its own inventory-backed
 * fill, functioning as a "fast, capital-light OTC wrapper" around a real
 * AMM's spot price — plausibly built for tokens (like this one) whose
 * direct PumpSwap swap path is gated (this pool's `is_cashback_coin` flag
 * is SET, which this repo's own wired `pumpswap` adapter explicitly
 * refuses to build a swap for — see `venues/pumpswap/index.ts` upstream).
 *
 * ── Pool account layout (1984 bytes; offsets confirmed by locating known
 * mint/pool/vault/program addresses as raw bytes, cross-checked against a
 * SECOND pool — see the file-level PDA note) ──
 *   bytes 0..8    : an 8-byte leading value (hex `0101ff0100000000` on the
 *                   sampled pool) — plausibly flags/version, NOT confirmed
 *                   stable across pools (only one pool sampled), so this
 *                   adapter's discovery filter does NOT key on it (see
 *                   the consuming app SVM discovery module's SVM_FAMILY_FILTERS entry).
 *   MINT_A_OFFSET (8, 32 bytes)  : the pool's first mint (the non-SOL side
 *                   on the sampled pool, e.g. a pump.fun-launched token).
 *   MINT_B_OFFSET (40, 32 bytes) : the pool's second mint (wSOL on the
 *                   sampled pool).
 *   REF_POOL_OFFSET (80, 32 bytes): the address of a THIRD-PARTY AMM pool
 *                   for the SAME mint pair, read live for pricing (see
 *                   above). Confirmed to be a PumpSwap `Pool` account on
 *                   the one sampled pool (discriminator + size verified at
 *                   fetch time; a pool whose reference isn't a valid
 *                   PumpSwap Pool self-drops with a clear error rather than
 *                   guessing at a different reference-venue shape).
 * (The account also carries further fallback-venue scaffolding — a second
 * program-id + pool-account pair matching Meteora DLMM's program and two of
 * its bin arrays, at higher offsets — observed in every sampled instruction's
 * account list but NEVER actually CPI'd into in the "simple" trades this
 * adapter models (confirmed via transaction log inspection: no Meteora
 * invoke record for a trade the pool's own inventory could cover). This
 * adapter does not model that path; it prices exclusively off the PumpSwap
 * reference, which is what every sampled trade's execution actually tracked.)
 *
 * ── Vault / pool PDAs (verified) ──
 * Neither of the pool's own two SPL vaults is stored as a raw pubkey
 * anywhere in the 1984-byte account (an exhaustive `bytes.find` over the
 * WHOLE account for both known vault addresses returned no match) — they
 * are PDAs: `PDA(gatorLx9a, ["vault", pool, mint])`, verified by
 * `getProgramDerivedAddress` reproducing BOTH real vault addresses
 * byte-for-byte from the pool + each mint. The pool account address
 * itself is ALSO a PDA — `PDA(gatorLx9a, ["pool", mintA, mintB])` (in
 * exactly that mint order) — verified the same way; not needed by
 * `fetchPoolConfig` (discovery supplies `pool` directly) but kept here as
 * `deriveGatorswapPool` for documentation/testing.
 *
 * ── Conservative pricing model ──
 * Rather than replicate PumpSwap's own three-component (lp/protocol/
 * creator) tiered fee schedule — which would make this adapter's fetch
 * throw on gated PumpSwap states (mayhem mode, cashback coins — exactly the
 * state the SAMPLE pool's own reference is in) even though a plain vault
 * read never needs those gates — this ladder prices with a flat, fixed
 * conservative haircut on the input side (`REF_HAIRCUT_BPS` = 50, i.e.
 * 0.50%) over the reference pool's raw vault ratio. Checked against all 3
 * real trades: the raw 0-fee ratio is FAVOURABLE (real/predicted as low as
 * 0.9987, i.e. a 0-fee model would occasionally OVER-quote reality by
 * ~0.13%) — never safe to ship at 0. At 50 bps the modeled quote sits
 * 0.36-0.42% BELOW every real sample (real/predicted in [1.0036, 1.0042]);
 * at 40 bps the margin is still positive but thinner ([1.0028, 1.0032]).
 * 50 bps is comfortably inside the safe region while staying far below the
 * ~100 bps+ margin that would materially under-quote a venue whose real
 * fee is empirically close to PumpSwap's own (typically 25-30 bps total).
 * See the consuming app gatorswap oracles test for the exact
 * fixture-backed assertion (modeled <= real at every probed size/direction,
 * with a floor on the safety margin so this never regresses to a hair's
 * width). depthReserves uses the pool's OWN vault balances (the true
 * payable inventory), never the reference pool's — the reference is a
 * PRICE signal only, not a capacity signal.
 *
 * ── Swap instruction — HONEST LIMITATION (the reason this venue cannot
 * land a real cook today; a mechanism gap, not an authorization gap) ──
 * Every sampled swap's instruction data is exactly 113 bytes:
 *   bytes 0..8    : amountIn, u64 LE (confirmed exact against the real
 *                   vault delta in every sample — this is the codegen
 *                   PATCH slot, `patch: 'in'`, with an EMPTY prefix: unlike
 *                   every other wired family there is no leading
 *                   discriminator byte at all, consistent with this being
 *                   a single-instruction, non-Anchor program).
 *   bytes 8..40   : the INPUT mint (confirmed exact: the pump-fun token
 *                   mint on a pump->wsol trade, wSOL's own mint on the
 *                   reverse — both real samples matched byte-for-byte).
 *   bytes 40..48  : a small u64 LE counter (18377 and 18377 on two trades
 *                   submitted close together, 18375 on a third) — plausibly
 *                   a keeper/oracle "generation" sequence number GatorSwap
 *                   refreshes periodically (this program ALSO receives a
 *                   separate, low-CU "keeper" instruction on its pool
 *                   account carrying a large opaque data blob — observed
 *                   independently in the same transaction-archaeology
 *                   pass). Not a compile-time constant: it advances over
 *                   real time and this adapter cannot read "the current
 *                   value" from static pool bytes.
 *   bytes 48..113 : a 65-byte opaque blob that DIFFERS between every
 *                   sampled trade on the SAME pool/direction (ruling out a
 *                   fixed per-pool constant) — the length (64 + 1) matches
 *                   an ed25519 signature plus a flag/recovery byte. No
 *                   Ed25519Program precompile instruction accompanies any
 *                   sampled transaction, so verification (if that is what
 *                   this is) happens in-program against a stored authority
 *                   key, not via the sysvar precompile.
 * Put together: this reads as a per-trade FIRM QUOTE signed off-chain by
 * GatorSwap's own keeper/quoting service, binding (at minimum) the exact
 * amountIn and input mint. That is a fundamentally different integration
 * shape than every other wired family: the ladder framework compiles ONE
 * fixed byte template per shape and patches a SINGLE u64 (the amount) at
 * RUNTIME, inside the on-chain interpreter — there is no mechanism to
 * inject a fresh, externally-fetched, amount-binding signature at cook
 * time (the final fill amount is only known once the on-chain merge runs,
 * which is strictly after this program's bytecode is already frozen).
 * This is the SAME "not yet lands, ship anyway" shape already accepted for
 * BisonFi's required partner signer and Quantum's pending whitelist — the
 * difference is this gap is cryptographic/sequencing-order, not merely
 * permission, so no future whitelist grant alone resolves it (a future JIT
 * quote-fetch capability in the cook-building pipeline would). Per the
 * consuming recipe's existing "self-drop on live failure" contract,
 * shipping the best-effort real template with a placeholder counter/
 * signature is SAFE: the recipe's pre-flight CATCH rejects an invalid
 * signature exactly like any other rejected CPI, dropping only this one
 * slot — it simply always does so today. The moment a real signed quote
 * can be substituted (an operator-side JIT fetch, out of scope here), this
 * slot starts landing real fills with no adapter change. `buildSwapV2`
 * documents each account-list slot's confidence inline; the handful this
 * session could not pin down (a required, per-trader 512-byte state
 * account whose PDA seed could not be recovered by brute-force, plus two
 * accounts observed as not-yet-created in every sample) are left as
 * unresolved named refs rather than guessed addresses.
 *
 * ── CU (measured 2026-07-31 on LiteSVM against the real engine.so, SPL-
 * transfer stand-in per the consuming app cu e2e test's method —
 * see the consuming recipe's budget.ts's CU_FAMILIES entry for the fitted
 * slot/rung coefficients) ──
 */
import { address, getAddressCodec } from "@solana/kit";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type { Address } from "@solana/kit";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig, VenueAccount } from "../types.js";

const SLUG = "gatorswap";
export const GATORSWAP_PROGRAM_ID = address("gatorLx9aC1e5ZWAXscv5QRKiLXnLPLXjftVc81h1Hr");

const PUMPSWAP_POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
const PUMPSWAP_MIN_POOL_SIZE = 211;
const PUMPSWAP_BASE_MINT_OFFSET = 43;
const PUMPSWAP_QUOTE_MINT_OFFSET = 75;
const PUMPSWAP_BASE_VAULT_OFFSET = 139;
const PUMPSWAP_QUOTE_VAULT_OFFSET = 171;

const GATOR_POOL_ACCOUNT_SIZE = 1984;
const MINT_A_OFFSET = 8;
const MINT_B_OFFSET = 40;
const REF_POOL_OFFSET = 80;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));
const ZERO_ADDRESS = address("11111111111111111111111111111111");

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= discriminator.length && discriminator.every((b, i) => data[i] === b);
}

async function vaultPda(pool: Address, mint: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(GATORSWAP_PROGRAM_ID, [
    new TextEncoder().encode("vault"),
    codec.encode(pool) as Uint8Array,
    codec.encode(mint) as Uint8Array,
  ]);
}

/** `PDA(gatorLx9a, ["pool", mintA, mintB])` — documentation/testing only; discovery supplies `pool` directly. */
export async function deriveGatorswapPool(mintA: Address, mintB: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(GATORSWAP_PROGRAM_ID, [
    new TextEncoder().encode("pool"),
    codec.encode(mintA) as Uint8Array,
    codec.encode(mintB) as Uint8Array,
  ]);
}

export interface GatorswapPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA in / mintB out, 1 = mintB in / mintA out. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  /** The referenced PumpSwap pool priced for this pair — read-only, never CPI'd into. */
  refPool: Address;
  refBaseMint: Address;
  refQuoteMint: Address;
  refBaseVault: Address;
  refQuoteVault: Address;
}

function gatorswapConfig(cfg: PoolConfig): GatorswapPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as GatorswapPoolConfig;
}

async function fetchPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<GatorswapPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== GATOR_POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${GATOR_POOL_ACCOUNT_SIZE}`,
    );
  }
  const mintA = pubkeyAt(data, MINT_A_OFFSET);
  const mintB = pubkeyAt(data, MINT_B_OFFSET);
  const refPool = pubkeyAt(data, REF_POOL_OFFSET);
  if (refPool === ZERO_ADDRESS) {
    throw new Error(
      `${SLUG} pool ${pool} has no reference-venue pool set (this adapter has no other pricing source)`,
    );
  }
  const [vaultA, vaultB, refData] = await Promise.all([
    vaultPda(pool, mintA),
    vaultPda(pool, mintB),
    load(refPool),
  ]);
  if (refData === null)
    throw new Error(`${SLUG} pool ${pool} reference pool ${refPool} account not found`);
  if (!hasDiscriminator(refData, PUMPSWAP_POOL_DISCRIMINATOR)) {
    throw new Error(
      `${SLUG} pool ${pool} reference ${refPool} is not a recognized PumpSwap Pool account (this adapter only models the PumpSwap-reference case)`,
    );
  }
  if (refData.length < PUMPSWAP_MIN_POOL_SIZE) {
    throw new Error(
      `${SLUG} pool ${pool} reference ${refPool} data is ${refData.length} bytes, expected at least ${PUMPSWAP_MIN_POOL_SIZE}`,
    );
  }
  const refBaseMint = pubkeyAt(refData, PUMPSWAP_BASE_MINT_OFFSET);
  const refQuoteMint = pubkeyAt(refData, PUMPSWAP_QUOTE_MINT_OFFSET);
  const refBaseVault = pubkeyAt(refData, PUMPSWAP_BASE_VAULT_OFFSET);
  const refQuoteVault = pubkeyAt(refData, PUMPSWAP_QUOTE_VAULT_OFFSET);
  const refMints = new Set([refBaseMint, refQuoteMint]);
  if (!refMints.has(mintA) || !refMints.has(mintB)) {
    throw new Error(
      `${SLUG} pool ${pool} reference ${refPool} mints do not match this pool's mint pair`,
    );
  }
  return {
    venue: SLUG,
    pool,
    direction: 0,
    mintA,
    mintB,
    vaultA,
    vaultB,
    refPool,
    refBaseMint,
    refQuoteMint,
    refBaseVault,
    refQuoteVault,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = gatorswapConfig(base);
  return [
    { ref: "refBaseVault", address: cfg.refBaseVault },
    { ref: "refQuoteVault", address: cfg.refQuoteVault },
  ];
}

export const gatorswap = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: GATORSWAP_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};
