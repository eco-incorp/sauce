// Compiles distributed-swap.sauce.ts for Base the way `sauce compile` does, and builds the cooks
// `sauce tx` would print for buying SPCXc and WETH with USDC and selling WETH for USDC. Checks that
// the SKILL.md shows the program's own code, and that its venues and lookups, its typed reads, the
// Slipstream swap through uniswapV3, a V4 pool id held as a Uint256, the `maxPrice` values, the
// limits the program derives from them, each pool's own limit, `minTokens`, `maxAvgPrice`, the
// rehearsal it reads, the chains it compiles on, and the arguments of its commands (and the program
// header's) are what the program and the arithmetic give. Asserts what can be checked offline;
// sends nothing.
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
const venues = [...code.matchAll(/trade\((\d)n, /g)].map((m) => m[1]);
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
const list = (xs: bigint[]) => `[${xs.map((x) => `${x}n`).join(", ")}]`;
check(code.includes(`for (const spacing of ${list(SPACINGS)})`), "the program walks nine spacings");
check(code.includes(`for (const fee of ${list(TIERS)})`), "and Base's seven tiers");
const keys = [...code.matchAll(/\{ fee: (\d+)n, spacing: (\d+)n \}/g)].map(
  (m) => `${m[1]}:${m[2]}`,
);
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

// The program's arithmetic, in TypeScript: maxPrice to a sqrt price, then each pool's own limit.
const limitOf = (maxPrice: bigint, paysToken0: boolean) =>
  paysToken0 ? isqrt((Q192 * E18) / maxPrice) : isqrt((maxPrice * Q192) / E18);
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
  /__sauce_transfer\(pay, refundTo, unspent\)/.test(program.source),
  "the refund is a SafeERC20 transfer of what is left of the budget",
);
// On a chain without Slipstream's factory, naming it is the compile error the skill quotes; less its
// Slipstream loop, the program compiles for Ethereum, which has Uniswap V3 and V4.
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
routes.compileSauceProgram("ethereum", source.replace(loop[0], ""));
check(
  prose.includes("so the program less its Slipstream loop"),
  "the skill says it compiles there",
);

const registered = (symbol: string) => {
  const token = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === symbol)!;
  return { ...token, address: getAddress(token.address) };
};
const weth = registered("WETH");
const usdc = registered("USDC");
check(BigInt(weth.address) < BigInt(usdc.address), "on Base, WETH is token0");
const tokens = { baseDecimals: weth.decimals, quoteDecimals: usdc.decimals, baseIsToken0: true };

// SPCXc, Coinbase's tokenized SpaceX on Base: a token global, with 8 decimals.
const spcxc = registered("SPCXc");
check(spcxc.decimals === 8, "SPCXc has 8 decimals");
check(skill.includes(spcxc.address) && source.includes(spcxc.address), "both name SPCXc's address");

// maxPrice: the price in whole tokens times 10^(18 + payDecimals - buyDecimals); maxAvgPrice the
// same, halfway from a rehearsal's average to maxPrice: 148.5 to 150, 2,700 to 2,713.5.
const spcxScale = 10n ** BigInt(18 + usdc.decimals - spcxc.decimals);
const wethScale = 10n ** BigInt(18 + usdc.decimals - weth.decimals);
const buyWeth = (27135n * wethScale) / 10n; // 2,713.5
const buySpcxc = 150n * spcxScale; // 150 USDC
const avgSpcxc = ceil((1485n * spcxScale) / 10n + buySpcxc, 2n); // 149.25
const avgWeth = ceil(2700n * wethScale + buyWeth, 2n); // 2,706.75
const capSpcxc = 140n * spcxScale; // 140, below the reference
const sellWeth = (E18 * E18 * 10n) / (26865n * 10n ** BigInt(usdc.decimals)); // 1 ÷ 2,686.5
check(spcxScale === 10n ** 16n, "SPCXc's scale is 1e16");
check(buyWeth === 2_713_500_000n, "maxPrice buying WETH at most 2,713.5 USDC");
check(buySpcxc === 1_500_000_000_000_000_000n, "maxPrice buying SPCXc at most 150 USDC");
check(sellWeth === 372231528010422482784291829n, "maxPrice selling WETH at least 2,686.5 USDC");
check(avgSpcxc === 1_492_500_000_000_000_000n, "maxAvgPrice halfway between 148.5 and 150: 149.25");
check(avgWeth === 2_706_750_000n, "maxAvgPrice halfway between 2,700 and 2,713.5: 2,706.75");
for (const value of [buyWeth, buySpcxc, sellWeth, avgSpcxc, avgWeth])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);

// The limits the program derives from those are the pool prices at 2,713.5 and 2,686.5.
const ceiling = limitOf(buyWeth, false); // paying USDC, token1
const floor = limitOf(sellWeth, true); // paying WETH, token0
check(ceiling === sqrtPriceX96FromPrice("2713.5", tokens), "2,713.5 as the program's limit");
const exactFloor = sqrtPriceX96FromPrice("2686.5", tokens);
check(floor - exactFloor <= 1n, "2,686.5 as the program's limit, maxPrice rounded down");
for (const value of [ceiling, exactFloor])
  check(skill.includes(String(value)), `the skill quotes ${value}`);

