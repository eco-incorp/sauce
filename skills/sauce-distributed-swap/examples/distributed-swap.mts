// Compiles distributed-swap.sauce.ts for Base, Arbitrum and Ethereum the way `sauce compile` does,
// with the registry's PancakeSwap V3 and Slipstream factories as the defines a run passes, and
// builds the cooks `sauce tx` would print for selling 1 WETH and buying WETH with 3,000 USDC, each
// with the limit 0.5% from a reference of 2,700 USDC per WETH and the four standard V4 keys. Checks
// that the SKILL.md's Base defines file, its V4 keys, its selectors, its worked prices and minimum
// outputs, and the arguments of its commands are what the registry and the arithmetic give.
// Asserts what can be checked offline; sends nothing.
//
//   node distributed-swap.mts --owner <Pot owner> --recipient <address>
import { readFileSync } from "node:fs";

import { routes, sqrtPriceX96FromPrice, v12PredictPot } from "@eco-incorp/sauce";
import { resolveSdkModule } from "@eco-incorp/sauce/compiler";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import * as slipstream from "@eco-incorp/sauce/protocols/aerodrome-slipstream";
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";
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

// The Router takes a price limit on both entry points and services these pools' callbacks.
interface AbiFunction {
  name: string;
  inputs: { name: string }[];
}
const served = resolveSdkModule("./artifacts/ISauceRouter.json");
if (served === undefined) throw new Error("the SDK serves ISauceRouter.json");
const parsed = JSON.parse(new TextDecoder().decode(served)) as
  AbiFunction[] | { abi: AbiFunction[] };
const router = Array.isArray(parsed) ? parsed : parsed.abi;
const takesLimit = (name: string) =>
  router.some((f) => f.name === name && f.inputs.some((i) => i.name === "sqrtPriceLimitX96"));
check(takesLimit("swapV3") && takesLimit("swapV4"), "swapV3 and swapV4 take sqrtPriceLimitX96");
for (const callback of ["uniswapV3SwapCallback", "pancakeV3SwapCallback", "unlockCallback"]) {
  check(
    router.some((f) => f.name === callback),
    `the Router implements ${callback}`,
  );
}

// The reads the program makes by selector, and the SKILL.md's table of them: a V3-style pool's
// slot0(), liquidity() and fee(), and the PoolManager's extsload(bytes32) of a V4 pool's state.
for (const [signature, selector] of [
  ["slot0()", "3850c7bd"],
  ["liquidity()", "1a686502"],
  ["fee()", "ddca3f43"],
  ["extsload(bytes32)", "1e2eaeaf"],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
  check(source.includes(`hex\`${selector}\``), `the program reads ${signature}`);
  check(skill.includes(`0x${selector}`), `the skill gives ${signature}'s selector`);
}

function isqrt(n: bigint) {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return x;
}
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
// Output units per input unit, times 1e18, rounded up, for `priceNum / priceDen` whole output per
// whole input: the program's check is out * 1e18 >= minAvgPrice * spent.
function minAvgPrice(
  out: { decimals: number },
  inp: { decimals: number },
  priceNum: bigint,
  priceDen: bigint,
) {
  return ceilDiv(
    priceNum * 10n ** BigInt(out.decimals) * 10n ** 18n,
    priceDen * 10n ** BigInt(inp.decimals),
  );
}

// The four standard hookless V4 keys the skill gives as v4Keys' default, as `--args` takes them.
const STANDARD_KEYS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
];
const keysBlock = /```json\n(\[[\s\S]*?)```/.exec(skill);
check(keysBlock !== null, "the skill gives the V4 keys as JSON");
check(
  JSON.stringify(JSON.parse(keysBlock[1]!)) === JSON.stringify(STANDARD_KEYS),
  "the skill's V4 keys are the four standard hookless keys",
);
check(
  skill.includes(`'${JSON.stringify(STANDARD_KEYS)}'`),
  "the skill's commands pass the standard keys",
);

// The Base defines file the SKILL.md gives is the registry's addresses for those roles.
const fenced = /```json\n([\s\S]*?)```/.exec(skill);
check(fenced !== null, "the skill gives a defines file");
const skillDefines = JSON.parse(fenced[1]!) as Record<string, string>;

