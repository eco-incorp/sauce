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
  require(Maverick.V2Factory != 0);
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

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `MaverickV2FactoryABI`

`import MaverickV2FactoryABI from "./protocols/maverick/MaverickV2FactoryABI.json";` Speaks for: v2Factory.

- `claimProtocolFeeForPool(address pool)`
- `claimProtocolFeeForPool(address pool, bool isTokenA)`
- `create(uint64 fee, uint16 tickSpacing, uint32 lookback, address tokenA, address tokenB, int32 activeTick, uint8 kinds) returns (address)`
- `create(uint64 feeAIn, uint64 feeBIn, uint16 tickSpacing, uint32 lookback, address tokenA, address tokenB, int32 activeTick, uint8 kinds) returns (address)`
- `createPermissioned(uint64 fee, uint16 tickSpacing, uint32 lookback, address tokenA, address tokenB, int32 activeTick, uint8 kinds, address accessor) returns (address)`
- `createPermissioned(uint64 feeAIn, uint64 feeBIn, uint16 tickSpacing, uint32 lookback, address tokenA, address tokenB, int32 activeTick, uint8 kinds, address accessor) returns (address)`
- `createPermissioned(uint64 feeAIn, uint64 feeBIn, uint16 tickSpacing, uint32 lookback, address tokenA, address tokenB, int32 activeTick, uint8 kinds, address accessor, bool permissionedLiquidity, bool permissionedSwap) returns (address pool)`
- `deployParameters() view returns (uint64 feeAIn, uint64 feeBIn, uint32 lookback, int32 activeTick, uint64 tokenAScale, uint64 tokenBScale, address tokenA, address tokenB, uint16 tickSpacing, uint8 options, address accessor)`
- `isFactoryPool(address pool) view returns (bool)`
- `lookup(uint256 startIndex, uint256 endIndex) view returns (address[] pools)`
- `lookup(address tokenA, address tokenB, uint256 startIndex, uint256 endIndex) view returns (address[] pools)`
- `lookup(uint256 feeAIn, uint256 feeBIn, uint256 tickSpacing, uint256 lookback, address tokenA, address tokenB, uint8 kinds) view returns (address)`
- `lookupPermissioned(uint256 startIndex, uint256 endIndex) view returns (address[] pools)`
- `lookupPermissioned(address _tokenA, address _tokenB, address accessor, uint256 startIndex, uint256 endIndex) view returns (address[] pools)`
- `lookupPermissioned(uint256 feeAIn, uint256 feeBIn, uint256 tickSpacing, uint256 lookback, address tokenA, address tokenB, uint8 options, address accessor) view returns (address)`
- `owner() view returns (address)`
- `poolByTokenCount(address _tokenA, address _tokenB, address accessor) view returns (uint256 _poolCount)`
- `poolCount() view returns (uint256 _poolCount)`
- `poolPermissionedCount() view returns (uint256 _poolCount)`
- `protocolFeeRatioD3() view returns (uint8)`
- `protocolFeeReceiver() view returns (address)`
- `protocolLendingFeeRateD18() view returns (uint256)`
- `renounceOwnership()`
- `setProtocolFeeRatio(uint8 _protocolFeeRatioD3)`
- `setProtocolFeeReceiver(address receiver)`
- `setProtocolLendingFeeRate(uint256 _protocolLendingFeeRateD18)`
- `transferOwnership(address newOwner)`
- `updateProtocolFeeRatioForPool(address pool)`
- `updateProtocolLendingFeeRateForPool(address pool)`

### `MaverickV2PoolABI`

`import MaverickV2PoolABI from "./protocols/maverick/MaverickV2PoolABI.json";`

