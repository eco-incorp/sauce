<!-- Generated from the SDK's registries. Do not edit. -->

# Hop Protocol (`hop`)

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Hop` on ethereum, optimism, polygon, base, arbitrum |
| Chains | ethereum, optimism, polygon, base, arbitrum |

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

## Notes

- L1-to-L2: Uses `sendToL2` on token-specific L1Bridge contracts
- L2-to-L2 or L2-to-L1: Uses `swapAndSend` on L2AmmWrapper (swaps canonical token to hToken for bridging)
- Each supported token has separate bridge contracts on L1 and AMM wrappers on L2
- Bonders provide fast liquidity on destination (minutes), settle via canonical bridge later
- `bonderFee` on L2 must be obtained from Hop API or SDK
- Finality: minutes with bonder, 7+ days without bonder (canonical path)
- TVL: $50M+. Audited

## Its names in a program

On Ethereum, `Hop` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1EthBridge, `0xb8901acb165ed027e32754e0ffe830802919727f`.
  require(Hop.L1EthBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1EthBridge | `0xb8901acb165ed027e32754e0ffe830802919727f` | `Hop.L1EthBridge` |
| [Ethereum](../chains/ethereum.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `Hop.L1UsdcBridge` |
| [Optimism](../chains/optimism.md) | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` | `Hop.L2AmmWrapper` |
| [Polygon](../chains/polygon.md) | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` | `Hop.L2AmmWrapper` |
| [Base](../chains/base.md) | l2AmmWrapper | `0x10541b07d8Ad2647Dc6cD67abd4c03575dade261` | `Hop.L2AmmWrapper` |
| [Arbitrum One](../chains/arbitrum.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `Hop.L2AmmWrapper` |

## ABI

### `HopL1BridgeABI`

`import HopL1BridgeABI from "./protocols/hop/HopL1BridgeABI.json";` Speaks for: l1EthBridge, l1UsdcBridge.

- `sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline, address relayer, uint256 relayerFee) payable`

### `HopL2AmmWrapperABI`

`import HopL2AmmWrapperABI from "./protocols/hop/HopL2AmmWrapperABI.json";` Speaks for: l2AmmWrapper.

- `swapAndSend(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 destinationAmountOutMin, uint256 destinationDeadline) payable`
