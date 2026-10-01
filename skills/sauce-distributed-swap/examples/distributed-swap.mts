// Compiles distributed-swap.sauce.ts for Base the way `sauce compile` does, and builds the cooks
// `sauce tx` would print for buying WETH with 3,000 USDC at most 2,713.5 each and selling WETH for
// USDC at least 2,686.5 each. Checks that the SKILL.md shows the program's own code, and that its
// venues, `maxPrice` values, the limits the program derives from them, each pool's own limit,
// `minTokens`, the compile error on a chain without a venue, and the arguments of its commands (and
// the program header's) are what the program and the arithmetic give. Asserts what can be checked
// offline; sends nothing.
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

// The SKILL.md shows the program's code exactly: the file less its header comment.
const code = source.slice(source.indexOf("import "));
const shown = /```sauce chain=[\w,]+\n([\s\S]*?)```/.exec(skill);
check(shown !== null && shown[1] === code, "the SKILL.md's program is the example file's code");

// The Router takes a price limit on the flat V3 entry and services the pool's callback, which
// Uniswap V3 and Slipstream pools both make.
interface AbiFunction {
  name: string;
  inputs: { name: string }[];
}
const served = resolveSdkModule("./artifacts/ISauceRouter.json");
if (served === undefined) throw new Error("the SDK serves ISauceRouter.json");
const parsed = JSON.parse(new TextDecoder().decode(served)) as
  AbiFunction[] | { abi: AbiFunction[] };
const router = Array.isArray(parsed) ? parsed : parsed.abi;
check(
  router.some((f) => f.name === "swapV3" && f.inputs.some((i) => i.name === "sqrtPriceLimitX96")),
  "swapV3 takes sqrtPriceLimitX96",
);
check(
  router.some((f) => f.name === "uniswapV3SwapCallback"),
  "the Router implements uniswapV3SwapCallback",
);

