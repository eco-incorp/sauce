// Every kind of name a program uses without an import. USDC and USDT are the chain's registered
// token symbols; AaveV3.Pool is a registry contract (an address as a value, a bound contract as a
// call target); Token(address) covers any other ERC-20; allowance(...) is a @sauce/token function.
// Every write is SafeERC20, so USDT works and a false return reverts. The addresses and amounts are
// main(...) inputs, passed with the transaction.
//
//   sauce run globals.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <payee> <payer> <otherToken> <usdtAmount> <otherAmount> <usdcAmount>
//
//   payee: Address         who receives the USDT and the other token, and the Aave position
//   payer: Address         whose `otherToken` moves: it approved this Pot for `otherAmount`
//   otherToken: Address    any ERC-20 the chain does not name, such as its WETH
//   usdtAmount: Uint256    USDT from the Pot to `payee`, in its smallest units (6 decimals):
//                          1000000 is 1 USDT
//   otherAmount: Uint256   `otherToken` from `payer` to `payee`, in its smallest units:
//                          1000000000000000 is 0.001 WETH (18 decimals)
//   usdcAmount: Uint256    the Pot's USDC supplied to Aave V3 for `payee`, in its smallest units
//                          (6 decimals): 1000000 is 1 USDC
//
// On Ethereum, 1 USDT, 0.001 WETH from the payer, and 1 USDC supplied to Aave:
//
//   sauce run globals.sauce.ts --chain ethereum \
//     --keystore <keystore> --args <payee> <payer> 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
//     1000000 1000000000000000 1000000
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
  AaveV3.Pool.supply(USDC, usdcAmount, payee, 0);
  require(allowance(USDC, me, AaveV3.Pool) == 0, "an allowance was left standing");
}
