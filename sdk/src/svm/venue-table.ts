/**
 * Solana's swap venues by cluster, as an EVM protocol's addresses are kept per chain: for each
 * venue a program names by namespace (`Orca.Whirlpool`, `Raydium.CLMM`, …), one row for each cluster
 * the venue is deployed on, holding its program and what its pools are derived under there — a
 * whirlpool program's WhirlpoolsConfig and fee tiers, a Raydium-code program's AmmConfigs, Crema's
 * config. A venue a cluster lacks has no row there.
 *
 * The one place these are written. The venue namespaces (`routes/svm-venue-methods.ts`), the pools'
 * keys (`pool-keys.ts`) and slots (`pool-slot.ts`), the stops' cost table (`compute-stops.ts`),
 * `sauce pools` and `@sauce/router`'s program guards (the defines {@link svmRouterDefines} gives a
 * compile) each read the row of the cluster the program runs on, and a name of a venue the cluster
 * lacks is refused there by name.
 *
 * A Raydium-code program's AmmConfigs are every one it kept at indexes 0 to 199 when read, and a
 * whirlpool config's fee tiers every one it kept at indexes 0 to 4095, each pinned by its account,
 * per cluster, in `test/fixtures/svm-pool-keys/amm-configs*.json` (`scripts/dump-amm-configs.mjs`).
 * The layouts, discriminators, seeds and instructions are each program's code, the same on every
 * cluster: on devnet each venue's program was read to keep them as mainnet's does.
 */
import { address, getAddressEncoder, type Address } from "@solana/kit";

import type { SvmTokenCluster } from "../routes/token-registry.js";
import { memoizedFindProgramAddressSync } from "./venues/pda-memo.js";

/** The venues a program names by namespace, by the recipes' venue names (`router-accounts.ts`). */
export type SvmNamespaceVenue =
  | "raydium-clmm"
  | "pancakeswap-clmm"
  | "byreal"
  | "stabble-clmm"
  | "orca-whirlpool"
  | "cropper"
  | "defituna"
  | "crema"
  | "phoenix"
  | "meteora-dlmm";

/** A venue on one cluster. */
export interface SvmVenueRow {
  readonly program: Address;
  /** A whirlpool program's WhirlpoolsConfig, Crema's config: what its pools are derived under. */
  readonly config?: Address;
  /** A Raydium-code program's AmmConfigs: `[index, trade fee in millionths, tick spacing]`. */
  readonly ammConfigs?: readonly (readonly [index: number, fee: number, tickSpacing: number])[];
  /** A whirlpool config's fee tiers: `[index, tick spacing]`, a static tier's index its spacing. */
  readonly feeTiers?: readonly (readonly [index: number, tickSpacing: number])[];
}

/** The twenty AmmConfigs at 0 to 19 that Raydium CLMM and PancakeSwap CLMM keep on mainnet. */
const RAYDIUM_CODE_CONFIGS = [
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
] as const;

/** Each venue's row on each cluster it is deployed on. */
export const SVM_VENUE_TABLE: Readonly<
  Record<SvmNamespaceVenue, Readonly<Partial<Record<SvmTokenCluster, SvmVenueRow>>>>
