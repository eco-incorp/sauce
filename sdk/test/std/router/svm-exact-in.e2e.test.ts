/**
 * `@sauce/router`'s exact-input venues, executed: each function compiled into a program that calls
 * it once on one pool, staged and cooked through the released Kitchen on the harness Pot, against the
 * venue's own mainnet program (`test/fixtures/svm-exact-in-programs/`) and the pool's mainnet
 * accounts (`test/svm/fixtures/<venue>/`). It proves what the library's EXACT INPUT header says:
 *
 *   - every form swaps the pool's way, both directions: `<venue>`, `<venue>Cpi` and `<venue>Data`
 *     deliver the same amount from the same state, and where sauce-recipes' real-program suite pins
 *     a trade at that state, exactly its pin, and debit; `<venue>Cpi` returns what it paid;
 *   - the venue's instruction is the one sauce-recipes builds for the same pool and direction
 *     (`fixtures/exact-in-vectors.json`): the same data, the same accounts in the same order, the
 *     same accounts writable;
 *   - `<venue>` returns 0 having moved nothing for a missing slot, no input, and each refusal its
 *     comment names;
 *   - a swap below its floor reverts, and a slot or list naming another program reverts before the
 *     authority signs into it;
 *   - Scale AMM, PumpSwap, Bonkswap, Guacswap, Meteora DLMM and Saros DLMM, whose swaps take more
 *     accounts than a function can list, the same through their `Cpi` forms.
 *
 * It logs each function's compute units: the engine's own (the venue's call excluded, an empty
 * program's with the same accounts subtracted) and the venue's.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import { AccountRole, getAddressEncoder, getProgramDerivedAddress, lamports } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import {
  describeSvm,
  randomAddress,
  sendInstructions,
  setTokenAccount,
  tokenAmount,
} from "../../svm/engine-harness.js";
import { ROUTER_SVM_VENUES, routerSvmAccounts } from "../../../src/svm/router-accounts.js";
import type { RouterSvmVenue } from "../../../src/svm/router-accounts.js";
import { routerSvmDataTemplate } from "../../../src/svm/router-data.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import {
  boot,
  compiled,
  instruction,
  cook,
  editFrozen,
  freeze,
  keyAt,
  refused,
  succeeded,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  venueProgram,
  venueProgramId,
} from "./exact-in-harness.js";
import type { Compiled, CpiAccount, SlotAccount, Trade } from "./exact-in-harness.js";
import { svmExactInArguments } from "./harness.js";

interface Vector {
  amountPatch?: { patchDivisorIn?: string };
  program: Address;
  pay: Address;
  buy: Address;
  prefix: string;
  suffix: string;
  cfg: Record<string, unknown>;
  accounts: {
    user?: string;
    address?: Address;
    ref?: string;
    /** The recipes' name for a fixed account. */
    role?: string;
    writable?: boolean;
    signer?: boolean;
  }[];
}
const VECTORS = (
  JSON.parse(
    readFileSync(new URL("./fixtures/exact-in-vectors.json", import.meta.url), "utf8"),
  ) as { vectors: Record<string, Vector> }
).vectors;
const cfg = (key: string): Record<string, string> => VECTORS[key]!.cfg as Record<string, string>;

const WSOL = "So11111111111111111111111111111111111111112" as Address;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" as Address;
const INSTRUCTIONS = "Sysvar1nstructions1111111111111111111111111" as Address;
const CLOCK = "SysvarC1ock11111111111111111111111111111111" as Address;

const w = (address: string): SlotAccount => ({ address: address as Address, writable: true });
const r = (address: string): SlotAccount => ({ address: address as Address });

interface Case extends Omit<Trade, "slot"> {
  /** The direction, for a venue whose `Cpi` and `Data` forms take one (`aToB`, `xToY`,
   *  `paysBase`). */
  dir?: boolean;
  /** sauce-recipes' instruction for this pool and direction, when it builds one. */
  vector?: string;
  /** What the recipient receives, where sauce-recipes' real-program suite pins it. */
  received?: bigint;
  /** What the paying account pays, when the venue spends less than `amountIn`. */
  paid?: bigint;
}

/** The recipes' template written by hand around the amount: the cost the library's forms add to. */
const HAND = "by hand";

/** The literals a venue's `Cpi` and `Data` forms are compiled with for one trade: its direction, and
 *  Perena's two tokens' indices, which the recipes' instruction carries after its discriminator. */
const bakedFor = (base: string, trade: Case, vector?: Vector): Record<string, string> => {
  const args = svmExactInArguments(`${base}Cpi`)!;
  const baked: Record<string, string> = {};
  for (const name of ["aToB", "xToY", "paysBase"])
    if (args.includes(name)) {
      if (trade.dir === undefined) throw new Error(`${base}: the case names its direction`);
      baked[name] = String(trade.dir);
    }
  if (args.includes("baseLot")) baked.baseLot = String(vector!.cfg.baseLotSize);
  if (args.includes("instrId")) {
    const instr = vector!.prefix.slice(8, 16).match(/../g)!.reverse().join("");
    baked.instrId = String(parseInt(instr, 16));
  }
  // Sanctum Infinity's counts and indices lead its data; Perena's indices follow its discriminator.
  const le = (byte: number, width: number): string =>
    String(
      BigInt(
        `0x${vector!.prefix
          .slice(2 * byte, 2 * (byte + width))
          .match(/../g)!
          .reverse()
          .join("")}`,
      ),
    );
  if (args.includes("inCalcAccounts")) {
    baked.inCalcAccounts = le(1, 1);
    baked.outCalcAccounts = le(2, 1);
    baked.inIndex = le(3, 4);
    baked.outIndex = le(7, 4);
  } else if (args.includes("inIndex")) {
    baked.inIndex = String(parseInt(vector!.prefix.slice(16, 18), 16));
    baked.outIndex = String(parseInt(vector!.prefix.slice(18, 20), 16));
  }
  return baked;
};

interface Venue {
  /** The floor the recipes' instruction writes, which the `Cpi` and `Data` forms are given: 1. */
  floor?: bigint;
  name: string;
  programs: string[];
  dirs: string[];
  clock: bigint;
  /** The Clock's slot, for a venue that checks its quote's slot against it. */
  atSlot?: bigint;
  /** The Clock's epoch and its first second, for a venue that checks its epoch. */
  atEpoch?: { epoch: bigint; start: bigint };
  /** Accounts the slot attaches writable that one direction's swap does not write. */
  writableOneWay?: string[];
  slot: (harness: EngineHarness) => SlotAccount[];
  cases: (harness: EngineHarness) => Case[];
  /** Accounts the swap writes that the fixture does not carry, placed before the state is frozen. */
  fabricate?: (harness: EngineHarness) => Address[];
  /** States `<venue>` skips: one write to an account each, and why. */
  skips?: { why: string; at: (slot: SlotAccount[]) => Address; offset: number; bytes: number[] }[];
}

const ata = async (owner: string, mint: string, program: Address = TOKEN): Promise<Address> =>
  (
    await findAssociatedTokenPda({
      owner: owner as Address,
      mint: mint as Address,
      tokenProgram: program,
    })
  )[0];

const tokenSwapSlot = (key: string, program: string) => (): SlotAccount[] => {
  const c = cfg(key);
  return [
    r(program),
    r(c.pool!),
    r(c.swapAuthority!),
    w(c.vaultIn!),
    w(c.vaultOut!),
    w(c.poolMint!),
    w(c.poolFeeAccount!),
  ];
};

const tokenSwapCases = (key: string, sizes: [bigint, bigint, bigint][]) => (): Case[] => {
  const c = cfg(key);
  return [
    ...sizes.map(([amountIn, received, paid]) => ({
      vector: key,
      pay: c.inputMint as Address,
      buy: c.outputMint as Address,
      amountIn,
      received,
      paid,
    })),
    { pay: c.outputMint as Address, buy: c.inputMint as Address, amountIn: sizes[0]![1] },
  ];
};

