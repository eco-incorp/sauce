<!-- Generated from the SDK's registries. Do not edit. -->

# Protocols

**Reference** · [Documentation](../README.md)

> Every protocol a program can call by name, grouped by what it does: exchanges, lending markets,
> bridges, staking and more. Each one has a page with where it is deployed and the name a program
> writes for each of its contracts.

Every protocol the SDK registers, by category: how to choose between them, then each one with
its family, whether a program names it as a namespace (and on which chains), and where it is
deployed. Each protocol's page has what it is for and its pitfalls where the registry documents
them, its addresses per chain, how a program names each contract, and its ABI functions.

## DEX (29)

### Choosing between them

Inside a Sauce program, swap with `@sauce/router`'s function for the venue ([the `@sauce/router` reference](../api/router.md)), every
argument a run-time value, each returning what the recipient received and reverting below its
`minOut`. `uniswapV2` (Uniswap V2 and its forks' pairs), `curve`, `balancerV2`, `dodoV2`,
`traderJoeLB` and `woofi` pay the pool first and call it directly; `uniswapV3` (Uniswap V3 and its
forks: PancakeSwap V3, Aerodrome Slipstream, Algebra pools, Synthra, UnitFlow), `uniswapV4` and
`maverickV2` go through the Pot's Router, which answers the pool's callback. Choose by pool type:

- **Concentrated liquidity** (V3-style pools through `uniswapV3`, V4 pools through `uniswapV4`):
  several fee tiers per pair, and a price limit, so a fill can stop part way and leave the rest
  unspent.
- **Constant-product pairs** (Uniswap V2 and its forks through `uniswapV2`, Solidly-style volatile
  pools): one pool per pair, no price limit; a swap consumes its whole input, bounded only by its
  `minOut`.
- **Stable pools** (Curve through `curve`, Solidly-style stable pools): built for assets meant to
  trade near 1:1, with less price impact there than a constant-product pair.
- **One trade across several pools** under one limit: [the distributed swap](../guides/distributed-swap.md).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aerodrome](protocols/aerodrome.md) | — | `Aerodrome`: base | base |
| [Aerodrome Slipstream](protocols/aerodrome-slipstream.md) | — | `AerodromeSlipstream`: arc, base | arc, base |
| [Ambient](protocols/ambient.md) | — | `Ambient`: ethereum, scroll | ethereum, scroll |
| [Balancer V2](protocols/balancer-v2.md) | `Balancer` | `BalancerV2`: ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| [BaseSwap](protocols/baseswap.md) | — | `Baseswap`: base | base |
| [Camelot](protocols/camelot.md) | — | `Camelot`: arbitrum | arbitrum |
| [Curve Finance](protocols/curve.md) | — | `Curve`: ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| [DODO](protocols/dodo.md) | — | `Dodo`: ethereum, bsc | ethereum, bsc |
| [Fenix](protocols/fenix.md) | — | `Fenix`: blast | blast |
| [Kim](protocols/kim.md) | — | `Kim`: mode | mode |
| [KyberSwap](protocols/kyberswap.md) | — | `Kyberswap`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Lynex](protocols/lynex.md) | — | `Lynex`: linea | linea |
| [Maverick](protocols/maverick.md) | — | `Maverick`: ethereum, base, arbitrum | ethereum, base, arbitrum |
| [PancakeSwap V2](protocols/pancakeswap-v2.md) | `Pancakeswap` | `PancakeswapV2`: ethereum, bsc, monad, opbnb, base, arbitrum, linea | ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| [PancakeSwap V3](protocols/pancakeswap-v3.md) | `Pancakeswap` | `PancakeswapV3`: ethereum, bsc, base, arbitrum, linea | ethereum, bsc, base, arbitrum, linea |
| [QuickSwap](protocols/quickswap.md) | — | `Quickswap`: polygon | polygon |
| [Ramses](protocols/ramses.md) | — | `Ramses`: arbitrum | arbitrum |
| [SpookySwap](protocols/spookyswap.md) | — | `Spookyswap`: fantom | fantom |
| [SushiSwap V2](protocols/sushiswap-v2.md) | `Sushiswap` | `SushiswapV2`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [SyncSwap](protocols/syncswap.md) | — | `Syncswap`: zksync | zksync |
| [Synthra V3](protocols/synthra-v3.md) | `Synthra` | `SynthraV3`: arc | arc |
| [Thena](protocols/thena.md) | — | `Thena`: bsc | bsc |
| [Thruster](protocols/thruster.md) | — | `Thruster`: blast | blast |
| [Trader Joe](protocols/trader-joe.md) | — | `TraderJoe`: bsc, arbitrum, avalanche | bsc, arbitrum, avalanche |
| [Uniswap V2](protocols/uniswap-v2.md) | `Uniswap` | `UniswapV2`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| [Uniswap V3](protocols/uniswap-v3.md) | `Uniswap` | `UniswapV3`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| [Uniswap V4](protocols/uniswap-v4.md) | `Uniswap` | `UniswapV4`: ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| [UnitFlow V3](protocols/unitflow-v3.md) | `Unitflow` | `UnitflowV3`: arc | arc |
| [Velodrome](protocols/velodrome.md) | — | `Velodrome`: optimism | optimism |

