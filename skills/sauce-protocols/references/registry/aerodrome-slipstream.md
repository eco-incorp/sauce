<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome Slipstream (`aerodrome-slipstream`)

Aerodrome's concentrated-liquidity (Uniswap V3-style) pools, keyed by tick spacing rather than fee: three generations on Base, and Aero Lite on Arc.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `AerodromeSlipstream` on arc, base |
| Chains | arc, base |
| Document | [aerodrome-slipstream.md](../aerodrome-slipstream.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arc, `AerodromeSlipstream` is a namespace: its contracts need no import.

```sauce chain=arc
function main() {
  // Arc's clFactory, `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03`.
  require(AerodromeSlipstream.CLFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | clFactory | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` | `AerodromeSlipstream.CLFactory`; not on this deployment: `getSwapFee`, `legacyCLFactory`, `setSwapFeeModule`, `swapFeeModule` |
| [Arc](../../../sauce-chains/references/arc.md) | metarouter | `0x7275fA44c67bba8D921422e600b4Ed396209C886` | `AerodromeSlipstream.Metarouter` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | clFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `AerodromeSlipstream.CLFactory`; not on this deployment: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `legacyCLFactory`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugeCaps | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | `AerodromeSlipstream.CLFactoryGaugeCaps`; not on this deployment: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated` |
| [Base](../../../sauce-chains/references/base.md) | clFactoryGaugesV3 | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | `AerodromeSlipstream.CLFactoryGaugesV3`; not on this deployment: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugeCaps | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | `AerodromeSlipstream.NonfungiblePositionManagerGaugeCaps` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManagerGaugesV3 | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | `AerodromeSlipstream.NonfungiblePositionManagerGaugesV3` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `AeroMetarouterABI`

`import AeroMetarouterABI from "./protocols/aerodrome-slipstream/AeroMetarouterABI.json";` Speaks for: metarouter. The import is the contract's full ABI across every deployment; call it through the `AerodromeSlipstream` namespace to have a function a chain's deployment does not run refused.

- `EMISSION_TOKEN() view returns (address)`
- `execute(bytes _commands, bytes[] _inputs, uint256 _deadline) payable`
- `FACTORY_REGISTRY() view returns (address)`
- `ICA_ROUTER() view returns (address)`
- `IS_ROOT() view returns (bool)`
- `LEAF_VOTER() view returns (address)`
- `msgSender() view returns (address _sender)`
- `NATIVE_ERC20() view returns (address)`
- `NATIVE_ERC20_SCALE() view returns (uint256)`
- `onERC721Received(address, address _from, uint256 _tokenId, bytes) returns (bytes4 _selector)`
- `POSITION_MANAGER() view returns (address)`
- `RELAY_FACTORY() view returns (address)`
- `STAKING_ESCROW() view returns (address)`
- `STAKING_TOKEN() view returns (address)`
- `uniswapV3SwapCallback(int256 _amount0Delta, int256 _amount1Delta, bytes _data)`
- `WETH() view returns (address)`

### `AerodromeSlipstreamPoolABI`

`import AerodromeSlipstreamPoolABI from "./protocols/aerodrome-slipstream/AerodromeSlipstreamPoolABI.json";`

- `burn(int24 tickLower, int24 tickUpper, uint128 amount) returns (uint256 amount0, uint256 amount1)`
- `burn(int24 tickLower, int24 tickUpper, uint128 amount, address owner) returns (uint256 amount0, uint256 amount1)`
- `collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested, address owner) returns (uint128 amount0, uint128 amount1)`
- `collectFees() returns (uint128 amount0, uint128 amount1)`
- `factory() view returns (address)`
- `factoryRegistry() view returns (address)`
- `fee() view returns (uint24)`
- `feeGrowthGlobal0X128() view returns (uint256)`
- `feeGrowthGlobal1X128() view returns (uint256)`
- `flash(address recipient, uint256 amount0, uint256 amount1, bytes data)`
- `gauge() view returns (address)`
- `gaugeFees() view returns (uint128 token0, uint128 token1)`
- `getRewardGrowthInside(int24 tickLower, int24 tickUpper, uint256 _rewardGrowthGlobalX128) view returns (uint256 rewardGrowthInside)`
- `increaseObservationCardinalityNext(uint16 observationCardinalityNext)`
- `initialize(address _factory, address _token0, address _token1, int24 _tickSpacing, address _factoryRegistry, uint160 _sqrtPriceX96)`
- `lastUpdated() view returns (uint32)`
- `liquidity() view returns (uint128)`
- `maxLiquidityPerTick() view returns (uint128)`
- `mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes data) returns (uint256 amount0, uint256 amount1)`
- `nft() view returns (address)`
- `observations(uint256) view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)`
- `observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)`
- `periodFinish() view returns (uint256)`
- `positions(bytes32) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `rewardGrowthGlobalX128() view returns (uint256)`
- `rewardRate() view returns (uint256)`
- `rewardReserve() view returns (uint256)`
- `rollover() view returns (uint256)`
- `setGaugeAndPositionManager(address _gauge, address _nft)`
- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)`
- `snapshotCumulativesInside(int24 tickLower, int24 tickUpper) view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside)`
- `stake(int128 stakedLiquidityDelta, int24 tickLower, int24 tickUpper, bool positionUpdate)`
- `stakedLiquidity() view returns (uint128)`
- `swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data) returns (int256 amount0, int256 amount1)`
- `syncReward(uint256 _rewardRate, uint256 _rewardReserve, uint256 _periodFinish)`
- `tickBitmap(int16) view returns (uint256)`
- `ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, int128 stakedLiquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, uint256 rewardGrowthOutsideX128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `unstakedFee() view returns (uint24)`
- `updateRewardsGrowthGlobal()`

