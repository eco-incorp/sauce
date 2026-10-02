<!-- Generated from the SDK's registries. Do not edit. -->

# Maverick (`maverick`)

Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Maverick` on ethereum, base, arbitrum |
| Chains | ethereum, base, arbitrum |
| Document | [maverick.md](../maverick.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Maverick` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's v2Factory, `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e`.
  require(Maverick.V2Factory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | v2Router | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` | `Maverick.V2Router` |
| [Base](../../../sauce-chains/references/base.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Base](../../../sauce-chains/references/base.md) | v2Router | `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527` | `Maverick.V2Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Router | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` | `Maverick.V2Router` |

## ABI

### `MaverickV2FactoryABI`

`import MaverickV2FactoryABI from "./protocols/maverick/MaverickV2FactoryABI.json";` Speaks for: v2Factory.

- `lookup(address tokenA, address tokenB, uint256 startIndex, uint256 endIndex) view returns (address[] pools)`

### `MaverickV2PoolABI`

`import MaverickV2PoolABI from "./protocols/maverick/MaverickV2PoolABI.json";`

- `getState() view returns ((uint128 reserveA, uint128 reserveB, int64 lastTwaD8, int64 lastLogPriceD8, uint40 lastTimestamp, int32 activeTick, bool isLocked, uint32 binCounter, uint8 protocolFeeRatioD3))`
- `fee(bool tokenAIn) view returns (uint256)`
- `tickSpacing() view returns (uint256)`
- `tokenA() view returns (address)`
- `tokenB() view returns (address)`

### `MaverickV2RouterABI`

`import MaverickV2RouterABI from "./protocols/maverick/MaverickV2RouterABI.json";` Speaks for: v2Router.

- `exactInputSingle(address recipient, address pool, bool tokenAIn, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)`
- `exactOutputSingle(address recipient, address pool, bool tokenAIn, uint256 amountOut, uint256 amountInMaximum) payable returns (uint256 amountIn, uint256 amountOut)`
