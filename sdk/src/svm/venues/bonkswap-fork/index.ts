/**
 * Bonkswap / Guacswap — two independently-deployed Anchor programs that run
 * BYTE-IDENTICAL account layouts, instruction lists, and swap math (Guacswap
 * is a whitelabel fork of Bonkswap's `bonkswap` crate, confirmed via each
 * program's own on-chain Anchor IDL account — `name:"bonkswap"` vs.
 * `name:"guacswap"`, otherwise identical struct/instruction shapes). This
 * module is a single parameterized factory instantiated once per program id,
 * not two copies of the math — the SAME pattern `spl-token-swap-forks`
 * already uses in this recipe for the analogous multi-deployment case.
 *
 * GROUND TRUTH — read directly off each program's own on-chain Anchor IDL
 * account (the standard `createAddressWithSeed(findProgramAddress([],
 * programId), "anchor:idl", programId)` PDA; both are populated on mainnet),
 * NOT reverse-engineered from a third-party doc:
 *   - Bonkswap `BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p` — IDL
 *     `version:"0.1.1"`, 81 live `Pool` (417-byte) pools measured
 *     2026-07-31 via a keyless `getProgramAccounts` `dataSize` sweep, 0 live
 *     `PoolV2` (514-byte) pools at the same measurement (the account TYPE
 *     exists in the IDL and the `swap` ix's `pool` account carries no
 *     Anchor-level type constraint — it's read manually — so a future
 *     `PoolV2` pool decodes through the SAME offsets this module reads,
 *     which only span the two structs' byte-identical common prefix; wired
 *     anyway per the "wire both sizes" brief, at zero live cost today).
 *   - Guacswap `Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1` — IDL
 *     `version:"0.1.1"`, 12 live `Pool` pools measured same date, no
 *     `PoolV2` type in its IDL at all.
 *   - Also cross-checked against the official BonkLabs Jupiter-AMM-interface
 *     integration (github.com/BonkLabs/bonkswap-amm-integration, licensed
 *     under ISC as declared in its package.json, see THIRD_PARTY_NOTICES.md;
 *     TypeScript, `amm.ts`) for the reference quote math and account roles —
 *     see ./ladder.ts's header for the ONE place that reference gets the
 *     real program's rounding wrong (proven via real-CPI, not assumed).
 *
 * ACCOUNT LAYOUT — `Pool` (PoolV2's byte-identical prefix through the same
 * offsets; discriminator sha256("account:Pool")[0..8] = f19a6d0411b16dbc for
 * Pool, 5b0cd65707b9a737 for PoolV2 — both accepted, see `POOL_SIZE_V2`):
 *   tokenX@8 (pubkey), tokenY@40, poolXAccount@72, poolYAccount@104,
 *   admin@136, projectOwner@168, tokenXReserve@200 (Token=u64),
 *   tokenYReserve@208, ..., constK@312 (Product=u128), price@328
 *   (FixedPoint=u128, unused here — reserves are read live), lpFee@344
 *   (FixedPoint=u128), buybackFee@360, projectFee@376, mercantiFee@392,
 *   farmCount@408 (u64), bump@416 (u8) = 417 bytes total. Every fee is a
 *   ppt-of-1e12 rate (`DEFAULT_DENOMINATOR` in the reference SDK): realistic
 *   values never approach 2^64, so only the low 8 bytes of each 16-byte
 *   FixedPoint fee field are read — `fetchPoolConfig` rejects any pool whose
 *   fee's high word is nonzero rather than silently truncating it.
 *
 * SWAP INSTRUCTION — `swap(deltaIn: Token, priceLimit: FixedPoint, xToY:
 * bool)`, disc sha256("global:swap")[0..8], 17 accounts (state, pool,
 * tokenX, tokenY, poolXAccount, poolYAccount, swapperXAccount,
 * swapperYAccount, swapper[signer], referrerXAccount, referrerYAccount,
 * referrer, programAuthority, systemProgram, tokenProgram,
 * associatedTokenProgram, rent) — read directly off the on-chain IDL and
 * cross-checked against a real mainnet swap transaction's exact account
 * list (`5MMaArf3.../3JmFx2bW...`, Bonkswap USDC/BONK).
 *
 * SELF-REFERRAL (this adapter's own choice, not merely a copy of the
 * reference SDK's default `referrer = SystemProgram`): the `mercantiFee`
 * slice of `deltaOut` is paid out as a REAL, DIRECT SPL transfer to whatever
 * `referrerXAccount`/`referrerYAccount` the caller supplies — permissionless,
 * confirmed via a real Guacswap mainnet transaction
 * (`93tHLVugMrnoMaaHtvmXn8XnPR6eJhNpmCRE1KNdAVaE`, mercantiFee=250_000_000
 * ppt = 0.025%) whose inner instructions show the mercanti-fee leg as a
 * THIRD token transfer straight out of the pool vault to the referrer's own
 * token account, distinct from the swapper's principal payout. This module's
 * `buildSwapV2` therefore always sets `referrerXAccount = swapperXAccount`,
 * `referrerYAccount = swapperYAccount`, `referrer = swapper` — the mercanti
 * fee rebates back to the same trade, verified end-to-end via a REAL-CPI
 * LiteSVM run against both dumped binaries (bit-exact against
 * `referenceQuote`'s 3-fee model at 6/6 sizes×directions on the
 * mercanti-nonzero Guacswap pool above, and again on a mercanti-zero
 * Bonkswap pool). One Bonkswap tx observed live in the wild
 * (`3JmFx2bW...`) already does exactly this (referrer == swapper's own
 * accounts), so this is a real, already-used pattern, not a novel one.
 *
 * PRICE LIMIT — `priceLimit: FixedPoint` bounds the post-trade price: a
 * MINIMUM for `xToY` (price only falls when selling X) and a MAXIMUM for
 * `!xToY` (price only rises when selling Y) — derived from the reference
 * SDK's `getPriceAfterSlippage` and confirmed by a real 100%-tolerance
 * example computing exactly 0 for `xToY`. This adapter always disables the
 * venue-native check (0 for `xToY`, u128::MAX for `!xToY` — the exact
 * sentinel a real observed mainnet tx used for its `!xToY` leg) and relies
 * on the recipe's own terminal `minOut`, the same convention every other
 * wired SVM ladder uses for its venue-native slippage field.
 *
 * MATH — see ./ladder.ts's header for the constant-product formula and the
 * ONE place it diverges from the reference SDK's own arithmetic (a rounding
 * direction, proven wrong via real-CPI at 12/12 cases).
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
import { getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";

const POOL_SIZE_V1 = 417;
const POOL_SIZE_V2 = 514;
// sha256("account:Pool")[0..8] / sha256("account:PoolV2")[0..8].
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
const POOL_V2_DISCRIMINATOR = [0x5b, 0x0c, 0xd6, 0x57, 0x07, 0xb9, 0xa7, 0x37];

const OFF_TOKEN_X = 8;
const OFF_TOKEN_Y = 40;
const OFF_POOL_X_ACCOUNT = 72;
const OFF_POOL_Y_ACCOUNT = 104;
export const OFF_TOKEN_X_RESERVE = 200;
export const OFF_TOKEN_Y_RESERVE = 208;
export const OFF_CONST_K = 312; // u128 (Product)
export const OFF_LP_FEE = 344; // u128 (FixedPoint), low u64 read
export const OFF_BUYBACK_FEE = 360;
export const OFF_PROJECT_FEE = 376;
export const OFF_MERCANTI_FEE = 392;

/** DEFAULT_DENOMINATOR — every fee field is a rate scaled by 1e12 (100%). */
export const FEE_DENOMINATOR = 1_000_000_000_000n;

