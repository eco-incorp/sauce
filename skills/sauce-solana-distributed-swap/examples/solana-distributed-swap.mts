// Compiles solana-distributed-swap.sauce.ts for Solana the way `sauce compile` does, and checks
// that the SKILL.md shows the program's own code; that each venue `@sauce/router` swaps at is the
// program id the SDK records for it, and listed in the skill's table with the name a program calls
// it by, the key it finds a pool by, which the SDK gives that program, and its function, which
// takes the arguments the skill gives; that the pool offsets the library reads are the SDK's own
// for each venue; that the program finds a pool for each key it lists and every account it names is
// derived, the ones the skill counts; and that `priceLimit`, `minTokens`, `maxAvgPrice` and the
// simulation's average the skill and the header give are what the arithmetic gives. Asserts what
// can be checked offline; sends nothing.
//
//   node solana-distributed-swap.mts
import { readFileSync } from "node:fs";

import { routes } from "@eco-incorp/sauce";
import { resolveSdkModule, resolveSdkPackage } from "@eco-incorp/sauce/compiler";
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

// The SKILL.md shows the program's code exactly: the file from its first code comment on, past the
// header and the blank line after it.
const header = source.slice(0, source.indexOf("\n\n") + 1);
const code = source.slice(header.length + 1);
check(code.startsWith("// "), "the program's code opens with a comment");
const shown = /```sauce chain=solana\n([\s\S]*?)```/.exec(skill);
check(shown !== null && shown[1] === code, "the SKILL.md's program is the example file's code");

// The program imports nothing and writes no address: each venue is one loop over the keys it finds
// pools by, each swap at the pool its key finds, paying USDC for WSOL, which compiles to that
// venue's `@sauce/router` function.
check(!/^import /m.test(code), "the program imports nothing");
check(!/0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,44}/.test(code), "the program writes no address");
const LOOPS = [
  ...code.matchAll(
    /for \(const (\w+) of \[([\d, ]+)\]\) \{\n {4}bought \+= (\w+\.\w+)\.swap\(\n {6}\3\.pool\(USDC, WSOL, \1\),\n {6}USDC,\n {6}WSOL,\n {6}self\.USDC - kept,\n {6}priceLimit,\n {6}0,\n {4}\);\n {2}\}/g,
  ),
].map((m) => ({ key: m[1]!, keys: m[2]!.split(", ").map(Number), venue: m[3]! }));
check(
  LOOPS.map((loop) => `${loop.venue} by ${loop.key}`).join() ===
    "Orca.Whirlpool by spacing,Raydium.CLMM by fee",
  "the program loops over Orca's tick spacings, then Raydium's fees",
);
const program = routes.compileSauceProgram("solana", source);
check(
  /^import \{ orcaWhirlpool as __sauce_orcaWhirlpool, raydiumClmm as __sauce_raydiumClmm \} from "@sauce\/router";$/m.test(
    program.source,
  ),
  "each venue's swap is its @sauce/router function",
);
const entry = resolveSdkPackage("@sauce/router");
if (entry === undefined) throw new Error("the SDK serves @sauce/router");
const served = resolveSdkModule(entry.replace(/\.js$/, ".svm.js"));
if (served === undefined) throw new Error("@sauce/router has an SVM arm");
const library = new TextDecoder().decode(served);
const body = (name: string): string => {
  const at = library.indexOf(`export function ${name}(`);
  check(at >= 0, `@sauce/router exports ${name}`);
  return library.slice(at, library.indexOf("\n}\n", at));
};
const params = (name: string) =>
  /\(([^)]*)\)/
    .exec(body(name))![1]!
    .split(",")
    .map((p) => p.trim().split(":")[0]!.trim())
    .filter(Boolean)
    .join(", ");

// Each venue the library swaps at is the SDK's program id: its 32-byte key, the base58 id written
// above its own function, and a row of the skill's table naming the venue's name in a program (the
// SDK's, for that program), the key it finds a pool by (the SDK's `pool` method) and that function,
// which takes the arguments the skill gives.
const key = (id: string) =>
  `0x${Buffer.from(getAddressEncoder().encode(id as never)).toString("hex")}`;
const VENUES: [string, string, string, string][] = [
  ["Raydium.CLMM", "raydiumClmm", RAYDIUM_CLMM_PROGRAM_ID, "Raydium CLMM"],
  ["Pancakeswap.CLMM", "pancakeswapClmm", PANCAKESWAP_CLMM_PROGRAM_ID, "PancakeSwap CLMM"],
  ["Byreal.CLMM", "byreal", BYREAL_PROGRAM_ID, "Byreal"],
  ["Stabble.CLMM", "stabbleClmm", STABBLE_CLMM_PROGRAM_ID, "Stabble CLMM"],
  ["Orca.Whirlpool", "orcaWhirlpool", ORCA_WHIRLPOOL_PROGRAM_ID, "Orca Whirlpools"],
  ["Cropper.Whirlpool", "cropper", CROPPER_PROGRAM_ID, "Cropper"],
  ["Defituna.Fusion", "defituna", DEFITUNA_PROGRAM_ID, "DefiTuna"],
  ["Crema.CLMM", "crema", CREMA_PROGRAM_ID, "Crema"],
  ["Phoenix.Market", "phoenix", PHOENIX_PROGRAM_ID, "Phoenix"],
];
const ARGS = "slot, trader, amountIn, priceLimit, minOut, recipient";
// The venues swapping at a price: Meteora DLMM's namespace is an exact input, which this program
// cannot stop at a price.
const named = routes
  .sourceGlobals("solana")
  .venues.filter((one) => one.methods.some((method) => method.includes("priceLimit")));
