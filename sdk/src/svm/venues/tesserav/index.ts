/**
 * TesseraV venue adapter (program `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`)
 * — a closed-source prop-AMM. No on-chain IDL / published SDK exists, so this
 * adapter is built from a live-mainnet reverse-engineering pass (real
 * `getAccountInfo`/`getTransaction` reads, a `solana program dump`, and
 * LiteSVM replays of the deployed binary against cloned mainnet state — see
 * ./ladder.ts's header for the exact evidence and the honest exactness
 * caveat).
 *
 * ACCOUNT SHAPE (pool `FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n`, the live
 * SOL/USDC market, 1264 bytes, confirmed stable across multiple live
 * snapshots on 2026-07-31):
 *
 *   24   mintA   32B          56   mintB   32B
 *   120  lastUpdateSlot  u64 LE (matches the live cluster slot at every
 *        snapshot taken — an off-chain maker bot rewrites the ladder on a
 *        near-continuous cadence, confirmed by a separate direct top-level
 *        instruction to this program carrying an ~700-byte opaque payload and
 *        touching only 2 accounts, 408-412 CU, no logs — an oracle/ladder
 *        PUSH, not a swap)
 *   144  mid           u64 LE, scaled 1e15: `mid = round(1e15 * A_raw_per_B_raw)`
 *        — i.e. mid/1e15 is mintA-raw-units per mintB-raw-unit. Empirically
 *        matched: 1e15/mid ≈ the measured wSOL→USDC raw exchange rate to
 *        within ~0.03-0.1% across independently fetched snapshots (the
 *        residual is consistent with real price drift between fetches, not a
 *        derivation error — see ladder.ts).
 *   168  ladder A→B (sell mintA, buy mintB): 10 populated slots, stride 24:
 *          +0 price (ppm of 1e6, non-increasing across slots)
 *          +8 flag (observed constant 1 — kind/liveness marker, unmodeled)
 *          +16 cum (OUTPUT=mintB raw units for this level)
 *        then zero-padded slots (a 0-price slot terminates the walkable
 *        prefix, same convention this SDK already uses for quantum/manifest).
 *   640  ladder B→A (sell mintB, buy mintA), same 10-slot/24-byte-stride
 *        shape but fields REORDERED: +0 cum (OUTPUT=mintA raw units), +8
 *        price (ppm — numerically IDENTICAL to the A→B slot at the same
 *        index, confirmed byte-for-byte on every snapshot taken), +16 flag.
 *
 * This adapter ships ONLY the best (index-0) slot of whichever direction is
 * requested — see ladder.ts's header for why a single-slot model is the
 * correct, conservative MVP here (level-0 capacity dwarfed every size this
 * pass could test, up to 100 SOL notional, with no measurable curve
 * degradation) and the plan to extend to the full 10-slot walk.
 *
 * SWAP CPI — the mainnet program was UPGRADED (deployed binary sha256
 * `82fd37995fcece47a253b1a00c1dd7e4c3fff706b2e42384110e2cbabf4201b3`) and the
 * swap ix changed shape. VERIFIED FIRST-HAND 2026-09-11 against the live
 * program: a fresh LANDING swap (sig `3ViRTJm9…`, cbBTC/USDC pool) decodes to
 * tag 0x11 + 14 accounts, and the three APPENDED accounts are byte-identical
 * across 25 landing swaps on 3 distinct pools (SOL/USDC `FLckH…`, `Ce8W…`,
 * `7sJf…`), all read-only.
 *   ix data:  tag(1B)=0x11 ++ direction(1B, 1=A→B / 0=B→A) ++
 *             amountIn(u64 LE) ++ minOut(u64 LE)      [ARG LAYOUT UNCHANGED]
 *   accounts (14): [auth, pool(w), owner(signer), vaultA(w), vaultB(w),
 *              userSrcAta(w), userDstAta(w), mintA, mintB, tokenProgram,
 *              tokenProgram (again — an unused Token-2022 slot on this pool),
 *              <TESSERAV_SWAP_GLOBAL_ACCOUNTS[0..2] — 3 global read-only accts>]
 *   DELTA vs the pre-upgrade wire: the trailing Instructions-sysvar account is
 *   DROPPED, three global read-only accounts are APPENDED, and the tag byte is
 *   0x10 -> 0x11 (12 -> 14 accounts). The old 0x10/12-account wire now fails
 *   on-chain with `InstructionError { NotEnoughAccountKeys }`.
 *
 *   The SDK does NOT emit this account list — it decodes the pool and produces
 *   `TesseraVPoolConfig`; the 14-account CPI is assembled DOWNSTREAM (the
 *   consuming recipes package's `buildSwapV2`) from these config fields plus
 *   `TESSERAV_SWAP_TAG` / `TESSERAV_SWAP_GLOBAL_ACCOUNTS` below.
 *
 * INTROSPECTION IS NOT A CALLER ALLOWLIST (measured, not assumed). Calling
 * this instruction as the transaction's OUTERMOST instruction reverts (custom
 * 0xffff / 0x5, ~34-37k CU, size-independent — an early guard). Calling it as
 * a CPI from a real Jupiter `route` succeeds; calling it as a CPI from a
 * freshly-generated, never-before-seen program id (a from-scratch native
 * passthrough, deployed nowhere) ALSO succeeds (verified: 46,908 CU, real
 * output credited). So the Instructions-sysvar read gates "must be CPI'd, not
 * top-level" only — the SAME shape as this SDK's own engine (`execute_from_
 * account` always CPIs a venue swap, never top-level) — NOT a caller
 * allowlist like Quantum's (see quantum/index.ts's own "hardcoded list of 15
 * aggregator ids" finding — a DIFFERENT, and stricter, gate that TesseraV
 * does not share). Confirm this holds on every re-verification pass; it is
 * the load-bearing fact that makes this venue buildable at all.
 *
 * UPGRADE NOTE (2026-09-11): the upgraded swap ix NO LONGER carries the
 * Instructions sysvar in its account list (see the SWAP CPI note above — it was
 * dropped when the 3 global accounts were appended). The 25 landing swaps
 * inspected in this pass are all CPIs and all succeeded, so the CPI-only
 * behavior still holds empirically; the exact mechanism the upgraded program
 * uses for that gate (without the sysvar in the swap ix) was not re-derived.
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { memoizedFindAssociatedTokenPda } from "../pda-memo.js";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "tesserav";

export const TESSERAV_PROGRAM_ID = address("TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH");
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
// The Instructions sysvar constant is shared via ../../cpi-probe.js (already
// barreled at the top svm/index.ts level) — NOT re-declared/re-exported here,
// to avoid a duplicate-export collision at the package barrel (see ladder.ts).

const OFF_MINT_A = 24;
const OFF_MINT_B = 56;
export const OFF_MID = 144;
export const MID_SCALE = 1_000_000_000_000_000n; // 1e15

// A->B ladder (sell mintA for mintB): stride 24, fields (price, flag, cum).
export const OFF_LADDER_AB = 168;
export const AB_STRIDE = 24;
export const AB_OFF_PRICE = 0;
export const AB_OFF_CUM = 16;

// B->A ladder (sell mintB for mintA): stride 24, fields (cum, price, flag).
export const OFF_LADDER_BA = 640;
export const BA_STRIDE = 24;
export const BA_OFF_CUM = 0;
export const BA_OFF_PRICE = 8;

export const TESSERAV_LEVEL_SLOTS = 10;
export const PRICE_PPM_DEN = 1_000_000n;

/** Minimum pool account size this adapter reads from (level 9's last byte + 1). */
export const TESSERAV_MIN_POOL_SIZE = OFF_LADDER_BA + TESSERAV_LEVEL_SLOTS * BA_STRIDE;