## Aggregators (6)

### Choosing between them

An aggregator (1inch, ParaSwap, 0x, KyberSwap, OpenOcean) routes through many pools, but its
calldata comes from an off-chain quote made for one sender, amount and moment. A program can
take that calldata as a `main` input and pass it through, and must still check the output as a
balance delta against a minimum. CoW Swap settles signed orders in off-chain batch auctions, so
a program signs or cancels an order rather than swapping. When the program itself should choose
the route, use the pools directly ([the `@sauce/router` reference](../api/router.md)).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [CoW Swap](protocols/cowswap.md) | — | `Cowswap`: ethereum, arbitrum | ethereum, arbitrum |
| [KyberSwap Aggregator](protocols/kyberswap-aggregator.md) | — | `KyberswapAggregator`: ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [1inch](protocols/oneinch.md) | — | `Oneinch`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [OpenOcean](protocols/openocean.md) | — | `Openocean`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [ParaSwap](protocols/paraswap.md) | — | `Paraswap`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [0x Protocol](protocols/zerox.md) | — | `Zerox`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Lending (16)

### Choosing between them

- **One pool, many reserves** (Aave V2 and V3 and their forks Spark, Radiant, ZeroLend):
  supply and borrow any listed reserve against all your collateral in that market.
- **One base asset per market** (Compound V3, a Comet per base asset): you borrow only that
  asset, against the market's listed collaterals.
- **Isolated markets** (Morpho Blue, Silo): each market pairs one collateral with one loan asset
  and its own oracle, so one market's risk does not reach another.
- **A token per asset** (Compound V2 and its forks Moonwell, Benqi, Venus, LayerBank): supply
  mints a cToken, and the market's comptroller decides borrowing power.
- **Others**: Aave V4 addresses reserves by id on a spoke; Euler V2 is ERC-4626 vaults under one
  controller; Fluid shares one liquidity layer.

Supplying needs an approval to the market. Borrowing is bounded by collateral factors and oracle
prices, and a position below its liquidation threshold can be liquidated by anyone.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aave V2](protocols/aave-v2.md) | `Aave` | `AaveV2`: ethereum, polygon, avalanche | ethereum, polygon, avalanche |
| [Aave V3](protocols/aave-v3.md) | `Aave` | `AaveV3`: ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| [Aave V4](protocols/aave-v4.md) | `Aave` | `AaveV4`: ethereum, arc, base, avalanche | ethereum, arc, base, avalanche |
| [Benqi](protocols/benqi.md) | — | `Benqi`: avalanche | avalanche |
| [Compound V2](protocols/compound-v2.md) | `Compound` | `CompoundV2`: ethereum | ethereum |
| [Compound V3](protocols/compound-v3.md) | `Compound` | `CompoundV3`: ethereum, optimism, polygon, base, arbitrum, scroll | ethereum, optimism, polygon, base, arbitrum, scroll |
| [Euler V2](protocols/euler-v2.md) | `Euler` | `EulerV2`: ethereum | ethereum |
| [Fluid](protocols/fluid.md) | — | `Fluid`: ethereum, arbitrum | ethereum, arbitrum |
| [LayerBank](protocols/layerbank.md) | — | `Layerbank`: scroll | scroll |
| [Moonwell](protocols/moonwell.md) | — | `Moonwell`: base | base |
| [Morpho Blue](protocols/morpho-blue.md) | — | `MorphoBlue`: ethereum, monad, arc, base | ethereum, monad, arc, base |
| [Radiant](protocols/radiant.md) | — | `Radiant`: arbitrum | arbitrum |
| [Silo](protocols/silo.md) | — | `Silo`: ethereum, arbitrum | ethereum, arbitrum |
| [Spark](protocols/spark.md) | — | `Spark`: ethereum | ethereum |
| [Venus](protocols/venus.md) | — | `Venus`: bsc | bsc |
| [ZeroLend](protocols/zerolend.md) | — | `Zerolend`: zksync | zksync |

