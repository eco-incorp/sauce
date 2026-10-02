<!-- Generated from the SDK's registries. Do not edit. -->

# Pendle (`pendle`)

Yield trading protocol that tokenizes future yield. Split yield-bearing assets into principal tokens (PT) and yield tokens (YT) for trading.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Pendle` on ethereum, monad, arbitrum |
| Chains | ethereum, monad, arbitrum |
| Document | [pendle.md](../pendle.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Pendle` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's router, `0x888888888889758F76e7103c6CbF23ABbF58F946`.
  require(Pendle.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Monad](../../../sauce-chains/references/monad.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |

## ABI

### `PendleRouterABI`

`import PendleRouterABI from "./protocols/pendle/PendleRouterABI.json";` Speaks for: router.

- `addLiquiditySingleToken(address receiver, address market, uint256 minLpOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtReceivedFromSy, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netLpOut, uint256 netSyFee, uint256 netSyInterm)`
- `removeLiquiditySingleToken(address receiver, address market, uint256 netLpToRemove, (address tokenOut, uint256 minTokenOut, address tokenRedeemSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) output, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForPt(address receiver, address market, uint256 minPtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessPtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm)`
- `swapExactTokenForYt(address receiver, address market, uint256 minYtOut, (uint256 guessMin, uint256 guessMax, uint256 guessOffchain, uint256 maxIteration, uint256 eps) guessYtOut, (address tokenIn, uint256 netTokenIn, address tokenMintSy, address pendleSwap, (uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input, (address limitRouter, uint256 epsSkipMarket, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] normalFills, ((uint256 salt, uint256 expiry, uint256 nonce, uint8 orderType, address token, address YT, address maker, address receiver, uint256 makingAmount, uint256 lnImpliedRate, uint256 failSafeRate, bytes permit) order, bytes signature, uint256 makingAmount)[] flashFills, bytes optData) limit) payable returns (uint256 netYtOut, uint256 netSyFee, uint256 netSyInterm)`
