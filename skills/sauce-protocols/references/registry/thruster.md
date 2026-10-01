<!-- Generated from the SDK's registries. Do not edit. -->

# Thruster (`thruster`)

Blast-native DEX with concentrated liquidity (V3) pools. Optimized for Blast's native yield and gas rebate features.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | blast |
| Document | [thruster.md](../thruster.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Blast's v3SwapRouter):

```sauce chain=blast
import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";

const V3_SWAP_ROUTER = 0x337827814155ECBf24D20231fCA4444F530c0555n;

function main() {
  const bound = ThrusterV3SwapRouterABI.at(V3_SWAP_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../../../sauce-chains/references/blast.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530c0555` | `ThrusterV3SwapRouterABI.at(0x337827814155ECBf24D20231fCA4444F530c0555n)` |

## ABI

### `ThrusterV3SwapRouterABI`

`import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