- `accessor() view returns (address)`
- `addLiquidity(address recipient, uint256 subaccount, (uint8 kind, int32[] ticks, uint128[] amounts) params, bytes data) returns (uint256 tokenAAmount, uint256 tokenBAmount, uint32[] binIds)`
- `adminAction(uint8 action, uint256 value)`
- `balanceOf(address user, uint256 subaccount, uint32 binId) view returns (uint128 lpToken)`
- `binIdByTickKind(int32 tick, uint256 kind) view returns (uint32)`
- `factory() view returns (address)`
- `fee(bool tokenAIn) view returns (uint256)`
- `flashLoan(address recipient, uint256 amountA, uint256 amountB, bytes data) returns (uint128 lendingFeeA, uint128 lendingFeeB)`
- `getBin(uint32 binId) view returns ((uint128 mergeBinBalance, uint128 tickBalance, uint128 totalSupply, uint8 kind, int32 tick, uint32 mergeId) bin)`
- `getCurrentTwa() view returns (int256)`
- `getState() view returns ((uint128 reserveA, uint128 reserveB, int64 lastTwaD8, int64 lastLogPriceD8, uint40 lastTimestamp, int32 activeTick, bool isLocked, uint32 binCounter, uint8 protocolFeeRatioD3))`
- `getTick(int32 tick) view returns ((uint128 reserveA, uint128 reserveB, uint128 totalSupply, uint32[4] binIdsByTick) tickState)`
- `kinds() view returns (uint8 _kinds)`
- `lendingFeeRateD18() view returns (uint256)`
- `lookback() view returns (uint256)`
- `migrateBinUpStack(uint32 binId, uint32 maxRecursion)`
- `permissionedLiquidity() view returns (bool _permissionedLiquidity)`
- `permissionedPool() view returns (bool _permissionedPool)`
- `permissionedSwap() view returns (bool _permissionedSwap)`
- `protocolFeeA() view returns (uint128)`
- `protocolFeeB() view returns (uint128)`
- `removeLiquidity(address recipient, uint256 subaccount, (uint32[] binIds, uint128[] amounts) params) returns (uint256 tokenAOut, uint256 tokenBOut)`
- `setFee(uint256 newFeeAIn, uint256 newFeeBIn)`
- `swap(address recipient, (uint256 amount, bool tokenAIn, bool exactOutput, int32 tickLimit) params, bytes data) returns (uint256 amountIn, uint256 amountOut)`
- `tickSpacing() view returns (uint256)`
- `tokenA() view returns (address)`: the address is a token
- `tokenAScale() view returns (uint256)`
- `tokenB() view returns (address)`: the address is a token
- `tokenBScale() view returns (uint256)`

### `MaverickV2RouterABI`

`import MaverickV2RouterABI from "./protocols/maverick/MaverickV2RouterABI.json";` Speaks for: v2Router.

- `checkDeadline(uint256 deadline) payable`
- `checkSqrtPrice(address pool, uint256 minSqrtPrice, uint256 maxSqrtPrice) payable`
- `exactInputMultiHop(address recipient, bytes path, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)`
- `exactInputSingle(address recipient, address pool, bool tokenAIn, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)`
- `exactInputSinglePackedArgs(bytes argsPacked) payable returns (uint256 amountOut)`
- `exactOutputMultiHop(address recipient, bytes path, uint256 amountOut, uint256 amountInMaximum) payable returns (uint256 amountIn)`
- `exactOutputSingle(address recipient, address pool, bool tokenAIn, uint256 amountOut, uint256 amountInMaximum) payable returns (uint256 amountIn, uint256 amountOut)`
- `exactOutputSingleMinimal(address recipient, address pool, bool tokenAIn, uint256 amountOut, int32 tickLimit) payable returns (uint256 amountIn, uint256 amountOut_)`
- `factory() view returns (address factory_)`
- `inputSingleWithTickLimit(address recipient, address pool, bool tokenAIn, uint256 amountIn, int32 tickLimit, uint256 amountOutMinimum) payable returns (uint256 amountIn_, uint256 amountOut)`
- `maverickV2SwapCallback(address tokenIn, uint256 amountToPay, uint256, bytes _data)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `outputSingleWithTickLimit(address recipient, address pool, bool tokenAIn, uint256 amountOut, int32 tickLimit, uint256 amountInMaximum, uint256 amountOutMinimum) payable returns (uint256 amountIn_, uint256 amountOut_)`
- `refundETH() payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenAmount(address token, uint256 amount, address recipient) payable`
- `unwrapAndSweep(address tokenA, address tokenB, uint256 tokenAAmountMin, uint256 tokenBAmountMin) payable`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `weth() view returns (address weth_)`
