<!-- Generated from the SDK's registries. Do not edit. -->

# Arc

| Fact | Value |
| --- | --- |
| Slug (`--chain`) | `arc`; also `arc-mainnet`, `arc-network` |
| Chain id | 5042 |
| Kind | EVM |
| Name in a program | `Arc` |
| Native coin | USDC (USDC), 18 decimals; also the ERC-20 `USDC` (6 decimals), one balance |
| Sauce engine | `0x6785455AA479AA99D59357d7c9Fe14cba626F175` |
| Sauce Kitchen | `0x19845b22989150E6B09dE55a661295Dd9188506b` |
| Sauce Router | `0x9201aF06536Cb4819cf1F08aE7063c5997D87459` |
| Intents (eco-routes) | takes intents; Portal `0xEC000769A73b70e16f361a442292500b3BCf4A85` |
| Intent Executor | `0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082` |
| Shared intent Pot | `0xDd330394620fBFF4D0AdcfA33B0D7b3622Db15B0`: the Kitchen's `deployPot(<Executor>, 0x0)` creates it, from any account |
| CCTP domain | 26 |

## In a program

Compiled with `--chain arc`, a program names Arc's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```sauce chain=arc
function main() {
  // `EURC` is Arc's EURC: `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`.
  const held = EURC.balanceOf(ctx.self());
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(EURC).balanceOf(ctx.self()) == held);
  // `AaveV4.CoreHub` is Arc's coreHub: `0x17288dfc86205301064577b98B02b81017e6F79C`.
  require(AaveV4.CoreHub != 0n);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Arc.AaveV4.CoreHub == AaveV4.CoreHub);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `EURC` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 |
| `USDC` | `0x3600000000000000000000000000000000000000` | 6 |
| `USYC` | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 6 |
| `WETH` | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB` | 18 |

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | coreHub | `0x17288dfc86205301064577b98B02b81017e6F79C` | `AaveV4.CoreHub` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | forexSpoke | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` | `AaveV4.ForexSpoke` |
| [Aave V4](../../sauce-protocols/references/registry/aave-v4.md) | mainSpoke | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` | `AaveV4.MainSpoke` |
| [Across](../../sauce-protocols/references/registry/across.md) | spokePool | `0x9b4A302A548c7e313c2b74C461db7b84d3074A84` | `Across.SpokePool` |
| [Aerodrome Slipstream](../../sauce-protocols/references/registry/aerodrome-slipstream.md) | clFactory | `0xb89Df768aF2CFE637ceB352c587Fe8edAf491d03` | `AerodromeSlipstream.CLFactory` |
| [Aerodrome Slipstream](../../sauce-protocols/references/registry/aerodrome-slipstream.md) | metarouter | `0x7275FA44c67BbA8d921422e600B4ed396209c886` | `AerodromeSlipstream.Metarouter` |
| [Aerodrome Slipstream](../../sauce-protocols/references/registry/aerodrome-slipstream.md) | nonfungiblePositionManager | `0xc84bB45D43CD25D02b83B4C085eaA4e08da8f473` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [CCTP](../../sauce-protocols/references/registry/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Chainlink](../../sauce-protocols/references/registry/chainlink.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `Chainlink.EthUsdFeed` |
| [Chainlink CCIP](../../sauce-protocols/references/registry/chainlink-ccip.md) | router | `0xB79791184973589c38e114D43Eb8E4588C283A18` | `ChainlinkCcip.Router` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../../sauce-protocols/references/registry/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../../sauce-protocols/references/registry/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Hyperlane](../../sauce-protocols/references/registry/hyperlane.md) | mailbox | `0x7f50C5776722630a0024fAE05fDe8b47571D7B39` | `Hyperlane.Mailbox` |
| [KyberSwap](../../sauce-protocols/references/registry/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../../sauce-protocols/references/registry/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../../sauce-protocols/references/registry/layerzero.md) | endpointV2 | `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | `Layerzero.EndpointV2` |
| [LI.FI](../../sauce-protocols/references/registry/lifi.md) | lifiDiamond | `0xA4072583658Fae592A3506A42431cb6316a8d40b` | `Lifi.LiFiDiamond` |
| [Morpho Blue](../../sauce-protocols/references/registry/morpho-blue.md) | morpho | `0x34CD04070dD72b14E241112F6d83812Df5Af7fCD` | `MorphoBlue.Morpho` |
| [Permit2](../../sauce-protocols/references/registry/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Safe](../../sauce-protocols/references/registry/safe.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Seaport](../../sauce-protocols/references/registry/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Synthra V3](../../sauce-protocols/references/registry/synthra-v3.md) | factory | `0x6307fc239C7964942c1BfFE51930E55606619c74` | `SynthraV3.Factory` |
| [Synthra V3](../../sauce-protocols/references/registry/synthra-v3.md) | nonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` | `SynthraV3.NonfungiblePositionManager` |
| [Synthra V3](../../sauce-protocols/references/registry/synthra-v3.md) | quoterV2 | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` | `SynthraV3.QuoterV2` |
| [Synthra V3](../../sauce-protocols/references/registry/synthra-v3.md) | swapRouter02 | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` | `SynthraV3.SwapRouter02` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | factory | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` | `UniswapV2.Factory` |
| [Uniswap V2](../../sauce-protocols/references/registry/uniswap-v2.md) | router | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | `UniswapV2.Router` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | factory | `0xf0db7b58379503491d857dB50AC9ece64c653918` | `UniswapV3.Factory` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | nonfungiblePositionManager | `0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | quoterV2 | `0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../../sauce-protocols/references/registry/uniswap-v3.md) | swapRouter02 | `0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `UniswapV4.PoolManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | positionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | `UniswapV4.PositionManager` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | stateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | `UniswapV4.StateView` |
| [Uniswap V4](../../sauce-protocols/references/registry/uniswap-v4.md) | universalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | `UniswapV4.UniversalRouter` |
| [UnitFlow V3](../../sauce-protocols/references/registry/unitflow-v3.md) | factory | `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d` | `UnitflowV3.Factory` |
| [UnitFlow V3](../../sauce-protocols/references/registry/unitflow-v3.md) | quoter | `0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34` | `UnitflowV3.Quoter` |
| [UnitFlow V3](../../sauce-protocols/references/registry/unitflow-v3.md) | router | `0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410` | `UnitflowV3.Router` |
| [Wormhole](../../sauce-protocols/references/registry/wormhole.md) | coreBridge | `0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027` | `Wormhole.CoreBridge` |
