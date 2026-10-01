<!-- Generated from the SDK's registries. Do not edit. -->

# Thruster (`thruster`)

Blast-native DEX with concentrated liquidity (V3) pools. Optimized for Blast's native yield and gas rebate features.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thruster` on blast |
| Chains | blast |
| Document | [thruster.md](../thruster.md): what it is for, how to choose it, its pitfalls |

## In a program

On Blast, `Thruster` is a namespace: its contracts need no import.

```sauce chain=blast
function main() {
  // Blast's v3SwapRouter, `0x337827814155ECBf24D20231fCA4444F530c0555`.
  require(Thruster.V3SwapRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../../../sauce-chains/references/blast.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530c0555` | `Thruster.V3SwapRouter` |

## ABI

### `ThrusterV3SwapRouterABI`

`import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
