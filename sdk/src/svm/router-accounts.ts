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

/** The venues `@sauce/router`'s Solana arm swaps, by the recipes' venue names: at a limit, then an
 *  exact input. */
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
  // The venues it swaps an exact input at, with no limit (`router.svm.js`'s EXACT INPUT section).
  "raydium-cp-swap": {
    program: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    data: "raydiumCpSwapData",
    cpi: "raydiumCpSwapCpi",
  },
  gamma: {
    program: "GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT",
    data: "gammaData",
    cpi: "gammaCpi",
  },
  "raydium-amm-v4": {
    program: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    data: "raydiumAmmV4Data",
    cpi: "raydiumAmmV4Cpi",
  },
  "orca-legacy-token-swap": {
    program: "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    data: "orcaLegacyTokenSwapData",
    cpi: "orcaLegacyTokenSwapCpi",
  },
  "orca-legacy-token-swap-stable": {
    program: "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    data: "orcaLegacyTokenSwapData",
    cpi: "orcaLegacyTokenSwapCpi",
  },
  "token-swap-v1": {
    program: "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8",
    data: "tokenSwapV1Data",
    cpi: "tokenSwapV1Cpi",
  },
  "orca-v1": {
    program: "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1",
    data: "orcaV1Data",
    cpi: "orcaV1Cpi",
  },
  penguin: {
    program: "PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP",
    data: "penguinData",
    cpi: "penguinCpi",
  },
  stepn: {
    program: "Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j",
    data: "stepnData",
    cpi: "stepnCpi",
  },
  saros: {
    program: "SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr",
    data: "sarosData",
    cpi: "sarosCpi",
  },
  fluxbeam: {
    program: "FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X",
    data: "fluxbeamData",
    cpi: "fluxbeamCpi",
  },
  dexlab: {
    program: "DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N",
    data: "dexlabData",
    cpi: "dexlabCpi",
  },
  "meteora-damm-v2": {
    program: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    data: "meteoraDammV2Data",
    cpi: "meteoraDammV2Cpi",
  },
  "meteora-damm-v1-cp": {
    program: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
    data: "meteoraDammV1Data",
    cpi: "meteoraDammV1Cpi",
  },
  "meteora-damm-v1-stable": {
    program: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
    data: "meteoraDammV1Data",
    cpi: "meteoraDammV1Cpi",
  },
  aldrin: {
    program: "AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6",
    data: "aldrinData",
    cpi: "aldrinCpi",
  },
  omnipair: {
    program: "omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE",
    data: "omnipairData",
    cpi: "omnipairCpi",
  },
  "saber-stableswap": {
    program: "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ",
    data: "saberData",
    cpi: "saberCpi",
  },
  "saber-decimals-wrapper": {
    program: "DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB",
    data: "saberDecimalsWrapperData",
    cpi: "saberDecimalsWrapperCpi",
  },
  "stabble-stable-swap": {
    program: "swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ",
    data: "stabbleStableSwapData",
    cpi: "stabbleStableSwapCpi",
  },
  "stabble-weighted-swap": {
    program: "swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW",
    data: "stabbleWeightedSwapData",
    cpi: "stabbleWeightedSwapCpi",
  },
  mercurial: {
    program: "MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky",
    data: "mercurialData",
    cpi: "mercurialCpi",
  },
  perena: {
    program: "NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P",
    data: "perenaData",
    cpi: "perenaCpi",
  },
  "metadao-futarchy": {
    program: "FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq",
    data: "metadaoFutarchyData",
    cpi: "metadaoFutarchyCpi",
  },
  "scale-amm": {
    program: "SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA",
    data: "scaleAmmData",
    cpi: "scaleAmmCpi",
  },
  pumpswap: {
    program: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    data: "pumpswapData",
    cpi: "pumpswapCpi",
  },
  bonkswap: {
    program: "BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p",
    data: "bonkswapData",
    cpi: "bonkswapCpi",
  },
  guacswap: {
    program: "Gswppe6ERWKpUTXvRPfXdzHhiCyJvLadVvXGfdpBqcE1",
    data: "guacswapData",
    cpi: "guacswapCpi",
  },
} as const;

export type RouterSvmVenue = keyof typeof ROUTER_SVM_VENUES;

