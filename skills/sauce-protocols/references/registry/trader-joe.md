<!-- Generated from the SDK's registries. Do not edit. -->

# Trader Joe (`trader-joe`)

Liquidity Book DEX with variable-width bins for concentrated liquidity. Native to Avalanche with expansion to Arbitrum and BSC.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | bsc, arbitrum, avalanche |
| Document | [trader-joe.md](../trader-joe.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here BNB Chain's lbRouter):

```sauce chain=bsc
import LBRouterABI from "./protocols/trader-joe/LBRouterABI.json";

const LB_ROUTER = 0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30n;

function main() {
  const bound = LBRouterABI.at(LB_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `LBRouterABI.at(0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lbRouter | `0x18556da13313f3532c54711497a8fedac273220e` | `LBRouterABI.at(0x18556da13313f3532c54711497a8fedac273220en)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `LBFactoryABI.at(0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0cn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `LBRouterABI.at(0x18556DA13313f3532c54711497A8FedAC273220En)` |

## ABI

### `LBFactoryABI`

`import LBFactoryABI from "./protocols/trader-joe/LBFactoryABI.json";` Speaks for: lbFactory.

- `getLBPairInformation(address tokenA, address tokenB, uint256 binStep) view returns ((uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting) lbPairInformation)`

### `LBRouterABI`

`import LBRouterABI from "./protocols/trader-joe/LBRouterABI.json";` Speaks for: lbRouter.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256[] amountsIn)`
- `addLiquidity((address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline) liquidityParameters) returns (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)`
