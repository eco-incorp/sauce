<!-- Generated from the SDK's registries. Do not edit. -->

# Trader Joe (`trader-joe`)

Liquidity Book DEX with variable-width bins for concentrated liquidity. Native to Avalanche with expansion to Arbitrum and BSC.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `TraderJoe` on bsc, arbitrum, avalanche |
| Chains | bsc, arbitrum, avalanche |
| Document | [trader-joe.md](../trader-joe.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `TraderJoe` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's lbFactory, `0x8e42f2F4101563bF679975178e880FD87d3eFd4e`.
  require(TraderJoe.LBFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lbFactory | `0x8e42f2F4101563bF679975178e880FD87d3eFd4e` | `TraderJoe.LBFactory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `TraderJoe.LBRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `LBFactoryABI`

`import LBFactoryABI from "./protocols/trader-joe/LBFactoryABI.json";` Speaks for: lbFactory.

- `getLBPairInformation(address tokenA, address tokenB, uint256 binStep) view returns ((uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting) lbPairInformation)`: `LBPair` is a `TraderJoe.LBPair`

### `LBPairABI`

`import LBPairABI from "./protocols/trader-joe/LBPairABI.json";`

- `getTokenX() pure returns (address tokenX)`: the address is a token
- `getTokenY() pure returns (address tokenY)`: the address is a token
- `getBinStep() pure returns (uint16)`
- `getActiveId() view returns (uint24 activeId)`
- `getReserves() view returns (uint128 reserveX, uint128 reserveY)`
- `getBin(uint24 id) view returns (uint128 binReserveX, uint128 binReserveY)`
- `getPriceFromId(uint24 id) pure returns (uint256 price)`
- `getSwapIn(uint128 amountOut, bool swapForY) view returns (uint128 amountIn, uint128 amountOutLeft, uint128 fee)`
- `getSwapOut(uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)`
- `swap(bool swapForY, address to) returns (bytes32 amountsOut)`

### `LBRouterABI`

`import LBRouterABI from "./protocols/trader-joe/LBRouterABI.json";` Speaks for: lbRouter.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256[] amountsIn)`
- `addLiquidity((address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline) liquidityParameters) returns (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)`
