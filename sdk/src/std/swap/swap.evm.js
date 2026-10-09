// @sauce/swap — EVM arm. Swaps whose route a service builds when the program compiles.
//
// A program writes `kyberSwap(tokenIn, tokenOut, amountIn, minOut)` or `ecoSwap(...)`, with no
// import: the SDK hands every compile this module as an ambient one. Each is an arrow function the
// compiler runs at its call. It names its route by a scope — the provider, the chain the call runs
// on, the tokens and, for KyberSwap, the amount, all of which the compiler must know — and reads it
// with `globalIn(scope, name)` from the module the SDK writes for that scope while the program
// compiles (`routes/swap-host.ts`): KyberSwap's router calldata, or an eco-swap program. What the
// call leaves for run time is the swap itself, emitted where the call stands.
//
// Each returns the amount of `tokenOut` the swap delivered to the Pot, measured as the change in the
// Pot's balance across the call, and reverts below `minOut`. The output stays in the Pot. Neither
// reads or pays out the Pot's whole balance: on an intent's destination the Pot is shared by every
// intent, so only what the swap itself moved is counted. `minOut`, and eco-swap's `amountIn`, may be
// values the program computes as it runs.
import { allowance, approve, balanceOf, TokenOf } from "@sauce/token";

// KyberSwap's aggregator. The route is its router's `swap(...)` calldata, built for this Pot, which
// pays and receives, cut where its floor (`minReturnAmount`) sits: the program's `minOut` goes
// there, so the router and the program refuse the same short fill. The router is approved for
// exactly `amountIn`, which the calldata swaps, and whatever approval it leaves is reset to zero, so
// a router that took less keeps no allowance. Native input is not supported: the call carries no
// value.
export const kyberSwap = (tokenIn, tokenOut, amountIn, minOut) => {
  const from = tokenIn instanceof TokenOf ? tokenIn.address : tokenIn;
  const to = tokenOut instanceof TokenOf ? tokenOut.address : tokenOut;
  const route = { swap: "kyber", chainId, tokenIn: from, tokenOut: to, amountIn };
  const router = globalIn(route, "__sauce_swap_router");
  const head = globalIn(route, "__sauce_swap_head");
  const tail = globalIn(route, "__sauce_swap_tail");
  const self = ctx.self();
  const before = balanceOf(to, self);
  approve(from, router, amountIn);
  evm.call(router, 0, head.concat(minOut.toBytesBe(32)).concat(tail));
  if (allowance(from, self, router) > 0) {
    approve(from, router, 0);
  }
  const out = balanceOf(to, self) - before;
  require(out >= minOut, "kyberSwap: below minOut");
  return out;
};

// An eco-swap program, run as the Pot: its `main(amountIn, minOut)` swaps exactly `amountIn` of
// `tokenIn` already in the Pot and leaves the output there. It is a route for any amount, so the
// amount may be one the program computes. `eval` would run it read-only, so it is delegated into the
// engine the Pot is running — the one the Pot answers to `inFlightEngine()` — as a `try` block is,
// with its two arguments appended as words. What it delivered is measured here, not taken from what
// it returns, and it may spend no more than `amountIn` of `tokenIn`.
export const ecoSwap = (tokenIn, tokenOut, amountIn, minOut) => {
  const from = tokenIn instanceof TokenOf ? tokenIn.address : tokenIn;
  const to = tokenOut instanceof TokenOf ? tokenOut.address : tokenOut;
  const program = globalIn(
    { swap: "eco", chainId, tokenIn: from, tokenOut: to },
    "__sauce_swap_program",
  );
  const self = ctx.self();
  const [engine] = abi.decode(evm.static(self, hex`9fd004e1`), ["Address"]);
  require(ctx.codeSize(engine) > 0, "ecoSwap: no engine in flight");
  const held = balanceOf(from, self);
  const before = balanceOf(to, self);
  evm.delegate(engine, program.concat(amountIn.toBytesBe(32)).concat(minOut.toBytesBe(32)));
  const left = balanceOf(from, self);
  if (left < held) {
    require(held - left <= amountIn, "ecoSwap: spent more than amountIn");
  }
  const out = balanceOf(to, self) - before;
  require(out >= minOut, "ecoSwap: below minOut");
  return out;
};

// Jupiter routes on Solana; a program for an EVM chain swaps through the other two.
export const jupiterSwap = () => {
  throw new Error("jupiterSwap swaps on Solana; on an EVM chain, kyberSwap or ecoSwap");
};
