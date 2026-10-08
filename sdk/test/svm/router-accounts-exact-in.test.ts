/**
 * `routerSvmAccountOrder`/`routerSvmAccounts` for the venues `@sauce/router` swaps an exact input at,
 * against the instructions eco-incorp/sauce-recipes builds (`std/router/fixtures/exact-in-vectors.json`):
 * for every vector, the list built from the vector's own accounts by the recipes' role names is the
 * vector's, account for account, writable for writable and signer for signer, and each venue's
 * program is the one its instruction names. The engine suite (`std/router/svm-exact-in.e2e.test.ts`)
 * proves `router.svm.js` sends those same instructions.
 */
import { readFileSync } from "node:fs";

import { ROUTER_SVM_VENUES, routerSvmAccounts } from "../../src/svm/router-accounts.js";
import type { RouterSvmAccountOptions, RouterSvmVenue } from "../../src/svm/router-accounts.js";

interface Vector {
  venue: string;
  direction: string | null;
  program: string;
  accounts: {
    user?: string;
    address?: string;
    ref?: string;
    role?: string;
    writable?: boolean;
    signer?: boolean;
  }[];
}
const VECTORS = (
  JSON.parse(
    readFileSync(new URL("../std/router/fixtures/exact-in-vectors.json", import.meta.url), "utf8"),
  ) as { vectors: Record<string, Vector> }
).vectors;

/** Whether a vector pays the pool's first token, from the direction its key names. */
const FIRST: Record<string, boolean> = {
  "0to1": true,
  "1to0": false,
  coinToPc: true,
  pcToCoin: false,
  AtoB: true,
  BtoA: false,
  aToB: true,
  bToA: false,
  baseToQuote: true,
  quoteToBase: false,
  xToY: true,
  yToX: false,
  deposit: true,
  withdraw: false,
  buy: false,
  sell: true,
  "0": true,
  "1": false,
  baseIn: true,
  quoteIn: false,
  orcaToXorca: true,
  delegate: true,
  undelegate: false,
  assetToLp: true,
  lpToAsset: false,
  redeem: false,
  lstToSol: true,
  issue0: true,
  redeem0: false,
  // Named for the trade, these take no direction: the first way is the way the key names.
  wmToDawn: true,
  dawnToWm: true,
  solToUsdc: true,
  usdcToSol: true,
  usdc: true,
  wsolToJito: true,
  jitoToWsol: true,
  jupToSctm: true,
  sellBase: true,
  sellQuote: false,
  zeroIn: true,
  oneIn: false,
};

/** A vector whose direction's name says the other way: Helium's redemption pays its supply token,
 *  the pool's first. */
const PAYS_FIRST: Record<string, boolean> = { "helium-treasury:Aon7:redeem": true };

/** The venues whose program requires the authority writable where the recipes' instruction leaves it
 *  read-only: their signer also pays the transaction's fee, which writes it anyway; a Pot does not. */
const WRITES_AUTHORITY = new Set(["vault-liquid-unstake"]);

const flip = (aToB: boolean, a: string, b: string): [string, string] => (aToB ? [a, b] : [b, a]);

