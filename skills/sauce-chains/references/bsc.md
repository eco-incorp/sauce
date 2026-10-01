<!-- Generated from the SDK's registries. Do not edit. -->

# BNB Chain

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `bsc`; also `bnb`, `binance-smart-chain`, `bnb-smart-chain` |
| Chain id | 56 |
| Kind | EVM |
| Name in a program | `Bsc` |
| Native coin | BNB (BNB), 18 decimals |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000064576f9C95a8623Bc0eff3db6d296ea6df` |
| Intent Executor | `0x645dADD5Bf354526b68A2befd9A305F7E03b91Ca` |
| Shared intent Pot | `0x48e8316d8084Ea76098257f32C431263b171744a`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |

## In a program

Compiled with `--chain bsc`, a program names BNB Chain's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=bsc
function main() {
  // `AaveV3.Pool` is BNB Chain's pool: `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`.
  require(AaveV3.Pool != 0n);
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
| [Aave V3](../../sauce-protocols/references/registry/aave-v3.md) | pool | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | `AaveV3.Pool` |
| [Balancer V2](../../sauce-protocols/references/registry/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2VaultABI.at(0xBA12222222228d8Ba445958a75a0704d566BF2C8n)` |
| [Beefy Finance](../../sauce-protocols/references/registry/beefy.md) | BIFI | `0xCa3F508B8e4Dd382eE878A314789373D80A5190A` | no registry ABI |
| [Celer Network](../../sauce-protocols/references/registry/celer.md) | bridge | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` | `CelerBridgeABI.at(0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aFn)` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `DlnDestinationABI.at(0xE7351Fd770A37282b91D153Ee690B63579D6dd7fn)` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `DlnSourceABI.at(0xeF4fB24aD0916217251F553c0596F8Edc630EB66n)` |
| [DODO](../../sauce-protocols/references/registry/dodo.md) | dodoV2Proxy | `0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486` | `DODOV2ProxyABI.at(0x8F8Dd7DB1bDA5eD3da8C9dAf3bFA471c12d58486n)` |
| [Gelato Network](../../sauce-protocols/references/registry/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Hyperlane](../../sauce-protocols/references/registry/hyperlane.md) | mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `HyperlaneMailboxABI.at(0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4n)` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Level Finance](../../sauce-protocols/references/registry/level-finance.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LiquidityPoolABI.at(0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874n)` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [1inch](../../sauce-protocols/references/registry/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [OpenOcean](../../sauce-protocols/references/registry/openocean.md) | exchangeV2 | `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` | `OpenOceanExchangeV2ABI.at(0x6352a56caadC4F1E25CD6c75970Fa768A3304e64n)` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../../sauce-protocols/references/registry/pancakeswap-v2.md) | router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [PancakeSwap V3](../../sauce-protocols/references/registry/pancakeswap-v3.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeSwapV3SmartRouterABI.at(0x13f4EA83D0bd40E75C8222255bc855a974568Dd4n)` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `AugustusV5ABI.at(0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57n)` |
| [ParaSwap](../../sauce-protocols/references/registry/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | no registry ABI |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Socket](../../sauce-protocols/references/registry/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Squid Router](../../sauce-protocols/references/registry/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `SquidRouterABI.at(0xce16F69375520ab01377ce7B88f5BA8C48F8D666n)` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [SushiSwap V2](../../sauce-protocols/references/registry/sushiswap-v2.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Thena](../../sauce-protocols/references/registry/thena.md) | routerV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` | `ThenaRouterABI.at(0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109n)` |
| [Trader Joe](../../sauce-protocols/references/registry/trader-joe.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `LBRouterABI.at(0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30n)` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x1906c1d672b88cd1b9ac7593301ca990f94eae07` | `UniswapV4.UniversalRouter` |
| [Venus](../../sauce-protocols/references/registry/venus.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `VenusComptrollerABI.at(0xfD36E2c2a6789Db23113685031d7F16329158384n)` |
| [Venus](../../sauce-protocols/references/registry/venus.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `VBNBABI.at(0xA07c5b74C9B40447a954e1466938b865b6BBea36n)` |
| [0x Protocol](../../sauce-protocols/references/registry/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `ExchangeProxyABI.at(0xDef1C0ded9bec7F1a1670819833240f027b25EfFn)` |
