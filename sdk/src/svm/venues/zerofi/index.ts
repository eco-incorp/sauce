/**
 * ZeroFi venue adapter (program ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY) —
 * a closed-source, oracle-priced PMM ("prop AMM", tier P-A). No IDL, no docs:
 * every field below was recovered by dumping the deployed program (ProgramData
 * ELF, 425,485 bytes; disassembled with capstone's BPF backend), sampling real
 * mainnet `swap_v4` transactions (getTransaction, `preTokenBalances`/
 * `postTokenBalances` for the vault deltas), and cross-referencing the
 * decoded pool bytes against those deltas.
 *
 * QUOTE MODEL (measured, not assumed): the realized swap price tracks a
 * SEPARATE oracle account's live mid almost exactly, with NO detectable
 * curvature across a ~1000x input range —
 *
 *   - JUP/USDC (oracle CsyasUrpePHQAJeQHMytaTbyxEag8FCuCBiQKQvBc3GV): 7 real
 *     landed swaps, amountIn 245,414..262,787,635 (raw USDC, 6dp) all priced
 *     within 5.2156..5.2160 JUP/USDC (0.08% band, consistent with ordinary
 *     price drift across the ~15 minutes the sample spans, not size).
 *   - BONK/USDC (oracle BhDYyPxERMSyhNtVNNGN4eSqzMcBmT2ySi3FhrLXFSVs): a
 *     6-BONK dust fill cross-checked the SAME oracle-mid convention.
 *   - Fresh `simulateTransaction` re-quotes (sigVerify:false, impersonating
 *     the aggregator's own registered authority — see AUTHORITY below) at
 *     3 sizes EACH spanning ~600x (JUP/USDC: 500,000 / 25,000,000 /
 *     300,000,000 raw USDC) and ~5000x (BONK/USDC: 10,000,000 /
 *     1,000,000,000 / 50,000,000,000 raw BONK) against LIVE mainnet state
 *     reproduce a FLAT realized-price ratio to the oracle mid: 0.99872,
 *     0.99872, 0.99924 (JUP/USDC) and 0.99558, 0.99562, 0.99564 (BONK/USDC) —
 *     i.e. a per-pool, per-direction fee/spread the ladder charges as
 *     `feePpm`, ROUNDED UP from the measured value so predicted <= realized
 *     (one-sided safe for minOut, the obric-v2/solfi-v2 convention).
 *
 * The oracle (owner W1LDCARDa67SPBG7TFpQivHnEZXRtxCFP13ysEd1bWR, "Wildcard")
 * stores price as a plain IEEE-754 f64 LE at PRICE_OFFSET — verified by
 * decoding that word on two independent live feeds and matching both the
 * JUP/USDC and BONK/USDC measured ratios above to within ordinary drift.
 * ladder.ts decodes it ON-CHAIN with pure integer ops (no float unit assumed
 * in the VM): extract the exponent/mantissa by shift+mask, gate the slot to
 * 0 if the live exponent has drifted off the PREPARE-TIME baked value (the
 * fast path degenerates to a coarse staleness/sanity check — an overflow-
 * class repricing self-drops the slot rather than misquoting it), then scale
 * the 53-bit mantissa by a prepare-time-reduced (num, den) rational that
 * folds the 2^exponent term and the mintA/mintB decimals difference.
 *
 * POOL ACCOUNT LAYOUT (the `pool` fetchPoolConfig takes — 38,176 bytes,
 * owner == PROGRAM_ID; ground-truthed IDENTICALLY on both sampled pools):
 *   +72   mintA (32B)         +104  mintB (32B)
 *   +136  vaultA (32B, SPL)   +168  companionA (32B, ZeroFi-owned, 1072B)
 *   +200  vaultB (32B, SPL)   +232  companionB (32B, ZeroFi-owned, 1072B)
 *   +2184 oracle (32B, Wildcard-owned, 128B)
 * mintA/mintB/oracle are FIXED regardless of swap direction; the
 * (companion, vault) PAIR at {168,136} vs {232,200} swaps roles with
 * direction (mintA-in uses vaultA as the deposit vault; mintB-in uses
 * vaultB) — confirmed on the BONK/USDC pool in both directions.
 * `companionA`/`companionB` are ZeroFi-owned 1072-byte accounts whose fields
 * are NOT decoded by this adapter (undecoded, but real, live-owned
 * accounts — required by the CPI, not read for the quote).
 *
 * SWAP INSTRUCTION ("swap_v4", disc byte 0x10 — a single-byte opcode, not an
 * 8-byte Anchor sighash): `[0x10] ++ amountIn u64 LE ++ minOut u64 LE` (17
 * bytes). 14 accounts, order fixed regardless of direction except the
 * (companion, vault) swap noted above:
 *   0 pool  1 oracle  2 companionIn  3 vaultIn  4 companionOut  5 vaultOut
 *   6 authorityAtaB  7 authorityAtaA  8 AUTHORITY (signer)  9 tokenProgramA
 *   10 mintA  11 tokenProgramB  12 mintB  13 Sysvar Instructions
 *
 * ACCOUNTS 6/7 ("authorityAtaB"/"authorityAtaA"): decoded directly off a
 * real landed transaction AND confirmed by a controlled standalone
 * `simulateTransaction` (this adapter's ONLY instruction, no aggregator
 * wrapper, at 25,000,000 raw USDC in): both are ordinary SPL token
 * accounts (165 bytes) whose `owner` field (bytes 32..64) equals the
 * pubkey riding slot 8 exactly. THE REAL FUND FLOW, measured directly:
 * authorityAtaB (USDC) DEBITS exactly amountIn, vaultA/vaultB-side
 * CREDITS it (the pool-vault "vaultIn" in the module's earlier framing);
 * the pool's vaultOut DEBITS the realized output, authorityAtaA (JUP)
 * CREDITS exactly that amount — the authority's JUP balance in this probe
 * started at ZERO and still received the fill correctly, so slots 6/7 are
 * NOT a pre-funded capital reserve the authority must carry; they are a
 * REQUIRED, registered SIGNING/SETTLEMENT relay the swap moves value
 * through (existence + registration required, not standing inventory).
 * There is no slot anywhere in the 14 for an arbitrary, unregistered
 * caller's own token account — this is NOT a normal permissionless
 * flash-swap shape, it settles ONLY through a registered authority's own
 * accounts. One larger sampled BONK/USDC transaction moved a DIFFERENT
 * pair of accounts at these same two slots (a distinct registered
 * authority) alongside its own pool vaults, consistent with this reading:
 * whichever authority signs owns whichever pair rides slots 6/7.
 *
 * ACCOUNT 8 ("AUTHORITY", signer, not writable): validated live by flipping
 * signer-ness account-by-account against a `simulateTransaction`
 * (sigVerify:false) replay of a real historical swap — see ladder.ts's
 * module doc for the exact probe. Result: idx 8 must be a SPECIFIC
 * account (the routing aggregator's own PDA in every sampled transaction,
 * owner T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT in the JUP/USDC sample);
 * substituting an unrelated signer FAILS DETERMINISTICALLY (custom program
 * error 4, reproduced 3/3), while the real aggregator PDA succeeds
 * DETERMINISTICALLY (5/5). Combined with the slots-6/7-are-its-own-ATAs
 * finding above, this reads as a per-integrator registration (a real
 * market-maker/authority relationship ZeroFi's program checks), not a bare
 * "any signer" guard — an access-control + inventory gap, not a math gap.
 * `fetchPoolConfig` REFUSES (throws) a pool without a registered authority
 * rather than wiring an address guaranteed to fail on-chain — the
 * deployment must populate ZEROFI_POOL_AUTHORITY once registered with
 * ZeroFi, exactly the shape of the Quantum aggregator-whitelist gap this
 * venue set already builds past.
 *
 * FEE CATALOG: keyed by POOL (not guessed, not interpolated) — see
 * ZEROFI_POOL_FEE_PPM. A pool absent from the catalog THROWS at
 * fetchPoolConfig (refuse, don't guess — the solfi-v2 POOL_K precedent).
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import type { AccountLoader, PoolConfig, SwapUser, VenueAccount, VenueSwap } from "../types.js";
import { INSTRUCTIONS_SYSVAR } from "../../cpi-probe.js";
import { ieee754ScaleParams } from "./ieee754.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "zerofi";
export const ZEROFI_PROGRAM_ID = address("ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export const POOL_ACCOUNT_SIZE = 38_176;
export const ORACLE_ACCOUNT_SIZE = 128;

// Pool account layout (see module doc — ground-truthed on 2 live pools).
export const OFF_MINT_A = 72;
export const OFF_MINT_B = 104;
export const OFF_VAULT_A = 136;
export const OFF_COMPANION_A = 168;
export const OFF_VAULT_B = 200;
export const OFF_COMPANION_B = 232;
export const OFF_ORACLE = 2184;

/** IEEE-754 f64 LE price word inside the oracle account (mintB per whole mintA). */
export const PRICE_OFFSET = 0x30;

