<!-- Generated from the SDK's registries. Do not edit. -->

# Space and Time (`space-and-time`)

ZK-proven SQL over indexed chain data: a contract asks the QueryRouter a query, pays in SXT, and Space and Time's fulfiller answers it with a Proof of SQL that the router verifies against table commitments Space and Time's validators sign, then calls the requester back with the result through the CallbackExecutor.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `SpaceAndTime` on ethereum, base |
| Chains | ethereum, base |
| Document | [space-and-time.md](../space-and-time.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `SpaceAndTime` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's callbackExecutor, `0xaCf075862425A0c839844369ac20e334B3710e47`.
  require(SpaceAndTime.CallbackExecutor != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | callbackExecutor | `0xaCf075862425A0c839844369ac20e334B3710e47` | `SpaceAndTime.CallbackExecutor` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | queryRouter | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` | `SpaceAndTime.QueryRouter` |
| [Base](../../../sauce-chains/references/base.md) | callbackExecutor | `0xaCf075862425A0c839844369ac20e334B3710e47` | `SpaceAndTime.CallbackExecutor` |
| [Base](../../../sauce-chains/references/base.md) | queryRouter | `0x220a7036a815a1Bd4A7998fb2BCE608581fA2DbB` | `SpaceAndTime.QueryRouter` |

## ABI

### `CallbackExecutorABI`

`import CallbackExecutorABI from "./protocols/space-and-time/CallbackExecutorABI.json";` Speaks for: callbackExecutor.

- `maxGasLimit() view returns (uint256)`
- `gasCostConfig() view returns (address nativeUsdFeed, uint64 nativeStaleThreshold, address tokenUsdFeed, uint64 tokenStaleThreshold, uint256 scalingFactor)`

### `QueryRouterABI`

`import QueryRouterABI from "./protocols/space-and-time/QueryRouterABI.json";` Speaks for: queryRouter.

- `requestQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, (uint256 maxGasPrice, uint64 gasLimit, address callbackContract, bytes4 selector, bytes callbackData) callback, (uint256 paymentAmount, address refundTo, uint64 timeout) payment) returns (bytes32 queryId)`
- `cancelQuery(bytes32 queryId, (uint256 paymentAmount, address refundTo, uint64 timeout) payment)`
- `fulfillQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, (uint256 maxGasPrice, uint64 gasLimit, address callbackContract, bytes4 selector, bytes callbackData) callback, (uint256 paymentAmount, address refundTo, uint64 timeout) payment, uint64 queryNonce, bytes proof)`
- `verifyQuery((bytes32 version, bytes innerQuery, bytes parameters, bytes metadata) query, bytes proof) view returns (bytes result)`
- `baseCost() view returns (uint256)`
- `PAYMENT_TOKEN() view returns (address)`
- `EXECUTOR() view returns (address)`
- `versions(bytes32 versionHash) view returns (address verifier)`
- `pendingPayments(bytes32 queryId) view returns (bytes32 paymentHash)`
- `openFulfillment() view returns (bool)`
