<!-- Generated from the SDK's registries. Do not edit. -->

# Arrakis Finance (`arrakis`)

Automated liquidity management protocol for Uniswap V3. Provides vaults that actively manage concentrated liquidity positions.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Arrakis` on ethereum |
| Chains | ethereum |
| Document | [arrakis.md](../arrakis.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Arrakis` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9`.
  require(Arrakis.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` | `Arrakis.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` | `Arrakis.Router` |

## ABI

### `ArrakisRouterABI`

`import ArrakisRouterABI from "./protocols/arrakis/ArrakisRouterABI.json";` Speaks for: router.

- `addLiquidity((uint256 amount0Max, uint256 amount1Max, uint256 amount0Min, uint256 amount1Min, uint256 amountSharesMin, address vault, address receiver, address gauge) params) payable returns (uint256 amount0, uint256 amount1, uint256 sharesReceived)`
- `addLiquidityPermit2(((uint256 amount0Max, uint256 amount1Max, uint256 amount0Min, uint256 amount1Min, uint256 amountSharesMin, address vault, address receiver, address gauge) addData, ((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, bytes signature) params_) payable returns (uint256 amount0, uint256 amount1, uint256 sharesReceived)`
- `blacklist(address vault_, address[] toBlacklist_)`
- `getWhitelist(address vault_) view returns (address[])`
- `initialize(address owner_)`
- `mintRestrictedVaults(address) view returns (uint256 supplyCap, bool hasWhitelist)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `permit2() view returns (address)`
- `removeLiquidity((uint256 burnAmount, uint256 amount0Min, uint256 amount1Min, address vault, address receiver, address gauge, bool receiveETH) params) returns (uint256 amount0, uint256 amount1)`
- `removeLiquidityPermit2(((uint256 burnAmount, uint256 amount0Min, uint256 amount1Min, address vault, address receiver, address gauge, bool receiveETH) removeData, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) params_) returns (uint256 amount0, uint256 amount1)`
- `renounceOwnership()`
- `resolver() view returns (address)`
- `setMintRules(address vault_, uint256 supplyCap_, bool hasWhitelist_)`
- `swapAndAddLiquidity(((bytes swapPayload, uint256 amountInSwap, uint256 amountOutSwap, address swapRouter, bool zeroForOne) swapData, (uint256 amount0Max, uint256 amount1Max, uint256 amount0Min, uint256 amount1Min, uint256 amountSharesMin, address vault, address receiver, address gauge) addData) params_) payable returns (uint256 amount0, uint256 amount1, uint256 sharesReceived, uint256 amount0Diff, uint256 amount1Diff)`
- `swapAndAddLiquidityPermit2((((bytes swapPayload, uint256 amountInSwap, uint256 amountOutSwap, address swapRouter, bool zeroForOne) swapData, (uint256 amount0Max, uint256 amount1Max, uint256 amount0Min, uint256 amount1Min, uint256 amountSharesMin, address vault, address receiver, address gauge) addData) swapAndAddData, ((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, bytes signature) params_) payable returns (uint256 amount0, uint256 amount1, uint256 sharesReceived, uint256 amount0Diff, uint256 amount1Diff)`
- `swapper() view returns (address)`
- `transferOwnership(address newOwner)`
- `unpause()`
- `updateSwapExecutor(address swapper_)`
- `weth() view returns (address)`
- `whitelist(address vault_, address[] toWhitelist_)`

### `ArrakisVaultABI`

`import ArrakisVaultABI from "./protocols/arrakis/ArrakisVaultABI.json";`

- `addPools(uint24[] feeTiers_)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `blacklistRouters(address[] routers_)`
- `burn(uint256 burnAmount_, address receiver_) returns (uint256 amount0, uint256 amount1)`
- `decimals() view returns (uint8)`
- `decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)`
- `factory() view returns (address)`
- `getPools() view returns (address[])`
- `getRanges() view returns ((int24 lowerTick, int24 upperTick, uint24 feeTier)[])`
- `getRouters() view returns (address[])`
- `increaseAllowance(address spender, uint256 addedValue) returns (bool)`
- `init0() view returns (uint256)`
- `init1() view returns (uint256)`
- `initialize(string name_, string symbol_, (uint24[] feeTiers, address token0, address token1, address owner, uint256 init0, uint256 init1, address manager, address[] routers) params_)`
- `manager() view returns (address)`
- `managerBalance0() view returns (uint256)`
- `managerBalance1() view returns (uint256)`
- `managerFeeBPS() view returns (uint16)`
- `mint(uint256 mintAmount_, address receiver_) returns (uint256 amount0, uint256 amount1)`
- `name() view returns (string)`
- `owner() view returns (address)`
- `rebalance(((uint128 liquidity, (int24 lowerTick, int24 upperTick, uint24 feeTier) range)[] burns, (uint128 liquidity, (int24 lowerTick, int24 upperTick, uint24 feeTier) range)[] mints, (bytes payload, address router, uint256 amountIn, uint256 expectedMinReturn, bool zeroForOne) swap, uint256 minBurn0, uint256 minBurn1, uint256 minDeposit0, uint256 minDeposit1) rebalanceParams_)`
- `removePools(address[] pools_)`
- `renounceOwnership()`
- `restrictedMint() view returns (address)`
- `setInits(uint256 init0_, uint256 init1_)`
- `setManager(address manager_)`
- `setManagerFeeBPS(uint16 managerFeeBPS_)`
- `setRestrictedMint(address minter_)`
- `symbol() view returns (string)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `uniswapV3MintCallback(uint256 amount0Owed_, uint256 amount1Owed_, bytes)`
- `whitelistRouters(address[] routers_)`
- `withdrawManagerBalance()`
