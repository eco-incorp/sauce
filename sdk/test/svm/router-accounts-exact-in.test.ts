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
};

const flip = (aToB: boolean, a: string, b: string): [string, string] => (aToB ? [a, b] : [b, a]);

/** Each of this module's names, as the recipes' role for that account, by venue family. */
const ROLES: Record<string, (aToB: boolean) => Record<string, string>> = {
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
    const aToB = FIRST[key.split(":").pop()!];
    expect(aToB).toBeDefined();
    const options: RouterSvmAccountOptions = {
      aToB: aToB!,
      ...(vector.venue === "pumpswap"
        ? { poolV2: vector.accounts.some((a) => roleOf(a) === "pv2") }
        : {}),
      ...(vector.venue === "scale-amm"
        ? { beneficiaries: vector.accounts.filter((a) => /^ben\d+$/.test(roleOf(a) ?? "")).length }
        : {}),
    };
    const roles = ROLES[FAMILY[vector.venue]!]!(aToB!);
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
        writable: a.writable === true,
        signer: a.signer === true,
      })),
    );
  });
});
