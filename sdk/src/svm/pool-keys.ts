/**
 * A venue's pool found by its KEY, as an EVM factory finds one (`UniswapV3.Factory.getPool(a, b,
 * fee)`): `Orca.Whirlpool.pool(USDC, WSOL, 4)` in a program is the pool Orca's program keeps for the
 * pair at tick spacing 4. Each of these venues' pools is a program-derived address of its pair, the
 * lower key first, and one number:
 *
 *   Orca.Whirlpool, Cropper.Whirlpool   "whirlpool", the program's WhirlpoolsConfig, the pair, the
 *                                       tick spacing (u16, little-endian)
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

/** One of a Raydium-code program's AmmConfigs: its index, trade fee (millionths) and spacing. */
export interface SvmAmmConfig {
  readonly index: number;
  readonly fee: number;
  readonly tickSpacing: number;
}

/** A venue whose pools a program finds by key. */
export interface SvmKeyedVenue {
  /** The namespace a program writes, its protocol then its program (`Orca.Whirlpool`). */
  readonly namespace: string;
  readonly program: Address;
  readonly key: SvmPoolKind;
  /** For a fee: the program's configs, each fee one a program may name. */
  readonly configs?: readonly SvmAmmConfig[];
  /** The pool's seeds: from the pair, lower key first, and the key (a config's index, for a fee). */
  readonly seeds: (lower: Uint8Array, higher: Uint8Array, key: number) => readonly Uint8Array[];
}

/** A pool a key may name: its address, and for a fee the config it is under. */
export interface SvmPoolCandidate {
  readonly pool: Address;
  readonly config?: SvmAmmConfig;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const key32 = (value: Address): Uint8Array => new Uint8Array(getAddressEncoder().encode(value));
const u16 = (value: number, littleEndian: boolean): Uint8Array => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, littleEndian);
  return bytes;
};

/** A whirlpool's: `["whirlpool", config, lower, higher, spacing]`. */
const whirlpool = (namespace: string, program: Address, config: Address): SvmKeyedVenue => ({
  namespace,
  program,
  key: "tick spacing",
  seeds: (lower, higher, spacing) => [
    text("whirlpool"),
    key32(config),
    lower,
    higher,
    u16(spacing, true),
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
 * are every one it kept at indexes 0 to 199 when read, each pinned by its account in
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
  ),
  "Cropper.Whirlpool": whirlpool(
    "Cropper.Whirlpool",
    CROPPER_PROGRAM_ID,
    address("2CmCWqXhw7f3jCnvJg74t4vsm62DTUbKQPWL7NX8oCpL"),
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

/** The configs a fee (and a tick spacing, given one) names at a Raydium-code venue. */
const configsAt = (venue: SvmKeyedVenue, fee: bigint, spacing?: bigint): SvmAmmConfig[] =>
  (venue.configs ?? []).filter(
    (one) =>
      BigInt(one.fee) === fee && (spacing === undefined || BigInt(one.tickSpacing) === spacing),
  );

/**
 * Why `key` (and `spacing`, a Raydium-code pool's tick spacing beside its fee) names no pool at the
 * venue's, or undefined: a tick spacing is a whole number from 1 to 65535; a fee must be one of the
 * program's configs, and a spacing given with it that config's.
 */
export function svmPoolKeyProblem(
  namespace: string,
  key: bigint,
  spacing?: bigint,
): string | undefined {
  const venue = SVM_KEYED_VENUES[namespace];
  if (venue === undefined) return `${namespace} finds no pool by key`;
  if (venue.configs === undefined) {
    if (spacing !== undefined) {
      return `${namespace}'s pool is found by its tick spacing alone: pool(tokenA, tokenB, tickSpacing)`;
    }
    return key >= 1n && key <= 0xffffn
      ? undefined
      : `${namespace}'s key is a tick spacing, from 1 to 65535, and ${key} is not one`;
  }
  if (configsAt(venue, key).length === 0) {
    const fees = [...new Set(venue.configs.map((one) => one.fee))].sort((a, b) => a - b);
    return (
      `${namespace}'s key is a pool's fee, in millionths (400 is 0.04%), and it has no config at ` +
      `${key}: its fees are ${fees.join(", ")}`
    );
  }
  if (spacing !== undefined && configsAt(venue, key, spacing).length === 0) {
    const spacings = configsAt(venue, key).map((one) => one.tickSpacing);
    return `${namespace}'s configs at fee ${key} have tick spacing ${spacings.join(" and ")}, not ${spacing}`;
  }

  return undefined;
}

/**
 * Every pool the key may name at the venue for the pair, which {@link svmPoolKeyProblem} accepts:
 * the one a tick spacing derives, or one under each config charging the fee (at the spacing, given
 * one). Which of them is there is the cluster's to say.
 */
export function svmPoolCandidates(
  namespace: string,
  tokenA: Address,
  tokenB: Address,
  key: bigint,
  spacing?: bigint,
): SvmPoolCandidate[] {
  const problem = svmPoolKeyProblem(namespace, key, spacing);
  if (problem !== undefined) throw new Error(problem);
  const venue = SVM_KEYED_VENUES[namespace]!;
  const [a, b] = [key32(tokenA), key32(tokenB)];
  const lower = compare(a, b) < 0;
  const [first, second] = lower ? [a, b] : [b, a];
  const derive = (seed: number): Address =>
    memoizedFindProgramAddressSync(venue.program, venue.seeds(first, second, seed))[0];
  if (venue.configs === undefined) return [{ pool: derive(Number(key)) }];

  return configsAt(venue, key, spacing).map((config) => ({ pool: derive(config.index), config }));
}

/** Two keys compared byte by byte, as the venues order a pair. */
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
