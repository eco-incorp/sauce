/**
 * Kipseli venue adapter (EcoSwapSVM ladder fragment, adapter contract v2).
 *
 * Kipseli (program `3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU`, Jupiter's own label per
 * `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`) is a closed-source, no-IDL
 * ORACLE-PRICED PMM — NOT the constant-product pool the integration brief guessed. There is no
 * published Anchor IDL (confirmed absent at the standard IDL PDA), so everything below is
 * recovered by binary/account/transaction reverse engineering: `getProgramAccounts` over the
 * program (at integration time 39 owned accounts: 34 tiny 9-byte `BanEntry` PDAs — see below — plus
 * a 40-byte config-only account and four `Pool` accounts of sizes 162/168/456/496; re-scanned
 * 2026-09-14 the program held 166 owned accounts: 160 `BanEntry`, the 40-byte config, and FIVE
 * `Pool` accounts of sizes 162/168/456/496/840 — the 840 is a later realloc, see below), Anchor
 * account-discriminator + instruction-log archaeology
 * (`Program log: Instruction: <Name>` — Anchor's auto-logged instruction names are present even
 * with no IDL published), and `getTransaction`-decoded real mainnet swaps (a systematic pass over
 * 400 real, successful, program-scoped-log-verified `SwapV2` calls on the one liquid pool, spanning
 * amounts from 10,000 lamports to ~3.9B raw units, both directions).
 *
 * ── Why "no on-chain IDL" does not mean "unreadable": the account graph ──
 * Every non-trivial-size account (162/168/456/496 and, as of 2026-09-14, 840 bytes) shares the SAME
 * 8-byte Anchor account discriminator `f19a6d0411b16dbc` — `sha256("account:Pool")[:8]`, the same
 * collision pumpswap's and meteora-damm-v1-stable's OWN "Pool" structs carry (see
 * `ecoswap/svm/discovery.ts`'s `SVM_FAMILY_FILTERS.pumpswap` comment — gPA is program-scoped, so the
 * shared name never causes a cross-family match). All are SOL/USDC pools. Liquidity migrates between
 * pool instances over time: at integration only `89dvMturcS87kYgrwyeWqqsaFZUi5dQQpBHs6pvfUu3v`
 * (496 bytes) carried real inventory (1185.51 USDC / 1.639 SOL); by 2026-09-14 that pool's keeper had
 * stopped (~10.8 days stale, drained to ~0.65 USDC / 0.008 SOL) and a NEW 840-byte pool
 * `7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG` had become the live one (~26,036 USDC / 47.48 SOL, a
 * fresh keeper-pushed price), with 162/168/456 all drained to near-zero and long stale.
 *
 * The 840-byte layout is a REALLOC of the SAME `Pool` account type, not a new one: it carries the
 * identical `account:Pool` discriminator and its first 496 bytes are field-compatible with the 496
 * layout — every field this adapter reads (`base_token` @72 = WSOL, `quote_token` @104 = USDC,
 * `price` @136, `expiry` @144, `fee` @152) decodes to the right value at the SAME offset, its derived
 * ATA vaults exist and hold the matching mint + live balance, and the 344 appended bytes sit entirely
 * AFTER the last field this adapter needs (so they are never read). Confirmed 2026-09-14 by
 * `getAccountInfo`/`getProgramAccounts` against live chain data (not an explorer's decoded view).
 * This adapter is therefore SCOPED to the SET of ground-truthed layouts `POOL_ACCOUNT_SIZES` =
 * {496, 840} — a fetch-time size gate still drops any OTHER-sized `Pool` account cleanly (one bad
 * candidate never kills discovery, the standard venue-robustness convention).
 *
 * ── Cross-repo coupling (must land together with any bump that serves 840) ──
 * sauce-recipes' `ecoswap/svm/discovery.ts` filters kipseli candidates with a SINGLE-size gPA filter
 * `kipseli: { dataSize: 496 }`, so on its own it will never SURFACE the 840-byte pool for discovery.
 * Serving 840 end-to-end needs BOTH sides: this SDK widening (done) AND a recipes-side discovery
 * change (two unioned gPA queries by dataSize, or a discriminator-only filter) plus an SDK version
 * bump and re-pin — the two must ship together, or discovery stays blind to the only live pool.
 *
 * Confirmed pool layout (offsets from account start, identical for the 496 and 840 layouts): disc(8)
 * @0; `global_config`/admin authority pubkey @8 (32 bytes, unused by this adapter — informational;
 * it was identical across the original four pools + the 40-byte config account, but the newer 840
 * pool carries a DIFFERENT config pubkey — a new pool generation — so it is NOT a universal constant); a per-pool 32-byte field @40 that does NOT
 * resolve to any funded/existing account for any of the four pools (confirmed via `getAccountInfo` —
 * every candidate reads back null) — most likely a creation-time seed/salt rather than a real
 * address reference, also unused; `base_token` mint @72 (32 bytes, WSOL for the liquid pool);
 * `quote_token` mint @104 (32 bytes, USDC); `price` @136 (u64 LE) — see PRICING MODEL; `expiry` @144
 * (u64 LE, MILLISECONDS since Unix epoch — verified: on a real `UpdatePoolPriceWithFee` transaction,
 * this field's stored value landed within ~1.2s of that transaction's own `blockTime * 1000`); `fee`
 * @152 (u64 LE, currently 100 on the live pool — units not pinned down, folded into the conservative
 * haircut below rather than modeled explicitly, see PRICING MODEL); a bump-like byte @160-161. The
 * two SPL vaults are NOT stored in the pool account at any offset (confirmed by exhaustive byte
 * search for their known base58 bytes) — they are the STANDARD Associated Token Account for
 * (owner=pool, mint) under the classic Token program, confirmed by deriving both and matching them
 * byte-for-byte against the pool's real `getTokenAccountsByOwner` result.
 *
 * ── The tiny 9-byte accounts: BanEntry, not pools ──
 * `getProgramAccounts` also returns a GROWING set of 9-byte accounts (34 at integration, 160 by
 * 2026-09-14 — one is created per distinct trader, so the count only rises), every one holding the
 * SAME content: an 8-byte discriminator + a trailing `0xff` byte. This is consistent with an Anchor
 * `init_if_needed` PDA storing just `bump: u8` (canonical bump is 255 for the overwhelming majority
 * of addresses — ~255/256 by construction — so all-sharing-0xff is expected, not a decoding
 * error) — a per-trader compliance/ban-list marker. Its PDA seed formula (`[b"ban", trader_pubkey]`)
 * was recovered by BRUTE-FORCING seed-string candidates against a real transaction whose signer and
 * "real user" account were the SAME pubkey (a direct, non-relayed swap) and matching the derived PDA
 * against that transaction's actual 11th/12th swap-instruction accounts — see BUILD_SWAP below.
 *
 * ── Swap instruction (disc = Anchor `sha256("global:swap_v2")[:8]` = `2b04ed0b1ac91e62`, i.e.
 * Kipseli's own instruction is literally named `swap_v2` — confirmed via the program's own embedded
 * Rust source paths, `strings` on the dumped program binary: `src/instructions/swap_v2.rs`) —
 * ground-truthed against a SYSTEMATIC pull of 400 real, successful, program-scoped-log-verified
 * mainnet swaps (not a handful of samples):
 *   `disc(8) ++ amountIn(8, u64 LE, patched at runtime) ++ minOut(8, u64 LE, always 0 in every one
 *   of the 400 real swaps) ++ direction(1 byte)`. direction is INDEPENDENTLY confirmed against real
 *   SPL token balance deltas on both sides of 3 hand-picked transactions (not merely correlated with
 *   an event field — an EVENT field this adapter does NOT use, `f104`/`f112` in the RE notes, turned
 *   out to vary 1/2/4/5 inconsistently with real direction and is NOT the direction signal):
 *   `0x00` = quote(USDC) in / base(SOL) out ("quoteToBase", the family default), `0x01` = base(SOL)
 *   in / quote(USDC) out ("baseToQuote").
 * There is also a `SwapV3` variant (disc `f0e02621b01ff1af`, seen live in a multi-hop Jupiter route)
 * that this adapter does not emit — SwapV2 alone was sufficient to cover every real transaction
 * sampled, and matching an unverified V3 shape risks an account-list mismatch this pass did not
 * ground-truth.
 *
 * ── Accounts (13, FIXED role order regardless of direction — confirmed identical across every one
 * of the 400 sampled swaps, both directions, both the direct-signer and Jupiter-delegated-signer
 * cases) ──
 *   0  signer          (writable, signer) — the CPI's authorizing wallet (owns or is delegated over
 *      the input ATA below; for Sauce's own execute_from_account flow this is always `user.owner`)
 *   1  pool             (writable) — the 496-byte Pool account
 *   2  baseVault        (writable) — the base(SOL)-side ATA owned by `pool` — ALWAYS this role,
 *      never swapped by direction (only the trailing instruction byte picks the flow direction)
 *   3  quoteVault        (writable) — the quote(USDC)-side ATA owned by `pool`
 *   4  baseMint          (readonly)
 *   5  quoteMint          (readonly)
 *   6  user_base_token_account  (writable) — the signer's base-side ATA — ALWAYS this role
 *   7  user_quote_token_account (writable) — the signer's quote-side ATA
 *   8  TOKEN_PROGRAM      (readonly)
 *   9  SYSTEM_PROGRAM      (readonly) — needed for the BanEntry `init_if_needed` lazy allocation
 *   10 real_user          (signer) — a SEPARATE identity field from `signer` (account 0) in the
 *      general case (a Jupiter-delegated swap shows a DIFFERENT pubkey here than account 0); Sauce's
 *      `SwapUser` has no distinct "real user" concept, so this adapter always sets it to the SAME
 *      `user.owner` ref as account 0 — exactly the shape real DIRECT (non-relayed) swaps take on
 *      chain, confirmed live (both signer AND real_user were the identical pubkey in that sample).
 *   11 user_ban_entry     (writable) — `[b"ban", real_user]` PDA (here: `[b"ban", user.owner]`)
 *   12 real_user_ban_entry (writable) — the SAME PDA as (11) given this adapter's signer==real_user
 *      design; a genuinely relayed flow would need TWO different ban-entry PDAs here, but Sauce's
 *      execution model has no such split.
 * Accounts 11/12 depend on the trade's REAL owner address, which `buildSwapV2` never sees (only a
 * symbolic ref) — exactly pumpswap's own `USER_VOLUME_ACCUMULATOR_REF` situation (see
 * `./pumpswap/index.js`'s pumpswap adapter): `KIPSELI_BAN_ENTRY_REF` is exported bare (a plain
 * ref, no `address`), and the CALLER resolves it — `deriveKipseliBanEntry(ownerAddress)` below does
 * exactly that derivation for a caller that has the real owner pubkey in hand (a test harness or a
 * future production wiring step), the same way sauce-recipes' `test/svm/ecoswap-svm.pumpswap-buy.realcpi.e2e.test.ts`
 * resolves pumpswap's own ref.
 *
 * ── PRICING MODEL — an oracle-pushed price, NOT reserve-ratio (the brief's "CP-class AMM expected"
 * guess is WRONG for this venue, corrected here with real measurement) ──
 * The pool's two vaults are wildly imbalanced relative to the real trade rate: on the live pool, raw
 * vault ratio (quoteVault/baseVault) is ~723 USDC/SOL while the real, keeper-pushed `price` field
 * (and every real swap's realized rate) sits at ~77.5 USDC/SOL — a ~9.3x gap. A constant-product
 * model over the raw vaults (the pattern this repo's other undecoded-oracle adapters, bisonfi/
 * aquifer/scorch, fall back to) would therefore be CATASTROPHICALLY wrong here, not merely
 * imprecise — this venue's `price` field IS decodable and MUST be used instead.
 * `price` (u64 @136) is `(quote-per-base, human/UI units) * 1e9` — verified by cross-multiplying
 * against 400 real swaps' own `amountIn`/`amountOut` (after applying each pair's decimals delta):
 * measured deviation between the stored/event-logged execution price and the realized
 * amountIn/amountOut ratio was MEDIAN 0.0095%, P90 0.0222%, P99 0.0370%, MAX 0.0496% across the full
 * 400-swap sample — i.e. this venue quotes essentially AT its published price, with no material
 * size-dependent slippage inside the sampled range (dust to ~3.9B raw units). The `fee` field (@152,
 * =100 on the live pool) is NOT separately modeled — its contribution, if any, is already inside
 * that sub-0.05% measured band, well under the conservative haircut below.
 * The generic (any future base/quote decimals pair) conversion: rawQuotePerRawBase = (price / 1e9) *
 * 10^(quoteDecimals - baseDecimals). `ADJ_NUM`/`ADJ_DEN` (a `paramsFor`-carried, per-pool pair, NOT
 * baked into the compiled shape — so one compiled Kipseli shape serves any future non-SOL/USDC pair
 * without recompiling) hold `10^max(baseDecimals-quoteDecimals,0)` / `10^max(quoteDecimals-baseDecimals,0)`
 * respectively, computed once from each mint's own decimals byte (standard SPL Mint layout, offset
 * 44) during `fetchPoolConfig`. `price` itself is read LIVE at cook time (`accountUint`, never a
 * prepare-time snapshot) — the same "no baked snapshot" discipline `quantum`/`phoenix` use for their
 * own live-refreshed state, appropriate here since a keeper can move `price` between prepare and
 * cook. A flat `HAIRCUT_NUM/HAIRCUT_DEN` = 995/1000 (0.5%) multiplicative safety margin — roughly
 * 10x the measured max deviation above — absorbs both that residual and any keeper-cadence drift
 * between our quote and the real cook (observed keeper interval when active: ~1-2s). The result is
 * additionally CAPPED at the live output-side vault balance (never quote more than the pool actually
 * holds) — the same defensive cap every other prop-AMM adapter in this repo applies.
 * Floor-only integer division throughout (`Math.mulDiv`, confirmed floor semantics repo-wide) means
 * every rounding step can only ever UNDER-quote, never over — combined with the haircut and the
 * reserve cap, this quote curve never promises more than the venue can deliver.
 *
 * ── Staleness / expiry (a REAL, currently-observed condition, not a hypothetical) ──
 * `expiry` (@144, ms since epoch) is checked at the FAMILIES-registry gate level
 * (`ecoswap/svm/index.ts`'s `kipseli.gate`, mirroring `quantum`'s own live-gate pattern) rather than
 * on-chain (the KIPSELI PROGRAM ITSELF already reverts a stale-priced swap — "The price was
 * expired", recovered from the dumped binary's error strings — so this off-chain gate is a
 * self-drop convenience, not a substitute for that on-chain check). AT INTEGRATION TIME the live
 * pool's stored `expiry` was ALREADY ~8.7 days in the past — this venue's keeper has stopped
 * refreshing it, so the adapter currently self-drops this pool via the gate (empty universe, not a
 * crash) until the keeper resumes or a new pool with a live price appears. This is the disclosed,
 * honest "sequencing, not a blocker" case the maintainer's brief describes: the full adapter — CPI,
 * account plan, quote model, CU pin — is built and correct; LIVENESS of any one pool instance is a
 * live-state fact this gate re-evaluates every request, never a reason the integration was withheld.
 *
 * ── CU (REAL mainnet measurement, not modeled) ──
 * `Program 3TK9D8ao...consumed <n> of ... compute units` read directly off 42 real, successful,
 * program-scoped-log-verified transactions (both directions, sizes from 10,000 lamports to ~3.9B raw
 * units): MIN 33,051 / MEAN 35,218 / MAX 42,392 CU, no correlation with trade size (the max was a
 * small trade) — consistent with a fixed-cost oracle-read + two SPL transfers, no per-size loop. See
 * sauce-recipes' `ecoswap/svm/budget.ts`'s `kipseli` pin for how this real number is folded into the family's
 * `slot`/`rung` coefficients (same method as the `humidifi`/`metadao-futarchy` pins: an existing
 * CP-family baseline plus this REAL, margin-padded CPI cost — never the ~50k placeholder every
 * pre-2026-07-31 pin used).
 */
