<!-- Generated from the SDK's registries. Do not edit. -->

# Pendle (`pendle`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Pendle is a yield vault: deposits are put to work to earn interest. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading. PT = discounted principal (fixed yield), YT = future variable yield.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Pendle` on ethereum, monad, arbitrum |
| Chains | ethereum, monad, arbitrum |

## When to use it

- Splits a yield-bearing asset into PT (the principal, redeemable for the underlying at the
  market's expiry: a fixed yield) and YT (the yield until then), each traded in a market per
  expiry.
- Choose PT to lock a fixed yield to a date, YT to speculate on the yield.

## Pitfalls for a program

- Each market has an expiry: PT trades below the underlying before it, and redeems at it.
- Router calls take approximation and routing structs that Pendle's own API usually builds:
  take that calldata as `main`'s input, approve the input, forward it, and check the PT you
  got as a delta.
- PT and YT are separate tokens per market: name the right one.

## In a Sauce program

Buy PT with calldata from Pendle's API, checked by the PT received:

```ts
function main(tokenIn: Address, amountIn: Uint256, pt: Address, minPtOut: Uint256, call: bytes) {
  const before = Token(pt).balanceOf(pot);
  Token(tokenIn).approve(Pendle.Router, amountIn);
  evm.call(Pendle.Router, 0, call);
  const out = Token(pt).balanceOf(pot) - before;
  require(out >= minPtOut, "below minPtOut");
}
```

## What it offers

- **swapExactTokenForPt**: Buy PT (principal token) - lock in fixed yield
- **swapExactTokenForYt**: Buy YT (yield token) - speculate on variable yield
- **addLiquiditySingleToken**: Add single-sided liquidity to a Pendle market
- **removeLiquiditySingleToken**: Remove liquidity and receive single token

## Notes

- TVL: $2.6B+. Markets have expiry dates - PT redeems at face value at maturity
- All router methods use complex tuple params - see struct definitions above
- For simple swaps without external routing: set pendleSwap to zero address, swapType to 0
- For limit orders: set limitRouter to zero address, empty arrays for fills
- ApproxParams eps is typically 1e15 (0.1%), maxIteration typically 256
- tokenMintSy = the token that the SY (standardized yield) wrapper accepts
- **ApproxParams**: { guessMin, guessMax, guessOffchain, maxIteration, eps } - Binary search params for PT/YT amount
- **TokenInput**: { tokenIn, netTokenIn, tokenMintSy, pendleSwap, swapData } - Input token config
- **TokenOutput**: { tokenOut, minTokenOut, tokenRedeemSy, pendleSwap, swapData } - Output token config
- **SwapData**: { swapType, extRouter, extCalldata, needScale } - External swap config (use zeros for direct)
- **LimitOrderData**: { limitRouter, epsSkipMarket, normalFills, flashFills, optData } - Limit orders (use zeros/empty)

## Its names in a program

On Ethereum, `Pendle` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's router, `0x888888888889758F76e7103c6CbF23ABbF58F946`.
  require(Pendle.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Monad](../chains/monad.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `PendleMarketABI`

`import PendleMarketABI from "./protocols/pendle/PendleMarketABI.json";`

- `_storage() view returns (int128 totalPt, int128 totalSy, uint96 lastLnImpliedRate, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext)`
- `activeBalance(address) view returns (uint256)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `burn(address receiverSy, address receiverPt, uint256 netLpToBurn) returns (uint256 netSyOut, uint256 netPtOut)`
- `decimals() view returns (uint8)`
- `expiry() view returns (uint256)`
- `factory() view returns (address)`
- `getRewardTokens() view returns (address[])`
- `increaseObservationsCardinalityNext(uint16 cardinalityNext)`
- `isExpired() view returns (bool)`
- `lastRewardBlock() view returns (uint256)`
- `mint(address receiver, uint256 netSyDesired, uint256 netPtDesired) returns (uint256 netLpOut, uint256 netSyUsed, uint256 netPtUsed)`
- `name() view returns (string)`
- `observations(uint256) view returns (uint32 blockTimestamp, uint216 lnImpliedRateCumulative, bool initialized)`
- `observe(uint32[] secondsAgos) view returns (uint216[] lnImpliedRateCumulative)`
- `readState(address router) view returns ((int256 totalPt, int256 totalSy, int256 totalLp, address treasury, int256 scalarRoot, uint256 expiry, uint256 lnFeeRateRoot, uint256 reserveFeePercent, uint256 lastLnImpliedRate) market)`
- `readTokens() view returns (address _SY, address _PT, address _YT)`: `_SY` is a `Pendle.SY`, `_PT` is a token, `_YT` is a token
- `redeemRewards(address user) returns (uint256[])`
- `rewardState(address) view returns (uint128 index, uint128 lastBalance)`
- `skim()`
- `swapExactPtForSy(address receiver, uint256 exactPtIn, bytes data) returns (uint256 netSyOut, uint256 netSyFee)`
- `swapSyForExactPt(address receiver, uint256 exactPtOut, bytes data) returns (uint256 netSyIn, uint256 netSyFee)`
- `symbol() view returns (string)`
- `totalActiveSupply() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `userReward(address, address) view returns (uint128 index, uint128 accrued)`

Left out of this ABI, though its deployments declare them:

- `DOMAIN_SEPARATOR` taking `()`: not every deployment dispatches it.
- `error MarketScalarRootBelowZero` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MarketZeroNetLPFee` taking `()`: not every deployment declares it.
- `event RedeemRewards` taking `(address,uint256[])`: not every deployment declares it.
- `getNonOverrideLnFeeRateRoot` taking `()`: not every deployment dispatches it.
- `initialAnchor` taking `()`: not every deployment dispatches it.
- `nonces` taking `(address)`: not every deployment dispatches it.
- `permit` taking `(address,address,uint256,uint256,uint8,bytes32,bytes32)`: not every deployment dispatches it.
- `reentrancyGuardEntered` taking `()`: not every deployment dispatches it.
- `scalarRoot` taking `()`: not every deployment dispatches it.
- `VERSION` taking `()`: not every deployment dispatches it.

### `PendleRouterABI`

`import PendleRouterABI from "./protocols/pendle/PendleRouterABI.json";` Speaks for: router. The import is the contract's full ABI across every deployment; call it through the `Pendle` namespace to have a function a chain's deployment does not run refused.

- `addLiquidityDualSyAndPt(address receiver, address market, uint256 netSyDesired, uint256 netPtDesired, uint256 minLpOut) returns (uint256 netLpOut, uint256 netSyUsed, uint256 netPtUsed)`
- `addLiquidityDualTokenAndPt(address receiver, address market, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, uint256 netPtDesired, uint256 minLpOut) payable returns (uint256 netLpOut, uint256 netPtUsed, uint256 netSyInterm)`
- `addLiquiditySinglePt(address receiver, address market, uint256 netPtIn, uint256 minLpOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtSwapToSy, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netLpOut, uint256 netSyFee)`
- `addLiquiditySinglePtSimple(address receiver, address market, uint256 netPtIn, uint256 minLpOut) returns (uint256 netLpOut, uint256 netSyFee)`
- `addLiquiditySingleSy(address receiver, address market, uint256 netSyIn, uint256 minLpOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtReceivedFromSy, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netLpOut, uint256 netSyFee)`
- `addLiquiditySingleSyKeepYt(address receiver, address market, uint256 netSyIn, uint256 minLpOut, uint256 minYtOut) returns (uint256 netLpOut, uint256 netYtOut, uint256 netSyMintPy)`
- `addLiquiditySingleSySimple(address receiver, address market, uint256 netSyIn, uint256 minLpOut) returns (uint256 netLpOut, uint256 netSyFee)`
- `addLiquiditySingleToken(address receiver, address market, uint256 minLpOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtReceivedFromSy, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netLpOut, uint256 netSyFee, uint256 netSyInterm)`
- `addLiquiditySingleTokenKeepYt(address receiver, address market, uint256 minLpOut, uint256 minYtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netLpOut, uint256 netYtOut, uint256 netSyMintPy, uint256 netSyInterm)`
- `addLiquiditySingleTokenSimple(address receiver, address market, uint256 minLpOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netLpOut, uint256 netSyFee, uint256 netSyInterm)`
- `boostMarkets(address[] markets)`
- `burnAccount() view returns (address)`
- `callAndReflect(address reflector, bytes selfCall1, bytes selfCall2, bytes reflectCall) payable returns (bytes selfRes1, bytes selfRes2, bytes reflectRes)`
- `claimOwnership()`
- `exitPostExpToSy(address receiver, address market, uint256 netPtIn, uint256 netLpIn, uint256 minSyOut) returns ((uint256 netPtFromRemove, uint256 netSyFromRemove, uint256 netPtRedeem, uint256 netSyFromRedeem, uint256 totalSyOut) params)`
- `exitPostExpToToken(address receiver, address market, uint256 netPtIn, uint256 netLpIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output) returns (uint256 totalTokenOut, (uint256 netPtFromRemove, uint256 netSyFromRemove, uint256 netPtRedeem, uint256 netSyFromRedeem, uint256 totalSyOut) params)`
- `exitPreExpToSy(address receiver, address market, uint256 netPtIn, uint256 netYtIn, uint256 netLpIn, uint256 minSyOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns ((uint256 netPtFromRemove, uint256 netSyFromRemove, uint256 netPyRedeem, uint256 netSyFromRedeem, uint256 netPtSwap, uint256 netYtSwap, uint256 netSyFromSwap, uint256 netSyFee, uint256 totalSyOut) params)`
- `exitPreExpToToken(address receiver, address market, uint256 netPtIn, uint256 netYtIn, uint256 netLpIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 totalTokenOut, (uint256 netPtFromRemove, uint256 netSyFromRemove, uint256 netPyRedeem, uint256 netSyFromRedeem, uint256 netPtSwap, uint256 netYtSwap, uint256 netSyFromSwap, uint256 netSyFee, uint256 totalSyOut) params)`
- `limitRouterCallback(uint256 actualMaking, uint256 actualTaking, uint256 totalFee, bytes data) returns (bytes)`
- `mintPyFromSy(address receiver, address YT, uint256 netSyIn, uint256 minPyOut) returns (uint256 netPyOut)`
- `mintPyFromToken(address receiver, address YT, uint256 minPyOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netPyOut, uint256 netSyInterm)`
- `mintSyFromToken(address receiver, address SY, uint256 minSyOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netSyOut)`
- `multicall((bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] res)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `redeemDueInterestAndRewards(address user, address[] sys, address[] yts, address[] markets)`
- `redeemDueInterestAndRewardsV2(address[] SYs, (address yt, bool doRedeemInterest, bool doRedeemRewards, address tokenRedeemSy, uint256 minTokenRedeemOut)[] YTs, address[] markets, address pendleSwap, (address tokenIn, address tokenOut, uint256 minOut, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData)[] swaps) returns (uint256[] netOutFromSwaps, uint256[] netInterests)`
- `redeemPyToSy(address receiver, address YT, uint256 netPyIn, uint256 minSyOut) returns (uint256 netSyOut)`
- `redeemPyToToken(address receiver, address YT, uint256 netPyIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output) returns (uint256 netTokenOut, uint256 netSyInterm)`
- `redeemSyToToken(address receiver, address SY, uint256 netSyIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output) returns (uint256 netTokenOut)`
- `removeLiquidityDualSyAndPt(address receiver, address market, uint256 netLpToRemove, uint256 minSyOut, uint256 minPtOut) returns (uint256 netSyOut, uint256 netPtOut)`
- `removeLiquidityDualTokenAndPt(address receiver, address market, uint256 netLpToRemove, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, uint256 minPtOut) returns (uint256 netTokenOut, uint256 netPtOut, uint256 netSyInterm)`
- `removeLiquiditySinglePt(address receiver, address market, uint256 netLpToRemove, uint256 minPtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtReceivedFromSy, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netPtOut, uint256 netSyFee)`
- `removeLiquiditySinglePtSimple(address receiver, address market, uint256 netLpToRemove, uint256 minPtOut) returns (uint256 netPtOut, uint256 netSyFee)`
- `removeLiquiditySingleSy(address receiver, address market, uint256 netLpToRemove, uint256 minSyOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netSyOut, uint256 netSyFee)`
- `removeLiquiditySingleToken(address receiver, address market, uint256 netLpToRemove, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)`
- `requestBurnQuota(address token, uint256 amount, bytes optData)`
- `selectorToFacet(bytes4 selector) view returns (address)`
- `setSelectorToFacets((address facet, bytes4[] selectors)[] arr)`
- `simulate(address target, bytes data) payable`
- `swapCallback(int256 ptToAccount, int256 syToAccount, bytes data)`
- `swapExactPtForSy(address receiver, address market, uint256 exactPtIn, uint256 minSyOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netSyOut, uint256 netSyFee)`
- `swapExactPtForToken(address receiver, address market, uint256 exactPtIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactSyForPt(address receiver, address market, uint256 exactSyIn, uint256 minPtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netPtOut, uint256 netSyFee)`
- `swapExactSyForPtSimple(address receiver, address market, uint256 exactSyIn, uint256 minPtOut) returns (uint256 netPtOut, uint256 netSyFee)`
- `swapExactSyForYt(address receiver, address market, uint256 exactSyIn, uint256 minYtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessYtOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netYtOut, uint256 netSyFee)`
- `swapExactSyForYtSimple(address receiver, address market, uint256 exactSyIn, uint256 minYtOut) returns (uint256 netYtOut, uint256 netSyFee)`
- `swapExactTokenForPt(address receiver, address market, uint256 minPtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForPtSimple(address receiver, address market, uint256 minPtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForYt(address receiver, address market, uint256 minYtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessYtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netYtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForYtSimple(address receiver, address market, uint256 minYtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) payable returns (uint256 netYtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactYtForSy(address receiver, address market, uint256 exactYtIn, uint256 minSyOut, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netSyOut, uint256 netSyFee)`
- `swapExactYtForToken(address receiver, address market, uint256 exactYtIn, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapTokensToTokens(address pendleSwap, (address tokenIn, address tokenOut, uint256 minOut, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData)[] swaps, uint256[] netSwaps) payable returns (uint256[] netOutFromSwaps)`
- `swapTokenToTokenViaSy(address receiver, address SY, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, address tokenRedeemSy, uint256 minTokenOut) payable returns (uint256 netTokenOut, uint256 netSyInterm)`
- `transferOwnership(address newOwner, bool direct, bool renounce)`

Left out of this ABI, though its deployments declare them:

- `event SelectorToFacetSet` taking `(bytes4,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `PendleSYABI`

`import PendleSYABI from "./protocols/pendle/PendleSYABI.json";`

- `accruedRewards(address) view returns (uint256[] rewardAmounts)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `assetInfo() view returns (uint8 assetType, address assetAddress, uint8 assetDecimals)`
- `balanceOf(address account) view returns (uint256)`
- `claimOwnership()`
- `claimRewards(address) returns (uint256[] rewardAmounts)`
- `decimals() view returns (uint8)`
- `deposit(address receiver, address tokenIn, uint256 amountTokenToDeposit, uint256 minSharesOut) payable returns (uint256 amountSharesOut)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `exchangeRate() view returns (uint256)`
- `getRewardTokens() view returns (address[] rewardTokens)`
- `getTokensIn() view returns (address[] res)`
- `getTokensOut() view returns (address[] res)`
- `isValidTokenIn(address token) view returns (bool)`
- `isValidTokenOut(address token) view returns (bool)`
- `name() view returns (string)`
- `nonces(address owner) view returns (uint256)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pendingOwner() view returns (address)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `previewDeposit(address tokenIn, uint256 amountTokenToDeposit) view returns (uint256 amountSharesOut)`
- `previewRedeem(address tokenOut, uint256 amountSharesToRedeem) view returns (uint256 amountTokenOut)`
- `redeem(address receiver, uint256 amountSharesToRedeem, address tokenOut, uint256 minTokenOut, bool burnFromInternalBalance) returns (uint256 amountTokenOut)`
- `rewardIndexesCurrent() returns (uint256[] indexes)`
- `rewardIndexesStored() view returns (uint256[] indexes)`
- `symbol() view returns (string)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 amount) returns (bool)`
- `transferFrom(address from, address to, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner, bool direct, bool renounce)`
- `unpause()`
- `yieldToken() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `adapter` taking `()`: not every deployment dispatches it.
- `asset` taking `()`: not every deployment dispatches it.
- `eip712Domain` taking `()`: not every deployment dispatches it.
- `event ClaimRewards` taking `(address,address[],uint256[])`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetAdapter` taking `(address)`: not every deployment declares it.
- `initialize` taking `(string,string,address)`: not every deployment dispatches it.
- `setAdapter` taking `(address)`: not every deployment dispatches it.
- `stETH` taking `()`: not every deployment dispatches it.
- `wETH` taking `()`: not every deployment dispatches it.
- `wstETH` taking `()`: not every deployment dispatches it.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