/** `swap_v4`'s single-byte discriminator (NOT an 8-byte Anchor sighash). */
export const ZEROFI_SWAP_DISCRIMINATOR = 0x10;

const codec = getAddressCodec();
const pubkeyAt = (data: Uint8Array, offset: number): Address =>
  codec.decode(data.subarray(offset, offset + 32));

/**
 * Per-pool, per-direction fee/spread the ladder charges against the raw
 * oracle mid, in parts-per-million, ROUNDED UP from the measured realized
 * ratio (see module doc) so a predicted quote never exceeds the real fill —
 * REFUSE (fetchPoolConfig throws), don't guess, for any pool not listed
 * here. Keyed by pool account address (the 38,176-byte account), matching
 * solfi-v2's POOL_K precedent: a pool is never assumed to share its
 * neighbor's fee.
 */
export const ZEROFI_POOL_FEE_PPM: Readonly<Record<string, bigint>> = {
  // JUP/USDC — measured realized/oracle-mid ratio 0.998723 (worst of 3 fresh
  // simulateTransaction sizes: 500,000 / 25,000,000 / 300,000,000 raw USDC,
  // 2026-07-31). 1 - 0.998723 = 1277ppm; rounded up to 1300ppm for margin.
  Et6HnPjetV8AzmxNAfzKJ6ax5VM82ZB7phY465Ns5iZW: 1_300n,
  // BONK/USDC — measured realized/oracle-mid ratio 0.995581..0.995641 across
  // 3 fresh sizes (10,000,000 / 1,000,000,000 / 50,000,000,000 raw BONK,
  // 2026-07-31). Worst (smallest) ratio 0.995581 -> 4419ppm; rounded up to
  // 4500ppm for margin.
  "5Dp922oSaj9rdLHTxZzq1B7QV7KmwY7U7K1JNCRhc45J": 4_500n,
};

