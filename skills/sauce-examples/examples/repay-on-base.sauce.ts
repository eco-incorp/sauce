// Repays an Aave V3 USDC loan on Base with USDC held on Ethereum, and sends the change back to
// Ethereum: two intents, the second opened by the first one's body, each amount measured where it
// exists.
//
// Here, on Ethereum, on the owner's Pot: the Pot's USDC is measured and offered as the reward to a
// solver who delivers it on Base, less `solverBps`. In the braces, on Base, on the shared intent
// Pot: what arrived repays `borrower`'s USDC debt (anyone may repay a debt for its borrower), up to
// what is owed, and what is left is offered to a solver who pays it, less `solverBps`, to
// `borrower` on Ethereum. That change exists only once the Base step has run, so the Base step
// measures it and opens the second intent itself; with none left there is no second intent.
// `borrower` and `solverBps` are this program's parameters, and using them inside the braces is
// enough: their values go into each intent.
//
// `USDC` and `AaveV3.Pool` in the braces are Base's; in each `.reward(...)`, the chain's that pays
// it: Ethereum's for the first, Base's for the second. The variable debt token is read from the
// pool through AaveV3Reads.json beside this file, the reads the registry's Aave V3 ABI does not
// declare.
//
//   sauce run repay-on-base.sauce.ts --chain <chain> --keystore <keystore> \
//     --intent-deadline <unix seconds> --intent-creator <address> --intent-execution-fee auto \
//     --args <borrower> <solverBps>
//
//   borrower: Address                  whose USDC debt on Base is repaid, and who is paid the
//                                      change on Ethereum
//   solverBps: Uint256                 what each solver keeps of what it carries, in hundredths of
//                                      a percent: 10 is 0.1%
//   --intent-deadline: unix seconds    the last second a solver may fill either intent
//   --intent-creator: Address          who may reclaim a reward no solver earns
//   --intent-execution-fee: wei        Base's Kitchen fee for the body's cook; `auto` reads it
//                                      from Base
//
// From Ethereum, a solver keeping 0.1% of each hop:
//
//   sauce run repay-on-base.sauce.ts --chain ethereum --keystore <keystore> \
//     --intent-deadline <unix seconds> --intent-creator <address> --intent-execution-fee auto \
//     --args <borrower> 10
import AaveV3Reads from "./AaveV3Reads.json";

function main(borrower: Address, solverBps: Uint256) {
  require(borrower != 0, "borrower is the zero address");
  require(solverBps < 10000, "solverBps is 100% or more");
  const amount = USDC.balanceOf(ctx.self());
  require(amount > 0, "no USDC in the Pot");
  const delivered = amount - (amount * solverBps) / 10000;

  Base(
    () => {
      // The shared intent Pot holds nothing of anyone's between intents: all of it is this one's.
      const arrived = USDC.balanceOf(ctx.self());
      const debtToken = AaveV3Reads.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
      const owed = Token(debtToken).balanceOf(borrower);
      const repay = arrived < owed ? arrived : owed;
      if (repay > 0) {
        USDC.approve(AaveV3.Pool, repay);
        AaveV3.Pool.repay(USDC, repay, 2, borrower);
      }
      const change = USDC.balanceOf(ctx.self());
      if (change > 0) {
        const paid = change - (change * solverBps) / 10000;
        Ethereum(() => {
          USDC.transfer(borrower, paid); // Ethereum's USDC
        }).reward({ tokens: [{ token: USDC, amount: change }] }); // Base's: it funds this level
      }
    },
    { tokens: [{ token: USDC, amount: delivered }] }, // Base's USDC, which the solver delivers
  ).reward({ tokens: [{ token: USDC, amount }] }); // Ethereum's
}
