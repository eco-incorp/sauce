// Compiles distributed-swap.sauce.ts for Base the way `sauce compile` does, and builds the cook
// `sauce tx` would print for buying SPCXc with USDC. Checks that the SKILL.md shows the program's own
// code, and that its venues and lookups, its typed reads, the Slipstream swap through uniswapV3, a
// V4 pool id held as a Uint256, the tokens it names, the `priceLimit` value, the limit the program
// derives from it, each pool's own limit, `minTokens`, `maxAvgPrice`, the simulation it reads, the
// chains it compiles on, and the arguments of its commands (and the program header's) are what the
// program and the arithmetic give. Asserts what can be checked offline; sends nothing.
//
//   node distributed-swap.mts --owner <Pot owner> --recipient <address>
import { readFileSync } from "node:fs";

import {
  priceFromSqrtPriceX96,
  routes,
  sqrtPriceX96FromPrice,
  v12PredictPot,
} from "@eco-incorp/sauce";
import { resolveSdkModule } from "@eco-incorp/sauce/compiler";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, getAddress } from "viem";

type Address = `0x${string}`;
function address(name: string): Address {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`pass --${name} <address>`);
  return getAddress(value);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

const owner = address("owner"); // who owns the Pot and sends the cook
const recipient = address("recipient");
const pot = v12PredictPot(owner); // the owner's Pot (`sauce pot --owner <owner>` prints the same)
const engine = getAddress(v12EngineAddress());
const source = readFileSync(new URL("./distributed-swap.sauce.ts", import.meta.url), "utf8");
const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const prose = skill.replace(/\s+/g, " ");

// The SKILL.md shows the program's code exactly: the file less its header comment.
const code = source.slice(source.indexOf("import "));
const shown = /```sauce chain=[\w,]+\n([\s\S]*?)```/.exec(skill);
check(shown !== null && shown[1] === code, "the SKILL.md's program is the example file's code");

// The Router takes a price limit on the flat V3 and V4 entries and services each pool's callback:
// Uniswap V3's and Slipstream's (the same one), and the V4 PoolManager's unlock.
interface AbiFunction {
  name: string;
  inputs: { name: string }[];
}
const served = resolveSdkModule("./artifacts/ISauceRouter.json");
if (served === undefined) throw new Error("the SDK serves ISauceRouter.json");
const parsed = JSON.parse(new TextDecoder().decode(served)) as
  AbiFunction[] | { abi: AbiFunction[] };
const router = Array.isArray(parsed) ? parsed : parsed.abi;
for (const entry of ["swapV3", "swapV4"])
  check(
    router.some((f) => f.name === entry && f.inputs.some((i) => i.name === "sqrtPriceLimitX96")),
    `${entry} takes sqrtPriceLimitX96`,
  );
for (const callback of ["uniswapV3SwapCallback", "unlockCallback"])
  check(
    router.some((f) => f.name === callback),
    `the Router implements ${callback}`,
  );

