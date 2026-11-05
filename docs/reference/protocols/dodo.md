<!-- Generated from the SDK's registries. Do not edit. -->

# DODO (`dodo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> DODO is an exchange: people swap one token for another in its pools. This page lists the chains it
> is deployed on, the name a program writes for each of its contracts, and the functions a program
> can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Proactive Market Maker (PMM) DEX with capital-efficient liquidity provision. Unlike constant product AMMs, DODO uses oracle-guided pricing to concentrate liquidity near market price. Features single-token LP, customizable price curves, and smart routing across DODO pools.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Dodo` on ethereum, bsc |
| Chains | ethereum, bsc |

## What it offers

- **swap**: Swap tokens via DODO V2 Proxy with pair-based routing

## Notes

- PMM (Proactive Market Maker) provides better capital efficiency than constant product by concentrating liquidity near oracle price
- `dodoPairs` is an array of DODO pool addresses defining the swap route (each pool has a base token and a quote token)
- `directions` is a bitmask: for each pool in the path, a bit value of `0` means "sell base token" and `1` means "sell quote token". The least significant bit corresponds to the first pool
- For a single-pool swap: if you're selling the base token of that pool, `directions = 0`; if selling the quote token, `directions = 1`
- `isIncentive`: Flag for DODO mining incentives, typically set to `false`
- Pool discovery requires off-chain lookup via DODO's API or subgraph to find the right pool addresses
- Input token must be ERC20-approved to the V2 Proxy contract
- DODO also supports single-token LP (provide only one side of liquidity)
- From a Pot program, `@sauce/router` swaps at a DODO V2 pool (DVM, DPP or DSP) directly, with no proxy and no approval: `dodoV2(pool, tokenIn, tokenOut, amountIn, baseToken, quoteToken, minOut, recipient)` transfers the input to the pool and calls `sellBase(to)` when `tokenIn` is the base, `sellQuote(to)` when it is the quote, returning the amount out. The side cannot come from address order, and the wrong one reverts nothing and donates the input, so the function takes the pool's `_BASE_TOKEN_()` and `_QUOTE_TOKEN_()` and reverts unless `tokenIn` and `tokenOut` are those two. The pool books its whole balance as its reserve, so the swap consumes its input or reverts; name a `minOut`, since a thin pool pays out at most its quote reserve for any input. `tryDodoV2`, with the same arguments, first reads the pool's own `querySellBase` or `querySellQuote` and returns 0, having moved nothing, when the quote is below `minOut` (or below 1) or the view reverts; the pool prices that view for the Pot's fee but charges the transaction's origin, so where its fee model tells the two apart the swap can deliver less than the quote and revert at the floor. The `dodoV2Swap` action is the same call; legacy V1 pairs are the `dodoV1Swap` action's, through the proxy

## Its names in a program

On Ethereum, `Dodo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's dodoV2Proxy, `0xa356867fDCEa8e71AEaF87805808803806231FdC`.
  require(Dodo.DODOV2Proxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | dodoV2Proxy | `0xa356867fDCEa8e71AEaF87805808803806231FdC` | `Dodo.DODOV2Proxy` |
| [BNB Chain](../chains/bsc.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486` | `Dodo.DODOV2Proxy` |

## ABI

### `DODOV2ProxyABI`

`import DODOV2ProxyABI from "./protocols/dodo/DODOV2ProxyABI.json";` Speaks for: dodoV2Proxy. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Dodo` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `_CHI_TOKEN_() view returns (address)`
- `_CP_FACTORY_() view returns (address)`
- `_DODO_APPROVE_PROXY_() view returns (address)`
- `_DODO_INCENTIVE_() view returns (address)`
- `_DODO_SELL_HELPER_() view returns (address)`
- `_DPP_FACTORY_() view returns (address)`
- `_DVM_FACTORY_() view returns (address)`
- `_GAS_DODO_MAX_RETURN_() view returns (uint256)`
- `_GAS_EXTERNAL_RETURN_() view returns (uint256)`
- `_NEW_OWNER_() view returns (address)`
- `_OWNER_() view returns (address)`
- `_WETH_() view returns (address)`
- `addDVMLiquidity(address dvmAddress, uint256 baseInAmount, uint256 quoteInAmount, uint256 baseMinAmount, uint256 quoteMinAmount, uint8 flag, uint256 deadLine) payable returns (uint256 shares, uint256 baseAdjustedInAmount, uint256 quoteAdjustedInAmount)`
- `addLiquidityToV1(address pair, uint256 baseAmount, uint256 quoteAmount, uint256 baseMinShares, uint256 quoteMinShares, uint8 flag, uint256 deadLine) payable returns (uint256 baseShares, uint256 quoteShares)`
- `addWhiteList(address contractAddr)`
- `bid(address cpAddress, uint256 quoteAmount, uint8 flag, uint256 deadLine) payable`
- `claimOwnership()`
- `createCrowdPooling(address baseToken, address quoteToken, uint256 baseInAmount, uint256[] timeLine, uint256[] valueList, bool isOpenTWAP, uint256 deadLine) payable returns (address newCrowdPooling)`
- `createDODOPrivatePool(address baseToken, address quoteToken, uint256 baseInAmount, uint256 quoteInAmount, uint256 lpFeeRate, uint256 i, uint256 k, bool isOpenTwap, uint256 deadLine) payable returns (address newPrivatePool)`
- `createDODOVendingMachine(address baseToken, address quoteToken, uint256 baseInAmount, uint256 quoteInAmount, uint256 lpFeeRate, uint256 i, uint256 k, bool isOpenTWAP, uint256 deadLine) payable returns (address newVendingMachine, uint256 shares)`
- `dodoSwapV1(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) payable returns (uint256 returnAmount)`
- `dodoSwapV2ETHToToken(address toToken, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) payable returns (uint256 returnAmount)`
- `dodoSwapV2TokenToETH(address fromToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) returns (uint256 returnAmount)`
- `dodoSwapV2TokenToToken(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] dodoPairs, uint256 directions, bool isIncentive, uint256 deadLine) returns (uint256 returnAmount)`
- `externalSwap(address fromToken, address toToken, address approveTarget, address swapTarget, uint256 fromTokenAmount, uint256 minReturnAmount, bytes callDataConcat, bool isIncentive, uint256 deadLine) payable returns (uint256 returnAmount)`
- `initOwner(address newOwner)`
- `isWhiteListed(address) view returns (bool)`
- `mixSwap(address fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, address[] mixAdapters, address[] mixPairs, address[] assetTo, uint256 directions, bool isIncentive, uint256 deadLine) payable returns (uint256 returnAmount)`
- `removeWhiteList(address contractAddr)`
- `resetDODOPrivatePool(address dppAddress, uint256[] paramList, uint256[] amountList, uint8 flag, uint256 minBaseReserve, uint256 minQuoteReserve, uint256 deadLine) payable`
- `transferOwnership(address newOwner)`
- `updateGasReturn(uint256 newDodoGasReturn, uint256 newExternalGasReturn)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