export interface TesseraVPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 'aToB' sells mintA for mintB (ix direction byte 1); 'bToA' is the reverse (byte 0). */
  direction: "aToB" | "bToA";
  mintA: Address;
  mintB: Address;
  /**
   * The program's GLOBAL vault-authority singleton (TESSERAV_GLOBAL_AUTH) —
   * read-only in the swap ix. NOT a per-pool fact and NOT a PDA/registry (see
   * TESSERAV_GLOBAL_AUTH's doc).
   */
  auth: Address;
  /** Global-per-mint vault for mintA (authority = auth). */
  vaultA: Address;
  /** Global-per-mint vault for mintB (authority = auth). */
  vaultB: Address;
  /**
   * The three GLOBAL read-only accounts the upgraded swap ix appends at wire
   * positions [11], [12], [13] — always `TESSERAV_SWAP_GLOBAL_ACCOUNTS` (a
   * program-global trio, not per-pool; see that constant's doc). Carried on the
   * config so the downstream CPI builder gets the FULL account set from here —
   * they were not derivable downstream, which is why they live in the SDK.
   */
  swapGlobalAccounts: readonly Address[];
}

/**
 * The TesseraV vault-AUTHORITY — a FIXED GLOBAL SINGLETON, correcting the
 * earlier "per-pool fact" framing. It is one program-owned (owner =
 * TessVdML…), 10240-byte account that is byte-identical as the swap CPI's
 * account[0] across every pool traced (SOL/USDC, cbBTC/USDC, BONK/USDC). It is
 * NOT a PDA of the program under any tried seed, and NOT a mint→vault registry
 * (the 10240 bytes contain none of the mint or vault bytes) — so it is carried
 * as this verified constant, never derived. Verified against live swap-CPI
 * traces (SOL/USDC sig 3p2JFpLN…, cbBTC/USDC sig 4KZPEcyC…, BONK/USDC sig
 * 3JZMZyMy…), all giving account[0] = 8ekCy2….
 */
