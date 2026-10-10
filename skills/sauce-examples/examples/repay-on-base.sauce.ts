// Repays an Aave V3 USDC loan on Base with USDC held on Ethereum, and sends the change back to
// Ethereum: two intents, the second opened by the first one's body, each amount known where it
// exists.
//
// Here, on Ethereum, on the owner's Pot: the Pot's USDC is measured and offered as the reward to a
// solver who delivers it on Base, less `solverBps`. In the braces, on Base, on the intent Pot every
// intent to Base shares: `delivered`, what this intent delivered, repays `borrower`'s USDC debt
// (anyone may repay a debt for its borrower), up to what is owed, and what the repayment did not use
// is offered to a solver who pays it, less `solverBps`, to `borrower` on Ethereum. That change
// exists only once the Base step has run, so the Base step measures what the repayment took and
// opens the second intent itself; with none left there is no second intent. The body never moves
// the shared Pot's whole balance.
// `borrower`, `solverBps` and `refundTo` are this program's parameters, and using them inside the
// braces is enough: their values go into each intent. Each intent names `refundTo` its refundee,
// where its reward goes back if no solver fills it.
//
// `USDC` and `AaveV3.Pool` in the braces are Base's; in each `send`, the chain's that pays it:
// Ethereum's for the first, Base's for the second. The variable debt token is read from the
// pool through AaveV3Reads.json beside this file, the reads the registry's Aave V3 ABI does not
// declare.
//
//   sauce run repay-on-base.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <borrower> <solverBps> <refundTo>
//
//   borrower: Address    whose USDC debt on Base is repaid, and who is paid the change on Ethereum
//   solverBps: Uint256   what each solver keeps of what it carries, in hundredths of a percent:
//                        10 is 0.1%
//   refundTo: Address    who reclaims an unearned reward, on Ethereum for the first intent and on
//                        Base for the second
//
// Each intent takes the other defaults: filled within five minutes of opening, refundable seven
// days after, a random salt, its body's cook paying the Kitchen fee read from Base. From Ethereum,
// a solver keeping 0.1% of each hop:
//
//   sauce run repay-on-base.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <borrower> 10 <refundTo>
import AaveV3Reads from "./AaveV3Reads.json";

function main(borrower: Address, solverBps: Uint256, refundTo: Address) {
  require(borrower != 0, "borrower is the zero address");
  require(solverBps < 10000, "solverBps is 100% or more");
  const amount = USDC.balanceOf(ctx.self());
  require(amount > 0, "no USDC in the Pot");
  const delivered = amount - (amount * solverBps) / 10000;

  Base.hop({
    send: { token: USDC, amount }, // Ethereum's
    receive: { token: USDC, amount: delivered }, // Base's USDC, which the solver delivers
    refundee: refundTo,
  }).then(() => {
    require(AaveV3.Pool);
    // On Base, in the fill.
    // The Pot is shared by every intent to Base: this body moves only `delivered`.
    const debtToken = AaveV3Reads.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
    const owed = Token(debtToken).balanceOf(borrower);
    const repay = delivered < owed ? delivered : owed;
    let used = 0;
    if (repay > 0) {
      const before = USDC.balanceOf(ctx.self());
      USDC.approve(AaveV3.Pool, repay);
      AaveV3.Pool.repay(USDC, repay, 2, borrower);
      used = before - USDC.balanceOf(ctx.self());
    }
    const change = delivered - used;
    if (change > 0) {
      const paid = change - (change * solverBps) / 10000;
      Ethereum.hop({
        send: { token: USDC, amount: change }, // Base's: it funds this level
        receive: { token: USDC, amount: paid }, // Ethereum's
        refundee: refundTo,
      }).then(() => {
        USDC.transfer(borrower, paid); // Ethereum's USDC
      });
    }
  });
}
