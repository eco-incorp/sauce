/**
 * M Swap (SvmRoute venue, `mswap`) — m0-foundation's `ext_swap` router
 * (program `MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH`, labeled "M Swap" in
 * Jupiter's own `program-id-to-label` capture). Open source at
 * github.com/m0-foundation/solana-m-extensions (`programs/ext_swap`); the
 * per-token wrap/unwrap logic it CPIs into lives in the same repo's
 * `programs/m_ext`. Every account layout, PDA seed, instruction discriminator
 * and conversion formula below is cited against that source, not guessed —
 * see "GROUND TRUTH" and "VALIDATION".
 *
 * WHAT THIS PROGRAM DOES: `swap()` composes an `unwrap` (burn `fromExt` for
 * `$M`) and a `wrap` (mint `toExt` from that `$M`) into one atomic CPI chain,
 * so a user can move between any two WHITELISTED "M extension" tokens
 * (wM, and several USD-denominated M-backed stablecoins) without ever
 * touching `$M` directly. There is no curve and no per-pair fee — see
 * "QUOTE" below for exactly which pairs are exact 1:1 and why the scope
 * here stops short of the full whitelisted set.
 *
 * SHAPE: like Sanctum Infinity, this is NOT a per-pair pool account — ONE
 * `SwapGlobal` account (PDA `SWAP_GLOBAL_ID` below) holds the whitelist for
 * ALL pairs, and any two whitelisted extensions can swap against each other.
 * This venue therefore does NOT use the generic `SVM_FAMILY_FILTERS`
 * getProgramAccounts sweep (there is no per-pair account to memcmp-scan for)
 * — see `the consuming app SVM discovery module`'s `withMSwap` wrapper, which mints a
 * synthetic per-directed-pair discovery key the same way
 * `sanctumInfinityPoolKey` does.
 *
 * GROUND TRUTH — `SwapGlobal` (this program's own global, discriminator
 * `0fb89381b7dbdfa3` = sha256("account:SwapGlobal")[0..8], confirmed against
 * the live PDA below):
 *   [0..8)   discriminator
 *   [8..9)   bump                      u8
 *   [9..41)  admin                     Pubkey
 *   [41..45) whitelisted_unwrappers.len  u32 LE
 *   [45..)   whitelisted_unwrappers      Pubkey[len]   (operational unwrap-authority allowlist — not used by fetchPoolConfig)
 *   [..+4)   whitelisted_extensions.len  u32 LE
 *   [..)     whitelisted_extensions      WhitelistedExtension[len], 96 bytes each:
 *              programId(32) ++ mint(32) ++ tokenProgram(32)
 * (`programs/ext_swap/src/instructions/swap.rs`'s `state.rs` — the
 * `SwapGlobal`/`WhitelistedExtension` structs.) LIVE-READ (this venue's own
 * `fetchPoolConfig`, not a hardcoded mint table): whichever mints are
 * whitelisted here are what this adapter can quote — 6 confirmed live
 * 2026-07-31 at `SWAP_GLOBAL_ID`. If m0 whitelists a 7th extension tomorrow
 * this adapter serves it automatically, no code change (the ONLY hardcoded
 * addresses below are protocol-fixed constants: the swap program, its
 * `SwapGlobal` PDA, `$M`'s own mint, and `$M`'s always-Token2022 program —
 * per-extension programId/mint/tokenProgram all come from this live read).
 *
 * `SwapGlobal.whitelisted_extensions` DECIDES ELIGIBILITY BUT NOT SAFETY: an
 * extension's own `m_ext`-family global (`ExtGlobalV2`, PDA seed `b"global"`
 * under THAT extension's OWN program id — every extension is a SEPARATE
 * program deploy, see `M_EXT_GLOBAL_SEED`) carries a `wrap_authorities: Vec
 * <Pubkey>` allowlist THAT PROGRAM checks before honoring an unwrap/wrap
 * whose `unwrap_authority`/`wrap_authority` is `None` (the ext_swap program
 * passes `None` for both — see "OPTIONAL-ACCOUNT SENTINEL" below — which
 * `programs/m_ext/src/instructions/{wrap,unwrap}.rs`'s `validate()` resolves
 * to `swap_global` itself, i.e. `ext_swap`'s own PDA, `SWAP_GLOBAL_ID`). If
 * `SWAP_GLOBAL_ID` is NOT in an extension's `wrap_authorities`, ITS OWN
 * PROGRAM reverts `NotAuthorized` — a fact this recipe cannot route around
 * (no other signer is available; the recipe supplies none). Measured live
 * 2026-07-31: of the 6 whitelisted extensions, ONE ("xoUSD",
 * `mexteGyWXgUR65XepNKtLJ2H66MmyLWrDSeA1bqzZ4C`) does NOT list
 * `SWAP_GLOBAL_ID` as a wrap authority — `fetchPoolConfig` SELF-DROPS any
 * pair touching it (a live, per-request re-check, never a hardcoded
 * exclusion — the moment m0 adds `SWAP_GLOBAL_ID` there, this adapter
 * serves it with zero code change, per this repo's "not-whitelisted is a
 * sequence, never a blocker" policy).
 *
 * QUOTE — EXACT 1:1, NO FEE, for the subset this adapter serves; here is
 * the derivation and why the subset is narrower than "every whitelisted
 * pair". `swap()`'s handler runs (`programs/ext_swap/src/instructions/
 * swap.rs`):
 *   m_ext::cpi::unwrap(fromExtProgram, amount)   // burn fromExt, credit $M into swap_m_account
 *   m_ext::cpi::wrap(toExtProgram, amount)       // debit swap_m_account, mint toExt
 * — THE SAME `amount` SCALAR THREADS BOTH CALLS. Inside `m_ext`'s
 * `wrap`/`unwrap` (`programs/m_ext/src/instructions/{wrap,unwrap}.rs`),
 * every raw SPL amount actually moved is `amount_to_principal_down(amount,
 * index) = index == 1e12 ? amount : floor(amount * 1e12 / index)`
 * (`utils/conversion.rs`), where `index` is EACH mint's own conversion
 * index: `ext_principal_from = f(amount, extIndexFrom)` is what's actually
 * BURNED from the user's `fromExt` account, `ext_principal_to =
 * f(amount, extIndexTo)` is what's actually MINTED to the user's `toExt`
 * account. `extIndex` is fixed at exactly `1e12` (`INDEX_SCALE_U64`)
 * FOREVER for a "NoYield" or "Crank" feature-compiled `m_ext` deploy —
 * `sync_index`'s `cfg_if` only computes a live index for a "ScaledUi"
 * feature build; the other two variants' branch is `return
 * Ok(INDEX_SCALE_U64)` unconditionally (`utils/conversion.rs`'s
 * `sync_index`, the non-scaled-ui else-arm) — a COMPILE-TIME Rust feature
 * flag baked into that extension's deployed binary, not a runtime toggle,
 * so this is a PERMANENT invariant of that program, not a snapshot. When
 * BOTH legs are NoYield/Crank (extIndexFrom == extIndexTo == 1e12 exactly),
 * `ext_principal_from == ext_principal_to == amount` — an EXACT, PERMANENT
 * 1:1 pass-through with no state read needed for the rate at all (only for
 * capacity — see below).
 *
 * ONE of the 6 live whitelisted extensions ("USDK-variant",
 * `extMahs9bUFMYcviKCvnSRaXgs5PcqmMzcnHRtTqE85`) is a "ScaledUi"-feature
 * deploy: its index moves with `$M`'s own accruing yield (currently
 * ~1.0388e12, drifting upward, `fee_bps=0` measured live). Reproducing its
 * exact index on-chain needs `$M`'s mint's own live Token2022
 * `ScaledUiAmountConfig` multiplier — an IEEE754 `f64` field
 * (`multiplier_to_index` in `m_ext`'s Rust is `trunc(1e12 * multiplier)`)
 * — and this recipe's SauceScript interpreter has no floating-point
 * arithmetic (`Math.mulDiv` and friends are integer-only). A snapshot baked
 * at prepare time would go stale by cook time in the disfavorable direction
 * whenever this extension is the OUTPUT leg (a stale, lower baked index
 * OVER-states the real output — the forbidden "favourable error" direction
 * for a quote curve), so THIS ADAPTER EXCLUDES ANY PAIR TOUCHING IT rather
 * than risk that: `fetchPoolConfig` self-drops on
 * `yieldVariant === YIELD_VARIANT_SCALED_UI` for either leg — again a LIVE
 * check (`ExtGlobalV2.yield_config.yield_variant`), not a hardcoded mint
 * exclusion; if this repo ever grows integer-exact `f64`-multiplier support
 * the gate lifts with zero further protocol-side change needed.
 *
 * Net SERVABLE SET (measured live 2026-07-31, self-dropped candidates
 * excluded): **wM** (`mzeroXDoBpRVhnEXBra27qzAMdxgpWVY3DzQW7xMVJp`,
 * program `wMXX1K1nca5W4pZr1piETe78gcAVVrEFi9f4g46uXko`, "Crank" variant),
 * **ext2** (`usdkbee86pkLyRmxfFCdkyySpxRb5ndCxVsK2BkRXwX`, program
 * `extaykYu5AQcDm3qZAbiDN3yp6skqn6Nssj7veUUGZw`, "NoYield"), **ext4**
 * (`usdsfJbX78ktZUnoRC7dwvvQz7xH3WdkpGne76gdUia`, program
 * `extUkDFf3HLekkxbcZ3XRUizMjbxMJgKBay3p9xGVmg`, "NoYield", classic
 * Tokenkeg — the ONLY leg of the 4 not on Token2022), **ext6**
 * ("dawn", `dawn7ZUF7h7anFuEsDdAU1Y3HYwikwqNMAENZsQJdNL`, program
 * `mextzNVPUbLbvyBwqBqnC5J1SSwjDLjjR4yppf6EBzc`, "Crank") — 4 nodes, 12
 * directed pairs, every one EXACT 1:1 with no state read for the rate.
 *
 * CAPACITY: the only real constraint is the FROM leg's own `$M` vault
 * (`from_m_vault`, an ATA of `$M` owned by that extension's
 * `m_vault_auth` PDA) — `unwrap` transfers `ext_principal_from` worth of
 * `$M` OUT of it, and it is never topped up mid-trade (the intermediate
 * `swap_m_account` is transient: `wrap`'s debit uses the SAME `amount`/
 * index pair as `unwrap`'s credit within one atomic tx, so it always nets
 * to empty — see "CORRECTNESS" below). Since `extIndexFrom == 1e12` for
 * every servable pair, `ext_principal_from == amount` needed OUT of the
 * vault too — i.e. the vault's LIVE raw balance (read via `accountUint` at
 * cook time, never a prepare-time snapshot) is a SAFE cap on `x` directly,
 * no `$M`-index conversion needed. This under-states the true face-value
 * capacity slightly whenever `$M`'s own multiplier is above 1.0 (it only
 * ever grows — `calculate_new_index` in `m_ext` explicitly rejects
 * `new_m_index < last_m_index`) — the conservative, never-over-quote
 * direction, matching this recipe's `solayer` adapter's identical choice.
 *
 * OPTIONAL-ACCOUNT SENTINEL: `Swap`'s `wrap_authority`/`unwrap_authority`
 * are `Option<Signer>`; Anchor's client convention for `None` is to pass
 * the PROGRAM'S OWN id as the account (not a signer) — confirmed against
 * `solana-m-extensions`' own test harness
 * (`tests/unit/ext_swap.test.ts`: `unwrapAuthority: $.swapProgram.programId,
 * // placeholder for None`). This recipe has no other signer to offer, so
 * both slots below are always `MSWAP_PROGRAM_ID` — meaning EVERY servable
 * extension MUST have `SWAP_GLOBAL_ID` in its own `wrap_authorities` (see
 * the eligibility gate above; this is exactly what that gate protects).
 *
 * `remaining_accounts_split_idx` is always `0`: none of the 4 servable
 * mints' Token2022 extensions configure a `TransferHook` (confirmed live —
 * every `TransferHook.programId` reads all-zero), so `unwrap`/`wrap` need no
 * extra remaining accounts on either leg.
 *
 * SWAP CPI ACCOUNTS (24, exact order from `programs/ext_swap/src/
 * instructions/swap.rs`'s `Swap<'info>` derive, confirmed byte-for-byte by
 * a real `simulateTransaction` — see VALIDATION): `[signer,
 * wrapAuthority(=programId sentinel), unwrapAuthority(=programId sentinel),
 * swapGlobal, fromGlobal, toGlobal, fromMint, toMint, mMint,
 * fromTokenAccount, toTokenAccount, swapMAccount, fromMVaultAuth,
 * toMVaultAuth, fromMintAuthority, toMintAuthority, fromMVault, toMVault,
 * fromTokenProgram, toTokenProgram, mTokenProgram, fromExtProgram,
 * toExtProgram, systemProgram]`. Instruction data: `disc("swap")(8) ++
 * amount(u64 LE, RUNTIME-PATCHED) ++ splitIdx(u8, =0)`.
 *
 * VALIDATION (real `simulateTransaction`, `sigVerify:false`, against LIVE
 * mainnet state 2026-07-31 — no LiteSVM engine build of the actual m0
 * programs was available for this pass, so real network state is the
 * ground truth here the same way it is for `solayer`'s cited real
 * transactions):
 *   wM -> ext6 ("dawn"), wallet `8mZpjtSkD1FnkvHcue21hb4HB7oGTwK3vD2ntP1D5Z95`
 *   (real funded holder of both, found via `getTokenLargestAccounts`):
 *     amount=1_000_000:  wM  -1,000,000 exact, ext6 +1,000,000 exact, 125,964 CU
 *     amount=10_000_000: wM -10,000,000 exact, ext6 +10,000,000 exact, 125,964 CU
 *     amount=63_000_000: wM -63,000,000 exact, ext6 +63,000,000 exact, 126,276 CU
 *   wM -> ext4 ("USDS-like", classic Tokenkeg, destination ATA created
 *   idempotently in the same simulated tx):
 *     amount=5_000_000:  wM  -5,000,000 exact, ext4 (new ATA) = 5,000,000 exact, 125,271 CU (program-only; 131,108 incl. the ATA-create ix)
 * Every size on every pair moved EXACTLY `amount` on both legs — confirms
 * the exact-1:1 model bit-for-bit against the real deployed program, across
 * both a same-token-program (Token2022<->Token2022) and a cross-token-
 * program (Token2022<->Tokenkeg) leg. The account order/roles above are
 * exactly what the real program accepted (a wrong order fails inside the
 * CPI'd `m_ext` program, not silently). See `CU_FAMILIES.mswap` in
 * `the consuming app SVM CU-budget module` for how this feeds the CU pin.
 *
 * CORRECTNESS NOTE (`swap_m_account`, the transient `$M` holding account):
 * never a capacity constraint. `unwrap` credits it with
 * `amount_to_principal_down(amount, mIndex)` and `wrap` immediately debits
 * the SAME quantity (same `amount`, same live `$M` mint state read within
 * the same atomic instruction — nothing can change `$M`'s multiplier
 * mid-transaction), so it starts and ends at zero every trade; this
 * adapter attaches it but never reads its balance.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import { readUintLE } from "../math.js";
import { pairKeyRegistry, type DirectedPair } from "../pair-keys.js";
import { accountDataLoader } from "../../loader.js";
import type { AccountLoader, OwnedAccountLoader, PoolConfig } from "../types.js";

const SLUG = "mswap";

/** m0-foundation's ext_swap router — `SVM_VENUE_PROGRAM_IDS['mswap']`. */
export const MSWAP_PROGRAM_ID = address("MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH");
/** `ext_swap`'s own global (PDA seed `b"global"` under `MSWAP_PROGRAM_ID`, bump 253 — derived offline, cross-checked live 2026-07-31). */
export const SWAP_GLOBAL_ID = address("6U4ZZZkftbuHxjRDHUfh83M9zG66aAAXDV3xTRX7yePr");
/** The one `$M` mint every whitelisted extension wraps/unwraps against. */
export const M_MINT = address("mzerojk9tg56ebsrEAhfkyc9VgKjTW2zDqp6C5mhjzH");
/** `$M` is always Token2022 (`m_ext`'s `Wrap`/`Unwrap` hard-type `m_token_program: Program<Token2022>`). */
export const M_TOKEN_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/** `SwapGlobal`'s own ATA of `$M` (owner = `SWAP_GLOBAL_ID`) — the transient per-trade holding account (see module doc). */
export const SWAP_M_ACCOUNT = address("7dM9YCAbN9XGixnaP7wnyQDVZH6BVy6HPFeZr1SWVNka");

