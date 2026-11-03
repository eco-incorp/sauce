<!-- Generated from the SDK's registries. Do not edit. -->

# CoW Swap (`cowswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> CoW Swap is an exchange aggregator: it routes a swap across many exchanges. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

DEX aggregator using batch auctions and Coincidence of Wants (CoW) to match overlapping orders.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Cowswap` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## What it offers

- **preSignOrder**: Pre-sign an order on-chain for execution by solvers
- **invalidateOrder**: Cancel/invalidate a pending order

## Notes

- Batch auctions match Coincidence of Wants (overlapping orders) first
- Orders are typically signed off-chain and submitted to CoW Protocol API
- setPreSignature is for smart contracts/multisigs that cannot produce ECDSA signatures
- orderUid encodes: order hash + owner address + validTo timestamp
- Same settlement contract on both Ethereum and Arbitrum
- Approve tokens to the GPv2VaultRelayer (not settlement contract) before trading

## Its names in a program

On Ethereum, `Cowswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gpv2Settlement, `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`.
  require(Cowswap.GPv2Settlement != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [Arbitrum One](../chains/arbitrum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |

## ABI

### `GPv2SettlementABI`

`import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";` Speaks for: gpv2Settlement. The import is the contract's full ABI across every deployment; call it through the `Cowswap` namespace to have a function a chain's deployment does not run refused.

- `authenticator() view returns (address)`
- `domainSeparator() view returns (bytes32)`
- `filledAmount(bytes) view returns (uint256)`
- `freeFilledAmountStorage(bytes[] orderUids)`
- `freePreSignatureStorage(bytes[] orderUids)`
- `getStorageAt(uint256 offset, uint256 length) view returns (bytes)`
- `invalidateOrder(bytes orderUid)`
- `preSignature(bytes) view returns (uint256)`
- `setPreSignature(bytes orderUid, bool signed)`
- `settle(address[] tokens, uint256[] clearingPrices, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature)[] trades, (address target, uint256 value, bytes callData)[][3] interactions)`
- `simulateDelegatecall(address targetContract, bytes calldataPayload) returns (bytes response)`
- `simulateDelegatecallInternal(address targetContract, bytes calldataPayload) returns (bytes response)`
- `swap((bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] tokens, (uint256 sellTokenIndex, uint256 buyTokenIndex, address receiver, uint256 sellAmount, uint256 buyAmount, uint32 validTo, bytes32 appData, uint256 feeAmount, uint256 flags, uint256 executedAmount, bytes signature) trade)`
- `vault() view returns (address)`
- `vaultRelayer() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
