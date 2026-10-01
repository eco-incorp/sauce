// JSON action programs: validate at the edge, compile once with a runtime amount, and build (not
// send) the quote that prices a swap action. Addresses come from the SDK's registries.
import {
  ProgramError,
  compileProgram,
  parseProgram,
  quoteAction,
  type ActionProgram,
  type UniswapV3ExactInputAction,
} from "@eco-incorp/sauce/actions";
import { contracts, routes } from "@eco-incorp/sauce";
import { toHex, type Hex } from "viem";

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
const uniswapV3 = contracts.on("ethereum").UniswapV3;
// The spender a swap needs: the Uniswap V3 router the quote below prices through.
const SWAP_ROUTER = contract(uniswapV3.SwapRouter02.address, "SwapRouter02");

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
    { type: "approve", token: USDT, spender: SWAP_ROUTER },
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

// 3. A quote is an eth_call you send yourself; nothing here touches the network.
const swapAction: UniswapV3ExactInputAction = {
  type: "uniswapV3ExactInput",
  router: SWAP_ROUTER,
  tokenIn: USDC,
  tokenOut: USDT,
  fee: 100,
  amount: "1000000",
  amountOutMin: "990000",
  recipient: "self",
};
const quote = quoteAction(swapAction, {
  uniswapV3Quoter: contract(uniswapV3.QuoterV2.address, "QuoterV2"),
});
check(
  quote.data.startsWith("0x") && typeof quote.decode === "function",
  "quote = { to, data, decode }",
);

console.log(`reusable approval: ${compiled.bytecode.length} bytes + 32-byte argument`);
console.log(`quote: eth_call to ${quote.to}`);
