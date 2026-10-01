<!-- Generated from the SDK's registries. Do not edit. -->

# Arbitrum One

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `arbitrum`; also `arb` |
| Chain id | 42161 |
| Kind | EVM |
| Name in a program | `Arbitrum` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000064576f9C95a8623Bc0eff3db6d296ea6df` |
| Intent Executor | `0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca` |
| Shared intent Pot | `0x48e8316d8084Ea76098257f32C431263b171744a`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 3 |

## In a program

Compiled with `--chain arbitrum`, a program names Arbitrum One's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=arbitrum
function main() {
  // `USDC` is Arbitrum One's USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV3.Pool` is Arbitrum One's pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`.
  require(AaveV3.Pool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Arbitrum.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| `WETH` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | no registry ABI |
| [Abracadabra](../../sauce-protocols/references/registry/abracadabra.md) | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` | `DegenBoxABI.at(0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38n)` |
| [Abracadabra](../../sauce-protocols/references/registry/abracadabra.md) | mim | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` | no registry ABI |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `AcrossSpokePoolABI.at(0xe35e9842fceaCA96570B734083f4a58e8F7C5f2An)` |
| [Arbitrum Native Bridge](../../sauce-protocols/references/registry/arbitrum-bridge.md) | l2GatewayRouter | `0x5288c571Fd7aD117beA99bF60FE0846C4E84F933` | no registry ABI |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `AxelarGatewayABI.at(0xe432150cce91c13a887f7D836923d5597adD8E31n)` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `AxelarITSABI.at(0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3Cn)` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2VaultABI.at(0xBA12222222228d8Ba445958a75a0704d566BF2C8n)` |
| [Beefy Finance](../../sauce-protocols/references/registry/beefy.md) | BIFI | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` | no registry ABI |
| [Camelot](../../sauce-protocols/references/registry/camelot.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | no registry ABI |
| [Camelot](../../sauce-protocols/references/registry/camelot.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `CamelotV2RouterABI.at(0xc873fEcbd354f5A56E00E710B90EF4201db2448dn)` |
| [Camelot](../../sauce-protocols/references/registry/camelot.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | no registry ABI |
| [Camelot](../../sauce-protocols/references/registry/camelot.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `CamelotV3SwapRouterABI.at(0x1F721E2E82F6676FCE4eA07A5958cF098D339e18n)` |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../../sauce-protocols/references/registry/celer.md) | bridge | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` | `CelerBridgeABI.at(0x1619DE6B6B20eD217a58d00f37B9d47C7663fecan)` |
| [Chainlink CCIP](../../sauce-protocols/references/registry/chainlink-ccip.md) | router | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` | `CCIPRouterABI.at(0x141fa059441E0ca23ce184B6A78bafD2A517DdE8n)` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `GatewayMinterABI.at(0x2222222d7164433c4C09B0b0D809a9b52C04C205n)` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `GatewayWalletABI.at(0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eEn)` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `CompoundV3.CometUSDC` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `CompoundV3.CometUSDT` |
| [Connext (Everclear)](../../sauce-protocols/references/registry/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `EverclearSpokeABI.at(0xa05A3380889115bf313f1Db9d5f335157Be4D816n)` |
| [CoW Swap](../../sauce-protocols/references/registry/cowswap.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `GPv2SettlementABI.at(0x9008D19f58AAbD9eD0D60971565AA8510560ab41n)` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `CurveAddressProviderABI.at(0x0000000022D53366457F9d5E68Ec105046FC4383n)` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `CurveRouterNGABI.at(0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0Dn)` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [Fluid](../../sauce-protocols/references/registry/fluid.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | no registry ABI |
| [Gains Network](../../sauce-protocols/references/registry/gains-network.md) | diamond | `0xFF162c694eAA571f685030649814282eA457f169` | `DiamondABI.at(0xFF162c694eAA571f685030649814282eA457f169n)` |
| [Gains Network](../../sauce-protocols/references/registry/gains-network.md) | gns | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` | no registry ABI |
| [Gelato Network](../../sauce-protocols/references/registry/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [GMX V1](../../sauce-protocols/references/registry/gmx-v1.md) | glp | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` | no registry ABI |
| [GMX V1](../../sauce-protocols/references/registry/gmx-v1.md) | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` | `PositionRouterABI.at(0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868n)` |
| [GMX V1](../../sauce-protocols/references/registry/gmx-v1.md) | router | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` | `RouterABI.at(0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064n)` |
| [GMX V1](../../sauce-protocols/references/registry/gmx-v1.md) | vault | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | `VaultABI.at(0x489ee077994B6658eAfA855C308275EAd8097C4An)` |
| [GMX V2](../../sauce-protocols/references/registry/gmx-v2.md) | dataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | no registry ABI |
| [GMX V2](../../sauce-protocols/references/registry/gmx-v2.md) | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `ExchangeRouterABI.at(0x7dE39FF2e232A2203196788d37e234cF8F1b83f1n)` |
| [Hegic](../../sauce-protocols/references/registry/hegic.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | no registry ABI |
| [Hegic](../../sauce-protocols/references/registry/hegic.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `HegicABI.at(0xec096ea6eB9aa5ea689b0CF00882366E92377371n)` |
| [Hop Protocol](../../sauce-protocols/references/registry/hop.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `HopL2AmmWrapperABI.at(0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417n)` |
| [Hyperlane](../../sauce-protocols/references/registry/hyperlane.md) | mailbox | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `HyperlaneMailboxABI.at(0x979Ca5202784112f4738403dBec5D0F3B9daabB9n)` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Level Finance](../../sauce-protocols/references/registry/level-finance.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LiquidityPoolABI.at(0x32B7bF19cb8b95C27E644183837813d4b595dcc6n)` |
| [Lido](../../sauce-protocols/references/registry/lido.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `WstETHABI.at(0x5979D7b546E38E414F7E9822514be443A4800529n)` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Maverick](../../sauce-protocols/references/registry/maverick.md) | v2Router | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` | `MaverickV2RouterABI.at(0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76n)` |
| [MUX Protocol](../../sauce-protocols/references/registry/mux-protocol.md) | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` | `LiquidityPoolABI.at(0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633n)` |
| [MUX Protocol](../../sauce-protocols/references/registry/mux-protocol.md) | orderBook | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` | `OrderBookABI.at(0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3n)` |
| [1inch](../../sauce-protocols/references/registry/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | smartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | `PancakeSwapV3SmartRouterABI.at(0x32226588378236Fd0c7c4053999F88aC0e5cAc77n)` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Pendle](../../sauce-protocols/references/registry/pendle.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Premia](../../sauce-protocols/references/registry/premia.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | no registry ABI |
| [Radiant](../../sauce-protocols/references/registry/radiant.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `RadiantLendingPoolABI.at(0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1n)` |
| [Ramses](../../sauce-protocols/references/registry/ramses.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `RamsesRouterABI.at(0xAAA87963EFeB6f7E0a2711F397663105Acb1805en)` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `SafeABI.at(0x3E5c63644E683549055b9Be8653de26E0B4CD36En)` |
| [Seaport](../../sauce-protocols/references/registry/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `SeaportABI.at(0x0000000000000068F116a894984e2DB1123eB395n)` |
| [Silo](../../sauce-protocols/references/registry/silo.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `SiloRepositoryABI.at(0x8658047e48CC09161f4152c79155Dac1d710Ff0an)` |
| [Socket](../../sauce-protocols/references/registry/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Squid Router](../../sauce-protocols/references/registry/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [Stargate](../../sauce-protocols/references/registry/stargate.md) | poolNative | `0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F` | `StargatePoolABI.at(0xA45B5130f36CDcA45667738e2a258AB09f4A5f7Fn)` |
| [Stargate](../../sauce-protocols/references/registry/stargate.md) | poolUSDC | `0xe8CDF27AcD73a434D661C84887215F7598e7d0d3` | `StargatePoolABI.at(0xe8CDF27AcD73a434D661C84887215F7598e7d0d3n)` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Synapse Protocol](../../sauce-protocols/references/registry/synapse.md) | synapseBridge | `0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9` | `SynapseBridgeABI.at(0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9n)` |
| [Trader Joe](../../sauce-protocols/references/registry/trader-joe.md) | lbRouter | `0x18556da13313f3532c54711497a8fedac273220e` | `LBRouterABI.at(0x18556da13313f3532c54711497a8fedac273220en)` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` | `UniswapV4.UniversalRouter` |
| [Vertex](../../sauce-protocols/references/registry/vertex.md) | clearinghouse | `0x773bb71b0108b060b76746422ee810bfec9a963d` | `ClearinghouseABI.at(0x773bb71b0108b060b76746422ee810bfec9a963dn)` |
| [Vertex](../../sauce-protocols/references/registry/vertex.md) | endpoint | `0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965` | `EndpointABI.at(0x73eab16c88b9f38d3f2661c9e5875ec0eeee2965n)` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` | `WormholeCoreBridgeABI.at(0xa5f208e072434bC67592E4C49C1B991BA79BCA46n)` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` | `WormholeTokenBridgeABI.at(0x0b2402144Bb366A632D14B83F244D2e0e21bD39cn)` |
| [0x Protocol](../../sauce-protocols/references/registry/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `ExchangeProxyABI.at(0xDef1C0ded9bec7F1a1670819833240f027b25EfFn)` |
