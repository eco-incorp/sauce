<!-- Generated from the SDK's registries. Do not edit. -->

# DODO (`dodo`)

Proactive market maker (PMM) DEX with capital-efficient liquidity provision. Features single-token LP, customizable price curves, and smart routing.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Dodo` on ethereum, bsc |
| Chains | ethereum, bsc |
| Document | [dodo.md](../dodo.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Dodo` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's dodoV2Proxy, `0xa356867fDCEa8e71AEaF87805808803806231FdC`.
  require(Dodo.DODOV2Proxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | dodoV2Proxy | `0xa356867fDCEa8e71AEaF87805808803806231FdC` | `Dodo.DODOV2Proxy` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486` | `Dodo.DODOV2Proxy` |

## ABI

### `DODOV2ProxyABI`

`import DODOV2ProxyABI from "./protocols/dodo/DODOV2ProxyABI.json";` Speaks for: dodoV2Proxy.

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