## CDPs and stablecoins (10)

### Choosing between them

Mint a stablecoin against collateral (Maker and Sky's DAI and USDS, Liquity's LUSD and BOLD,
crvUSD, GHO, RAI, MIM, Alchemix's self-repaying alUSD and alETH), or hold a yield-bearing
wrapper of one (sDAI, Ethena's sUSDe). Each sets its own collateral ratio, rate and liquidation
rules. The stablecoin itself is an ordinary ERC-20 to transfer.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Abracadabra](protocols/abracadabra.md) | — | `Abracadabra`: ethereum, arbitrum | ethereum, arbitrum |
| [Alchemix](protocols/alchemix.md) | — | `Alchemix`: ethereum | ethereum |
| [crvUSD](protocols/crvusd.md) | — | `Crvusd`: ethereum | ethereum |
| [Ethena](protocols/ethena.md) | — | `Ethena`: ethereum | ethereum |
| [Frax Finance](protocols/frax.md) | — | `Frax`: ethereum | ethereum |
| [GHO](protocols/gho.md) | — | `Gho`: ethereum | ethereum |
| [Liquity V1](protocols/liquity-v1.md) | `Liquity` | `LiquityV1`: ethereum | ethereum |
| [Liquity V2](protocols/liquity-v2.md) | `Liquity` | `LiquityV2`: ethereum | ethereum |
| [Maker](protocols/maker.md) | — | `Maker`: ethereum | ethereum |
| [Reflexer](protocols/reflexer.md) | — | `Reflexer`: ethereum | ethereum |

## Bridges (18)

### Choosing between them

Each bridge has its own trust model and delay. Canonical rollup bridges (Arbitrum, Optimism,
Base, Scroll, Linea, zkSync, Polygon) trust only the rollup but take days to withdraw to
Ethereum; bridges (Across, Stargate, Hop, Synapse, Celer, Connext, deBridge)
settle in minutes and trust their relayers and pools; CCTP burns USDC and Circle mints it on the
destination; LI.FI, Socket and Squid route across bridges from an off-chain quote.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Across](protocols/across.md) | — | `Across`: ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| [Arbitrum Native Bridge](protocols/arbitrum-bridge.md) | — | `ArbitrumBridge`: ethereum, arbitrum | ethereum, arbitrum |
| [Base Native Bridge](protocols/base-bridge.md) | — | `BaseBridge`: ethereum, base | ethereum, base |
| [CCTP](protocols/cctp.md) | — | `Cctp`: ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea |
| [Celer Network](protocols/celer.md) | — | `Celer`: ethereum, optimism, bsc, polygon, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| [Connext (Everclear)](protocols/connext.md) | — | `Connext`: ethereum, optimism, base, arbitrum | ethereum, optimism, base, arbitrum |
| [deBridge](protocols/debridge.md) | — | `Debridge`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Hop Protocol](protocols/hop.md) | — | `Hop`: ethereum, optimism, polygon, base, arbitrum | ethereum, optimism, polygon, base, arbitrum |
| [LI.FI](protocols/lifi.md) | — | `Lifi`: ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| [Linea Native Bridge](protocols/linea-bridge.md) | — | `LineaBridge`: ethereum, linea | ethereum, linea |
| [Optimism Native Bridge](protocols/optimism-bridge.md) | — | `OptimismBridge`: ethereum, optimism | ethereum, optimism |
| [Polygon Native Bridge](protocols/polygon-bridge.md) | — | `PolygonBridge`: ethereum, polygon | ethereum, polygon |
| [Scroll Native Bridge](protocols/scroll-bridge.md) | — | `ScrollBridge`: ethereum, scroll | ethereum, scroll |
| [Socket](protocols/socket.md) | — | `Socket`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Squid Router](protocols/squid.md) | — | `Squid`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Stargate](protocols/stargate.md) | — | `Stargate`: ethereum, base, arbitrum | ethereum, base, arbitrum |
| [Synapse Protocol](protocols/synapse.md) | — | `Synapse`: ethereum, optimism, polygon, base, arbitrum, avalanche | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [zkSync Native Bridge](protocols/zksync-bridge.md) | — | `ZksyncBridge`: ethereum, zksync | ethereum, zksync |

