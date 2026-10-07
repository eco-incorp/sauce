// Forwards the USDC this Pot holds to Ethereum, where a solver supplies it to Aave V3 for
// `beneficiary`. The amount is only known when this runs, so the file runs on the owner's Pot
// (sauce run) and opens the intent as it goes.
//
// `--chain` is the source chain, which funds the reward: `USDC` in `reward` is its USDC. In
// `receive` and inside the body, the code runs on Ethereum: `USDC` and `AaveV3.Pool` there are
// Ethereum's. The gap between what is delivered and the reward is the solver's margin. The intent
// names its refundee, `refundTo`, where its reward goes back if no solver fills it; the deadlines,
// the salt and Ethereum's Kitchen fee take their defaults.
//
//   sauce run cross-chain.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <beneficiary> <refundTo>
//
//   beneficiary: Address   who the Aave V3 position on Ethereum is supplied for
//   refundTo: Address      who reclaims the reward on the source chain if no solver earns it
//
// From Base:
//
//   sauce run cross-chain.sauce.ts --chain base --keystore <keystore> \
//     --args <beneficiary> <refundTo>
function main(beneficiary: Address, refundTo: Address) {
  require(beneficiary != 0, "give the beneficiary");
  require(refundTo != 0, "give refundTo");
  const amount = USDC.balanceOf(ctx.self());
  require(amount > 0, "nothing to forward");
  const delivered = amount - (amount * 10) / 10000; // the solver keeps 0.1%

  await Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  });
  // On Ethereum.
  USDC.approve(AaveV3.Pool, delivered);
  AaveV3.Pool.supply(USDC, delivered, beneficiary, 0);
}