check(
  named.map((one) => `${one.namespace} ${one.program}`).join() ===
    VENUES.map(([namespace, , id]) => `${namespace} ${id}`).join(),
  "the SDK names the nine venues as the skill does, each for its program",
);
for (const [namespace, fn, id, venue] of VENUES) {
  check(
    new RegExp(`// ${venue}, ${id}[^\\n]*\\n(?://[^\\n]*\\n)*export function ${fn}\\(`).test(
      library,
    ) && body(fn).includes(key(id)),
    `${fn} takes ${venue}'s pools, ${id}`,
  );
  check(params(fn) === ARGS, `${fn} takes (${ARGS})`);
  check(
    !library.includes(`export function try${fn.charAt(0).toUpperCase()}${fn.slice(1)}(`),
    `${fn} is the one swap at ${venue}`,
  );
  const pool = named
    .find((one) => one.namespace === namespace)!
    .methods.find((method) => method.startsWith("pool("));
  const by =
    pool === undefined
      ? "by its address"
      : /, fee: Uint256, tickSpacing\?: Uint256\)/.test(pool)
        ? "fee"
        : /, tickSpacing: Uint256\)/.test(pool)
          ? "tick spacing"
          : "?";
  check(
    new RegExp(
      `\\| ${venue} +\\| \`${id}\` +\\|[^\\n]*\\| \`${namespace.replace(".", "\\.")}\\.swap\` +\\| ${by} +\\| \`${fn}\` +\\|`,
    ).test(skill),
    `the skill's table lists ${venue}, ${id}, ${namespace}.swap, ${by}, ${fn}`,
  );
}
check(!library.includes("export function swap("), "no swap takes a pool of any venue");
for (const left of ["Invariant", "Meteora DLMM", "Bonkswap", "Saros DLMM", "Manifest"])
  check(
    prose.includes(`**${left}**`) || prose.includes(left),
    `the skill says why ${left} is left out`,
  );
for (const error of ["PriceLimitReached", "ExceededAmountSlippageTolerance", "PriceLimitExceeded"])
  check(prose.includes(`\`${error}\``), `the skill quotes ${error}`);

// The offsets the library reads are the SDK's own, for the venues whose decoders export them; the
// references give the same.
for (const [offset, what] of [
  [OFF_TICK_SPACING, "a whirlpool's tick spacing"],
  [OFF_FEE_TIER_INDEX, "its fee tier"],
  [OFF_FEE_RATE, "its fee rate"],
  [OFF_LIQUIDITY, "its liquidity"],
  [OFF_SQRT_PRICE, "its sqrt price"],
] as const)
  check(library.includes(`svm.sload(pool, ${offset}, `), `the library reads ${what} at ${offset}`);
for (const [offset, what] of [
  [CREMA_OFF_FEE_RATE, "Crema's fee rate"],
  [CREMA_OFF_LIQUIDITY, "its liquidity"],
  [CREMA_OFF_SQRT_PRICE, "its sqrt price"],
  [OFF_TAKER_FEE_BPS, "Phoenix's taker fee"],
] as const)
  check(library.includes(`svm.sload(pool, ${offset}, `), `the library reads ${what} at ${offset}`);
for (const row of [
  "| fee rate, in millionths | 45 (u16) |",
  "| liquidity, sqrt price (Q64.64), tick | 237 (u128), 253 (u128), 269 (i32) |",
  "| taker fee, in basis points | 856 (u64) |",
])
  check(venues.replace(/ +/g, " ").includes(row), `the venues reference has ${row}`);

// The inputs: main's arguments, the ones the header and the skill name, in order; and the accounts,
// every one derived, none left to give: each key's nine read from the pool it finds for the token
// paid, the Pot's, the mints', the programs' and the recipient's.
const ARGUMENTS = ["budget", "priceLimit", "minTokens", "maxAvgPrice", "recipient"];
check(
  program.entryParams.map((param) => `${param.name}: ${param.type}`).join() ===
    ARGUMENTS.map((name) => `${name}: ${name === "recipient" ? "Address" : "Uint256"}`).join(),
  `main's arguments are ${ARGUMENTS.join(", ")}`,
);
for (const name of ARGUMENTS)
  check(new RegExp(`\\b${name}\\b`).test(header), `the header names the argument ${name}`);
