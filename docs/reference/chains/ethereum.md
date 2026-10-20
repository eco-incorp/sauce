<!-- Generated from the SDK's registries. Do not edit. -->

# Ethereum

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Ethereum: its tokens, and every protocol deployed there with the
> name a program writes for each contract. The `sauce` command builds and sends transactions on
> Ethereum.

**Supported.** Sauce supports transactions on Ethereum, Base and Solana. On Ethereum a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `ethereum`; also `mainnet`, `eth` |
| Chain id | 1 |
| Kind | EVM |
| Name in a program | `Ethereum` |
| In TypeScript | `import { Ethereum } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | the Executor's Pot under salt zero, the same on every chain: [Deployments](../deployments.md#the-shared-intent-pot); the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 0 |

## In a program

Compiled with `--chain ethereum`, a program names Ethereum's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDC` is Ethereum's USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV2.LendingPool` is Ethereum's lendingPool: `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0);
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
[Ethereum stock tokens](ethereum-stocks.md), with their addresses.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V2](../protocols/aave-v2.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | `AaveV3.PoolAddressesProvider` |
| [Aave V4](../protocols/aave-v4.md) | bluechipSpoke | `0x973a023A77420ba610f06b3858aD991Df6d85A08` | `AaveV4.BluechipSpoke` |
| [Aave V4](../protocols/aave-v4.md) | coreHub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | `AaveV4.CoreHub` |
| [Aave V4](../protocols/aave-v4.md) | ethenaCorrelatedSpoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` | `AaveV4.EthenaCorrelatedSpoke` |
| [Aave V4](../protocols/aave-v4.md) | ethenaEcosystemSpoke | `0xba1B3D55D249692b669A164024A838309B7508AF` | `AaveV4.EthenaEcosystemSpoke` |
| [Aave V4](../protocols/aave-v4.md) | etherfiESpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | `AaveV4.EtherfiESpoke` |
| [Aave V4](../protocols/aave-v4.md) | forexSpoke | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` | `AaveV4.ForexSpoke` |
| [Aave V4](../protocols/aave-v4.md) | globalDollarHub | `0x62d63197660c080236193CA60b70E49A08E90368` | `AaveV4.GlobalDollarHub` |
| [Aave V4](../protocols/aave-v4.md) | goldSpoke | `0x65407b940966954b23dfA3caA5C0702bB42984DC` | `AaveV4.GoldSpoke` |
| [Aave V4](../protocols/aave-v4.md) | kelpESpoke | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` | `AaveV4.KelpESpoke` |
| [Aave V4](../protocols/aave-v4.md) | lidoESpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | `AaveV4.LidoESpoke` |
| [Aave V4](../protocols/aave-v4.md) | lombardBtcSpoke | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` | `AaveV4.LombardBtcSpoke` |
| [Aave V4](../protocols/aave-v4.md) | mainSpoke | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` | `AaveV4.MainSpoke` |
| [Aave V4](../protocols/aave-v4.md) | paxgGoldSpoke | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` | `AaveV4.PaxgGoldSpoke` |
| [Aave V4](../protocols/aave-v4.md) | plusHub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | `AaveV4.PlusHub` |
| [Aave V4](../protocols/aave-v4.md) | primeHub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | `AaveV4.PrimeHub` |
| [Aave V4](../protocols/aave-v4.md) | usdgMapleESpoke | `0x774b9655413c34809c1f1b16b654465A89EBE989` | `AaveV4.UsdgMapleESpoke` |
| [Aave V4](../protocols/aave-v4.md) | usdgPendleSpoke | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` | `AaveV4.UsdgPendleSpoke` |
| [Abracadabra](../protocols/abracadabra.md) | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` | `Abracadabra.DegenBox` |
| [Abracadabra](../protocols/abracadabra.md) | mim | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | `Abracadabra.Mim` |
| [Across](../protocols/across.md) | hubPool | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` | `Across.HubPool` |
| [Across](../protocols/across.md) | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `Across.SpokePool` |
| [Aevo](../protocols/aevo.md) | depositContract | `0x4082C9647c098a6493Fb499EaE63b5ce3259C574` | `Aevo.DepositContract` |
| [Alchemix](../protocols/alchemix.md) | alETH | `0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6` | `Alchemix.AlETH` |
| [Alchemix](../protocols/alchemix.md) | alUSD | `0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9` | `Alchemix.AlUSD` |
| [Alchemix](../protocols/alchemix.md) | alchemistAlETH | `0x062Bf725dC4cDF947aa79Ca2aaCCD4F385b13b5c` | `Alchemix.AlchemistAlETH` |
| [Alchemix](../protocols/alchemix.md) | alchemistAlUSD | `0x5C6374a2ac4EBC38DeA0Fc1F8716e5Ea1ADD94dd` | `Alchemix.AlchemistAlUSD` |
| [Ambient](../protocols/ambient.md) | crocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` | `Ambient.CrocSwapDex` |
| [Arbitrum Native Bridge](../protocols/arbitrum-bridge.md) | l1GatewayRouter | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` | `ArbitrumBridge.L1GatewayRouter` |
| [Arrakis Finance](../protocols/arrakis.md) | factory | `0xEA1aFf9dbFfD1580F6b81A3ad3589E66652dB7D9` | `Arrakis.Factory` |
| [Arrakis Finance](../protocols/arrakis.md) | router | `0x6aC8Bab8B775a03b8B72B2940251432442f61B94` | `Arrakis.Router` |
| [Axelar](../protocols/axelar.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `Axelar.GasService` |
| [Axelar](../protocols/axelar.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `Axelar.Gateway` |
| [Axelar](../protocols/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Base Native Bridge](../protocols/base-bridge.md) | l1StandardBridge | `0x3154Cf16ccdb4C6d922629664174b904d80F2C35` | `BaseBridge.L1StandardBridge` |
| [Beefy Finance](../protocols/beefy.md) | BIFI | `0xB1F1ee126e9c96231Cc3d3fAD7C08b4cf873b1f1` | `Beefy.BIFI` |
| [Coinbase Wrapped Staked ETH](../protocols/cbeth.md) | cbETH | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` | `Cbeth.CbETH` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../protocols/celer.md) | bridge | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` | `Celer.Bridge` |
| [Chainlink](../protocols/chainlink.md) | ethUsdFeed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | `Chainlink.EthUsdFeed` |
| [Chainlink](../protocols/chainlink.md) | feedRegistry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | `Chainlink.FeedRegistry` |
| [Chainlink](../protocols/chainlink.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Chainlink CCIP](../protocols/chainlink-ccip.md) | router | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` | `ChainlinkCcip.Router` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V2](../protocols/compound-v2.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Compound V2](../protocols/compound-v2.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Compound V2](../protocols/compound-v2.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `CompoundV3.CUSDCv3` |
| [Compound V3](../protocols/compound-v3.md) | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | `CompoundV3.CUSDTv3` |
| [Compound V3](../protocols/compound-v3.md) | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | `CompoundV3.CWETHv3` |
| [Connext (Everclear)](../protocols/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Convex Finance](../protocols/convex.md) | booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | `Convex.Booster` |
| [Convex Finance](../protocols/convex.md) | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` | `Convex.CvxRewardPool` |
| [CoW Swap](../protocols/cowswap.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [crvUSD](../protocols/crvusd.md) | crvusd | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` | `Crvusd.CrvUSD` |
| [Curve Finance](../protocols/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Curve Finance](../protocols/curve.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Curve Finance](../protocols/curve.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Curve Finance](../protocols/curve.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [DODO](../protocols/dodo.md) | dodoV2Proxy | `0xa356867fDCeA8e71AEaf87805808803806231FDc` | `Dodo.DODOV2Proxy` |
| [EigenLayer](../protocols/eigenlayer.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `Eigenlayer.CbETHStrategy` |
| [EigenLayer](../protocols/eigenlayer.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `Eigenlayer.DelegationManager` |
| [EigenLayer](../protocols/eigenlayer.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `Eigenlayer.RETHStrategy` |
| [EigenLayer](../protocols/eigenlayer.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `Eigenlayer.StETHStrategy` |
| [EigenLayer](../protocols/eigenlayer.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `Eigenlayer.StrategyManager` |
| [ENS](../protocols/ens.md) | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | `Ens.BaseRegistrar` |
| [ENS](../protocols/ens.md) | registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | `Ens.Registry` |
| [Ethena](../protocols/ethena.md) | susde | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` | `Ethena.Susde` |
| [Ethena](../protocols/ethena.md) | usde | `0x4c9EDD5852cd905f086C759E8383e09bff1e68b3` | `Ethena.USDe` |
| [ether.fi](../protocols/etherfi.md) | eETH | `0x35fA164735182de50811E8e2E824cFb9B6118ac2` | `Etherfi.EETH` |
| [ether.fi](../protocols/etherfi.md) | liquidityPool | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | `Etherfi.LiquidityPool` |
| [ether.fi](../protocols/etherfi.md) | weETH | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | `Etherfi.WeETH` |
| [Euler V2](../protocols/euler-v2.md) | ethereumVaultConnector | `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383` | `EulerV2.EthereumVaultConnector` |
| [Fluid](../protocols/fluid.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Frax Finance](../protocols/frax.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |
| [Frax Ether](../protocols/frax-ether.md) | frxETHMinter | `0xbAFA44EFE7901E04E39Dad13167D089C559c1138` | `FraxEther.FrxETHMinter` |
| [Frax Ether](../protocols/frax-ether.md) | sfrxETH | `0xac3E018457B222d93114458476f3E3416Abbe38F` | `FraxEther.SfrxETH` |
| [Gamma Strategies](../protocols/gamma.md) | uniProxy | `0xf5bfa20f4a77933fee0c7bb7f39e7642a070d599` | `Gamma.UniProxyLegacy` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [GHO](../protocols/gho.md) | gho | `0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f` | `Gho.Gho` |
| [Harvest Finance](../protocols/harvest.md) | controller | `0x222412af183BCeAdEFd72e4Cb1b71f1889953b1C` | `Harvest.Controller` |
| [Harvest Finance](../protocols/harvest.md) | depositHelper | `0xF8ce90c2710713552fb564869694B2505Bfc0846` | `Harvest.DepositHelper` |
| [Harvest Finance](../protocols/harvest.md) | farm | `0xa0246c9032bC3A600820415aE600c6388619A14D` | `Harvest.Farm` |
| [Hop Protocol](../protocols/hop.md) | l1EthBridge | `0xb8901acb165ed027e32754e0ffe830802919727f` | `Hop.L1EthBridge` |
| [Hop Protocol](../protocols/hop.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `Hop.L1UsdcBridge` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0xc005dc82818d67AF737725bD4bf75435d065D239` | `Hyperlane.Mailbox` |
| [Instadapp](../protocols/instadapp.md) | flashloanAggregator | `0xE6054aE0Dba269560061D736e7510Ce64fCD517d` | `Instadapp.FlashloanAggregator` |
| [Kelp DAO](../protocols/kelp.md) | lrtDepositPool | `0x036676389e48133B63a802f8635AD39E752D375D` | `Kelp.LRTDepositPool` |
| [Kelp DAO](../protocols/kelp.md) | rsETH | `0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7` | `Kelp.RsETH` |
| [KyberSwap](../protocols/kyberswap.md) | elasticFactory | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../protocols/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../protocols/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Lido](../protocols/lido.md) | stETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | `Lido.StETH` |
| [Lido](../protocols/lido.md) | wstETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | `Lido.WstETH` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Linea Native Bridge](../protocols/linea-bridge.md) | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` | `LineaBridge.L1MessageService` |
| [Liquity V1](../protocols/liquity-v1.md) | borrowerOperations | `0x24179CD81c9e782A4096035f7eC97fB8B783e007` | `LiquityV1.BorrowerOperations` |
| [Liquity V1](../protocols/liquity-v1.md) | lusd | `0x5f98805A4E8be255a32880FDeC7F6728C6568bA0` | `LiquityV1.Lusd` |
| [Liquity V2](../protocols/liquity-v2.md) | bold | `0x6440f144b7e50D6a8439336510312d2F54beB01D` | `LiquityV2.Bold` |
| [Maker](../protocols/maker.md) | dai | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | `Maker.Dai` |
| [Maker](../protocols/maker.md) | pot | `0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7` | `Maker.Pot` |
| [Maker](../protocols/maker.md) | sDAI | `0x83F20F44975D03b1b09e64809B757c47f942BEeA` | `Maker.SDAI` |
| [Maker](../protocols/maker.md) | usds | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` | `Maker.Usds` |
| [Maker](../protocols/maker.md) | vat | `0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B` | `Maker.Vat` |
| [Mantle mETH](../protocols/mantle-meth.md) | mETH | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` | `MantleMeth.METH` |
| [Mantle mETH](../protocols/mantle-meth.md) | staking | `0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f` | `MantleMeth.Staking` |
| [Maverick](../protocols/maverick.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Maverick](../protocols/maverick.md) | v2Router | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` | `Maverick.V2Router` |
| [Morpho Blue](../protocols/morpho-blue.md) | bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | `MorphoBlue.Bundler3` |
| [Morpho Blue](../protocols/morpho-blue.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [Olympus DAO](../protocols/olympus.md) | ohm | `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5` | `Olympus.Ohm` |
| [Olympus DAO](../protocols/olympus.md) | staking | `0xB63cac384247597756545b500253ff8E607a8020` | `Olympus.Staking` |
| [Olympus DAO](../protocols/olympus.md) | stakingHelper | `0xC8C436271f9A6F10a5B80c8b8eD7D0E8f37a612d` | `Olympus.StakingHelper` |
| [1inch](../protocols/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../protocols/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism Native Bridge](../protocols/optimism-bridge.md) | l1StandardBridge | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | `OptimismBridge.L1StandardBridge` |
| [Opyn](../protocols/opyn.md) | controller | `0x64187ae08781B09368e6253F9E94951243A493D5` | `Opyn.Controller` |
| [Opyn](../protocols/opyn.md) | oSQTH | `0xf1B99e3E573A1a9C5E6B2Ce818b617F0E664E86B` | `Opyn.OSQTH` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | factory | `0x1097053Fd2ea711dad45caCcc45EfF7548fCB362` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | router | `0xEfF92A263d31888d860bD50809A8D171709b7b1c` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [ParaSwap](../protocols/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../protocols/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Pendle](../protocols/pendle.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Permit2](../protocols/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Polygon Native Bridge](../protocols/polygon-bridge.md) | erc20Predicate | `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf` | `PolygonBridge.Erc20Predicate` |
| [Polygon Native Bridge](../protocols/polygon-bridge.md) | etherPredicate | `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30` | `PolygonBridge.EtherPredicate` |
| [Polygon Native Bridge](../protocols/polygon-bridge.md) | rootChainManager | `0xA0c68C638235ee32657e8f720a23ceC1bFc77C77` | `PolygonBridge.RootChainManager` |
| [Puffer Finance](../protocols/puffer.md) | pufETH | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Puffer Finance](../protocols/puffer.md) | pufferVault | `0xD9A442856C234a39a81a089C06451EBAa4306a72` | `Puffer.PufETH` |
| [Pyth Network](../protocols/pyth.md) | oracle | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` | `Pyth.Oracle` |
| [Reflexer](../protocols/reflexer.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `Reflexer.CoinJoin` |
| [Reflexer](../protocols/reflexer.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3a` | `Reflexer.ETHJoin` |
| [Reflexer](../protocols/reflexer.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | `Reflexer.Rai` |
| [Reflexer](../protocols/reflexer.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `Reflexer.SAFEEngine` |
| [Renzo](../protocols/renzo.md) | ezETH | `0xbf5495Efe5DB9ce00f80364C8B423567e58d2110` | `Renzo.EzETH` |
| [Renzo](../protocols/renzo.md) | restakeManager | `0x74a09653A083691711cF8215a6ab074BB4e99ef5` | `Renzo.RestakeManager` |
| [Rocket Pool](../protocols/rocket-pool.md) | rETH | `0xae78736Cd615f374D3085123A210448E74Fc6393` | `RocketPool.RETH` |
| [Rocket Pool](../protocols/rocket-pool.md) | rocketDepositPool | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` | `RocketPool.RocketDepositPool` |
| [Sablier](../protocols/sablier.md) | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `Sablier.LockupLinear` |
| [Safe](../protocols/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Safe](../protocols/safe.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l1GatewayRouter | `0xF8B1378579659D8F7EE5f3C929c2f3E332E41Fd6` | `ScrollBridge.L1GatewayRouter` |
| [Scroll Native Bridge](../protocols/scroll-bridge.md) | l1ScrollMessenger | `0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367` | `ScrollBridge.L1ScrollMessenger` |
| [Seaport](../protocols/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Silo](../protocols/silo.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `Silo.SiloRepository` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Sommelier](../protocols/sommelier.md) | cellarRouter | `0x6b7f87279982d919Bbf85182DDeAB179B366d8f2` | `Sommelier.CellarRouter` |
| [Spark](../protocols/spark.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Spark](../protocols/spark.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Stader](../protocols/stader.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `Stader.ETHx` |
| [Stader](../protocols/stader.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `Stader.StakePoolManager` |
| [Stargate](../protocols/stargate.md) | poolNative | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` | `Stargate.PoolNative` |
| [Stargate](../protocols/stargate.md) | poolUSDC | `0xc026395860Db2d07ee33e05fE50ed7bD583189C7` | `Stargate.PoolUSDC` |
| [Stargate](../protocols/stargate.md) | poolUSDT | `0x933597a323Eb81cAe705C5bC29985172fd5A3973` | `Stargate.PoolUSDT` |
| [Superfluid](../protocols/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../protocols/superfluid.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Swell](../protocols/swell.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `Swell.RswETH` |
| [Swell](../protocols/swell.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `Swell.SwETH` |
| [Synapse Protocol](../protocols/synapse.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | `Synapse.CctpRouter` |
| [Synapse Protocol](../protocols/synapse.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` | `Synapse.SynapseBridge` |
| [Tokemak](../protocols/tokemak.md) | autopoolRegistry | `0x7E5828a3A6Ae75426d739E798140513A2E2964E4` | `Tokemak.AutopoolRegistry` |
| [Tokemak](../protocols/tokemak.md) | systemRegistry | `0x2218F90A98b0C070676f249EF44834686dAa4285` | `Tokemak.SystemRegistry` |
| [Tokemak](../protocols/tokemak.md) | toke | `0x2e9d63788249371f1DFC918a52f8d799F4a38C94` | `Tokemak.Toke` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `UniswapV4.UniversalRouter` |
| [Wormhole](../protocols/wormhole.md) | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` | `Wormhole.CoreBridge` |
| [Wormhole](../protocols/wormhole.md) | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` | `Wormhole.TokenBridge` |
| [Yearn V3](../protocols/yearn-v3.md) | vaultFactory | `0x770D0d1Fb036483Ed4AbB6d53c1C89fb277D812F` | `YearnV3.VaultFactory` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |
| [zkSync Native Bridge](../protocols/zksync-bridge.md) | diamondProxy | `0x32400084C286CF3E17e7B677ea9583e60a000324` | `ZksyncBridge.DiamondProxy` |

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
