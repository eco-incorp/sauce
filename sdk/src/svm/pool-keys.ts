/**
 * A venue's pool found by its KEY, as an EVM factory finds one (`UniswapV3.Factory.getPool(a, b,
 * fee)`): `Orca.Whirlpool.pool(USDC, WSOL, 4)` in a program is the pool Orca's program keeps for the
 * pair at tick spacing 4. Each of these venues' pools is a program-derived address of its pair, the
 * lower key first, and one number:
 *
 *   Orca.Whirlpool, Cropper.Whirlpool   "whirlpool", the program's WhirlpoolsConfig, the pair, the
 *                                       fee tier's index (u16, little-endian): a static tier's
 *                                       index is its tick spacing, which a program names; an
 *                                       adaptive-fee tier's (1024 and up) is another number, which
 *                                       a program adds after the spacing
 *   Defituna.Fusion                     "fusion_pool", the pair, the tick spacing
 *   Crema.CLMM                          "clmmpool", the program's config, the pair, the tick spacing
 *   Raydium.CLMM, Pancakeswap.CLMM,     "pool", the AmmConfig, the pair: the AmmConfig is the
 *   Byreal.CLMM, Stabble.CLMM           program's `["amm_config", index]` (u16, big-endian), and
 *                                       a program names it by its trade fee, in millionths (400 is
 *                                       0.04%), as an EVM pool's fee is written
 *
 * A Raydium-code program may keep two configs at one fee, at different tick spacings (Raydium's
 * 0.01% at spacing 1 and 10) or even the same: the fee then names a pool under each, and a program
 * may add the tick spacing (`Raydium.CLMM.pool(USDC, WSOL, 100, 1)`). Which of them is there, the
 * cook reads (`svm/account-names.ts`): none is an empty slot, one is the pool, more is refused,
 * naming each.
 *
 * A whirlpool program keeps a static and an adaptive-fee tier at most tick spacings (Orca's 64 and
 * 1025), and a pair often has a pool on both. The spacing alone names the static tier's pool, the
 * canonical one, and the only one a swap at a price trades: an adaptive fee is more than one rate.
 * An adaptive tier's pool is named by its index after the spacing
 * (`Orca.Whirlpool.pool(SPCX_US, USDC, 64, 1025)`).
 *
 * Phoenix's markets are not derived from their pair: a program names a market by its address.
 *
 * Nothing here reads the cluster. The addresses are derived; whether a pool is there, the cook reads
 * as it is built.
 */
import { address, getAddressEncoder, type Address } from "@solana/kit";

import {
  BYREAL_PROGRAM_ID,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "./venues/index.js";
import { memoizedFindProgramAddressSync } from "./venues/pda-memo.js";

/** What a venue's key is: a whirlpool's tick spacing, or a Raydium-code pool's fee. */
export type SvmPoolKind = "tick spacing" | "fee";

/** What a venue's pool may take after its key: the config's tick spacing, or the fee tier's index. */
export type SvmPoolRefinement = "tickSpacing" | "feeTierIndex";

/** One of a Raydium-code program's AmmConfigs: its index, trade fee (millionths) and spacing. */
export interface SvmAmmConfig {
  readonly index: number;
  readonly fee: number;
  readonly tickSpacing: number;
}

/**
 * One of a whirlpool program's fee tiers: the index its pools are derived at, and its tick spacing.
 * A static tier's index is its spacing; an adaptive-fee tier's is not.
 */
export interface SvmFeeTier {
  readonly index: number;
  readonly tickSpacing: number;
}

/** A venue whose pools a program finds by key. */
export interface SvmKeyedVenue {
  /** The namespace a program writes, its protocol then its program (`Orca.Whirlpool`). */
  readonly namespace: string;
  readonly program: Address;
  readonly key: SvmPoolKind;
  /** What its pool may take after the key, where one key may name more than one pool. */
  readonly refinement?: SvmPoolRefinement;
  /** For a fee: the program's configs, each fee one a program may name. */
  readonly configs?: readonly SvmAmmConfig[];
  /** For a whirlpool: its config's fee tiers, each tick spacing one a program may name. */
  readonly feeTiers?: readonly SvmFeeTier[];
  /**
   * The pool's seeds: from the pair, lower key first, and the key (a config's index, for a fee; a
   * fee tier's, for a whirlpool).
   */
  readonly seeds: (lower: Uint8Array, higher: Uint8Array, key: number) => readonly Uint8Array[];
}

/** A pool a key may name: its address, and the config (for a fee) or fee tier it is under. */
export interface SvmPoolCandidate {
  readonly pool: Address;
  readonly config?: SvmAmmConfig;
  readonly feeTier?: SvmFeeTier;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const key32 = (value: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(value));
const u16 = (value: number, littleEndian: boolean): Uint8Array => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, littleEndian);
  return bytes;
};

