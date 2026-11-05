<!-- Generated from the SDK's registries. Do not edit. -->

# Fantom

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On Fantom a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Fantom, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Fantom%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Fantom+%28250%29&chain=Fantom&chain-id=250) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `fantom`; also `ftm`, `opera`, `fantom-opera` |
| Chain id | 250 |
| Kind | EVM |
| Name in a program | `Fantom` |
| Native coin | FTM (FTM), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain fantom`, a program names Fantom's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=fantom
function main() {
  // `AaveV3.Oracle` is Fantom's oracle: `0xfd6f3c1845604C8AE6c6E402ad17fb9885160754`.
  require(AaveV3.Oracle != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Fantom.AaveV3.Oracle == AaveV3.Oracle);
}
```

## Tokens

The registry names no token on this chain: a program uses `Token(<address>)`.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | oracle | `0xfd6f3c1845604C8AE6c6E402ad17fb9885160754` | `AaveV3.Oracle` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool`; not on this deployment: `approvePositionManager`, `borrow`, `configureEModeCategory`, `configureEModeCategoryBorrowableBitmap`, `configureEModeCategoryCollateralBitmap`, `configureEModeCategoryIsolated`, `configureEModeCategoryLtvzeroBitmap`, `eliminateReserveDeficit`, `finalizeTransfer`, `getBorrowLogic`, `getEModeCategoryBorrowableBitmap`, `getEModeCategoryCollateralBitmap`, `getEModeCategoryCollateralConfig`, `getEModeCategoryLabel`, `getEModeCategoryLtvzeroBitmap`, `getFlashLoanLogic`, `getIsEModeCategoryIsolated`, `getLiquidationGracePeriod`, `getLiquidationLogic`, `getPoolLogic`, `getReserveAToken`, `getReserveDeficit`, `getReservesCount`, `getReserveVariableDebtToken`, `getSupplyLogic`, `getVirtualUnderlyingBalance`, `initReserve`, `isApprovedPositionManager`, `liquidationCall`, `multicall`, `renouncePositionManagerRole`, `repay`, `repayWithATokens`, `repayWithPermit`, `RESERVE_INTEREST_RATE_STRATEGY`, `setLiquidationGracePeriod`, `setUserEModeOnBehalfOf`, `setUserUseReserveAsCollateral`, `setUserUseReserveAsCollateralOnBehalfOf`, `supply`, `supplyWithPermit`, `syncIndexesState`, `syncRatesState`, `UMBRELLA`, `updateFlashloanPremium`, `withdraw` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond`; not on this deployment: `ACROSS_CHAIN_ID_SOLANA`, `AIRLIFT`, `chainflipVault`, `CIRCLE_BRIDGE_PROXY`, `decode_startBridgeTokensViaAcrossV4ERC20Packed`, `decode_startBridgeTokensViaAcrossV4NativePacked`, `DLN_SOURCE`, `dlnSource`, `encode_startBridgeTokensViaAcrossV4ERC20Packed`, `encode_startBridgeTokensViaAcrossV4NativePacked`, `extractNonEVMAddress`, `FRAX_HOP`, `FRAX_PATH_USD`, `FRAX_TIP_FEE_MANAGER`, `getChainIdToAllBridgeChainId`, `getChainIdToDomainId`, `getChainIdToEid`, `getDeBridgeChainId`, `getFraxChainIdToEid`, `initDeBridgeDln`, `IS_HUB`, `isQuoteConsumed`, `LAYERSWAP_DEPOSITORY`, `LIFI_DISTRIBUTOR_CODE`, `LIFI_INTENT_ESCROW_SETTLER_V2`, `M0_ORDER_BOOK`, `MAYAN`, `MULTIPLIER_BASE`, `NATIVE_ADDRESS`, `PAXOS_TRANSIT_THIS_CHAIN_EID`, `POLYMER_FEE_RECEIVER`, `POOL_MANAGER`, `PORTAL`, `registerMegaETHBridge`, `registerOptimismBridge`, `RELAY_DEPOSITORY`, `setChainIdToAllBridgeChainId`, `setChainIdToDomainId`, `setChainIdToEid`, `setDeBridgeChainId`, `setFraxChainIdToEid`, `startBridgeTokensViaAcross`, `startBridgeTokensViaAcrossV4`, `startBridgeTokensViaAcrossV4ERC20Min`, `startBridgeTokensViaAcrossV4ERC20Packed`, `startBridgeTokensViaAcrossV4NativeMin`, `startBridgeTokensViaAcrossV4NativePacked`, `startBridgeTokensViaAcrossV4Swap`, `startBridgeTokensViaAllBridge`, `startBridgeTokensViaArbitrumBridge`, `startBridgeTokensViaCelerCircleBridge`, `startBridgeTokensViaCentrifuge`, `startBridgeTokensViaChainflip`, `startBridgeTokensViaDeBridgeDln`, `startBridgeTokensViaEco`, `startBridgeTokensViaFrax`, `startBridgeTokensViaGarden`, `startBridgeTokensViaGlacis`, `startBridgeTokensViaGnosisBridge`, `startBridgeTokensViaLayerSwap`, `startBridgeTokensViaLiFiIntentEscrowV2`, `startBridgeTokensViaM0`, `startBridgeTokensViaMayan`, `startBridgeTokensViaMegaETHBridge`, `startBridgeTokensViaNEARIntents`, `startBridgeTokensViaOmniBridge`, `startBridgeTokensViaOptimismBridge`, `startBridgeTokensViaPaxosTransit`, `startBridgeTokensViaPolygonBridge`, `startBridgeTokensViaPolymerCCTP`, `startBridgeTokensViaRelayDepository`, `startBridgeTokensViaStargate`, `startBridgeTokensViaSuperset`, `startBridgeTokensViaSymbiosis`, `startBridgeTokensViaThorSwap`, `startBridgeTokensViaUnit`, `swapAndStartBridgeTokensViaAcross`, `swapAndStartBridgeTokensViaAcrossV4`, `swapAndStartBridgeTokensViaAcrossV4Swap`, `swapAndStartBridgeTokensViaAllBridge`, `swapAndStartBridgeTokensViaArbitrumBridge`, `swapAndStartBridgeTokensViaCelerCircleBridge`, `swapAndStartBridgeTokensViaCentrifuge`, `swapAndStartBridgeTokensViaChainflip`, `swapAndStartBridgeTokensViaDeBridgeDln`, `swapAndStartBridgeTokensViaEco`, `swapAndStartBridgeTokensViaFrax`, `swapAndStartBridgeTokensViaGarden`, `swapAndStartBridgeTokensViaGlacis`, `swapAndStartBridgeTokensViaGnosisBridge`, `swapAndStartBridgeTokensViaLayerSwap`, `swapAndStartBridgeTokensViaLiFiIntentEscrowV2`, `swapAndStartBridgeTokensViaM0`, `swapAndStartBridgeTokensViaMayan`, `swapAndStartBridgeTokensViaMegaETHBridge`, `swapAndStartBridgeTokensViaNEARIntents`, `swapAndStartBridgeTokensViaOmniBridge`, `swapAndStartBridgeTokensViaOptimismBridge`, `swapAndStartBridgeTokensViaPaxosTransit`, `swapAndStartBridgeTokensViaPolygonBridge`, `swapAndStartBridgeTokensViaPolymerCCTP`, `swapAndStartBridgeTokensViaRelayDepository`, `swapAndStartBridgeTokensViaStargate`, `swapAndStartBridgeTokensViaSuperset`, `swapAndStartBridgeTokensViaSymbiosis`, `swapAndStartBridgeTokensViaThorSwap`, `swapAndStartBridgeTokensViaUnit`, `TOKEN_MESSENGER`, `tokenMessaging`, `TRANSIT_STATION`, `unsetChainIdToAllBridgeChainId`, `unsetChainIdToDomainId`, `unsetFraxChainIdToEid`, `USDC` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2`; not on this deployment: `callUniswap`, `callUniswapTo`, `callUniswapToWithPermit`, `callUniswapWithPermit`, `permit2`, `permit2DomainSeperator`, `permit2NextNonce`, `permit2NextNonceAfter`, `setPermit2`, `simpleSwap`, `swapGmxV2`, `uniswapV3SwapCallback`, `uniswapV3SwapTo`, `uniswapV3SwapToWithPermit` |
| [SpookySwap](../../sauce-protocols/references/registry/spookyswap.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `Spookyswap.V2Router` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
