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
  "meteora-dlmm": {
    program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    data: "meteoraDlmmData",
    cpi: "meteoraDlmmCpi",
  },
  "saros-dlmm": {
    program: "1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE",
    data: "sarosDlmmData",
    cpi: "sarosDlmmCpi",
  },
  "solfi-v2": {
    program: "SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF",
    data: "solfiV2Data",
    cpi: "solfiV2Cpi",
  },
  hadron: {
    program: "HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8",
    data: "hadronData",
    cpi: "hadronCpi",
  },
  taurusfi: {
    program: "9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc",
    data: "taurusfiData",
    cpi: "taurusfiCpi",
  },
  riptide: {
    program: "riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j",
    data: "riptideData",
    cpi: "riptideCpi",
  },
  denali: {
    program: "DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4",
    data: "denaliData",
    cpi: "denaliCpi",
  },
  gavel: {
    program: "srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi",
    data: "gavelData",
    cpi: "gavelCpi",
  },
  tesserav: {
    program: "TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH",
    data: "tesseravData",
    cpi: "tesseravCpi",
  },
  flint: {
    program: "FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z",
    data: "flintData",
    cpi: "flintCpi",
  },
  deriverse: {
    program: "DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD",
    data: "deriverseData",
    cpi: "deriverseCpi",
  },
  "goonfi-v2": {
    program: "goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE",
    data: "goonfiV2Data",
    cpi: "goonfiV2Cpi",
  },
  "meteora-dbc": {
    program: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    data: "meteoraDbcData",
    cpi: "meteoraDbcCpi",
  },
  trends: {
    program: "CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz",
    data: "trendsData",
    cpi: "trendsCpi",
  },
  heaven: {
    program: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o",
    data: "heavenData",
    cpi: "heavenCpi",
  },
  virtuals: {
    program: "5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki",
    data: "virtualsData",
    cpi: "virtualsCpi",
  },
  "raydium-launchlab": {
    program: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
    data: "raydiumLaunchlabData",
    cpi: "raydiumLaunchlabCpi",
  },
  "runner-rodeo": {
    program: "runnrXXdsSRkdueCRYxKDvSWfv6nAnrG5dcM29qj1HA",
    data: "runnerRodeoData",
    cpi: "runnerRodeoCpi",
  },
  "scale-vmm": {
    program: "SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa",
    data: "scaleVmmData",
    cpi: "scaleVmmCpi",
  },
  xorca: {
    program: "StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT",
    data: "xorcaData",
    cpi: "xorcaCpi",
  },
  solayer: {
    program: "endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT",
    data: "solayerData",
    cpi: "solayerCpi",
  },
  voltr: {
    program: "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
    data: "voltrData",
    cpi: "voltrCpi",
  },
  "vault-liquid-unstake": {
    program: "2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo",
    data: "vaultLiquidUnstakeData",
    cpi: "vaultLiquidUnstakeCpi",
  },
  "hylo-stability-pool": {
    program: "HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ",
    data: "hyloStabilityPoolData",
    cpi: "hyloStabilityPoolCpi",
  },
  huma: {
    program: "HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn",
    data: "humaData",
    cpi: "humaCpi",
  },
  "helium-treasury": {
    program: "treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5",
    data: "heliumTreasuryData",
    cpi: "heliumTreasuryCpi",
  },
  "jupiter-lend-earn": {
    program: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
    data: "jupiterLendEarnData",
    cpi: "jupiterLendEarnCpi",
  },
  hylo: {
    program: "HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn",
    data: "hyloData",
    cpi: "hyloCpi",
  },
  carrot: {
    program: "CarrotwivhMpDnm27EHmRLeQ683Z1PufuqEmBZvD282s",
    data: "carrotData",
    cpi: "carrotCpi",
  },
  mswap: {
    program: "MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH",
    data: "mswapData",
    cpi: "mswapCpi",
  },
  "perps-jlp": {
    program: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
    data: "perpsJlpData",
    cpi: "perpsJlpCpi",
  },
  "perps-jlp-mint": {
    program: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
    data: "perpsJlpMintData",
    cpi: "perpsJlpMintCpi",
  },
  "sanctum-infinity": {
    program: "5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx",
    data: "sanctumInfinityData",
    cpi: "sanctumInfinityCpi",
  },
  "solfi-v1": {
    program: "SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe",
    data: "solfiV1Data",
    cpi: "solfiV1Cpi",
  },
  archer: {
    program: "Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy",
    data: "archerData",
    cpi: "archerCpi",
  },
  // `@sauce/router` has no function for these, only their account order and data template:
  // - a Pot cannot send their swap: One Intro requires its signer owned by the System program,
  //   BisonFi a signature from the authorization account its routing program signs for, and a
  //   Sanctum stake pool's deposit takes native SOL from its signer;
  // - WOOFi's keepers stopped (its oracles last updated 2026-04-20 and 2025-11-23): on mainnet
  //   state its swap refuses every price as infeasible (WooOracleNotFeasible) at any clock, so no
  //   swap of it can be proven;
  // - Metric's oracle refuses its price as stale (its error 20, on mainnet itself on 2026-10-07),
  //   so no swap of it can be proven either.
  "one-intro-swap": {
    program: "DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm",
    data: null,
    cpi: null,
  },
  woofi: {
    program: "WooFif76YGRNjk1pA8wCsN67aQsD9f9iLsz4NcJ1AVb",
    data: null,
    cpi: null,
  },
  metric: {
    program: "Bvs46DPFxiFE6YHxLDLD6QAUcmy51FyRVPZJusPxLk3j",
    data: null,
    cpi: null,
  },
  // These three admit a swap only from a router on their own list, which a Pot is not: Quantum
  // compares the transaction's outermost program with its list, Obsidian and AlphaQ the caller's.
  // eco-incorp/sauce-recipes holds them back until that changes; their order and template are its
  // instruction for when it does.
  quantum: {
    program: "QuaNtZsgYRe5Z9Bk4LZ4cTD9tbkVoyCNf1R2BN9bBDv",
    data: null,
    cpi: null,
  },
  obsidian: {
    program: "HBVw6bZtcCaezhcBrmfyXBSBRWCdv72271xQ4GPvms2z",
    data: null,
    cpi: null,
  },
  alphaq: {
    program: "ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA",
    data: null,
    cpi: null,
  },
  // These three bonding curves settle in native SOL on their signer, which a Pot cannot pay or be
  // paid in: eco-incorp/sauce-recipes wraps them in its own native-SOL bridge.
  "pumpfun-bonding-curve": {
    program: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    data: null,
    cpi: null,
  },
  "boop-fun": {
    program: "boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4",
    data: null,
    cpi: null,
  },
  moonit: {
    program: "MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG",
    data: null,
    cpi: null,
  },
  bisonfi: {
    program: "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi",
    data: null,
    cpi: null,
  },
  "sanctum-stake-pool": {
    program: "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
    data: null,
    cpi: null,
  },
  "sanctum-stake-pool-2": {
    program: "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY",
    data: null,
    cpi: null,
  },
  "sanctum-stake-pool-3": {
    program: "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn",
    data: null,
    cpi: null,
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
  /** Scale AMM and Scale vMM: how many fee beneficiaries the pool pays, each a token account at the
   *  end; 1 when absent. */
  readonly beneficiaries?: number;
  /** Carrot: how many assets its vault holds, each an account and an oracle at the end; 3 when
   *  absent. */
  readonly assets?: number;
  /** Jupiter Perpetuals' JLP mint: how many custodies its pool holds, each a custody and its oracle
   *  at the end; 6 when absent. */
  /** Archer: how many makers the swap takes, each at the end; 1 when absent. */
  readonly makers?: number;
  readonly custodies?: number;
  /** Sanctum Infinity: how many accounts the paid and the bought token's calculator takes, 1 for
   *  wrapped SOL's and 5 for a stake pool's; 5 when absent. */
  readonly inCalcAccounts?: 1 | 5;
  readonly outCalcAccounts?: 1 | 5;
  /** Meteora DLMM: how many bin arrays the swap crosses, from the active bin's onwards in the trade's
   *  direction; 3 when absent. */
  readonly binArrays?: number;
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
  if (options.beneficiaries !== undefined && venue !== "scale-amm" && venue !== "scale-vmm") {
    throw new Error(`beneficiaries is Scale's alone, not ${venue}'s`);
  }
  if (options.binArrays !== undefined && venue !== "meteora-dlmm") {
    throw new Error(`binArrays is Meteora DLMM's alone, not ${venue}'s`);
  }
  if (options.assets !== undefined && venue !== "carrot") {
    throw new Error(`assets is Carrot's alone, not ${venue}'s`);
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
  "meteora-dlmm",
  "saros-dlmm",
  "solfi-v2",
  "hadron",
  "taurusfi",
  "riptide",
  "denali",
  "gavel",
  "tesserav",
  "flint",
  "deriverse",
  "goonfi-v2",
  "meteora-dbc",
  "trends",
  "heaven",
  "virtuals",
  "raydium-launchlab",
  "runner-rodeo",
  "scale-vmm",
  "xorca",
  "solayer",
  "voltr",
  "vault-liquid-unstake",
  "hylo-stability-pool",
  "huma",
  "helium-treasury",
  "jupiter-lend-earn",
  "hylo",
  "carrot",
  "mswap",
  "perps-jlp",
  "perps-jlp-mint",
  "sanctum-infinity",
  "one-intro-swap",
  "solfi-v1",
  "woofi",
  "bisonfi",
  "sanctum-stake-pool",
  "sanctum-stake-pool-2",
  "sanctum-stake-pool-3",
  "archer",
  "metric",
  "quantum",
  "obsidian",
  "alphaq",
  "pumpfun-bonding-curve",
  "boop-fun",
  "moonit",
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
    case "meteora-dlmm": {
      // No bitmap extension or no host fee account: the program itself in its place.
      const count = options.binArrays ?? 3;
      if (!Number.isInteger(count) || count < 1)
        throw new Error(`binArrays is a count, not ${count}`);
      return [
        w("pool"),
        w("bitmapExtension"),
        w("vaultA"),
        w("vaultB"),
        w("source"),
        w("recipient"),
        r("mintA"),
        r("mintB"),
        w("oracle"),
        r("hostFee"),
        AUTHORITY,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("eventAuthority"),
        r("program"),
        ...Array.from({ length: count }, (_, i) => w(`binArray${i}`)),
      ];
    }
    case "saros-dlmm":
      // No hook: the program itself as the hook and its program.
      return [
        w("pool"),
        r("mintA"),
        r("mintB"),
        w("binArrayLower"),
        w("binArrayUpper"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        AUTHORITY,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("memo"),
        r("hook"),
        r("hookProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "solfi-v2":
      return [
        PAYER,
        w("pool"),
        r("oracle"),
        w("registry"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        r("mintA"),
        r("mintB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("instructionsSysvar"),
      ];
    case "hadron":
      return [
        r("tokenProgram"),
        r("tokenProgram"),
        w("pool"),
        w("assetConfigA"),
        w("assetConfigB"),
        w("growingA"),
        w("pool"),
        AUTHORITY,
        w("source"),
        ...paid("vaultA", "vaultB"),
        w("recipient"),
        w("globalConfig"),
        w(aToB ? "feeVaultA" : "feeVaultB"),
        r("clock"),
        w("metadataA"),
      ];
    case "taurusfi":
      return [
        w("vaultA"),
        w("vaultB"),
        PAYER,
        ownerA,
        ownerB,
        w("vaultAuthority"),
        r("globalConfig"),
        r("pool"),
        r("globalAuthority"),
        ...read("tokenProgramA", "tokenProgramB"),
        ...read("mintA", "mintB"),
        r("instructionsSysvar"),
      ];
    case "riptide":
      return [
        AUTHORITY,
        w("pool"),
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("memo"),
        r("instructionsSysvar"),
        r("dontFront"),
      ];
    case "denali":
      return [
        AUTHORITY,
        w("pool"),
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("oracle"),
        r("globalConfig"),
        ownerA,
        ownerB,
      ];
    case "gavel":
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
    case "tesserav":
      if (!aToB) throw new Error("Tessera V sells only its token A");
      return [
        r("poolAuthority"),
        w("pool"),
        AUTHORITY,
        w("vaultA"),
        w("vaultB"),
        w("source"),
        w("recipient"),
        r("mintA"),
        r("mintB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("instructionsSysvar"),
        r("config"),
        r("oracle"),
      ];
    case "flint":
      return [
        AUTHORITY,
        r("instructionsSysvar"),
        ...paid("marketA", "marketB"),
        w("source"),
        w(aToB ? "vaultA" : "vaultB"),
        w("recipient"),
        w(aToB ? "vaultB" : "vaultA"),
        ...read("tokenProgramA", "tokenProgramB"),
        r("program"),
      ];
    case "deriverse":
      // Selling the asset takes the bids, buying it the asks.
      return [
        PAYER,
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        w("pool"),
        ...(aToB ? [w("bidsTree"), w("bidOrders")] : [w("asksTree"), w("askOrders")]),
        w("lines"),
        w("maps"),
        w("clientInfos"),
        ownerA,
        ownerB,
        r("tokenProgram"),
      ];
    case "goonfi-v2":
      return [
        PAYER,
        w("pool"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("mintA"),
        r("mintB"),
        r("oracle"),
        r("globalConfig"),
        r("instructionsSysvar"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("validator"),
      ];
    case "meteora-dbc":
      return [
        r("poolAuthority"),
        r("config"),
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
    case "trends":
      return [
        r("config"),
        w("pool"),
        r("poolAuthority"),
        w("source"),
        w("recipient"),
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        AUTHORITY,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("program"),
        r("eventAuthority"),
        r("program"),
      ];
    case "heaven":
      return [
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("associatedTokenProgram"),
        r("systemProgram"),
        w("pool"),
        PAYER,
        r("mintA"),
        r("mintB"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        w("protocolConfig"),
        r("instructionsSysvar"),
        r("chainlink"),
        r("solUsdFeed"),
      ];
    case "virtuals":
      if (!aToB) throw new Error("Virtuals' buy takes the tokens bought, not what to pay");
      return [
        AUTHORITY,
        w("pool"),
        r("mintA"),
        w("recipient"),
        w("source"),
        w("poolTokenAccount"),
        w("platform"),
        w("platformVirtualsAccount"),
        w("poolVirtualsAccount"),
        r("tokenProgram"),
      ];
    case "raydium-launchlab":
      return [
        PAYER,
        r("poolAuthority"),
        r("globalConfig"),
        r("platformConfig"),
        w("pool"),
        ownerA,
        ownerB,
        w("vaultA"),
        w("vaultB"),
        r("mintA"),
        r("mintB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("eventAuthority"),
        r("program"),
        r("systemProgram"),
        w("platformVault"),
        w("creatorVault"),
      ];
    case "runner-rodeo":
      return [
        r("poolAuthority"),
        PAYER,
        r("config"),
        w("pool"),
        w("source"),
        w("recipient"),
        w("vaultA"),
        w("vaultB"),
        w("protocolFeeA"),
        w("protocolFeeB"),
        w("creatorFee"),
        r("mintA"),
        r("mintB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("systemProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "scale-vmm": {
      const count = options.beneficiaries ?? 1;
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`beneficiaries is a count, not ${count}`);
      }
      return [
        w("pool"),
        PAYER,
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
        r("ammProgram"),
        w("ammPool"),
        w("ammVaultA"),
        w("ammVaultB"),
        r("ammConfig"),
        ...Array.from({ length: count }, (_, i) => w(`beneficiary${i}`)),
      ];
    }
    case "xorca":
      if (!aToB) throw new Error("xORCA only stakes");
      return [
        PAYER,
        w("vault"),
        w("source"),
        w("recipient"),
        w("mintB"),
        r("pool"),
        r("mintA"),
        r("tokenProgram"),
      ];
    case "solayer":
      return [
        AUTHORITY,
        r("pool"),
        w("receiptMint"),
        w("vault"),
        r("lstMint"),
        ownerA,
        ownerB,
        r("tokenProgram"),
      ];
    case "voltr":
      // A withdrawal writes the idle authority and takes no LP mint authority.
      return [
        AUTHORITY,
        r("protocol"),
        w("pool"),
        r("mintA"),
        w("mintB"),
        w("source"),
        w("idleAccount"),
        aToB ? r("idleAuthority") : w("idleAuthority"),
        w("recipient"),
        ...(aToB ? [r("lpMintAuthority")] : []),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("systemProgram"),
      ];
    case "vault-liquid-unstake":
      if (!aToB) throw new Error("the liquid-unstake vault only unstakes");
      // The program requires the authority writable.
      return [
        w("globalPool"),
        w("poolLstAccount"),
        PAYER,
        w("source"),
        w("recipient"),
        r("mintA"),
        r("stakePool"),
        w("pool"),
        w("solVault"),
        w("feeAccount"),
        w("inventorySummary"),
        r("tokenProgram"),
        r("systemProgram"),
      ];
    case "hylo-stability-pool":
      return aToB
        ? [
            PAYER,
            r("pool"),
            r("hylo"),
            r("mintA"),
            w("source"),
            w("recipient"),
            r("poolAuthority"),
            w("stablecoinPool"),
            r("lpTokenAuthority"),
            w("mintB"),
            r("tokenProgram"),
            r("eventAuthority"),
            r("program"),
          ]
        : [
            PAYER,
            w("pool"),
            r("hylo"),
            r("mintA"),
            w("recipient"),
            r("feeAuthority"),
            w("feeVault"),
            w("source"),
            r("poolAuthority"),
            w("stablecoinPool"),
            w("mintB"),
            r("tokenProgram"),
            r("eventAuthority"),
            r("program"),
          ];
    case "huma":
      if (!aToB) throw new Error("Huma only deposits here");
      return [
        AUTHORITY,
        r("humaConfig"),
        r("poolConfig"),
        w("poolState"),
        r("pool"),
        w("mintB"),
        r("poolAuthority"),
        r("mintA"),
        w("poolUnderlying"),
        w("source"),
        w("recipient"),
        r("tokenProgramA"),
        r("tokenProgramB"),
      ];
    case "helium-treasury":
      if (!aToB) throw new Error("Helium's treasury only redeems");
      return [
        r("pool"),
        r("mintB"),
        w("mintA"),
        w("treasury"),
        w("circuitBreaker"),
        w("source"),
        w("recipient"),
        AUTHORITY,
        r("circuitBreakerProgram"),
        r("tokenProgram"),
      ];
    case "jupiter-lend-earn": {
      const lending = [w("mintB"), w("reserve"), w("supplyPosition"), r("rateModel"), w("vault")];
      const tail = [
        w("liquidity"),
        r("liquidityProgram"),
        r("rewardsRateModel"),
        r("tokenProgram"),
        r("associatedTokenProgram"),
        r("systemProgram"),
      ];
      return aToB
        ? [
            PAYER,
            w("source"),
            w("recipient"),
            r("mintA"),
            r("lendingAdmin"),
            w("pool"),
            ...lending,
            ...tail,
          ]
        : [
            PAYER,
            w("source"),
            w("recipient"),
            r("lendingAdmin"),
            w("pool"),
            r("mintA"),
            ...lending,
            r("claimAccount"),
            ...tail,
          ];
    }
    case "hylo":
      // Token A is USDC, B hyUSD; the authority's hyUSD account comes first.
      return [
        AUTHORITY,
        r("hylo"),
        w("pool"),
        r("stablecoinAuthority"),
        r("usdcVaultAuthority"),
        r("usdcFeeAuthority"),
        r("stablecoinFeeAuthority"),
        w("vault"),
        w("usdcFeeVault"),
        w("stablecoinFeeVault"),
        ownerB,
        ownerA,
        w("mintB"),
        r("mintA"),
        r("pyth"),
        r("tokenProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "carrot": {
      const count = options.assets ?? 3;
      if (!Number.isInteger(count) || count < 1) throw new Error(`assets is a count, not ${count}`);
      // Token A is the asset paid or bought, B CRT; the authority's CRT account comes first.
      return [
        w("pool"),
        w("mintB"),
        ownerB,
        r("mintA"),
        w("assetVault"),
        ownerA,
        PAYER,
        r("systemProgram"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("logProgram"),
        ...Array.from({ length: count }, (_, i) => [w(`assetAccount${i}`), r(`oracle${i}`)]).flat(),
      ];
    }
    case "mswap":
      // Named for the trade, as the pool is the pair the way it is paid: the paying extension's
      // first of each pair.
      return [
        AUTHORITY,
        r("wrapAuthority"),
        r("unwrapAuthority"),
        r("swapGlobal"),
        w("globalIn"),
        w("globalOut"),
        w("mintIn"),
        w("mintOut"),
        r("mMint"),
        w("source"),
        w("recipient"),
        w("swapMAccount"),
        r("mVaultAuthorityIn"),
        r("mVaultAuthorityOut"),
        r("mintAuthorityIn"),
        r("mintAuthorityOut"),
        w("mVaultIn"),
        w("mVaultOut"),
        r("tokenProgramIn"),
        r("tokenProgramOut"),
        r("mTokenProgram"),
        r("extProgramIn"),
        r("extProgramOut"),
        r("systemProgram"),
      ];
    case "perps-jlp":
      // Named for the trade: the JLP pool holds a basket, not a pair.
      return [
        AUTHORITY,
        w("source"),
        w("recipient"),
        r("transferAuthority"),
        r("perpetuals"),
        w("pool"),
        w("custodyIn"),
        r("dovesOracleIn"),
        r("pythnetOracleIn"),
        w("custodyTokenAccountIn"),
        w("custodyOut"),
        r("dovesOracleOut"),
        r("pythnetOracleOut"),
        w("custodyTokenAccountOut"),
        r("tokenProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "perps-jlp-mint": {
      if (!aToB) throw new Error("Jupiter Perpetuals' JLP pool only mints here");
      const count = options.custodies ?? 6;
      if (!Number.isInteger(count) || count < 1)
        throw new Error(`custodies is a count, not ${count}`);
      return [
        AUTHORITY,
        w("source"),
        w("recipient"),
        r("transferAuthority"),
        r("perpetuals"),
        w("pool"),
        w("custody"),
        r("dovesOracle"),
        r("pythnetOracle"),
        w("custodyTokenAccount"),
        w("lpMint"),
        r("tokenProgram"),
        r("eventAuthority"),
        r("program"),
        ...Array.from({ length: count }, (_, i) => r(`custody${i}`)),
        ...Array.from({ length: count }, (_, i) => r(`oracle${i}`)),
      ];
    }
    case "sanctum-infinity": {
      // Named for the trade, as the pool is the pair the way it is paid.
      const calculator = (
        side: "In" | "Out",
        count: number | undefined,
      ): RouterSvmAccountRole[] => {
        const accounts = count ?? 5;
        if (accounts !== 1 && accounts !== 5)
          throw new Error(`a calculator takes 1 account or 5, not ${accounts}`);
        return accounts === 1
          ? [r(`calcProgram${side}`)]
          : [
              r(`calcProgram${side}`),
              r(`calcState${side}`),
              r(`stakePool${side}`),
              r(`stakePoolProgram${side}`),
              r(`stakePoolProgramData${side}`),
            ];
      };
      return [
        AUTHORITY,
        r("mintIn"),
        r("mintOut"),
        w("source"),
        w("recipient"),
        r("tokenProgramIn"),
        r("tokenProgramOut"),
        w("poolState"),
        w("lstStateList"),
        w("reservesIn"),
        w("reservesOut"),
        ...calculator("In", options.inCalcAccounts),
        ...calculator("Out", options.outCalcAccounts),
        r("pricingProgram"),
        r("slab"),
      ];
    }
    case "one-intro-swap":
      // A swap paying token A takes the first two fee accounts, one paying token B the last two.
      return [
        r("metadata"),
        w("pool"),
        r("poolAuthority"),
        ...paid("vaultA", "vaultB"),
        PAYER,
        w("source"),
        w("recipient"),
        ...(aToB ? [w("feeA0"), w("feeB0")] : [w("feeA1"), w("feeB1")]),
        r("tokenProgram"),
      ];
    case "solfi-v1":
      return [
        AUTHORITY,
        w("pool"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        r("tokenProgram"),
        r("instructionsSysvar"),
      ];
    case "woofi": {
      // Token A is the base, B the quote; `aToB` sells the base. The swap takes the quote token's
      // pool, price update and vault again, and the rebate's recipient, the authority, unsigned.
      const [from, to] = aToB ? ["A", "B"] : ["B", "A"];
      return [
        r("wooconfig"),
        r("tokenProgram"),
        AUTHORITY,
        w(`wooracle${from}`),
        w(`woopool${from}`),
        w("source"),
        w(`vault${from}`),
        w(`priceUpdate${from}`),
        w(`wooracle${to}`),
        w(`woopool${to}`),
        w("recipient"),
        w(`vault${to}`),
        w(`priceUpdate${to}`),
        w("woopoolB"),
        r("priceUpdateB"),
        w("vaultB"),
        r("authority"),
      ];
    }
    case "bisonfi":
      return [
        AUTHORITY,
        w("pool"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("authorization"),
      ];
    case "sanctum-stake-pool":
    case "sanctum-stake-pool-2":
    case "sanctum-stake-pool-3":
      // `DepositSol`: the authority pays native SOL, so it is writable.
      if (!aToB) throw new Error("a Sanctum stake pool only deposits here");
      return [
        w("pool"),
        r("withdrawAuthority"),
        w("reserveStake"),
        PAYER,
        w("recipient"),
        w("managerFeeAccount"),
        w("referrerFeeAccount"),
        w("poolMint"),
        r("systemProgram"),
        r("tokenProgram"),
      ];
    case "archer": {
      // Token A is the market's base, B its quote; `aToB` sells the base. The authority's quote
      // account comes twice.
      const count = options.makers ?? 1;
      if (!Number.isInteger(count) || count < 1) throw new Error(`makers is a count, not ${count}`);
      const quote = aToB ? w("recipient") : w("source");
      return [
        PAYER,
        w("pool"),
        quote,
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        aToB ? w("source") : w("recipient"),
        quote,
        r("tokenProgramA"),
        r("tokenProgramB"),
        ...Array.from({ length: count }, (_, i) => w(`maker${i}`)),
      ];
    }
    case "metric":
      // The swap prices off its oracle, by a CPI to `oracleProgram` on `oracleConfig` and
      // `priceAccount`.
      return [
        AUTHORITY,
        w("pool"),
        r("mintA"),
        r("mintB"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("systemProgram"),
        r("program"),
        r("oracleProgram"),
        w("oracleConfig"),
        w("priceAccount"),
      ];
    case "quantum":
      // Token 0 is A.
      return [
        AUTHORITY,
        ownerA,
        ownerB,
        w("pool"),
        w("vaultA"),
        w("vaultB"),
        r("global"),
        r("tokenProgram"),
        r("clock"),
        r("instructionsSysvar"),
      ];
    case "obsidian":
      return [
        AUTHORITY,
        w("pool"),
        w("vaultA"),
        w("vaultB"),
        ownerA,
        ownerB,
        r("tokenProgram"),
        r("instructionsSysvar"),
      ];
    case "alphaq":
      // The data says the direction; the order is the same both ways, the vaults three times.
      return [
        AUTHORITY,
        r("pool"),
        w("stats"),
        w("source"),
        w("recipient"),
        w("vaultA"),
        w("vaultB"),
        r("vaultA"),
        r("vaultB"),
        w("vaultB"),
        r("tokenProgram"),
        r("instructionsSysvar"),
      ];
    case "pumpfun-bonding-curve":
      // Token A is the launched token, B wrapped SOL; `aToB` sells A. The user's A account comes
      // first; a buy also takes the global volume accumulator.
      return [
        r("global"),
        r("mintA"),
        r("mintB"),
        r("tokenProgramA"),
        r("tokenProgramB"),
        r("associatedTokenProgram"),
        w("feeRecipient"),
        w("feeRecipientB"),
        w("buybackFeeRecipient"),
        w("buybackFeeRecipientB"),
        w("pool"),
        w("vaultA"),
        w("vaultB"),
        PAYER,
        ownerA,
        ownerB,
        w("creatorVault"),
        w("creatorVaultB"),
        r("sharingConfig"),
        ...(aToB ? [] : [r("globalVolumeAccumulator")]),
        w("userVolumeAccumulator"),
        w("userVolumeAccumulatorB"),
        r("feeConfig"),
        r("feeProgram"),
        r("systemProgram"),
        r("eventAuthority"),
        r("program"),
      ];
    case "boop-fun":
      // Token A is the launched token, B wrapped SOL, which the curve holds as native SOL; `aToB`
      // sells A, paying the SOL to the authority.
      return aToB
        ? [
            r("mintA"),
            w("pool"),
            w("tradingFeesVault"),
            w("vaultA"),
            w("vaultB"),
            w("source"),
            PAYER,
            { name: "authority", writable: true, signer: false },
            r("config"),
            r("systemProgram"),
            r("tokenProgram"),
            r("associatedTokenProgram"),
          ]
        : [
            r("mintA"),
            w("pool"),
            w("tradingFeesVault"),
            w("vaultA"),
            w("vaultB"),
            w("recipient"),
            PAYER,
            r("config"),
            r("vaultAuthority"),
            r("mintB"),
            r("systemProgram"),
            r("tokenProgram"),
            r("associatedTokenProgram"),
          ];
    case "moonit":
      // Token A is the launched token; `aToB` sells it. The authority pays or is paid native SOL.
      return [
        PAYER,
        aToB ? w("source") : w("recipient"),
        w("pool"),
        w("vaultA"),
        w("dexFee"),
        w("helioFee"),
        r("mintA"),
        r("config"),
        r("tokenProgram"),
        r("associatedTokenProgram"),
        r("systemProgram"),
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