### `SlipstreamCLFactoryABI`

`import SlipstreamCLFactoryABI from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";` Speaks for: clFactory, clFactoryGaugeCaps, clFactoryGaugesV3. The import is the contract's full ABI across every deployment; call it through the `AerodromeSlipstream` namespace to have a function a chain's deployment does not run refused.

- `allPools(uint256) view returns (address)`
- `allPoolsLength() view returns (uint256)`
- `clPoolTape() view returns (address)`
- `clPoolTapeManager() view returns (address)`
- `createPool(address tokenA, address tokenB, uint24 tickSpacing) returns (address)`
- `createPool(address tokenA, address tokenB, int24 tickSpacing, uint160 sqrtPriceX96) returns (address pool)`
- `defaultSwapHook() view returns (address)`
- `defaultUnstakedFee() view returns (uint24)`
- `discountRegistry() view returns (address)`
- `discountRegistryManager() view returns (address)`
- `enableTickSpacing(int24 tickSpacing, uint24 fee)`
- `factoryRegistry() view returns (address)`
- `getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)`: the address is a `AerodromeSlipstream.Pool`
- `getPoolSwapHook(address _pool) view returns (address)`
- `getSwapFee(address pool) view returns (uint24)`
- `getUnstakedFee(address pool) view returns (uint24)`
- `isPool(address pool) view returns (bool)`
- `legacyCLFactory() view returns (address)`
- `owner() view returns (address)`
- `poolByTokenIndex(address, uint256) view returns (address)`
- `poolByTokenIndexLength(address _token) view returns (uint256 _length)`
- `poolByTokenIndexPaginated(address _token, uint256 _start, uint256 _end) view returns (address[] _poolByTokenIndexPaginated)`
- `poolImplementation() view returns (address)`
- `poolsIndex(uint256) view returns (address pool, uint48 creationTimestamp)`
- `poolsIndexLength() view returns (uint256 _length)`
- `poolsIndexPaginated(uint256 _start, uint256 _end) view returns ((address pool, uint48 creationTimestamp)[] _poolsIndexPaginated)`
- `poolSwapHook(address) view returns (address)`
- `setClPoolTape(address _clPoolTape)`
- `setClPoolTapeManager(address _clPoolTapeManager)`
- `setDefaultSwapHook(address _swapHook)`
- `setDefaultUnstakedFee(uint24 _defaultUnstakedFee)`
- `setDiscountRegistry(address _discountRegistry)`
- `setDiscountRegistryManager(address _discountRegistryManager)`
- `setOwner(address _owner)`
- `setPoolSwapHook(address[] _pools, address[] _swapHooks)`
- `setSwapFeeManager(address _swapFeeManager)`
- `setSwapFeeModule(address _swapFeeModule)`
- `setUnstakedFeeManager(address _unstakedFeeManager)`
- `setUnstakedFeeModule(address _unstakedFeeModule)`
- `setVoter(address _voter)`
- `swapFeeManager() view returns (address)`
- `swapFeeModule() view returns (address)`
- `tickSpacings() view returns (int24[])`
- `tickSpacingToFee(int24) view returns (uint24)`
- `tokenIndexLength() view returns (uint256 _length)`
- `tokenIndexPaginated(uint256 _start, uint256 _end) view returns (address[] _tokenIndexPaginated)`
- `unstakedFeeManager() view returns (address)`
- `unstakedFeeModule() view returns (address)`
- `voter() view returns (address)`

