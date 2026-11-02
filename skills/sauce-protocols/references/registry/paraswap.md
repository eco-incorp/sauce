<!-- Generated from the SDK's registries. Do not edit. -->

# ParaSwap (`paraswap`)

Multi-chain DEX aggregator optimizing swap rates across decentralized exchanges. Supports limit orders and delta algorithm for MEV protection.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Paraswap` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [paraswap.md](../paraswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Paraswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's augustusV5, `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`.
  require(Paraswap.AugustusV5 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit` |
| [Optimism](../../../sauce-chains/references/optimism.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit` |
| [Polygon](../../../sauce-chains/references/polygon.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Base](../../../sauce-chains/references/base.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buy`, `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `DEFAULT_ADMIN_ROLE`, `directBalancerV2GivenInSwap`, `directBalancerV2GivenOutSwap`, `directCurveV1Swap`, `directCurveV2Swap`, `directUniV3Buy`, `directUniV3Swap`, `getAdapterData`, `getFeeWallet`, `getImplementation`, `getPartnerFeeStructure`, `getRoleAdmin`, `getRoleMember`, `getRoleMemberCount`, `getRouterData`, `getTokenTransferProxy`, `getVersion`, `grantRole`, `hasRole`, `initialize`, `initializeAdapter`, `initializeRouter`, `isAdapterInitialized`, `isRouterInitialized`, `megaSwap`, `multiSwap`, `onERC1155BatchReceived`, `onERC1155Received`, `onERC721Received`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `protectedMegaSwap`, `protectedMultiSwap`, `protectedSimpleBuy`, `protectedSimpleSwap`, `registerPartner`, `renounceRole`, `revokeRole`, `ROUTER_ROLE`, `setFeeWallet`, `setImplementation`, `simpleBuy`, `simpleBuyNFT`, `simpleSwap`, `supportsInterface`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`, `transferTokens`, `WHITELISTED_ROLE` |
| [Base](../../../sauce-chains/references/base.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |

## ABI

### `AugustusV5ABI`

`import AugustusV5ABI from "./protocols/paraswap/AugustusV5ABI.json";` Speaks for: augustusV5. The import is the contract's full ABI across every deployment; call it through the `Paraswap` namespace to have a function a chain's deployment does not run refused.

- `buy((address adapter, address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address beneficiary, (uint256 index, address targetExchange, uint256 percent, bytes payload, uint256 networkFee)[] route, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256)`
- `buyOnAugustusRFQTryBatchFill(((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint256 takerTokenFillAmount, bytes permitTakerAsset, bytes permitMakerAsset)[] orderInfos, uint8 wrapETH, uint256 fromAmountMax, uint256 toAmount) payable`
- `buyOnAugustusRFQTryBatchFillWithPermit(((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint256 takerTokenFillAmount, bytes permitTakerAsset, bytes permitMakerAsset)[] orderInfos, uint8 wrapETH, uint256 fromAmountMax, uint256 toAmount, bytes permit) payable`
- `buyOnUniswap(uint256 amountInMax, uint256 amountOut, address[] path) payable`
- `buyOnUniswapFork(address factory, bytes32 initCode, uint256 amountInMax, uint256 amountOut, address[] path) payable`
- `buyOnUniswapV2Fork(address tokenIn, uint256 amountInMax, uint256 amountOut, address weth, uint256[] pools) payable`
- `buyOnUniswapV2ForkWithPermit(address tokenIn, uint256 amountInMax, uint256 amountOut, address weth, uint256[] pools, bytes permit) payable`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `directBalancerV2GivenInSwap(((bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 deadline, uint256 feePercent, address vault, address partner, bool isApproved, address beneficiary, bytes permit, bytes16 uuid) data) payable`
- `directBalancerV2GivenOutSwap(((bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 deadline, uint256 feePercent, address vault, address partner, bool isApproved, address beneficiary, bytes permit, bytes16 uuid) data) payable`
- `directCurveV1Swap((address fromToken, address toToken, address exchange, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 feePercent, int128 i, int128 j, address partner, bool isApproved, uint8 swapType, address beneficiary, bool needWrapNative, bytes permit, bytes16 uuid) data) payable`
- `directCurveV2Swap((address fromToken, address toToken, address exchange, address poolAddress, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 feePercent, uint256 i, uint256 j, address partner, bool isApproved, uint8 swapType, address beneficiary, bool needWrapNative, bytes permit, bytes16 uuid) data) payable`
- `directUniV3Buy((address fromToken, address toToken, address exchange, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 feePercent, uint256 deadline, address partner, bool isApproved, address beneficiary, bytes path, bytes permit, bytes16 uuid) data) payable`
- `directUniV3Swap((address fromToken, address toToken, address exchange, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, uint256 feePercent, uint256 deadline, address partner, bool isApproved, address beneficiary, bytes path, bytes permit, bytes16 uuid) data) payable`
- `getAdapterData(bytes32 key) view returns (bytes)`
- `getFeeWallet() view returns (address)`
- `getImplementation(bytes4 selector) view returns (address)`
- `getPartnerFeeStructure(address partner) view returns ((uint256 partnerShare, bool noPositiveSlippage, bool positiveSlippageToUser, uint16 feePercent, string partnerId, bytes data))`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `getRoleMember(bytes32 role, uint256 index) view returns (address)`
- `getRoleMemberCount(bytes32 role) view returns (uint256)`
- `getRouterData(bytes32 key) view returns (bytes)`
- `getTokenTransferProxy() view returns (address)`
- `getVersion() pure returns (string)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize(bytes)`
- `initializeAdapter(address adapter, bytes data)`
- `initializeRouter(address router, bytes data)`
- `isAdapterInitialized(bytes32 key) view returns (bool)`
- `isRouterInitialized(bytes32 key) view returns (bool)`
- `megaSwap((address fromToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address beneficiary, (uint256 fromAmountPercent, (address to, uint256 totalNetworkFee, (address adapter, uint256 percent, uint256 networkFee, (uint256 index, address targetExchange, uint256 percent, bytes payload, uint256 networkFee)[] route)[] adapters)[] path)[] path, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256)`
- `multiSwap((address fromToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address beneficiary, (address to, uint256 totalNetworkFee, (address adapter, uint256 percent, uint256 networkFee, (uint256 index, address targetExchange, uint256 percent, bytes payload, uint256 networkFee)[] route)[] adapters)[] path, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256)`
- `onERC1155BatchReceived(address _operator, address _from, uint256[] _ids, uint256[] _values, bytes _data) returns (bytes4)`
- `onERC1155Received(address _operator, address _from, uint256 _id, uint256 _value, bytes _data) returns (bytes4)`
- `onERC721Received(address, address, uint256, bytes) returns (bytes4)`
- `partialSwapOnAugustusRFQ((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, bytes makerPermit, uint8 wrapETH, uint256 fromAmount) payable`
- `partialSwapOnAugustusRFQNFT((uint256 nonceAndMeta, uint128 expiry, uint256 makerAsset, uint256 makerAssetId, uint256 takerAsset, uint256 takerAssetId, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, bytes makerPermit, uint8 wrapETH, uint256 fromAmount) payable`
- `partialSwapOnAugustusRFQNFTWithPermit((uint256 nonceAndMeta, uint128 expiry, uint256 makerAsset, uint256 makerAssetId, uint256 takerAsset, uint256 takerAssetId, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, bytes makerPermit, uint8 wrapETH, uint256 fromAmount, bytes permit) payable`
- `partialSwapOnAugustusRFQWithPermit((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, bytes makerPermit, uint8 wrapETH, uint256 fromAmount, bytes permit) payable`
- `protectedMegaSwap((address fromToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address beneficiary, (uint256 fromAmountPercent, (address to, uint256 totalNetworkFee, (address adapter, uint256 percent, uint256 networkFee, (uint256 index, address targetExchange, uint256 percent, bytes payload, uint256 networkFee)[] route)[] adapters)[] path)[] path, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256)`
- `protectedMultiSwap((address fromToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address beneficiary, (address to, uint256 totalNetworkFee, (address adapter, uint256 percent, uint256 networkFee, (uint256 index, address targetExchange, uint256 percent, bytes payload, uint256 networkFee)[] route)[] adapters)[] path, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256)`
- `protectedSimpleBuy((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable`
- `protectedSimpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`
- `registerPartner(address partner, uint256 _partnerShare, bool _noPositiveSlippage, bool _positiveSlippageToUser, uint16 _feePercent, string partnerId, bytes _data)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `ROUTER_ROLE() view returns (bytes32)`
- `setFeeWallet(address _feeWallet)`
- `setImplementation(bytes4 selector, address implementation)`
- `simpleBuy((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable`
- `simpleBuyNFT((address fromToken, (uint256 toToken, uint256 toTokenID, uint256 toAmount)[] toTokenDetails, uint256 fromAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable`
- `simpleSwap((address fromToken, address toToken, uint256 fromAmount, uint256 toAmount, uint256 expectedAmount, address[] callees, bytes exchangeData, uint256[] startIndexes, uint256[] values, address beneficiary, address partner, uint256 feePercent, bytes permit, uint256 deadline, bytes16 uuid) data) payable returns (uint256 receivedAmount)`
- `supportsInterface(bytes4 interfaceID) view returns (bool)`
- `swapOnAugustusRFQ((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint8 wrapETH) payable`
- `swapOnAugustusRFQNFT((uint256 nonceAndMeta, uint128 expiry, uint256 makerAsset, uint256 makerAssetId, uint256 takerAsset, uint256 takerAssetId, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint8 wrapETH) payable`
- `swapOnAugustusRFQNFTWithPermit((uint256 nonceAndMeta, uint128 expiry, uint256 makerAsset, uint256 makerAssetId, uint256 takerAsset, uint256 takerAssetId, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint8 wrapETH, bytes permit) payable`
- `swapOnAugustusRFQTryBatchFill(((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint256 takerTokenFillAmount, bytes permitTakerAsset, bytes permitMakerAsset)[] orderInfos, uint8 wrapETH, uint256 fromAmount, uint256 toAmountMin) payable`
- `swapOnAugustusRFQTryBatchFillWithPermit(((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint256 takerTokenFillAmount, bytes permitTakerAsset, bytes permitMakerAsset)[] orderInfos, uint8 wrapETH, uint256 fromAmount, uint256 toAmountMin, bytes permit) payable`
- `swapOnAugustusRFQWithPermit((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint8 wrapETH, bytes permit) payable`
- `swapOnUniswap(uint256 amountIn, uint256 amountOutMin, address[] path) payable`
- `swapOnUniswapFork(address factory, bytes32 initCode, uint256 amountIn, uint256 amountOutMin, address[] path) payable`
- `swapOnUniswapV2Fork(address tokenIn, uint256 amountIn, uint256 amountOutMin, address weth, uint256[] pools) payable`
- `swapOnUniswapV2ForkWithPermit(address tokenIn, uint256 amountIn, uint256 amountOutMin, address weth, uint256[] pools, bytes permit) payable`
- `swapOnZeroXv2(address fromToken, address toToken, uint256 fromAmount, uint256 amountOutMin, address exchange, bytes payload) payable`
- `swapOnZeroXv2WithPermit(address fromToken, address toToken, uint256 fromAmount, uint256 amountOutMin, address exchange, bytes payload, bytes permit) payable`
- `swapOnZeroXv4(address fromToken, address toToken, uint256 fromAmount, uint256 amountOutMin, address exchange, bytes payload) payable`
- `swapOnZeroXv4WithPermit(address fromToken, address toToken, uint256 fromAmount, uint256 amountOutMin, address exchange, bytes payload, bytes permit) payable`
- `transferTokens(address token, address destination, uint256 amount)`
- `WHITELISTED_ROLE() view returns (bytes32)`

Not on Optimism's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on BNB Chain's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`. Do not call them there: a program compiled for BNB Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buy`, `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `DEFAULT_ADMIN_ROLE`, `directBalancerV2GivenInSwap`, `directBalancerV2GivenOutSwap`, `directCurveV1Swap`, `directCurveV2Swap`, `directUniV3Buy`, `directUniV3Swap`, `getAdapterData`, `getFeeWallet`, `getImplementation`, `getPartnerFeeStructure`, `getRoleAdmin`, `getRoleMember`, `getRoleMemberCount`, `getRouterData`, `getTokenTransferProxy`, `getVersion`, `grantRole`, `hasRole`, `initialize`, `initializeAdapter`, `initializeRouter`, `isAdapterInitialized`, `isRouterInitialized`, `megaSwap`, `multiSwap`, `onERC1155BatchReceived`, `onERC1155Received`, `onERC721Received`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `protectedMegaSwap`, `protectedMultiSwap`, `protectedSimpleBuy`, `protectedSimpleSwap`, `registerPartner`, `renounceRole`, `revokeRole`, `ROUTER_ROLE`, `setFeeWallet`, `setImplementation`, `simpleBuy`, `simpleBuyNFT`, `simpleSwap`, `supportsInterface`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`, `transferTokens`, `WHITELISTED_ROLE`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2Fork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2Fork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's augustusV5 (`0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57`), whose code does not dispatch them or declares them otherwise: `buyOnAugustusRFQTryBatchFill`, `buyOnAugustusRFQTryBatchFillWithPermit`, `buyOnUniswap`, `buyOnUniswapFork`, `buyOnUniswapV2ForkWithPermit`, `partialSwapOnAugustusRFQ`, `partialSwapOnAugustusRFQNFT`, `partialSwapOnAugustusRFQNFTWithPermit`, `partialSwapOnAugustusRFQWithPermit`, `swapOnAugustusRFQ`, `swapOnAugustusRFQNFT`, `swapOnAugustusRFQNFTWithPermit`, `swapOnAugustusRFQTryBatchFill`, `swapOnAugustusRFQTryBatchFillWithPermit`, `swapOnAugustusRFQWithPermit`, `swapOnUniswap`, `swapOnUniswapFork`, `swapOnUniswapV2ForkWithPermit`, `swapOnZeroXv2`, `swapOnZeroXv2WithPermit`, `swapOnZeroXv4`, `swapOnZeroXv4WithPermit`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `augustusRFQ` taking `()`: no captured deployment dispatches it.
- `erc20Proxy` taking `()`: no captured deployment dispatches it.
- `ETH_IDENTIFIER` taking `()`: no captured deployment dispatches it.
- `event Bought` taking `(bytes16,address,address,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Bought2` taking `(bytes16,address,uint256,address,address,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event FeeTaken` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Swapped` taking `(bytes16,address,address,address,address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Swapped2` taking `(bytes16,address,uint256,address,address,address,address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `exchange` taking `()`: no captured deployment dispatches it.
- `FEE_FACTOR` taking `()`: no captured deployment dispatches it.
- `FEE` taking `()`: no captured deployment dispatches it.
- `feeClaimer` taking `()`: no captured deployment dispatches it.
- `getKey` taking `()`: no captured deployment dispatches it.
- `maxFeePercent` taking `()`: no captured deployment dispatches it.
- `paraswapReferralShare` taking `()`: no captured deployment dispatches it.
- `paraswapSlippageShare` taking `()`: no captured deployment dispatches it.
- `partnerSharePercent` taking `()`: no captured deployment dispatches it.
- `UNISWAP_FACTORY` taking `()`: no captured deployment dispatches it.
- `UNISWAP_INIT_CODE` taking `()`: no captured deployment dispatches it.
- `weth` taking `()`: no captured deployment dispatches it.
- `WETH` taking `()`: no captured deployment dispatches it.
