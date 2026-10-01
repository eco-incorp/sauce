<!-- Generated from the SDK's registries. Do not edit. -->

# Ethereum

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `ethereum`; also `mainnet`, `eth` |
| Chain id | 1 |
| Kind | EVM |
| Name in a program | `Ethereum` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | `0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 0 |

## In a program

Compiled with `--chain ethereum`, a program names Ethereum's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=ethereum
function main() {
  // `USDC` is Ethereum's USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV2.LendingPool` is Ethereum's lendingPool: `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Ethereum.AaveV2.LendingPool == AaveV2.LendingPool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| `USDT` | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| `WETH` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |

And 1731 tokenized stocks, each named by its symbol in the same way: they are in
[ethereum-stocks.md](ethereum-stocks.md), with their addresses.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V2](../../sauce-protocols/references/registry/aave-v2.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `AaveV3.Pool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | `AaveV3.PoolAddressesProvider` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | bluechipSpoke | `0x973a023A77420ba610f06b3858aD991Df6d85A08` | `AaveV4.BluechipSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | coreHub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | `AaveV4.CoreHub` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | ethenaCorrelatedSpoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` | `AaveV4.EthenaCorrelatedSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | ethenaEcosystemSpoke | `0xba1B3D55D249692b669A164024A838309B7508AF` | `AaveV4.EthenaEcosystemSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | etherfiESpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | `AaveV4.EtherfiESpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | forexSpoke | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` | `AaveV4.ForexSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | globalDollarHub | `0x62d63197660c080236193CA60b70E49A08E90368` | `AaveV4.GlobalDollarHub` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | goldSpoke | `0x65407b940966954b23dfA3caA5C0702bB42984DC` | `AaveV4.GoldSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | kelpESpoke | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` | `AaveV4.KelpESpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | lidoESpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | `AaveV4.LidoESpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | lombardBtcSpoke | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` | `AaveV4.LombardBtcSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | mainSpoke | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` | `AaveV4.MainSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | paxgGoldSpoke | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` | `AaveV4.PaxgGoldSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | plusHub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | `AaveV4.PlusHub` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | primeHub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | `AaveV4.PrimeHub` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | usdgMapleESpoke | `0x774b9655413c34809c1f1b16b654465A89EBE989` | `AaveV4.UsdgMapleESpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | usdgPendleSpoke | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` | `AaveV4.UsdgPendleSpoke` |
| [Abracadabra](../../sauce-protocols/references/registry/abracadabra.md) | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` | `Abracadabra.DegenBox` |
| [Abracadabra](../../sauce-protocols/references/registry/abracadabra.md) | mim | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | `Abracadabra.Mim` |
| [Across](../../sauce-protocols/references/registry/across.md) | hubPool | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` | `Across.HubPool` |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `Across.SpokePool` |
| [Aevo](../../sauce-protocols/references/registry/aevo.md) | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` | `Aevo.DepositContract` |
| [Alchemix](../../sauce-protocols/references/registry/alchemix.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | `Alchemix.AlETH` |
| [Alchemix](../../sauce-protocols/references/registry/alchemix.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | `Alchemix.AlUSD` |
| [Alchemix](../../sauce-protocols/references/registry/alchemix.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `Alchemix.AlchemistAlETH` |
| [Alchemix](../../sauce-protocols/references/registry/alchemix.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94dd` | `Alchemix.AlchemistAlUSD` |
| [Ambient](../../sauce-protocols/references/registry/ambient.md) | crocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` | `Ambient.CrocSwapDex` |
| [Arbitrum Native Bridge](../../sauce-protocols/references/registry/arbitrum-bridge.md) | l1GatewayRouter | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` | `ArbitrumBridge.L1GatewayRouter` |
| [Arrakis Finance](../../sauce-protocols/references/registry/arrakis.md) | factory | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` | `Arrakis.Factory` |
| [Arrakis Finance](../../sauce-protocols/references/registry/arrakis.md) | router | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` | `Arrakis.Router` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `Axelar.GasService` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `Axelar.Gateway` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Base Native Bridge](../../sauce-protocols/references/registry/base-bridge.md) | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` | `BaseBridge.L1StandardBridge` |
| [Beefy Finance](../../sauce-protocols/references/registry/beefy.md) | BIFI | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` | `Beefy.BIFI` |
| [Coinbase Wrapped Staked ETH](../../sauce-protocols/references/registry/cbeth.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `Cbeth.CbETH` |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../../sauce-protocols/references/registry/celer.md) | bridge | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` | `Celer.Bridge` |
| [Chainlink](../../sauce-protocols/references/registry/chainlink.md) | ethUsdFeed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | `Chainlink.EthUsdFeed` |
| [Chainlink](../../sauce-protocols/references/registry/chainlink.md) | feedRegistry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | `Chainlink.FeedRegistry` |
| [Chainlink](../../sauce-protocols/references/registry/chainlink.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Chainlink CCIP](../../sauce-protocols/references/registry/chainlink-ccip.md) | router | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` | `ChainlinkCcip.Router` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V2](../../sauce-protocols/references/registry/compound-v2.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Compound V2](../../sauce-protocols/references/registry/compound-v2.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Compound V2](../../sauce-protocols/references/registry/compound-v2.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `CompoundV3.CUSDCv3` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | `CompoundV3.CUSDTv3` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | `CompoundV3.CWETHv3` |
| [Connext (Everclear)](../../sauce-protocols/references/registry/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Convex Finance](../../sauce-protocols/references/registry/convex.md) | booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | `Convex.Booster` |
| [Convex Finance](../../sauce-protocols/references/registry/convex.md) | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` | `Convex.CvxRewardPool` |
| [CoW Swap](../../sauce-protocols/references/registry/cowswap.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [crvUSD](../../sauce-protocols/references/registry/crvusd.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `Crvusd.CrvUSD` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [DODO](../../sauce-protocols/references/registry/dodo.md) | dodoV2Proxy | `0xa356867fDCeA8e71AEaf87805808803806231FDc` | `Dodo.DODOV2Proxy` |
| [EigenLayer](../../sauce-protocols/references/registry/eigenlayer.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `Eigenlayer.CbETHStrategy` |
| [EigenLayer](../../sauce-protocols/references/registry/eigenlayer.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `Eigenlayer.DelegationManager` |
| [EigenLayer](../../sauce-protocols/references/registry/eigenlayer.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `Eigenlayer.RETHStrategy` |
| [EigenLayer](../../sauce-protocols/references/registry/eigenlayer.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `Eigenlayer.StETHStrategy` |
| [EigenLayer](../../sauce-protocols/references/registry/eigenlayer.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `Eigenlayer.StrategyManager` |
| [ENS](../../sauce-protocols/references/registry/ens.md) | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | `Ens.BaseRegistrar` |
| [ENS](../../sauce-protocols/references/registry/ens.md) | registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | `Ens.Registry` |
| [Ethena](../../sauce-protocols/references/registry/ethena.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethena](../../sauce-protocols/references/registry/ethena.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1e68b3` | `Ethena.USDe` |
| [ether.fi](../../sauce-protocols/references/registry/etherfi.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `Etherfi.EETH` |
| [ether.fi](../../sauce-protocols/references/registry/etherfi.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `Etherfi.LiquidityPool` |
| [ether.fi](../../sauce-protocols/references/registry/etherfi.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `Etherfi.WeETH` |
| [Euler V2](../../sauce-protocols/references/registry/euler-v2.md) | ethereumVaultConnector | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` | `EulerV2.EthereumVaultConnector` |
| [Fluid](../../sauce-protocols/references/registry/fluid.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Frax Finance](../../sauce-protocols/references/registry/frax.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |
| [Frax Ether](../../sauce-protocols/references/registry/frax-ether.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FraxEther.FrxETHMinter` |
| [Frax Ether](../../sauce-protocols/references/registry/frax-ether.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `FraxEther.SfrxETH` |
| [Gamma Strategies](../../sauce-protocols/references/registry/gamma.md) | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` | `Gamma.UniProxyLegacy` |
| [Gelato Network](../../sauce-protocols/references/registry/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [GHO](../../sauce-protocols/references/registry/gho.md) | gho | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | `Gho.Gho` |
| [Harvest Finance](../../sauce-protocols/references/registry/harvest.md) | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` | `Harvest.Controller` |
| [Harvest Finance](../../sauce-protocols/references/registry/harvest.md) | depositHelper | `0xF8ce90c2710713552fb564869694B2505Bfc0846` | `Harvest.DepositHelper` |
| [Harvest Finance](../../sauce-protocols/references/registry/harvest.md) | farm | `0xa0246c9032bC3A600820415aE600c6388619A14D` | `Harvest.Farm` |
| [Hop Protocol](../../sauce-protocols/references/registry/hop.md) | l1EthBridge | `0xb8901acb165ed027e32754e0ffe830802919727f` | `Hop.L1EthBridge` |
| [Hop Protocol](../../sauce-protocols/references/registry/hop.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `Hop.L1UsdcBridge` |
| [Hyperlane](../../sauce-protocols/references/registry/hyperlane.md) | mailbox | `0xc005dc82818d67AF737725bD4bf75435d065D239` | `Hyperlane.Mailbox` |
| [Instadapp](../../sauce-protocols/references/registry/instadapp.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `Instadapp.FlashloanAggregator` |
| [Kelp DAO](../../sauce-protocols/references/registry/kelp.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `Kelp.LRTDepositPool` |
| [Kelp DAO](../../sauce-protocols/references/registry/kelp.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `Kelp.RsETH` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticFactory | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Lido](../../sauce-protocols/references/registry/lido.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Lido](../../sauce-protocols/references/registry/lido.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Linea Native Bridge](../../sauce-protocols/references/registry/linea-bridge.md) | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` | `LineaBridge.L1MessageService` |
| [Liquity V1](../../sauce-protocols/references/registry/liquity-v1.md) | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `LiquityV1.BorrowerOperations` |
| [Liquity V1](../../sauce-protocols/references/registry/liquity-v1.md) | lusd | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | `LiquityV1.Lusd` |
| [Liquity V2](../../sauce-protocols/references/registry/liquity-v2.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |
| [Maker](../../sauce-protocols/references/registry/maker.md) | dai | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | `Maker.Dai` |
| [Maker](../../sauce-protocols/references/registry/maker.md) | pot | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | `Maker.Pot` |
| [Maker](../../sauce-protocols/references/registry/maker.md) | sDAI | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | `Maker.SDAI` |
| [Maker](../../sauce-protocols/references/registry/maker.md) | usds | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | `Maker.Usds` |
| [Maker](../../sauce-protocols/references/registry/maker.md) | vat | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | `Maker.Vat` |
| [Mantle mETH](../../sauce-protocols/references/registry/mantle-meth.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `MantleMeth.METH` |
| [Mantle mETH](../../sauce-protocols/references/registry/mantle-meth.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `MantleMeth.Staking` |
| [Maverick](../../sauce-protocols/references/registry/maverick.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Maverick](../../sauce-protocols/references/registry/maverick.md) | v2Router | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` | `Maverick.V2Router` |
| [Morpho Blue](../../sauce-protocols/references/registry/morpho-blue.md) | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | `MorphoBlue.Bundler3` |
| [Morpho Blue](../../sauce-protocols/references/registry/morpho-blue.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [Olympus DAO](../../sauce-protocols/references/registry/olympus.md) | ohm | `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5` | `Olympus.Ohm` |
| [Olympus DAO](../../sauce-protocols/references/registry/olympus.md) | staking | `0xB63cac384247597756545b500253ff8E607a8020` | `Olympus.Staking` |
| [Olympus DAO](../../sauce-protocols/references/registry/olympus.md) | stakingHelper | `0xC8C436271f9A6F10a5B80c8b8eD7D0E8f37a612d` | `Olympus.StakingHelper` |
| [1inch](../../sauce-protocols/references/registry/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism Native Bridge](../../sauce-protocols/references/registry/optimism-bridge.md) | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | `OptimismBridge.L1StandardBridge` |
| [Opyn](../../sauce-protocols/references/registry/opyn.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Opyn](../../sauce-protocols/references/registry/opyn.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0x1097053Fd2ea711dad45caCcc45EfF7548fCB362` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0xEfF92A263d31888d860bD50809A8D171709b7b1c` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Pendle](../../sauce-protocols/references/registry/pendle.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Polygon Native Bridge](../../sauce-protocols/references/registry/polygon-bridge.md) | erc20Predicate | `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf` | `PolygonBridge.Erc20Predicate` |
| [Polygon Native Bridge](../../sauce-protocols/references/registry/polygon-bridge.md) | etherPredicate | `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30` | `PolygonBridge.EtherPredicate` |
| [Polygon Native Bridge](../../sauce-protocols/references/registry/polygon-bridge.md) | rootChainManager | `0xA0c68C638235ee32657e8f720a23ceC1bFc77C77` | `PolygonBridge.RootChainManager` |
| [Puffer Finance](../../sauce-protocols/references/registry/puffer.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Puffer Finance](../../sauce-protocols/references/registry/puffer.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Pyth Network](../../sauce-protocols/references/registry/pyth.md) | oracle | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` | `Pyth.Oracle` |
| [Reflexer](../../sauce-protocols/references/registry/reflexer.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `Reflexer.CoinJoin` |
| [Reflexer](../../sauce-protocols/references/registry/reflexer.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3a` | `Reflexer.ETHJoin` |
| [Reflexer](../../sauce-protocols/references/registry/reflexer.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | `Reflexer.Rai` |
| [Reflexer](../../sauce-protocols/references/registry/reflexer.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `Reflexer.SAFEEngine` |
| [Renzo](../../sauce-protocols/references/registry/renzo.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Renzo](../../sauce-protocols/references/registry/renzo.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |
| [Rocket Pool](../../sauce-protocols/references/registry/rocket-pool.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RocketPool.RETH` |
| [Rocket Pool](../../sauce-protocols/references/registry/rocket-pool.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketPool.RocketDepositPool` |
| [Sablier](../../sauce-protocols/references/registry/sablier.md) | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `Sablier.LockupLinear` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Scroll Native Bridge](../../sauce-protocols/references/registry/scroll-bridge.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Scroll Native Bridge](../../sauce-protocols/references/registry/scroll-bridge.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Seaport](../../sauce-protocols/references/registry/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Silo](../../sauce-protocols/references/registry/silo.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `Silo.SiloRepository` |
| [Socket](../../sauce-protocols/references/registry/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Sommelier](../../sauce-protocols/references/registry/sommelier.md) | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` | `Sommelier.CellarRouter` |
| [Spark](../../sauce-protocols/references/registry/spark.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Spark](../../sauce-protocols/references/registry/spark.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |
| [Squid Router](../../sauce-protocols/references/registry/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Stader](../../sauce-protocols/references/registry/stader.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `Stader.ETHx` |
| [Stader](../../sauce-protocols/references/registry/stader.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `Stader.StakePoolManager` |
| [Stargate](../../sauce-protocols/references/registry/stargate.md) | poolNative | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` | `Stargate.PoolNative` |
| [Stargate](../../sauce-protocols/references/registry/stargate.md) | poolUSDC | `0xc026395860Db2d07ee33e05fE50ed7bD583189C7` | `Stargate.PoolUSDC` |
| [Stargate](../../sauce-protocols/references/registry/stargate.md) | poolUSDT | `0x933597a323Eb81cAe705C5bC29985172fd5A3973` | `Stargate.PoolUSDT` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Swell](../../sauce-protocols/references/registry/swell.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `Swell.RswETH` |
| [Swell](../../sauce-protocols/references/registry/swell.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `Swell.SwETH` |
| [Synapse Protocol](../../sauce-protocols/references/registry/synapse.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | `Synapse.CctpRouter` |
| [Synapse Protocol](../../sauce-protocols/references/registry/synapse.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` | `Synapse.SynapseBridge` |
| [Tokemak](../../sauce-protocols/references/registry/tokemak.md) | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` | `Tokemak.AutopoolRegistry` |
| [Tokemak](../../sauce-protocols/references/registry/tokemak.md) | systemRegistry | `0x2218F90A98b0C070676f249EF44834686dAa4285` | `Tokemak.SystemRegistry` |
| [Tokemak](../../sauce-protocols/references/registry/tokemak.md) | toke | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` | `Tokemak.Toke` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `UniswapV4.StateView` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `UniswapV4.UniversalRouter` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` | `Wormhole.CoreBridge` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` | `Wormhole.TokenBridge` |
| [Yearn V3](../../sauce-protocols/references/registry/yearn-v3.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F` | `YearnV3.VaultFactory` |
| [0x Protocol](../../sauce-protocols/references/registry/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [zkSync Native Bridge](../../sauce-protocols/references/registry/zksync-bridge.md) | diamondProxy | `0x32400084C286CF3E17e7B677ea9583e60a000324` | `ZksyncBridge.DiamondProxy` |
