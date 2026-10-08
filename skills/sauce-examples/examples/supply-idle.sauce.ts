// Keeps `reserve` USDC liquid in the Pot and the rest earning in Aave V3, to run on a schedule:
// supplies what the Pot holds above `reserve`, and when it holds less, withdraws the shortfall
// from the Pot's Aave position, as much as there is. A move smaller than `minMove` is not worth
// its gas and is skipped. The aToken's address is read from the pool, through the reads the
// registry's Aave V3 ABI does not declare, in AaveV3Reads.json beside this file. Returns what it
// supplied or withdrew, and the USDC liquid and supplied after.
// The Aave position is the Pot's on purpose (supplied for the Pot): a later run withdraws from it,
// which it could not if the aTokens were in the wallet.
//
//   sauce run supply-idle.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <reserve> <minMove>
//
//   reserve: Uint256  the USDC to keep liquid in the Pot, in its base units (6 decimals):
//                     500000000 is 500 USDC
//   minMove: Uint256  the smallest supply or withdrawal worth making, in the same units:
//                     50000000 is 50 USDC
//
// On Ethereum, keep 500 USDC liquid and move nothing under 50:
//
//   sauce run supply-idle.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 500000000 50000000
import AaveV3Reads from "./AaveV3Reads.json";

function main(
  reserve: Uint256,
  minMove: Uint256,
): { supplied: Uint256; withdrawn: Uint256; liquid: Uint256; deposited: Uint256 } {
  const self = ctx.self();
  const aToken = AaveV3Reads.at(AaveV3.Pool).getReserveAToken(USDC);
  require(aToken != 0, "USDC is not listed on this Aave V3 pool");
  const liquid = USDC.balanceOf(self);
  const deposited = Token(aToken).balanceOf(self); // the Pot's supplied USDC, interest included

  let supplied: Uint256 = 0;
  let withdrawn: Uint256 = 0;
  if (liquid > reserve && liquid - reserve >= minMove) {
    supplied = liquid - reserve;
    USDC.approve(AaveV3.Pool, supplied);
    AaveV3.Pool.supply(USDC, supplied, self, 0);
  } else if (liquid < reserve) {
    const shortfall = reserve - liquid;
    const wanted = shortfall < deposited ? shortfall : deposited;
    if (wanted > 0 && wanted >= minMove) {
      withdrawn = AaveV3.Pool.withdraw(USDC, wanted, self);
    }
  }
  return {
    supplied,
    withdrawn,
    liquid: USDC.balanceOf(self),
    deposited: Token(aToken).balanceOf(self),
  };
}
