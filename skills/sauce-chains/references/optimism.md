<!-- Generated from the SDK's registries. Do not edit. -->

# Optimism

**Preview chain.** For the initial release, Sauce supports transactions on Ethereum, Base and Solana only.
On Optimism a program compiles and simulates (`sauce compile`, `sauce simulate`, the dry
runs), but the `sauce` command and the MCP server build and send no transaction: `sauce tx`,
`sauce run`, `sauce pot --deploy`, `sauce intent publish` and the intent steps sent here are
refused, naming the supported chains and how to request this one.

To request Optimism, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Optimism%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Optimism+%2810%29&chain=Optimism&chain-id=10) with the chain-support issue form.

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `optimism`; also `op`, `op-mainnet` |
| Chain id | 10 |
| Kind | EVM |
| Name in a program | `Optimism` |
| Native coin | ETH (Ether), 18 decimals |
| Sauce engine | `0xcF7A92abCC7Ede43277AcCBAfda910b8829bF9AD` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | `0x6340080a1967a03cAAD490a170828d4C59EE5983`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 2 |

## In a program

Compiled with `--chain optimism`, a program names Optimism's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=optimism
function main() {
  // `USDC` is Optimism's USDC: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`.
  const held = USDC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(ctx.self()) == held);
  // `AaveV3.Pool` is Optimism's pool: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Optimism.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| `USDT` | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 |
| `USDT0` | `0x01bFF41798a0BcF287b996046Ca68b395DbC1071` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0x6f26Bf09B1C792e3228e5467807a900A503c0281` | `Across.SpokePool` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Axelar](../../sauce-protocols/references/registry/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Beefy Finance](../../sauce-protocols/references/registry/beefy.md) | BIFI | `0x4E720DD3Ac5CFe1e1fbDE4935f386Bb1C66F4642` | `Beefy.BIFI` |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../../sauce-protocols/references/registry/celer.md) | bridge | `0x9D39Fc627A6d9d9F8C831c16995b209548cc3401` | `Celer.Bridge` |
| [Chainlink CCIP](../../sauce-protocols/references/registry/chainlink-ccip.md) | router | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` | `ChainlinkCcip.Router` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V3](../../sauce-protocols/references/registry/compound-v3.md) | cUSDCv3 | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` | `CompoundV3.CUSDCv3` |
| [Connext (Everclear)](../../sauce-protocols/references/registry/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Curve Finance](../../sauce-protocols/references/registry/curve.md) | routerNG | `0x0DCDED3545D565bA3B19E683431381007245d983` | `Curve.RouterNG` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Gelato Network](../../sauce-protocols/references/registry/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Hop Protocol](../../sauce-protocols/references/registry/hop.md) | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` | `Hop.L2AmmWrapper` |
| [Hyperlane](../../sauce-protocols/references/registry/hyperlane.md) | mailbox | `0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D` | `Hyperlane.Mailbox` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [1inch](../../sauce-protocols/references/registry/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [Optimism Native Bridge](../../sauce-protocols/references/registry/optimism-bridge.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `OptimismBridge.L2StandardBridge` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Perpetual Protocol](../../sauce-protocols/references/registry/perpetual-protocol.md) | clearingHouse | `0x82ac2CE43e33683c58BE4cDc40975E73aA50f459` | `PerpetualProtocol.ClearingHouse` |
| [Perpetual Protocol](../../sauce-protocols/references/registry/perpetual-protocol.md) | vault | `0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60` | `PerpetualProtocol.Vault` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Seaport](../../sauce-protocols/references/registry/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Socket](../../sauce-protocols/references/registry/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../../sauce-protocols/references/registry/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../../sauce-protocols/references/registry/superfluid.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` | `SushiswapV2.Router` |
| [Synapse Protocol](../../sauce-protocols/references/registry/synapse.md) | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` | `Synapse.SynapseBridge` |
| [Thales](../../sauce-protocols/references/registry/thales.md) | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` | `Thales.SpeedMarketsAMM` |
| [Thales](../../sauce-protocols/references/registry/thales.md) | thalesAMM | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` | `Thales.ThalesAMM` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` | `UniswapV2.Router` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0xc18a3169788f4f75a170290584eca6395c75ecdb` | `UniswapV4.StateView` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` | `UniswapV4.UniversalRouter` |
| [Velodrome](../../sauce-protocols/references/registry/velodrome.md) | poolFactory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | `Velodrome.PoolFactory` |
| [Velodrome](../../sauce-protocols/references/registry/velodrome.md) | routerV2 | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` | `Velodrome.RouterV2` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | coreBridge | `0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722` | `Wormhole.CoreBridge` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | tokenBridge | `0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b` | `Wormhole.TokenBridge` |
| [0x Protocol](../../sauce-protocols/references/registry/zerox.md) | exchangeProxy | `0xDEF1ABE32c034e558Cdd535791643C58a13aCC10` | `Zerox.ExchangeProxy` |
