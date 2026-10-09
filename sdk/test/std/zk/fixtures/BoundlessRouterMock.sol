// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// What `@sauce/zk`'s Boundless suite stands in for beside the market, which runs as deployed: the
// market's router, `verifyBatch(FulfillmentBatch, bytes32[])`, which on Base checks each fill's seal
// and the assessor's proof that the fills meet their requests' predicates. A local suite cannot make
// either proof, so this answers every batch as verified, at the router's address, and everything
// the market does around it — binding each fill to its locked request, paying the prover, the
// callback and its gas — runs as deployed.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin-runtime` into
// `BoundlessRouterMock.json` beside this file.
contract BoundlessRouterMock {
    fallback() external {}
}
