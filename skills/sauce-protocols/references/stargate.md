# Stargate

Omnichain liquidity transport protocol built on LayerZero. Provides native asset bridging with unified liquidity pools.

## Category

bridge | Direction: L2-to-L2, L1-to-L2, L2-to-L1 (any-to-any) | Chains and addresses: [registry/stargate.md](registry/stargate.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/stargate.md](registry/stargate.md).

## Notes

- Uses LayerZero endpoint IDs (dstEid) for destination chains, NOT EVM chain IDs
- Each token has its own pool contract (poolNative for ETH, poolUSDC for USDC, etc.)
- Native token fees required for LayerZero messaging -- sent as msg.value
- Unified liquidity pools across chains -- no wrapped tokens, receives native assets
- Finality depends on LayerZero verification (typically 1-5 minutes)
- Use `quoteOFT` to get fee estimates before sending
- TVL: $400M+. Audited
