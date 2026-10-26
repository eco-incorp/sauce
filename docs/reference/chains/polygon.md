<!-- Generated from the SDK's registries. Do not edit. -->

# Polygon

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Polygon: its tokens, and every protocol deployed there with the
> name a program writes for each contract. Polygon is a preview chain: programs compile here and the
> reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On Polygon a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `polygon`; also `matic`, `polygon-pos` |
| Chain id | 137 |
| Kind | EVM |
| Name in a program | `Polygon` |
| In TypeScript | `import { Polygon } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | MATIC (MATIC), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 7 |

## In a program

Compiled with `--chain polygon`, a program names Polygon's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDC` is Polygon's USDC: `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`.
  const held = USDC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(pot) == held);
  // `AaveV2.LendingPool` is Polygon's lendingPool: `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf`.
  require(AaveV2.LendingPool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Polygon.AaveV2.LendingPool == AaveV2.LendingPool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| `USDT0` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |
| `WETH` | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` | 18 |
| `WPOL` | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V2](../protocols/aave-v2.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool` |
| [Aave V3](../protocols/aave-v3.md) | pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | `AaveV3.PoolAddressesProvider` |
| [Across](../protocols/across.md) | spokePool | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` | `Across.SpokePool` |
| [Axelar](../protocols/axelar.md) | gateway | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` | `Axelar.Gateway` |
| [Axelar](../protocols/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Beefy Finance](../protocols/beefy.md) | BIFI | `0xFbdd194376De19A88f4a68671C339563C427310D` | `Beefy.BIFI` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Celer Network](../protocols/celer.md) | bridge | `0x88DCDC47D2f83a99CF0000FDF667A468bB958a78` | `Celer.Bridge` |
| [Chainlink CCIP](../protocols/chainlink-ccip.md) | router | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` | `ChainlinkCcip.Router` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` | `CompoundV3.CUSDCv3` |
| [Curve Finance](../protocols/curve.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Gains Network](../protocols/gains-network.md) | diamond | `0x209A9A01980377916851af2cA075C2b170452018` | `GainsNetwork.Diamond` |
| [Gamma Strategies](../protocols/gamma.md) | uniProxy | `0xA42d55074869491D60Ac05490376B74cF19B00e6` | `Gamma.UniProxy` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Hop Protocol](../protocols/hop.md) | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` | `Hop.L2AmmWrapper` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` | `Hyperlane.Mailbox` |
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
| [Polygon Native Bridge](../protocols/polygon-bridge.md) | childChainManager | `0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa` | `PolygonBridge.ChildChainManager` |
| [QuickSwap](../protocols/quickswap.md) | v2Factory | `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` | `Quickswap.V2Factory` |
| [QuickSwap](../protocols/quickswap.md) | v2Router | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` | `Quickswap.V2Router` |
| [QuickSwap](../protocols/quickswap.md) | v3Factory | `0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28` | `Quickswap.V3Factory` |
| [QuickSwap](../protocols/quickswap.md) | v3SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168E12` | `Quickswap.V3SwapRouter` |
| [Safe](../protocols/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Seaport](../protocols/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Superfluid](../protocols/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../protocols/superfluid.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Synapse Protocol](../protocols/synapse.md) | synapseBridge | `0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280` | `Synapse.SynapseBridge` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x67366782805870060151383F4BbFF9daB53e5cD6` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0x5eA1bD7974c8A611cBAB0bDCAFcB1D9CC9b3BA5a` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x1095692A6237d83C6a72F3F5eFEdb9A670C49223` | `UniswapV4.UniversalRouter` |
| [Wormhole](../protocols/wormhole.md) | coreBridge | `0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7` | `Wormhole.CoreBridge` |
| [Wormhole](../protocols/wormhole.md) | tokenBridge | `0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE` | `Wormhole.TokenBridge` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## Requesting support

To request Polygon, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Polygon%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Polygon+%28137%29&chain=Polygon&chain-id=137) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