export const TESSERAV_GLOBAL_AUTH = address("8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF");

/**
 * The swap instruction discriminator. The mainnet upgrade bumped it 0x10 ->
 * 0x11 (see the SWAP CPI note in this file's header); a program compiled to the
 * old 0x10 tag now reverts. Exported so the downstream CPI builder reads the tag
 * from one place rather than hardcoding it.
 */
export const TESSERAV_SWAP_TAG = 0x11;

/**
 * The three GLOBAL read-only accounts the upgraded swap ix (tag 0x11) APPENDS
 * after the two token-program slots — wire positions [11], [12], [13]. ORDER IS
 * LOAD-BEARING.
 *
 * These are program GLOBALS, not per-pool PDAs, and are carried as verified
 * CONSTANTS for exactly the reason TESSERAV_GLOBAL_AUTH is: they were BYTE-
 * IDENTICAL across 25 landing swaps on 3 distinct pools (SOL/USDC `FLckH…`,
 * `Ce8W…`, `7sJf…`) on 2026-09-11, all read-only — so there is nothing per-pool
 * to derive. (Deriving a per-pool PDA here would be WRONG: the chain shows one
 * fixed trio for every pool.) There is no on-chain IDL (closed-source), so the
 * names below are ROLES INFERRED from each account's on-chain owner/size, not
 * asserted semantics — re-verify on any re-capture:
 *   [0] 8xeaWCsJ…tb3d — owner = System Program, 0 bytes  → global authority/holder
 *   [1] BAT1Ndpu…vdhK — owner = TessVdML… (the program), 2048 bytes → global config/state
 *   [2] 4cG31VNF…brhPs — owner = tickUcs…ULWY6N (a tick/oracle program), 88 bytes → global oracle/tick
 * Verified against landing swap sig `3ViRTJm9…` (positions 11-13).
 */
export const TESSERAV_SWAP_GLOBAL_ACCOUNTS: readonly Address[] = Object.freeze([
  address("8xeaWCsJYxRoudEZGJWURdfrtFhLYZz9b4iHJnW5tb3d"),
  address("BAT1Ndpu5gbLTp2AZkSXP79LJBZfCH4B3zGhi6LtvdhK"),
  address("4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs"),
]);

/**
 * Committed global-per-mint vault cache. Each TesseraV vault is a plain
 * keypair-generated legacy-SPL token account that is (a) authority =
 * TESSERAV_GLOBAL_AUTH and (b) GLOBAL PER MINT — one shared vault per token,
 * reused by every pool touching that token (measured: the SOL/USDC and
 * cbBTC/USDC pools share the SAME USDC vault 9t4P5w…). Vaults are stable, so
 * this map is the RPC-free fast path; a mint NOT here resolves through the
 * optional `resolveVault` (getTokenAccountsByOwner) arg of fetchTesseraVConfig
 * — which `pickTesseraVVault` implements — or self-drops. Refresh this map with
 * that same owner-scoped sweep, keyed off TESSERAV_GLOBAL_AUTH. Only vaults
 * verified byte-exactly against a live swap-CPI trace are seeded here.
 */
