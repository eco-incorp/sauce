// Compiles distributed-swap.sauce.ts for Base and Arbitrum the way `sauce compile` does, with the
// registry's PancakeSwap V3 and Slipstream factories as the `--define`s a run passes, and builds the
// cook `sauce tx` would print for selling 1 WETH down to 1,500 USDC per WETH. Asserts what can be
// checked offline; sends nothing.
//
//   node distributed-swap.mts --owner <Pot owner> --recipient <address>
import { readFileSync } from "node:fs";

import { routes, v12PredictPot } from "@eco-incorp/sauce";
import { resolveSdkModule } from "@eco-incorp/sauce/compiler";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import * as slipstream from "@eco-incorp/sauce/protocols/aerodrome-slipstream";
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";
import { bytesToHex, concatHex, getAddress, toFunctionSelector, toHex } from "viem";

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

// The two price reads the program makes by selector: a V3-style pool's slot0(), and the
// PoolManager's extsload(bytes32) of a V4 pool's state (not in the served PoolManager ABI).
for (const [signature, selector] of [
  ["slot0()", "3850c7bd"],
  ["extsload(bytes32)", "1e2eaeaf"],
] as const) {
  check(toFunctionSelector(signature) === `0x${selector}`, `${signature} is 0x${selector}`);
  check(source.includes(`hex\`${selector}\``), `the program reads ${signature}`);
}

// floor(sqrt(token1 units / token0 units) * 2^96) for a price in whole tokens, token0 the lower
// address.
function sqrtPriceX96(
  price: bigint,
  out: { decimals: number },
  inp: { decimals: number },
  inIsToken0: boolean,
) {
  const ratio = (price * 10n ** BigInt(out.decimals) * 2n ** 192n) / 10n ** BigInt(inp.decimals);
  const square = inIsToken0 ? ratio : 2n ** 384n / ratio;
  let x = square;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + square / y) / 2n];
  return x;
}

for (const slug of ["base", "arbitrum"]) {
  const chain = routes.chain(slug).chain;
  // The venue factories the chain does not set, from the registry: what `--define` passes.
  const pancake = pancakeV3.deployments.find((d) => d.chainId === chain.id)?.addresses ?? {};
  const slip: Record<string, string | undefined> =
    slipstream.deployments.find((d) => d.chainId === chain.id)?.addresses ?? {};
  const venues: Record<string, bigint> = {};
  if (pancake.factory) venues.PANCAKE_V3_FACTORY = BigInt(pancake.factory);
  if (slip.clFactory) venues.SLIPSTREAM_INITIAL = BigInt(slip.clFactory);
  if (slip.clFactoryGaugeCaps) venues.SLIPSTREAM_GAUGE_CAPS = BigInt(slip.clFactoryGaugeCaps);
  if (slip.clFactoryGaugesV3) venues.SLIPSTREAM_GAUGES_V3 = BigInt(slip.clFactoryGaugesV3);

  const program = routes.compileSauceProgram(slug, source, { defines: venues });
  check((program.source.match(/\.swapV3\(/g) ?? []).length === 1, "one swapV3 call site");
  check((program.source.match(/\.swapV4\(/g) ?? []).length === 1, "one swapV4 call site");
  check(/__sauce_transfer\(tokenOut,/.test(program.source), "the payout is a SafeERC20 transfer");
  check(/__sauce_transfer\(tokenIn,/.test(program.source), "the refund is a SafeERC20 transfer");
  // The chain sets the Uniswap venues itself, so the program carries their addresses.
  const bytecode = bytesToHex(program.bytecode).toLowerCase();
  const defines = routes.chainDefines(chain);
  for (const venue of ["UniswapV3_Factory", "UniswapV4_PoolManager"]) {
    const at = defines[venue];
    check(typeof at === "bigint", `${slug} has ${venue}`);
    check(bytecode.includes(toHex(at, { size: 20 }).slice(2)), `the program uses ${venue}`);
  }

  // Sell 1 WETH for USDC down to 1,500 USDC per WETH.
  const wethInfo = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "WETH")!;
  const usdcInfo = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "USDC")!;
  const wethIsToken0 = BigInt(wethInfo.address) < BigInt(usdcInfo.address);
  const limit = sqrtPriceX96(1500n, usdcInfo, wethInfo, wethIsToken0);
  const minAvgPrice =
    (1500n * 10n ** BigInt(usdcInfo.decimals) * 10n ** 18n) / 10n ** BigInt(wethInfo.decimals);
  check(wethIsToken0 && limit === 3068493539683605256287027n, "WETH is token0; the limit quoted");
  check(minAvgPrice === 1_500_000_000n, "the average-price floor the skill quotes");

  // main's arguments, encoded as `--args` encodes them, appended to the program; then the cook the
  // owner sends, with the Kitchen's fee as its value.
  const args = routes.encodeEntryArguments(program, [
    wethInfo.address,
    usdcInfo.address,
    10n ** 18n,
    limit,
    0n,
    minAvgPrice,
    recipient,
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
    `${slug}: ${program.bytecode.length} bytes, venues UniswapV3_Factory, UniswapV4_PoolManager, ` +
      `${Object.keys(venues).join(", ")}; cook to ${pot}, ${(data.length - 2) / 2} bytes of calldata`,
  );
}
