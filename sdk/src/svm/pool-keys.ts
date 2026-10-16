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
 * Phoenix's markets are not derived from their pair: a program names a market by its address.
 *
 * Nothing here reads the cluster. The address is derived; whether a pool is there, the cook reads
 * as it is built (`svm/account-names.ts`), and a key with no pool is an empty slot.
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

/** A venue whose pools a program finds by key. */
export interface SvmKeyedVenue {
  /** The namespace a program writes, its protocol then its program (`Orca.Whirlpool`). */
  readonly namespace: string;
  readonly program: Address;
  readonly key: SvmPoolKind;
  /**
   * For a fee: each fee the SDK knows a config of, and that config's index. A fee missing here is
   * refused as the program compiles, naming the fees there are.
   */
  readonly configs?: ReadonlyMap<number, number>;
  /** The pool's seeds, past its prefix: from the pair, lower key first, and the key. */
  readonly seeds: (lower: Uint8Array, higher: Uint8Array, key: number) => readonly Uint8Array[];
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

/** A Raydium-code pool's: `["pool", ammConfig, lower, higher]`, its config found by its fee. */
const raydium = (
  namespace: string,
  program: Address,
  configs: readonly (readonly [fee: number, index: number])[],
): SvmKeyedVenue => ({
  namespace,
  program,
  key: "fee",
  configs: new Map(configs),
  seeds: (lower, higher, fee) => [
    text("pool"),
    key32(svmAmmConfig(program, new Map(configs).get(fee)!)),
    lower,
    higher,
  ],
});

/**
 * Each venue a program finds pools at by key, by its namespace. A Raydium-code program's configs
 * are the ones the SDK has read, each pinned by its account in the venue fixtures
 * (`test/svm/pool-keys.test.ts`).
 */
export const SVM_KEYED_VENUES: Readonly<Record<string, SvmKeyedVenue>> = {
  "Raydium.CLMM": raydium("Raydium.CLMM", RAYDIUM_CLMM_PROGRAM_ID, [[400, 8]]),
  "Pancakeswap.CLMM": raydium("Pancakeswap.CLMM", PANCAKESWAP_CLMM_PROGRAM_ID, [[100, 0]]),
  "Byreal.CLMM": raydium("Byreal.CLMM", BYREAL_PROGRAM_ID, [[3000, 50]]),
  "Stabble.CLMM": raydium("Stabble.CLMM", STABBLE_CLMM_PROGRAM_ID, [[50, 1]]),
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

/**
 * Why `key` names no pool at the venue's, or undefined: a tick spacing is a whole number from 1 to
 * 65535; a fee must be one the SDK knows a config of.
 */
export function svmPoolKeyProblem(namespace: string, key: bigint): string | undefined {
  const venue = SVM_KEYED_VENUES[namespace];
  if (venue === undefined) return `${namespace} finds no pool by key`;
  if (venue.configs === undefined) {
    return key >= 1n && key <= 0xffffn
      ? undefined
      : `${namespace}'s key is a tick spacing, from 1 to 65535, and ${key} is not one`;
  }
  if (key <= BigInt(Number.MAX_SAFE_INTEGER) && venue.configs.has(Number(key))) return undefined;
  const fees = [...venue.configs.keys()].sort((a, b) => a - b);

  return (
    `${namespace}'s key is a pool's fee, in millionths (400 is 0.04%), and it has no config at ` +
    `${key}: its fees are ${fees.join(", ")}`
  );
}

/** The pool the venue derives for the pair at `key`, which {@link svmPoolKeyProblem} accepts. */
export function svmPoolByKey(
  namespace: string,
  tokenA: Address,
  tokenB: Address,
  key: bigint,
): Address {
  const problem = svmPoolKeyProblem(namespace, key);
  if (problem !== undefined) throw new Error(problem);
  const venue = SVM_KEYED_VENUES[namespace]!;
  const [a, b] = [key32(tokenA), key32(tokenB)];
  const lower = compare(a, b) < 0;

  return memoizedFindProgramAddressSync(
    venue.program,
    venue.seeds(lower ? a : b, lower ? b : a, Number(key)),
  )[0];
}

/** Two keys compared byte by byte, as the venues order a pair. */
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
