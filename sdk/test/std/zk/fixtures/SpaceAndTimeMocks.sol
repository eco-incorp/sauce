// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// What `@sauce/zk`'s suite stands in for beside Space and Time's own contracts, which it deploys as
// they were deployed (their creation transactions, replayed).
//
// A local suite cannot prove a query: the QueryRouter's "latest" verifier checks a Proof of SQL
// against table commitments Space and Time's validators sign. `PoSQLVerifierMock` takes any proof
// and answers it as the result, so the suite's fulfiller hands the router the table it wants proven,
// and everything the QueryRouter and CallbackExecutor do with it runs as deployed.
//
// Ethereum's CallbackExecutor prices the callback's gas through Chainlink's ETH/USD and SXT/USD
// feeds; `AggregatorMock`, at each feed's address, answers a price the suite writes at slot 0, as of
// the current block.
//
// Compiled by `solc 0.8.36 --optimize --combined-json abi,bin` into `SpaceAndTimeMocks.json` beside
// this file.

struct Query {
    bytes32 version;
    bytes innerQuery;
    bytes parameters;
    bytes metadata;
}

contract PoSQLVerifierMock {
    function verify(Query calldata, bytes calldata proof) external pure returns (bytes memory) {
        return proof;
    }
}

contract AggregatorMock {
    int256 public answer;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
