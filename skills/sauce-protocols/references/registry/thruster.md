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
  // Blast's v3SwapRouter, `0x337827814155ECBf24D20231fCA4444F530C0555`.
  require(Thruster.V3SwapRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../../../sauce-chains/references/blast.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530C0555` | `Thruster.V3SwapRouter` |

## ABI

### `ThrusterV3SwapRouterABI`

`import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";` Speaks for: v3SwapRouter. The import is the contract's full ABI across every deployment; call it through the `Thruster` namespace to have a function a chain's deployment does not run refused.

- `BLAST() view returns (address)`
- `claimGas(address _recipient, uint256 _minClaimRateBips) returns (uint256 amount)`
- `exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `factory() view returns (address)`
- `manager() view returns (address)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `refundETH() payable`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `setManager(address _manager)`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `updatePointsAdmin(address _admin)`
- `WETH9() view returns (address)`