/** Each of this module's names, as the recipes' role for that account, by venue family. */
const ROLES: Record<string, (aToB: boolean, vector: Vector) => Record<string, string>> = {
  cp: (aToB) => {
    const [va, vb] = flip(aToB, "vin", "vout");
    const [ta, tb] = flip(aToB, "tpin", "tpout");
    const [ma, mb] = flip(aToB, "min", "mout");
    return {
      poolAuthority: "auth",
      ammConfig: "cfg",
      pool: "pool",
      vaultA: va,
      vaultB: vb,
      tokenProgramA: ta,
      tokenProgramB: tb,
      mintA: ma,
      mintB: mb,
      observation: "obs",
    };
  },
  ammV4: (aToB) => {
    const [va, vb] = flip(aToB, "vin", "vout");
    return { tokenProgram: "tp", pool: "pool", poolAuthority: "auth", vaultA: va, vaultB: vb };
  },
  tokenSwap: () => ({
    pool: "pool",
    poolAuthority: "auth",
    vaultA: "vin",
    vaultB: "vout",
    poolMint: "pmint",
    poolFeeAccount: "pfee",
    tokenProgram: "tp",
  }),
  fluxbeam: () => ({
    pool: "pool",
    poolAuthority: "auth",
    vaultA: "va",
    vaultB: "vb",
    poolMint: "pmint",
    poolFeeAccount: "pfee",
    mintA: "ma",
    mintB: "mb",
    tokenProgramA: "tpa",
    tokenProgramB: "tpb",
    poolTokenProgram: "tpp",
  }),
  dexlab: () => ({
    pool: "pool",
    poolAuthority: "auth",
    vaultA: "vin",
    vaultB: "vout",
    poolMint: "pmint",
    poolFeeAccount: "pfee",
    mintA: "mintin",
    mintB: "mintout",
    tokenProgramA: "tpin",
    tokenProgramB: "tpout",
    poolTokenProgram: "tppool",
  }),
  dammV2: () => ({
    poolAuthority: "auth",
    pool: "pool",
    vaultA: "va",
    vaultB: "vb",
    mintA: "ma",
    mintB: "mb",
    tokenProgramA: "tpa",
    tokenProgramB: "tpb",
    program: "prog",
    eventAuthority: "evt",
  }),
  dammV1: () => ({
    pool: "pool",
    vaultA: "av",
    vaultB: "bv",
    tokenVaultA: "atv",
    tokenVaultB: "btv",
    lpMintA: "alpm",
    lpMintB: "blpm",
    vaultLpA: "avlp",
    vaultLpB: "bvlp",
    protocolFeeA: "pfa",
    protocolFeeB: "pfa",
    vaultProgram: "vprog",
    tokenProgram: "tp",
  }),
  aldrin: () => ({
    pool: "pool",
    poolSigner: "signer",
    poolMint: "poolMint",
    vaultA: "baseVault",
    vaultB: "quoteVault",
    feeAccount: "feeAcct",
    tokenProgram: "tokenProgram",
  }),
  omnipair: (aToB) => {
    const [va, vb] = flip(aToB, "vin", "vout");
    const [ma, mb] = flip(aToB, "min", "mout");
    return {
      pool: "pair",
      rateModel: "ratemodel",
      futarchyAuthority: "futarchy",
      vaultA: va,
      vaultB: vb,
      mintA: ma,
      mintB: mb,
      tokenProgram: "tp",
      token2022: "tp22",
      eventAuthority: "ea",
      program: "prog",
    };
  },
  saber: () => ({
    pool: "pool",
    poolAuthority: "auth",
    vaultA: "va",
    vaultB: "vb",
    adminFeeA: "afa",
    adminFeeB: "afb",
    tokenProgram: "tp",
  }),
  wrapper: () => ({
    pool: "wrapper",
    wrapperMint: "wrapperMint",
    underlyingVault: "vault",
    tokenProgram: "tokenProgram",
  }),
  stabble: () => ({
    vaultA: "vtin",
    vaultB: "vtout",
    beneficiaryA: "benout",
    beneficiaryB: "benout",
    pool: "pool",
    withdrawAuthority: "wauth",
    vault: "vault",
    vaultAuthority: "vauth",
    vaultProgram: "vprog",
    tokenProgram: "tprog",
  }),
  mercurial: () => ({
    pool: "pool",
    tokenProgram: "tp",
    poolAuthority: "auth",
    vaultA: "va",
    vaultB: "vb",
  }),
  perena: (aToB) => {
    const [ma, mb] = flip(aToB, "inMint", "outMint");
    const [va, vb] = flip(aToB, "inVault", "outVault");
    return {
      pool: "pool",
      mintA: ma,
      mintB: mb,
      vaultA: va,
      vaultB: vb,
      numeraireConfig: "numeraireConfig",
      tokenProgram: "tokenProgram",
      token2022: "token2022Program",
    };
  },
  metadao: () => ({
    pool: "dao",
    vaultA: "basevault",
    vaultB: "quotevault",
    tokenProgram: "tp",
    eventAuthority: "ea",
    program: "prog",
  }),
  scaleAmm: () => ({
    pool: "pool",
    poolOwner: "owner",
    mintA: "mintA",
    mintB: "mintB",
    vaultA: "vaultA",
    vaultB: "vaultB",
    platformFeeA: "feeTaA",
    tokenProgramA: "tpA",
    tokenProgramB: "tpB",
    systemProgram: "sys",
    platformConfig: "cfg",
    beneficiary0: "ben0",
  }),
  pumpswap: () => ({
    pool: "pool",
    globalConfig: "gcfg",
    mintA: "bmint",
    mintB: "qmint",
    vaultA: "bvault",
    vaultB: "qvault",
    protocolFeeRecipient: "pfr",
    protocolFeeRecipientTokenAccount: "pfrata",
    tokenProgramA: "tpb",
    tokenProgramB: "tpq",
    systemProgram: "sys",
    associatedTokenProgram: "atp",
    eventAuthority: "evt",
    program: "amm",
    coinCreatorVault: "ccva",
    coinCreatorVaultAuthority: "ccauth",
    globalVolumeAccumulator: "gvol",
    userVolumeAccumulator: "pumpswap-user-volume-accumulator",
    feeConfig: "fcfg",
    feeProgram: "fprog",
    poolV2: "pv2",
    buybackFeeRecipient: "bbr",
    buybackFeeRecipientTokenAccount: "bbrata",
  }),
  bonkswap: () => ({
    state: "state",
    pool: "pool",
    mintA: "tx",
    mintB: "ty",
    vaultA: "vx",
    vaultB: "vy",
    programAuthority: "auth",
    systemProgram: "sys",
    tokenProgram: "tp",
    associatedTokenProgram: "atp",
    rent: "rent",
  }),
};
ROLES.meteoraDlmm = () => ({
  pool: "pair",
  bitmapExtension: "bmx",
  vaultA: "rx",
  vaultB: "ry",
  mintA: "mx",
  mintB: "my",
  oracle: "orc",
  hostFee: "prog",
  tokenProgramA: "tpx",
  tokenProgramB: "tpy",
  eventAuthority: "evt",
  program: "prog",
  binArray0: "ba0",
  binArray1: "ba1",
  binArray2: "ba2",
});
ROLES.sarosDlmm = () => ({
  pool: "pair",
  mintA: "mx",
  mintB: "my",
  binArrayLower: "ba0",
  binArrayUpper: "ba1",
  vaultA: "vx",
  vaultB: "vy",
  tokenProgramA: "tpx",
  tokenProgramB: "tpy",
  memo: "memo",
  hook: "hook",
  hookProgram: "hookprog",
  eventAuthority: "evt",
  program: "prog",
});
ROLES.solfiV2 = () => ({
  pool: "pool",
  oracle: "oracle",
  registry: "registry",
  vaultA: "va",
  vaultB: "vb",
  mintA: "ma",
  mintB: "mb",
  tokenProgramA: "tp",
  tokenProgramB: "tp2",
  instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
});
ROLES.hadron = (aToB) => {
  const [va, vb] = flip(aToB, "vaultIn", "vaultOut");
  return {
    tokenProgram: "tp1",
    pool: "pool",
    assetConfigA: "assetCfgA",
    assetConfigB: "assetCfgB",
    growingA: "growingA",
    vaultA: va,
    vaultB: vb,
    globalConfig: "global",
    feeVaultA: "feeDest",
    feeVaultB: "feeDest",
    clock: "clock",
    metadataA: "metaA",
  };
};
ROLES.taurusfi = (aToB) => {
  const [ta, tb] = flip(aToB, "tp1", "tp2");
  const [ma, mb] = flip(aToB, "mintIn", "mintOut");
  return {
    vaultA: "vault0",
    vaultB: "vault1",
    vaultAuthority: "vaultAuthority",
    globalConfig: "config",
    pool: "price",
    globalAuthority: "authority",
    tokenProgramA: ta,
    tokenProgramB: tb,
    mintA: ma,
    mintB: mb,
    instructionsSysvar: "sysvarIx",
  };
};
ROLES.riptide = () => ({
  pool: "pool",
  mintA: "mintA",
  mintB: "mintB",
  vaultA: "vaultA",
  vaultB: "vaultB",
  tokenProgramA: "tp1",
  tokenProgramB: "tp2",
  memo: "memo",
  instructionsSysvar: "sysvarInstructions",
  dontFront: "jitodontfront",
});
ROLES.denali = () => ({
  pool: "pool",
  mintA: "mintA",
  mintB: "mintB",
  vaultA: "vaultA",
  vaultB: "vaultB",
  tokenProgramA: "tp1",
  tokenProgramB: "tp2",
  oracle: "oracle",
  globalConfig: "global",
});
ROLES.gavel = () => ({
  program: "prog",
  logAuthority: "log",
  pool: "pool",
  vaultA: "bv",
  vaultB: "qv",
  tokenProgram: "tp",
});
ROLES.tesserav = () => ({
  poolAuthority: "auth",
  pool: "pool",
  vaultA: "vaultA",
  vaultB: "vaultB",
  mintA: "mintA",
  mintB: "mintB",
  tokenProgramA: "tp1",
  tokenProgramB: "tp2",
  instructionsSysvar: "ixSysvar",
  config: "cfgGlobal",
  oracle: "oracleGlobal",
});
ROLES.flint = (aToB) => {
  const [ma, mb] = flip(aToB, "marketIn", "marketOut");
  const [va, vb] = flip(aToB, "vaultIn", "vaultOut");
  const [ta, tb] = flip(aToB, "tpIn", "tpOut");
  return {
    instructionsSysvar: "sysvar",
    marketA: ma,
    marketB: mb,
    vaultA: va,
    vaultB: vb,
    tokenProgramA: ta,
    tokenProgramB: tb,
    program: "flintSelf",
  };
};
ROLES.deriverse = () => ({
  mintA: "am",
  mintB: "cm",
  vaultA: "av",
  vaultB: "cv",
  pool: "instr",
  bidsTree: "bidt",
  bidOrders: "bido",
  asksTree: "askt",
  askOrders: "asko",
  lines: "lines",
  maps: "maps",
  clientInfos: "ci",
  tokenProgram: "tp",
});
ROLES.goonfiV2 = () => ({
  pool: "pool",
  vaultA: "va",
  vaultB: "vb",
  mintA: "ma",
  mintB: "mb",
  oracle: "oracle",
  globalConfig: "global",
  instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
  tokenProgramA: "tp",
  tokenProgramB: "tp2",
  validator: "J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv",
});
ROLES.meteoraDbc = () => ({
  poolAuthority: "auth",
  config: "cfg",
  pool: "pool",
  vaultA: "bv",
  vaultB: "qv",
  mintA: "bm",
  mintB: "qm",
  tokenProgramA: "tbp",
  tokenProgramB: "tqp",
  program: "prog",
  eventAuthority: "evt",
});
ROLES.trends = () => ({
  config: "cfg",
  pool: "pool",
  poolAuthority: "pauth",
  mintA: "bmint",
  mintB: "qmint",
  vaultA: "bvault",
  vaultB: "qvault",
  tokenProgramA: "btp",
  tokenProgramB: "qtp",
  program: "prog",
  eventAuthority: "evt",
});
ROLES.heaven = () => ({
  tokenProgramA: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  tokenProgramB: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associatedTokenProgram: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  systemProgram: "11111111111111111111111111111111",
  pool: "pool",
  mintA: "LiGHtkg3uTa9836RaNkKLLriqTNRcMdRAhqjGWNv777",
  mintB: "So11111111111111111111111111111111111111112",
  vaultA: "vaultA",
  vaultB: "vaultB",
  protocolConfig: "protocolConfig",
  instructionsSysvar: "Sysvar1nstructions1111111111111111111111111",
  chainlink: "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny",
  solUsdFeed: "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt",
});
ROLES.virtuals = () => ({
  pool: "vpool",
  mintA: "mint",
  poolTokenAccount: "vpoolToken",
  platform: "platform",
  platformVirtualsAccount: "platformVirtuals",
  poolVirtualsAccount: "vpoolVirtuals",
  tokenProgram: "tokenProgram",
});
ROLES.raydiumLaunchlab = () => ({
  poolAuthority: "auth",
  globalConfig: "gcfg",
  platformConfig: "pcfg",
  pool: "pool",
  vaultA: "baseVault",
  vaultB: "quoteVault",
  mintA: "baseMint",
  mintB: "quoteMint",
  tokenProgramA: "baseTokenProgram",
  tokenProgramB: "quoteTokenProgram",
  eventAuthority: "eventAuthority",
  program: "program",
  systemProgram: "systemProgram",
  platformVault: "platformVault",
  creatorVault: "creatorVault",
});
ROLES.runnerRodeo = () => ({
  poolAuthority: "authority",
  config: "config",
  pool: "state",
  vaultA: "baseVault",
  vaultB: "quoteVault",
  protocolFeeA: "protocolFeeA",
  protocolFeeB: "protocolFeeB",
  creatorFee: "creatorFee",
  mintA: "baseMint",
  mintB: "quoteMint",
  tokenProgramA: "baseTokenProgram",
  tokenProgramB: "quoteTokenProgram",
  systemProgram: "systemProgram",
  eventAuthority: "eventAuthority",
  program: "program",
});
ROLES.scaleVmm = () => ({
  pool: "pair",
  mintA: "mintA",
  mintB: "mintB",
  vaultA: "vaultA",
  vaultB: "vaultB",
  platformFeeA: "feeTaA",
  tokenProgramA: "tpA",
  tokenProgramB: "tpB",
  systemProgram: "sys",
  platformConfig: "cfg",
  ammProgram: "ammProgram",
  ammPool: "ammPool",
  ammVaultA: "ammVaultA",
  ammVaultB: "ammVaultB",
  ammConfig: "ammConfig",
  beneficiary0: "ben0",
});
ROLES.xorca = () => ({
  vault: "vault",
  mintB: "xorcaMint",
  pool: "state",
  mintA: "orcaMint",
  tokenProgram: "tokenProgram",
});
ROLES.solayer = () => ({
  pool: "pool",
  receiptMint: "receiptMint",
  vault: "vault",
  lstMint: "lstMint",
  tokenProgram: "token-program",
});
ROLES.voltr = () => ({
  protocol: "protocol",
  pool: "vault",
  mintA: "assetMint",
  mintB: "lpMint",
  idleAccount: "idleAta",
  idleAuthority: "idleAuth",
  lpMintAuthority: "lpMintAuth",
  tokenProgramA: "assetTokenProgram",
  tokenProgramB: "lpTokenProgram",
  systemProgram: "systemProgram",
});
ROLES.vaultLiquidUnstake = () => ({
  globalPool: "globalPool",
  poolLstAccount: "poolLstAta",
  mintA: "mint",
  stakePool: "stakePool",
  pool: "lstInfo",
  solVault: "solVault",
  feeAccount: "feeAccount",
  inventorySummary: "invSummary",
  tokenProgram: "tokenProgram",
  systemProgram: "systemProgram",
});
ROLES.hyloStabilityPool = () => ({
  pool: "poolConfig",
  hylo: "hylo",
  mintA: "stablecoinMint",
  poolAuthority: "poolAuth",
  stablecoinPool: "stablecoinPool",
  lpTokenAuthority: "lpTokenAuth",
  mintB: "lpTokenMint",
  feeAuthority: "feeAuth",
  feeVault: "feeVault",
  tokenProgram: "tokenProgram",
  eventAuthority: "eventAuthority",
  program: "program",
});
ROLES.huma = () => ({
  humaConfig: "huma-config",
  poolConfig: "pool-config",
  poolState: "pool-state",
  pool: "mode-config",
  mintB: "mode-mint",
  poolAuthority: "pool-authority",
  mintA: "underlying-mint",
  poolUnderlying: "pool-underlying",
  tokenProgramA: "underlying-token-program",
  tokenProgramB: "mode-token-program",
});
ROLES.heliumTreasury = () => ({
  pool: "mgmt",
  mintB: "treasuryMint",
  mintA: "supplyMint",
  treasury: "treasury",
  circuitBreaker: "cb",
  circuitBreakerProgram: "cbProgram",
  tokenProgram: "tokenProgram",
});
ROLES.jupiterLendEarn = () => ({
  mintA: "mint",
  lendingAdmin: "lendingAdmin",
  pool: "lending",
  mintB: "fTokenMint",
  reserve: "reserve",
  supplyPosition: "supplyPosition",
  rateModel: "rateModel",
  vault: "vault",
  claimAccount: "claimAccountNone",
  liquidity: "liquidity",
  liquidityProgram: "liquidityProgram",
  rewardsRateModel: "rewardsRateModel",
  tokenProgram: "tokenProgram",
  associatedTokenProgram: "associatedTokenProgram",
  systemProgram: "systemProgram",
});
ROLES.hylo = () => ({
  hylo: "hylo",
  pool: "pair",
  stablecoinAuthority: "stablecoinAuth",
  usdcVaultAuthority: "usdcVaultAuth",
  usdcFeeAuthority: "usdcFeeAuth",
  stablecoinFeeAuthority: "stablecoinFeeAuth",
  vault: "vault",
  usdcFeeVault: "usdcFeeVault",
  stablecoinFeeVault: "stablecoinFeeVault",
  mintB: "stablecoinMint",
  mintA: "usdcMint",
  pyth: "pyth",
  tokenProgram: "tokenProgram",
  eventAuthority: "eventAuthority",
  program: "program",
});
ROLES.carrot = () => ({
  pool: "vault",
  mintB: "crtMint",
  mintA: "assetMint",
  assetVault: "ata0",
  systemProgram: "systemProgram",
  tokenProgramA: "assetTokenProgram",
  tokenProgramB: "sharesTokenProgram",
  logProgram: "logProgram",
  assetAccount0: "ata0",
  oracle0: "oracle0",
  assetAccount1: "ata1",
  oracle1: "oracle1",
  assetAccount2: "ata2",
  oracle2: "oracle2",
});
ROLES.mswap = () => ({
  wrapAuthority: "wrapAuthoritySentinel",
  unwrapAuthority: "unwrapAuthoritySentinel",
  swapGlobal: "swapGlobal",
  globalIn: "fromGlobal",
  globalOut: "toGlobal",
  mintIn: "fromMint",
  mintOut: "toMint",
  mMint: "mMint",
  swapMAccount: "swapMAccount",
  mVaultAuthorityIn: "fromMVaultAuth",
  mVaultAuthorityOut: "toMVaultAuth",
  mintAuthorityIn: "fromMintAuthority",
  mintAuthorityOut: "toMintAuthority",
  mVaultIn: "fromMVault",
  mVaultOut: "toMVault",
  tokenProgramIn: "fromTokenProgram",
  tokenProgramOut: "toTokenProgram",
  mTokenProgram: "mTokenProgram",
  extProgramIn: "fromExtProgram",
  extProgramOut: "toExtProgram",
  systemProgram: "systemProgram",
});
ROLES.perpsJlp = () => ({
  transferAuthority: "ta",
  perpetuals: "perp",
  pool: "pool",
  custodyIn: "ci",
  dovesOracleIn: "di",
  pythnetOracleIn: "pyi",
  custodyTokenAccountIn: "tai",
  custodyOut: "co",
  dovesOracleOut: "do",
  pythnetOracleOut: "pyo",
  custodyTokenAccountOut: "tao",
  tokenProgram: "tp",
  eventAuthority: "ea",
  program: "prog",
});
/** The custody paid into is the pool's own, by its index: the recipes name it as it is in the list. */
ROLES.perpsJlpMint = (_, vector) => ({
  transferAuthority: "ta",
  perpetuals: "perp",
  pool: "pool",
  custody: roleOf(vector.accounts[6]!)!,
  dovesOracle: roleOf(vector.accounts[7]!)!,
  pythnetOracle: roleOf(vector.accounts[8]!)!,
  custodyTokenAccount: "custodyTokenAccount",
  lpMint: "lpMint",
  tokenProgram: "tokenProgram",
  eventAuthority: "eventAuthority",
  program: "program",
  ...Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      [`custody${i}`, `custody${i}`],
      [`oracle${i}`, `oracle${i}`],
    ]).flat(),
  ),
});
ROLES.sanctumInfinity = () => ({
  mintIn: "inMint",
  mintOut: "outMint",
  tokenProgramIn: "inTokenProgram",
  tokenProgramOut: "outTokenProgram",
  poolState: "poolState",
  lstStateList: "lstStateList",
  reservesIn: "inPoolReserves",
  reservesOut: "outPoolReserves",
  ...Object.fromEntries(
    (["In", "Out"] as const).flatMap((side) => {
      const at = side === "In" ? "in" : "out";
      return [
        [`calcProgram${side}`, `${at}CalcProgram`],
        [`calcState${side}`, `${at}CalcState`],
        [`stakePool${side}`, `${at}StakePool`],
        [`stakePoolProgram${side}`, `${at}CalcPoolProgram`],
        [`stakePoolProgramData${side}`, `${at}CalcPoolProgramData`],
      ];
    }),
  ),
  pricingProgram: "pricingProgram",
  slab: "slab",
});

