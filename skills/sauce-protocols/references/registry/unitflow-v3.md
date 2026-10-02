<!-- Generated from the SDK's registries. Do not edit. -->

# UnitFlow V3 (`unitflow-v3`)

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Unitflow`: `unitflow-v3` |
| Namespace | `UnitflowV3` on arc |
| Chains | arc |
| Document | [unitflow-v3.md](../unitflow-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arc, `UnitflowV3` is a namespace: its contracts need no import.

```sauce chain=arc
function main() {
  // Arc's factory, `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d`.
  require(UnitflowV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d` | `UnitflowV3.Factory` |
| [Arc](../../../sauce-chains/references/arc.md) | quoter | `0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34` | `UnitflowV3.Quoter` |
| [Arc](../../../sauce-chains/references/arc.md) | router | `0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410` | `UnitflowV3.Router` |

## ABI

### `UnitFlowV3FactoryABI`

`import UnitFlowV3FactoryABI from "./protocols/unitflow-v3/UnitFlowV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`
- `feeAmountTickSpacing(uint24 fee) view returns (int24)`

### `UnitFlowV3PoolABI`

`import UnitFlowV3PoolABI from "./protocols/unitflow-v3/UnitFlowV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `UnitFlowV3QuoterABI`

`import UnitFlowV3QuoterABI from "./protocols/unitflow-v3/UnitFlowV3QuoterABI.json";` Speaks for: quoter.

- `quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)`

### `UnitFlowV3RouterABI`

`import UnitFlowV3RouterABI from "./protocols/unitflow-v3/UnitFlowV3RouterABI.json";` Speaks for: router.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `factory() view returns (address)`