/** The venues `@sauce/router` swaps an exact input at, with no price limit. */
export type RouterSvmExactInVenue = (typeof EXACT_IN_VENUES)[number];

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
  /**
   * Orca Whirlpools: the pool's fee is adaptive, so its classic `swap` writes the pool's oracle.
   * `swap_v2` declares the oracle writable whatever the fee, so with `v2` it is writable either way.
   */
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
  /** PumpSwap: the pool has a coin creator, so its swap takes the pool's v2 account. */
  readonly poolV2?: boolean;
  /** Scale AMM: how many fee beneficiaries the pool pays, each a token account at the end; 1 when
   *  absent. */
  readonly beneficiaries?: number;
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
  if (options.poolV2 !== undefined && venue !== "pumpswap") {
    throw new Error(`poolV2 is PumpSwap's alone, not ${venue}'s`);
  }
  if (options.beneficiaries !== undefined && venue !== "scale-amm") {
    throw new Error(`beneficiaries is Scale AMM's alone, not ${venue}'s`);
  }
  if (isExactInVenue(venue)) return exactInAccountOrder(venue, options);
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
      // `swap_v2` declares the oracle `mut` whatever the pool's fee (a read-only one is refused,
      // ConstraintMut); the classic `swap` writes it only for an adaptive fee.
      const oracle = options.v2 === true || options.adaptive === true ? w("oracle") : r("oracle");
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

/** The venues swapped at an exact input with no limit. */
const EXACT_IN_VENUES = [
  "raydium-cp-swap",
  "gamma",
  "raydium-amm-v4",
  "orca-legacy-token-swap",
  "orca-legacy-token-swap-stable",
  "token-swap-v1",
  "orca-v1",
  "penguin",
  "stepn",
  "saros",
  "fluxbeam",
  "dexlab",
  "meteora-damm-v2",
  "meteora-damm-v1-cp",
  "meteora-damm-v1-stable",
  "aldrin",
  "omnipair",
  "saber-stableswap",
  "saber-decimals-wrapper",
  "stabble-stable-swap",
  "stabble-weighted-swap",
  "mercurial",
  "perena",
  "metadao-futarchy",
  "scale-amm",
  "pumpswap",
  "bonkswap",
  "guacswap",
] as const satisfies readonly RouterSvmVenue[];
type ExactInVenue = (typeof EXACT_IN_VENUES)[number];
const isExactInVenue = (venue: RouterSvmVenue): venue is ExactInVenue =>
  (EXACT_IN_VENUES as readonly string[]).includes(venue);

/**
 * An exact-input venue's swap accounts. `aToB` pays the pool's first token: token 0 or A, X, the
 * base token (Aldrin, MetaDAO, PumpSwap), the underlying token (the Saber decimal wrapper).
 */