check(
  prose.includes(
    "`main`'s arguments, in order: `budget`, `priceLimit`, `minTokens`, `maxAvgPrice` and `recipient`",
  ),
  "the skill gives them in order",
);
const SLOT = [
  "program",
  "pool",
  "config",
  "vaultA",
  "vaultB",
  "extra",
  "ticks0",
  "ticks1",
  "ticks2",
];
const derived = Object.values(program.derivedAccounts ?? {});
check(
  (program.manifest?.accounts ?? []).every(
    (slot) => slot.kind === "slot" && Object.hasOwn(program.derivedAccounts ?? {}, slot.name),
  ),
  "every account the program names is derived",
);
const keyed = LOOPS.flatMap((loop) =>
  loop.keys.flatMap((k) => SLOT.map((part) => `slot:${loop.venue}(USDC,WSOL,${k}):USDC.${part}`)),
);
check(
  keyed.every((one) => derived.includes(one)),
  "the program finds one pool for each key it lists, its nine accounts derived from the pool",
);
check(
  [...new Set(derived.filter((one) => !one.startsWith("slot:")))].sort().join() ===
    [
      "self",
      "self:USDC",
      "self:WSOL",
      "mint:USDC",
      "mint:WSOL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      "@recipient:WSOL",
    ]
      .sort()
      .join(),
  "and the Pot's, the mints', the programs' and the recipient's",
);
const accounts = program.manifest!.accounts.length;
check(
  prose.includes(`The program names ${accounts} accounts, every one derived`),
  `the skill counts them, ${accounts}`,
);
console.log(
  `solana: ${program.bytecode.length}-byte program, ${accounts} accounts, ${program.entryParams.length} arguments`,
);
check(
  prose.includes(`It is about ${(program.bytecode.length / 1000).toFixed(1)} KB`),
  "the skill gives the program's size",
);
// The simulation the skill reads stages the program with its arguments, each one 32-byte word.
check(
  skill.includes(
    `the ${program.bytecode.length + 32 * program.entryParams.length}-byte program staged`,
  ),
  "the skill's simulation stages the program and its arguments",
);

// priceLimit: the price in whole tokens times 10^(18 + payDecimals − buyDecimals). USDC has 6
// decimals on Solana and SOL 9.
const decimalsOf = (symbol: string) =>
  routes.SVM_TOKEN_REGISTRY["mainnet-beta"]!.find((row) => row.symbol === symbol)!.decimals;
const usdc = decimalsOf("USDC");
const sol = decimalsOf("WSOL");
check(usdc === 6 && sol === 9, "USDC has 6 decimals on Solana, and SOL 9");
const E18 = 10n ** 18n;
const buySol = 120n * 10n ** BigInt(18 + usdc - sol); // at most 120 USDC a SOL
const sellSol = (10n ** BigInt(sol) * E18) / (118n * 10n ** BigInt(usdc)); // at least 118 USDC a SOL
const budget = 1000n * 10n ** BigInt(usdc);
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
const minTokens = ceil(budget * E18, buySol);
const maxAvg = ceil((1195n * 10n ** BigInt(18 + usdc - sol)) / 10n + buySol, 2n); // halfway, 119.5 to 120
// A floor in SOL per USDC turned over, rounded down: 10^15 ÷ 0.0084.
const floorSol = (10n ** BigInt(18 + usdc - sol) * 10_000n) / 84n;
check(
  floorSol === 119_047_619_047_619_047n,
  "priceLimit buying SOL at a floor of 0.0084 SOL per USDC",
);
check(buySol === 120_000_000_000_000_000n, "priceLimit buying SOL at most 120 USDC");
check(sellSol === 8_474_576_271_186_440_677n, "priceLimit selling SOL at least 118 USDC");
check(minTokens === 8_333_333_334n, "minTokens for all of 1,000 USDC at 120");
check(maxAvg === 119_750_000_000_000_000n, "maxAvgPrice halfway between 119.5 and 120");
for (const value of [buySol, floorSol, sellSol, maxAvg])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);
check(skill.includes(`\`${minTokens}\``), `the skill quotes minTokens ${minTokens}`);
// The commands pass them: the simulation, the run with its checks set, and the header's example.
check(
  prose.includes(`--args ${budget} ${buySol} 0 0 <recipient>`) &&
    prose.includes(`--args ${budget} ${buySol} ${minTokens} 0 <recipient> \\ --expect-revert`) &&
    prose.includes(`--args ${budget} ${buySol} ${minTokens} ${maxAvg} <recipient>`),
  "the skill's commands pass those values",
);
check(
  header.replace(/\s+/g, " ").includes(`--args ${budget} ${buySol} ${minTokens} 0 <recipient>`),
  "and the header's example line",
);

// The simulation the skill reads: 2,000 USDC for 16.983900131 SOL, and its average.
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
  library.includes(
    "const own = paysA ? Math.mulDiv(limit, 10 ** 18, root) : Math.mulDiv(limit, root, 10 ** 18);",
  ),
  "the library applies it",
);
