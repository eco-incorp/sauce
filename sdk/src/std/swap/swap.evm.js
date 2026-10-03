// @sauce/swap — EVM arm. Swaps whose route a service builds when the program compiles.
//
// A program writes `kyberSwap(tokenIn, tokenOut, amountIn, minOut)` or `ecoSwap(...)`. Those names
// are the SDK's host's (`routes/swap-host.ts`): it asks the provider for a route while the program
// compiles and lowers each call to one of these functions, with the route's bytes as arguments. They
// can be called directly too, with a route a program is given.
//
// Each returns the amount of `tokenOut` the swap delivered to the Pot, measured as the change in the
// Pot's balance across the call, and reverts below `minOut`. The output stays in the Pot. Neither
// reads or pays out the Pot's whole balance: on an intent's destination the Pot is shared by every
// intent, so only what the swap itself moved is counted.
//
// A word the program may know only as it runs — `minOut`, and `ecoSwap`'s `amountIn` — arrives as 32
// bytes, big-endian: the SDK binds each call's arguments at its call site, where the compiler writes
// a run-time value into bytes, never into a plain argument. Pass `x.toBytesBe(32)` to call these
// directly.
//
// No module-level `const` here: a compile-time define replaces a same-named `const` in every module,
// this one included.
import { allowance, approve, balanceOf } from "@sauce/token";

// KyberSwap's router, called with the calldata its API built for this Pot. `router` is the
// registry's MetaAggregationRouterV2 on the chain, and `data` its `swap(...)`, which sends the output
// to the Pot (the SDK refuses a route that does otherwise). The router is approved for exactly
// `amountIn`, which its calldata swaps, and whatever approval it leaves is reset to zero, so a
// router that took less keeps no allowance. Native input is not supported: the call carries no
// value.
export function kyber(
  router: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  data: bytes,
  minOut: bytes,
): Uint256 {
  require(tokenIn != tokenOut);
  const floor = minOut.toBe();
  const before = balanceOf(tokenOut, ctx.self());
  approve(tokenIn, router, amountIn);
  evm.call(router, 0n, data);
  if (allowance(tokenIn, ctx.self(), router) > 0n) {
    approve(tokenIn, router, 0n);
  }
  const out = balanceOf(tokenOut, ctx.self()) - before;
  require(out >= floor, "kyberSwap: below minOut");
  return out;
}

// An eco-swap program, evaluated in the Pot: `program`'s `main(amountIn, minOut)` swaps exactly
// `amountIn` of `tokenIn` already in the Pot and leaves the output there. What it delivered is
// measured here, not taken from what it returns, and it may spend no more than `amountIn`.
export function eco(
  program: bytes,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bytes,
  minOut: bytes,
): Uint256 {
  require(tokenIn != tokenOut);
  const amount = amountIn.toBe();
  const floor = minOut.toBe();
  const held = balanceOf(tokenIn, ctx.self());
  const before = balanceOf(tokenOut, ctx.self());
  eval(program, amount, floor);
  const left = balanceOf(tokenIn, ctx.self());
  if (left < held) {
    require(held - left <= amount, "ecoSwap: spent more than amountIn");
  }
  const out = balanceOf(tokenOut, ctx.self()) - before;
  require(out >= floor, "ecoSwap: below minOut");
  return out;
}
