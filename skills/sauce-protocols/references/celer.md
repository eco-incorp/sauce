# Celer Network

Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.

## Category

bridge | Direction: any-to-any (L1-to-L2, L2-to-L2, L2-to-L1) | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Polygon (137), BSC (56), Avalanche (43114)

## SauceScript Functions

### bridge

Send ERC-20 tokens cross-chain via cBridge.

```typescript
import { CelerBridgeABI as IBridge } from "./abis";

function main(
  bridgeAddress: Address,
  receiver: Address,
  token: Address,
  amount: Uint256,
  dstChainId: Uint256,
  maxSlippage: Uint256,
): Uint256 {
  const bridge = IBridge.at(bridgeAddress);
  bridge.send(receiver, token, amount, dstChainId, 0, maxSlippage);
  return 1;
}
```

- `receiver`: Address to receive tokens on destination chain
- `token`: ERC-20 token to bridge
- `dstChainId`: Destination EVM chain ID (as uint64)
- `nonce`: Set to 0 (auto-generated)
- `maxSlippage`: Maximum slippage in basis points (e.g. 500 = 5%). Applied during pool-based bridging
- Requires ERC-20 approval to the Bridge

## Deployed Addresses

| Chain     | Contract | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | bridge   | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` |
| Arbitrum  | bridge   | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` |
| Optimism  | bridge   | `0x9D39Fc627A6d9d9F8C831c16995b209548cc3401` |
| Polygon   | bridge   | `0x88DCDC47D2f83a99CF0000FDF667A468bB958a78` |
| BSC       | bridge   | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` |
| Avalanche | bridge   | `0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4` |

## ABI Reference

### CelerBridgeABI

- `send(address _receiver, address _token, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage)` - Send ERC-20 tokens cross-chain via liquidity pool
- `sendNative(address _receiver, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage)` [payable] - Send native token (ETH/BNB/etc.) cross-chain

## Notes

- `send` for ERC-20 tokens, `sendNative` for native tokens (ETH, BNB, AVAX, etc.)
- `nonce` is used for unique transfer identification -- can set to 0 or use block.timestamp
- `maxSlippage` is in basis points (1 = 0.01%, 100 = 1%, 5000 = 50%)
- Uses SGN validators to verify cross-chain messages
- Finality: typically 5-20 minutes depending on chain confirmation requirements
- Requires ERC-20 approval to the Bridge address
- TVL: $150M+. Audited