## Cross-chain messaging (6)

### Choosing between them

Messaging protocols (LayerZero, Wormhole, Axelar, Chainlink CCIP, Hyperlane) carry arbitrary
messages, each with its own set of verifiers and a fee paid at send time in the native coin (an
`evm.call` with value). Circle Gateway keeps one USDC balance spendable across chains.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Axelar](protocols/axelar.md) | — | `Axelar`: ethereum, optimism, polygon, base, arbitrum, avalanche | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [Chainlink CCIP](protocols/chainlink-ccip.md) | — | `ChainlinkCcip`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |
| [Circle Gateway](protocols/circle-gateway.md) | — | `CircleGateway`: ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |
| [Hyperlane](protocols/hyperlane.md) | — | `Hyperlane`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [LayerZero](protocols/layerzero.md) | — | `Layerzero`: ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [Wormhole](protocols/wormhole.md) | — | `Wormhole`: ethereum, optimism, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |

## Liquid staking (7)

### Choosing between them

Staking ETH returns a liquid token of one of two kinds. A **rebasing** balance (stETH) changes
on its own, so measure it as a delta at the moment you use it, and hold the wrapped form
(wstETH) instead. An **exchange-rate** token (rETH, cbETH, sfrxETH, ETHx, swETH, mETH) keeps its
balance and grows in value. Withdrawals to ETH go through each protocol's queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Coinbase Wrapped Staked ETH](protocols/cbeth.md) | — | `Cbeth`: ethereum, base | ethereum, base |
| [Frax Ether](protocols/frax-ether.md) | — | `FraxEther`: ethereum | ethereum |
| [Lido](protocols/lido.md) | — | `Lido`: ethereum, arbitrum | ethereum, arbitrum |
| [Mantle mETH](protocols/mantle-meth.md) | — | `MantleMeth`: ethereum | ethereum |
| [Rocket Pool](protocols/rocket-pool.md) | — | `RocketPool`: ethereum | ethereum |
| [Stader](protocols/stader.md) | — | `Stader`: ethereum | ethereum |
| [Swell](protocols/swell.md) | — | `Swell`: ethereum | ethereum |

## Restaking (5)

### Choosing between them

Restaking (EigenLayer, and the liquid restaking tokens of ether.fi, Renzo, Kelp and Puffer) adds
the risk of slashing to staking for extra rewards. A liquid restaking token can trade below its
underlying, and withdraws through a queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [EigenLayer](protocols/eigenlayer.md) | — | `Eigenlayer`: ethereum | ethereum |
| [ether.fi](protocols/etherfi.md) | — | `Etherfi`: ethereum | ethereum |
| [Kelp DAO](protocols/kelp.md) | — | `Kelp`: ethereum | ethereum |
| [Puffer Finance](protocols/puffer.md) | — | `Puffer`: ethereum | ethereum |
| [Renzo](protocols/renzo.md) | — | `Renzo`: ethereum | ethereum |

## Staking (1)

### Choosing between them

Olympus stakes OHM into its staked forms.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Olympus DAO](protocols/olympus.md) | — | `Olympus`: ethereum | ethereum |

## Yield and vaults (9)

### Choosing between them

- **Vaults** (Yearn V3, Beefy, Sommelier, Tokemak, Harvest; ERC-4626 where they follow it) take
  a deposit and return shares whose value grows: measure shares and assets as deltas.