/**
 * The registered authority + its own token-account pair, per pool — see the
 * module doc's "ACCOUNT 8" note. UNCONFIGURED BY DEFAULT: there is no
 * synthesizable value (a bare PDA does not satisfy the live program's
 * check, see the module doc), so `fetchPoolConfig` throws for any pool
 * without an entry here rather than wiring an address guaranteed to fail
 * on-chain. Populate this once ZeroFi (or whatever registry backs the
 * check) recognizes this deployment's own authority.
 */
export const ZEROFI_POOL_AUTHORITY: Readonly<
  Record<string, { authority: Address; authorityAtaA: Address; authorityAtaB: Address }>
> = {};

/**
 * Conservative quotable-capacity divisor: the ladder never quotes more than
 * `liveReserveOut / CAP_DIVISOR` output (see ladder.ts). 20 == 5% of the
 * live output vault. This is NOT a measured venue depth limit (the true
 * capacity model is unresolved — see the module doc's "ACCOUNTS 6/7" note);
 * it is a deliberately-conservative ceiling picked so that every measured
 * real fill in this integration's sample (largest: 262,787,635 raw USDC
 * against a >29B raw USDC vault, ~0.9% of reserve) sat comfortably inside
 * it, while still being far short of "unbounded" — an unbounded linear
 * quote is unsafe on its own (a more-favourable-than-real quote wins merge
 * elections it cannot actually fill).
 */