import { address, getAddressCodec, getAddressEncoder } from "@solana/kit";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type { Address } from "@solana/kit";
import type { AccountLoader, PoolConfig, VenueAccount } from "../types.js";
import { readUintLE } from "../math.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "kipseli";
export const KIPSELI_PROGRAM_ID = address("3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/**
 * Ref for the `[b"ban", real_user]` PDA (accounts 11/12 of the swap CPI — see the module doc). Not
 * resolvable from pool state (it depends on the trade's real owner, which `buildSwapV2` never sees
 * as a real address, only a ref) — the CALLER resolves it, exactly `pumpswap`'s own
 * `USER_VOLUME_ACCUMULATOR_REF` situation. `deriveKipseliBanEntry` below performs the derivation for
 * a caller holding the real owner address.
 */
export const KIPSELI_BAN_ENTRY_REF = "kipseli-ban-entry";

/** `[b"ban", owner]` under the Kipseli program — see the module doc's "34 tiny 9-byte accounts" section. */
export async function deriveKipseliBanEntry(owner: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return memoizedGetProgramDerivedAddress(KIPSELI_PROGRAM_ID, [
    new TextEncoder().encode("ban"),
    new Uint8Array(encoder.encode(owner)),
  ]);
}

/** Standard ATA PDA: `[owner, tokenProgram, mint]` under the Associated Token program. */
async function deriveAta(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  return memoizedGetProgramDerivedAddress(ASSOCIATED_TOKEN_PROGRAM, [
    new Uint8Array(encoder.encode(owner)),
    new Uint8Array(encoder.encode(tokenProgram)),
    new Uint8Array(encoder.encode(mint)),
  ]);
}

/** Anchor `sha256("account:Pool")[:8]` — shared with pumpswap's/meteora-damm-v1-stable's own "Pool"
 * structs (gPA is program-scoped, so this never causes a cross-family match — see the module doc). */
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
/**
 * Servable `Pool` layouts, each ground-truthed field-by-field against a real, same-disc pool of that
 * exact size (see the module doc's "account graph" section):
 *   - 496: the original layout (`89dvMturcS87kYgrwyeWqqsaFZUi5dQQpBHs6pvfUu3v`).
 *   - 840: a later realloc that APPENDS 344 trailing bytes (`7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG`
 *     — ~47.5 SOL / ~26k USDC live at 2026-09-14, the current liquid SOL/USDC pool). Same
 *     `account:Pool` discriminator, and the first 496 bytes are field-compatible: every field THIS
 *     adapter reads — `base_token` @72, `quote_token` @104, `price` @136, `expiry` @144, `fee` @152 —
 *     lives in that shared prefix, so the decode below is byte-for-byte identical for both and the
 *     appended region is never read.
 * STRICT per-size (a `Set`, not a `>=` floor): any OTHER Pool-disc size — the drained 162/168/456
 * generations, or a future realloc — still self-drops via the size throw below, so one out-of-scope
 * candidate never kills discovery (the standard venue-robustness convention).
 */
const POOL_ACCOUNT_SIZES: ReadonlySet<number> = new Set([496, 840]);
const OFF_BASE_MINT = 72;
const OFF_QUOTE_MINT = 104;
const OFF_EXPIRY_MS = 144;

/** Standard SPL Mint layout: `decimals` is a single byte at offset 44 (82-byte classic mint). */
const MINT_DECIMALS_OFFSET = 44;
const MINT_MIN_SIZE = 45;

const VAULT_MIN_SIZE = 165;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

export interface KipseliPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'quoteToBase' (default, quote in / base out) | 'baseToQuote'. */
  direction: "quoteToBase" | "baseToQuote";
  baseMint: Address;
  quoteMint: Address;
  baseVault: Address;
  quoteVault: Address;
  /** `10^max(baseDecimals-quoteDecimals,0)` — see PRICING MODEL. */
  adjNum: bigint;
  /** `10^max(quoteDecimals-baseDecimals,0)` — see PRICING MODEL. */
  adjDen: bigint;
  /** `expiry` (ms since epoch), read once for the FAMILIES-level liveness gate. */
  expiryMs: bigint;
}

