/**
 * The account order of each Solana swap `@sauce/router` builds, for a caller that keeps a venue's
 * account list itself: a router compiling one program per trade, which passes the accounts to
 * `<venue>Data`'s instruction or to `<venue>Cpi` in the venue's own order.
 *
 * `routerSvmAccountOrder(venue, options)` names each account of the venue's swap instruction, in
 * order, with whether the instruction writes it and whether it signs. `routerSvmAccounts(venue,
 * options, refs)` builds the list from `refs`, a value for each name: an address, a placeholder a
 * code generator resolves later, anything. A name the venue's swap takes and `refs` lacks throws.
 *
 * Names are the pool's, not the swap's: `vaultA` and `vaultB` (and `mintA`, `mintB`, `tokenProgramA`,
 * `tokenProgramB`) are the pool's first and second token's whatever the direction (token 0 or A,
 * Invariant's X, a market's base), and `aToB` says which one is paid; the order puts each where the
 * direction takes it. `source` is the paying token account, `recipient` the one the output lands in,
 * `authority` the account that signs for `source` (the Pot, through the Kitchen). `pool` is the
 * market on Phoenix, Manifest and OpenBook v2.
 *
 * The orders are those `router.svm.js`'s functions send, which its tests check, account for account
 * and role for role, against the instructions eco-incorp/sauce-recipes builds for the same pools.
 */

/** The venues `@sauce/router`'s Solana arm swaps at a limit, by the recipes' venue names. */
export const ROUTER_SVM_VENUES = {
  "raydium-clmm": {
    program: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    data: "raydiumClmmData",
    cpi: "raydiumClmmCpi",
  },
  "pancakeswap-clmm": {
    program: "HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq",
    data: "pancakeswapClmmData",
    cpi: "pancakeswapClmmCpi",
  },
  byreal: {
    program: "REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2",
    data: "byrealData",
    cpi: "byrealCpi",
  },
  "stabble-clmm": {
    program: "6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6",
    data: "stabbleClmmData",
    cpi: "stabbleClmmCpi",
  },
  "orca-whirlpool": {
    program: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    data: "orcaWhirlpoolData",
    cpi: "orcaWhirlpoolCpi",
  },
  cropper: {
    program: "H8W3ctz92svYg6mkn1UtGfu2aQr2fnUFHM1RhScEtQDt",
    data: "cropperData",
    cpi: "cropperCpi",
  },
  defituna: {
    program: "fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9",
    data: "defitunaData",
    cpi: "defitunaCpi",
  },
  crema: {
    program: "CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR",
    data: "cremaData",
    cpi: "cremaCpi",
  },
  phoenix: {
    program: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
    data: "phoenixData",
    cpi: "phoenixCpi",
  },
  invariant: {
    program: "HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt",
    data: "invariantData",
    cpi: "invariantCpi",
  },
  manifest: {
    program: "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms",
    data: "manifestData",
    cpi: "manifestCpi",
  },
  "openbook-v2": {
    program: "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb",
    data: "openbookV2Data",
    cpi: "openbookV2Cpi",
  },
} as const;

export type RouterSvmVenue = keyof typeof ROUTER_SVM_VENUES;

/** One account of a swap instruction: its name, and whether the instruction writes it and it signs. */
export interface RouterSvmAccountRole {
  readonly name: string;
  readonly writable: boolean;
  readonly signer: boolean;
}

/** One account of a swap instruction, with the caller's value for it. */
export interface RouterSvmAccount<T> extends RouterSvmAccountRole {
  readonly ref: T;
}

export interface RouterSvmAccountOptions {
  /** The swap pays the pool's first token: token 0 or A, Invariant's X, a market's base. */
  readonly aToB: boolean;
  /**
   * Orca Whirlpools: its `swap_v2`, which takes each mint and its token program, in place of the
   * classic `swap`, which takes SPL Token alone. `swap_v2` for any pool with a Token-2022 mint.
   */
  readonly v2?: boolean;
  /** Orca Whirlpools: the pool's fee is adaptive, so its swap writes the pool's oracle. */
  readonly adaptive?: boolean;
  /**
   * The Raydium-layout venues: pass the pool's tick-array bitmap extension, which the swap reads
   * past the pool's default range, before the tick arrays.
   */
  readonly bitmapExtension?: boolean;
  /**
   * How many tick arrays (Invariant: ticks) the swap takes, 1 to 3; 3 when absent. Crema refuses a
   * tick array its map does not mark and Invariant takes only the ticks it crosses, so those two
   * take fewer; the others take 3, the same array again where the walk needs fewer.
   */
  readonly tickArrays?: 1 | 2 | 3;
}

const r = (name: string): RouterSvmAccountRole => ({ name, writable: false, signer: false });
const w = (name: string): RouterSvmAccountRole => ({ name, writable: true, signer: false });
const AUTHORITY: RouterSvmAccountRole = { name: "authority", writable: false, signer: true };
const PAYER: RouterSvmAccountRole = { name: "authority", writable: true, signer: true };

const ticks = (prefix: string, count: number): RouterSvmAccountRole[] =>
  Array.from({ length: count }, (_, i) => w(`${prefix}${i}`));

/** Token A's and token B's accounts, as `source` and `recipient` by the direction. */
const owners = (aToB: boolean): [RouterSvmAccountRole, RouterSvmAccountRole] =>
  aToB ? [w("source"), w("recipient")] : [w("recipient"), w("source")];