export const CAP_DIVISOR = 20n;

export interface ZeroFiPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA -> mintB (vaultA is the deposit vault), 1 = mintB -> mintA. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  companionA: Address;
  companionB: Address;
  oracle: Address;
  tokenProgramA: Address;
  tokenProgramB: Address;
  decimalsA: number;
  decimalsB: number;
  /** See module doc "ACCOUNT 8" / ZEROFI_POOL_AUTHORITY — pending ZeroFi-side registration. */
  authority: Address;
  authorityAtaA: Address;
  authorityAtaB: Address;
  /** Verified per-pool fee/spread, ppm (see ZEROFI_POOL_FEE_PPM). */
  feePpm: bigint;
  /**
   * Baked IEEE-754 scale constants derived from the oracle bytes AT FETCH
   * TIME (see ladder.ts's `ieee754ScaleParams` / module doc) — decimals-
   * adjusted, gcd-reduced. `bakedTop` is compared against the LIVE oracle
   * bit pattern on-chain every cook (a mismatch deactivates the slot); the
   * rest scale the live mantissa. Read-only re-derivation from the SAME
   * oracle bytes fetchPoolConfig already loaded, exactly mirroring how
   * obric-v2 bakes its own oracle-derived divX/mulX/divY/mulY into
   * PoolConfig rather than re-reading them at paramsFor time.
   */
  scaleBakedTop: bigint;
  scaleShiftPre: bigint;
  scaleNum: bigint;
  scaleDen: bigint;
}