/** A whirlpool's: `["whirlpool", config, lower, higher, tier]`, its tiers `[index, spacing]`. */
const whirlpool = (
  namespace: string,
  program: Address,
  config: Address,
  feeTiers: readonly (readonly [index: number, tickSpacing: number])[],
): SvmKeyedVenue => ({
  namespace,
  program,
  key: "tick spacing",
  refinement: "feeTierIndex",
  feeTiers: feeTiers.map(([index, tickSpacing]) => ({ index, tickSpacing })),
  seeds: (lower, higher, index) => [
    text("whirlpool"),
    key32(config),
    lower,
    higher,
    u16(index, true),
  ],
});

/** A Raydium-code pool's: `["pool", ammConfig, lower, higher]`, its configs `[index, fee, spacing]`. */
const raydium = (
  namespace: string,
  program: Address,
  configs: readonly (readonly [index: number, fee: number, tickSpacing: number])[],
): SvmKeyedVenue => ({
  namespace,
  program,
  key: "fee",
  refinement: "tickSpacing",
  configs: configs.map(([index, fee, tickSpacing]) => ({ index, fee, tickSpacing })),
  seeds: (lower, higher, index) => [
    text("pool"),
    key32(svmAmmConfig(program, index)),
    lower,
    higher,
  ],
});

/**
 * Each venue a program finds pools at by key, by its namespace. A Raydium-code program's configs
 * are every one it kept at indexes 0 to 199 when read, and a whirlpool program's fee tiers every
 * one its config kept at indexes 0 to 4095, each pinned by its account in
 * `test/fixtures/svm-pool-keys/amm-configs.json` (`scripts/dump-amm-configs.mjs`).
 */
