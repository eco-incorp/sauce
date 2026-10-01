// JSON action programs: validate at the edge, compile once with a runtime amount, and build (not
// send) the quote that prices a swap action. Addresses come from the SDK's registries.
import {
  ProgramError,
  compileProgram,
  parseProgram,
  quoteAction,
  type ActionProgram,
  type UniswapV4SwapAction,
} from "@eco-incorp/sauce/actions";
import { contracts, routes } from "@eco-incorp/sauce";
import { v12RouterAddress } from "@eco-incorp/sauce/deployments";
import { toHex, zeroAddress, type Hex } from "viem";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// Action JSON takes explicit addresses; take them from the SDK's registries instead of memory.
function token(chain: string, symbol: string): Hex {
  const address = routes.registryTokenAddress(routes.chain(chain).chain, symbol);
  if (address === undefined) throw new Error(`${symbol} is not registered on ${chain}`);
  return toHex(address, { size: 20 });
}
function contract(address: Hex | undefined, what: string): Hex {
  if (address === undefined) throw new Error(`${what} has no recorded address`);
  return address;
}
const USDT = token("ethereum", "USDT");
const USDC = token("ethereum", "USDC");
// The spender of the approval below: Aave V3's Pool.
const AAVE_POOL = contract(contracts.on("ethereum").AaveV3.Pool.address, "the Aave V3 Pool");
const POOL_MANAGER = contract(
  contracts.on("ethereum").UniswapV4.PoolManager.address,
  "the Uniswap V4 PoolManager",
);
// The Sauce Router of the release, which quotes Uniswap V3 and V4 swap actions with the code that
// swaps them. A Pot swaps through its own Router, the Kitchen's when it was minted.
const ROUTER = contract(toHex(BigInt(v12RouterAddress()), { size: 20 }), "the Sauce Router");

// 1. Strict validation: every problem at once, each with a path. Amounts are base-10 STRINGS.
try {
  parseProgram({ version: 1, chainId: 1, actions: [{ type: "approve", token: USDT, amuont: 5 }] });
  throw new Error("expected rejection");
} catch (error) {
  if (!(error instanceof ProgramError)) throw error;
  check(error.issues.length >= 1, "issues carry paths");
}

// 2. One compiled program for every amount: `argument` becomes a runtime parameter of `main`.
//    Token writes in action programs are SafeERC20 (approve is forceApprove), so USDT is fine here.
const reusable: ActionProgram = parseProgram({
  version: 1,
  chainId: 1,
  actions: [
    { type: "argument", name: "amount" },
    { type: "approve", token: USDT, spender: AAVE_POOL },
  ],
});
const compiled = compileProgram(reusable);
const p1 = compiled.payload({ amount: 5n });
const p2 = compiled.payload({ amount: "900000" });
check(
  p1.length === compiled.bytecode.length + 32 && p1.length === p2.length,
  "ABI-v1: one word per argument",
);
check(compiled.argumentOffset("amount") === compiled.bytecode.length, "splice offset of `amount`");
check(
  !/IERC20\.at\([^)]*\)\.approve/.test(compiled.source),
  "the approve is not a typed IERC20 call",
);

// 3. A quote is an eth_call you send yourself; nothing here touches the network. A swap action is
//    a call into @sauce/router, here its `uniswapV4`: a hookless USDC/USDT pool, named by its key.
const swapAction: UniswapV4SwapAction = {
  type: "uniswapV4Swap",
  poolManager: POOL_MANAGER,
  tokenIn: USDC,
  tokenOut: USDT,
  fee: 100,
  tickSpacing: 1,
  hooks: zeroAddress, // hookless
  amount: "1000000",
  amountOutMin: "990000",
  recipient: "self",
};
const swapping = compileProgram(parseProgram({ version: 1, chainId: 1, actions: [swapAction] }));
check(/from "@sauce\/router"/.test(swapping.source), "a swap action calls @sauce/router");
const quote = quoteAction(swapAction, { router: ROUTER });
check(
  quote.data.startsWith("0x") && typeof quote.decode === "function",
  "quote = { to, data, decode }",
);

console.log(`reusable approval: ${compiled.bytecode.length} bytes + 32-byte argument`);
console.log(`quote: eth_call to ${quote.to}`);