- **Yield split** (Pendle): PT is the principal, redeemable at a fixed expiry, YT the yield until
  then.
- **Managed liquidity** (Gamma, Arrakis) runs concentrated-liquidity positions in vaults.
- **Boosted LP** (Convex) stakes Curve LP tokens for boosted rewards.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Arrakis Finance](protocols/arrakis.md) | — | `Arrakis`: ethereum | ethereum |
| [Beefy Finance](protocols/beefy.md) | — | `Beefy`: ethereum, optimism, bsc, arbitrum, avalanche | ethereum, optimism, bsc, arbitrum, avalanche |
| [Convex Finance](protocols/convex.md) | — | `Convex`: ethereum | ethereum |
| [Gamma Strategies](protocols/gamma.md) | — | `Gamma`: ethereum, polygon | ethereum, polygon |
| [Harvest Finance](protocols/harvest.md) | — | `Harvest`: ethereum | ethereum |
| [Pendle](protocols/pendle.md) | — | `Pendle`: ethereum, monad, arbitrum | ethereum, monad, arbitrum |
| [Sommelier](protocols/sommelier.md) | — | `Sommelier`: ethereum | ethereum |
| [Tokemak](protocols/tokemak.md) | — | `Tokemak`: ethereum | ethereum |
| [Yearn V3](protocols/yearn-v3.md) | `Yearn` | `YearnV3`: ethereum | ethereum |

## Perpetuals (7)

### Choosing between them

Leveraged positions often execute in two steps: the program sends a request, and a keeper
executes it later at a price it reads then (GMX's orders are this way). A program cannot see
that fill in its own transaction, so it bounds the request (acceptable price, deadline) instead.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Gains Network](protocols/gains-network.md) | — | `GainsNetwork`: polygon, arbitrum | polygon, arbitrum |
| [GMX V1](protocols/gmx-v1.md) | `Gmx` | `GmxV1`: arbitrum, avalanche | arbitrum, avalanche |
| [GMX V2](protocols/gmx-v2.md) | `Gmx` | `GmxV2`: arbitrum | arbitrum |
| [Level Finance](protocols/level-finance.md) | — | `LevelFinance`: bsc, arbitrum | bsc, arbitrum |
| [MUX Protocol](protocols/mux-protocol.md) | — | `MuxProtocol`: arbitrum | arbitrum |
| [Perpetual Protocol](protocols/perpetual-protocol.md) | — | `PerpetualProtocol`: optimism | optimism |
| [Vertex](protocols/vertex.md) | — | `Vertex`: arbitrum | arbitrum |

## Synthetics (1)

### Choosing between them

Synthetix V3 takes collateral into an account and mints against it; positions and rewards are
per account.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Synthetix V3](protocols/synthetix-v3.md) | `Synthetix` | `SynthetixV3`: base | base |

## Options (5)

### Choosing between them

Options protocols (Premia, Hegic, Opyn, Thales, Aevo) settle at expiry or exercise; a program
buys, exercises or settles a position it holds.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aevo](protocols/aevo.md) | — | `Aevo`: ethereum | ethereum |
| [Hegic](protocols/hegic.md) | — | `Hegic`: arbitrum | arbitrum |
| [Opyn](protocols/opyn.md) | — | `Opyn`: ethereum | ethereum |
| [Premia](protocols/premia.md) | — | `Premia`: arbitrum | arbitrum |
| [Thales](protocols/thales.md) | — | `Thales`: optimism | optimism |

## Oracles (2)

### Choosing between them

Chainlink feeds are read on chain (`latestRoundData`): check `updatedAt` against a staleness
bound and scale by the feed's decimals. Pyth is pulled: the price is updated in the same
transaction (`updatePriceFeeds`, paying its fee as value) before it is read.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Chainlink](protocols/chainlink.md) | — | `Chainlink`: ethereum, arc | ethereum, arc |
| [Pyth Network](protocols/pyth.md) | — | `Pyth`: ethereum | ethereum |

## Payments and streaming (2)

### Choosing between them