const VENUES: Venue[] = [
  {
    name: "RaydiumCpSwap",
    programs: ["raydium-cp-swap"],
    dirs: ["raydium-cp-swap", "pumpswap"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("raydium-cp-swap:7Juw:0to1");
      return [
        r(VECTORS["raydium-cp-swap:7Juw:0to1"]!.program),
        w(c.pool!),
        r("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"),
        r(c.ammConfig!),
        w(c.token0Vault!),
        w(c.token1Vault!),
        w(c.observation!),
      ];
    },
    cases: () => [
      {
        vector: "raydium-cp-swap:7Juw:0to1",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000n,
        received: 81_443n,
      },
      { vector: "raydium-cp-swap:7Juw:1to0", pay: USDC, buy: WSOL, amountIn: 81_443n },
    ],
    skips: [
      { why: "swaps switched off", at: (slot) => slot[1]!.address, offset: 329, bytes: [4] },
      {
        why: "a pool not open yet",
        at: (slot) => slot[1]!.address,
        offset: 373,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0x7f],
      },
      {
        why: "an empty side",
        at: (slot) => slot[5]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Gamma",
    programs: ["gamma"],
    dirs: ["gamma"],
    clock: 1_785_531_177n,
    slot: () => {
      const c = cfg("gamma:CM68:0to1");
      const a = VECTORS["gamma:CM68:0to1"]!.accounts;
      return [
        r(VECTORS["gamma:CM68:0to1"]!.program),
        w(c.pool!),
        r(a[1]!.address!),
        r(c.ammConfig!),
        w(c.token0Vault!),
        w(c.token1Vault!),
        w(c.observation!),
      ];
    },
    cases: () => [
      {
        vector: "gamma:CM68:0to1",
        pay: WSOL,
        buy: cfg("gamma:CM68:0to1").token1Mint as Address,
        amountIn: 1_000_000n,
        received: 599_410n,
      },
      {
        vector: "gamma:CM68:1to0",
        pay: cfg("gamma:CM68:0to1").token1Mint as Address,
        buy: WSOL,
        amountIn: 599_410n,
      },
    ],
    skips: [
      { why: "swaps switched off", at: (slot) => slot[1]!.address, offset: 329, bytes: [4] },
      {
        why: "an empty side",
        at: (slot) => slot[5]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "RaydiumAmmV4",
    programs: ["raydium-amm-v4"],
    dirs: ["raydium-amm-v4"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("raydium-amm-v4:58oQ:coinToPc");
      return [
        r(VECTORS["raydium-amm-v4:58oQ:coinToPc"]!.program),
        w(c.pool!),
        r("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"),
        w(c.coinVault!),
        w(c.pcVault!),
      ];
    },
    cases: () => [
      {
        vector: "raydium-amm-v4:58oQ:coinToPc",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 81_386_311n,
      },
      { vector: "raydium-amm-v4:58oQ:pcToCoin", pay: USDC, buy: WSOL, amountIn: 81_386_311n },
    ],
    skips: [
      { why: "a disabled pool (status 2)", at: (slot) => slot[1]!.address, offset: 0, bytes: [2] },
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "OrcaLegacyTokenSwap",
    programs: ["orca-legacy-token-swap"],
    dirs: ["orca-legacy-token-swap"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot(
      "orca-legacy-token-swap:EGZ7:AtoB",
      "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    ),
    cases: tokenSwapCases("orca-legacy-token-swap:EGZ7:AtoB", [
      [1_000_000_000n, 81_330_481n, 1_000_000_000n],
    ]),
    skips: [
      { why: "an uninitialized pool", at: (slot) => slot[1]!.address, offset: 1, bytes: [0] },
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "OrcaLegacyTokenSwap",
    programs: ["orca-legacy-token-swap"],
    dirs: ["orca-legacy-token-swap-stable"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot(
      "orca-legacy-token-swap-stable:F13x:AtoB",
      "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
    ),
    cases: () => {
      const c = cfg("orca-legacy-token-swap-stable:F13x:AtoB");
      return [
        {
          vector: "orca-legacy-token-swap-stable:F13x:AtoB",
          pay: c.inputMint as Address,
          buy: c.outputMint as Address,
          amountIn: 100_000_000n,
        },
        { pay: c.outputMint as Address, buy: c.inputMint as Address, amountIn: 100_000_000n },
      ];
    },
  },
  {
    name: "TokenSwapV1",
    programs: ["token-swap-v1"],
    dirs: ["token-swap-v1"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("token-swap-v1:AmHU:AtoB", "SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8"),
    cases: tokenSwapCases("token-swap-v1:AmHU:AtoB", [
      [100_000_000n, 7_285_522n, 99_999_994n],
      [1_000_000_000n, 72_775_596n, 999_999_989n],
      [10_000_000_000n, 719_887_883n, 9_999_999_990n],
    ]),
  },
  {
    name: "OrcaV1",
    programs: ["orca-v1"],
    dirs: ["orca-v1"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("orca-v1:Hj45:AtoB", "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1"),
    cases: tokenSwapCases("orca-v1:Hj45:AtoB", [
      [1_000_000_000_000n, 3_580_615n, 999_999_928_419n],
      [10_000_000_000_000n, 35_780_634n, 9_999_999_845_366n],
    ]),
  },
  {
    name: "Penguin",
    programs: ["penguin"],
    dirs: ["penguin"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("penguin:GfgZ:AtoB", "PSwapMdSai8tjrEXcxFeQth87xC4rRsa4VA5mhGhXkP"),
    cases: tokenSwapCases("penguin:GfgZ:AtoB", [
      [100_000_000n, 7_295_510n, 99_999_997n],
      [1_000_000_000n, 71_870_707n, 999_999_999n],
    ]),
  },
  {
    name: "Stepn",
    programs: ["stepn"],
    dirs: ["stepn"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("stepn:5GGv:AtoB", "Dooar9JkhdZ7J3LHN3A7YCuoGRUggXhQaG4kijfLGU2j"),
    cases: tokenSwapCases("stepn:5GGv:AtoB", [
      [100_000_000n, 7_269_156n, 99_999_993n],
      [1_000_000_000n, 72_688_391n, 999_999_997n],
    ]),
  },
  {
    name: "Saros",
    programs: ["saros"],
    dirs: ["saros"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("saros:Djxf:AtoB", "SSwapUtytfBdBn1b9NUGG6foMVPtcWgpRU32HToDUZr"),
    cases: tokenSwapCases("saros:Djxf:AtoB", [
      [10_000_000n, 729_534n, 9_999_994n],
      [500_000_000n, 35_828_463n, 499_999_989n],
    ]),
  },
  {
    name: "Dexlab",
    programs: ["dexlab"],
    dirs: ["dexlab", "pumpswap"],
    clock: 1_783_123_200n,
    slot: tokenSwapSlot("dexlab:4Kiz:AtoB", "DSwpgjMvXhtGn6BsbqmacdBZyfLj6jSWf3HJpdJtmg6N"),
    cases: tokenSwapCases("dexlab:4Kiz:AtoB", [
      [100_000_000n, 7_231_727n, 99_999_991n],
      [1_000_000_000n, 70_452_791n, 999_999_991n],
    ]),
  },
  {
    name: "Fluxbeam",
    programs: ["fluxbeam"],
    dirs: ["fluxbeam", "pumpswap"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("fluxbeam:CZEZ:AtoB");
      return [
        r("FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X"),
        r(c.pool!),
        r(c.swapAuthority!),
        w(c.vaultA!),
        w(c.vaultB!),
        w(c.poolMint!),
        w(c.poolFeeAccount!),
      ];
    },
    cases: () => [
      {
        vector: "fluxbeam:CZEZ:AtoB",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 71_656_795n,
        paid: 999_999_994n,
      },
      { pay: USDC, buy: WSOL, amountIn: 71_656_795n },
    ],
  },
  {
    name: "MeteoraDammV2",
    programs: ["meteora-damm-v2"],
    dirs: ["meteora-damm-v2", "pumpswap"],
    clock: 1_780_000_000n,
    slot: () => {
      const c = cfg("meteora-damm-v2:8Pm2:aToB");
      const a = VECTORS["meteora-damm-v2:8Pm2:aToB"]!.accounts;
      return [
        r("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
        w(c.pool!),
        r(a[0]!.address!),
        w(c.tokenAVault!),
        w(c.tokenBVault!),
        r(a[12]!.address!),
      ];
    },
    cases: () => [
      {
        vector: "meteora-damm-v2:8Pm2:aToB",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 81_533_661n,
      },
      { vector: "meteora-damm-v2:8Pm2:bToA", pay: USDC, buy: WSOL, amountIn: 81_533_661n },
    ],
    skips: [
      { why: "a disabled pool", at: (slot) => slot[1]!.address, offset: 481, bytes: [1] },
      {
        why: "a pool with no liquidity",
        at: (slot) => slot[1]!.address,
        offset: 360,
        bytes: Array(16).fill(0),
      },
    ],
  },
  {
    name: "MeteoraDammV1",
    programs: ["meteora-damm-v1", "meteora-vault"],
    dirs: ["meteora-damm-v1-cp"],
    clock: 1_785_904_013n,
    slot: () => {
      const c = cfg("meteora-damm-v1-cp:5yue:AtoB");
      return [
        r("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"),
        w(c.pool!),
        w(c.aVault!),
        w(c.bVault!),
        w(c.aTokenVault!),
        w(c.bTokenVault!),
        w(c.aLpMint!),
        w(c.bLpMint!),
        w(c.aVaultLp!),
        w(c.bVaultLp!),
        w(c.protocolTokenAFee!),
        w(c.protocolTokenBFee!),
        r("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi"),
      ];
    },
    cases: () => [
      {
        vector: "meteora-damm-v1-cp:5yue:AtoB",
        pay: USDC,
        buy: WSOL,
        amountIn: 10_000_000n,
        received: 135_237_831n,
      },
      {
        vector: "meteora-damm-v1-cp:5yue:BtoA",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 73_417_717n,
      },
    ],
    skips: [{ why: "a disabled pool", at: (slot) => slot[1]!.address, offset: 233, bytes: [0] }],
  },
  {
    name: "MeteoraDammV1",
    programs: ["meteora-damm-v1", "meteora-vault"],
    dirs: ["meteora-damm-v1-stable"],
    clock: 1_783_175_236n,
    slot: (harness) => {
      const c = cfg("meteora-damm-v1-stable:32D4:AtoB");
      return [
        r("Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"),
        w(c.pool!),
        w(c.aVault!),
        w(c.bVault!),
        w(c.aTokenVault!),
        w(c.bTokenVault!),
        w(c.aLpMint!),
        w(c.bLpMint!),
        w(c.aVaultLp!),
        w(c.bVaultLp!),
        w(c.protocolTokenAFee!),
        w(keyAt(harness, c.pool as Address, 266)),
        r("24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi"),
      ];
    },
    // The B side's protocol fee account is not in the fixture: the recipes trade this pool A to B.
    fabricate: (harness) => {
      const c = cfg("meteora-damm-v1-stable:32D4:AtoB");
      const fee = keyAt(harness, c.pool as Address, 266);
      return [setTokenAccount(harness, fee, USDT, c.pool as Address, 0n)];
    },
    cases: () => [
      {
        vector: "meteora-damm-v1-stable:32D4:AtoB",
        pay: USDC,
        buy: USDT,
        amountIn: 1_000_000_000n,
        received: 1_000_605_351n,
      },
      { pay: USDT, buy: USDC, amountIn: 1_000_000_000n },
    ],
  },
  {
    name: "Aldrin",
    programs: ["aldrin"],
    dirs: ["aldrin"],
    clock: 1_785_600_000n,
    slot: () => {
      const c = cfg("aldrin:4GUn:baseToQuote");
      return [
        r("AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6"),
        r(c.pool!),
        r(c.poolSigner!),
        w(c.poolMint!),
        w(c.baseTokenVault!),
        w(c.quoteTokenVault!),
        w(c.feePoolTokenAccount!),
      ];
    },
    cases: () => [
      // Aldrin's curve can spend a few units under the input, here one.
      {
        vector: "aldrin:4GUn:baseToQuote",
        dir: true,
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 71_486_300n,
        paid: 999_999_999n,
      },
      {
        vector: "aldrin:4GUn:quoteToBase",
        dir: false,
        pay: USDC,
        buy: WSOL,
        amountIn: 71_486_300n,
      },
    ],
  },
  {
    name: "Omnipair",
    programs: ["omnipair"],
    dirs: ["omnipair"],
    clock: 1_785_600_000n,
    slot: () => {
      const c = cfg("omnipair:Cp2n:aToB");
      return [
        r("omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE"),
        w(c.pool!),
        w(c.rateModel!),
        r(c.futarchyAuthority!),
        w(c.reserveVault0!),
        w(c.reserveVault1!),
        r(c.eventAuthority!),
      ];
    },
    cases: () => {
      const c = cfg("omnipair:Cp2n:aToB");
      return [
        {
          vector: "omnipair:Cp2n:aToB",
          pay: c.token0Mint as Address,
          buy: USDC,
          amountIn: 1_000_000_000n,
          received: 4_665_290_286n,
        },
        {
          vector: "omnipair:Cp2n:bToA",
          pay: USDC,
          buy: c.token0Mint as Address,
          amountIn: 1_000_000_000n,
        },
      ];
    },
  },
  {
    name: "Saber",
    programs: ["saber-stableswap"],
    dirs: ["saber-stableswap"],
    clock: 1_751_500_000n,
    slot: () => {
      const c = cfg("saber-stableswap:YAko:AtoB");
      return [
        r("SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ"),
        r(c.pool!),
        r(c.swapAuthority!),
        w(c.vaultA!),
        w(c.vaultB!),
        w(c.adminFeeA!),
        w(c.adminFeeB!),
      ];
    },
    // The admin fee accounts take a share of each swap; the fixture does not carry them.
    fabricate: (harness) => {
      const c = cfg("saber-stableswap:YAko:AtoB");
      return [
        setTokenAccount(harness, c.adminFeeA as Address, USDC, c.swapAuthority as Address, 0n),
        setTokenAccount(harness, c.adminFeeB as Address, USDT, c.swapAuthority as Address, 0n),
      ];
    },
    cases: () => [
      {
        vector: "saber-stableswap:YAko:AtoB",
        pay: USDC,
        buy: USDT,
        amountIn: 1_000_000n,
        received: 1_000_603n,
      },
      { pay: USDT, buy: USDC, amountIn: 1_000_000n },
    ],
    skips: [{ why: "a paused pool", at: (slot) => slot[1]!.address, offset: 1, bytes: [1] }],
  },
  {
    name: "SaberDecimalsWrapper",
    programs: ["saber-decimals-wrapper"],
    dirs: ["saber-decimals-wrapper"],
    clock: 1_783_400_000n,
    slot: () => {
      const c = cfg("saber-decimals-wrapper:AnKL:deposit");
      return [
        r("DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB"),
        r(c.pool!),
        w(c.wrapperMint!),
        w(c.vault!),
      ];
    },
    cases: () => {
      const c = cfg("saber-decimals-wrapper:AnKL:deposit");
      return [
        {
          vector: "saber-decimals-wrapper:AnKL:deposit",
          dir: true,
          pay: USDC,
          buy: c.wrapperMint as Address,
          amountIn: 1_000_000n,
          received: 1_000_000_000n,
        },
        {
          vector: "saber-decimals-wrapper:AnKL:withdraw",
          dir: false,
          pay: c.wrapperMint as Address,
          buy: USDC,
          amountIn: 50_000_000_000n,
          received: 50_000_000n,
        },
      ];
    },
  },
  {
    name: "StabbleStableSwap",
    programs: ["stabble-stable-swap", "stabble-vault"],
    dirs: ["stabble-stable-swap"],
    clock: 1_785_000_000n,
    slot: () => {
      const c = VECTORS["stabble-stable-swap:5K7C:AtoB"]!.cfg as {
        pool: string;
        withdrawAuthority: string;
        vault: string;
        vaultAuthority: string;
        beneficiaryTokenOut: string;
        tokens: { vaultTokenAccount: string }[];
      };
      return [
        r("swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ"),
        w(c.pool),
        r(c.withdrawAuthority),
        r(c.vault),
        r(c.vaultAuthority),
        r("vo1tWgqZMjG61Z2T9qUaMYKqZ75CYzMuaZ2LZP1n7HV"),
        w(c.tokens[0]!.vaultTokenAccount),
        w(c.tokens[1]!.vaultTokenAccount),
        w(stabbleBeneficiaryA),
        w(c.beneficiaryTokenOut),
      ];
    },
    fabricate: (harness) => [
      setTokenAccount(
        harness,
        stabbleBeneficiaryA,
        USDT,
        "8UgoPZAR8ZLoEmV6pJ8SZ6JKESP2X8nbnrZSdSgNtg1y" as Address,
        0n,
      ),
    ],
    cases: () => [
      {
        vector: "stabble-stable-swap:5K7C:AtoB",
        pay: USDT,
        buy: USDC,
        amountIn: 100_000_000n,
        received: 99_917_895n,
      },
      {
        vector: "stabble-stable-swap:5K7C:AtoB",
        pay: USDT,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 999_054_480n,
      },
      { pay: USDC, buy: USDT, amountIn: 100_000_000n },
    ],
    skips: [{ why: "an inactive pool", at: (slot) => slot[1]!.address, offset: 105, bytes: [0] }],
  },
  {
    name: "StabbleWeightedSwap",
    programs: ["stabble-weighted-swap", "stabble-vault"],
    dirs: ["stabble-weighted-swap"],
    clock: 1_783_175_236n,
    slot: () => {
      const c = VECTORS["stabble-weighted-swap:JV4M:AtoB"]!.cfg as {
        pool: string;
        withdrawAuthority: string;
        vault: string;
        vaultAuthority: string;
        beneficiaryTokenOut: string;
        tokens: { vaultTokenAccount: string }[];
      };
      return [
        r("swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW"),
        w(c.pool),
        r(c.withdrawAuthority),
        r(c.vault),
        r(c.vaultAuthority),
        r("vo1tWgqZMjG61Z2T9qUaMYKqZ75CYzMuaZ2LZP1n7HV"),
        w(c.tokens[0]!.vaultTokenAccount),
        w(c.tokens[1]!.vaultTokenAccount),
        w(stabbleBeneficiaryWsol),
        w(c.beneficiaryTokenOut),
      ];
    },
    fabricate: (harness) => [
      setTokenAccount(
        harness,
        stabbleBeneficiaryWsol,
        WSOL,
        "8UgoPZAR8ZLoEmV6pJ8SZ6JKESP2X8nbnrZSdSgNtg1y" as Address,
        0n,
      ),
    ],
    cases: () => [
      {
        vector: "stabble-weighted-swap:JV4M:AtoB",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 72_409_435n,
      },
      {
        vector: "stabble-weighted-swap:JV4M:AtoB",
        pay: WSOL,
        buy: USDC,
        amountIn: 10_000_000_000n,
        received: 692_756_474n,
      },
      { pay: USDC, buy: WSOL, amountIn: 72_409_435n },
    ],
  },
  {
    name: "Mercurial",
    programs: ["mercurial"],
    dirs: ["mercurial"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("mercurial:MAR1:aToB");
      return [
        r("MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky"),
        w(c.pool!),
        r(c.authority!),
        w(c.vaultA!),
        w(c.vaultB!),
      ];
    },
    cases: () => {
      const c = cfg("mercurial:MAR1:aToB");
      return [
        {
          vector: "mercurial:MAR1:aToB",
          pay: WSOL,
          buy: c.mintB as Address,
          amountIn: 1_000_000_000n,
        },
        {
          vector: "mercurial:MAR1:bToA",
          pay: c.mintB as Address,
          buy: WSOL,
          amountIn: 1_000_000_000n,
        },
      ];
    },
  },
  {
    name: "Perena",
    programs: ["perena"],
    dirs: ["perena"],
    clock: 1_785_600_000n,
    slot: () => {
      const c = cfg("perena:2w4A:aToB");
      const a = VECTORS["perena:2w4A:aToB"]!.accounts;
      return [
        r("NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P"),
        w(c.pool!),
        r(a[7]!.address!),
        w(c.aVault!),
        w(c.bVault!),
      ];
    },
    // The swap writes both mints.
    cases: () => [
      {
        vector: "perena:2w4A:aToB",
        pay: USDC,
        buy: USDT,
        amountIn: 1_000_000n,
        received: 1_000_742n,
        mintsWritable: true,
      },
      {
        vector: "perena:2w4A:bToA",
        pay: USDT,
        buy: USDC,
        amountIn: 1_000_000n,
        mintsWritable: true,
      },
    ],
    skips: [{ why: "a paused pool", at: (slot) => slot[1]!.address, offset: 3880, bytes: [1] }],
  },
  {
    name: "MetadaoFutarchy",
    programs: ["metadao-futarchy"],
    dirs: ["metadao-futarchy"],
    clock: 1_783_400_000n,
    slot: () => {
      const c = cfg("metadao-futarchy:CUPo:buy");
      const a = VECTORS["metadao-futarchy:CUPo:buy"]!.accounts;
      return [
        r("FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq"),
        w(c.pool!),
        w(c.ammBaseVault!),
        w(c.ammQuoteVault!),
        r(a[7]!.address!),
      ];
    },
    cases: () => {
      const c = cfg("metadao-futarchy:CUPo:buy");
      return [
        {
          vector: "metadao-futarchy:CUPo:buy",
          dir: false,
          pay: c.quoteMint as Address,
          buy: c.baseMint as Address,
          amountIn: 1_000_000n,
          received: 221_720n,
        },
        {
          vector: "metadao-futarchy:CUPo:sell",
          dir: true,
          pay: c.baseMint as Address,
          buy: c.quoteMint as Address,
          amountIn: 221_720n,
        },
      ];
    },
    skips: [
      { why: "a DAO not in its spot state", at: (slot) => slot[1]!.address, offset: 8, bytes: [1] },
    ],
  },
  {
    name: "SolfiV2",
    programs: ["solfi-v2"],
    dirs: ["solfi-v2", "pumpswap"],
    clock: 436_250_364n,
    atSlot: 436_250_364n,
    slot: () => {
      const c = cfg("solfi-v2:65ZH:0");
      return [
        r("SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF"),
        w(c.pool!),
        r(c.oracle!),
        w(c.registry!),
        w(c.vaultA!),
        w(c.vaultB!),
        r(INSTRUCTIONS),
      ];
    },
    cases: () => [
      {
        vector: "solfi-v2:65ZH:0",
        dir: true,
        pay: WSOL,
        buy: USDC,
        amountIn: 2_000_000_000n,
        received: 148_944_767n,
        authorityWritable: true,
      },
      {
        vector: "solfi-v2:65ZH:1",
        dir: false,
        pay: USDC,
        buy: WSOL,
        amountIn: 148_944_767n,
        authorityWritable: true,
      },
    ],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[5]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Hadron",
    floor: 0n,
    programs: ["hadron"],
    dirs: ["hadron"],
    clock: 1_783_175_236n,
    // The fee treasury's wrapped-SOL account, which the fixture lacks: a B-to-A swap pays into it.
    fabricate: (harness) => [
      setTokenAccount(
        harness,
        cfg("hadron:6rK6:AtoB").feeVaultB as Address,
        WSOL,
        "7Ly5vZTDz2ZJGrqTa9gCP2NWjFDvnxSLVQEdmvMcVaVn" as Address,
        0n,
      ),
    ],
    slot: () => {
      const c = cfg("hadron:6rK6:AtoB");
      return [
        r("HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8"),
        w(c.pool!),
        w(c.assetCfgA!),
        w(c.assetCfgB!),
        w(c.growingA!),
        w(c.vaultA!),
        w(c.vaultB!),
        w(c.global!),
        w(c.feeVaultA!),
        w(c.feeVaultB!),
        r(CLOCK),
        w(c.metaA!),
      ];
    },
    cases: () => {
      const c = cfg("hadron:6rK6:AtoB");
      return [
        {
          vector: "hadron:6rK6:AtoB",
          dir: true,
          pay: c.mintA as Address,
          buy: WSOL,
          amountIn: 50_000_000n,
          received: 64_586_434n,
          native: true,
        },
        {
          vector: "hadron:6rK6:BtoA",
          dir: false,
          pay: WSOL,
          buy: c.mintA as Address,
          amountIn: 64_586_434n,
          native: true,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[6]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Taurusfi",
    programs: ["taurusfi"],
    dirs: ["taurusfi"],
    clock: 1_786_027_892n,
    // Inside the price account's slot window, as the swap requires.
    atSlot: 437_603_687n,
    slot: () => {
      const c = cfg("taurusfi:EWqX:0to1");
      return [
        r("9VX8EKBg6vM6tA68xaDsPkbrx26XConZjkQmhVApUptc"),
        r(c.priceAccount!),
        w(c.vault0!),
        w(c.vault1!),
        w(c.vaultAuthority!),
        r(c.globalConfig!),
        r(c.globalAuthority!),
        r(INSTRUCTIONS),
      ];
    },
    cases: () => [
      {
        vector: "taurusfi:EWqX:0to1",
        pay: WSOL,
        buy: USDC,
        amountIn: 1_000_000_000n,
        received: 73_280_342n,
        authorityWritable: true,
        native: true,
      },
      {
        vector: "taurusfi:EWqX:1to0",
        pay: USDC,
        buy: WSOL,
        amountIn: 100_000_000n,
        received: 1_363_597_637n,
        authorityWritable: true,
        native: true,
      },
    ],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Riptide",
    programs: ["riptide"],
    dirs: ["riptide"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("riptide:6Vzx:0");
      return [
        r("riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j"),
        w(c.pool!),
        w(c.vaultA!),
        w(c.vaultB!),
        r(INSTRUCTIONS),
        r("jitodontfront111111111111111111111111111111"),
      ];
    },
    cases: () => [
      {
        vector: "riptide:6Vzx:0",
        dir: true,
        pay: USDT,
        buy: USDC,
        amountIn: 1_000_000n,
        received: 998_739n,
      },
      {
        vector: "riptide:6Vzx:1",
        dir: false,
        pay: USDC,
        buy: USDT,
        amountIn: 1_000_000n,
        received: 1_000_313n,
      },
    ],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Denali",
    floor: 0n,
    programs: ["denali"],
    dirs: ["denali"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("denali:8njE:0");
      const a = VECTORS["denali:8njE:0"]!.accounts;
      return [
        r("DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4"),
        w(c.pool!),
        w(c.vaultA!),
        w(c.vaultB!),
        r(c.oracle!),
        r(a[9]!.address!),
      ];
    },
    cases: () => {
      const c = cfg("denali:8njE:0");
      return [
        {
          vector: "denali:8njE:0",
          dir: true,
          pay: c.mintA as Address,
          buy: USDC,
          amountIn: 100_000_000n,
          received: 90_535_066n,
        },
        {
          vector: "denali:8njE:1",
          dir: false,
          pay: USDC,
          buy: c.mintA as Address,
          amountIn: 90_535_066n,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Gavel",
    programs: ["gavel"],
    dirs: ["gavel"],
    clock: 1_783_123_200n,
    // The pool's two vaults, which the fixture lacks: token accounts each owning itself, as the
    // program's vault PDAs do, funded past the trades.
    fabricate: (harness) => {
      const c = cfg("gavel:CcWf:baseIn");
      return [
        setTokenAccount(
          harness,
          c.baseVault as Address,
          c.baseMint as Address,
          c.baseVault as Address,
          100_000_000_000_000n,
        ),
        setTokenAccount(
          harness,
          c.quoteVault as Address,
          WSOL,
          c.quoteVault as Address,
          10_000_000_000n,
        ),
      ];
    },
    slot: () => {
      const c = cfg("gavel:CcWf:baseIn");
      const a = VECTORS["gavel:CcWf:baseIn"]!.accounts;
      return [
        r("srAMMzfVHVAtgSJc8iH6CfKzuWuUTzLHVCE81QU1rgi"),
        w(c.pool!),
        r(a[1]!.address!),
        w(c.baseVault!),
        w(c.quoteVault!),
      ];
    },
    cases: () => {
      const c = cfg("gavel:CcWf:baseIn");
      return [
        {
          vector: "gavel:CcWf:baseIn",
          dir: true,
          pay: c.baseMint as Address,
          buy: WSOL,
          amountIn: 1_000_000_000n,
          received: 10_370_694n,
        },
        {
          vector: "gavel:CcWf:quoteIn",
          dir: false,
          pay: WSOL,
          buy: c.baseMint as Address,
          amountIn: 10_370_694n,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Tesserav",
    programs: ["tesserav"],
    dirs: ["tesserav-swap"],
    clock: 1_786_000_000n,
    // The slot after the pool's quote was stamped: the swap refuses a quote many slots old.
    atSlot: 446_799_768n,
    slot: () => {
      const c = cfg("tesserav:FLck:aToB") as unknown as Record<string, string> & {
        swapGlobalAccounts: string[];
      };
      return [
        r("TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH"),
        w(c.pool),
        r(c.auth),
        w(c.vaultA),
        w(c.vaultB),
        r(INSTRUCTIONS),
        r(c.swapGlobalAccounts[1]!),
        r(c.swapGlobalAccounts[2]!),
      ];
    },
    cases: () => [{ vector: "tesserav:FLck:aToB", pay: WSOL, buy: USDC, amountIn: 1_000_000_000n }],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Flint",
    programs: ["flint"],
    dirs: ["flint"],
    clock: 1_783_123_200n,
    slot: () => {
      const a = VECTORS["flint:Dj9T:AtoB"]!.accounts;
      return [
        r("FLiNTXPwppyoJabCoxc2uiiRygAHpmMXajiDXo2Ub1z"),
        w(a[2]!.address!),
        w(a[3]!.address!),
        w(a[5]!.address!),
        w(a[7]!.address!),
        r(INSTRUCTIONS),
      ];
    },
    cases: () => [{ vector: "flint:Dj9T:AtoB", pay: USDT, buy: USDC, amountIn: 1_000_000n }],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Deriverse",
    programs: ["deriverse"],
    dirs: ["deriverse-swap", "pumpswap"],
    clock: 1_783_123_200n,
    slot: () => {
      const a = VECTORS["deriverse:8Wk2:sell"]!.accounts;
      const b = VECTORS["deriverse:8Wk2:buy"]!.accounts;
      return [
        r("DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD"),
        w(a[5]!.address!),
        w(a[3]!.address!),
        w(a[4]!.address!),
        w(a[6]!.address!),
        w(a[7]!.address!),
        w(b[6]!.address!),
        w(b[7]!.address!),
        w(a[8]!.address!),
        w(a[9]!.address!),
        w(a[10]!.address!),
      ];
    },
    cases: () => [
      {
        vector: "deriverse:8Wk2:sell",
        dir: true,
        pay: WSOL,
        buy: USDC,
        amountIn: 100_000_000n,
        ata: true,
        authorityWritable: true,
      },
      {
        vector: "deriverse:8Wk2:buy",
        dir: false,
        pay: USDC,
        buy: WSOL,
        amountIn: 10_000_000n,
        ata: true,
        authorityWritable: true,
      },
    ],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "GoonfiV2",
    programs: ["goonfi-v2"],
    // A live capture, every account at one slot (454,368,771): the recipes' fixture lacks the global
    // config and the validator, and its pool's quote has long gone stale.
    dirs: ["goonfi-v2-live"],
    clock: 1_791_415_383n,
    atSlot: 454_368_771n,
    slot: () => {
      const c = cfg("goonfi-v2:TcMg:xToY");
      const a = VECTORS["goonfi-v2:TcMg:xToY"]!.accounts;
      return [
        r("goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE"),
        w(c.pool!),
        w(c.vaultA!),
        w(c.vaultB!),
        r(c.oracle!),
        r(a[9]!.address!),
        r(INSTRUCTIONS),
        r(a[13]!.address!),
      ];
    },
    cases: () => {
      const c = cfg("goonfi-v2:TcMg:xToY");
      return [
        {
          vector: "goonfi-v2:TcMg:xToY",
          dir: true,
          pay: c.mintA as Address,
          buy: USDC,
          amountIn: 1_000_000_000n,
          authorityWritable: true,
        },
        {
          vector: "goonfi-v2:TcMg:yToX",
          dir: false,
          pay: USDC,
          buy: c.mintA as Address,
          amountIn: 1_000_000_000n,
          authorityWritable: true,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "MeteoraDbc",
    programs: ["meteora-dbc"],
    dirs: ["meteora-dbc"],
    clock: 2_000_000_000n,
    slot: () => {
      const c = cfg("meteora-dbc:5HXw:quoteToBase");
      const a = VECTORS["meteora-dbc:5HXw:quoteToBase"]!.accounts;
      return [
        r("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"),
        w(c.pool!),
        r(a[0]!.address!),
        r(c.config!),
        w(c.baseVault!),
        w(c.quoteVault!),
        r(a[13]!.address!),
      ];
    },
    cases: () => {
      const c = cfg("meteora-dbc:5HXw:quoteToBase");
      return [
        {
          vector: "meteora-dbc:5HXw:quoteToBase",
          pay: WSOL,
          buy: c.baseMint as Address,
          amountIn: 1_000_000n,
        },
        {
          vector: "meteora-dbc:5HXw:baseToQuote",
          pay: c.baseMint as Address,
          buy: WSOL,
          amountIn: 1_000_000_000_000n,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Trends",
    programs: ["trends"],
    dirs: ["trends", "pumpswap"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("trends:8naj:quoteToBase");
      const a = VECTORS["trends:8naj:quoteToBase"]!.accounts;
      return [
        r("CURVEmPpijXDTNdqrA9PGP1io2rkgiVXH26xdXVGLLfz"),
        w(c.pool!),
        r(a[0]!.address!),
        r(a[2]!.address!),
        w(c.baseVault!),
        w(c.quoteVault!),
        r(a[13]!.address!),
      ];
    },
    cases: () => {
      const c = cfg("trends:8naj:quoteToBase");
      return [
        {
          vector: "trends:8naj:quoteToBase",
          pay: WSOL,
          buy: c.baseMint as Address,
          amountIn: 100_000_000n,
          received: 3_024_232_156_216n,
          buyProgram: TOKEN_2022,
        },
        {
          vector: "trends:8naj:baseToQuote",
          pay: c.baseMint as Address,
          buy: WSOL,
          amountIn: 3_024_232_156_216n,
          payProgram: TOKEN_2022,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[4]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Heaven",
    programs: ["heaven", "chainlink-store"],
    dirs: ["heaven"],
    clock: 1_785_549_284n,
    atSlot: 436_471_307n,
    slot: () => {
      const c = cfg("heaven:EkU9:buy");
      const a = VECTORS["heaven:EkU9:buy"]!.accounts;
      return [
        r("HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"),
        w(c.pool!),
        w(c.tokenAVault!),
        w(c.tokenBVault!),
        w(c.protocolConfig!),
        r(INSTRUCTIONS),
        r(a[14]!.address!),
        r(a[15]!.address!),
        r(a[2]!.address!),
        r(SYSTEM),
      ];
    },
    cases: () => {
      const c = cfg("heaven:EkU9:buy");
      return [
        {
          vector: "heaven:EkU9:buy",
          dir: false,
          pay: WSOL,
          buy: c.tokenAMint as Address,
          amountIn: 100_000_000n,
          received: 5_967_130_162_906n,
          buyProgram: TOKEN_2022,
          authorityWritable: true,
          native: true,
          extensions: true,
        },
        {
          vector: "heaven:EkU9:sell",
          dir: true,
          pay: c.tokenAMint as Address,
          buy: WSOL,
          amountIn: 5_967_130_162_906n,
          payProgram: TOKEN_2022,
          authorityWritable: true,
          native: true,
          extensions: true,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[2]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Virtuals",
    programs: ["virtuals"],
    dirs: ["virtuals"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("virtuals:135Q:baseToQuote");
      const a = VECTORS["virtuals:135Q:baseToQuote"]!.accounts;
      return [
        r("5U3EU2ubXtK84QcRjWVmYt9RaDyA8gKxdUrPFXmZyaki"),
        w(c.pool!),
        w(c.vpoolTokenAta!),
        w(a[6]!.address!),
        w(c.platformPrototypeVirtualsAta!),
        w(c.vpoolVirtualsAta!),
      ];
    },
    cases: () => {
      const c = cfg("virtuals:135Q:baseToQuote");
      return [
        {
          vector: "virtuals:135Q:baseToQuote",
          pay: c.baseMint as Address,
          buy: VECTORS["virtuals:135Q:baseToQuote"]!.buy as Address,
          amountIn: 500_000_000n,
        },
      ];
    },
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[5]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Xorca",
    programs: ["xorca"],
    dirs: ["xorca"],
    clock: 1_783_123_200n,
    slot: () => [
      r("StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT"),
      r(VECTORS["xorca:CSqK:orcaToXorca"]!.accounts[5]!.address!),
      w(VECTORS["xorca:CSqK:orcaToXorca"]!.accounts[1]!.address!),
      w(VECTORS["xorca:CSqK:orcaToXorca"]!.accounts[4]!.address!),
    ],
    cases: () => [
      {
        vector: "xorca:CSqK:orcaToXorca",
        pay: VECTORS["xorca:CSqK:orcaToXorca"]!.pay as Address,
        buy: VECTORS["xorca:CSqK:orcaToXorca"]!.buy as Address,
        amountIn: 1_000_000_000n,
        received: 640_440_724n,
        authorityWritable: true,
      },
    ],
  },
  {
    name: "Solayer",
    programs: ["solayer"],
    dirs: ["solayer"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("solayer:HBkJ:delegate");
      return [
        r("endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT"),
        r(c.pool!),
        w(c.receiptMint!),
        w(c.vault!),
        r(c.lstMint!),
      ];
    },
    cases: () => [
      {
        vector: "solayer:HBkJ:delegate",
        dir: true,
        pay: cfg("solayer:HBkJ:delegate").lstMint as Address,
        buy: cfg("solayer:HBkJ:delegate").receiptMint as Address,
        amountIn: 1_000_000_000n,
        received: 1_000_000_000n,
      },
    ],
  },
  {
    name: "Solayer",
    programs: ["solayer"],
    dirs: ["solayer-dir1"],
    clock: 1_783_123_200n,
    slot: () => {
      const c = cfg("solayer:745m:undelegate");
      return [
        r("endoLNCKTqDn8gSVnN2hDdpgACUPWHZTwoYnnMybpAT"),
        r(c.pool!),
        w(c.receiptMint!),
        w(c.vault!),
        r(c.lstMint!),
      ];
    },
    cases: () => [
      {
        vector: "solayer:745m:undelegate",
        dir: false,
        pay: cfg("solayer:745m:undelegate").receiptMint as Address,
        buy: cfg("solayer:745m:undelegate").lstMint as Address,
        amountIn: 1_000_000n,
        received: 1_000_000n,
      },
    ],
    skips: [
      {
        why: "an undelegation the vault holds nothing for",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "Voltr",
    programs: ["voltr"],
    dirs: ["voltr"],
    // After the vault's last update: a withdrawal before it overflows the vault's profit unlock.
    clock: 1_785_538_883n,
    writableOneWay: [cfg("voltr:Gj8k:assetToLp").vaultAssetIdleAuth!],
    slot: () => {
      const c = cfg("voltr:Gj8k:assetToLp");
      return [
        r("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8"),
        w(c.pool!),
        r(c.protocol!),
        w(c.lpMint!),
        w(c.vaultAssetIdleAta!),
        w(c.vaultAssetIdleAuth!),
        r(c.vaultLpMintAuth!),
        r(SYSTEM),
      ];
    },
    cases: () => {
      const c = cfg("voltr:Gj8k:assetToLp");
      return [
        {
          vector: "voltr:Gj8k:assetToLp",
          dir: true,
          pay: c.assetMint as Address,
          buy: c.lpMint as Address,
          amountIn: 1_000_000_000n,
          received: 998_316_684n,
          ata: true,
        },
        {
          vector: "voltr:Gj8k:lpToAsset",
          dir: false,
          pay: c.lpMint as Address,
          buy: c.assetMint as Address,
          amountIn: 998_316_684n,
          ata: true,
        },
      ];
    },
  },
  {
    name: "VaultLiquidUnstake",
    programs: ["vault-liquid-unstake"],
    dirs: ["vault-liquid-unstake-current"],
    clock: 1_789_826_554n,
    atSlot: 448_428_891n,
    atEpoch: { epoch: 1038n, start: 1_789_823_115n },
    slot: () => {
      const k = "vault-liquid-unstake:BanC:lstToSol";
      return [
        r("2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo"),
        w(VECTORS["vault-liquid-unstake:BanC:lstToSol"]!.accounts[7]!.address!),
        w(VECTORS[k]!.accounts[0]!.address!),
        w(VECTORS[k]!.accounts[1]!.address!),
        r(VECTORS[k]!.accounts[6]!.address!),
        w(VECTORS[k]!.accounts[8]!.address!),
        w(VECTORS[k]!.accounts[9]!.address!),
        w(VECTORS[k]!.accounts[10]!.address!),
        r(SYSTEM),
      ];
    },
    cases: () => [
      {
        vector: "vault-liquid-unstake:BanC:lstToSol",
        pay: VECTORS["vault-liquid-unstake:BanC:lstToSol"]!.pay as Address,
        buy: WSOL,
        amountIn: 1_000_000_000n,
        native: true,
        authorityWritable: true,
      },
    ],
  },
  {
    name: "HyloStabilityPool",
    programs: ["hylo-stability-pool"],
    dirs: ["hylo-stability-pool"],
    clock: 1_753_900_000n,
    atSlot: 200_000_000n,
    atEpoch: { epoch: 1010n, start: 1_753_900_000n },
    writableOneWay: [VECTORS["hylo-stability-pool:2jk7:deposit"]!.accounts[1]!.address!],
    slot: () => {
      const d = VECTORS["hylo-stability-pool:2jk7:deposit"]!.accounts;
      const x = VECTORS["hylo-stability-pool:2jk7:withdraw"]!.accounts;
      return [
        r("HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ"),
        w(d[1]!.address!),
        r(d[2]!.address!),
        w(d[7]!.address!),
        r(d[6]!.address!),
        r(d[8]!.address!),
        w(d[9]!.address!),
        r(x[5]!.address!),
        w(x[6]!.address!),
        r(d[11]!.address!),
      ];
    },
    cases: () => {
      const v = VECTORS["hylo-stability-pool:2jk7:deposit"]!;
      return [
        {
          vector: "hylo-stability-pool:2jk7:deposit",
          dir: true,
          pay: v.pay as Address,
          buy: v.buy as Address,
          amountIn: 10_000_000n,
          authorityWritable: true,
        },
        {
          vector: "hylo-stability-pool:2jk7:withdraw",
          dir: false,
          pay: v.buy as Address,
          buy: v.pay as Address,
          amountIn: 5_000_000n,
          authorityWritable: true,
        },
      ];
    },
  },
  {
    name: "Huma",
    programs: ["huma"],
    dirs: ["huma-swap", "pumpswap"],
    clock: 1_785_542_609n,
    slot: () => {
      const c = cfg("huma:3Fho:deposit");
      return [
        r("HumaXepHnjaRCpjYTokxY4UtaJcmx41prQ8cxGmFC5fn"),
        r(c.modeConfig!),
        r(c.humaConfig!),
        r(c.poolConfigAccount!),
        w(c.poolState!),
        w(c.modeMint!),
        r(c.poolAuthority!),
        w(c.poolUnderlyingToken!),
      ];
    },
    cases: () => [
      {
        vector: "huma:3Fho:deposit",
        pay: USDC,
        buy: cfg("huma:3Fho:deposit").modeMint as Address,
        amountIn: 1_000_000_000n,
        received: 891_762_225n,
      },
    ],
  },
  {
    name: "HeliumTreasury",
    programs: ["helium-treasury", "helium-circuit-breaker"],
    dirs: ["helium-treasury"],
    clock: 1_785_600_000n,
    floor: 0n,
    slot: () => {
      const c = cfg("helium-treasury:Aon7:redeem");
      return [
        r("treaf4wWBBty3fHdyBpo35Mz84M8k3heKXmjmi9vFt5"),
        r(c.pool!),
        w(c.supplyMint!),
        w(c.treasury!),
        w(c.circuitBreaker!),
        r(VECTORS["helium-treasury:Aon7:redeem"]!.accounts[8]!.address!),
      ];
    },
    cases: () => [
      {
        vector: "helium-treasury:Aon7:redeem",
        pay: cfg("helium-treasury:Aon7:redeem").supplyMint as Address,
        buy: cfg("helium-treasury:Aon7:redeem").treasuryMint as Address,
        amountIn: 1_000_000_000n,
        received: 13_380_487n,
      },
    ],
    skips: [
      {
        why: "an empty treasury",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
  {
    name: "SolfiV1",
    programs: ["solfi-v1"],
    dirs: ["solfi-v1"],
    clock: 1_783_175_236n,
    slot: () => {
      const c = cfg("solfi-v1:rfyn:0");
      return [
        r("SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe"),
        w(c.pool!),
        w(c.vaultA!),
        w(c.vaultB!),
        r(INSTRUCTIONS),
      ];
    },
    // Every SolFi v1 pool holds an empty vault: its liquidity has moved to SolFi v2. The vaults get
    // 1e14 each, as the recipes' own cell gives them; the pool, its prices and the program are real.
    fabricate: (harness) =>
      [cfg("solfi-v1:rfyn:0").vaultA!, cfg("solfi-v1:rfyn:0").vaultB!].map((at) => {
        const account = harness.svm.getAccount(at as Address);
        if (!account.exists) throw new Error(`no vault ${at}`);
        const data = new Uint8Array(account.data);
        new DataView(data.buffer).setBigUint64(64, 100_000_000_000_000n, true);
        harness.svm.setAccount({ ...account, data });
        return at as Address;
      }),
    cases: () => [
      {
        vector: "solfi-v1:rfyn:0",
        dir: true,
        pay: cfg("solfi-v1:rfyn:0").mintA as Address,
        buy: USDC,
        amountIn: 1_000_000_000n,
        // The recipes quote SolFi v1 at its floor rate, 96,482,663 here; the program pays more.
        received: 106_888_897n,
      },
      {
        vector: "solfi-v1:rfyn:1",
        dir: false,
        pay: USDC,
        buy: cfg("solfi-v1:rfyn:0").mintA as Address,
        amountIn: 1_000_000n,
        // The recipes' floor-rate quote: 8,395,290.
        received: 9_301_416n,
      },
    ],
    skips: [
      {
        why: "an empty side",
        at: (slot) => slot[3]!.address,
        offset: 64,
        bytes: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
  },
];

let stabbleBeneficiaryA: Address;
let stabbleBeneficiaryWsol: Address;

const le64 = (value: bigint): string =>
  Buffer.from(new BigUint64Array([value]).buffer).toString("hex");

/** A ref's address: the trade's own, or the ref itself where sauce-recipes names an account (a
 *  sysvar) by its address. */
const refOf = (ref: string, refs: Record<string, Address>): Address | undefined =>
  refs[ref] ?? (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref) ? (ref as Address) : undefined);

/** The venue instruction sauce-recipes builds for `vector`, with the trade's own accounts. */
const expectedCall = (
  vector: Vector,
  amountIn: bigint,
  user: { owner: Address; in: Address; out: Address },
  refs: Record<string, Address> = {},
): { data: string; accounts: Address[] } => ({
  // Archer's data counts whole base lots selling base.
  data: `${vector.prefix}${le64(amountIn / BigInt(vector.amountPatch?.patchDivisorIn ?? 1))}${vector.suffix}`,
  accounts: vector.accounts.map((account) => {
    if (account.user !== undefined) return user[account.user as "owner" | "in" | "out"];
    if (account.address !== undefined) return account.address;
    const ref = refOf(account.ref!, refs);
    if (ref === undefined) throw new Error(`no address for ${account.ref}`);
    return ref;
  }),
});

/** A `Cpi` form's list, from sauce-recipes' instruction: its accounts and which it writes. */
const cpiFromVector = (vector: Vector, refs: Record<string, Address> = {}): CpiAccount[] =>
  vector.accounts.map((account) => ({
    address:
      account.user === "owner"
        ? "authority"
        : account.user === "in"
          ? "source"
          : account.user === "out"
            ? "recipient"
            : (account.address ?? refOf(account.ref!, refs)!),
    writable: account.writable === true,
  }));

/** A `Cpi` form's list, from the instruction a slot form sent: the trade's own accounts by name. */
const cpiFromCall = (
  call: { accounts: Address[] },
  user: { pot: Address; source: Address; recipient: Address },
  writable: Set<Address>,
): CpiAccount[] =>
  call.accounts.map((address) =>
    address === user.pot
      ? { address: "authority" }
      : address === user.source
        ? { address: "source", writable: true }
        : address === user.recipient
          ? { address: "recipient", writable: true }
          : { address, writable: writable.has(address) },
  );

const cuRows: Record<string, string | bigint>[] = [];

beforeAll(async () => {
  const beneficiary = "8UgoPZAR8ZLoEmV6pJ8SZ6JKESP2X8nbnrZSdSgNtg1y";
  stabbleBeneficiaryA = await ata(beneficiary, USDT);
  stabbleBeneficiaryWsol = await ata(beneficiary, WSOL);
});

afterAll(() => {
  if (cuRows.length > 0)
    console.log(JSON.stringify(cuRows, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
});

const named = (outcome: { received: bigint; paid: bigint; returned: bigint }) => ({
  received: String(outcome.received),
  paid: String(outcome.paid),
  returned: String(outcome.returned),
});

describeSvm("@sauce/router's exact-input venues, on the venues' own programs and pools", () => {
  describe.each(VENUES.map((venue) => ({ ...venue, label: `${venue.name} (${venue.dirs[0]})` })))(
    "$label",
    (venue) => {
      let harness: EngineHarness;
      let slot: SlotAccount[];
      const base = venue.name.charAt(0).toLowerCase() + venue.name.slice(1);

      beforeAll(async () => {
        harness = await boot(
          venue.clock,
          venue.dirs,
          venue.programs.map((name) => [venueProgramId(name), `${name}.so.gz`]),
          venue.atSlot,
          venue.atEpoch,
        );
        freeze(harness, venue.fabricate?.(harness) ?? []);
        slot = venue.slot(harness);
      }, 120_000);

      it("swaps both ways, every form alike: the recipes' instruction, their pins", async () => {
        const program = slot[0]!.address;
        const writable = new Set(slot.filter((a) => a.writable).map((a) => a.address));
        for (const trade of venue.cases(harness))
          if (trade.mintsWritable === true) [trade.pay, trade.buy].forEach((m) => writable.add(m));
        const first = { ...venue.cases(harness)[0]!, slot };
        // Empty programs with the same accounts: what each form's own compute units sit on.
        const baseline = succeeded(await cook(harness, compiled("", slot.length), first, program));
        for (const trade of venue.cases(harness)) {
          const vector = trade.vector === undefined ? undefined : VECTORS[trade.vector]!;
          if (vector !== undefined)
            expect({ pay: trade.pay, buy: trade.buy }).toEqual({
              pay: vector.pay,
              buy: vector.buy,
            });
          const fromSlot = succeeded(
            await cook(harness, compiled(base, slot.length), { ...trade, slot }, program),
          );
          const outcomes = [{ name: base, outcome: fromSlot }];
          const received = trade.received ?? fromSlot.received;
          // The Cpi form on the instruction the slot form sent, or the recipes' own.
          const list =
            vector !== undefined
              ? cpiFromVector(vector)
              : cpiFromCall(
                  fromSlot.call!,
                  { pot: harness.pot, source: fromSlot.source, recipient: fromSlot.recipient },
                  writable,
                );
          // The instruction forms on that list: `Cpi`, `Data`, and the recipes' template by hand.
          const at = {
            ...trade,
            minOut: venue.floor ?? 1n,
            slot: [],
            cpi: { program, accounts: list },
          };
          const none = succeeded(
            await cook(harness, instruction("none", base, list.length), at, program),
          );
          const baked = bakedFor(base, trade, vector);
          for (const form of ["Cpi", "Data"] as const)
            outcomes.push({
              name: `${base}${form}`,
              outcome: succeeded(
                await cook(harness, instruction(form, base, list.length, baked), at, program),
              ),
            });
          if (vector !== undefined)
            outcomes.push({
              name: HAND,
              outcome: succeeded(
                await cook(
                  harness,
                  instruction("hand", base, list.length, {
                    prefix: vector.prefix,
                    suffix: vector.suffix,
                  }),
                  at,
                  program,
                ),
              ),
            });
          for (const { name, outcome } of outcomes) {
            const paid = String(trade.paid ?? trade.amountIn);
            // Strings, not bigints: a failure's values cross jest's worker boundary as JSON.
            expect({ name, ...named(outcome) }).toEqual({
              name,
              received: String(received),
              paid,
              returned: name === base ? String(received) : paid,
            });
            expect(outcome.received > 0n).toBe(true);
            const user = { owner: harness.pot, in: outcome.source, out: outcome.recipient };
            if (vector !== undefined)
              expect(outcome.call).toEqual({
                program,
                ...expectedCall(vector, trade.amountIn, user),
              });
            else
              expect(outcome.call).toEqual({
                program,
                data: fromSlot.call!.data,
                accounts: fromSlot.call!.accounts.map((at) =>
                  at === fromSlot.source
                    ? outcome.source
                    : at === fromSlot.recipient
                      ? outcome.recipient
                      : at,
                ),
              });
            cuRows.push({
              venue: venue.label,
              form: name,
              pay: trade.pay,
              library:
                outcome.engineCu - outcome.venueCu - (name === base ? baseline : none).engineCu,
              venueCu: outcome.venueCu,
            });
          }
          // The venue writes exactly the accounts the recipes attach writable.
          if (vector !== undefined)
            for (const account of vector.accounts)
              if (account.address !== undefined && !venue.writableOneWay?.includes(account.address))
                expect({
                  account: account.address,
                  writable: writable.has(account.address),
                }).toEqual({
                  account: account.address,
                  writable: account.writable === true,
                });
        }
      }, 300_000);

      it("a swap below its floor reverts", async () => {
        const trade = venue.cases(harness)[0]!;
        const program = slot[0]!.address;
        const { received } = succeeded(
          await cook(harness, compiled(base, slot.length), { ...trade, slot }, program),
        );
        const at = { ...trade, slot, minOut: received + 1n };
        expect((await cook(harness, compiled(base, slot.length), at, program)).ok).toBe(false);
        succeeded(
          await cook(harness, compiled(base, slot.length), { ...at, minOut: received }, program),
        );
      }, 300_000);

      it("skips, having moved nothing", async () => {
        const trade = venue.cases(harness)[0]!;
        const program = slot[0]!.address;
        const cases: {
          why: string;
          slot: SlotAccount[];
          amountIn: bigint;
          edit?: { at: Address; offset: number; bytes: number[] };
        }[] = [
          {
            why: "a missing slot",
            slot: [slot[0]!, r(SYSTEM), ...slot.slice(2)],
            amountIn: trade.amountIn,
          },
          { why: "no input", slot, amountIn: 0n },
          ...(venue.skips ?? []).map((skip) => ({
            why: skip.why,
            slot,
            amountIn: trade.amountIn,
            edit: { at: skip.at(slot), offset: skip.offset, bytes: skip.bytes },
          })),
        ];
        for (const skip of cases) {
          const undo =
            skip.edit === undefined
              ? undefined
              : editFrozen(harness, skip.edit.at, skip.edit.offset, skip.edit.bytes);
          try {
            const outcome = succeeded(
              await cook(
                harness,
                compiled(base, slot.length),
                { ...trade, slot: skip.slot, amountIn: skip.amountIn },
                program,
              ),
            );
            expect({ why: skip.why, ...named(outcome) }).toEqual({
              why: skip.why,
              received: "0",
              paid: "0",
              returned: "0",
            });
          } finally {
            undo?.();
          }
        }
      }, 300_000);

      it("refuses a slot or a list naming another program, before the authority signs into it", async () => {
        const trade = venue.cases(harness)[0]!;
        const other =
          venue.name === "Saber"
            ? TOKEN_2022
            : ("SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ" as Address);
        const misnamed = [r(other), ...slot.slice(1)];
        expect(
          refused(
            await cook(harness, compiled(base, slot.length), { ...trade, slot: misnamed }, other),
          ),
        ).toMatch(/^not an? /);
        const list = [{ address: "source" as const, writable: true }];
        const baked = bakedFor(base, trade, VECTORS[trade.vector ?? ""]);
        expect(
          refused(
            await cook(
              harness,
              instruction("Cpi", base, 1, baked),
              { ...trade, minOut: 1n, slot: [], cpi: { program: other, accounts: list } },
              other,
            ),
          ),
        ).toMatch(/^not an? /);
        // A field past its slot, which cut to it would name another token or instrument: refused
        // before the call.
        const args = svmExactInArguments(`${base}Cpi`)!;
        const wide = args.includes("inIndex")
          ? { field: "inIndex", value: "256", reason: "index past its byte" }
          : args.includes("instrId")
            ? { field: "instrId", value: String(1n << 32n), reason: "instrId past 32 bits" }
            : undefined;
        if (wide !== undefined)
          for (const form of ["Cpi", "Data"] as const)
            expect(
              refused(
                await cook(
                  harness,
                  instruction(form, base, 1, { ...baked, [wide.field]: wide.value }),
                  {
                    ...trade,
                    minOut: 1n,
                    slot: [],
                    cpi: { program: slot[0]!.address, accounts: list },
                  },
                  slot[0]!.address,
                ),
              ),
            ).toBe(wide.reason);
      }, 300_000);
    },
  );

  // The venues whose swap takes more accounts than a function can list: their `Cpi` forms, on the
  // recipes' own instructions.
  interface CpiVenue {
    name: string;
    programs: string[];
    dirs: string[];
    clock: bigint;
    atSlot?: bigint;
    atEpoch?: { epoch: bigint; start: bigint };
    /** The floor the recipes' instruction writes, which the `Cpi` and `Data` forms are given: 1. */
    floor?: bigint;
    fabricate?: (harness: EngineHarness) => Address[];
    /** Transactions to send before the state is frozen, and the accounts they create. */
    prepare?: (harness: EngineHarness) => Promise<Address[]>;
    cases: (Omit<Trade, "slot"> & {
      vector: string;
      received?: bigint;
      /** What the swap spends, where it is not `amountIn`: Archer's whole lots, buying base. */
      paid?: bigint;
      ata?: boolean;
      dir?: boolean;
    })[];
  }
  const CPI_VENUES: CpiVenue[] = [
    {
      name: "scaleAmm",
      programs: ["scale-amm"],
      dirs: ["scale-amm"],
      clock: 1_800_000_000n,
      cases: [
        {
          vector: "scale-amm:H8uP:aToB",
          dir: true,
          pay: WSOL,
          buy: cfg("scale-amm:H8uP:aToB").mintB as Address,
          amountIn: 1_000_000_000n,
          received: 161_805_188_599n,
        },
        {
          vector: "scale-amm:H8uP:bToA",
          dir: false,
          pay: cfg("scale-amm:H8uP:aToB").mintB as Address,
          buy: WSOL,
          amountIn: 161_805_188_599n,
        },
      ],
    },
    {
      name: "pumpswap",
      programs: ["pumpswap", "pump-fee"],
      dirs: ["pumpswap"],
      clock: 1_783_123_200n,
      // The fee destinations a swap pays into: quote-mint token accounts at the derived addresses.
      // A buy takes the authority's volume accumulator, which a Pot cannot pay to create (the System
      // program moves no lamports out of an account with data): it is created first, with the
      // harness payer paying, as `init_user_volume_accumulator` lets any payer do.
      prepare: async (harness) => {
        const program = venueProgramId("pumpswap");
        const [accumulator] = await getProgramDerivedAddress({
          programAddress: program,
          seeds: ["user_volume_accumulator", getAddressEncoder().encode(harness.pot)],
        });
        const [eventAuthority] = await getProgramDerivedAddress({
          programAddress: program,
          seeds: ["__event_authority"],
        });
        const result = await sendInstructions(harness, [
          {
            programAddress: program,
            accounts: [
              { address: harness.payer.address, role: AccountRole.WRITABLE_SIGNER },
              { address: harness.pot, role: AccountRole.READONLY },
              { address: accumulator, role: AccountRole.WRITABLE },
              { address: SYSTEM, role: AccountRole.READONLY },
              { address: eventAuthority, role: AccountRole.READONLY },
              { address: program, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.from("5e06ca73ff60e8b7", "hex")),
          },
        ]);
        if (!result.ok)
          throw new Error(`init_user_volume_accumulator: ${result.err}\n${result.logs.join("\n")}`);
        return [accumulator];
      },
      fabricate: (harness) =>
        ["pumpswap:2uF4:baseToQuote", "pumpswap:GseM:baseToQuote"].flatMap((key) => {
          const c = cfg(key);
          return [
            setTokenAccount(
              harness,
              c.protocolFeeRecipientTokenAccount as Address,
              c.quoteMint as Address,
              c.protocolFeeRecipient as Address,
              0n,
              c.quoteTokenProgram as Address,
            ),
            setTokenAccount(
              harness,
              c.coinCreatorVaultAta as Address,
              c.quoteMint as Address,
              c.coinCreatorVaultAuthority as Address,
              0n,
              c.quoteTokenProgram as Address,
            ),
            setTokenAccount(
              harness,
              c.buybackFeeRecipientTokenAccount as Address,
              c.quoteMint as Address,
              c.buybackFeeRecipient as Address,
              0n,
              c.quoteTokenProgram as Address,
            ),
          ];
        }),
      cases: [
        {
          vector: "pumpswap:2uF4:baseToQuote",
          dir: true,
          pay: cfg("pumpswap:2uF4:baseToQuote").baseMint as Address,
          buy: USDC,
          amountIn: 50_000_000_000n,
          received: 78_539_874n,
          payProgram: TOKEN_2022,
        },
        {
          vector: "pumpswap:2uF4:quoteToBase",
          dir: false,
          pay: USDC,
          buy: cfg("pumpswap:2uF4:baseToQuote").baseMint as Address,
          amountIn: 78_539_874n,
          buyProgram: TOKEN_2022,
        },
        {
          vector: "pumpswap:GseM:baseToQuote",
          dir: true,
          pay: cfg("pumpswap:GseM:baseToQuote").baseMint as Address,
          buy: WSOL,
          amountIn: 1_000_000_000n,
        },
        {
          vector: "pumpswap:GseM:quoteToBase",
          dir: false,
          pay: WSOL,
          buy: cfg("pumpswap:GseM:baseToQuote").baseMint as Address,
          amountIn: 1_000_000_000n,
        },
      ],
    },
    {
      name: "bonkswap",
      programs: ["bonkswap"],
      dirs: ["bonkswap"],
      clock: 1_783_123_200n,
      cases: [
        {
          vector: "bonkswap:5MMa:yToX",
          dir: false,
          pay: USDC,
          buy: cfg("bonkswap:5MMa:xToY").tokenX as Address,
          amountIn: 1_000_000n,
          received: 35_910_423_250n,
          ata: true,
        },
        {
          vector: "bonkswap:5MMa:xToY",
          dir: true,
          pay: cfg("bonkswap:5MMa:xToY").tokenX as Address,
          buy: USDC,
          amountIn: 1_000_000n,
          received: 25n,
          ata: true,
        },
      ],
    },
    {
      name: "guacswap",
      programs: ["guacswap"],
      dirs: ["guacswap"],
      clock: 1_783_123_200n,
      cases: [
        {
          vector: "guacswap:93tH:xToY",
          dir: true,
          pay: WSOL,
          buy: USDC,
          amountIn: 1_000_000n,
          received: 72_526n,
          ata: true,
        },
        {
          vector: "guacswap:93tH:yToX",
          dir: false,
          pay: USDC,
          buy: WSOL,
          amountIn: 1_000_000n,
          received: 13_711_367n,
          ata: true,
        },
      ],
    },
    {
      name: "meteoraDlmm",
      programs: ["meteora-dlmm"],
      dirs: ["meteora-dlmm"],
      clock: 1_783_355_400n,
      cases: [
        {
          vector: "meteora-dlmm:5rCf:xToY",
          pay: WSOL,
          buy: USDC,
          amountIn: 5_000_000_000n,
          received: 408_662_622n,
        },
        {
          vector: "meteora-dlmm:5rCf:yToX",
          pay: USDC,
          buy: WSOL,
          amountIn: 408_662_622n,
        },
      ],
    },
    {
      name: "sarosDlmm",
      programs: ["saros-dlmm"],
      dirs: ["saros-dlmm"],
      clock: 1_785_540_000n,
      cases: [
        {
          vector: "saros-dlmm:DHXK:xToY",
          dir: true,
          pay: cfg("saros-dlmm:DHXK:xToY").tokenXMint as Address,
          buy: USDC,
          amountIn: 300_000_000n,
          received: 299_969_399n,
        },
        {
          vector: "saros-dlmm:DHXK:yToX",
          dir: false,
          pay: USDC,
          buy: cfg("saros-dlmm:DHXK:xToY").tokenXMint as Address,
          amountIn: 500_000_000n,
          received: 499_879_537n,
        },
      ],
    },
    {
      name: "raydiumLaunchlab",
      programs: ["raydium-launchlab"],
      dirs: ["raydium-launchlab", "pumpswap"],
      clock: 1_783_123_200n,
      // The creator's fee vault, which the swap creates (the authority paying) when it is missing.
      fabricate: (harness) => [
        setTokenAccount(
          harness,
          cfg("raydium-launchlab:At3u:quoteToBase").creatorVault as Address,
          WSOL,
          "11111111111111111111111111111111" as Address,
          0n,
        ),
      ],
      cases: [
        {
          vector: "raydium-launchlab:At3u:quoteToBase",
          dir: false,
          pay: WSOL,
          buy: cfg("raydium-launchlab:At3u:quoteToBase").baseMint as Address,
          amountIn: 100_000_000n,
          received: 3_376_989_672_690n,
        },
        {
          vector: "raydium-launchlab:At3u:baseToQuote",
          dir: true,
          pay: cfg("raydium-launchlab:At3u:quoteToBase").baseMint as Address,
          buy: WSOL,
          amountIn: 3_376_989_672_690n,
        },
      ],
    },
    {
      name: "runnerRodeo",
      programs: ["runner-rodeo"],
      dirs: ["runner-rodeo", "pumpswap"],
      clock: 1_783_123_200n,
      cases: [
        {
          vector: "runner-rodeo:5r3n:quoteToBase",
          pay: WSOL,
          buy: cfg("runner-rodeo:5r3n:quoteToBase").baseMint as Address,
          amountIn: 1_000_000n,
          received: 48_770_122_519n,
          buyProgram: TOKEN_2022,
          native: true,
          extensions: true,
        },
        {
          vector: "runner-rodeo:5r3n:baseToQuote",
          pay: cfg("runner-rodeo:5r3n:quoteToBase").baseMint as Address,
          buy: WSOL,
          amountIn: 48_770_122_519n,
          payProgram: TOKEN_2022,
          native: true,
          extensions: true,
        },
      ],
    },
    {
      name: "scaleVmm",
      programs: ["scale-vmm", "scale-amm"],
      dirs: ["scale-vmm"],
      clock: 1_800_000_000n,
      cases: [
        {
          vector: "scale-vmm:9vrZ:aToB",
          dir: true,
          pay: cfg("scale-vmm:9vrZ:aToB").mintA as Address,
          buy: cfg("scale-vmm:9vrZ:aToB").mintB as Address,
          amountIn: 1_000_000n,
          received: 95_621n,
        },
        {
          vector: "scale-vmm:9vrZ:bToA",
          dir: false,
          pay: cfg("scale-vmm:9vrZ:aToB").mintB as Address,
          buy: cfg("scale-vmm:9vrZ:aToB").mintA as Address,
          amountIn: 95_621n,
        },
      ],
    },
    {
      name: "jupiterLendEarn",
      programs: ["jupiter-lend-earn", "jupiter-lend-liquidity"],
      dirs: ["jupiter-lend-earn"],
      clock: 1_786_004_870n,
      cases: [
        {
          vector: "jupiter-lend-earn:2vVY:deposit",
          dir: true,
          pay: USDC,
          buy: cfg("jupiter-lend-earn:2vVY:deposit").fTokenMint as Address,
          amountIn: 1_000_000n,
          received: 948_311n,
        },
        {
          vector: "jupiter-lend-earn:2vVY:redeem",
          dir: false,
          pay: cfg("jupiter-lend-earn:2vVY:deposit").fTokenMint as Address,
          buy: USDC,
          amountIn: 948_311n,
        },
      ],
    },
    {
      name: "hylo",
      programs: ["hylo"],
      dirs: ["hylo-live"],
      clock: 1_790_851_150n,
      atSlot: 452_263_170n,
      cases: [
        {
          vector: "hylo:CMNP:aToB",
          dir: true,
          pay: USDC,
          buy: VECTORS["hylo:CMNP:aToB"]!.buy as Address,
          amountIn: 1_000_000n,
          received: 1_000_000n,
        },
      ],
    },
    {
      name: "hylo",
      programs: ["hylo"],
      dirs: ["hylo-current"],
      clock: 1_789_829_516n,
      atSlot: 448_439_986n,
      cases: [
        {
          vector: "hylo:CMNP:bToA",
          dir: false,
          pay: VECTORS["hylo:CMNP:bToA"]!.pay as Address,
          buy: USDC,
          amountIn: 10_000n,
          received: 9_980n,
        },
      ],
    },
    {
      name: "carrot",
      programs: ["carrot", "carrot-log"],
      dirs: ["carrot-swap", "pumpswap"],
      clock: 1_785_541_744n,
      cases: [
        {
          vector: "carrot:FfCR:issue0",
          dir: true,
          pay: USDC,
          buy: VECTORS["carrot:FfCR:issue0"]!.buy as Address,
          amountIn: 100_000n,
          received: 1_735_386n,
          ata: true,
          buyProgram: TOKEN_2022,
        },
        {
          vector: "carrot:FfCR:redeem0",
          dir: false,
          pay: VECTORS["carrot:FfCR:issue0"]!.buy as Address,
          buy: USDC,
          amountIn: 1_735_386n,
          ata: true,
          payProgram: TOKEN_2022,
        },
      ],
    },
    {
      name: "mswap",
      programs: ["mswap", "m0-wm-ext", "m0-ext"],
      dirs: ["mswap-current"],
      clock: 1_790_409_613n,
      atSlot: 450_614_395n,
      cases: [
        {
          vector: "mswap:462b:wmToDawn",
          pay: VECTORS["mswap:462b:wmToDawn"]!.pay,
          buy: VECTORS["mswap:462b:wmToDawn"]!.buy,
          amountIn: 1_000_000n,
          received: 1_000_000n,
          payProgram: TOKEN_2022,
          buyProgram: TOKEN_2022,
        },
        {
          vector: "mswap:6u8D:dawnToWm",
          pay: VECTORS["mswap:462b:wmToDawn"]!.buy,
          buy: VECTORS["mswap:462b:wmToDawn"]!.pay,
          amountIn: 1_000_000n,
          received: 1_000_000n,
          payProgram: TOKEN_2022,
          buyProgram: TOKEN_2022,
        },
      ],
    },
    {
      name: "perpsJlp",
      programs: ["perps-jlp"],
      dirs: ["perps-jlp-mint-active"],
      clock: 1_789_754_842n,
      atSlot: 448_159_719n,
      cases: [
        {
          vector: "perps-jlp:7xS2:solToUsdc",
          pay: WSOL,
          buy: USDC,
          amountIn: 1_000_000_000n,
          received: 111_894_291n,
          native: true,
        },
        {
          vector: "perps-jlp:G18j:usdcToSol",
          pay: USDC,
          buy: WSOL,
          amountIn: 100_000_000n,
          received: 887_978_158n,
          native: true,
        },
      ],
    },
    {
      name: "perpsJlpMint",
      programs: ["perps-jlp"],
      dirs: ["perps-jlp-mint-active"],
      clock: 1_789_754_842n,
      atSlot: 448_159_719n,
      cases: [
        {
          vector: "perps-jlp-mint:5BUw:usdc",
          pay: USDC,
          buy: VECTORS["perps-jlp-mint:5BUw:usdc"]!.buy,
          amountIn: 1_000_000_000n,
          received: 213_199_006n,
        },
      ],
    },
    {
      name: "sanctumInfinity",
      programs: [
        "sanctum-infinity",
        "infinity-flat-slab",
        "infinity-wsol-calc",
        "infinity-spl-calc",
        "infinity-sanctum-calc",
        "infinity-multi-calc",
        "infinity-spl-pool",
        "infinity-sanctum-pool",
        "infinity-multi-pool",
      ],
      dirs: ["infinity-current"],
      clock: 1_789_832_956n,
      atSlot: 448_452_857n,
      atEpoch: { epoch: 1038n, start: 1_789_823_115n },
      // A stake pool's calculator reads its program's ProgramData, which the capture holds only the
      // header of and loading the program replaces: the header again, with the program behind it.
      fabricate: (harness) =>
        (["spl", "sanctum", "multi"] as const).map((kind) => {
          const fixture = JSON.parse(
            readFileSync(
              new URL(
                `../../svm/fixtures/infinity-current/infinity-${kind}-pool-programdata.json`,
                import.meta.url,
              ),
              "utf8",
            ),
          ) as { address: Address; owner: Address; base64Data: string };
          const header = Buffer.from(fixture.base64Data, "base64");
          const program = venueProgram(`infinity-${kind}-pool.so.gz`);
          const data = new Uint8Array(header.length + program.length);
          data.set(header);
          data.set(program, header.length);
          harness.svm.setAccount({
            address: fixture.address,
            data,
            programAddress: fixture.owner,
            executable: false,
            lamports: lamports(harness.svm.minimumBalanceForRentExemption(BigInt(data.length))),
            space: BigInt(data.length),
          });
          return fixture.address;
        }),
      cases: [
        {
          vector: "sanctum-infinity:FRNE:wsolToJito",
          pay: WSOL,
          buy: VECTORS["sanctum-infinity:FRNE:wsolToJito"]!.buy,
          // The pool holds 0.146 JitoSOL: a whole SOL is past it.
          amountIn: 100_000_000n,
          received: 76_745_841n,
          native: true,
        },
        {
          vector: "sanctum-infinity:8ZMu:jitoToWsol",
          pay: VECTORS["sanctum-infinity:FRNE:wsolToJito"]!.buy,
          buy: WSOL,
          amountIn: 1_000_000_000n,
          received: 1_293_681_789n,
          native: true,
        },
        {
          vector: "sanctum-infinity:7p4Y:jupToSctm",
          pay: VECTORS["sanctum-infinity:7p4Y:jupToSctm"]!.pay,
          buy: VECTORS["sanctum-infinity:7p4Y:jupToSctm"]!.buy,
          amountIn: 1_000_000_000n,
          received: 1_083_328_274n,
        },
      ],
    },
    {
      name: "archer",
      programs: ["archer"],
      dirs: ["archer-usdv"],
      clock: 1_790_409_788n,
      atSlot: 450_615_056n,
      floor: 0n,
      cases: [
        {
          vector: "archer:BZDU:baseIn",
          dir: true,
          pay: VECTORS["archer:BZDU:baseIn"]!.pay,
          buy: USDC,
          amountIn: 100_000_000n,
          received: 99_999_000n,
          payProgram: TOKEN_2022,
          authorityWritable: true,
        },
        {
          vector: "archer:BZDU:quoteIn",
          dir: false,
          pay: USDC,
          buy: VECTORS["archer:BZDU:baseIn"]!.pay,
          amountIn: 100_000_000n,
          received: 99_000_000n,
          paid: 99_000_990n,
          buyProgram: TOKEN_2022,
          authorityWritable: true,
        },
      ],
    },
    {
      name: "archer",
      programs: ["archer"],
      dirs: ["archer-sol"],
      clock: 1_790_409_789n,
      atSlot: 450_615_059n,
      floor: 0n,
      cases: [
        {
          vector: "archer:u8tn:baseIn",
          dir: true,
          pay: WSOL,
          buy: USDC,
          amountIn: 100_000_000n,
          received: 12_059_300n,
          authorityWritable: true,
        },
        {
          vector: "archer:u8tn:quoteIn",
          dir: false,
          pay: USDC,
          buy: WSOL,
          amountIn: 100_000_000n,
          received: 828_000_000n,
          paid: 99_906_480n,
          authorityWritable: true,
        },
      ],
    },
  ];

  describe.each(CPI_VENUES)("$name", (venue) => {
    let harness: EngineHarness;

    beforeAll(async () => {
      harness = await boot(
        venue.clock,
        venue.dirs,
        venue.programs.map((name) => [venueProgramId(name), `${name}.so.gz`]),
        venue.atSlot,
        venue.atEpoch,
      );
      freeze(harness, [
        ...(venue.fabricate?.(harness) ?? []),
        ...((await venue.prepare?.(harness)) ?? []),
      ]);
    }, 120_000);

    it("swaps the recipes' instruction through its Cpi form, both ways", async () => {
      for (const trade of venue.cases) {
        const vector = VECTORS[trade.vector]!;
        expect({ pay: trade.pay, buy: trade.buy }).toEqual({ pay: vector.pay, buy: vector.buy });
        const refs = {
          "pumpswap-user-volume-accumulator": (
            await getProgramDerivedAddress({
              programAddress: vector.program,
              seeds: ["user_volume_accumulator", getAddressEncoder().encode(harness.pot)],
            })
          )[0],
        };
        const list = cpiFromVector(vector, refs);
        const at = {
          ...trade,
          minOut: venue.floor ?? 1n,
          slot: [],
          cpi: { program: vector.program, accounts: list },
        };
        const none = succeeded(
          await cook(harness, instruction("none", venue.name, list.length), at, vector.program),
        );
        const baked = bakedFor(venue.name, trade, vector);
        const forms: [string, Compiled][] = [
          [`${venue.name}Cpi`, instruction("Cpi", venue.name, list.length, baked)],
          [`${venue.name}Data`, instruction("Data", venue.name, list.length, baked)],
          [
            HAND,
            instruction("hand", venue.name, list.length, {
              prefix: vector.prefix,
              suffix: vector.suffix,
              ...(vector.amountPatch?.patchDivisorIn === undefined
                ? {}
                : { divisor: vector.amountPatch.patchDivisorIn }),
            }),
          ],
        ];
        for (const [form, program] of forms) {
          const outcome = succeeded(await cook(harness, program, at, vector.program));
          expect({ trade: trade.vector, form, ...named(outcome) }).toEqual({
            trade: trade.vector,
            form,
            received: String(trade.received ?? outcome.received),
            paid: String(trade.paid ?? trade.amountIn),
            returned: String(trade.paid ?? trade.amountIn),
          });
          expect(outcome.received > 0n).toBe(true);
          expect(outcome.call).toEqual({
            program: vector.program,
            ...expectedCall(
              vector,
              trade.amountIn,
              { owner: harness.pot, in: outcome.source, out: outcome.recipient },
              refs,
            ),
          });
          cuRows.push({
            venue: venue.name,
            form,
            pay: trade.pay,
            library: outcome.engineCu - outcome.venueCu - none.engineCu,
            venueCu: outcome.venueCu,
          });
        }
      }
    }, 300_000);

    it("refuses a list naming another program, before the authority signs into it", async () => {
      const other = "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ" as Address;
      const list = [{ address: "source" as const, writable: true }];
      const first = venue.cases[0]!;
      const trade = { ...first, minOut: 1n, slot: [], cpi: { program: other, accounts: list } };
      const program = instruction(
        "Cpi",
        venue.name,
        1,
        bakedFor(venue.name, first, VECTORS[first.vector]),
      );
      expect(refused(await cook(harness, program, trade, other))).toMatch(/^not an? /);
      // A field past its slot, which cut to it would name another token: refused before the call.
      if (svmExactInArguments(`${venue.name}Cpi`)!.includes("inCalcAccounts")) {
        const baked = bakedFor(venue.name, first, VECTORS[first.vector]);
        const own = VECTORS[first.vector]!.program;
        for (const form of ["Cpi", "Data"] as const)
          for (const wide of [{ inIndex: String(1n << 32n) }, { outCalcAccounts: "256" }] as Record<
            string,
            string
          >[])
            expect(
              refused(
                await cook(
                  harness,
                  instruction(form, venue.name, 1, { ...baked, ...wide }),
                  { ...trade, cpi: { program: own, accounts: list } },
                  own,
                ),
              ),
            ).toBe("index past its field");
      }
    }, 300_000);
  });
  // The venues a Pot cannot swap at, which `@sauce/router` has no function for: One Intro requires its
  // signer owned by the System program (a Pot's owner is the Kitchen), and a Sanctum stake pool's
  // deposit takes native SOL from its signer. Their instruction, built from the SDK's account order
  // and data template alone, lands on the venue's own program when a wallet sends it, and delivers
  // the recipes' pin.
  interface WalletCase {
    venue: RouterSvmVenue;
    program: string;
    vector: string;
    clock: bigint;
    atSlot?: bigint;
    atEpoch?: { epoch: bigint; start: bigint };
    aToB: boolean;
    /** The token paid, or none for native SOL from the wallet. */
    pay?: Address;
    buy: Address;
    amountIn: bigint;
    received: bigint;
    minOut?: bigint;
    /** The receiving account is the wallet's associated token account, as the venue requires. */
    ata?: boolean;
    /** Accounts placed before the swap. */
    fabricate?: (harness: EngineHarness, c: Record<string, string>) => void;
    refs: (c: Record<string, string>) => Record<string, Address>;
  }
  const stakePool = (
    venue: RouterSvmVenue,
    program: string,
    vector: string,
    received: bigint,
  ): WalletCase => ({
    venue,
    program,
    vector,
    // The pools' capture is at slot 436,445,025 in epoch 1010, which a deposit checks.
    clock: 1_785_538_204n,
    atSlot: 436_445_025n,
    atEpoch: { epoch: 1010n, start: 1_785_485_417n },
    aToB: true,
    buy: cfg(vector).poolMint as Address,
    amountIn: 3_000_000_000n,
    received,
    refs: (c) => ({
      pool: c.pool as Address,
      withdrawAuthority: c.withdrawAuthority as Address,
      reserveStake: c.reserveStake as Address,
      managerFeeAccount: c.managerFeeAccount as Address,
      referrerFeeAccount: c.managerFeeAccount as Address,
      poolMint: c.poolMint as Address,
      systemProgram: SYSTEM,
      tokenProgram: TOKEN,
    }),
  });
  const oneIntro = (vector: string, aToB: boolean, received: bigint): WalletCase => ({
    venue: "one-intro-swap",
    program: "one-intro-swap",
    vector,
    clock: 1_783_123_200n,
    aToB,
    pay: aToB ? USDC : WSOL,
    buy: aToB ? WSOL : USDC,
    amountIn: 1_000_000n,
    received,
    minOut: 1n,
    refs: (c) => ({
      metadata: VECTORS[vector]!.accounts[0]!.address!,
      pool: c.pool as Address,
      poolAuthority: c.authority as Address,
      vaultA: c.vault0 as Address,
      vaultB: c.vault1 as Address,
      feeA0: c.feeA0 as Address,
      feeB0: c.feeB0 as Address,
      feeA1: c.feeA1 as Address,
      feeB1: c.feeB1 as Address,
      tokenProgram: TOKEN,
    }),
  });
  const LAUNCH_SYSTEM = SYSTEM;
  /** The SDK's name for each of a launchpad's recipes roles, where they differ. */
  const ROLE_NAMES: Record<string, Record<string, string>> = {
    "boop-fun": {
      mint: "mintA",
      bondingCurve: "pool",
      bondingCurveVault: "vaultA",
      bondingCurveSolVault: "vaultB",
      wsol: "mintB",
    },
    moonit: {
      curveAccount: "pool",
      curveTokenAccount: "vaultA",
      mint: "mintA",
      configAccount: "config",
    },
  };
  const launch = (
    venue: RouterSvmVenue,
    vector: string,
    clock: bigint,
    amountIn: bigint,
    received: bigint,
    extra: Partial<WalletCase>,
  ): WalletCase => ({
    venue,
    program: venue,
    vector,
    clock,
    aToB: false,
    buy: VECTORS[vector]!.buy,
    amountIn,
    received,
    minOut: 1n,
    refs: () =>
      Object.fromEntries(
        VECTORS[vector]!.accounts.flatMap((a) => {
          if (a.address === undefined || a.role === undefined) return [];
          const role = a.role.split(":").pop()!;
          return [[ROLE_NAMES[venue]?.[role] ?? role, a.address]];
        }),
      ) as Record<string, Address>,
    ...extra,
  });
  const WALLET_ONLY: WalletCase[] = [
    oneIntro("one-intro-swap:Dbuv:0to1", true, 13_699_964n),
    oneIntro("one-intro-swap:Dbuv:1to0", false, 72_975n),
    stakePool(
      "sanctum-stake-pool",
      "infinity-spl-pool",
      "sanctum-stake-pool:Jito:deposit",
      2_319_261_901n,
    ),
    stakePool(
      "sanctum-stake-pool-2",
      "infinity-sanctum-pool",
      "sanctum-stake-pool-2:9mhG:deposit",
      2_484_505_865n,
    ),
    stakePool(
      "sanctum-stake-pool-3",
      "infinity-multi-pool",
      "sanctum-stake-pool-3:8VpR:deposit",
      2_497_391_149n,
    ),
    // Buying with native SOL from the wallet, as the recipes' bridge pays it.
    launch(
      "boop-fun",
      "boop-fun:8uwi:quoteToBase",
      1_783_175_236n,
      10_000_000n,
      332_824_959_629_194n,
      {},
    ),
    launch("moonit", "moonit:GnM6:quoteToBase", 1_783_123_200n, 300_000n, 19_719_929_410_422n, {
      ata: true,
      // The fee collectors are plain wallets, absent from the capture: credited a fee below rent, a
      // fresh one would fail the transaction's rent check, so each holds the rent-exempt floor.
      fabricate: (harness, c) => {
        for (const fee of [c.dexFee!, c.helioFee!])
          harness.svm.setAccount({
            address: fee as Address,
            data: new Uint8Array(0),
            executable: false,
            lamports: lamports(harness.svm.minimumBalanceForRentExemption(0n)),
            programAddress: LAUNCH_SYSTEM,
            space: 0n,
          });
      },
    }),
  ];

  describe.each(WALLET_ONLY)("$vector, sent by a wallet", (trade) => {
    it("lands on the SDK's account order and data template: the recipes' instruction and pin", async () => {
      const harness = await boot(
        trade.clock,
        [trade.venue],
        [[venueProgramId(trade.program), `${trade.program}.so.gz`]],
        trade.atSlot,
        trade.atEpoch,
      );
      const wallet = harness.payer.address;
      const source =
        trade.pay === undefined
          ? undefined
          : setTokenAccount(harness, randomAddress(), trade.pay, wallet, trade.amountIn + 7n);
      trade.fabricate?.(harness, cfg(trade.vector));
      const recipient = setTokenAccount(
        harness,
        trade.ata === true
          ? (
              await findAssociatedTokenPda({ owner: wallet, mint: trade.buy, tokenProgram: TOKEN })
            )[0]
          : randomAddress(),
        trade.buy,
        wallet,
        0n,
      );
      const refs = {
        ...trade.refs(cfg(trade.vector)),
        authority: wallet,
        recipient,
        ...(source === undefined ? {} : { source }),
      };
      const accounts = routerSvmAccounts(trade.venue, { aToB: trade.aToB }, refs);
      const { prefix, suffix, divisor } = routerSvmDataTemplate(trade.venue, {
        aToB: trade.aToB,
        ...(trade.minOut === undefined ? {} : { minOut: trade.minOut }),
      });
      const amount = new Uint8Array(8);
      new DataView(amount.buffer).setBigUint64(0, trade.amountIn / divisor, true);
      const data = new Uint8Array([...prefix, ...amount, ...suffix]);
      const vector = VECTORS[trade.vector]!;
      expect(Buffer.from(data).toString("hex")).toBe(
        `${vector.prefix}${Buffer.from(amount).toString("hex")}${vector.suffix}`,
      );
      const lamportsBefore = harness.svm.getBalance(wallet)!;
      const result = await sendInstructions(harness, [
        {
          programAddress: ROUTER_SVM_VENUES[trade.venue].program as Address,
          accounts: accounts.map((account) => ({
            address: account.ref,
            role: account.signer
              ? account.writable
                ? AccountRole.WRITABLE_SIGNER
                : AccountRole.READONLY_SIGNER
              : account.writable
                ? AccountRole.WRITABLE
                : AccountRole.READONLY,
          })),
          data,
        },
      ]);
      if (!result.ok) throw new Error(`${result.err}\n${result.logs.join("\n")}`);
      expect({
        received: String(tokenAmount(harness, recipient)),
        paid: String(
          source === undefined
            ? lamportsBefore - harness.svm.getBalance(wallet)! - 5_000n
            : trade.amountIn + 7n - tokenAmount(harness, source),
        ),
      }).toEqual({ received: String(trade.received), paid: String(trade.amountIn) });
    }, 300_000);
  });
});
