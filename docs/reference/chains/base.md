<!-- Generated from the SDK's registries. Do not edit. -->

# Base

**Reference** · [Documentation](../../README.md) · [Chains](../chains.md)

> Everything a program can name on Base: its tokens, and every protocol deployed there with the name
> a program writes for each contract. The `sauce` command builds and sends transactions on Base.

**Supported.** Sauce supports transactions on Ethereum, Base, Arc and Solana, and the testnets Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and Solana Testnet. On Base a program compiles
and simulates, and the `sauce` command and the MCP server build its transactions and send
them.

| Fact | Value |
| --- | --- |
| Support | supported: transactions are built and sent |
| Slug (`--chain`) | `base` |
| Chain id | 8453 |
| Kind | EVM |
| Name in a program | `Base` |
| In TypeScript | `import { Base } from "@eco-incorp/sauce"`: its tokens and protocol namespaces are properties of it |
| Native coin | ETH (Ether), 18 decimals |
| Sauce | the engine, Kitchen and Routers, at the same addresses on every EVM chain: [Deployments](../deployments.md) |
| CCTP domain | 6 |

## Notes

Base's own documentation: `eth_call` and `eth_estimateGas` against the `pending` block tag see
Flashblocks state, so a read right after a send uses `pending` to see it.

## In a program

Compiled with `--chain base`, a program names Base's tokens and contracts with no
import; the same file compiled for another chain resolves each name there, or fails where the
chain does not have it.

```ts
function main() {
  // `USDC` is Base's USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
  const held = USDC.balanceOf(pot);
  // `Token(address)` is any other ERC-20, and works for a symbol's address too.
  require(Token(USDC).balanceOf(pot) == held);
  // `AaveV3.Pool` is Base's pool: `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`.
  require(AaveV3.Pool != 0);
  // The same contract, qualified by the chain's name, from a program on any chain.
  require(Base.AaveV3.Pool == AaveV3.Pool);
}
```

## Tokens

| Symbol | Address | Decimals |
| --- | --- | --- |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| `WETH` | `0x4200000000000000000000000000000000000006` | 18 |

And 67 tokenized stocks, each named by its symbol in the same way: they are in
[Base stock tokens](base-stocks.md), with their addresses.

## Protocols

Every protocol the registry records here, each contract with how a program names it: its
namespace contract, or its ABI imported from `./protocols/<slug>/<Export>.json` and bound to the
address.