const SWAP_GLOBAL_DISCRIMINATOR = [0x0f, 0xb8, 0x93, 0x81, 0xb7, 0xdb, 0xdf, 0xa3];
const M_EXT_GLOBAL_SEED = new TextEncoder().encode("global");
const M_VAULT_SEED = new TextEncoder().encode("m_vault");
const MINT_AUTHORITY_SEED = new TextEncoder().encode("mint_authority");

/** `ExtGlobalV2.yield_config.yield_variant` discriminant byte (`m_ext`'s `YieldVariant` enum). */
const YIELD_VARIANT_NO_YIELD = 0;
const YIELD_VARIANT_SCALED_UI = 1;
const YIELD_VARIANT_CRANK = 2;

const codec = getAddressCodec();

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}
function readAddress(data: Uint8Array, offset: number): Address {
  return codec.decode(data.subarray(offset, offset + 32)) as Address;
}

// ── discovery key (no per-pair on-chain account — see module doc and `../pair-keys.ts`) ──
const PAIR_KEYS = pairKeyRegistry(SLUG);

/** Mint synthetic per-directed-pair discovery key (mirrors `sanctumInfinityPoolKey`). */
export function mswapPoolKey(inMint: Address, outMint: Address): Address {
  return PAIR_KEYS.key(inMint, outMint);
}

