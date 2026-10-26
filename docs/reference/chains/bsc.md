<!-- Generated from the SDK's registries. Do not edit. -->

# BNB Chain

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on BNB Chain: its tokens, and every protocol deployed there with the
> name a program writes for each contract. BNB Chain is a preview chain: programs compile here and
> the reads work, and simulate runs wherever the release is deployed, but no transaction is built or
> sent.

**Preview chain.** Sauce supports transactions on Ethereum, Base, Arc and Solana only. On BNB Chain a program
compiles (`sauce compile`) and the reads work (`sauce globals`, `sauce price`, `sauce pools`),
and `sauce simulate` runs wherever the release is deployed on the chain, but the `sauce`
command and the MCP server build and send no transaction: `sauce tx`, `sauce run` and
`sauce pot --deploy` are refused,
naming the supported chains and how to request this one (the last section).

| Fact | Value |
| --- | --- |
| Support | preview: compile and read; no transaction is built or sent |
| Slug (`--chain`) | `bsc`; also `bnb`, `binance-smart-chain`, `bnb-smart-chain` |
| Chain id | 56 |
| Kind | EVM |
| Name in a program | `Bsc` |
| In TypeScript | `import { Bsc } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | BNB (BNB), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |

## In a program

Compiled with `--chain bsc`, a program names BNB Chain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `AaveV3.Pool` is BNB Chain's pool: `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Bsc.AaveV3.Pool == AaveV3.Pool);
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
| [Aave V3](../protocols/aave-v3.md) | pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `AaveV3.Pool` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Beefy Finance](../protocols/beefy.md) | BIFI | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` | `Beefy.BIFI` |
| [Celer Network](../protocols/celer.md) | bridge | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` | `Celer.Bridge` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [DODO](../protocols/dodo.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9daf3bfa471c12d58486` | `Dodo.DODOV2Proxy` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `Hyperlane.Mailbox` |
| [KyberSwap](../protocols/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [KyberSwap](../protocols/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [KyberSwap](../protocols/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Level Finance](../protocols/level-finance.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LevelFinance.LiquidityPool` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [1inch](../protocols/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../protocols/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `Openocean.ExchangeV2` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [ParaSwap](../protocols/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5` |
| [ParaSwap](../protocols/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Permit2](../protocols/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../protocols/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Thena](../protocols/thena.md) | routerV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` | `Thena.RouterV2` |
| [Trader Joe](../protocols/trader-joe.md) | lbFactory | `0x8e42f2F4101563bF679975178e880FD87d3eFd4e` | `TraderJoe.LBFactory` |
| [Trader Joe](../protocols/trader-joe.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `TraderJoe.LBRouter` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x1906c1d672b88cD1B9aC7593301cA990F94Eae07` | `UniswapV4.UniversalRouter` |
| [Venus](../protocols/venus.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `Venus.Comptroller` |
| [Venus](../protocols/venus.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `Venus.VBNB` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## Requesting support

To request BNB Chain, look for [its existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22BNB+Chain%22) and add your
use case to it, or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+BNB+Chain+%2856%29&chain=BNB+Chain&chain-id=56) with the chain-support issue form.

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
