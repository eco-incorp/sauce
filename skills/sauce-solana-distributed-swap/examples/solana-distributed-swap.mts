// Compiles solana-distributed-swap.sauce.ts for Solana the way `sauce compile` does, and checks
// that the SKILL.md shows the program's own code; that each venue `@sauce/router` swaps at is the
// program id the SDK records for it, written beside its key, and listed in the skill's table with
// the name a program calls it by, which the SDK gives that program, and its function, which takes
// the arguments `swap` does; that the pool offsets the library reads are the SDK's own for each
// venue; that the program takes its pools as `Address` arguments and every account it names is
// derived, the ones the skill counts; and that `maxPrice`, `minTokens`, `maxAvgPrice` and the
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

// The program imports nothing: each slot is one `Solana.swap` at the pool `main` is given, in
// order, paying `pay` for `buy`, which compiles to `@sauce/router`'s `swap`, the library the
// package serves for it on Solana being its SVM arm.
check(!/^import /m.test(code), "the program imports nothing");
const SLOTS = [0, 1, 2, 3];
check(
  [...code.matchAll(/^ {2}Solana\.swap\(pool(\d), pay, buy, /gm)]
    .map((m) => Number(m[1]))
    .join() === SLOTS.join(),
  "the program swaps at pool0 to pool3 in turn, one Solana.swap each",
);
const program = routes.compileSauceProgram("solana", source);
check(
  /^import \{ swap as __sauce_swap \} from "@sauce\/router";$/m.test(program.source) &&
    (program.source.match(/__sauce_swap\(/g) ?? []).length === SLOTS.length,
  "each Solana.swap is @sauce/router's swap",
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
// beside it in `swap` and above its own function, and a row of the skill's table naming the venue's
// name in a program (the SDK's, for that program) and that function, which takes `swap`'s
// arguments, as the skill says.
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
const ARGS = "slot, trader, amountIn, maxPrice, minOut, recipient";
check(params("swap") === ARGS, `swap takes (${ARGS})`);
// The venues swapping at a price: Meteora DLMM's namespace is an exact input, which this program
// cannot stop at a price.
const named = routes
  .sourceGlobals("solana")
  .venues.filter((one) => one.methods.some((method) => method.includes("maxPrice")));
check(
  named.map((one) => `${one.namespace} ${one.program}`).join() ===
    VENUES.map(([namespace, , id]) => `${namespace} ${id}`).join(),
  "the SDK names the nine venues as the skill does, each for its program",
);
const dispatch = body("swap");
for (const [namespace, fn, id, venue] of VENUES) {
  check(
    dispatch.includes(`${key(id)}`) && dispatch.includes(`// ${venue}, ${id}`),
    `swap takes ${venue}'s pools, ${id}`,
  );
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
  check(
    new RegExp(
      `\\| ${venue} +\\| \`${id}\` +\\|[^\\n]*\\| \`${namespace.replace(".", "\\.")}\\.swap\` +\\| \`${fn}\` +\\|`,
    ).test(skill),
    `the skill's table lists ${venue}, ${id}, ${namespace}.swap, ${fn}`,
  );
}
check(
  (dispatch.match(/0x[0-9a-f]{64}/g) ?? []).length === VENUES.length,
  "swap takes those venues and no other",
);
check(!library.includes("export function trySwap("), "swap is the one swap at any venue");
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
// every one derived, none left to give: each pool's nine read from it for the token paid, the
// Pot's, the mints', the programs' and the settle's.
const ARGUMENTS = (pools: number) => [
  "pay",
  "buy",
  ...Array.from({ length: pools }, (_, k) => `pool${k}`),
  ...["budget", "maxPrice", "minTokens", "maxAvgPrice", "recipient", "refund"],
];
check(
  program.entryParams.map((param) => `${param.name}: ${param.type}`).join() ===
    ARGUMENTS(4)
      .map(
        (name) =>
          `${name}: ${/^(pay|buy|pool\d|recipient|refund)$/.test(name) ? "Address" : "Uint256"}`,
      )
      .join(),
  `main's arguments are ${ARGUMENTS(4).join(", ")}`,
);
for (const name of ARGUMENTS(4))
  check(new RegExp(`\\b${name}\\b`).test(header), `the header names the argument ${name}`);
check(
  prose.includes(
    "`main`'s arguments, in order: `pay`, `buy`, `pool0` to `pool3`, `budget`, `maxPrice`, " +
      "`minTokens`, `maxAvgPrice`, `recipient` and `refund`",
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
const derivations = (pools: number) => [
  "self:@pay",
  "self",
  "self:@buy",
  ...SLOT.map((part) => `slot:@pool0:@pay.${part}`),
  "mint:@pay",
  "mint:@buy",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  ...Array.from({ length: pools - 1 }, (_, k) =>
    SLOT.map((part) => `slot:@pool${k + 1}:@pay.${part}`),
  ).flat(),
  "program:@buy",
  "@recipient:@buy",
  "program:@pay",
  "@refund:@pay",
];
const derivedOf = (compiled: typeof program): string[] =>
  (compiled.manifest?.accounts ?? []).map((slot) =>
    slot.kind === "slot"
      ? ((compiled.derivedAccounts as Record<string, string> | undefined)?.[slot.name] ??
        `${slot.name}, not derived`)
      : "…",
  );
const expected = derivations(4);
check(
  derivedOf(program).join() === expected.join(),
  `the program names ${expected.length} accounts, every one derived`,
);
check(
  prose.includes(`The program names ${expected.length} accounts, every one derived`),
  "the skill counts them",
);
console.log(
  `solana: ${program.bytecode.length}-byte program, ${expected.length} accounts, ${program.entryParams.length} arguments`,
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

// The five-slot program is this one with a fifth slot: main the same but for one more pool
// argument and one more swap.
const five = readFileSync(new URL("./solana-distributed-swap-5.sauce.ts", import.meta.url), "utf8");
const fiveCode = five.slice(five.indexOf("\n\n") + 2);
const call4 =
  "\n  Solana.swap(pool4, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);";
check(
  fiveCode.includes("\n  pool4: Address,") &&
    fiveCode.includes(call4) &&
    fiveCode.replace("\n  pool4: Address,", "").replace(call4, "") === code,
  "the five-slot program is this one with pool4's argument and swap",
);
check(
  prose.includes(`declare \`pool4: Address\` after \`pool3\``) &&
    prose.includes(call4.trim().replace(/;$/, "")),
  "the skill adds the fifth slot the same way",
);
const program5 = routes.compileSauceProgram("solana", five);
check(
  program5.entryParams.map((param) => param.name).join() === ARGUMENTS(5).join(),
  "the five-slot program takes the fifth pool after the fourth",
);
check(
  derivedOf(program5).join() === derivations(5).join(),
  `the five-slot program names ${derivations(5).length} accounts, every one derived`,
);
console.log(
  `solana, five slots: ${program5.bytecode.length}-byte program, ${derivations(5).length} accounts`,
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
// A floor in SOL per USDC turned over, rounded down: 10^15 ÷ 0.0084.
const floorSol = (10n ** BigInt(18 + usdc - sol) * 10_000n) / 84n;
check(
  floorSol === 119_047_619_047_619_047n,
  "maxPrice buying SOL at a floor of 0.0084 SOL per USDC",
);
check(buySol === 120_000_000_000_000_000n, "maxPrice buying SOL at most 120 USDC");
check(sellSol === 8_474_576_271_186_440_677n, "maxPrice selling SOL at least 118 USDC");
check(minTokens === 8_333_333_334n, "minTokens for all of 1,000 USDC at 120");
check(maxAvg === 119_750_000_000_000_000n, "maxAvgPrice halfway between 119.5 and 120");
for (const value of [buySol, floorSol, sellSol, maxAvg])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);
check(skill.includes(`\`${minTokens}\``), `the skill quotes minTokens ${minTokens}`);
// The commands pass them, after the tokens and the pools: the simulation, the run with its checks
// set, and the header's example line.
const pools = "--args USDC WSOL <pool0> <pool1> <pool2> <pool3> \\ ";
check(
  prose.includes(`${pools}${budget} ${buySol} 0 0 <recipient> <refund>`) &&
    prose.includes(`${pools}${budget} ${buySol} ${minTokens} ${maxAvg} <recipient> <refund>`),
  "the skill's commands pass those values",
);
check(
  header
    .replace(/\s+/g, " ")
    .includes(`${pools}// ${budget} ${buySol} ${minTokens} 0 <recipient> <refund>`),
  "and the header's example line",
);

check(prose.includes(`--max-price ${floorSol}`), "the skill chooses pools within that floor");

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
