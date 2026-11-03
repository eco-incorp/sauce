<!-- Generated from the SDK's registries. Do not edit. -->

# Pyth Network (`pyth`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Pyth Network is a price oracle: it publishes prices on chain for programs to read. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Oracle network providing price feeds from institutional sources. Uses a pull-based model for on-chain price updates.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Pyth` on ethereum |
| Chains | ethereum |

## What it offers

- **getPrice**: Read price from Pyth oracle by price feed ID

## Notes

- Pull-based oracle: users must call updatePriceFeeds before reading prices
- Sub-second latency from institutional market data providers
- Actual price = price * 10^expo (e.g. price=12345, expo=-2 means $123.45)
- Price feed IDs are bytes32 - see Pyth docs for specific feed IDs per asset
- updatePriceFeeds requires sending ETH to pay the update fee (use getUpdateFee to check)
- Get price update data from Pyth Hermes API off-chain, then submit on-chain

## Its names in a program

On Ethereum, `Pyth` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's oracle, `0x4305FB66699C3B2702D4d05CF36551390A4c69C6`.
  require(Pyth.Oracle != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | oracle | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` | `Pyth.Oracle` |

## ABI

### `PythOracleABI`

`import PythOracleABI from "./protocols/pyth/PythOracleABI.json";` Speaks for: oracle. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Pyth` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `chainId() view returns (uint16)`
- `executeGovernanceInstruction(bytes encodedVM)`
- `getEmaPrice(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getEmaPriceNoOlderThan(bytes32 id, uint256 age) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getEmaPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getPrice(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getPriceNoOlderThan(bytes32 id, uint256 age) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime) price)`
- `getTwapUpdateFee(bytes[] updateData) view returns (uint256 feeAmount)`
- `getUpdateFee(bytes[] updateData) view returns (uint256 feeAmount)`
- `getValidTimePeriod() view returns (uint256)`
- `governanceDataSource() view returns ((uint16 chainId, bytes32 emitterAddress))`
- `governanceDataSourceIndex() view returns (uint32)`
- `hashDataSource((uint16 chainId, bytes32 emitterAddress) ds) pure returns (bytes32)`
- `initialize(address wormhole, uint16[] dataSourceEmitterChainIds, bytes32[] dataSourceEmitterAddresses, uint16 governanceEmitterChainId, bytes32 governanceEmitterAddress, uint64 governanceInitialSequence, uint256 validTimePeriodSeconds, uint256 singleUpdateFeeInWei)`
- `isValidDataSource(uint16 dataSourceChainId, bytes32 dataSourceEmitterAddress) view returns (bool)`
- `isValidGovernanceDataSource(uint16 governanceChainId, bytes32 governanceEmitterAddress) view returns (bool)`
- `lastExecutedGovernanceSequence() view returns (uint64)`
- `latestPriceInfoPublishTime(bytes32 priceId) view returns (uint64)`
- `owner() view returns (address)`
- `parseAuthorizeGovernanceDataSourceTransferPayload(bytes encodedPayload) pure returns ((bytes claimVaa) sgds)`
- `parseGovernanceInstruction(bytes encodedInstruction) pure returns ((uint8 module, uint8 action, uint16 targetChainId, bytes payload) gi)`
- `parsePriceFeedUpdates(bytes[] updateData, bytes32[] priceIds, uint64 minPublishTime, uint64 maxPublishTime) payable returns ((bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice)[] priceFeeds)`
- `parsePriceFeedUpdatesUnique(bytes[] updateData, bytes32[] priceIds, uint64 minPublishTime, uint64 maxPublishTime) payable returns ((bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice)[] priceFeeds)`
- `parsePriceFeedUpdatesWithConfig(bytes[] updateData, bytes32[] priceIds, uint64 minAllowedPublishTime, uint64 maxAllowedPublishTime, bool checkUniqueness, bool checkUpdateDataIsMinimal, bool storeUpdatesIfFresh) payable returns ((bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice)[] priceFeeds, uint64[] slots)`
- `parseRequestGovernanceDataSourceTransferPayload(bytes encodedPayload) pure returns ((uint32 governanceDataSourceIndex) sgdsClaim)`
- `parseSetDataSourcesPayload(bytes encodedPayload) pure returns (((uint16 chainId, bytes32 emitterAddress)[] dataSources) sds)`
- `parseSetFeePayload(bytes encodedPayload) pure returns ((uint256 newFee) sf)`
- `parseSetTransactionFeePayload(bytes encodedPayload) pure returns ((uint256 newFee) stf)`
- `parseSetValidPeriodPayload(bytes encodedPayload) pure returns ((uint256 newValidPeriod) svp)`
- `parseSetWormholeAddressPayload(bytes encodedPayload) pure returns ((address newWormholeAddress) sw)`
- `parseTwapPriceFeedUpdates(bytes[] updateData, bytes32[] priceIds) payable returns ((bytes32 id, uint64 startTime, uint64 endTime, (int64 price, uint64 conf, int32 expo, uint256 publishTime) twap, uint32 downSlotsRatio)[] twapPriceFeeds)`
- `parseUpgradeContractPayload(bytes encodedPayload) pure returns ((address newImplementation) uc)`
- `parseWithdrawFeePayload(bytes encodedPayload) pure returns ((address targetAddress, uint256 fee) wf)`
- `priceFeedExists(bytes32 id) view returns (bool)`
- `proxiableUUID() view returns (bytes32)`
- `pythUpgradableMagic() pure returns (uint32)`
- `queryPriceFeed(bytes32 id) view returns ((bytes32 id, (int64 price, uint64 conf, int32 expo, uint256 publishTime) price, (int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice) priceFeed)`
- `renounceOwnership()`
- `singleUpdateFeeInWei() view returns (uint256)`
- `transactionFeeInWei() view returns (uint256)`
- `transferOwnership(address newOwner)`
- `updatePriceFeeds(bytes[] updateData) payable`
- `updatePriceFeedsIfNecessary(bytes[] updateData, bytes32[] priceIds, uint64[] publishTimes) payable`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `validDataSources() view returns ((uint16 chainId, bytes32 emitterAddress)[])`
- `validTimePeriodSeconds() view returns (uint256)`
- `version() pure returns (string)`
- `wormhole() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `error InsufficientFee` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTwapUpdateData` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTwapUpdateDataSet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidUpdateData` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidWormholeAddressToSet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NoFreshUpdate` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PriceFeedNotFound` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StalePrice` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event TwapPriceFeedUpdate` taking `(bytes32,uint64,uint64,int64,uint64,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `getUpdateFee` taking `(uint256)`: an overload of getUpdateFee(bytes[]), which takes as many arguments: a call picks its overload by argument count.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
