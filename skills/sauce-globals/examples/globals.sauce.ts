// Every kind of name a program uses without an import. USDC and USDT are the chain's registered
// token symbols; AaveV3.Pool is a registry contract (an address as a value, a bound contract as a
// call target); Token(address) covers any other ERC-20; allowance(...) is a @sauce/token function.
// Every write is SafeERC20, so USDT works and a false return reverts. The addresses and amounts are
// main(...) inputs, passed with the transaction.
//
//   sauce run globals.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <payee> <payer> <otherToken> <usdtAmount> <otherAmount> <usdcAmount>
function main(
  payee: Address,
  payer: Address,
  otherToken: Address,
  usdtAmount: Uint256,
  otherAmount: Uint256,
  usdcAmount: Uint256,
) {
  const me = ctx.self();

  // Registered symbols, and the Pot's own balance.
  require(USDT.balanceOf(me) >= usdtAmount, "not enough USDT in the Pot");
  USDT.transfer(payee, usdtAmount);

  // Any ERC-20, bound once: move `payer`'s tokens, which it approved to this Pot, to `payee`.
  const other = Token(otherToken);
  other.transferFrom(payer, payee, otherAmount);

  // A protocol call. The approve is exact, so no allowance is left standing afterwards.
  USDC.approve(AaveV3.Pool, usdcAmount);
  AaveV3.Pool.supply(USDC, usdcAmount, payee, 0n);
  require(allowance(USDC, me, AaveV3.Pool) == 0n, "an allowance was left standing");
}
