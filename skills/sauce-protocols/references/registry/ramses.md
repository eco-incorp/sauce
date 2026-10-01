<!-- Generated from the SDK's registries. Do not edit. -->

# Ramses (`ramses`)

Arbitrum-native ve(3,3) DEX with concentrated liquidity. Features gauge voting, bribes, and protocol-owned liquidity mechanisms.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [ramses.md](../ramses.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's router):

```sauce chain=arbitrum
import RamsesRouterABI from "./protocols/ramses/RamsesRouterABI.json";

const ROUTER = 0xAAA87963EFeB6f7E0a2711F397663105Acb1805en;

function main() {
  const bound = RamsesRouterABI.at(ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `RamsesRouterABI.at(0xAAA87963EFeB6f7E0a2711F397663105Acb1805en)` |

## ABI

### `RamsesRouterABI`

`import RamsesRouterABI from "./protocols/ramses/RamsesRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