ROLES.oneIntroSwap = (aToB) => ({
  metadata: "metadata",
  pool: "pool",
  poolAuthority: "authority",
  vaultA: aToB ? "vin" : "vout",
  vaultB: aToB ? "vout" : "vin",
  ...(aToB ? { feeA0: "feeA", feeB0: "feeB" } : { feeA1: "feeA", feeB1: "feeB" }),
  tokenProgram: "tp",
});
ROLES.solfiV1 = () => ({
  pool: "pool",
  vaultA: "vaultA",
  vaultB: "vaultB",
  tokenProgram: "tokenProgram",
  instructionsSysvar: "sysvarIx",
});
ROLES.woofi = (aToB) => {
  const [a, b] = aToB ? ["f", "t"] : ["t", "f"];
  return {
    wooconfig: "wooconfig",
    tokenProgram: "tokprog",
    wooracleA: `wo${a}`,
    woopoolA: `wp${a}`,
    vaultA: `v${a}`,
    priceUpdateA: `pu${a}`,
    wooracleB: `wo${b}`,
    woopoolB: `wp${b}`,
    vaultB: `v${b}`,
    priceUpdateB: `pu${b}`,
  };
};
ROLES.bisonfi = () => ({
  pool: "pool",
  vaultA: "vaultA",
  vaultB: "vaultB",
  tokenProgramA: "tp1",
  tokenProgramB: "tp2",
  authorization: "auth",
});
ROLES.sanctumStakePool = () => ({
  pool: "pool",
  withdrawAuthority: "withdrawAuthority",
  reserveStake: "reserveStake",
  managerFeeAccount: "managerFeeAccount",
  referrerFeeAccount: "referrerFeeAccount",
  poolMint: "poolMint",
  systemProgram: "systemProgram",
  tokenProgram: "tokenProgram",
});

