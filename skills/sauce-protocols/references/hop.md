# Hop Protocol

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

## Category

bridge | Direction: L1-to-L2 (sendToL2), L2-to-L2/L1 (swapAndSend) | Chains and addresses: [registry/hop.md](registry/hop.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### bridgeFromL1

Send tokens from Ethereum L1 to an L2 via the Hop L1Bridge.

```typescript
import { HopL1BridgeABI as IL1Bridge } from "./abis";

function main(
  bridgeAddress: Address,
  chainId: Uint256,
  recipient: Address,
  amount: Uint256,
  amountOutMin: Uint256,
): Uint256 {
  const bridge = IL1Bridge.at(bridgeAddress);
  bridge.sendToL2(
    chainId,
    recipient,
    amount,
    amountOutMin,
    99999999999,
    0x0000000000000000000000000000000000000000,
    0,
  );
  return 1;
}
```

- `bridgeAddress`: Token-specific L1Bridge (e.g. l1EthBridge for ETH, l1UsdcBridge for USDC)
- `chainId`: EVM chain ID of destination L2
- `amountOutMin`: Minimum tokens to receive after AMM swap on L2 (slippage protection)
- `deadline`: Set to far future (99999999999) to avoid expiry
- `relayer`/`relayerFee`: Set to zero for standard transfers
- Requires ERC-20 approval to the L1Bridge for ERC-20 tokens, or send ETH as msg.value

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/hop.md](registry/hop.md).

## Notes

- L1-to-L2: Uses `sendToL2` on token-specific L1Bridge contracts
- L2-to-L2 or L2-to-L1: Uses `swapAndSend` on L2AmmWrapper (swaps canonical token to hToken for bridging)
- Each supported token has separate bridge contracts on L1 and AMM wrappers on L2
- Bonders provide fast liquidity on destination (minutes), settle via canonical bridge later
- `bonderFee` on L2 must be obtained from Hop API or SDK
- Finality: minutes with bonder, 7+ days without bonder (canonical path)
- TVL: $50M+. Audited