export const TESSERAV_KNOWN_VAULTS: Readonly<Record<string, Address>> = Object.freeze({
  // wSOL — verified as swap account[3] of the SOL/USDC pool (sig 3p2JFpLN…)
  So11111111111111111111111111111111111111112: address(
    "5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV",
  ),
  // USDC — the single global USDC vault (swap account[4] of both SOL/USDC and cbBTC/USDC)
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: address(
    "9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx",
  ),
  // cbBTC — verified as swap account[3] of the cbBTC/USDC pool (sig 4KZPEcyC…)
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: address(
    "37hggNyT4Ec8GEcxMLrWrZyrMSSFMSiFT6VBayRYceZH",
  ),
});

/**
 * One legacy-SPL token account owned by an authority, as returned by an RPC
 * `getTokenAccountsByOwner(owner, { mint })`. `amount` (the u64 token balance)
 * is optional and consulted ONLY to break a >1 ambiguity (largest wins).
 */
export interface TesseraVOwnedTokenAccount {
  address: Address;
  amount?: bigint;
}

/**
 * Resolver for a global-per-mint TesseraV vault: given the authority and a
 * mint, return the vault address, or null to self-drop when no vault exists
 * yet. A real caller backs this with an RPC
 * `getTokenAccountsByOwner(owner, { mint })` fed through `pickTesseraVVault`.
 * Threaded into fetchTesseraVConfig because the single-account AccountLoader
 * cannot express an owner-scoped scan.
 */
export type TesseraVVaultResolver = (owner: Address, mint: Address) => Promise<Address | null>;

/**
 * Exclude-ATA vault picker — the GENERAL derivation core. Of the legacy-SPL
 * token accounts owned by `owner` for `mint`, drop the canonical
 * ATA(owner, mint, TOKEN_PROGRAM) (observed as a dust account for USDC: the
 * real vault 9t4P5w… alongside its ATA at ~50000) and return the single
 * remainder. 0 remainders → null (the global vault does not exist yet →
 * self-drop). >1 remainders → the largest-balance one when balances are known,
 * else null (ambiguous → self-drop rather than guess) — the caveat the debug
 * flagged for the >1 case.
 */
export async function pickTesseraVVault(
  owner: Address,
  mint: Address,
  owned: readonly TesseraVOwnedTokenAccount[],
): Promise<Address | null> {
  const ata = await memoizedFindAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM });
  const nonAta = owned.filter((account) => account.address !== ata);
  if (nonAta.length === 0) return null;
  if (nonAta.length === 1) return nonAta[0]!.address;
  // >1 non-ATA auth-owned account for this mint: prefer the largest balance
  // when every candidate's balance is known (the real vault dwarfs any dust),
  // otherwise self-drop rather than route funds to the wrong account.
  if (nonAta.every((account) => account.amount !== undefined)) {
    return nonAta.reduce((best, account) => (account.amount! > best.amount! ? account : best))
      .address;
  }
  return null;
}

/**
 * Resolve one side's vault: committed cache first (RPC-free, stable), then the
 * optional owner-scoped resolver, else a graceful self-drop. Always under
 * TESSERAV_GLOBAL_AUTH — vaults are global per mint, never per pool.
 */
async function resolveTesseraVVault(
  mint: Address,
  resolveVault: TesseraVVaultResolver | undefined,
  pool: Address,
): Promise<Address> {
  const cached = TESSERAV_KNOWN_VAULTS[mint];
  if (cached) return cached;
  if (resolveVault) {
    const resolved = await resolveVault(TESSERAV_GLOBAL_AUTH, mint);
    if (resolved) return resolved;
    throw new Error(
      `${SLUG}: dropping pool ${pool} — no auth-owned vault for mint ${mint} ` +
        `(getTokenAccountsByOwner(${TESSERAV_GLOBAL_AUTH}, ${mint}) yielded no unambiguous non-ATA account)`,
    );
  }
  throw new Error(
    `${SLUG}: dropping pool ${pool} — mint ${mint} is not in the committed vault cache and no ` +
      `resolveVault (getTokenAccountsByOwner) was provided`,
  );
}

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/** Level-0 price (ppm of 1e6) for a direction — non-increasing across slots, this adapter ships slot 0 only. */
export function level0PriceOffset(direction: "aToB" | "bToA"): number {
  return direction === "aToB" ? OFF_LADDER_AB + AB_OFF_PRICE : OFF_LADDER_BA + BA_OFF_PRICE;
}