function exactInAccountOrder(
  venue: ExactInVenue,
  options: RouterSvmAccountOptions,
): RouterSvmAccountRole[] {
  const { aToB } = options;
  const [ownerA, ownerB] = owners(aToB);
  const paid = (a: string, b: string): RouterSvmAccountRole[] =>
    aToB ? [w(a), w(b)] : [w(b), w(a)];
  const read = (a: string, b: string): RouterSvmAccountRole[] =>
    aToB ? [r(a), r(b)] : [r(b), r(a)];
  switch (venue) {
    case "raydium-cp-swap":
    case "gamma":
      return [
        AUTHORITY,
        r("poolAuthority"),
        r("ammConfig"),
        w("pool"),
        w("source"),
        w("recipient"),
        ...paid("vaultA", "vaultB"),
        ...read("tokenProgramA", "tokenProgramB"),
        ...read("mintA", "mintB"),
        w("observation"),
      ];
    case "raydium-amm-v4":
      return [
        r("tokenProgram"),
        w("pool"),
        r("poolAuthority"),
        w("vaultA"),
        w("vaultB"),
        w("source"),
        w("recipient"),
        AUTHORITY,
      ];
    case "orca-legacy-token-swap":
    case "orca-legacy-token-swap-stable":
    case "token-swap-v1":
    case "orca-v1":
    case "penguin":
    case "stepn":
    case "saros":
    case "fluxbeam":
    case "dexlab": {
      const accounts = [
        r("pool"),
        r("poolAuthority"),
        AUTHORITY,
        w("source"),
        ...paid("vaultA", "vaultB"),
        w("recipient"),
        w("poolMint"),
        w("poolFeeAccount"),
      ];
      // The Token-2022 build names both mints and three token programs: each side's, the pool mint's.
      return venue === "fluxbeam" || venue === "dexlab"
        ? [
            ...accounts,
            ...read("mintA", "mintB"),
            ...read("tokenProgramA", "tokenProgramB"),
            r("poolTokenProgram"),
          ]
        : [...accounts, r("tokenProgram")];
    }
    case "meteora-damm-v2":
      return [
        r("poolAuthority"),
        w("pool"),
        w("source"),
        w("recipient"),
        w("vaultA"),
        w("vaultB"),
        r("mintA"),
        r("mintB"),
        AUTHORITY,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("program"),
        r("eventAuthority"),
        r("program"),
      ];
    case "meteora-damm-v1-cp":
    case "meteora-damm-v1-stable":
      return [
        w("pool"),
        w("source"),
        w("recipient"),
        w("vaultA"),
        w("vaultB"),
        w("tokenVaultA"),
        w("tokenVaultB"),
        w("lpMintA"),
        w("lpMintB"),
        w("vaultLpA"),
        w("vaultLpB"),
        w(aToB ? "protocolFeeA" : "protocolFeeB"),
        AUTHORITY,
        r("vaultProgram"),
        r("tokenProgram"),
      ];
    case "aldrin":
      return [
        r("pool"),
        r("poolSigner"),
        w("poolMint"),
        w("vaultA"),
        w("vaultB"),
        w("feeAccount"),
        AUTHORITY,
        ownerA,
        ownerB,
        r("tokenProgram"),
      ];
    case "omnipair":
      return [
        w("pool"),
        w("rateModel"),
        r("futarchyAuthority"),
        ...paid("vaultA", "vaultB"),
        w("source"),
        w("recipient"),
        ...read("mintA", "mintB"),
        AUTHORITY,
        r("tokenProgram"),
        r("token2022"),
        r("eventAuthority"),
        r("program"),
      ];
    case "saber-stableswap":
      return [
        r("pool"),
        r("poolAuthority"),
        AUTHORITY,
        w("source"),
        ...paid("vaultA", "vaultB"),
        w("recipient"),
        w(aToB ? "adminFeeB" : "adminFeeA"),
        r("tokenProgram"),
      ];
    case "saber-decimals-wrapper":
      return [
        r("pool"),
        w("wrapperMint"),
        w("underlyingVault"),
        AUTHORITY,
        ownerA,
        ownerB,
        r("tokenProgram"),
      ];
    case "stabble-stable-swap":
    case "stabble-weighted-swap":
      return [
        AUTHORITY,
        w("source"),
        w("recipient"),
        ...paid("vaultA", "vaultB"),
        w(aToB ? "beneficiaryB" : "beneficiaryA"),
        w("pool"),
        r("withdrawAuthority"),
        r("vault"),
        r("vaultAuthority"),
        r("vaultProgram"),
        r("tokenProgram"),
      ];
    case "mercurial":
      return [
        w("pool"),
        r("tokenProgram"),
        r("poolAuthority"),
        AUTHORITY,
        w("vaultA"),
        w("vaultB"),
        w("source"),
        w("recipient"),
      ];
    case "perena":
      return [
        w("pool"),
        ...paid("mintA", "mintB"),
        w("source"),
        w("recipient"),
        ...paid("vaultA", "vaultB"),
        r("numeraireConfig"),
        AUTHORITY,
        r("tokenProgram"),
        r("token2022"),
      ];
    case "metadao-futarchy":
      return [
        w("pool"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        AUTHORITY,
        r("tokenProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "scale-amm": {
      const count = options.beneficiaries ?? 1;
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`beneficiaries is a count, not ${count}`);
      }
      return [
        w("pool"),
        PAYER,
        r("poolOwner"),
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        w("platformFeeA"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("systemProgram"),
        r("platformConfig"),
        ...Array.from({ length: count }, (_, i) => w(`beneficiary${i}`)),
      ];
    }
    case "pumpswap":
      return [
        w("pool"),
        PAYER,
        r("globalConfig"),
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("protocolFeeRecipient"),
        w("protocolFeeRecipientTokenAccount"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("systemProgram"),
        r("associatedTokenProgram"),
        r("eventAuthority"),
        r("program"),
        w("coinCreatorVault"),
        r("coinCreatorVaultAuthority"),
        // A buy tracks the authority's volume, which a sell does not.
        ...(aToB ? [] : [r("globalVolumeAccumulator"), w("userVolumeAccumulator")]),
        r("feeConfig"),
        r("feeProgram"),
        ...(options.poolV2 === true ? [r("poolV2")] : []),
        r("buybackFeeRecipient"),
        w("buybackFeeRecipientTokenAccount"),
      ];
    case "bonkswap":
    case "guacswap":
      // The authority again as the referrer: the same three accounts, the authority not signing.
      return [
        r("state"),
        w("pool"),
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        PAYER,
        ownerA,
        ownerB,
        { name: "authority", writable: true, signer: false },
        r("programAuthority"),
        r("systemProgram"),
        r("tokenProgram"),
        r("associatedTokenProgram"),
        r("rent"),
      ];
    default: {
      const unknown: never = venue;
      throw new Error(`not a venue @sauce/router swaps at an exact input: ${String(unknown)}`);
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