ROLES.archer = () => ({
  pool: "mkt",
  mintA: "mA",
  mintB: "mB",
  vaultA: "vA",
  vaultB: "vB",
  tokenProgramA: "tpA",
  tokenProgramB: "tpB",
  maker0: "mk0",
  maker1: "mk1",
});

ROLES.metric = () => ({
  pool: "pool",
  mintA: "ma",
  mintB: "mb",
  vaultA: "va",
  vaultB: "vb",
  tokenProgramA: "tpa",
  tokenProgramB: "tpb",
  systemProgram: "sys",
  program: "self",
  oracleProgram: "oracleProg",
  oracleConfig: "oracleConfig",
  priceAccount: "price",
});

ROLES.quantum = () => ({
  pool: "pool",
  vaultA: "v0",
  vaultB: "v1",
  global: "global",
  tokenProgram: "tokprog",
  clock: "clock",
  instructionsSysvar: "ixsys",
});
ROLES.obsidian = () => ({
  pool: "pool",
  vaultA: "vaultA",
  vaultB: "vaultB",
  tokenProgram: "tp",
  instructionsSysvar: "obsidianSysvarInstructions",
});
ROLES.alphaq = () => ({
  pool: "market",
  stats: "stats",
  vaultA: "vaultA1",
  vaultB: "vaultB1",
  tokenProgram: "tokenProgram",
  instructionsSysvar: "ixSysvar",
});