| Protocol | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Aave V3](../protocols/aave-v3.md) | pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `AaveV3.Pool` |
| [Aave V3](../protocols/aave-v3.md) | poolAddressesProvider | `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D` | `AaveV3.PoolAddressesProvider` |
| [Aave V4](../protocols/aave-v4.md) | equitiesHub | `0xa4d5947Eb727A052bae69C593FfC84247EC9864E` | `AaveV4.EquitiesHub` |
| [Aave V4](../protocols/aave-v4.md) | mag7Spoke | `0x17905Db0e4A3514467539956c084180616AE7B8D` | `AaveV4.Mag7Spoke` |
| [Across](../protocols/across.md) | spokePool | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `Across.SpokePool` |
| [Aerodrome](../protocols/aerodrome.md) | poolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | `Aerodrome.PoolFactory` |
| [Aerodrome](../protocols/aerodrome.md) | router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | `Aerodrome.Router` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | clFactory | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `AerodromeSlipstream.CLFactory` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | clFactoryGaugeCaps | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | `AerodromeSlipstream.CLFactoryGaugeCaps` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | clFactoryGaugesV3 | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | `AerodromeSlipstream.CLFactoryGaugesV3` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | nonfungiblePositionManager | `0x827922686190790b37229fd06084350E74485b72` | `AerodromeSlipstream.NonfungiblePositionManager` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | nonfungiblePositionManagerGaugeCaps | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | `AerodromeSlipstream.NonfungiblePositionManagerGaugeCaps` |
| [Aerodrome Slipstream](../protocols/aerodrome-slipstream.md) | nonfungiblePositionManagerGaugesV3 | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | `AerodromeSlipstream.NonfungiblePositionManagerGaugesV3` |
| [Axelar](../protocols/axelar.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Axelar](../protocols/axelar.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Balancer V2](../protocols/balancer-v2.md) | vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | `BalancerV2.Vault` |
| [Base Native Bridge](../protocols/base-bridge.md) | l2StandardBridge | `0x4200000000000000000000000000000000000010` | `BaseBridge.L2StandardBridge` |
| [BaseSwap](../protocols/baseswap.md) | v2Router | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` | `Baseswap.V2Router` |
| [Coinbase Wrapped Staked ETH](../protocols/cbeth.md) | cbETH | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | `Cbeth.CbETH`; not on this deployment: `exchangeRate` |
| [CCTP](../protocols/cctp.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Chainlink CCIP](../protocols/chainlink-ccip.md) | router | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `ChainlinkCcip.Router` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Circle Gateway](../protocols/circle-gateway.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Compound V3](../protocols/compound-v3.md) | cUSDCv3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `CompoundV3.CUSDCv3` |
| [Compound V3](../protocols/compound-v3.md) | cWETHv3 | `0x46e6b214b524310239732D51387075E0e70970bf` | `CompoundV3.CWETHv3` |
| [Connext (Everclear)](../protocols/connext.md) | everclearSpoke | `0xa05A3380889115bf313f1Db9d5f335157Be4D816` | `Connext.EverclearSpoke` |
| [Curve Finance](../protocols/curve.md) | routerNG | `0x4f37A9d177470499A2dD084621020b023fcffc1F` | `Curve.RouterNG` |
| [deBridge](../protocols/debridge.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [deBridge](../protocols/debridge.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Gelato Network](../protocols/gelato.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Hop Protocol](../protocols/hop.md) | l2AmmWrapper | `0x10541b07d8Ad2647Dc6cD67abd4c03575dade261` | `Hop.L2AmmWrapper` |
| [Hyperlane](../protocols/hyperlane.md) | mailbox | `0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D` | `Hyperlane.Mailbox` |
| [KyberSwap](../protocols/kyberswap.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [KyberSwap Aggregator](../protocols/kyberswap-aggregator.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [LayerZero](../protocols/layerzero.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [LI.FI](../protocols/lifi.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Maverick](../protocols/maverick.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Maverick](../protocols/maverick.md) | v2Router | `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527` | `Maverick.V2Router` |
| [Moonwell](../protocols/moonwell.md) | comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | `Moonwell.Comptroller` |
| [Morpho Blue](../protocols/morpho-blue.md) | morpho | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | `MorphoBlue.Morpho` |
| [1inch](../protocols/oneinch.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [PancakeSwap V2](../protocols/pancakeswap-v2.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [PancakeSwap V3](../protocols/pancakeswap-v3.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |
| [ParaSwap](../protocols/paraswap.md) | augustusV5 | `0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57` | `Paraswap.AugustusV5`; not on this deployment: `simpleSwap` |
| [ParaSwap](../protocols/paraswap.md) | augustusV6 | `0x6A000F20005980200259B80c5102003040001068` | `Paraswap.AugustusV6` |
| [Permit2](../protocols/permit2.md) | permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `Permit2.Permit2` |
| [Safe](../protocols/safe.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Seaport](../protocols/seaport.md) | seaportV16 | `0x0000000000000068F116a894984e2DB1123eB395` | `Seaport.SeaportV16` |
| [Socket](../protocols/socket.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Squid Router](../protocols/squid.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Stargate](../protocols/stargate.md) | poolNative | `0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7` | `Stargate.PoolNative` |
| [Stargate](../protocols/stargate.md) | poolUSDC | `0x27a16dc786820B16E5c9028b75B99F6f604b5d26` | `Stargate.PoolUSDC` |
| [Superfluid](../protocols/superfluid.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Superfluid](../protocols/superfluid.md) | host | `0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74` | `Superfluid.Host` |
| [Synapse Protocol](../protocols/synapse.md) | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` | `Synapse.SynapseBridge` |
| [Synthetix V3](../protocols/synthetix-v3.md) | coreProxy | `0x32C222A9A159782aFD7529c87FA34b96CA72C696` | `SynthetixV3.CoreProxy` |
| [Synthetix V3](../protocols/synthetix-v3.md) | perpsMarketProxy | `0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce` | `SynthetixV3.PerpsMarketProxy` |
| [Uniswap V2](../protocols/uniswap-v2.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [Uniswap V2](../protocols/uniswap-v2.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Uniswap V3](../protocols/uniswap-v3.md) | factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `UniswapV3.Factory` |
| [Uniswap V3](../protocols/uniswap-v3.md) | nonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | `UniswapV3.NonfungiblePositionManager` |
| [Uniswap V3](../protocols/uniswap-v3.md) | quoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | `UniswapV3.QuoterV2` |
| [Uniswap V3](../protocols/uniswap-v3.md) | swapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | `UniswapV3.SwapRouter02` |
| [Uniswap V4](../protocols/uniswap-v4.md) | poolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `UniswapV4.PoolManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | positionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | `UniswapV4.PositionManager` |
| [Uniswap V4](../protocols/uniswap-v4.md) | stateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | `UniswapV4.StateView` |
| [Uniswap V4](../protocols/uniswap-v4.md) | universalRouter | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | `UniswapV4.UniversalRouter` |
| [Wormhole](../protocols/wormhole.md) | coreBridge | `0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6` | `Wormhole.CoreBridge` |
| [Wormhole](../protocols/wormhole.md) | tokenBridge | `0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627` | `Wormhole.TokenBridge` |
| [0x Protocol](../protocols/zerox.md) | exchangeProxy | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | `Zerox.ExchangeProxy` |

## Next

- [Chains](../chains.md): every other chain, with its support.
- [Names and registries](../../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