/**
 * The accounts of `venue`'s swap instruction, in its order. `<venue>Data` and `<venue>Cpi` take
 * them in this order; the program is not among them (Phoenix's swap also takes its own program,
 * first, as `program`).
 */
export function routerSvmAccountOrder(
  venue: RouterSvmVenue,
  options: RouterSvmAccountOptions,
): RouterSvmAccountRole[] {
  const { aToB } = options;
  const count = options.tickArrays ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new Error(`tickArrays is 1, 2 or 3, not ${count}`);
  }
  if (count !== 3 && venue !== "crema" && venue !== "invariant") {
    throw new Error(`${venue}'s swap takes 3 tick arrays`);
  }
  if (options.v2 !== undefined && venue !== "orca-whirlpool") {
    throw new Error(`v2 is Orca Whirlpools' alone, not ${venue}'s`);
  }
  if (options.adaptive !== undefined && venue !== "orca-whirlpool") {
    throw new Error(`adaptive is Orca Whirlpools' alone, not ${venue}'s`);
  }
  const raydiumLayout =
    venue === "raydium-clmm" ||
    venue === "pancakeswap-clmm" ||
    venue === "byreal" ||
    venue === "stabble-clmm";
  if (options.bitmapExtension !== undefined && !raydiumLayout) {
    throw new Error(`bitmapExtension is the Raydium layout's alone, not ${venue}'s`);
  }
  const [ownerA, ownerB] = owners(aToB);
  switch (venue) {
    case "raydium-clmm":
    case "pancakeswap-clmm":
    case "byreal":
    case "stabble-clmm":
      return [
        AUTHORITY,
        r("ammConfig"),
        w("pool"),
        w("source"),
        w("recipient"),
        w(aToB ? "vaultA" : "vaultB"),
        w(aToB ? "vaultB" : "vaultA"),
        w("observation"),
        r("tokenProgram"),
        r("token2022"),
        r("memo"),
        r(aToB ? "mintA" : "mintB"),
        r(aToB ? "mintB" : "mintA"),
        ...(options.bitmapExtension === true ? [r("bitmapExtension")] : []),
        ...ticks("tickArray", 3),
      ];
    case "orca-whirlpool": {
      const oracle = options.adaptive === true ? w("oracle") : r("oracle");
      if (options.v2 === true) {
        return [
          r("tokenProgramA"),
          r("tokenProgramB"),
          r("memo"),
          AUTHORITY,
          w("pool"),
          r("mintA"),
          r("mintB"),
          ownerA,
          w("vaultA"),
          ownerB,
          w("vaultB"),
          ...ticks("tickArray", 3),
          oracle,
        ];
      }
      return [
        r("tokenProgram"),
        AUTHORITY,
        w("pool"),
        ownerA,
        w("vaultA"),
        ownerB,
        w("vaultB"),
        ...ticks("tickArray", 3),
        oracle,
      ];
    }
    case "cropper":
      return [
        r("tokenProgram"),
        AUTHORITY,
        w("pool"),
        ownerA,
        w("vaultA"),
        ownerB,
        w("vaultB"),
        ...ticks("tickArray", 3),
        r("oracle"),
      ];
    case "defituna":
      return [
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("memo"),
        AUTHORITY,
        w("pool"),
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        ...ticks("tickArray", 3),
      ];
    case "crema":
      return [
        r("clmmConfig"),
        w("pool"),
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        w("tickArrayMap"),
        AUTHORITY,
        r("tokenProgram"),
        ...ticks("tickArray", count),
      ];
    case "phoenix":
      return [
        r("program"),
        r("logAuthority"),
        w("pool"),
        AUTHORITY,
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("tokenProgram"),
      ];
    case "invariant":
      return [
        r("state"),
        w("pool"),
        w("tickmap"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        AUTHORITY,
        r("programAuthority"),
        r("tokenProgram"),
        ...ticks("tick", count),
      ];
    case "manifest":
      return [
        PAYER,
        w("pool"),
        r("systemProgram"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("tokenProgramA"),
        r("mintA"),
        r("tokenProgramB"),
        r("mintB"),
      ];
    case "openbook-v2":
      return [
        PAYER,
        PAYER,
        w("pool"),
        r("marketAuthority"),
        w("bids"),
        w("asks"),
        w("vaultA"),
        w("vaultB"),
        w("eventHeap"),
        ownerA,
        ownerB,
        r("oracleA"),
        r("oracleB"),
        r("tokenProgram"),
        r("systemProgram"),
        r("openOrdersAdmin"),
      ];
    default: {
      const unknown: never = venue;
      throw new Error(`not a venue @sauce/router swaps at a limit: ${String(unknown)}`);
    }
  }
}

/** `routerSvmAccountOrder`'s accounts, each with its value from `refs`. */
export function routerSvmAccounts<T>(
  venue: RouterSvmVenue,
  options: RouterSvmAccountOptions,
  refs: Readonly<Record<string, T>>,
): RouterSvmAccount<T>[] {
  return routerSvmAccountOrder(venue, options).map((role) => {
    if (!Object.hasOwn(refs, role.name)) {
      throw new Error(`${venue}'s swap takes ${role.name}, which refs does not name`);
    }
    return { ...role, ref: refs[role.name] as T };
  });
}
