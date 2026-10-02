<!-- Generated from the SDK's registries. Do not edit. -->

# Lynex (`lynex`)

Linea-native ve(3,3) DEX and liquidity marketplace. Solidly-fork with gauge voting and concentrated liquidity pools.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Lynex` on linea |
| Chains | linea |
| Document | [lynex.md](../lynex.md): what it is for, how to choose it, its pitfalls |

## In a program

On Linea, `Lynex` is a namespace: its contracts need no import.

```sauce chain=linea
function main() {
  // Linea's router, `0x610D2f07b7EdC67565160F587F37636194C34E74`.
  require(Lynex.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Linea](../../../sauce-chains/references/linea.md) | router | `0x610D2f07b7EdC67565160F587F37636194C34E74` | `Lynex.Router` |

## ABI

### `LynexRouterABI`

`import LynexRouterABI from "./protocols/lynex/LynexRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
