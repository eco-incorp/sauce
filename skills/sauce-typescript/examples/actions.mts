// JSON action programs: validate at the edge, compile once for a chain with a runtime amount, and
// build (not send) the quote that prices a swap action. Documents name tokens by registry symbol and
// contracts by namespace, so one document compiles for every chain that has those names.
import {
  ProgramError,
  compileProgram,
  parseProgram,
  quoteAction,
  type ActionProgram,
  type UniswapV4SwapAction,
} from "@eco-incorp/sauce/actions";
import { v12QuoteRouterAddress } from "@eco-incorp/sauce/deployments";
import { toHex } from "viem";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

// The Sauce Router of the release, which quotes Uniswap V3 and V4 swap actions with the code that
// swaps them. A Pot swaps through its own Router, the Kitchen's when it was minted.
const ROUTER = toHex(BigInt(v12QuoteRouterAddress()), { size: 20 });

// 1. Strict validation: every problem at once, each with a path. Amounts are base-10 STRINGS.
try {
  parseProgram({ version: 1, actions: [{ type: "approve", token: "USDT", amuont: 5 }] });
  throw new Error("expected rejection");
} catch (error) {
  if (!(error instanceof ProgramError)) throw error;
  check(error.issues.length >= 1, "issues carry paths");
}

// 2. One compiled program for every amount: `argument` becomes a runtime parameter of `main`. The
//    names resolve on the chain given; token writes are SafeERC20 (approve is forceApprove), so USDT
//    is fine here.
const reusable: ActionProgram = parseProgram({
  version: 1,
  actions: [
    { type: "argument", name: "amount" },
    { type: "approve", token: "USDT", spender: "AaveV3.Pool" },
  ],
});
const compiled = compileProgram(reusable, { chain: "ethereum" });
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
// The same document compiles for another chain with those names, to that chain's addresses: the
// source names them, and the bytecode holds each chain's own.
const onOptimism = compileProgram(reusable, { chain: "optimism" });
check(onOptimism.source === compiled.source, "the source names the tokens and contracts");
check(
  toHex(onOptimism.bytecode) !== toHex(compiled.bytecode),
  "the bytecode holds each chain's addresses",
);

// 3. A name the chain lacks throws ProgramError, with the issues and the chain: Base registers no
//    USDT, so the same document does not compile there.
try {
  compileProgram(reusable, { chain: "base" });
  throw new Error("expected rejection");
} catch (error) {
  if (!(error instanceof ProgramError)) throw error;
  check(
    error.chain?.slug === "base" && error.issues[0]?.path === "actions[1].token",
    "the issue names the field and the chain",
  );
}

// 4. A quote is an eth_call you send yourself; nothing here touches the network. A swap action is
//    a call into @sauce/router, here its `uniswapV4`: a hookless USDC/USDT pool, named by its key.
const swapAction: UniswapV4SwapAction = {
  type: "uniswapV4Swap",
  poolManager: "UniswapV4.PoolManager",
  tokenIn: "USDC",
  tokenOut: "USDT",
  fee: 100,
  tickSpacing: 1,
  amount: "1000000",
  amountOutMin: "990000",
  recipient: "self",
};
const swapping = compileProgram(parseProgram({ version: 1, actions: [swapAction] }), {
  chain: "ethereum",
});
check(/from "@sauce\/router"/.test(swapping.source), "a swap action calls @sauce/router");
const quote = quoteAction(swapAction, { chain: "ethereum", router: ROUTER });
check(
  quote.data.startsWith("0x") && typeof quote.decode === "function",
  "quote = { to, data, decode }",
);

console.log(`reusable approval: ${compiled.bytecode.length} bytes + 32-byte argument`);
console.log(`quote: eth_call to ${quote.to}`);
