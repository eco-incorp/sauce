<!-- Generated from the SDK's registries. Do not edit. -->

# Arbitrum One

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Arbitrum One: its tokens, and every protocol deployed there with
> the name a program writes for each contract. Arbitrum One is a preview chain: programs compile
> here and the reads work, and simulate runs wherever the release is deployed, but no transaction is
> built or sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Arbitrum One a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `arbitrum`; also `arb` |
| Chain id | 42161 |
| Kind | EVM |
| Name in a program | `Arbitrum` |
| In TypeScript | `import { Arbitrum } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 3 |

## In a program

Compiled with `--chain arbitrum`, a program names Arbitrum One's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDC` is Arbitrum One's USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV3.Pool` is Arbitrum One's pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Arbitrum.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| `USDT0` | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| `WETH` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Abracadabra](../protocols/abracadabra.md) | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` | `Abracadabra.DegenBox` |
| [Abracadabra](../protocols/abracadabra.md) | mim | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` | `Abracadabra.Mim` |
| [Across](../protocols/across.md) | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `Across.SpokePool` |
| [Arbitrum Native Bridge](../protocols/arbitrum-bridge.md) | l2GatewayRouter | `0x5288c571Fd7aD117beA99bF60FE0846C4E84F933` | `ArbitrumBridge.L2GatewayRouter` |
| [Axelar](../protocols/axelar.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Axelar](../protocols/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Beefy Finance](../protocols/beefy.md) | BIFI | `0x99C409E5f62E4bd2AC142f17caFb6810B8F0BAAE` | `Beefy.BIFI` |
| [Camelot](../protocols/camelot.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | `Camelot.V2Factory` |
| [Camelot](../protocols/camelot.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `Camelot.V2Router` |
| [Camelot](../protocols/camelot.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | `Camelot.V3Factory` |
| [Camelot](../protocols/camelot.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `Camelot.V3SwapRouter` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../protocols/celer.md) | bridge | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` | `Celer.Bridge` |
| [Chainlink CCIP](../protocols/chainlink-ccip.md) | router | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` | `ChainlinkCcip.Router` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `CompoundV3.CUSDCv3` |
| [Compound V3](../protocols/compound-v3.md) | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `CompoundV3.CUSDTv3` |
| [Connext (Everclear)](../protocols/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [CoW Swap](../protocols/cowswap.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [Curve Finance](../protocols/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Curve Finance](../protocols/curve.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `Curve.RouterNG` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Fluid](../protocols/fluid.md) | liquidity | `0x52Aa899454998Be5b000Ad077a46Bbe360F4e497` | `Fluid.Liquidity` |
| [Gains Network](../protocols/gains-network.md) | diamond | `0xFF162c694eAA571f685030649814282eA457f169` | `GainsNetwork.Diamond` |
| [Gains Network](../protocols/gains-network.md) | gns | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` | `GainsNetwork.Gns` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [GMX V1](../protocols/gmx-v1.md) | glp | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` | `GmxV1.Glp` |
| [GMX V1](../protocols/gmx-v1.md) | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` | `GmxV1.PositionRouter` |
| [GMX V1](../protocols/gmx-v1.md) | router | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` | `GmxV1.Router` |
| [GMX V1](../protocols/gmx-v1.md) | vault | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | `GmxV1.Vault` |
| [GMX V2](../protocols/gmx-v2.md) | dataStore | `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8` | `GmxV2.DataStore` |
| [GMX V2](../protocols/gmx-v2.md) | exchangeRouter | `0x7dE39FF2e232A2203196788d37e234cF8F1b83f1` | `GmxV2.ExchangeRouter` |
| [Hegic](../protocols/hegic.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | `Hegic.Hegic` |
| [Hegic](../protocols/hegic.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `Hegic.OperationalTreasury` |
| [Hop Protocol](../protocols/hop.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `Hop.L2AmmWrapper` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `Hyperlane.Mailbox` |
| [KyberSwap](../protocols/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../protocols/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../protocols/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Level Finance](../protocols/level-finance.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LevelFinance.LiquidityPool` |
| [Lido](../protocols/lido.md) | wstETH | `0x5979D7b546E38E414F7E9822514be443A4800529` | `Lido.WstETH`; not on this deployment: `wrap`, `unwrap`, `getStETHByWstETH`, `getWstETHByStETH` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Maverick](../protocols/maverick.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Maverick](../protocols/maverick.md) | v2Router | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` | `Maverick.V2Router` |
| [MUX Protocol](../protocols/mux-protocol.md) | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` | `MuxProtocol.LiquidityPool` |
| [MUX Protocol](../protocols/mux-protocol.md) | orderBook | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` | `MuxProtocol.OrderBook` |
| [1inch](../protocols/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../protocols/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | smartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | `PancakeswapV3.SmartRouter` |
| [ParaSwap](../protocols/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../protocols/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Pendle](../protocols/pendle.md) | router | `0x888888888889758F76e7103c6CbF23ABbF58F946` | `Pendle.Router` |
| [Permit2](../protocols/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Premia](../protocols/premia.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | `Premia.PoolFactory` |
| [Radiant](../protocols/radiant.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `Radiant.LendingPool`; not on this deployment: `deposit`, `withdraw`, `borrow`, `repay` |
| [Ramses](../protocols/ramses.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `Ramses.Router` |
| [Safe](../protocols/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Seaport](../protocols/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Silo](../protocols/silo.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `Silo.SiloRepository` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Stargate](../protocols/stargate.md) | poolNative | `0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F` | `Stargate.PoolNative` |
| [Stargate](../protocols/stargate.md) | poolUSDC | `0xe8CDF27AcD73a434D661C84887215F7598e7d0d3` | `Stargate.PoolUSDC` |
| [Superfluid](../protocols/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../protocols/superfluid.md) | host | `0xCf8Acb4eF033efF16E8080aed4c7D5B9285D2192` | `Superfluid.Host` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Synapse Protocol](../protocols/synapse.md) | synapseBridge | `0x6F4e8eBa4D337f874Ab57478AcC2Cb5BACdc19c9` | `Synapse.SynapseBridge` |
| [Trader Joe](../protocols/trader-joe.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Trader Joe](../protocols/trader-joe.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3` | `UniswapV4.UniversalRouter` |
| [Vertex](../protocols/vertex.md) | clearinghouse | `0x773BB71B0108b060b76746422eE810Bfec9A963d` | `Vertex.Clearinghouse` |
| [Vertex](../protocols/vertex.md) | endpoint | `0x73EAB16c88B9f38d3f2661C9e5875Ec0eEEE2965` | `Vertex.Endpoint` |
| [Wormhole](../protocols/wormhole.md) | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` | `Wormhole.CoreBridge` |
| [Wormhole](../protocols/wormhole.md) | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` | `Wormhole.TokenBridge` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## Requesting support

To request Arbitrum One, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Arbitrum+One%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Arbitrum+One+%2842161%29&chain=Arbitrum+One&chain-id=42161) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