const FAMILY: Record<string, string> = {
  "raydium-cp-swap": "cp",
  gamma: "cp",
  "raydium-amm-v4": "ammV4",
  "orca-legacy-token-swap": "tokenSwap",
  "orca-legacy-token-swap-stable": "tokenSwap",
  "token-swap-v1": "tokenSwap",
  "orca-v1": "tokenSwap",
  penguin: "tokenSwap",
  stepn: "tokenSwap",
  saros: "tokenSwap",
  fluxbeam: "fluxbeam",
  dexlab: "dexlab",
  "meteora-damm-v2": "dammV2",
  "meteora-damm-v1-cp": "dammV1",
  "meteora-damm-v1-stable": "dammV1",
  aldrin: "aldrin",
  omnipair: "omnipair",
  "saber-stableswap": "saber",
  "saber-decimals-wrapper": "wrapper",
  "stabble-stable-swap": "stabble",
  "stabble-weighted-swap": "stabble",
  mercurial: "mercurial",
  perena: "perena",
  "metadao-futarchy": "metadao",
  "scale-amm": "scaleAmm",
  pumpswap: "pumpswap",
  bonkswap: "bonkswap",
  guacswap: "bonkswap",
  "meteora-dlmm": "meteoraDlmm",
  "saros-dlmm": "sarosDlmm",
  "solfi-v2": "solfiV2",
  hadron: "hadron",
  taurusfi: "taurusfi",
  riptide: "riptide",
  denali: "denali",
  gavel: "gavel",
  tesserav: "tesserav",
  flint: "flint",
  deriverse: "deriverse",
  "goonfi-v2": "goonfiV2",
  "meteora-dbc": "meteoraDbc",
  trends: "trends",
  heaven: "heaven",
  virtuals: "virtuals",
  "raydium-launchlab": "raydiumLaunchlab",
  "runner-rodeo": "runnerRodeo",
  "scale-vmm": "scaleVmm",
  xorca: "xorca",
  solayer: "solayer",
  voltr: "voltr",
  "vault-liquid-unstake": "vaultLiquidUnstake",
  "hylo-stability-pool": "hyloStabilityPool",
  huma: "huma",
  "helium-treasury": "heliumTreasury",
  "jupiter-lend-earn": "jupiterLendEarn",
  hylo: "hylo",
  carrot: "carrot",
  mswap: "mswap",
  "perps-jlp": "perpsJlp",
  "perps-jlp-mint": "perpsJlpMint",
  "sanctum-infinity": "sanctumInfinity",
  "one-intro-swap": "oneIntroSwap",
  "solfi-v1": "solfiV1",
  woofi: "woofi",
  bisonfi: "bisonfi",
  "sanctum-stake-pool": "sanctumStakePool",
  "sanctum-stake-pool-2": "sanctumStakePool",
  "sanctum-stake-pool-3": "sanctumStakePool",
  archer: "archer",
  metric: "metric",
  quantum: "quantum",
  obsidian: "obsidian",
  alphaq: "alphaq",
};