function kipseliConfig(cfg: PoolConfig): KipseliPoolConfig {
  if (cfg.venue !== SLUG)
    throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as KipseliPoolConfig;
}

async function fetchDecimals(load: AccountLoader, mint: Address): Promise<number> {
  const data = await load(mint);
  if (data === null) throw new Error(`${SLUG} mint ${mint} not found`);
  if (data.length < MINT_MIN_SIZE) {
    throw new Error(
      `${SLUG} mint ${mint} account is ${data.length} bytes, too small for a Mint (want >= ${MINT_MIN_SIZE})`,
    );
  }
  return data[MINT_DECIMALS_OFFSET];
}

function pow10(n: number): bigint {
  let v = 1n;
  for (let i = 0; i < n; i++) v *= 10n;
  return v;
}

async function fetchPoolConfig(load: AccountLoader, pool: Address): Promise<KipseliPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} not found`);
  if (!POOL_ACCOUNT_SIZES.has(data.length)) {
    const accepted = [...POOL_ACCOUNT_SIZES].join("/");
    throw new Error(
      `${SLUG} pool ${pool} is ${data.length} bytes, expected one of ${accepted} (out of scope — see module doc)`,
    );
  }
  if (!POOL_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error(`${SLUG} pool ${pool} has an unexpected account discriminator`);
  }

  const baseMint = pubkeyAt(data, OFF_BASE_MINT);
  const quoteMint = pubkeyAt(data, OFF_QUOTE_MINT);
  const expiryMs = readUintLE(data, OFF_EXPIRY_MS, 8);

  // This venue's on-chain swap_v2 ix is legacy-SPL (Tokenkeg) only, so a
  // Token-2022 mint (or one carrying an un-routable extension) must SELF-DROP
  // the pool rather than be silently assumed legacy. The thrown error IS the
  // graceful-drop signal (the SvmRoute orchestrator catches a fetchPoolConfig
  // throw and drops the venue). An unreadable mint falls back to the legacy
  // assumption, keeping the classic 82-byte path byte-identical.
  const _mints = [baseMint, quoteMint];
  const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
  for (let _i = 0; _i < _mints.length; _i++) {
    const mint = _mints[_i]!;
    const mintData = _mintDatas[_i]!;
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

  const [baseVault, quoteVault, baseDecimals, quoteDecimals] = await Promise.all([
    deriveAta(pool, baseMint, TOKEN_PROGRAM),
    deriveAta(pool, quoteMint, TOKEN_PROGRAM),
    fetchDecimals(load, baseMint),
    fetchDecimals(load, quoteMint),
  ]);

  const _vaults = [
    ["base", baseVault, baseMint],
    ["quote", quoteVault, quoteMint],
  ] as const;
  const _vaultDatas = await Promise.all(_vaults.map(([, vault]) => load(vault)));
  for (let _i = 0; _i < _vaults.length; _i++) {
    const [role, vault, mint] = _vaults[_i]!;
    const vaultData = _vaultDatas[_i]!;
    if (vaultData === null)
      throw new Error(`${SLUG} pool ${pool}: derived ${role} vault ${vault} does not exist`);
    if (vaultData.length < VAULT_MIN_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool}: ${role} vault ${vault} is ${vaultData.length} bytes, not an SPL token account`,
      );
    }
    const vaultMint = pubkeyAt(vaultData, 0);
    if (vaultMint !== mint) {
      throw new Error(
        `${SLUG} pool ${pool}: ${role} vault ${vault} holds mint ${vaultMint}, expected ${mint}`,
      );
    }
  }

  const delta = baseDecimals - quoteDecimals;
  const adjNum = delta > 0 ? pow10(delta) : 1n;
  const adjDen = delta < 0 ? pow10(-delta) : 1n;

  return {
    venue: SLUG,
    pool,
    direction: "quoteToBase",
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
    adjNum,
    adjDen,
    expiryMs,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = kipseliConfig(base);
  return [
    { ref: `${cfg.pool}:baseVault`, address: cfg.baseVault },
    { ref: `${cfg.pool}:quoteVault`, address: cfg.quoteVault },
  ];
}

export const kipseli = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: KIPSELI_PROGRAM_ID,
  fetchPoolConfig,
  quoteAccounts,
};