/** Level-0 capacity, in OUTPUT-token raw units, for a direction. */
export function level0CumOffset(direction: "aToB" | "bToA"): number {
  return direction === "aToB" ? OFF_LADDER_AB + AB_OFF_CUM : OFF_LADDER_BA + BA_OFF_CUM;
}

/**
 * Fetch + gate one TesseraV pool. Read-only against the loader. Gates: wrong
 * owner/size, an unprimed mid (0 — a pool the maker bot has never quoted),
 * and a zero/absent level-0 price or capacity (an empty book for this
 * direction — self-drop, not a revert, at the orchestrator layer).
 */
export async function fetchTesseraVConfig(
  load: AccountLoader,
  pool: Address,
  direction: "aToB" | "bToA",
  resolveVault?: TesseraVVaultResolver,
): Promise<TesseraVPoolConfig> {
  if (direction === "bToA") {
    // See ladder.ts's header: the reverse swap-CPI account order was never
    // independently verified, and a launched-then-failing CPI aborts the
    // WHOLE cook on SVM (no execution-time catch/re-route here) — so this
    // stays a hard gate, not a self-drop, until a second live replay confirms
    // the shape.
    throw new Error(
      `${SLUG}: 'bToA' is unverified (see ladder.ts) and is not wired for production use yet`,
    );
  }
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length < TESSERAV_MIN_POOL_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} has ${data.length} bytes, expected at least ${TESSERAV_MIN_POOL_SIZE}`,
    );
  }
  const mid = readUintLE(data, OFF_MID, 8);
  if (mid === 0n)
    throw new Error(`${SLUG}: pool ${pool} has an unprimed mid price (never quoted by the maker)`);
  const price0 = readUintLE(data, level0PriceOffset(direction), 8);
  const cum0 = readUintLE(data, level0CumOffset(direction), 8);
  if (price0 === 0n || cum0 === 0n) {
    throw new Error(`${SLUG}: pool ${pool} has no walkable level-0 for direction ${direction}`);
  }

  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);
  // The swap CPI carries an unused Token-2022 slot but the instruction is
  // legacy-SPL (Tokenkeg) only. Detect a Token-2022 (or otherwise un-routable)
  // mint per side and GRACEFULLY SELF-DROP the pool (the SvmRoute orchestrator
  // catches a fetchPoolConfig throw and drops the venue). The LEGACY path is
  // byte-identical; an unreadable mint falls back to the legacy assumption.
  const _mints = [mintA, mintB];
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

  // auth is the GLOBAL singleton (not per-pool); each vault is GLOBAL PER MINT
  // and lives on the swap CPI's account list, NOT inline in the pool account,
  // so it is resolved from the committed per-mint cache (RPC-free) or, for a
  // mint not yet cached, the owner-scoped `resolveVault` (getTokenAccountsByOwner
  // + exclude-ATA, see pickTesseraVVault). A mint with neither a cache hit nor a
  // resolver-found vault self-drops the pool (a graceful "dropping pool" throw
  // the SvmRoute orchestrator catches), rather than the old FLckH-only hard gate.
  const vaultA = await resolveTesseraVVault(mintA, resolveVault, pool);
  const vaultB = await resolveTesseraVVault(mintB, resolveVault, pool);

  return {
    venue: SLUG,
    pool,
    direction,
    mintA,
    mintB,
    auth: TESSERAV_GLOBAL_AUTH,
    vaultA,
    vaultB,
    swapGlobalAccounts: TESSERAV_SWAP_GLOBAL_ACCOUNTS,
  };
}

/** Family facade for the recipe orchestrator (ladder-only — not in the v1 registry). */
export const tesserav = {
  slug: SLUG,
  programId: TESSERAV_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchTesseraVConfig,
};