/** A vector account's role, without the recipes' slot or venue prefix. */
const roleOf = (account: Vector["accounts"][number]): string | undefined =>
  (account.role ?? account.ref)?.split(":").pop();

/** The value a vector names each account by: its address, or the ref a code generator resolves. */
const valueOf = (account: Vector["accounts"][number]): string =>
  account.user !== undefined
    ? { owner: "authority", in: "source", out: "recipient" }[account.user]!
    : (account.address ?? account.ref!);

const CASES: [string, Vector][] = Object.entries(VECTORS).filter(
  ([, vector]) => vector.venue in FAMILY,
);

describe("routerSvmAccountOrder: the exact-input venues, as sauce-recipes builds their swaps", () => {
  it("covers every exact-input venue the vectors carry, and names each one's program", () => {
    expect([...new Set(CASES.map(([, v]) => v.venue))].sort()).toEqual(Object.keys(FAMILY).sort());
    for (const [, vector] of CASES)
      expect({
        venue: vector.venue,
        program: ROUTER_SVM_VENUES[vector.venue as RouterSvmVenue].program,
      }).toEqual({ venue: vector.venue, program: vector.program });
  });

  it.each(CASES)("%s: account for account, writable and signer", (key, vector) => {
    const aToB = PAYS_FIRST[key] ?? FIRST[key.split(":").pop()!];
    expect(aToB).toBeDefined();
    const options: RouterSvmAccountOptions = {
      aToB: aToB!,
      ...(vector.venue === "pumpswap"
        ? { poolV2: vector.accounts.some((a) => roleOf(a) === "pv2") }
        : {}),
      ...(vector.venue === "archer"
        ? { makers: vector.accounts.filter((a) => /^mk\d+$/.test(roleOf(a) ?? "")).length }
        : {}),
      ...(vector.venue === "perps-jlp-mint"
        ? {
            custodies: new Set(
              vector.accounts.map(roleOf).filter((role) => /^custody\d+$/.test(role ?? "")),
            ).size,
          }
        : {}),
      ...(vector.venue === "sanctum-infinity"
        ? {
            inCalcAccounts: vector.accounts.filter((a) =>
              /^in(Calc|StakePool)/.test(roleOf(a) ?? ""),
            ).length as 1 | 5,
            outCalcAccounts: vector.accounts.filter((a) =>
              /^out(Calc|StakePool)/.test(roleOf(a) ?? ""),
            ).length as 1 | 5,
          }
        : {}),
      ...(vector.venue === "scale-amm" || vector.venue === "scale-vmm"
        ? { beneficiaries: vector.accounts.filter((a) => /^ben\d+$/.test(roleOf(a) ?? "")).length }
        : {}),
    };
    const roles = ROLES[FAMILY[vector.venue]!]!(aToB!, vector);
    const byRole = new Map(
      vector.accounts.filter((a) => a.user === undefined).map((a) => [roleOf(a), valueOf(a)]),
    );
    const refs: Record<string, string> = {
      authority: "authority",
      source: "source",
      recipient: "recipient",
    };
    for (const [name, role] of Object.entries(roles))
      if (byRole.has(role)) refs[name] = byRole.get(role)!;
    const built = routerSvmAccounts(vector.venue as RouterSvmVenue, options, refs);
    expect(built.map((a) => ({ ref: a.ref, writable: a.writable, signer: a.signer }))).toEqual(
      vector.accounts.map((a) => ({
        ref: valueOf(a),
        writable: a.writable === true || (a.user === "owner" && WRITES_AUTHORITY.has(vector.venue)),
        signer: a.signer === true,
      })),
    );
  });
});
