<!-- Generated from the SDK's registries. Do not edit. -->

# CoW Swap (`cowswap`)

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) and protects users from frontrunning.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Cowswap` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [cowswap.md](../cowswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cowswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gpv2Settlement, `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`.
  require(Cowswap.GPv2Settlement != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |

## ABI

### `GPv2SettlementABI`

`import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";` Speaks for: gpv2Settlement.

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
