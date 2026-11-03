<!-- Generated from the SDK's registries. Do not edit. -->

# SyncSwap (`syncswap`)

DEX on zkSync Era. Supports classic constant product and stable pools with native account abstraction.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Syncswap` on zksync |
| Chains | zksync |
| Document | [syncswap.md](../syncswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On zkSync Era, `Syncswap` is a namespace: its contracts need no import.

```sauce chain=zksync
function main() {
  // zkSync Era's router, `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295`.
  require(Syncswap.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | router | `0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295` | `Syncswap.Router` |

## ABI

### `SyncSwapRouterABI`

`import SyncSwapRouterABI from "./protocols/syncswap/SyncSwapRouterABI.json";` Speaks for: router. The import is the contract's full ABI across every deployment; call it through the `Syncswap` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity(address pool, (address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData) payable returns (uint256 liquidity)`
- `addLiquidity2(address pool, (address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData) payable returns (uint256 liquidity)`
- `addLiquidityWithPermit(address pool, (address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData, (address token, uint256 approveAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)[] permits) payable returns (uint256 liquidity)`
- `addLiquidityWithPermit2(address pool, (address token, uint256 amount)[] inputs, bytes data, uint256 minLiquidity, address callback, bytes callbackData, (address token, uint256 approveAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)[] permits) payable returns (uint256 liquidity)`
- `burnLiquidity(address pool, uint256 liquidity, bytes data, uint256[] minAmounts, address callback, bytes callbackData) returns ((address token, uint256 amount)[] amounts)`
- `burnLiquiditySingle(address pool, uint256 liquidity, bytes data, uint256 minAmount, address callback, bytes callbackData) returns ((address token, uint256 amount) amountOut)`
- `burnLiquiditySingleWithPermit(address pool, uint256 liquidity, bytes data, uint256 minAmount, address callback, bytes callbackData, (uint256 approveAmount, uint256 deadline, bytes signature) permit) returns ((address token, uint256 amount) amountOut)`
- `burnLiquidityWithPermit(address pool, uint256 liquidity, bytes data, uint256[] minAmounts, address callback, bytes callbackData, (uint256 approveAmount, uint256 deadline, bytes signature) permit) returns ((address token, uint256 amount)[] amounts)`
- `createPool(address _factory, bytes data) payable returns (address)`
- `enteredPools(address, uint256) view returns (address)`
- `enteredPoolsLength(address account) view returns (uint256)`
- `isPoolEntered(address, address) view returns (bool)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermit2(address token, uint256 value, uint256 deadline, bytes signature) payable`
- `selfPermit2IfNecessary(address token, uint256 value, uint256 deadline, bytes signature) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `stake(address stakingPool, address token, uint256 amount, address onBehalf)`
- `swap(((address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline) payable returns ((address token, uint256 amount) amountOut)`
- `swapWithPermit(((address pool, bytes data, address callback, bytes callbackData)[] steps, address tokenIn, uint256 amountIn)[] paths, uint256 amountOutMin, uint256 deadline, (address token, uint256 approveAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) permit) payable returns ((address token, uint256 amount) amountOut)`
- `vault() view returns (address)`
- `wETH() view returns (address)`
