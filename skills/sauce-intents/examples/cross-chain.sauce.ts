// Forwards the USDC this Pot holds to Arbitrum, where a solver supplies it to Aave V3 for
// BENEFICIARY. The amount is only known when this runs, so the file runs on the owner's Pot (sauce
// run) and opens the intent as it goes. The whole file is the program: top-level statements, no
// main, and BENEFICIARY a define.
//
// `--chain` is the source chain, which funds the reward: `USDC` in `.reward(...)` is its USDC.
// Inside the braces the body runs on Arbitrum: `AaveV3.Pool` is Arbitrum's pool, and Arbitrum's
// USDC is named by its address there (the tokens index lists it), which the body, the delivery and
// the approve all use. The gap between what is delivered and the reward is the solver's margin.
//
//   sauce run cross-chain.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --define BENEFICIARY=<address> --intent-deadline <unix seconds> \
//     --intent-creator <address> --intent-execution-fee <Arbitrum Kitchen fee in wei>
require(BENEFICIARY != 0n, "set BENEFICIARY");
const amount = USDC.balanceOf(ctx.self());
require(amount > 0n, "nothing to forward");
const delivered = amount - (amount * 10n) / 10000n; // the solver keeps 0.1%

Arbitrum(
  () => {
    Token(0xaf88d065e77c8cc2239327c5edb3a432268e5831n).approve(AaveV3.Pool, delivered);
    AaveV3.Pool.supply(0xaf88d065e77c8cc2239327c5edb3a432268e5831n, delivered, BENEFICIARY, 0n);
  },
  { tokens: [{ token: 0xaf88d065e77c8cc2239327c5edb3a432268e5831n, amount: delivered }] }
).reward({ tokens: [{ token: USDC, amount }] });