// Every pool read is a typed binding, never a selector: Uniswap V3's, Slipstream's own, and V4's
// StateView, with the fee read from the pool. One helper, `trade`, serves every pool, told its venue;
// the loops only find pools.
check(!/evm\.static|hex`/.test(code), "the program reads no pool by selector");
for (const venue of ["UniswapV3", "AerodromeSlipstream"])
  for (const read of ["liquidity()", "slot0().sqrtPriceX96", "fee()"])
    check(code.includes(`${venue}.Pool(pool).${read}`), `the program reads ${venue} ${read}`);
for (const read of ["getLiquidity(pool)", "getSlot0(pool)"])
  check(code.includes(`UniswapV4.StateView.${read}`), `the program reads V4's ${read}`);
check(code.match(/^function /gm)?.length === 2, "the program has trade and main, nothing else");
const venues = [...code.matchAll(/trade\((\d), /g)].map((m) => m[1]);
check(venues.join() === "1,0,2", "the loops hand trade Slipstream (1), Uniswap V3 (0), V4 (2)");
for (const [venue, name] of [
  ["0", "Uniswap V3"],
  ["1", "Slipstream"],
  ["2", "Uniswap V4"],
])
  check(code.includes(`${venue} ${name}`), `trade says venue ${venue} is ${name}`);
// Slipstream's swap is uniswapV3, and the program says so at the call.
const v3Call = code.indexOf("return uniswapV3(pool, ");
check(
  v3Call > 0 && /Slipstream[^\n]*uniswapV3 swaps both\.?\n\s*$/.test(code.slice(0, v3Call)),
  "the uniswapV3 call says it swaps Slipstream pools too",
);
check(prose.includes("so `uniswapV3` swaps both"), "and the skill says so");
check(code.includes("return uniswapV4(manager, "), "a V4 pool swaps through uniswapV4");

// The venues it walks: Slipstream's nine spacings, the seven tiers Base's Uniswap V3 factory
// enables, and Uniswap V4's four standard hookless keys: 20 lookups.
const TIERS = [100n, 200n, 300n, 400n, 500n, 3000n, 10000n];
const SPACINGS = [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n];
const V4_KEYS: [bigint, bigint][] = [
  [100n, 1n],
  [500n, 10n],
  [3000n, 60n],
  [10000n, 200n],
];
const list = (xs: bigint[]) => `[${xs.join(", ")}]`;
check(code.includes(`for (const spacing of ${list(SPACINGS)})`), "the program walks nine spacings");
check(code.includes(`for (const fee of ${list(TIERS)})`), "and Base's seven tiers");
const keys = [...code.matchAll(/\{ fee: (\d+), spacing: (\d+) \}/g)].map((m) => `${m[1]}:${m[2]}`);
check(
  keys.join() === V4_KEYS.map(([fee, spacing]) => `${fee}:${spacing}`).join(),
  "and V4's four standard keys",
);
check(
  code.indexOf("CLFactoryGaugesV3.getPool") < code.indexOf("UniswapV3.Factory.getPool"),
  "Slipstream, the SPCXc pair's deep venue, comes first",
);
const lookups = TIERS.length + SPACINGS.length + V4_KEYS.length;
check(
  prose.includes(`The program makes ${lookups}: nine spacings, seven tiers and four keys`),
  "the skill counts the lookups",
);
check(prose.includes(`discovery, ${lookups} lookups`), "and its gas paragraph too");

// A V4 pool's id is a 256-bit hash, held as a Uint256. Inside the program an Address is the same
// 256-bit number (the same code either way); at `main`'s edge an Address is 20 bytes.
const asAddress = code.replace("  pool: Uint256,", "  pool: Address,");
check(asAddress !== code, "trade takes the pool as a Uint256");
check(
  bytesToHex(routes.compileSauceProgram("base", asAddress).bytecode) ===
    bytesToHex(routes.compileSauceProgram("base", code).bytecode),
  "an Address pool compiles to the same program: nothing is cut short inside it",
);
const byId = routes.compileSauceProgram(
  "base",
  "function main(id: Address): Uint256 { return id; }",
);
const anId = `0x${"9".repeat(64)}`;
let refusedId = "";
try {
  routes.encodeEntryArguments(byId, [anId]);
} catch (error) {
  refusedId = String(error);
}
check(
  /is not an address: 20 bytes/.test(refusedId),
  `an Address argument refuses an id: ${refusedId}`,
);
check(
  prose.includes("`--args` refuses a 32-byte value for an `Address` parameter"),
  "the skill says so",
);

function isqrt(n: bigint) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return x;
}
const E18 = 10n ** 18n;
const Q192 = 2n ** 192n;
// A decimal price rounded to two places, as the skill writes it: 2686.774… is 2,686.77.
const two = (price: string) => {
  const [whole, fraction = ""] = price.split(".");
  const thousandths = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
  const hundredths = (thousandths + 5n) / 10n;
  return `${(hundredths / 100n).toLocaleString("en-US")}.${String(hundredths % 100n).padStart(2, "0")}`;
};
// A table row of the skill, by its cells, whatever their padding.
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (...cells: string[]) =>
  new RegExp(`^\\|${cells.map((cell) => ` *${escape(cell)} *`).join("\\|")}\\|$`, "m");
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;

// The program's arithmetic, in TypeScript: priceLimit to a sqrt price, then each pool's own limit.
const limitOf = (priceLimit: bigint, paysToken0: boolean) =>
  paysToken0 ? isqrt((Q192 * E18) / priceLimit) : isqrt((priceLimit * Q192) / E18);
const poolLimit = (limit: bigint, fee: bigint, paysToken0: boolean) => {
  const root = isqrt((1_000_000n - fee) * 10n ** 30n);
  return paysToken0 ? (limit * E18) / root : (limit * root) / E18;
};

const chain = routes.chain("base").chain;
const program = routes.compileSauceProgram("base", source);
check(
  /import \{ uniswapV3, uniswapV4 \} from "@sauce\/router"/.test(program.source),
  "every swap is a @sauce/router call",
);
check(
  /__sauce_transfer\(USDC, recipient, unspent\)/.test(program.source),
  "what is left of the budget goes to the recipient, by a SafeERC20 transfer",
);
check(
  program.entryParams.map((param) => param.name).join() ===
    "budget,priceLimit,minTokens,maxAvgPrice,recipient",
  "main takes budget, priceLimit, minTokens, maxAvgPrice and recipient: no token is an argument",
);
// The tokens are written in, by name: USDC paid, SPCXc bought, at every venue.
check(
  code.includes("uniswapV3(pool, USDC, SPCXc, ") &&
    code.includes("uniswapV4(manager, USDC, SPCXc, "),
  "the program pays USDC and buys SPCXc, both by name",
);
// On a chain without Slipstream's factory, naming it is the compile error the skill quotes; less its
// Slipstream loop, and with that chain's own SpaceX token, the program compiles for Ethereum, which
// has Uniswap V3 and V4 and SPCXon.
let refused = "";
try {
  routes.compileSauceProgram("ethereum", source);
} catch (error) {
  refused = String(error);
}
const quoted = "Contract 'CLFactoryGaugesV3' (aerodrome-slipstream) is not deployed on 'ethereum'";
check(refused.includes(quoted), `Ethereum refuses the Slipstream venue: ${refused}`);
check(prose.includes(quoted), "the skill quotes that error");
const loop = /\n {2}for \(const spacing of [^\n]*\n[^\n]*\n[^\n]*\n {2}\}/.exec(source);
check(loop !== null, "the program has a Slipstream loop");
routes.compileSauceProgram("ethereum", source.replace(loop[0], "").replaceAll("SPCXc", "SPCXon"));
check(
  prose.includes("so the program less its Slipstream loop, with `SPCXon` for `SPCXc`"),
  "the skill says it compiles there",
);

const registered = (symbol: string) => {
  const token = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === symbol)!;
  return { ...token, address: getAddress(token.address) };
};
const usdc = registered("USDC");
// SPCXc, Coinbase's tokenized SpaceX on Base: a token global, with 8 decimals.
const spcxc = registered("SPCXc");
check(spcxc.decimals === 8, "SPCXc has 8 decimals");
check(BigInt(usdc.address) < BigInt(spcxc.address), "on Base, USDC is token0: the program pays it");
check(skill.includes(spcxc.address), "the skill names SPCXc's address");
const tokens = { baseDecimals: spcxc.decimals, quoteDecimals: usdc.decimals, baseIsToken0: false };

