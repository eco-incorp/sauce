<!-- Generated from the SDK's registries. Do not edit. -->

# Gnosis

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet only. On Gnosis a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one.

To request Gnosis, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Gnosis%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Gnosis+%28100%29&chain=Gnosis&chain-id=100) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `gnosis`; also `xdai`, `gnosis-chain` |
| Chain id | 100 |
| Kind | EVM |
| Name in a program | `Gnosis` |
| Native coin | xDAI (xDAI), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [deployments.json](deployments.json) (`evm`) |

## In a program

Compiled with `--chain gnosis`, a program names Gnosis's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=gnosis
function main() {
  // `AaveV3.Oracle` is Gnosis's oracle: `0xeb0a051be10228213BAEb449db63719d6742F7c4`.
  require(AaveV3.Oracle != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Gnosis.AaveV3.Oracle == AaveV3.Oracle);
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | oracle | `0xeb0a051be10228213BAEb449db63719d6742F7c4` | `AaveV3.Oracle` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0xb50201558B00496A145fE76f7424749556E326D8` | `AaveV3.Pool`; not on this deployment: `borrow`, `dropReserve`, `liquidationCall`, `repay`, `repayWithATokens`, `repayWithPermit`, `resetIsolationModeTotalDebt`, `setUserUseReserveAsCollateral`, `supply`, `supplyWithPermit`, `withdraw` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0x36616cf17557639614c1cdDb356b1B83fc0B2132` | `AaveV3.PoolAddressesProvider` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond`; not on this deployment: `ACROSS_CHAIN_ID_SOLANA`, `addDex`, `approvedDexs`, `batchAddDex`, `batchRemoveDex`, `batchSetFunctionApprovalBySignature`, `chainflipVault`, `CIRCLE_BRIDGE_PROXY`, `decode_startBridgeTokensViaAcrossV4ERC20Packed`, `decode_startBridgeTokensViaAcrossV4NativePacked`, `DLN_SOURCE`, `encode_startBridgeTokensViaAcrossV4ERC20Packed`, `encode_startBridgeTokensViaAcrossV4NativePacked`, `executeCallViaAxelar`, `executeCallWithTokenViaAxelar`, `FRAX_HOP`, `FRAX_PATH_USD`, `FRAX_TIP_FEE_MANAGER`, `getChainIdToAllBridgeChainId`, `getChainIdToDomainId`, `getChainIdToEid`, `getFraxChainIdToEid`, `getWhitelistedAddresses`, `getWhitelistedFunctionSelectors`, `IS_HUB`, `isAddressWhitelisted`, `isFunctionApproved`, `isFunctionSelectorWhitelisted`, `isMigrated`, `LIFI_DISTRIBUTOR_CODE`, `M0_ORDER_BOOK`, `MAYAN`, `MULTIPLIER_BASE`, `PAXOS_TRANSIT_THIS_CHAIN_EID`, `POLYMER_FEE_RECEIVER`, `POOL_MANAGER`, `PORTAL`, `quoteLayerZeroFee`, `registerMegaETHBridge`, `registerOptimismBridge`, `registerRouters`, `relayer`, `removeDex`, `setChainIdToAllBridgeChainId`, `setChainIdToDomainId`, `setChainIdToEid`, `setChainName`, `setFraxChainIdToEid`, `setFunctionApprovalBySignature`, `setLayerZeroChainId`, `setWormholeChainId`, `setWormholeChainIds`, `standardizedBridgeCall`, `standardizedCall`, `standardizedSwapAndBridgeCall`, `standardizedSwapCall`, `startBridgeTokensViaAcross`, `startBridgeTokensViaAcrossV4`, `startBridgeTokensViaAcrossV4ERC20Min`, `startBridgeTokensViaAcrossV4ERC20Packed`, `startBridgeTokensViaAcrossV4NativeMin`, `startBridgeTokensViaAcrossV4NativePacked`, `startBridgeTokensViaAcrossV4Swap`, `startBridgeTokensViaAllBridge`, `startBridgeTokensViaArbitrumBridge`, `startBridgeTokensViaCBridge`, `startBridgeTokensViaCelerCircleBridge`, `startBridgeTokensViaCelerIM`, `startBridgeTokensViaCentrifuge`, `startBridgeTokensViaChainflip`, `startBridgeTokensViaEco`, `startBridgeTokensViaFrax`, `startBridgeTokensViaGarden`, `startBridgeTokensViaGnosisBridge`, `startBridgeTokensViaHyphen`, `startBridgeTokensViaLIFuel`, `startBridgeTokensViaM0`, `startBridgeTokensViaMayan`, `startBridgeTokensViaMegaETHBridge`, `startBridgeTokensViaMultichain`, `startBridgeTokensViaOptimismBridge`, `startBridgeTokensViaPaxosTransit`, `startBridgeTokensViaPolygonBridge`, `startBridgeTokensViaPolymerCCTP`, `startBridgeTokensViaSquid`, `startBridgeTokensViaSuperset`, `startBridgeTokensViaThorSwap`, `startBridgeTokensViaUnit`, `startBridgeTokensViaWormhole`, `swapAndStartBridgeTokensViaAcross`, `swapAndStartBridgeTokensViaAcrossV4`, `swapAndStartBridgeTokensViaAcrossV4Swap`, `swapAndStartBridgeTokensViaAllBridge`, `swapAndStartBridgeTokensViaArbitrumBridge`, `swapAndStartBridgeTokensViaCBridge`, `swapAndStartBridgeTokensViaCelerCircleBridge`, `swapAndStartBridgeTokensViaCelerIM`, `swapAndStartBridgeTokensViaCentrifuge`, `swapAndStartBridgeTokensViaChainflip`, `swapAndStartBridgeTokensViaEco`, `swapAndStartBridgeTokensViaFrax`, `swapAndStartBridgeTokensViaGarden`, `swapAndStartBridgeTokensViaGnosisBridge`, `swapAndStartBridgeTokensViaHyphen`, `swapAndStartBridgeTokensViaLIFuel`, `swapAndStartBridgeTokensViaM0`, `swapAndStartBridgeTokensViaMayan`, `swapAndStartBridgeTokensViaMegaETHBridge`, `swapAndStartBridgeTokensViaMultichain`, `swapAndStartBridgeTokensViaOptimismBridge`, `swapAndStartBridgeTokensViaPaxosTransit`, `swapAndStartBridgeTokensViaPolygonBridge`, `swapAndStartBridgeTokensViaPolymerCCTP`, `swapAndStartBridgeTokensViaSquid`, `swapAndStartBridgeTokensViaSuperset`, `swapAndStartBridgeTokensViaThorSwap`, `swapAndStartBridgeTokensViaUnit`, `swapAndStartBridgeTokensViaWormhole`, `swapTokensGeneric`, `TOKEN_MESSENGER`, `TRANSIT_STATION`, `triggerRefund`, `unsetChainIdToAllBridgeChainId`, `unsetChainIdToDomainId`, `unsetFraxChainIdToEid`, `updateAddressMappings`, `USDC` |