export const SVM_KEYED_VENUES: Readonly<Record<string, SvmKeyedVenue>> = {
  "Raydium.CLMM": raydium("Raydium.CLMM", RAYDIUM_CLMM_PROGRAM_ID, [
    [0, 100, 10],
    [1, 2500, 60],
    [2, 500, 10],
    [3, 10000, 120],
    [4, 100, 1],
    [5, 500, 1],
    [6, 200, 1],
    [7, 300, 1],
    [8, 400, 1],
    [9, 20000, 120],
    [10, 1000, 10],
    [11, 1500, 10],
    [12, 1600, 10],
    [13, 1800, 10],
    [14, 2000, 10],
    [15, 4000, 60],
    [16, 6000, 60],
    [17, 8000, 60],
    [18, 30000, 120],
    [19, 40000, 120],
    [20, 5000, 60],
  ]),
  "Pancakeswap.CLMM": raydium("Pancakeswap.CLMM", PANCAKESWAP_CLMM_PROGRAM_ID, [
    [0, 100, 10],
    [1, 2500, 60],
    [2, 500, 10],
    [3, 10000, 120],
    [4, 100, 1],
    [5, 500, 1],
    [6, 200, 1],
    [7, 300, 1],
    [8, 400, 1],
    [9, 20000, 120],
    [10, 1000, 10],
    [11, 1500, 10],
    [12, 1600, 10],
    [13, 1800, 10],
    [14, 2000, 10],
    [15, 4000, 60],
    [16, 6000, 60],
    [17, 8000, 60],
    [18, 30000, 120],
    [19, 40000, 120],
    [20, 3000, 60],
    [21, 800, 1],
  ]),
  "Byreal.CLMM": raydium("Byreal.CLMM", BYREAL_PROGRAM_ID, [
    [1, 100, 1],
    [2, 500, 1],
    [3, 4000, 60],
    [4, 5000, 60],
    [5, 6000, 60],
    [6, 400, 1],
    [7, 2500, 60],
    [8, 200, 1],
    [9, 300, 1],
    [10, 1000, 10],
    [11, 2000, 10],
    [12, 10000, 120],
    [20, 20000, 120],
    [21, 200, 10],
    [22, 100, 120],
    [50, 3000, 60],
    [51, 8000, 60],
    [52, 1, 1],
    [53, 50, 1],
  ]),
  "Stabble.CLMM": raydium("Stabble.CLMM", STABBLE_CLMM_PROGRAM_ID, [
    [0, 50, 1],
    [1, 50, 1],
    [2, 60, 1],
    [3, 70, 1],
    [4, 80, 1],
    [5, 90, 1],
    [6, 100, 1],
    [7, 250, 1],
    [8, 500, 1],
    [9, 750, 1],
    [10, 1000, 1],
    [11, 2500, 1],
    [12, 5000, 1],
    [13, 7500, 1],
    [14, 10000, 1],
    [15, 12500, 1],
    [16, 17500, 1],
    [17, 20000, 1],
  ]),
  "Orca.Whirlpool": whirlpool(
    "Orca.Whirlpool",
    ORCA_WHIRLPOOL_PROGRAM_ID,
    address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"),
    [
      [1, 1],
      [2, 2],
      [4, 4],
      [8, 8],
      [16, 16],
      [64, 64],
      [96, 96],
      [128, 128],
      [256, 256],
      [1025, 64],
      [1026, 1],
      [1027, 2],
      [1028, 4],
      [1029, 8],
      [1030, 16],
      [1031, 96],
      [1032, 128],
      [1033, 256],
      [1034, 32896],
      [1035, 16],
      [1036, 128],
      [2049, 128],
      [2050, 16],
      [2051, 64],
      [32896, 32896],
    ],
  ),
  "Cropper.Whirlpool": whirlpool(
    "Cropper.Whirlpool",
    CROPPER_PROGRAM_ID,
    address("2CmCWqXhw7f3jCnvJg74t4vsm62DTUbKQPWL7NX8oCpL"),
    [
      [1, 1],
      [2, 2],
      [4, 4],
      [8, 8],
      [16, 16],
      [64, 64],
      [128, 128],
      [256, 256],
    ],
  ),
  "Defituna.Fusion": {
    namespace: "Defituna.Fusion",
    program: DEFITUNA_PROGRAM_ID,
    key: "tick spacing",
    seeds: (lower, higher, spacing) => [text("fusion_pool"), lower, higher, u16(spacing, true)],
  },
  "Crema.CLMM": {
    namespace: "Crema.CLMM",
    program: CREMA_PROGRAM_ID,
    key: "tick spacing",
    seeds: (lower, higher, spacing) => [
      text("clmmpool"),
      key32(address("2rUWTKPfLnWDsEajZymGmZAEz8XcsTdo9gzKJfhsmpox")),
      lower,
      higher,
      u16(spacing, true),
    ],
  },
};