// Every pool read is a typed binding, never a selector: Uniswap V3's, and Slipstream's own, whose
// fee is read from the pool.
check(!/evm\.static|hex`/.test(code), "the program reads no pool by selector");
for (const read of [
  "UniswapV3.Pool.at(pool).liquidity()",
  "UniswapV3.Pool.at(pool).slot0().sqrtPriceX96",
  "AerodromeSlipstream.Pool.at(pool).liquidity()",
  "AerodromeSlipstream.Pool.at(pool).slot0().sqrtPriceX96",
  "AerodromeSlipstream.Pool.at(pool).fee()",
])
  check(code.includes(read), `the program reads ${read}`);

// The venues it walks: Uniswap V3's four tiers and Slipstream's nine spacings, 13 lookups.
const TIERS = [100n, 500n, 3000n, 10000n];
const SPACINGS = [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n];
const list = (xs: bigint[]) => `[${xs.map((x) => `${x}n`).join(", ")}]`;
check(code.includes(`for (const fee of ${list(TIERS)})`), "the program walks the four tiers");
check(code.includes(`for (const spacing of ${list(SPACINGS)})`), "and the nine tick spacings");
check(
  skill.includes(`Discovery is ${TIERS.length + SPACINGS.length} lookups`),
  "the skill counts the lookups",
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
  /import \{ uniswapV3 \} from "@sauce\/router"/.test(program.source),
  "every swap is a @sauce/router call",
);
check(
  /__sauce_transfer\(pay, refundTo, unspent\)/.test(program.source),
  "the refund is a SafeERC20 transfer of what is left of the budget",
);
// On a chain without Slipstream's factory, naming it is the compile error the skill quotes.
let refused = "";
try {
  routes.compileSauceProgram("ethereum", source);
} catch (error) {
  refused = String(error);
}
const quoted = "Contract 'CLFactoryGaugesV3' (aerodrome-slipstream) is not deployed on 'ethereum'";
check(refused.includes(quoted), `Ethereum refuses the Slipstream venue: ${refused}`);
check(skill.replace(/\s+/g, " ").includes(quoted), "the skill quotes that error");

const registered = (symbol: string) => {
  const token = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === symbol)!;
  return { ...token, address: getAddress(token.address) };
};
const weth = registered("WETH");
const usdc = registered("USDC");
check(BigInt(weth.address) < BigInt(usdc.address), "on Base, WETH is token0");
const tokens = { baseDecimals: weth.decimals, quoteDecimals: usdc.decimals, baseIsToken0: true };

// maxPrice: the price in whole tokens times 10^(18 + payDecimals - buyDecimals).
const buyWeth = (27135n * 10n ** BigInt(18 + usdc.decimals - weth.decimals)) / 10n; // 2,713.5
const eightDecimals = 150n * 10n ** BigInt(18 + usdc.decimals - 8); // 150 USDC
const sellWeth = (E18 * E18 * 10n) / (26865n * 10n ** BigInt(usdc.decimals)); // 1 ÷ 2,686.5
check(buyWeth === 2_713_500_000n, "maxPrice buying WETH at most 2,713.5 USDC");
check(eightDecimals === 1_500_000_000_000_000_000n, "maxPrice for an 8-decimal token at 150 USDC");
check(sellWeth === 372231528010422482784291829n, "maxPrice selling WETH at least 2,686.5 USDC");
for (const value of [buyWeth, eightDecimals, sellWeth])
  check(skill.includes(String(value)), `the skill quotes ${value}`);
check(source.includes(String(eightDecimals)), "the program header's example passes it");

// The limits the program derives from those are the pool prices at 2,713.5 and 2,686.5.
const ceiling = limitOf(buyWeth, false); // paying USDC, token1
const floor = limitOf(sellWeth, true); // paying WETH, token0
check(ceiling === sqrtPriceX96FromPrice("2713.5", tokens), "2,713.5 as the program's limit");
const exactFloor = sqrtPriceX96FromPrice("2686.5", tokens);
check(floor - exactFloor <= 1n, "2,686.5 as the program's limit, maxPrice rounded down");
for (const value of [ceiling, exactFloor])
  check(skill.includes(String(value)), `the skill quotes ${value}`);

// Each pool's own limit, back as a price, is the skill's table; the pool's last unit there, after
// its fee, costs maxPrice: at it or inside it, to 0.001%.
for (const fee of TIERS) {
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

// minTokens to spend all of 3,000 USDC or nothing: budget × 1e18 ÷ maxPrice, rounded up.
const budget = 3000n * 10n ** BigInt(usdc.decimals);
const allOrNothing = (budget * E18 + buyWeth - 1n) / buyWeth;
check(allOrNothing === 1105583195135433942n, "minTokens for all of 3,000 USDC at 2,713.5");
check(skill.includes(String(allOrNothing)), "the skill quotes it");
// The commands pass these values, in main's order: the skill's and the program header's.
const commands = `--args ${usdc.address} ${weth.address} \\\n  ${budget} ${buyWeth} 0 0 <recipient> <refundTo>`;
check(skill.includes(commands), "the skill's commands pass the budget, maxPrice and the checks");
const header = `--args ${usdc.address} <buyToken> 1000000000 \\\n//     ${eightDecimals} 0 0 <recipient> <refundTo>`;
check(source.includes(header), "the program header's Base command passes the same shape");

// main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
// owner sends, with the Kitchen's fee as its value.
for (const [payToken, buyToken, amount, maxPrice] of [
  [usdc.address, weth.address, budget, buyWeth],
  [weth.address, usdc.address, E18, sellWeth],
] as const) {
  const args = routes.encodeEntryArguments(program, [
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
    concatHex([bytesToHex(program.bytecode), bytesToHex(args)]),
  );
  check(
    routes.decodeEntryArguments(program, args)[3] === maxPrice,
    "the arguments decode back to what was encoded",
  );
  console.log(
    `base: ${program.bytecode.length} bytes; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
  );
}
