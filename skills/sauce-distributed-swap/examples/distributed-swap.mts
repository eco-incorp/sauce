// Compiles distributed-swap.sauce.ts for Base and Ethereum the way `sauce compile` does, and builds
// the cooks `sauce tx` would print for selling 1 WETH and buying WETH with 3,000 USDC on Base, each
// with the limit 0.5% from a reference of 2,700 USDC per WETH. Checks that the SKILL.md shows the
// program's own code, and that its fee tiers, per-pool limits, worked prices, minimum outputs and
// the arguments of its commands (and the program header's) are what the program and the arithmetic
// give. Asserts what can be checked offline; sends nothing.
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
import { bytesToHex, concatHex, getAddress, toFunctionSelector } from "viem";

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

// The Router takes a price limit on the flat V3 entry and services the pool's callback.
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

// The two pool reads the program makes: liquidity() and slot0().
for (const [signature, selector] of [
  ["liquidity()", "1a686502"],
  ["slot0()", "3850c7bd"],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
  check(source.includes(`hex\`${selector}\``), `the program reads ${signature}`);
}

// The fee tiers the program walks, lowest fee first, are the ones the skill names.
const TIERS = [100n, 500n, 3000n, 10000n];
check(
  source.includes(`for (const fee of [${TIERS.map((t) => `${t}n`).join(", ")}])`),
  "the program walks the four standard tiers, lowest fee first",
);

function isqrt(n: bigint) {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return x;
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
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

for (const slug of ["base", "ethereum"]) {
  const chain = routes.chain(slug).chain;
  const program = routes.compileSauceProgram(slug, source);
  check(
    /import \{ uniswapV3 \} from "@sauce\/router"/.test(program.source),
    "every swap is a @sauce/router call",
  );
  check(
    /__sauce_transfer\(input, ctx\.msgSender\(\), unsold\)/.test(program.source),
    "the refund is a SafeERC20 transfer of what is left of amountIn, to the owner",
  );
  const registered = (symbol: string) => {
    const token = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === symbol)!;
    return { ...token, address: getAddress(token.address) };
  };
  const weth = registered("WETH");
  const usdc = registered("USDC");
  // The token order decides the numbers: WETH is token0 on Base, USDC on Ethereum.
  const wethIsToken0 = BigInt(weth.address) < BigInt(usdc.address);
  check(wethIsToken0 === (slug === "base"), `on ${slug}, WETH is token0: ${wethIsToken0}`);
  if (slug !== "base") {
    console.log(`${slug}: ${program.bytecode.length} bytes`);
    continue;
  }

  // A reference of 2,700 USDC per WETH, and the limit 0.5% from it: selling 1 WETH down to 2,686.5,
  // buying with 3,000 USDC up to 2,713.5. The SDK's conversion is what `sauce price` prints.
  const tokens = { baseDecimals: weth.decimals, quoteDecimals: usdc.decimals, baseIsToken0: true };
  const reference = sqrtPriceX96FromPrice("2700", tokens);
  const sell = {
    limit: sqrtPriceX96FromPrice("2686.5", tokens),
    minOut: ceilDiv(10n ** 18n * 26865n * 10n ** 6n, 10n * 10n ** 18n),
  };
  const buy = {
    limit: sqrtPriceX96FromPrice("2713.5", tokens),
    minOut: ceilDiv(3000n * 10n ** 6n * 10n * 10n ** 18n, 27135n * 10n ** 6n),
  };
  check(reference === 4116816085950893928074568n, "2,700 USDC per WETH as sqrtPriceX96");
  check(sell.limit === 4106511148422261116904015n, "2,686.5 USDC per WETH as sqrtPriceX96");
  check(buy.limit === 4127095293177970497328754n, "2,713.5 USDC per WETH as sqrtPriceX96");
  check(sell.minOut === 2_686_500_000n, "minOut selling all of 1 WETH at the floor");
  check(buy.minOut === 1105583195135433942n, "minOut buying with all of 3,000 USDC at the ceiling");
  for (const value of [reference, sell.limit, buy.limit, sell.minOut, buy.minOut])
    check(skill.includes(String(value)), `the skill quotes ${value}`);
  // X% on the price is √(1 ± X) on sqrtPriceX96: 0.5% is × 0.99750 down and × 1.00250 up.
  const down = isqrt(995n * 10n ** 33n); // √0.995, times 1e18
  const up = isqrt(1005n * 10n ** 33n);
  const fiveDigits = (x: bigint) => (x + 5n * 10n ** 12n) / 10n ** 13n; // rounded to 5 decimals
  check(
    fiveDigits(down) === 99750n && fiveDigits(up) === 100250n,
    "√0.995 ≈ 0.99750, √1.005 ≈ 1.00250",
  );
  check(skill.includes("0.99750") && skill.includes("1.00250"), "the skill gives both factors");
  for (const [moved, exact] of [
    [(reference * down) / 10n ** 18n, sell.limit],
    [(reference * up) / 10n ** 18n, buy.limit],
  ] as const) {
    const gap = moved > exact ? moved - exact : exact - moved;
    check(gap * 10n ** 15n < exact, "the reference times the factor is the moved price");
  }
  // And back: sqrtPriceX96² × 10^d0 / (2^192 × 10^d1) is the price again.
  const back = (reference * reference * 10n ** 18n) / (2n ** 192n * 10n ** 6n);
  check(back === 2699n, "4116816085950893928074568 converts back to just under 2,700");

  // Each pool's own limit, as the program computes it: the caller's moved by √(1 − fee), rounded
  // down, in millionths. Back as a price, it is the one the skill's table gives, and the pool's
  // last unit there, after its fee, costs the caller's limit: at it or inside it, to 0.001%.
  const Q192 = 2n ** 192n;
  for (const fee of TIERS) {
    const root = isqrt((1_000_000n - fee) * 1_000_000n);
    const selling = (sell.limit * 1_000_000n) / root; // the price falls: a higher floor
    const buying = (buy.limit * root) / 1_000_000n; // the price rises: a lower ceiling
    const cells = [
      `${fee} (${Number(fee) / 10_000}%)`,
      String(root),
      two(priceFromSqrtPriceX96(selling, tokens)),
      two(priceFromSqrtPriceX96(buying, tokens)),
    ];
    check(row(...cells).test(skill), `the skill's row for fee ${fee}: ${cells.join(" | ")}`);
    // Selling: the pool's price at its limit, less its fee, is at least the floor.
    const [floorNum, floorDen] = [26865n * 10n ** 5n, 10n ** 18n]; // USDC units per WETH unit
    const lastSold = selling * selling * (1_000_000n - fee) * floorDen;
    check(lastSold >= floorNum * Q192 * 1_000_000n, `fee ${fee}: the last unit sold is >= floor`);
    check(
      lastSold * 100_000n <= floorNum * Q192 * 1_000_000n * 100_001n,
      `fee ${fee}: the last unit sold is at the floor`,
    );
    // Buying: the pool's price at its limit, plus its fee, is at most the ceiling.
    const [ceilNum, ceilDen] = [27135n * 10n ** 5n, 10n ** 18n];
    const lastBought = buying * buying * 1_000_000n * ceilDen;
    check(
      lastBought <= ceilNum * Q192 * (1_000_000n - fee),
      `fee ${fee}: the last unit bought is <= ceiling`,
    );
    check(
      lastBought * 100_001n >= ceilNum * Q192 * (1_000_000n - fee) * 100_000n,
      `fee ${fee}: the last unit bought is at the ceiling`,
    );
  }
  check(
    source.includes("Math.sqrt((1000000n - fee) * 1000000n)") &&
      source.includes("Math.mulDiv(sqrtPriceLimitX96, 1000000n, root)") &&
      source.includes("Math.mulDiv(sqrtPriceLimitX96, root, 1000000n)"),
    "the program moves each pool's limit by √(1 − fee), as computed here",
  );

  // The commands pass these values, in main's order: the skill's and the program header's.
  const selling = `--args ${weth.address} ${usdc.address} \\\n  1000000000000000000 ${sell.limit} ${sell.minOut} <recipient>`;
  const buying = `--args ${usdc.address} ${weth.address} \\\n  3000000000 ${buy.limit} 0 <recipient>`;
  check(skill.includes(selling), "the selling commands pass amountIn, the floor and minOut");
  check(skill.includes(buying), "the buying command passes amountIn, the ceiling and minOut 0");
  check(
    source.includes(selling.replaceAll("\n  ", "\n//     ")),
    "the program header's Base command passes the same",
  );

  // main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
  // owner sends, with the Kitchen's fee as its value.
  for (const [tokenIn, tokenOut, amountIn, limit, minOut] of [
    [weth.address, usdc.address, 10n ** 18n, sell.limit, sell.minOut],
    [usdc.address, weth.address, 3000n * 10n ** 6n, buy.limit, 0n],
  ] as const) {
    const args = routes.encodeEntryArguments(program, [
      tokenIn,
      tokenOut,
      amountIn,
      limit,
      minOut,
      recipient,
    ]);
    const data = v12Pot.encodeCook(
      engine,
      concatHex([bytesToHex(program.bytecode), bytesToHex(args)]),
    );
    check(
      routes.decodeEntryArguments(program, args)[3] === limit,
      "the arguments decode back to what was encoded",
    );
    console.log(
      `${slug}: ${program.bytecode.length} bytes; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
    );
  }
}