function zerofiConfig(cfg: PoolConfig): ZeroFiPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} adapter got a config for venue '${cfg.venue}'`);
  const c = cfg as ZeroFiPoolConfig;
  if (c.direction !== 0 && c.direction !== 1) {
    throw new Error(`${SLUG} direction must be 0 or 1, got '${String(c.direction)}'`);
  }
  return c;
}

/** SPL Mint `decimals` byte offset. */
const MINT_DECIMALS_OFFSET = 44;

export const zerofi = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: ZEROFI_PROGRAM_ID,

  /**
   * Off-chain gate + decode. `pool` is the 38,176-byte account (see module
   * doc). Rejects: wrong size, missing account, a pool absent from the
   * verified fee catalog, a pool without a registered authority (REFUSE,
   * don't guess, for both — see ZEROFI_POOL_FEE_PPM / ZEROFI_POOL_AUTHORITY),
   * and missing mint/oracle accounts. Tokenkeg-only (both sampled pools use
   * plain Tokenkeg for both legs, confirmed from real swap_v4 account
   * lists — slots 9/11 are always TokenkegQfeZy...; a Token-2022 pool
   * changes wire semantics this adapter has not verified against, the
   * same scope restriction obric-v2 documents for itself).
   */
  async fetchPoolConfig(
    load: AccountLoader,
    pool: Address,
    direction: 0 | 1 = 0,
  ): Promise<ZeroFiPoolConfig> {
    const data = await load(pool);
    if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
    if (data.length !== POOL_ACCOUNT_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool} account is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
      );
    }
    const feePpm = ZEROFI_POOL_FEE_PPM[pool];
    if (feePpm === undefined) {
      throw new Error(
        `${SLUG} pool ${pool} has no independently-verified fee (resolved per POOL, never guessed — see ZEROFI_POOL_FEE_PPM)`,
      );
    }
    const authorityCfg = ZEROFI_POOL_AUTHORITY[pool];
    if (authorityCfg === undefined) {
      throw new Error(
        `${SLUG} pool ${pool} has no registered authority configured (ZEROFI_POOL_AUTHORITY) — the live program ` +
          `rejects an unregistered signer at slot 8 (see this file's module doc); register the deployment's ` +
          `authority with ZeroFi and populate ZEROFI_POOL_AUTHORITY before this pool can serve a real cook`,
      );
    }

    const mintA = pubkeyAt(data, OFF_MINT_A);
    const mintB = pubkeyAt(data, OFF_MINT_B);
    const vaultA = pubkeyAt(data, OFF_VAULT_A);
    const vaultB = pubkeyAt(data, OFF_VAULT_B);
    const companionA = pubkeyAt(data, OFF_COMPANION_A);
    const companionB = pubkeyAt(data, OFF_COMPANION_B);
    const oracle = pubkeyAt(data, OFF_ORACLE);

    const oracleData = await load(oracle);
    if (oracleData === null)
      throw new Error(`${SLUG} pool ${pool} oracle ${oracle} account not found`);
    if (oracleData.length !== ORACLE_ACCOUNT_SIZE) {
      throw new Error(
        `${SLUG} pool ${pool} oracle ${oracle} is ${oracleData.length} bytes, expected ${ORACLE_ACCOUNT_SIZE}`,
      );
    }

    const [mintAData, mintBData] = await Promise.all([load(mintA), load(mintB)]);
    if (mintAData === null || mintBData === null) {
      throw new Error(`${SLUG} pool ${pool} mint account(s) not found`);
    }
    if (
      mintAData.length < MINT_DECIMALS_OFFSET + 1 ||
      mintBData.length < MINT_DECIMALS_OFFSET + 1
    ) {
      throw new Error(`${SLUG} pool ${pool} mint account(s) too short to be an SPL mint`);
    }

    // `swap_v4` is Tokenkeg-only (slots 9/11 are always the classic Token
    // program). Detect a Token-2022 (or otherwise un-routable) mint per side
    // and GRACEFULLY SELF-DROP the pool (the SvmRoute orchestrator catches a
    // fetchPoolConfig throw and drops the venue). Reuses the mint bytes already
    // loaded above; the LEGACY path is byte-identical (a classic 82-byte mint
    // classifies Tokenkeg, parses no extensions).
    for (const [m, mintData] of [
      [mintA, mintAData],
      [mintB, mintBData],
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

    const decimalsA = mintAData[MINT_DECIMALS_OFFSET];
    const decimalsB = mintBData[MINT_DECIMALS_OFFSET];

    if (oracleData.length < PRICE_OFFSET + 8) {
      throw new Error(
        `${SLUG} pool ${pool} oracle ${oracle} is too short to hold the price word at offset ${PRICE_OFFSET}`,
      );
    }
    const rawPriceBits = readUintLE(oracleData, PRICE_OFFSET, 8);
    const scale = ieee754ScaleParams(rawPriceBits, decimalsA, decimalsB);
    const U64_MAX = (1n << 64n) - 1n;
    if (scale.num > U64_MAX || scale.den > U64_MAX) {
      throw new Error(
        `${SLUG} pool ${pool} price scale (num=${scale.num}, den=${scale.den}) exceeds u64 after reduction — refusing rather than emitting an overflow-prone fragment`,
      );
    }

    return {
      venue: SLUG,
      pool,
      direction,
      mintA,
      mintB,
      vaultA,
      vaultB,
      companionA,
      companionB,
      oracle,
      tokenProgramA: TOKEN_PROGRAM,
      tokenProgramB: TOKEN_PROGRAM,
      decimalsA,
      decimalsB,
      authority: authorityCfg.authority,
      authorityAtaA: authorityCfg.authorityAtaA,
      authorityAtaB: authorityCfg.authorityAtaB,
      feePpm,
      scaleBakedTop: scale.bakedTop,
      scaleShiftPre: scale.shiftPre,
      scaleNum: scale.num,
      scaleDen: scale.den,
    };
  },

  quoteAccounts(cfg: PoolConfig): VenueAccount[] {
    const c = zerofiConfig(cfg);
    const vaultOut = c.direction === 0 ? c.vaultB : c.vaultA;
    return [
      { ref: c.pool, address: c.pool, writable: true },
      { ref: c.oracle, address: c.oracle },
      { ref: vaultOut, address: vaultOut },
    ];
  },

  /**
   * v1 swap CPI (amount baked). disc(1) || amountIn u64 LE || minOut u64
   * LE=1. NOTE (see module doc): this CPI settles through the registered
   * `c.authority`'s own ATAs, not `user`'s — `user` is accepted for
   * interface parity with every other adapter but is UNUSED here (there is
   * no slot for an arbitrary caller-owned token account in this venue's
   * instruction — see zerofiSwapAccounts).
   */
  buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap {
    const c = zerofiConfig(cfg);
    void user;
    const U64_MAX = (1n << 64n) - 1n;
    if (amountIn <= 0n || amountIn > U64_MAX) {
      throw new Error(`${SLUG} buildSwap amountIn must be a positive u64, got ${amountIn}`);
    }
    const data = new Uint8Array(17);
    data[0] = ZEROFI_SWAP_DISCRIMINATOR;
    for (let b = 0; b < 8; b++) data[1 + b] = Number((amountIn >> BigInt(8 * b)) & 0xffn);
    data[9] = 1; // minOut = 1 (the recipe's terminal delta owns the real bound)
    return {
      programId: ZEROFI_PROGRAM_ID,
      data,
      accounts: zerofiSwapAccounts(c, (ref, addr, w) => fixed(ref, addr, w)),
    };
  },
};

const fixed = (ref: string, addr: Address, writable?: boolean): VenueAccount =>
  writable ? { ref, address: addr, writable: true } : { ref, address: addr };

/**
 * The 14-account order for ZeroFi's `swap_v4` (disc 0x10) — see module doc
 * for the full derivation and the measured fund-flow proof. The pool's own
 * vaultA/vaultB (slots 3/5, direction-selected) and the registered
 * authority's own ATA pair (slots 6/7) are the ONLY accounts that carry
 * value; slot 8 is the authority's signature. There is deliberately no
 * `user`-token-account parameter — see `zerofi.buildSwap`'s doc.
 */
export function zerofiSwapAccounts(
  c: ZeroFiPoolConfig,
  make: (ref: string, addr: Address, writable?: boolean) => VenueAccount,
  refFor?: (role: string) => string,
): VenueAccount[] {
  const r = refFor ?? ((role: string) => role);
  const aIn = c.direction === 0;
  const vaultIn = aIn ? c.vaultA : c.vaultB;
  const vaultOut = aIn ? c.vaultB : c.vaultA;
  const companionIn = aIn ? c.companionA : c.companionB;
  const companionOut = aIn ? c.companionB : c.companionA;
  return [
    make(r("pool"), c.pool, true),
    make(r("oracle"), c.oracle, true),
    make(r("cin"), companionIn, true),
    make(r("vin"), vaultIn, true),
    make(r("cout"), companionOut, true),
    make(r("vout"), vaultOut, true),
    make(r("aatab"), c.authorityAtaB, true),
    make(r("aataa"), c.authorityAtaA, true),
    { ref: c.authority, signer: true },
    make(r("tpa"), c.tokenProgramA),
    make(r("ma"), c.mintA),
    make(r("tpb"), c.tokenProgramB),
    make(r("mb"), c.mintB),
    { ref: INSTRUCTIONS_SYSVAR },
  ];
}
