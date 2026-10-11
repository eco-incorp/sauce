// Ported from: spaceandtimefdn/sxt-chain-examples/contracts/src/HelloWorld/HelloWorld.sol
//
// Space and Time's tutorial: asks the query below and, once the QueryRouter has proven its answer,
// logs `QueryFulfilled(string name)` for each name in it, from the Pot, as the tutorial's contract
// does from itself.
//
//   SELECT NAME FROM TUTORIAL_ABC8D709C80262965344F5240AD123F5CBE51123.HELLO_WORLD WHERE LONGITUDE = 60
//
// What the Pot does differently: it pays the query's SXT from its own balance, and what the
// fulfiller is not paid comes back to it, where the tutorial pulls 100 SXT from its caller and
// refunds the caller; `payment` is an argument, as the routers' base costs differ (100 SXT on Base,
// what the tutorial pays, and 1,000 on Ethereum); the query names the router's latest verifier,
// where the tutorial pins an earlier one's address; the callback may use 300,000 gas, where a Pot's
// callback takes more than the tutorial's 100,000; and a query unanswered within the hour gives its
// SXT back in `.catch`. The callback's checks, the tutorial's `pendingQueries` and
// `UnauthorizedCaller`, are @sauce/zk's: only the router's executor, and only for a query the Pot
// asked.
//
//   sauce run hello-world.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <payment>
//
//   payment: Uint256  what the query pays, in SXT's base units (18 decimals): at least the
//                     router's base cost, and on Ethereum the callback's gas too
//
// On Base, paying the tutorial's 100 SXT:
//
//   sauce run hello-world.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args 100000000000000000000
import { Zk } from "@sauce/zk";

// The query's proof plan, as Space and Time's RPC method `commitments_v1_evmProofPlan` gives it.
const QUERY_PLAN = hex`0000000000000001000000000000003d5455544f5249414c5f414243384437303943383032363239363533343446353234304144313233463543424535313132332e48454c4c4f5f574f524c440000000000000002000000000000000000000000000000044e414d4500000007000000000000000000000000000000094c4f4e47495455444500000005000000000000000100000000000000044e414d45000000000000000000000000000000020000000000000000000000010000000100000005000000000000003c0000000000000001000000000000000000000000`;

function main(payment: Uint256): void {
  Zk.sql({ query: QUERY_PLAN, payment, gasLimit: 300000, maxGasPrice: 10 * 10 ** 9 })
    .then((result) => {
      const names = Zk.rows(result);
      for (let i = 0; i < names; i += 1) {
        log(abi.encode(Zk.text(result, 0, i)), crypto.keccak256("QueryFulfilled(string)"));
      }
    })
    .catch((e) => {
      Zk.cancel(e);
    });
}