Sablier locks tokens into a schedule a recipient withdraws from; Superfluid streams Super Tokens
per second, so tokens are wrapped into Super Tokens first.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Sablier](protocols/sablier.md) | — | `Sablier`: ethereum | ethereum |
| [Superfluid](protocols/superfluid.md) | — | `Superfluid`: ethereum, optimism, polygon, base, arbitrum | ethereum, optimism, polygon, base, arbitrum |

## NFT marketplaces (1)

### Choosing between them

Seaport fills orders that makers signed off chain.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Seaport](protocols/seaport.md) | — | `Seaport`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |

## Infrastructure and standards (8)

### Choosing between them

Standards and services a program calls directly: ERC-20 (Sauce's token writes are SafeERC20),
ERC-4626 vaults, ERC-3156 flash loans, Permit2 (signed transfers and allowances), Safe accounts,
ENS, Gelato automation and Instadapp flash-loan routing.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [ENS](protocols/ens.md) | — | `Ens`: ethereum | ethereum |
| [ERC20](protocols/erc20.md) | — | — | none recorded |
| [ERC-3156](protocols/erc3156.md) | — | — | none recorded |
| [ERC-4626](protocols/erc4626.md) | — | — | none recorded |
| [Gelato Network](protocols/gelato.md) | — | `Gelato`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Instadapp](protocols/instadapp.md) | — | `Instadapp`: ethereum | ethereum |
| [Permit2](protocols/permit2.md) | — | `Permit2`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| [Safe](protocols/safe.md) | — | `Safe`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |

## Family aliases

A slug ending in `-v<N>` also joins the family named by the rest: `Uniswap` covers
`UniswapV2`, `UniswapV3` and `UniswapV4`. A family names a contract on a chain when exactly one
of its members has one by that name there; any other name, such as one two members share, is
ambiguous, and a program names the versioned namespace instead.