function readUintLE(data: Uint8Array, offset: number, width: number): bigint {
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
}

export interface BonkswapForkPoolConfig extends PoolConfig {
  tokenX: Address;
  tokenY: Address;
  poolXAccount: Address;
  poolYAccount: Address;
  /** constK (Product, u128), split hi/lo — a liquidity-event invariant, baked at fetch time (mirrors obric-v2's bigK). */
  constKHi: bigint;
  constKLo: bigint;
  /** Fee rates (ppt of 1e12) — admin-configured, baked at fetch time. */
  lpFee: bigint;
  buybackFee: bigint;
  projectFee: bigint;
  mercantiFee: bigint;
  /** 'xToY' (default, tokenX in) | 'yToX'. */
  direction: "xToY" | "yToX";
}

function forkConfig(slug: string, base: PoolConfig): BonkswapForkPoolConfig {
  if (base.venue !== slug) throw new Error(`${slug} adapter got a '${base.venue}' pool config`);
  return base as BonkswapForkPoolConfig;
}

export interface BonkswapForkAdapter {
  slug: string;
  programId: Address;
  fetchPoolConfig(load: OwnedAccountLoader, pool: Address): Promise<BonkswapForkPoolConfig>;
}

/**
 * One adapter per deployed Bonkswap fork — same layout/math (see module
 * header), parameterized only by the fork's own program id.
 */
