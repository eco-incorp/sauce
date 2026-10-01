<!-- Generated from the SDK's registries. Do not edit. -->

# Level Finance (`level-finance`)

Decentralized perpetual exchange with risk-tranched liquidity pools and leveraged trading on BSC and Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | bsc, arbitrum |
| Document | [level-finance.md](../level-finance.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here BNB Chain's liquidityPool):

```sauce chain=bsc
import LiquidityPoolABI from "./protocols/level-finance/LiquidityPoolABI.json";

const LIQUIDITY_POOL = 0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874n;

function main() {
  const bound = LiquidityPoolABI.at(LIQUIDITY_POOL);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LiquidityPoolABI.at(0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LiquidityPoolABI.at(0x32B7bF19cb8b95C27E644183837813d4b595dcc6n)` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/level-finance/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `addLiquidity(address tranche, address token, uint256 amountIn, uint256 minLpAmount, address to)`
- `removeLiquidity(address tranche, address tokenOut, uint256 lpAmount, uint256 minOut, address to)`
- `swap(address tokenIn, address tokenOut, uint256 minOut, address to, bytes extradata)`
