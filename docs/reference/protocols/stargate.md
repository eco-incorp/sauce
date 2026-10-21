<!-- Generated from the SDK's registries. Do not edit. -->

# Stargate (`stargate`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Stargate is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Omnichain liquidity transport protocol built on LayerZero. Provides native asset bridging with unified liquidity pools.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Stargate` on ethereum, base, arbitrum |
| Chains | ethereum, base, arbitrum |

## Notes

- Uses LayerZero endpoint IDs (dstEid) for destination chains, NOT EVM chain IDs
- Each token has its own pool contract (poolNative for ETH, poolUSDC for USDC, etc.)
- Native token fees required for LayerZero messaging -- sent as msg.value
- Unified liquidity pools across chains -- no wrapped tokens, receives native assets
- Finality depends on LayerZero verification (typically 1-5 minutes)
- Use `quoteOFT` to get fee estimates before sending
- TVL: $400M+. Audited

## Its names in a program

On Ethereum, `Stargate` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's poolNative, `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931`.
  require(Stargate.PoolNative != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | poolNative | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` | `Stargate.PoolNative` |
| [Ethereum](../chains/ethereum.md) | poolUSDC | `0xc026395860Db2d07ee33e05fE50ed7bD583189C7` | `Stargate.PoolUSDC` |
| [Ethereum](../chains/ethereum.md) | poolUSDT | `0x933597a323Eb81cAe705C5bC29985172fd5A3973` | `Stargate.PoolUSDT` |
| [Base](../chains/base.md) | poolNative | `0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7` | `Stargate.PoolNative` |
| [Base](../chains/base.md) | poolUSDC | `0x27a16dc786820B16E5c9028b75B99F6f604b5d26` | `Stargate.PoolUSDC` |
| [Arbitrum One](../chains/arbitrum.md) | poolNative | `0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F` | `Stargate.PoolNative` |
| [Arbitrum One](../chains/arbitrum.md) | poolUSDC | `0xe8CDF27AcD73a434D661C84887215F7598e7d0d3` | `Stargate.PoolUSDC` |

## ABI

### `StargatePoolABI`

`import StargatePoolABI from "./protocols/stargate/StargatePoolABI.json";` Speaks for: poolNative, poolUSDC, poolUSDT.

- `send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) msgReceipt, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)`
- `quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam) view returns ((uint256 minAmountLD, uint256 maxAmountLD) oftLimit, (int256 feeAmountLD, string description)[] oftFeeDetails, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