export function makeBonkswapForkAdapter(slug: string, programId: Address): BonkswapForkAdapter {
  return {
    slug,
    programId,
    async fetchPoolConfig(owned, pool) {
      const load = accountDataLoader(owned);
      const data = await load(pool);
      if (data === null) throw new Error(`${slug} pool ${pool} not found`);
      if (data.length !== POOL_SIZE_V1 && data.length !== POOL_SIZE_V2) {
        throw new Error(
          `${slug} pool ${pool} data is ${data.length} bytes, expected ${POOL_SIZE_V1} (Pool) or ${POOL_SIZE_V2} (PoolV2)`,
        );
      }
      const expectedDisc =
        data.length === POOL_SIZE_V1 ? POOL_DISCRIMINATOR : POOL_V2_DISCRIMINATOR;
      for (let i = 0; i < 8; i++) {
        if (data[i] !== expectedDisc[i]) {
          throw new Error(
            `${slug} pool ${pool} has a wrong discriminator for its ${data.length}-byte size`,
          );
        }
      }

      const codec = getAddressCodec();
      const pubkey = (offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

      const tokenXReserve = readUintLE(data, OFF_TOKEN_X_RESERVE, 8);
      const tokenYReserve = readUintLE(data, OFF_TOKEN_Y_RESERVE, 8);
      if (tokenXReserve === 0n || tokenYReserve === 0n) {
        throw new Error(
          `${slug} pool ${pool} has an empty reserve (X=${tokenXReserve}, Y=${tokenYReserve})`,
        );
      }

      const constKLo = readUintLE(data, OFF_CONST_K, 8);
      const constKHi = readUintLE(data, OFF_CONST_K + 8, 8);
      if (constKHi === 0n && constKLo === 0n)
        throw new Error(`${slug} pool ${pool} has a zero constK`);

      const feeAt = (offset: number, name: string): bigint => {
        const lo = readUintLE(data, offset, 8);
        const hi = readUintLE(data, offset + 8, 8);
        if (hi !== 0n)
          throw new Error(
            `${slug} pool ${pool} ${name} exceeds a u64 (hi word ${hi} nonzero) — refusing to truncate`,
          );
        return lo;
      };
      const lpFee = feeAt(OFF_LP_FEE, "lpFee");
      const buybackFee = feeAt(OFF_BUYBACK_FEE, "buybackFee");
      const projectFee = feeAt(OFF_PROJECT_FEE, "projectFee");
      const mercantiFee = feeAt(OFF_MERCANTI_FEE, "mercantiFee");
      const totalFee = lpFee + buybackFee + projectFee + mercantiFee;
      if (totalFee > FEE_DENOMINATOR) {
        throw new Error(
          `${slug} pool ${pool} total fee ${totalFee} exceeds 100% (${FEE_DENOMINATOR})`,
        );
      }

      return {
        venue: slug,
        pool,
        tokenX: pubkey(OFF_TOKEN_X),
        tokenY: pubkey(OFF_TOKEN_Y),
        poolXAccount: pubkey(OFF_POOL_X_ACCOUNT),
        poolYAccount: pubkey(OFF_POOL_Y_ACCOUNT),
        constKHi,
        constKLo,
        lpFee,
        buybackFee,
        projectFee,
        mercantiFee,
        direction: "xToY",
      };
    },
  };
}

export { forkConfig as bonkswapForkConfig, readUintLE as bonkswapReadUintLE };

/** Bonkswap — the original deployment. */
export const BONKSWAP_PROGRAM_ID = "BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p" as Address;
/** Bonkswap's `state` PDA (seed "bonkswapstatev1") — verified via getProgramDerivedAddress and matches a real swap tx's account #0. */
export const BONKSWAP_STATE = "2QWN6WjrJ3RAk51ecxLxaLPfFCYLAnmWJwJ1oKA92CRD" as Address;
/** Bonkswap's vault-owning authority PDA (State.programAuthority) — matches every pool's vault SPL-token `owner` field. */
export const BONKSWAP_PROGRAM_AUTHORITY = "8NyaPDJeC2eaBGpkRpZKnD9S448AZGgjSvumFe92DRK2" as Address;
export const bonkswap = makeBonkswapForkAdapter("bonkswap", BONKSWAP_PROGRAM_ID);

/** Guacswap — a whitelabel fork (see module header). */
export const GUACSWAP_PROGRAM_ID = "Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1" as Address;
/** Guacswap's `state` PDA (seed "guacswapstatev1"). */
export const GUACSWAP_STATE = "EzV4QKycvp4EDuAoTGjyY9HUS9Zn15vcmHkHJdNKHCnY" as Address;
/** Guacswap's vault-owning authority PDA. */
export const GUACSWAP_PROGRAM_AUTHORITY = "FRwL3qJHuT5iYTNopCyhU1tyDn1HwtHbSa1ieYF6q2m9" as Address;
export const guacswap = makeBonkswapForkAdapter("guacswap", GUACSWAP_PROGRAM_ID);
