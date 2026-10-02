<!-- Generated from the SDK's registries. Do not edit. -->

# Fenix (`fenix`)

Blast-native ve(3,3) DEX and liquidity hub. Solidly-fork with concentrated liquidity and gauge voting, leveraging Blast native yield.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Fenix` on blast |
| Chains | blast |
| Document | [fenix.md](../fenix.md): what it is for, how to choose it, its pitfalls |

## In a program

On Blast, `Fenix` is a namespace: its contracts need no import.

```sauce chain=blast
function main() {
  // Blast's router, `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE`.
  require(Fenix.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../../../sauce-chains/references/blast.md) | router | `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE` | `Fenix.Router` |

## ABI

### `FenixRouterABI`

`import FenixRouterABI from "./protocols/fenix/FenixRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