// ── SwapGlobal decode ────────────────────────────────────────────────────────
interface WhitelistedExtensionEntry {
  programId: Address;
  mint: Address;
  tokenProgram: Address;
}

function decodeSwapGlobal(data: Uint8Array): { extensions: WhitelistedExtensionEntry[] } {
  if (!hasDiscriminator(data, SWAP_GLOBAL_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: ${SWAP_GLOBAL_ID} has a foreign discriminator (not SwapGlobal)`);
  }
  let off = 8 + 1 + 32; // discriminator + bump + admin
  const unwrapperLen = Number(readUintLE(data, off, 4));
  off += 4 + unwrapperLen * 32;
  const extLen = Number(readUintLE(data, off, 4));
  off += 4;
  const extensions: WhitelistedExtensionEntry[] = [];
  for (let i = 0; i < extLen; i++) {
    extensions.push({
      programId: readAddress(data, off),
      mint: readAddress(data, off + 32),
      tokenProgram: readAddress(data, off + 64),
    });
    off += 96;
  }
  return { extensions };
}

// ── per-extension ExtGlobalV2 decode (m_ext's own global, one per extension program) ──
interface ExtGlobal {
  yieldVariant: number;
  wrapAuthorities: Address[];
}

/** Handles the `pending_admin: Option<Pubkey>` variable-length prefix and all 3 `YieldConfig` shapes. */
function decodeExtGlobal(data: Uint8Array): ExtGlobal {
  let off = 8 + 32; // discriminator + admin
  const pendingTag = data[off];
  off += 1;
  if (pendingTag === 1) off += 32;
  off += 32 + 32 + 32; // ext_mint + m_mint + m_earn_global_account
  off += 1 + 1 + 1; // bump + m_vault_bump + ext_mint_authority_bump
  const yieldVariant = data[off];
  if (yieldVariant === YIELD_VARIANT_NO_YIELD) {
    off += 1;
  } else if (yieldVariant === YIELD_VARIANT_SCALED_UI) {
    off += 1 + 8 + 8 + 8; // tag + fee_bps + last_m_index + last_ext_index
  } else if (yieldVariant === YIELD_VARIANT_CRANK) {
    off += 1 + 32 + 8 + 8 + 8; // tag + earn_authority + last_m_index + last_ext_index + timestamp
  } else {
    throw new Error(`${SLUG}: unknown ExtGlobalV2 yield_variant ${yieldVariant}`);
  }
  const wrapLen = Number(readUintLE(data, off, 4));
  off += 4;
  const wrapAuthorities: Address[] = [];
  for (let i = 0; i < wrapLen; i++) {
    wrapAuthorities.push(readAddress(data, off));
    off += 32;
  }
  return { yieldVariant, wrapAuthorities };
}

export interface MSwapPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  fromMint: Address;
  toMint: Address;
  fromProgramId: Address;
  toProgramId: Address;
  fromTokenProgram: Address;
  toTokenProgram: Address;
  fromGlobal: Address;
  toGlobal: Address;
  fromMVaultAuth: Address;
  toMVaultAuth: Address;
  fromMintAuthority: Address;
  toMintAuthority: Address;
  fromMVault: Address;
  toMVault: Address;
}

async function derivePdas(extProgramId: Address, mMint: Address, mTokenProgram: Address) {
  const global = await memoizedGetProgramDerivedAddress(extProgramId, [M_EXT_GLOBAL_SEED]);
  const mVaultAuth = await memoizedGetProgramDerivedAddress(extProgramId, [M_VAULT_SEED]);
  const mintAuthority = await memoizedGetProgramDerivedAddress(extProgramId, [MINT_AUTHORITY_SEED]);
  const mVault = await findAta(mVaultAuth, mMint, mTokenProgram);
  return { global, mVaultAuth, mintAuthority, mVault };
}

const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
async function findAta(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(ATA_PROGRAM, [
    codec.encode(owner) as Uint8Array,
    codec.encode(tokenProgram) as Uint8Array,
    codec.encode(mint) as Uint8Array,
  ]);
}

/**
 * Off-chain, once per requested (inMint, outMint): read the LIVE
 * `SwapGlobal` whitelist, resolve both legs' own `ExtGlobalV2` (gating
 * `yield_variant`/`wrap_authorities` per the module doc), and derive every
 * PDA the swap CPI needs. Self-drops (throws) on ANY of: either mint not
 * whitelisted, either leg a "ScaledUi" deploy, either leg missing
 * `SWAP_GLOBAL_ID` from its own `wrap_authorities` — all LIVE checks, never
 * a hardcoded mint exclusion. A refused pair's discovery key is forgotten.
 */
export async function fetchMSwapPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<MSwapPoolConfig> {
  const load = accountDataLoader(owned);
  return PAIR_KEYS.resolve(pool, (pair) => fetchMSwapPair(load, pool, pair));
}

async function fetchMSwapPair(
  load: AccountLoader,
  pool: Address,
  pair: DirectedPair,
): Promise<MSwapPoolConfig> {
  if (pair.inMint === pair.outMint) throw new Error(`${SLUG}: in/out mint are identical`);

  const swapGlobalData = await load(SWAP_GLOBAL_ID);
  if (swapGlobalData === null) throw new Error(`${SLUG}: SwapGlobal ${SWAP_GLOBAL_ID} not found`);
  const { extensions } = decodeSwapGlobal(swapGlobalData);

  const fromEntry = extensions.find((e) => e.mint === pair.inMint);
  const toEntry = extensions.find((e) => e.mint === pair.outMint);
  if (fromEntry === undefined)
    throw new Error(`${SLUG}: mint ${pair.inMint} is not a whitelisted extension`);
  if (toEntry === undefined)
    throw new Error(`${SLUG}: mint ${pair.outMint} is not a whitelisted extension`);

  const [fromPdas, toPdas] = await Promise.all([
    derivePdas(fromEntry.programId, M_MINT, M_TOKEN_PROGRAM),
    derivePdas(toEntry.programId, M_MINT, M_TOKEN_PROGRAM),
  ]);

  const [fromGlobalData, toGlobalData] = await Promise.all([
    load(fromPdas.global),
    load(toPdas.global),
  ]);
  if (fromGlobalData === null)
    throw new Error(`${SLUG}: from-leg ExtGlobalV2 ${fromPdas.global} not found`);
  if (toGlobalData === null)
    throw new Error(`${SLUG}: to-leg ExtGlobalV2 ${toPdas.global} not found`);
  const fromGlobal = decodeExtGlobal(fromGlobalData);
  const toGlobal = decodeExtGlobal(toGlobalData);

  for (const [leg, g] of [
    ["from", fromGlobal],
    ["to", toGlobal],
  ] as const) {
    if (g.yieldVariant === YIELD_VARIANT_SCALED_UI) {
      throw new Error(
        `${SLUG}: ${leg} leg is a ScaledUi extension — needs a live f64 index this recipe's integer-only interpreter cannot reproduce exactly (see module doc)`,
      );
    }
    if (!g.wrapAuthorities.some((a) => a === SWAP_GLOBAL_ID)) {
      throw new Error(
        `${SLUG}: ${leg} leg has not whitelisted ${SWAP_GLOBAL_ID} as a wrap authority — this recipe supplies no other signer`,
      );
    }
  }

  return {
    venue: SLUG,
    pool,
    fromMint: pair.inMint,
    toMint: pair.outMint,
    fromProgramId: fromEntry.programId,
    toProgramId: toEntry.programId,
    fromTokenProgram: fromEntry.tokenProgram,
    toTokenProgram: toEntry.tokenProgram,
    fromGlobal: fromPdas.global,
    toGlobal: toPdas.global,
    fromMVaultAuth: fromPdas.mVaultAuth,
    toMVaultAuth: toPdas.mVaultAuth,
    fromMintAuthority: fromPdas.mintAuthority,
    toMintAuthority: toPdas.mintAuthority,
    fromMVault: fromPdas.mVault,
    toMVault: toPdas.mVault,
  };
}

/** The M Swap venue: M0's router that unwraps one M extension token and wraps another. */
export const mswap = {
  slug: SLUG,
  programId: MSWAP_PROGRAM_ID,
  fetchPoolConfig: fetchMSwapPoolConfig,
};
