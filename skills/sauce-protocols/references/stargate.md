# Stargate

Omnichain liquidity transport protocol built on LayerZero. Provides native asset bridging with unified liquidity pools.

## Category

bridge | Direction: L2-to-L2, L1-to-L2, L2-to-L1 (any-to-any) | Chains: Ethereum (1), Arbitrum (42161), Base (8453)

## SauceScript Functions

### bridge

Send tokens cross-chain via Stargate pool using LayerZero messaging.

```typescript
import { StargatePoolABI as IStargatePool } from "./abis";

function main(
  poolAddress: Address,
  dstEid: Uint256,
  recipient: Uint256,
  amount: Uint256,
  minAmount: Uint256,
): {
  msgReceipt: { guid: Uint256; nonce: Uint256; fee: { nativeFee: Uint256; lzTokenFee: Uint256 } };
  oftReceipt: { amountSentLD: Uint256; amountReceivedLD: Uint256 };
} {
  const pool = IStargatePool.at(poolAddress);
  return pool.send(
    {
      dstEid: dstEid,
      to: recipient,
      amountLD: amount,
      minAmountLD: minAmount,
      extraOptions: 0x00,
      composeMsg: 0x00,
      oftCmd: 0x00,
    },
    { nativeFee: ctx.msgValue(), lzTokenFee: 0 },
    ctx.msgSender(),
  );
}
```

- `poolAddress`: Token-specific pool (e.g. poolUSDC, poolNative)
- `dstEid`: LayerZero endpoint ID for destination chain (NOT the EVM chain ID)
- `recipient`: Destination address as bytes32 (left-padded)
- `amount`: Amount in token's native decimals (LD = local decimals)
- `minAmount`: Minimum amount to receive on destination (slippage protection)
- Requires native token (ETH) for LayerZero messaging fee (sent as msg.value)
- Requires ERC-20 approval to the pool for non-native tokens

## Deployed Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | poolNative | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` |
| Ethereum | poolUSDC   | `0xc026395860Db2d07ee33e05fE50ed7bD583189C7` |
| Ethereum | poolUSDT   | `0x933597a323Eb81cAe705C5bC29985172fd5A3973` |
| Arbitrum | poolNative | `0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F` |
| Arbitrum | poolUSDC   | `0xe8CDF27AcD73a434D661C84887215F7598e7d0d3` |
| Base     | poolNative | `0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7` |
| Base     | poolUSDC   | `0x27a16dc786820B16E5c9028b75B99F6f604b5d26` |

## ABI Reference

### StargatePoolABI

- `send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) returns (MessagingReceipt msgReceipt, OFTReceipt oftReceipt)` [payable] - Bridge tokens to destination chain
- `quoteOFT(SendParam _sendParam) returns (OFTLimit oftLimit, OFTFeeDetail[] oftFeeDetails, OFTReceipt oftReceipt)` - Quote bridge limits, fees and the amount received (view)

SendParam tuple: `(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)`
MessagingFee tuple: `(uint256 nativeFee, uint256 lzTokenFee)`

## Notes

- Uses LayerZero endpoint IDs (dstEid) for destination chains, NOT EVM chain IDs
- Each token has its own pool contract (poolNative for ETH, poolUSDC for USDC, etc.)
- Native token fees required for LayerZero messaging -- sent as msg.value
- Unified liquidity pools across chains -- no wrapped tokens, receives native assets
- Finality depends on LayerZero verification (typically 1-5 minutes)
- Use `quoteOFT` to get fee estimates before sending
- TVL: $400M+. Audited