// priceLimit: the price in whole tokens times 10^(18 + 6 - 8); maxAvgPrice the same, halfway from a
// simulation's average to priceLimit: 148.5 to 150 is 149.25.
const scale = 10n ** BigInt(18 + usdc.decimals - spcxc.decimals);
const buySpcxc = 150n * scale; // 150 USDC
const avgSpcxc = ceil((1485n * scale) / 10n + buySpcxc, 2n); // 149.25
const capSpcxc = 140n * scale; // 140, below the reference
check(scale === 10n ** 16n, "SPCXc's scale is 1e16");
check(buySpcxc === 1_500_000_000_000_000_000n, "priceLimit buying SPCXc at most 150 USDC");
check(avgSpcxc === 1_492_500_000_000_000_000n, "maxAvgPrice halfway between 148.5 and 150: 149.25");
for (const value of [buySpcxc, avgSpcxc])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);

// The limit the program derives from it is the pool price at 150, paying token0 (rounded down).
const limit = limitOf(buySpcxc, true);
const exact = sqrtPriceX96FromPrice("150", tokens);
check(limit - exact <= 1n && exact - limit <= 1n, "150 as the program's limit");
check(skill.includes(String(exact)), `the skill quotes ${exact}`);

// Each pool's own limit, back as a price, is the skill's table, the four standard tiers; the pool's
// last SPCXc there, after its fee, costs priceLimit: at it or inside it, to 0.001%.
for (const fee of [100n, 500n, 3000n, 10000n]) {
  const own = poolLimit(limit, fee, true);
  const cells = [`${fee} (${Number(fee) / 10_000}%)`, two(priceFromSqrtPriceX96(own, tokens))];
  check(row(...cells).test(skill), `the skill's row for fee ${fee}: ${cells.join(" | ")}`);
  // Paying token0: a token1 costs 1 ÷ (price × (1 − fee)), at most priceLimit.
  const paid = Q192 * 1_000_000n * E18;
  const bound = buySpcxc * own * own * (1_000_000n - fee);
  check(paid <= bound && paid * 100_001n >= bound * 100_000n, `fee ${fee}: within priceLimit`);
}
// A V4 pool's fee: the protocol fee for the direction, then the LP fee on the rest. 0.05% with a
// 0.1% protocol fee is 0.15%, as the skill says.
const v4Fee = (protocolFee: bigint, lpFee: bigint) =>
  protocolFee + lpFee - (protocolFee * lpFee) / 1_000_000n;