> = {
  "raydium-clmm": {
    "mainnet-beta": {
      program: address("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
      ammConfigs: [...RAYDIUM_CODE_CONFIGS, [20, 5000, 60]],
    },
    // Raydium's devnet program (its docs' devnet table, and its SDK's DEVNET_PROGRAM_ID): mainnet's
    // id is no program there.
    devnet: {
      program: address("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"),
      ammConfigs: [
        [0, 2500, 60],
        [1, 100, 1],
        [2, 500, 10],
      ],
    },
  },
  "pancakeswap-clmm": {
    "mainnet-beta": {
      program: address("HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq"),
      ammConfigs: [...RAYDIUM_CODE_CONFIGS, [20, 3000, 60], [21, 800, 1]],
    },
    // No devnet row: devnet's program keeps three pools, none with the three tick arrays its swap at
    // a price walks, so no swap there could be shown to run through the venue's namespace.
  },
  byreal: {
    "mainnet-beta": {
      program: address("REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2"),
      ammConfigs: [
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
      ],
    },
  },
  "stabble-clmm": {
    "mainnet-beta": {
      program: address("6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6"),
      ammConfigs: [
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
      ],
    },
    devnet: {
      program: address("6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6"),
      ammConfigs: [
        [0, 0, 1],
        [1, 2500, 1],
        [2, 2500, 1],
        [3, 2500, 1],
        [4, 2500, 1],
        [5, 2500, 1],
        [6, 2500, 1],
        [7, 2500, 1],
        [8, 2500, 1],
        [9, 100, 1],
        [10, 10000, 1],
        [11, 12500, 1],
        [12, 15000, 1],
        [13, 15000, 1],
        [14, 15000, 1],
        [15, 15000, 1],
      ],
    },
  },
  "orca-whirlpool": {
    "mainnet-beta": {
      program: address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
      config: address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"),
      feeTiers: [
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
    },
    // Orca's devnet WhirlpoolsConfig (its docs' "Whirlpool Parameters"), with tiers of its own.
    devnet: {
      program: address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
      config: address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),
      feeTiers: [
        [1, 1],
        [2, 2],
        [4, 4],
        [8, 8],
        [16, 16],
        [32, 32],
        [64, 64],
        [128, 128],
        [256, 256],
        [1025, 64],
        [2049, 128],
        [2050, 16],
        [2051, 64],
        [32896, 32896],
      ],
    },
  },
  cropper: {
    "mainnet-beta": {
      program: address("H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt"),
      config: address("2CmCWqXhw7f3jCnvJg74t4vsm62DTUbKQPWL7NX8oCpL"),
      feeTiers: [
        [1, 1],
        [2, 2],
        [4, 4],
        [8, 8],
        [16, 16],
        [64, 64],
        [128, 128],
        [256, 256],
      ],
    },
  },
  defituna: {
    "mainnet-beta": { program: address("fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9") },
    devnet: { program: address("fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9") },
  },
  // Crema's config is at one address on both clusters, each cluster's own account.
  crema: {
    "mainnet-beta": {
      program: address("CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR"),
      config: address("2rUWTKPfLnWDsEajZymGmZAEz8XcsTdo9gzKJfhsmpox"),
    },
    devnet: {
      program: address("CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR"),
      config: address("2rUWTKPfLnWDsEajZymGmZAEz8XcsTdo9gzKJfhsmpox"),
    },
  },
  phoenix: {
    "mainnet-beta": { program: address("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY") },
    devnet: { program: address("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY") },
  },
  "meteora-dlmm": {
    "mainnet-beta": { program: address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo") },
    devnet: { program: address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo") },
  },
};

/** `venue`'s row on `cluster`, or undefined where the cluster has none. */
export function svmVenueRow(
  venue: SvmNamespaceVenue,
  cluster: SvmTokenCluster | undefined,
): SvmVenueRow | undefined {
  return cluster === undefined ? undefined : SVM_VENUE_TABLE[venue][cluster];
}

/**
 * Why a venue a cluster deploys has no row there: its program is on the cluster, but no swap through
 * its namespace could be shown to run there.
 */
const WITHHELD: Readonly<
  Partial<Record<SvmNamespaceVenue, Partial<Record<SvmTokenCluster, string>>>>
> = {
  "pancakeswap-clmm": { devnet: "its devnet pools lack the tick arrays a swap at a price needs" },
};

/**
 * Why `venue` is withheld from `cluster` although its program is there; undefined for a venue with
 * a row there, and for one the cluster does not deploy.
 */
export function svmVenueWithheld(
  venue: SvmNamespaceVenue,
  cluster: SvmTokenCluster | undefined,
): string | undefined {
  return cluster === undefined ? undefined : WITHHELD[venue]?.[cluster];
}

/** `venue`'s program on Solana's mainnet, which the mainnet-only `Solana.<Venue>` adapters quote. */
export function svmMainnetProgram(venue: SvmNamespaceVenue): Address {
  return SVM_VENUE_TABLE[venue]["mainnet-beta"]!.program;
}

/**
 * The define each venue's program guard in `@sauce/router`'s Solana arm reads (`router.svm.js`):
 * the library writes no program id, so a compile that supplies none fails, naming it.
 */
export const SVM_ROUTER_PROGRAM_DEFINES: Readonly<Record<SvmNamespaceVenue, string>> = {
  "raydium-clmm": "__SAUCE_RAYDIUM_CLMM_PROGRAM",
  "pancakeswap-clmm": "__SAUCE_PANCAKESWAP_CLMM_PROGRAM",
  byreal: "__SAUCE_BYREAL_PROGRAM",
  "stabble-clmm": "__SAUCE_STABBLE_CLMM_PROGRAM",
  "orca-whirlpool": "__SAUCE_ORCA_WHIRLPOOL_PROGRAM",
  cropper: "__SAUCE_CROPPER_PROGRAM",
  defituna: "__SAUCE_DEFITUNA_PROGRAM",
  crema: "__SAUCE_CREMA_PROGRAM",
  phoenix: "__SAUCE_PHOENIX_PROGRAM",
  "meteora-dlmm": "__SAUCE_METEORA_DLMM_PROGRAM",
};

/**
 * What a guard takes for a venue a cluster lacks: an address of the System program's, which no
 * keypair holds and only the System program could sign as, which signs as none. No program can be
 * deployed there, so a guard of it admits no pool: a swap the program asks of it reverts, naming the
 * venue, as one at a pool of another program's does.
 */
export const SVM_NO_PROGRAM: Address = memoizedFindProgramAddressSync(
  address("11111111111111111111111111111111"),
  [new TextEncoder().encode("sauce:no venue program")],
)[0];

const routerDefines = new Map<SvmTokenCluster, Readonly<Record<string, bigint>>>();

/**
 * The defines a compile for `cluster` hands `@sauce/router`'s Solana arm: each venue's program on
 * that cluster, as its 32-byte key, and {@link SVM_NO_PROGRAM} for a venue the cluster lacks. The
 * same object for a cluster on every call.
 */
export function svmRouterDefines(cluster: SvmTokenCluster): Readonly<Record<string, bigint>> {
  let defines = routerDefines.get(cluster);
  if (defines === undefined) {
    defines = Object.freeze(
      Object.fromEntries(
        (Object.keys(SVM_ROUTER_PROGRAM_DEFINES) as SvmNamespaceVenue[]).map((venue) => {
          const program = svmVenueRow(venue, cluster)?.program ?? SVM_NO_PROGRAM;
          const key = getAddressEncoder().encode(program);
          return [
            SVM_ROUTER_PROGRAM_DEFINES[venue],
            BigInt(`0x${Array.from(key, (byte) => byte.toString(16).padStart(2, "0")).join("")}`),
          ];
        }),
      ),
    );
    routerDefines.set(cluster, defines);
  }

  return defines;
}
