// Ported from: boundless-xyz/boundless/examples/counter-with-callback/contracts/src/Counter.sol,
// with the request its app makes, apps/src/main.rs
//
// Boundless's callback example: asks the market to prove that its echo guest ran on the time now,
// with the Pot as the request's callback, and counts each proof the market calls back with, as
// `Counter._handleProof` does. The guest is Boundless's `echo` as published: it commits its stdin,
// so the request asks for exactly that journal, as the example's app does.
//
// What the Pot does differently: the callback's checks, `BoundlessMarketCallback`'s (the caller is
// the market, the image and the seal), are the market's and @sauce/zk's, and a proof counts once
// because its promise settles once, where the example keeps a `verified` table; the count is kept in
// the Pot's storage at `keccak256("Counter.count")`; the body is handed the journal and not the seal,
// so it logs no `CounterCallbackCalled`; the callback may use 300,000 gas, where a Pot's callback
// takes more than the example's 100,000; and a request no prover fulfils by its deadline gives its
// price back in `.catch`. The request pays at most `maxPrice` wei, which the Pot deposits, and asks
// the prover that takes it to lock 15 ZKC as collateral. Base only.
//
//   sauce run counter.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <imageId> <imageUrl> <maxPrice>
//
//   imageId: Uint256  the echo guest's image id
//   imageUrl: bytes  where provers download the guest, its UTF-8 bytes
//   maxPrice: Uint256  the most the proof is paid, in wei
//
// On Base, paying at most 0.001 ETH:
//
//   sauce run counter.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args <imageId> <imageUrl> 1000000000000000
import { Zk } from "@sauce/zk";

function main(imageId: Uint256, imageUrl: bytes, maxPrice: Uint256): void {
  const message = abi.encode(ctx.timestamp());
  Zk.risc0({
    imageId,
    imageUrl,
    input: message,
    journal: message,
    offer: {
      maxPrice,
      rampUpPeriod: 60,
      lockTimeout: 900,
      timeout: 1800,
      lockCollateral: 15000000000000000000,
    },
    gasLimit: 300000,
  })
    .then((journal) => {
      const count = crypto.keccak256("Counter.count");
      evm.sstore(count, evm.sload(count) + 1);
    })
    .catch((e) => {
      Zk.reclaim(e);
    });
}
