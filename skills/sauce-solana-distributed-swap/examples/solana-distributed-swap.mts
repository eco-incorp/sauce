// Compiles solana-distributed-swap.sauce.ts for Solana the way `sauce compile` does, and checks
// that the SKILL.md shows the program's own code; that each venue the program names is the program
// id the SDK records for it, written beside its key, and listed in the skill's table; that the
// pool offsets it reads are the SDK's own for each venue; that its accounts are the ones its header
// and the skill name, in order; and that `maxPrice`, `minTokens`, `maxAvgPrice` and the rehearsal's
// average the skill and the header give are what the arithmetic gives. Asserts what can be checked
// offline; sends nothing.
//
//   node solana-distributed-swap.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";
import {
  BYREAL_PROGRAM_ID,
  CREMA_OFF_FEE_RATE,
  CREMA_OFF_LIQUIDITY,
  CREMA_OFF_SQRT_PRICE,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  getAddressEncoder,
  OFF_FEE_RATE,
  OFF_FEE_TIER_INDEX,
  OFF_LIQUIDITY,
  OFF_SQRT_PRICE,
  OFF_TAKER_FEE_BPS,
  OFF_TICK_SPACING,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  PHOENIX_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "@eco-incorp/sauce/svm";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const source = readFileSync(new URL("./solana-distributed-swap.sauce.ts", import.meta.url), "utf8");
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const venues = readFileSync(new URL("../references/venues.md", import.meta.url), "utf8");
const prose = skill.replace(/\s+/g, " ");

// The SKILL.md shows the program's code exactly: the file less its header comment.
const code = source.slice(source.indexOf("// The venues."));
const shown = /```sauce chain=solana\n([\s\S]*?)```/.exec(skill);
check(shown !== null && shown[1] === code, "the SKILL.md's program is the example file's code");

// Each venue the program names is the SDK's program id: its 32-byte key, the base58 id written
// beside it, and a row of the skill's table.
const key = (id: string) =>
  `0x${Buffer.from(getAddressEncoder().encode(id as never)).toString("hex")}`;
const VENUES: [string, string, string][] = [
  ["RAYDIUM_CLMM", RAYDIUM_CLMM_PROGRAM_ID, "Raydium CLMM"],
  ["PANCAKESWAP_CLMM", PANCAKESWAP_CLMM_PROGRAM_ID, "PancakeSwap CLMM"],
  ["BYREAL", BYREAL_PROGRAM_ID, "Byreal"],
  ["STABBLE_CLMM", STABBLE_CLMM_PROGRAM_ID, "Stabble CLMM"],
  ["ORCA_WHIRLPOOL", ORCA_WHIRLPOOL_PROGRAM_ID, "Orca Whirlpools"],
  ["CROPPER", CROPPER_PROGRAM_ID, "Cropper"],
  ["DEFITUNA", DEFITUNA_PROGRAM_ID, "DefiTuna"],
  ["CREMA", CREMA_PROGRAM_ID, "Crema"],
  ["PHOENIX", PHOENIX_PROGRAM_ID, "Phoenix"],
];
for (const [name, id, venue] of VENUES) {
  check(
    code.includes(`const ${name} = ${key(id)}; // ${id}`),
    `the program names ${venue} as ${id}`,
  );
  check(
    new RegExp(`\\| ${venue} +\\| \`${id}\``).test(skill),
    `the skill's table lists ${venue}, ${id}`,
  );
}
check(
  (code.match(/^const [A-Z_]+ = 0x[0-9a-f]{64};/gm) ?? []).length === VENUES.length,
  "the program names those venues and no other",
);
for (const left of ["Invariant", "Meteora DLMM", "Bonkswap", "Saros DLMM", "Manifest"])
  check(
    prose.includes(`**${left}**`) || prose.includes(left),
    `the skill says why ${left} is left out`,
  );
for (const error of ["PriceLimitReached", "ExceededAmountSlippageTolerance", "PriceLimitExceeded"])
  check(prose.includes(`\`${error}\``), `the skill quotes ${error}`);

// The offsets the program reads are the SDK's own, for the venues whose decoders export them; the
// references give the same.
for (const [offset, what] of [
  [OFF_TICK_SPACING, "a whirlpool's tick spacing"],
  [OFF_FEE_TIER_INDEX, "its fee tier"],
  [OFF_FEE_RATE, "its fee rate"],
  [OFF_LIQUIDITY, "its liquidity"],
  [OFF_SQRT_PRICE, "its sqrt price"],
] as const)
  check(code.includes(`svm.sload(pool, ${offset}, `), `the program reads ${what} at ${offset}`);
for (const [offset, what] of [
  [CREMA_OFF_FEE_RATE, "Crema's fee rate"],
  [CREMA_OFF_LIQUIDITY, "its liquidity"],
  [CREMA_OFF_SQRT_PRICE, "its sqrt price"],
  [OFF_TAKER_FEE_BPS, "Phoenix's taker fee"],
] as const)
  check(code.includes(`svm.sload(pool, ${offset}, `), `the program reads ${what} at ${offset}`);
for (const row of [
  "| fee rate, in millionths | 45 (u16) |",
  "| liquidity, sqrt price (Q64.64), tick | 237 (u128), 253 (u128), 269 (i32) |",
  "| taker fee, in basis points | 856 (u64) |",
])
  check(venues.replace(/ +/g, " ").includes(row), `the venues reference has ${row}`);

// The accounts: the header's and the skill's names, in the manifest's order, nine to a slot.
const program = routes.compileSauceProgram("solana", source);
const names = (program.manifest?.accounts ?? []).map((entry) =>
  entry.kind === "slot" ? entry.name : "…",
);
const shared = ["authority", "source", "output", "recipient", "refund", "payMint", "buyMint"];
const slot = (k: number) =>
  ["program", "pool", "config", "vaultA", "vaultB", "extra"]
    .map((name) => `${name}${k}`)
    .concat([0, 1, 2].map((i) => `ticks${k}${i}`));
const expected = [...shared, "tokenProgram", "token2022", "memo", ...[0, 1, 2, 3].flatMap(slot)];
check(names.join() === expected.join(), `the program takes ${expected.length} accounts in order`);
check(
  prose.includes(`slots and the shared accounts are ${expected.length} accounts`),
  "the skill counts them",
);
const header = source.slice(0, source.indexOf("// The venues."));
for (const name of [...shared, "tokenProgram", "token2022", "memo"])
  check(new RegExp(`\\b${name}\\b`).test(header), `the header names the account ${name}`);
check(
  program.entryParams.map((param) => param.name).join() === "budget,maxPrice,minTokens,maxAvgPrice",
  "main's arguments are budget, maxPrice, minTokens, maxAvgPrice",
);
console.log(
  `solana: ${program.bytecode.length}-byte program, ${expected.length} accounts, ${program.entryParams.length} arguments`,
);
check(
  prose.includes(`It is about ${(program.bytecode.length / 1000).toFixed(1)} KB`),
  "the skill gives the program's size",
);

// maxPrice: the price in whole tokens times 10^(18 + payDecimals − buyDecimals). USDC has 6
// decimals on Solana and SOL 9.
const solana = routes.chain("solana").chain;
const decimalsOf = (symbol: string) =>
  routes.SVM_TOKEN_REGISTRY["mainnet-beta"]!.find((row) => row.symbol === symbol)!.decimals;
const usdc = decimalsOf("USDC");
const sol = decimalsOf("WSOL");
check(usdc === 6 && sol === 9, "USDC has 6 decimals on Solana, and SOL 9");
void solana;
const E18 = 10n ** 18n;
const buySol = 120n * 10n ** BigInt(18 + usdc - sol); // at most 120 USDC a SOL
const sellSol = (10n ** BigInt(sol) * E18) / (118n * 10n ** BigInt(usdc)); // at least 118 USDC a SOL
const budget = 1000n * 10n ** BigInt(usdc);
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
const minTokens = ceil(budget * E18, buySol);
const maxAvg = ceil((1195n * 10n ** BigInt(18 + usdc - sol)) / 10n + buySol, 2n); // halfway, 119.5 to 120
check(buySol === 120_000_000_000_000_000n, "maxPrice buying SOL at most 120 USDC");
check(sellSol === 8_474_576_271_186_440_677n, "maxPrice selling SOL at least 118 USDC");
check(minTokens === 8_333_333_334n, "minTokens for all of 1,000 USDC at 120");
check(maxAvg === 119_750_000_000_000_000n, "maxAvgPrice halfway between 119.5 and 120");
for (const value of [buySol, sellSol, maxAvg])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);
check(skill.includes(`\`${minTokens}\``), `the skill quotes minTokens ${minTokens}`);
// The commands pass them: the rehearsal, and the run with its checks set.
check(
  prose.includes(`--args ${budget} ${buySol} 0 0`) &&
    prose.includes(`--args ${budget} ${buySol} ${minTokens} ${maxAvg}`),
  "the skill's commands pass those values",
);
check(
  source.includes(`--args ${budget} ${buySol} ${minTokens} 0`),
  "and the header's example line",
);

// The rehearsal the skill reads: 2,000 USDC for 16.983900131 SOL, and its average.
const spent = 2000n * 10n ** BigInt(usdc);
const bought = 16_983_900_131n;
check(
  skill.includes(`{ spent: ${spent}, bought: ${bought}, unspent: 0 }`),
  "the skill shows main's return",
);
const average = (spent * E18) / bought;
check(skill.includes(`**${average}**`), `the skill gives its average, ${average}`);

// Each pool's own limit is the caller's moved by √(1 − fee): paying the lower-key token (SOL, whose
// key is lower than USDC's) it is limit ÷ √(1 − fee), paying the other limit × √(1 − fee).
check(
  key("So11111111111111111111111111111111111111112") <
    key("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  "SOL's key is lower than USDC's",
);
check(
  prose.includes(
    "**`limit ÷ √(1 − fee)` paying the lower-key token, `limit × √(1 − fee)` paying the other**",
  ),
  "the skill gives the rule",
);
check(
  code.includes(
    "const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);",
  ),
  "the program applies it",
);
