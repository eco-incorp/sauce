// Forwards the USDC this Pot holds to Ethereum, where a solver supplies it to Aave V3 for
// `beneficiary`. The amount is only known when this runs, so the file runs on the owner's Pot
// (sauce run) and opens the intent as it goes.
//
// `--chain` is the source chain, which funds the reward: `USDC` in `.reward(...)` is its USDC.
// Inside the braces, and in the delivery argument after them, the code runs on Ethereum: `USDC` and
// `AaveV3.Pool` there are Ethereum's. The gap between what is delivered and the reward is the
// solver's margin.
//
//   sauce run cross-chain.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee <Ethereum Kitchen fee in wei> --args <beneficiary>
//
//   beneficiary: Address               who the Aave V3 position on Ethereum is supplied for
//   --intent-deadline: unix seconds    the last second a solver may fill it
//   --intent-creator: Address          who may reclaim the reward if no solver earns it
//   --intent-execution-fee: wei        Ethereum's Kitchen fee for the body's cook; `auto` reads it
//                                      through --config
//
// From Base, with the fee read from Ethereum:
//
//   sauce run cross-chain.sauce.ts --chain base --config sauce.config.json \
//     --keystore <keystore> --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee auto --args <beneficiary>
function main(beneficiary: Address) {
  require(beneficiary != 0n, "give the beneficiary");
  const amount = USDC.balanceOf(ctx.self());
  require(amount > 0n, "nothing to forward");
  const delivered = amount - (amount * 10n) / 10000n; // the solver keeps 0.1%

  Ethereum(
    () => {
      USDC.approve(AaveV3.Pool, delivered);
      AaveV3.Pool.supply(USDC, delivered, beneficiary, 0n);
    },
    { tokens: [{ token: USDC, amount: delivered }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