// Each pool's own limit, back as a price, is the skill's table, the four standard tiers; the pool's
// last unit there, after its fee, costs maxPrice: at it or inside it, to 0.001%.
for (const fee of [100n, 500n, 3000n, 10000n]) {
  const buying = poolLimit(ceiling, fee, false);
  const selling = poolLimit(floor, fee, true);
  const cells = [
    `${fee} (${Number(fee) / 10_000}%)`,
    two(priceFromSqrtPriceX96(buying, tokens)),
    two(priceFromSqrtPriceX96(selling, tokens)),
  ];
  check(row(...cells).test(skill), `the skill's row for fee ${fee}: ${cells.join(" | ")}`);
  // Paying token1: a token0 costs price ÷ (1 − fee), at most maxPrice.
  const boughtAt = buying * buying * 1_000_000n * E18;
  const buyBound = buyWeth * Q192 * (1_000_000n - fee);
  check(boughtAt <= buyBound && boughtAt * 100_001n >= buyBound * 100_000n, `fee ${fee}: buying`);
  // Paying token0: a token1 costs 1 ÷ (price × (1 − fee)), at most maxPrice.
  const soldAt = Q192 * 1_000_000n * E18;
  const sellBound = sellWeth * selling * selling * (1_000_000n - fee);
  check(soldAt <= sellBound && soldAt * 100_001n >= sellBound * 100_000n, `fee ${fee}: selling`);
}
// A V4 pool's fee: the protocol fee for the direction, then the LP fee on the rest. 0.05% with a
// 0.1% protocol fee is 0.15%, as the skill says.
const v4Fee = (protocolFee: bigint, lpFee: bigint) =>
  protocolFee + lpFee - (protocolFee * lpFee) / 1_000_000n;
check(v4Fee(1000n, 500n) === 1500n, "0.05% with a 0.1% protocol fee is 0.15%");
check(prose.includes("at 0.05% with a 0.1% protocol fee, its fee is 0.15%"), "the skill says so");
check(
  code.includes("fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000n;"),
  "the program composes it so",
);

// minTokens to spend all of the budget or nothing: budget × 1e18 ÷ maxPrice, rounded up.
const spend = 1000n * 10n ** BigInt(usdc.decimals);
const wethBudget = 3000n * 10n ** BigInt(usdc.decimals);
const allSpcxc = ceil(spend * E18, buySpcxc);
const allWeth = ceil(wethBudget * E18, buyWeth);
check(allSpcxc === 666_666_667n, "minTokens for all of 1,000 USDC of SPCXc at 150");
check(allWeth === 1105583195135433942n, "minTokens for all of 3,000 USDC of WETH at 2,713.5");
for (const value of [allSpcxc, allWeth])
  check(skill.includes(`\`${value}\``), `the skill quotes ${value}`);
// The commands pass these values, in main's order: the trade with maxAvgPrice 0 (to read the
// average), 10 SPCXc (more than the budget buys at 150: the minTokens revert), an average capped at
// 140 (the maxAvgPrice revert), and the trade sent with maxAvgPrice 149.25.
const tooMany = 10n * 10n ** BigInt(spcxc.decimals); // 10 SPCXc
check(tooMany > (spend * E18) / buySpcxc, "10 SPCXc is more than 1,000 USDC buys at 150");
const args = (
  buyToken: string,
  budget: bigint,
  maxPrice: bigint,
  minTokens: bigint,
  maxAvgPrice: bigint,
) =>
  `--args ${usdc.address} ${buyToken} \\\n  ${budget} ${maxPrice} ${minTokens} ${maxAvgPrice} <recipient> <refundTo>`;
for (const [minTokens, maxAvgPrice, what] of [
  [allSpcxc, 0n, "the trade, reading its average"],
  [tooMany, 0n, "the minTokens revert"],
  [allSpcxc, capSpcxc, "the maxAvgPrice revert"],
  [allSpcxc, avgSpcxc, "the trade sent"],
] as const)
  check(
    skill.includes(args(spcxc.address, spend, buySpcxc, minTokens, maxAvgPrice)),
    `the skill rehearses ${what}`,
  );
const header = (line: string) => line.replace("\n  ", "\n//     ");
check(
  source.includes(header(args(spcxc.address, spend, buySpcxc, allSpcxc, avgSpcxc))),
  "the program header's SPCXc command passes the same",
);
check(
  source.includes(header(args(weth.address, wethBudget, buyWeth, allWeth, avgWeth))),
  "the program header's WETH command passes its own",
);

// The rehearsal the skill reads: 2,000 USDC over two pools for 0.738558490183795118 WETH, its
// average in maxPrice's units, and maxAvgPrice halfway from it to 2,713.5.
const spent = 2000n * 10n ** BigInt(usdc.decimals);
const bought = 738558490183795118n;
check(455100231n + 1544899769n === spent, "the two pools took the 2,000 USDC");
check(167790241413064662n + 570768248770730456n === bought, "and paid out what main returns");
check(
  skill.includes(`{ spent: ${spent}, bought: ${bought}, unspent: 0 }`),
  "the skill shows main's return by name",
);
const average = (spent * E18) / bought;
check(average === 2_707_977_806n, "an average of 2,707.98 USDC per WETH");
check(ceil(average + buyWeth, 2n) === 2_710_738_903n, "maxAvgPrice halfway to 2,713.5");
for (const value of [average, ceil(average + buyWeth, 2n)])
  check(skill.includes(`**${value}**`), `the skill quotes ${value}`);

// main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
// owner sends, with the Kitchen's fee as its value.
for (const [payToken, buyToken, amount, maxPrice] of [
  [usdc.address, spcxc.address, spend, buySpcxc],
  [usdc.address, weth.address, wethBudget, buyWeth],
  [weth.address, usdc.address, E18, sellWeth],
] as const) {
  const encoded = routes.encodeEntryArguments(program, [
    payToken,
    buyToken,
    amount,
    maxPrice,
    0n,
    0n,
    recipient,
    recipient,
  ]);
  const data = v12Pot.encodeCook(
    engine,
    concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)]),
  );
  check(
    routes.decodeEntryArguments(program, encoded)[3] === maxPrice,
    "the arguments decode back to what was encoded",
  );
  console.log(
    `base: ${program.bytecode.length} bytes; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
  );
}