/** A Raydium-code program's AmmConfig at `index`: `["amm_config", index]`, big-endian. */
export function svmAmmConfig(program: Address, index: number): Address {
  return memoizedFindProgramAddressSync(program, [text("amm_config"), u16(index, false)])[0];
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (items: readonly string[]): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`;

/** The configs a fee (and a tick spacing, given one) names at a Raydium-code venue. */
const configsAt = (venue: SvmKeyedVenue, fee: bigint, spacing?: bigint): SvmAmmConfig[] =>
  (venue.configs ?? []).filter(
    (one) =>
      BigInt(one.fee) === fee && (spacing === undefined || BigInt(one.tickSpacing) === spacing),
  );

/** The fee tiers a tick spacing (and a tier's index, given one) names at a whirlpool venue. */
const tiersAt = (venue: SvmKeyedVenue, spacing: bigint, index?: bigint): SvmFeeTier[] =>
  (venue.feeTiers ?? []).filter(
    (one) =>
      BigInt(one.tickSpacing) === spacing && (index === undefined || BigInt(one.index) === index),
  );

/**
 * Why `key` (and `refinement`, a Raydium-code pool's tick spacing beside its fee or a whirlpool's
 * fee tier index beside its tick spacing) names no pool at the venue's, or undefined: a fee must be
 * one of the program's configs, and a spacing given with it that config's; a whirlpool's tick
 * spacing alone its static tier's, and an index given with it one of its tiers'; any other tick
 * spacing a whole number from 1 to 65535.
 */
export function svmPoolKeyProblem(
  namespace: string,
  key: bigint,
  refinement?: bigint,
): string | undefined {
  const venue = SVM_KEYED_VENUES[namespace];
  if (venue === undefined) return `${namespace} finds no pool by key`;
  if (venue.feeTiers !== undefined) {
    const tiers = tiersAt(venue, key);
    if (tiers.length === 0) {
      const spacings = [...new Set(venue.feeTiers.map((one) => one.tickSpacing))].sort(
        (a, b) => a - b,
      );
      return (
        `${namespace}'s key is a pool's tick spacing, and it has no fee tier at ${key}: its tick ` +
        `spacings are ${spacings.join(", ")}`
      );
    }
    const indexes = tiers.map((one) => String(one.index));
    if (refinement === undefined && tiersAt(venue, key, key).length === 0) {
      return (
        `${namespace} has no static fee tier at tick spacing ${key}, only adaptive ones: name one ` +
        `after the spacing, pool(tokenA, tokenB, ${key}, ${indexes[0]})`
      );
    }
    if (refinement !== undefined && tiersAt(venue, key, refinement).length === 0) {
      return `${namespace}'s fee tiers at tick spacing ${key} are ${listed(indexes)}, not ${refinement}`;
    }

    return undefined;
  }
  if (venue.configs === undefined) {
    if (refinement !== undefined) {
      return `${namespace}'s pool is found by its tick spacing alone: pool(tokenA, tokenB, tickSpacing)`;
    }
    return key >= 1n && key <= 0xffffn
      ? undefined
      : `${namespace}'s key is a tick spacing, from 1 to 65535, and ${key} is not one`;
  }
  const spacing = refinement;
  if (configsAt(venue, key).length === 0) {
    const fees = [...new Set(venue.configs.map((one) => one.fee))].sort((a, b) => a - b);
    return (
      `${namespace}'s key is a pool's fee, in millionths (400 is 0.04%), and it has no config at ` +
      `${key}: its fees are ${fees.join(", ")}`
    );
  }
  if (spacing !== undefined && configsAt(venue, key, spacing).length === 0) {
    const spacings = configsAt(venue, key).map((one) => one.tickSpacing);
    return `${namespace}'s configs at fee ${key} have tick spacing ${listed(spacings.map(String))}, not ${spacing}`;
  }

  return undefined;
}

/**
 * Every pool the key may name at the venue for the pair, which {@link svmPoolKeyProblem} accepts:
 * the one a tick spacing derives (a whirlpool's on its static tier, or on the tier given), or one
 * under each config charging the fee (at the spacing, given one). Which of them is there is the
 * cluster's to say.
 */
export function svmPoolCandidates(
  namespace: string,
  tokenA: Address,
  tokenB: Address,
  key: bigint,
  refinement?: bigint,
): SvmPoolCandidate[] {
  const problem = svmPoolKeyProblem(namespace, key, refinement);
  if (problem !== undefined) throw new Error(problem);
  const venue = SVM_KEYED_VENUES[namespace]!;
  const [a, b] = [key32(tokenA), key32(tokenB)];
  const lower = compare(a, b) < 0;
  const [first, second] = lower ? [a, b] : [b, a];
  const derive = (seed: number): Address =>
    memoizedFindProgramAddressSync(venue.program, venue.seeds(first, second, seed))[0];
  if (venue.feeTiers !== undefined) {
    return tiersAt(venue, key, refinement ?? key).map((feeTier) => ({
      pool: derive(feeTier.index),
      feeTier,
    }));
  }
  if (venue.configs === undefined) return [{ pool: derive(Number(key)) }];

  return configsAt(venue, key, refinement).map((config) => ({
    pool: derive(config.index),
    config,
  }));
}

/** Two keys compared byte by byte, as the venues order a pair. */
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