for (const slug of ["base", "arbitrum", "ethereum"]) {
  const chain = routes.chain(slug).chain;
  // The venue factories the chain does not set, from the registry: what the defines pass.
  const pancake = pancakeV3.deployments.find((d) => d.chainId === chain.id)?.addresses ?? {};
  const slip: Record<string, string | undefined> =
    slipstream.deployments.find((d) => d.chainId === chain.id)?.addresses ?? {};
  const venues: Record<string, bigint> = {};
  if (pancake.factory) venues.PANCAKE_V3_FACTORY = BigInt(pancake.factory);
  if (slip.clFactory) venues.SLIPSTREAM_INITIAL = BigInt(slip.clFactory);
  if (slip.clFactoryGaugeCaps) venues.SLIPSTREAM_GAUGE_CAPS = BigInt(slip.clFactoryGaugeCaps);
  if (slip.clFactoryGaugesV3) venues.SLIPSTREAM_GAUGES_V3 = BigInt(slip.clFactoryGaugesV3);
  if (slug === "base") {
    check(
      JSON.stringify(Object.keys(skillDefines).sort()) ===
        JSON.stringify(Object.keys(venues).sort()),
      "the skill's Base defines name every venue the chain does not set",
    );
    for (const [name, value] of Object.entries(skillDefines)) {
      check(BigInt(value) === venues[name], `the skill's ${name} is the registry's`);
    }
  }

  const program = routes.compileSauceProgram(slug, source, { defines: venues });
  check((program.source.match(/\.swapV3\(/g) ?? []).length === 1, "one swapV3 call site");
  check((program.source.match(/\.swapV4\(/g) ?? []).length === 1, "one swapV4 call site");
  check(/__sauce_transfer\(tokenOut,/.test(program.source), "the payout is a SafeERC20 transfer");
  check(
    /__sauce_transfer\(tokenIn, refundTo, remaining\)/.test(program.source),
    "the refund is a SafeERC20 transfer of what is left of amountIn, not the Pot's balance",
  );
  // The chain sets the Uniswap venues itself, so the program carries their addresses.
  const bytecode = bytesToHex(program.bytecode).toLowerCase();
  const defines = routes.chainDefines(chain);
  for (const venue of ["UniswapV3_Factory", "UniswapV4_PoolManager"]) {
    const at = defines[venue];
    check(typeof at === "bigint", `${slug} has ${venue}`);
    // Its significant bytes: an address with leading zero bytes is pushed without them.
    check(bytecode.includes(at.toString(16)), `the program uses ${venue}`);
  }

  // The token order decides the numbers: WETH is token0 on Base and Arbitrum, USDC on Ethereum.
  const weth = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "WETH")!;
  const usdc = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "USDC")!;
  const wethIsToken0 = BigInt(weth.address) < BigInt(usdc.address);
  check(wethIsToken0 === (slug !== "ethereum"), `on ${slug}, WETH is token0: ${wethIsToken0}`);
  if (!wethIsToken0) {
    console.log(`${slug}: ${program.bytecode.length} bytes, USDC is token0 here`);
    continue;
  }

  // A reference of 2,700 USDC per WETH, and the limit 0.5% from it: selling 1 WETH down to 2,686.5,
  // buying with 3,000 USDC up to 2,713.5. The SDK's conversion is what `sauce price` prints.
  const tokens = { baseDecimals: weth.decimals, quoteDecimals: usdc.decimals, baseIsToken0: true };
  const reference = sqrtPriceX96FromPrice("2700", tokens);
  const sell = {
    limit: sqrtPriceX96FromPrice("2686.5", tokens),
    avg: minAvgPrice(usdc, weth, 26865n, 10n),
    minOut: ceilDiv(10n ** 18n * 26865n * 10n ** 6n, 10n * 10n ** 18n),
  };
  const buy = {
    limit: sqrtPriceX96FromPrice("2713.5", tokens),
    avg: minAvgPrice(weth, usdc, 10n, 27135n),
    minOut: ceilDiv(3000n * 10n ** 6n * 10n * 10n ** 18n, 27135n * 10n ** 6n),
  };
  check(reference === 4116816085950893928074568n, "2,700 USDC per WETH as sqrtPriceX96");
  check(sell.limit === 4106511148422261116904015n, "2,686.5 USDC per WETH as sqrtPriceX96");
  check(buy.limit === 4127095293177970497328754n, "2,713.5 USDC per WETH as sqrtPriceX96");
  check(sell.avg === 2_686_500_000n, "the average-price floor selling WETH");
  check(
    buy.avg === 368527731711811313801363553n,
    "the average-price floor buying WETH, rounded up",
  );
  check(sell.minOut === 2_686_500_000n, "minOut selling all of 1 WETH at the floor");
  check(buy.minOut === 1105583195135433942n, "minOut buying with all of 3,000 USDC at the ceiling");
  for (const value of [reference, sell.limit, buy.limit, sell.avg, buy.avg, buy.minOut])
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
    check(
      gap * 10n ** 15n < exact,
      "the reference times the factor is the moved price, to 15 digits",
    );
  }
  // And back: sqrtPriceX96² × 10^d0 / (2^192 × 10^d1) is the price again.
  const back = (reference * reference * 10n ** 18n) / (2n ** 192n * 10n ** 6n);
  check(back === 2699n, "4116816085950893928074568 converts back to just under 2,700");
  // The skill's commands pass these values, in main's order.
  check(
    skill.includes(`1000000000000000000 ${sell.limit} ${sell.minOut} ${sell.avg} <recipient>`),
    "the selling commands pass amountIn, the floor, minOut and minAvgPrice",
  );
  check(
    skill.includes(`3000000000 ${buy.limit} 0 ${buy.avg} <recipient>`),
    "the buying command passes amountIn, the ceiling, minOut 0 and minAvgPrice",
  );

  // main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
  // owner sends, with the Kitchen's fee as its value.
  for (const [tokenIn, tokenOut, amountIn, minOut, { limit, avg }] of [
    [weth.address, usdc.address, 10n ** 18n, sell.minOut, sell],
    [usdc.address, weth.address, 3000n * 10n ** 6n, 0n, buy],
  ] as const) {
    const args = routes.encodeEntryArguments(program, [
      tokenIn,
      tokenOut,
      amountIn,
      limit,
      minOut,
      avg,
      recipient,
      recipient,
      STANDARD_KEYS.map(({ fee, tickSpacing }) => ({
        fee: BigInt(fee),
        tickSpacing: BigInt(tickSpacing),
      })),
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
      `${slug}: ${program.bytecode.length} bytes, venues UniswapV3_Factory, UniswapV4_PoolManager, ` +
        `${Object.keys(venues).join(", ")}; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
    );
  }
}