check(v4Fee(1000n, 500n) === 1500n, "0.05% with a 0.1% protocol fee is 0.15%");
check(prose.includes("at 0.05% with a 0.1% protocol fee, its fee is 0.15%"), "the skill says so");
check(
  code.includes("fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000;"),
  "the program composes it so",
);

// minTokens for at least what all of the budget buys at the limit: budget × 1e18 ÷ priceLimit,
// rounded up. A fill below the limit can reach it with budget left over.
const spend = 1000n * 10n ** BigInt(usdc.decimals);
const allSpcxc = ceil(spend * E18, buySpcxc);
check(allSpcxc === 666_666_667n, "minTokens for all of 1,000 USDC of SPCXc at 150");
check(skill.includes(`\`${allSpcxc}\``), `the skill quotes ${allSpcxc}`);
// The commands pass these values, in main's order: the trade with maxAvgPrice 0 (to read the
// average), 10 SPCXc (more than the budget buys at 150: the minTokens revert), an average capped at
// 140 (the maxAvgPrice revert), and the trade sent with maxAvgPrice 149.25.
const tooMany = 10n * 10n ** BigInt(spcxc.decimals); // 10 SPCXc
check(tooMany > (spend * E18) / buySpcxc, "10 SPCXc is more than 1,000 USDC buys at 150");
const args = (minTokens: bigint, maxAvgPrice: bigint) =>
  `--args ${spend} ${buySpcxc} ${minTokens} ${maxAvgPrice} <recipient>`;
for (const [minTokens, maxAvgPrice, what] of [
  [allSpcxc, 0n, "the trade, reading its average"],
  [tooMany, 0n, "the minTokens revert"],
  [allSpcxc, capSpcxc, "the maxAvgPrice revert"],
  [allSpcxc, avgSpcxc, "the trade sent"],
] as const)
  check(skill.includes(args(minTokens, maxAvgPrice)), `the skill simulates ${what}`);
check(source.includes(args(allSpcxc, avgSpcxc)), "the program header's command passes the same");

// The simulation the skill reads, on a local chain at 150.75: 2,000 USDC over two pools for
// 13.29416629 SPCXc, its average in priceLimit's units, and maxAvgPrice halfway from it to 150.75.
const spent = 2000n * 10n ** BigInt(usdc.decimals);
const bought = 1_329_416_629n;
const localLimit = 15075n * 10n ** 14n; // 150.75
check(512_659_160n + 1_487_340_840n === spent, "the two pools took the 2,000 USDC");
check(340_239_687n + 989_176_942n === bought, "and paid out what main returns");
check(
  skill.includes(`{ spent: ${spent}, bought: ${bought}, unspent: 0 }`),
  "the skill shows main's return by name",
);
const average = (spent * E18) / bought;
for (const value of [localLimit, average, ceil(average + localLimit, 2n)])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);

// main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
// owner sends, with the Kitchen's fee as its value.
const encoded = routes.encodeEntryArguments(program, [spend, buySpcxc, 0n, 0n, recipient]);
const data = v12Pot.encodeCook(
  engine,
  concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]),
);
check(
  routes.decodeEntryArguments(program, encoded)[1] === buySpcxc,
  "the arguments decode back to what was encoded",
);
console.log(
  `base: ${program.bytecode.length} bytes; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
);
for (const fee of [100n, 500n, 3000n, 10000n])
  console.log(
    `fee ${fee}: stops at ${two(priceFromSqrtPriceX96(poolLimit(limit, fee, true), tokens))}`,
  );
console.log(`limit ${exact}; average ${average}; halfway ${ceil(average + localLimit, 2n)}`);
