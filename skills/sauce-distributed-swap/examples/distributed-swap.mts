// Compiles distributed-swap.sauce.ts for Base, Arbitrum and Optimism the way `sauce compile` does
// (each venue where the chain has it), and builds the cook `sauce tx` would print for selling 1 WETH
// down to 1,500 USDC per WETH. Asserts what can be checked offline; sends nothing.
//
//   node distributed-swap.mts --owner <Pot owner> --recipient <address>
import { readFileSync } from "node:fs";

import { contracts, routes, v12PredictPot } from "@eco-incorp/sauce";
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

// The one read the program makes by selector: a V3-style pool's slot0(). A V4 pool's price comes
// from the chain's StateView, by name.
check(toFunctionSelector("slot0()") === "0x3850c7bd", "slot0() is 0x3850c7bd");
check(source.includes("hex`3850c7bd`"), "the program reads slot0()");

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

// Each chain's venues, as `available(...)` decides them: Base has all six, Arbitrum no Slipstream,
// Optimism no PancakeSwap V3 either.
const VENUES = {
  base: ["UniswapV3.Factory", "PancakeswapV3.Factory", "AerodromeSlipstream.CLFactory"],
  arbitrum: ["UniswapV3.Factory", "PancakeswapV3.Factory"],
  optimism: ["UniswapV3.Factory"],
} as const;
const ALL = [
  "UniswapV3.Factory",
  "PancakeswapV3.Factory",
  "AerodromeSlipstream.CLFactory",
  "AerodromeSlipstream.CLFactoryGaugeCaps",
  "AerodromeSlipstream.CLFactoryGaugesV3",
  "UniswapV4.StateView",
  "UniswapV4.PoolManager",
];
for (const [slug, expected] of Object.entries(VENUES)) {
  const chain = routes.chain(slug).chain;
  const program = routes.compileSauceProgram(slug, source);
  check(/__sauce_transfer\(tokenOut,/.test(program.source), "the payout is a SafeERC20 transfer");
  check(/__sauce_transfer\(tokenIn,/.test(program.source), "the refund is a SafeERC20 transfer");
  // The program carries the address of exactly the venues the chain has.
  const bytecode = bytesToHex(program.bytecode).toLowerCase();
  const on = contracts.on(slug) as unknown as Record<
    string,
    Record<string, { available: boolean; address?: string }>
  >;
  const used: string[] = [];
  for (const name of ALL) {
    const [ns, member] = name.split(".") as [string, string];
    const contract = on[ns]?.[member];
    const carried =
      contract?.available === true && bytecode.includes(contract.address!.toLowerCase().slice(2));
    check(carried === (contract?.available === true), `${slug}: ${name} is used where it exists`);
    if (carried) used.push(name);
  }
  for (const name of expected) check(used.includes(name), `${slug} has ${name}`);
  check(used.includes("UniswapV4.StateView"), `${slug} reads Uniswap V4 through its StateView`);

  // Sell 1 WETH for USDC down to 1,500 USDC per WETH.
  const wethInfo = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "WETH")!;
  const usdcInfo = routes.TOKEN_REGISTRY[chain.id]!.find((t) => t.symbol === "USDC")!;
  const wethIsToken0 = BigInt(wethInfo.address) < BigInt(usdcInfo.address);
  const limit = sqrtPriceX96(1500n, usdcInfo, wethInfo, wethIsToken0);
  const minAvgPrice =
    (1500n * 10n ** BigInt(usdcInfo.decimals) * 10n ** 18n) / 10n ** BigInt(wethInfo.decimals);
  // The skill quotes Base's and Arbitrum's limit, where WETH is token0 (on Optimism it is token1,
  // and the limit is the ceiling above the price instead).
  check(wethIsToken0 === (slug !== "optimism"), `WETH is token${wethIsToken0 ? 0 : 1} on ${slug}`);
  if (wethIsToken0) check(limit === 3068493539683605256287027n, "the limit the skill quotes");
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
    `${slug}: ${program.bytecode.length} bytes, venues ${used.join(", ")}; cook to ${pot}, ` +
      `${(data.length - 2) / 2} bytes of calldata`,
  );
}