| Alias | Resolves to | On |
| --- | --- | --- |
| `Aave.AvaxCorrelatedSpoke` | `AaveV4.AvaxCorrelatedSpoke` | avalanche |
| `Aave.BluechipSpoke` | `AaveV4.BluechipSpoke` | ethereum |
| `Aave.CoreHub` | `AaveV4.CoreHub` | ethereum, arc, avalanche |
| `Aave.EquitiesHub` | `AaveV4.EquitiesHub` | base |
| `Aave.EthenaCorrelatedSpoke` | `AaveV4.EthenaCorrelatedSpoke` | ethereum |
| `Aave.EthenaEcosystemSpoke` | `AaveV4.EthenaEcosystemSpoke` | ethereum |
| `Aave.EtherfiESpoke` | `AaveV4.EtherfiESpoke` | ethereum |
| `Aave.ForexSpoke` | `AaveV4.ForexSpoke` | ethereum, arc, avalanche |
| `Aave.GlobalDollarHub` | `AaveV4.GlobalDollarHub` | ethereum |
| `Aave.GoldSpoke` | `AaveV4.GoldSpoke` | ethereum |
| `Aave.KelpESpoke` | `AaveV4.KelpESpoke` | ethereum |
| `Aave.LendingPool` | `AaveV2.LendingPool` | ethereum, polygon, avalanche |
| `Aave.LidoESpoke` | `AaveV4.LidoESpoke` | ethereum |
| `Aave.LombardBtcSpoke` | `AaveV4.LombardBtcSpoke` | ethereum |
| `Aave.Mag7Spoke` | `AaveV4.Mag7Spoke` | base |
| `Aave.MainSpoke` | `AaveV4.MainSpoke` | ethereum, arc, avalanche |
| `Aave.PaxgGoldSpoke` | `AaveV4.PaxgGoldSpoke` | ethereum |
| `Aave.PlusHub` | `AaveV4.PlusHub` | ethereum |
| `Aave.Pool` | `AaveV3.Pool` | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| `Aave.PoolAddressesProvider` | `AaveV3.PoolAddressesProvider` | ethereum, optimism, polygon, monad, base, arbitrum, avalanche |
| `Aave.PrimeHub` | `AaveV4.PrimeHub` | ethereum |
| `Aave.UsdgMapleESpoke` | `AaveV4.UsdgMapleESpoke` | ethereum |
| `Aave.UsdgPendleSpoke` | `AaveV4.UsdgPendleSpoke` | ethereum |
| `Balancer.Vault` | `BalancerV2.Vault` | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| `Compound.CETH` | `CompoundV2.CETH` | ethereum |
| `Compound.CUSDC` | `CompoundV2.CUSDC` | ethereum |
| `Compound.CUSDCv3` | `CompoundV3.CUSDCv3` | ethereum, optimism, polygon, base, arbitrum, scroll |
| `Compound.CUSDTv3` | `CompoundV3.CUSDTv3` | ethereum, arbitrum |
| `Compound.CWETHv3` | `CompoundV3.CWETHv3` | ethereum, base |
| `Compound.Comptroller` | `CompoundV2.Comptroller` | ethereum |
| `Euler.EthereumVaultConnector` | `EulerV2.EthereumVaultConnector` | ethereum |
| `Gmx.DataStore` | `GmxV2.DataStore` | arbitrum |
| `Gmx.ExchangeRouter` | `GmxV2.ExchangeRouter` | arbitrum |
| `Gmx.Glp` | `GmxV1.Glp` | arbitrum |
| `Gmx.PositionRouter` | `GmxV1.PositionRouter` | arbitrum |
| `Gmx.Router` | `GmxV1.Router` | arbitrum, avalanche |
| `Gmx.Vault` | `GmxV1.Vault` | arbitrum, avalanche |
| `Liquity.Bold` | `LiquityV2.Bold` | ethereum |
| `Liquity.BorrowerOperations` | `LiquityV1.BorrowerOperations` | ethereum |
| `Liquity.Lusd` | `LiquityV1.Lusd` | ethereum |
| `Pancakeswap.NonfungiblePositionManager` | `PancakeswapV3.NonfungiblePositionManager` | ethereum, bsc, base, arbitrum, linea |
| `Pancakeswap.Router` | `PancakeswapV2.Router` | ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| `Pancakeswap.SmartRouter` | `PancakeswapV3.SmartRouter` | ethereum, bsc, base, arbitrum, linea |
| `Sushiswap.Factory` | `SushiswapV2.Factory` | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| `Sushiswap.Router` | `SushiswapV2.Router` | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| `Synthetix.CoreProxy` | `SynthetixV3.CoreProxy` | base |
| `Synthetix.PerpsMarketProxy` | `SynthetixV3.PerpsMarketProxy` | base |
| `Synthra.Factory` | `SynthraV3.Factory` | arc |
| `Synthra.NonfungiblePositionManager` | `SynthraV3.NonfungiblePositionManager` | arc |
| `Synthra.QuoterV2` | `SynthraV3.QuoterV2` | arc |
| `Synthra.SwapRouter02` | `SynthraV3.SwapRouter02` | arc |
| `Uniswap.NonfungiblePositionManager` | `UniswapV3.NonfungiblePositionManager` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| `Uniswap.PoolManager` | `UniswapV4.PoolManager` | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| `Uniswap.PositionManager` | `UniswapV4.PositionManager` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| `Uniswap.QuoterV2` | `UniswapV3.QuoterV2` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| `Uniswap.Router` | `UniswapV2.Router` | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| `Uniswap.StateView` | `UniswapV4.StateView` | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| `Uniswap.SwapRouter` | `UniswapV3.SwapRouter` | ethereum, optimism, polygon, arbitrum |
| `Uniswap.SwapRouter02` | `UniswapV3.SwapRouter02` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| `Uniswap.UniversalRouter` | `UniswapV4.UniversalRouter` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| `Unitflow.Factory` | `UnitflowV3.Factory` | arc |
| `Unitflow.Quoter` | `UnitflowV3.Quoter` | arc |
| `Unitflow.Router` | `UnitflowV3.Router` | arc |
| `Yearn.VaultFactory` | `YearnV3.VaultFactory` | ethereum |

## Interfaces

An interface is an ABI with no fixed address, the same on every EVM chain: a program binds it to
an address it holds and calls a method in the same expression,
`Namespace.Contract(address).method(...)` (or `.at(address)`), such as a pool its factory
returned.

