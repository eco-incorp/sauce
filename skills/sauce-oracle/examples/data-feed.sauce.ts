// Ported from: smartcontractkit/documentation, public/samples/DataFeeds/DataConsumerV3.sol (at
// 5dbdbb0f), Chainlink Data Feeds' DataConsumerV3: the latest answer of a price feed.
//
// Returns the latest answer of the chain's ETH / USD feed, with the feed's 8 decimals:
// 269000000000 is 2,690 USD. The contract is deployed with its feed's address written into it; a
// program names the feed the chain's registry records, `Chainlink.EthUsdFeed`, and needs no
// deployment. It writes nothing: run it with `sauce simulate`. A feed is a read, answered in the
// same transaction; an answer computed off chain is a CRE workflow's (`Oracle.cre`).
//
//   sauce simulate data-feed.sauce.ts --chain <chain> --owner <address>
//
// On Ethereum:
//
//   sauce simulate data-feed.sauce.ts --chain ethereum --owner <address>
//
// The contract is 50 lines of Solidity, 17 of them code; this program is 3.
function main(): Uint256 {
  return Chainlink.EthUsdFeed.latestRoundData().answer;
}
