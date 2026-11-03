<!-- Generated from the SDK's registries. Do not edit. -->

# Vertex (`vertex`)

Vertically integrated DEX combining spot, perpetuals, and money markets with an off-chain sequencer for fast order matching on Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `Vertex` on arbitrum |
| Chains | arbitrum |
| Document | [vertex.md](../vertex.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Vertex` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's clearinghouse, `0x773BB71B0108b060b76746422eE810Bfec9A963d`.
  require(Vertex.Clearinghouse != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | clearinghouse | `0x773BB71B0108b060b76746422eE810Bfec9A963d` | `Vertex.Clearinghouse` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | endpoint | `0x73EAB16c88B9f38d3f2661C9e5875Ec0eEEE2965` | `Vertex.Endpoint` |

## ABI

### `ClearinghouseABI`

`import ClearinghouseABI from "./protocols/vertex/ClearinghouseABI.json";` Speaks for: clearinghouse. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Vertex` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `_isAboveInitial(bytes32 subaccount) view returns (bool)`
- `_isUnderInitial(bytes32 subaccount) view returns (bool)`
- `addEngine(address engine, uint8 engineType)`
- `burnLp((bytes32 sender, uint32 productId, uint128 amount, uint64 nonce) txn)`
- `claimSequencerFees((bytes32 subaccount) txn, int128[] fees)`
- `depositCollateral((bytes32 sender, uint32 productId, uint128 amount) txn)`
- `depositInsurance((uint128 amount) txn)`
- `getEndpoint() view returns (address)`
- `getEngineByProduct(uint32 productId) view returns (address)`
- `getEngineByType(uint8 engineType) view returns (address)`
- `getHealth(bytes32 subaccount, uint8 healthType) view returns (int128 health)`
- `getInsurance() view returns (int128)`
- `getMaxHealthGroup() view returns (uint32)`
- `getNumProducts() view returns (uint32)`
- `getOraclePricesX18(uint32 healthGroup) view returns ((int128 spotPriceX18, int128 perpPriceX18))`
- `getOraclePriceX18(uint32 productId) view returns (int128)`
- `getOrderbook(uint32 productId) view returns (address)`
- `getQuote() view returns (address)`
- `getRisk(uint32 productId) view returns ((int128 longWeightInitialX18, int128 shortWeightInitialX18, int128 longWeightMaintenanceX18, int128 shortWeightMaintenanceX18, int128 largePositionPenaltyX18))`
- `getSupportedEngines() view returns (uint8[])`
- `getVersion() pure returns (uint64)`
- `initialize(address _endpoint, address _quote, address _fees, address _clearinghouseLiq)`
- `insurance() view returns (int128)`
- `liquidateSubaccount((bytes32 sender, bytes32 liquidatee, uint8 mode, uint32 healthGroup, int128 amount, uint64 nonce) txn)`
- `mintLp((bytes32 sender, uint32 productId, uint128 amountBase, uint128 quoteAmountLow, uint128 quoteAmountHigh, uint64 nonce) txn)`
- `modifyProductConfig(uint32 productId, (int32 longWeightInitial, int32 shortWeightInitial, int32 longWeightMaintenance, int32 shortWeightMaintenance, int32 largePositionPenalty) riskStore)`
- `owner() view returns (address)`
- `rebate((bytes32[] subaccounts, int128[] amounts) txn)`
- `registerProductForId(address book, (int32 longWeightInitial, int32 shortWeightInitial, int32 longWeightMaintenance, int32 shortWeightMaintenance, int32 largePositionPenalty) riskStore, uint32 healthGroup) returns (uint32 productId)`
- `renounceOwnership()`
- `setEndpoint(address _endpoint)`
- `settlePnl((bytes32[] subaccounts, uint256[] productIds) txn)`
- `transferOwnership(address newOwner)`
- `updateFeeRates((address user, uint32 productId, int64 makerRateX18, int64 takerRateX18) txn)`
- `upgradeClearinghouseLiq(address _clearinghouseLiq)`
- `withdrawCollateral((bytes32 sender, uint32 productId, uint128 amount, uint64 nonce) txn)`

Left out of this ABI, though its deployments declare them:

- `error PRBMathSD59x18__SqrtNegativeInput` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Liquidation` taking `(bytes32,bytes32,uint8,uint32,int128,int128,int128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `EndpointABI`

`import EndpointABI from "./protocols/vertex/EndpointABI.json";` Speaks for: endpoint. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Vertex` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `clearinghouse() view returns (address)`
- `depositCollateral(bytes12 subaccountName, uint32 productId, uint128 amount)`
- `executeSlowModeTransactions(uint32 count)`
- `getBook(uint32 productId) view returns (address)`
- `getLinkedSigner(bytes32 subaccount) view returns (address)`
- `getNonce(address sender) view returns (uint64)`
- `getNumSubaccounts() view returns (uint64)`
- `getPricesX18(uint32 healthGroup) view returns ((int128 spotPriceX18, int128 perpPriceX18))`
- `getPriceX18(uint32 productId) view returns (int128 priceX18)`
- `getSequencer() view returns (address)`
- `getSubaccountById(uint64 subaccountId) view returns (bytes32)`
- `getSubaccountId(bytes32 subaccount) view returns (uint64)`
- `getTime() view returns (uint128)`
- `getVersion() pure returns (uint64)`
- `initialize(address _sanctions, address _sequencer, address _clearinghouse, uint64 slowModeTimeout, uint128 _time, int128[] _prices)`
- `nSubmissions() view returns (uint64)`
- `owner() view returns (address)`
- `processSlowModeTransaction(address sender, bytes transaction)`
- `renounceOwnership()`
- `requireSubaccount(bytes32 subaccount) view`
- `sequencerFee(uint32) view returns (int128)`
- `sequencerFees() view returns (int128)`
- `setBook(uint32 productId, address book)`
- `setSequencer(address _sequencer)`
- `slowModeConfig() view returns (uint64 timeout, uint64 txCount, uint64 txUpTo)`
- `slowModeFees() view returns (int128)`
- `slowModeTxs(uint64) view returns (uint64 executableAt, address sender, bytes tx)`
- `submitSlowModeTransaction(bytes transaction)`
- `submitTransactions(bytes[] transactions)`
- `submitTransactionsChecked(uint64 idx, bytes[] transactions)`
- `submitTransactionsCheckedWithGasLimit(uint64 idx, bytes[] transactions, uint256 gasLimit) returns (uint64, uint256)`
- `transferOwnership(address newOwner)`