Not on Arc's clFactory (`0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03`), whose code does not dispatch them or declares them otherwise: `getSwapFee`, `legacyCLFactory`, `setSwapFeeModule`, `swapFeeModule`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's clFactory (`0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`), whose code does not dispatch them or declares them otherwise: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `legacyCLFactory`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's clFactoryGaugeCaps (`0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a`), whose code does not dispatch them or declares them otherwise: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's clFactoryGaugesV3 (`0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef`), whose code does not dispatch them or declares them otherwise: `clPoolTape`, `clPoolTapeManager`, `createPool`, `defaultSwapHook`, `discountRegistry`, `discountRegistryManager`, `getPoolSwapHook`, `poolByTokenIndex`, `poolByTokenIndexLength`, `poolByTokenIndexPaginated`, `poolsIndex`, `poolsIndexLength`, `poolsIndexPaginated`, `poolSwapHook`, `setClPoolTape`, `setClPoolTapeManager`, `setDefaultSwapHook`, `setDiscountRegistry`, `setDiscountRegistryManager`, `setPoolSwapHook`, `setVoter`, `tokenIndexLength`, `tokenIndexPaginated`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `getPool` taking `(address,address,uint24)`: an overload of getPool(address,address,int24), which takes as many arguments: a call picks its overload by argument count.

### `SlipstreamPositionManagerABI`

`import SlipstreamPositionManagerABI from "./protocols/aerodrome-slipstream/SlipstreamPositionManagerABI.json";` Speaks for: nonfungiblePositionManager, nonfungiblePositionManagerGaugeCaps, nonfungiblePositionManagerGaugesV3. The import is the contract's full ABI across every deployment; call it through the `AerodromeSlipstream` namespace to have a function a chain's deployment does not run refused.

- `approve(address to, uint256 tokenId)`
- `balanceOf(address owner) view returns (uint256)`
- `baseURI() pure returns (string)`
- `burn(uint256 tokenId) payable`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `factory() view returns (address)`: the address is a `AerodromeSlipstream.CLFactory`
- `getApproved(uint256 tokenId) view returns (address)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `mint((address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline, uint160 sqrtPriceX96) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `name() view returns (string)`
- `owner() view returns (address)`
- `ownerOf(uint256 tokenId) view returns (address)`
- `permit(address spender, uint256 tokenId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `refundETH() payable`
- `safeTransferFrom(address from, address to, uint256 tokenId)`
- `safeTransferFrom(address from, address to, uint256 tokenId, bytes _data)`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `setApprovalForAll(address operator, bool approved)`
- `setOwner(address _owner)`
- `setTokenDescriptor(address _tokenDescriptor)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `symbol() view returns (string)`
- `tokenByIndex(uint256 index) view returns (uint256)`
- `tokenDescriptor() view returns (address)`
- `tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)`
- `tokenURI(uint256 tokenId) view returns (string)`
- `totalSupply() view returns (uint256)`
- `transferFrom(address from, address to, uint256 tokenId)`
- `uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes data)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `WETH9() view returns (address)`
