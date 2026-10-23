<!-- Generated from the SDK's registries. Do not edit. -->

# Avalanche C-Chain

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Avalanche C-Chain: its tokens, and every protocol deployed there
> with the name a program writes for each contract. Avalanche C-Chain is a preview chain: programs
> compile and simulate here, and the `sauce` command sends nothing.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Avalanche C-Chain a program
compiles and simulates (`sauce compile`, `sauce simulate`), but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and simulate; no transaction is built or sent |
| Slug (`--chain`) | `avalanche`; also `avax` |
| Chain id | 43114 |
| Kind | EVM |
| Name in a program | `Avalanche` |
| In TypeScript | `import { Avalanche } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | AVAX (AVAX), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 1 |

## In a program

Compiled with `--chain avalanche`, a program names Avalanche C-Chain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV2.LendingPool` is Avalanche C-Chain's lendingPool: `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C`.
  require(AaveV2.LendingPool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Avalanche.AaveV2.LendingPool == AaveV2.LendingPool);
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
| [Aave V2](../protocols/aave-v2.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool` |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Aave V4](../protocols/aave-v4.md) | avaxCorrelatedSpoke | `0x3b517594277c67307CF2d7CBE6FE1D4399B68c41` | `AaveV4.AvaxCorrelatedSpoke` |
| [Aave V4](../protocols/aave-v4.md) | coreHub | `0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6e` | `AaveV4.CoreHub` |
| [Aave V4](../protocols/aave-v4.md) | forexSpoke | `0x6a37776B5E026dBdF043b4F933c323C84DD1B514` | `AaveV4.ForexSpoke` |
| [Aave V4](../protocols/aave-v4.md) | mainSpoke | `0x435272CefF93a1E657E8ABfdf0A13e95900A3a56` | `AaveV4.MainSpoke` |
| [Axelar](../protocols/axelar.md) | gateway | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` | `Axelar.Gateway` |
| [Axelar](../protocols/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Beefy Finance](../protocols/beefy.md) | BIFI | `0xd6070ae98b8069de6B494332d1A1a81B6179D960` | `Beefy.BIFI` |
| [Benqi](../protocols/benqi.md) | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | `Benqi.Comptroller` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../protocols/celer.md) | bridge | `0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4` | `Celer.Bridge` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Curve Finance](../protocols/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [GMX V1](../protocols/gmx-v1.md) | router | `0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8` | `GmxV1.Router` |
| [GMX V1](../protocols/gmx-v1.md) | vault | `0x9ab2De34A33fB459b538c43f251eB825645e8595` | `GmxV1.Vault` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6` | `Hyperlane.Mailbox` |
| [KyberSwap](../protocols/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../protocols/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../protocols/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [1inch](../protocols/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../protocols/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [ParaSwap](../protocols/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../protocols/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Permit2](../protocols/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Synapse Protocol](../protocols/synapse.md) | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` | `Synapse.SynapseBridge` |
| [Trader Joe](../protocols/trader-joe.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Trader Joe](../protocols/trader-joe.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0x655C406EBFa14EE2006250925e54ec43AD184f8B` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x06380c0e0912312b5150364b9dc4542ba0dbbc85` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0xc3c9e198c735a4b97e3e683f391ccbdd60b69286` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x94b75331ae8d42c1b61065089b7d48fe14aa73b7` | `UniswapV4.UniversalRouter` |
| [Wormhole](../protocols/wormhole.md) | coreBridge | `0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c` | `Wormhole.CoreBridge` |
| [Wormhole](../protocols/wormhole.md) | tokenBridge | `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052` | `Wormhole.TokenBridge` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## Requesting support

To request Avalanche C-Chain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Avalanche+C-Chain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Avalanche+C-Chain+%2843114%29&chain=Avalanche+C-Chain&chain-id=43114) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
