// Repays an Aave V3 USDC loan on Base with USDC held on Ethereum, and sends the change back to
// Ethereum: two intents, the second opened by the first one's body, each amount measured where it
// exists. The whole file is the program: top-level statements, no main, and its values defines.
//
// Here, on Ethereum, on the owner's Pot: the Pot's USDC is measured and offered as the reward to a
// solver who delivers it on Base, less SOLVER_BPS. In the braces, on Base, on the shared intent Pot:
// what arrived repays BORROWER's USDC debt (anyone may repay a debt for its borrower), up to what
// is owed, and what is left is offered to a solver who pays it, less SOLVER_BPS, to BORROWER on
// Ethereum. That change exists only once the Base step has run, so the Base step measures it and
// opens the second intent itself; with none left there is no second intent.
//
// `USDC` and `AaveV3.Pool` in the braces are Base's; in each `.reward(...)`, the chain's that pays
// it: Ethereum's for the first, Base's for the second. The variable debt token is read from the
// pool through AaveV3Reads.json beside this file, the reads the registry's Aave V3 ABI does not
// declare.
//
//   sauce run repay-on-base.sauce.ts --chain <chain> --keystore <keystore> \
//     --define BORROWER=<address> --define SOLVER_BPS=<bps> --intent-deadline <unix seconds> \
//     --intent-creator <address> --intent-execution-fee auto
//
//   BORROWER: Address                  whose USDC debt on Base is repaid, and who is paid the
//                                      change on Ethereum
//   SOLVER_BPS: define                 what each solver keeps of what it carries, in hundredths
//                                      of a percent: 10 is 0.1%
//   --intent-deadline: unix seconds    the last second a solver may fill either intent
//   --intent-creator: Address          who may reclaim a reward no solver earns
//   --intent-execution-fee: wei        Base's Kitchen fee for the body's cook; `auto` reads it
//                                      from Base
//
// From Ethereum, a solver keeping 0.1% of each hop:
//
//   sauce run repay-on-base.sauce.ts --chain ethereum --keystore <keystore> \
//     --define BORROWER=<address> --define SOLVER_BPS=10 --intent-deadline <unix seconds> \
//     --intent-creator <address> --intent-execution-fee auto
import AaveV3Reads from "./AaveV3Reads.json";

require(BORROWER != 0n, "set BORROWER");
require(SOLVER_BPS < 10000n, "SOLVER_BPS is 100% or more");
const amount = USDC.balanceOf(ctx.self());
require(amount > 0n, "no USDC in the Pot");
const delivered = amount - (amount * SOLVER_BPS) / 10000n;

Base(
  () => {
    // The shared intent Pot holds nothing of anyone's between intents: all of it is this one's.
    const arrived = USDC.balanceOf(ctx.self());
    const debtToken = AaveV3Reads.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
    const owed = Token(debtToken).balanceOf(BORROWER);
    const repay = arrived < owed ? arrived : owed;
    if (repay > 0n) {
      USDC.approve(AaveV3.Pool, repay);
      AaveV3.Pool.repay(USDC, repay, 2n, BORROWER);
    }
    const change = USDC.balanceOf(ctx.self());
    if (change > 0n) {
      const paid = change - (change * SOLVER_BPS) / 10000n;
      Ethereum(() => {
        USDC.transfer(BORROWER, paid); // Ethereum's USDC
      }).reward({ tokens: [{ token: USDC, amount: change }] }); // Base's: it funds this level
    }
  },
  { tokens: [{ token: USDC, amount: delivered }] }, // Base's USDC, which the solver delivers
).reward({ tokens: [{ token: USDC, amount }] }); // Ethereum's