| Interface | Protocol |
| --- | --- |
| `Abracadabra.Cauldron(<address>)` | [`abracadabra`](protocols/abracadabra.md) |
| `Aerodrome.Pool(<address>)` | [`aerodrome`](protocols/aerodrome.md) |
| `AerodromeSlipstream.Pool(<address>)` | [`aerodrome-slipstream`](protocols/aerodrome-slipstream.md) |
| `Arrakis.Vault(<address>)` | [`arrakis`](protocols/arrakis.md) |
| `Beefy.Vault(<address>)` | [`beefy`](protocols/beefy.md) |
| `Benqi.QiToken(<address>)` | [`benqi`](protocols/benqi.md) |
| `Camelot.V2Pair(<address>)` | [`camelot`](protocols/camelot.md) |
| `Camelot.V3Pool(<address>)` | [`camelot`](protocols/camelot.md) |
| `Convex.BaseRewardPool(<address>)` | [`convex`](protocols/convex.md) |
| `Curve.StableSwap(<address>)` | [`curve`](protocols/curve.md) |
| `Erc20.ERC20(<address>)` | [`erc20`](protocols/erc20.md) |
| `Erc3156.FlashLender(<address>)` | [`erc3156`](protocols/erc3156.md) |
| `Erc4626.Vault(<address>)` | [`erc4626`](protocols/erc4626.md) |
| `EulerV2.EVault(<address>)` | [`euler-v2`](protocols/euler-v2.md) |
| `Fluid.Lending(<address>)` | [`fluid`](protocols/fluid.md) |
| `Fluid.Vault(<address>)` | [`fluid`](protocols/fluid.md) |
| `Gamma.Hypervisor(<address>)` | [`gamma`](protocols/gamma.md) |
| `Harvest.Vault(<address>)` | [`harvest`](protocols/harvest.md) |
| `Layerbank.LToken(<address>)` | [`layerbank`](protocols/layerbank.md) |
| `Maverick.V2Pool(<address>)` | [`maverick`](protocols/maverick.md) |
| `Moonwell.MToken(<address>)` | [`moonwell`](protocols/moonwell.md) |
| `PancakeswapV2.Pair(<address>)` | [`pancakeswap-v2`](protocols/pancakeswap-v2.md) |
| `PancakeswapV3.Pool(<address>)` | [`pancakeswap-v3`](protocols/pancakeswap-v3.md) |
| `Premia.Diamond(<address>)` | [`premia`](protocols/premia.md) |
| `Quickswap.V2Pair(<address>)` | [`quickswap`](protocols/quickswap.md) |
| `Quickswap.V3Pool(<address>)` | [`quickswap`](protocols/quickswap.md) |
| `Silo.Silo(<address>)` | [`silo`](protocols/silo.md) |
| `Sommelier.Cellar(<address>)` | [`sommelier`](protocols/sommelier.md) |
| `SushiswapV2.Pair(<address>)` | [`sushiswap-v2`](protocols/sushiswap-v2.md) |
| `SynthraV3.Pool(<address>)` | [`synthra-v3`](protocols/synthra-v3.md) |
| `Thales.PositionalMarket(<address>)` | [`thales`](protocols/thales.md) |
| `Tokemak.Autopool(<address>)` | [`tokemak`](protocols/tokemak.md) |
| `TraderJoe.LBPair(<address>)` | [`trader-joe`](protocols/trader-joe.md) |
| `UniswapV2.Pair(<address>)` | [`uniswap-v2`](protocols/uniswap-v2.md) |
| `UniswapV3.Pool(<address>)` | [`uniswap-v3`](protocols/uniswap-v3.md) |
| `UnitflowV3.Pool(<address>)` | [`unitflow-v3`](protocols/unitflow-v3.md) |
| `Velodrome.Pool(<address>)` | [`velodrome`](protocols/velodrome.md) |
| `Venus.VToken(<address>)` | [`venus`](protocols/venus.md) |
| `YearnV3.Vault(<address>)` | [`yearn-v3`](protocols/yearn-v3.md) |

## Next

- [Swap by name](../guides/swap-by-name.md): a first program that calls a protocol by name.
- [Protocols and tokens](../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Names and registries](../concepts/names-and-registries.md): how a name in a program becomes an address on the chain it is compiled for.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.
