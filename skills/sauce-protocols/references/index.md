<!-- Generated from the SDK's registries. Do not edit. -->

# Protocol index

Every protocol the SDK registers, by category: how to choose between them, then each one with
its family, whether a program names it as a namespace (and on which chains), and where it is
deployed. Each protocol's registry file (`registry/<slug>.md`) has its addresses per chain, how a
program names each contract, and its ABI functions; its document (`<slug>.md`) says what it is
for and its pitfalls.

## DEX (29)

### Choosing between them

Inside a Sauce program, swap with `@sauce/router`'s function for the venue (`sauce-swaps`), every
argument a run-time value, each returning what the recipient received and reverting below its
`minOut`. `uniswapV2` (Uniswap V2 and its forks' pairs), `curve`, `balancerV2`, `dodoV2`,
`traderJoeLB` and `woofi` pay the pool first and call it directly; `uniswapV3` (Uniswap V3 and its
forks: PancakeSwap V3, Aerodrome Slipstream, Algebra pools, Synthra, UnitFlow), `uniswapV4` and
`maverickV2` go through the Pot's Router, which answers the pool's callback. Choose by pool type:

- **Concentrated liquidity** (V3-style pools through `uniswapV3`, V4 pools through `uniswapV4`):
  the deepest pools for liquid pairs, several fee tiers per pair, and a price limit, so a fill can
  stop part way and leave the rest unspent.
- **Constant-product pairs** (Uniswap V2 and its forks through `uniswapV2`, Solidly-style volatile
  pools): one pool per pair, no price limit; a swap consumes its whole input, bounded only by its
  `minOut`.
- **Stable pools** (Curve through `curve`, Solidly-style stable pools): built for assets meant to
  trade near 1:1, with less price impact there than a constant-product pair.
- **One trade across several pools** under one limit: `sauce-distributed-swap`.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aerodrome](aerodrome.md) ([registry](registry/aerodrome.md)) | — | `Aerodrome`: base | base |
| [Aerodrome Slipstream](aerodrome-slipstream.md) ([registry](registry/aerodrome-slipstream.md)) | — | `AerodromeSlipstream`: arc, base | arc, base |
| [Ambient](ambient.md) ([registry](registry/ambient.md)) | — | `Ambient`: ethereum, scroll | ethereum, scroll |
| [Balancer V2](balancer-v2.md) ([registry](registry/balancer-v2.md)) | `Balancer` | `BalancerV2`: ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| [BaseSwap](baseswap.md) ([registry](registry/baseswap.md)) | — | `Baseswap`: base | base |
| [Camelot](camelot.md) ([registry](registry/camelot.md)) | — | `Camelot`: arbitrum | arbitrum |
| [Curve Finance](curve.md) ([registry](registry/curve.md)) | — | `Curve`: ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| [DODO](dodo.md) ([registry](registry/dodo.md)) | — | `Dodo`: ethereum, bsc | ethereum, bsc |
| [Fenix](fenix.md) ([registry](registry/fenix.md)) | — | `Fenix`: blast | blast |
| [Kim](kim.md) ([registry](registry/kim.md)) | — | `Kim`: mode | mode |
| [KyberSwap](kyberswap.md) ([registry](registry/kyberswap.md)) | — | `Kyberswap`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Lynex](lynex.md) ([registry](registry/lynex.md)) | — | `Lynex`: linea | linea |
| [Maverick](maverick.md) ([registry](registry/maverick.md)) | — | `Maverick`: ethereum, base, arbitrum | ethereum, base, arbitrum |
| [PancakeSwap V2](pancakeswap-v2.md) ([registry](registry/pancakeswap-v2.md)) | `Pancakeswap` | `PancakeswapV2`: ethereum, bsc, monad, opbnb, base, arbitrum, linea | ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| [PancakeSwap V3](pancakeswap-v3.md) ([registry](registry/pancakeswap-v3.md)) | `Pancakeswap` | `PancakeswapV3`: ethereum, bsc, base, arbitrum, linea | ethereum, bsc, base, arbitrum, linea |
| [QuickSwap](quickswap.md) ([registry](registry/quickswap.md)) | — | `Quickswap`: polygon | polygon |
| [Ramses](ramses.md) ([registry](registry/ramses.md)) | — | `Ramses`: arbitrum | arbitrum |
| [SpookySwap](spookyswap.md) ([registry](registry/spookyswap.md)) | — | `Spookyswap`: fantom | fantom |
| [SushiSwap V2](sushiswap-v2.md) ([registry](registry/sushiswap-v2.md)) | `Sushiswap` | `SushiswapV2`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [SyncSwap](syncswap.md) ([registry](registry/syncswap.md)) | — | `Syncswap`: zksync | zksync |
| [Synthra V3](synthra-v3.md) ([registry](registry/synthra-v3.md)) | `Synthra` | `SynthraV3`: arc | arc |
| [Thena](thena.md) ([registry](registry/thena.md)) | — | `Thena`: bsc | bsc |
| [Thruster](thruster.md) ([registry](registry/thruster.md)) | — | `Thruster`: blast | blast |
| [Trader Joe](trader-joe.md) ([registry](registry/trader-joe.md)) | — | `TraderJoe`: bsc, arbitrum, avalanche | bsc, arbitrum, avalanche |
| [Uniswap V2](uniswap-v2.md) ([registry](registry/uniswap-v2.md)) | `Uniswap` | `UniswapV2`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| [Uniswap V3](uniswap-v3.md) ([registry](registry/uniswap-v3.md)) | `Uniswap` | `UniswapV3`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| [Uniswap V4](uniswap-v4.md) ([registry](registry/uniswap-v4.md)) | `Uniswap` | `UniswapV4`: ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| [UnitFlow V3](unitflow-v3.md) ([registry](registry/unitflow-v3.md)) | `Unitflow` | `UnitflowV3`: arc | arc |
| [Velodrome](velodrome.md) ([registry](registry/velodrome.md)) | — | `Velodrome`: optimism | optimism |

## Aggregators (6)

### Choosing between them

An aggregator (1inch, ParaSwap, 0x, KyberSwap, OpenOcean) routes through many pools, but its
calldata comes from an off-chain quote made for one sender, amount and moment. A program can
take that calldata as a `main` input and pass it through, and must still check the output as a
balance delta against a minimum. CoW Swap settles signed orders in off-chain batch auctions, so
a program signs or cancels an order rather than swapping. When the program itself should choose
the route, use the pools directly (`sauce-swaps`).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [CoW Swap](cowswap.md) ([registry](registry/cowswap.md)) | — | `Cowswap`: ethereum, arbitrum | ethereum, arbitrum |
| [KyberSwap Aggregator](kyberswap-aggregator.md) ([registry](registry/kyberswap-aggregator.md)) | — | `KyberswapAggregator`: ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [1inch](oneinch.md) ([registry](registry/oneinch.md)) | — | `Oneinch`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [OpenOcean](openocean.md) ([registry](registry/openocean.md)) | — | `Openocean`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [ParaSwap](paraswap.md) ([registry](registry/paraswap.md)) | — | `Paraswap`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [0x Protocol](zerox.md) ([registry](registry/zerox.md)) | — | `Zerox`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Lending (17)

### Choosing between them

- **One pool, many reserves** (Aave V2 and V3 and their forks Spark, Radiant, Seamless, ZeroLend):
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
| [Aave V2](aave-v2.md) ([registry](registry/aave-v2.md)) | `Aave` | `AaveV2`: ethereum, polygon, avalanche | ethereum, polygon, avalanche |
| [Aave V3](aave-v3.md) ([registry](registry/aave-v3.md)) | `Aave` | `AaveV3`: ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll |
| [Aave V4](aave-v4.md) ([registry](registry/aave-v4.md)) | `Aave` | `AaveV4`: ethereum, arc, base, avalanche | ethereum, arc, base, avalanche |
| [Benqi](benqi.md) ([registry](registry/benqi.md)) | — | `Benqi`: avalanche | avalanche |
| [Compound V2](compound-v2.md) ([registry](registry/compound-v2.md)) | `Compound` | `CompoundV2`: ethereum | ethereum |
| [Compound V3](compound-v3.md) ([registry](registry/compound-v3.md)) | `Compound` | `CompoundV3`: ethereum, optimism, polygon, base, arbitrum, scroll | ethereum, optimism, polygon, base, arbitrum, scroll |
| [Euler V2](euler-v2.md) ([registry](registry/euler-v2.md)) | `Euler` | `EulerV2`: ethereum | ethereum |
| [Fluid](fluid.md) ([registry](registry/fluid.md)) | — | `Fluid`: ethereum, arbitrum | ethereum, arbitrum |
| [LayerBank](layerbank.md) ([registry](registry/layerbank.md)) | — | `Layerbank`: scroll | scroll |
| [Moonwell](moonwell.md) ([registry](registry/moonwell.md)) | — | `Moonwell`: base | base |
| [Morpho Blue](morpho-blue.md) ([registry](registry/morpho-blue.md)) | — | `MorphoBlue`: ethereum, monad, arc, base | ethereum, monad, arc, base |
| [Radiant](radiant.md) ([registry](registry/radiant.md)) | — | `Radiant`: arbitrum | arbitrum |
| [Seamless](seamless.md) ([registry](registry/seamless.md)) | — | `Seamless`: base | base |
| [Silo](silo.md) ([registry](registry/silo.md)) | — | `Silo`: ethereum, arbitrum | ethereum, arbitrum |
| [Spark](spark.md) ([registry](registry/spark.md)) | — | `Spark`: ethereum | ethereum |
| [Venus](venus.md) ([registry](registry/venus.md)) | — | `Venus`: bsc | bsc |
| [ZeroLend](zerolend.md) ([registry](registry/zerolend.md)) | — | `Zerolend`: zksync | zksync |

## CDPs and stablecoins (10)

### Choosing between them

Mint a stablecoin against collateral (Maker and Sky's DAI and USDS, Liquity's LUSD and BOLD,
crvUSD, GHO, RAI, MIM, Alchemix's self-repaying alUSD and alETH), or hold a yield-bearing
wrapper of one (sDAI, Ethena's sUSDe). Each sets its own collateral ratio, rate and liquidation
rules. The stablecoin itself is an ordinary ERC-20 to transfer.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Abracadabra](abracadabra.md) ([registry](registry/abracadabra.md)) | — | `Abracadabra`: ethereum, arbitrum | ethereum, arbitrum |
| [Alchemix](alchemix.md) ([registry](registry/alchemix.md)) | — | `Alchemix`: ethereum | ethereum |
| [crvUSD](crvusd.md) ([registry](registry/crvusd.md)) | — | `Crvusd`: ethereum | ethereum |
| [Ethena](ethena.md) ([registry](registry/ethena.md)) | — | `Ethena`: ethereum | ethereum |
| [Frax Finance](frax.md) ([registry](registry/frax.md)) | — | `Frax`: ethereum | ethereum |
| [GHO](gho.md) ([registry](registry/gho.md)) | — | `Gho`: ethereum | ethereum |
| [Liquity V1](liquity-v1.md) ([registry](registry/liquity-v1.md)) | `Liquity` | `LiquityV1`: ethereum | ethereum |
| [Liquity V2](liquity-v2.md) ([registry](registry/liquity-v2.md)) | `Liquity` | `LiquityV2`: ethereum | ethereum |
| [Maker](maker.md) ([registry](registry/maker.md)) | — | `Maker`: ethereum | ethereum |
| [Reflexer](reflexer.md) ([registry](registry/reflexer.md)) | — | `Reflexer`: ethereum | ethereum |

## Bridges (18)

### Choosing between them

Each bridge has its own trust model and delay. Canonical rollup bridges (Arbitrum, Optimism,
Base, Scroll, Linea, zkSync, Polygon) trust only the rollup but take days to withdraw to
Ethereum; liquidity and intent bridges (Across, Stargate, Hop, Synapse, Celer, Connext, deBridge)
settle in minutes and trust their relayers and pools; CCTP burns USDC and Circle mints it on the
destination; LI.FI, Socket and Squid route across bridges from an off-chain quote. To continue a
program on another chain, not only move a token, open a Sauce intent (`sauce-intents`).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Across](across.md) ([registry](registry/across.md)) | — | `Across`: ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| [Arbitrum Native Bridge](arbitrum-bridge.md) ([registry](registry/arbitrum-bridge.md)) | — | `ArbitrumBridge`: ethereum, arbitrum | ethereum, arbitrum |
| [Base Native Bridge](base-bridge.md) ([registry](registry/base-bridge.md)) | — | `BaseBridge`: ethereum, base | ethereum, base |
| [CCTP](cctp.md) ([registry](registry/cctp.md)) | — | `Cctp`: ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea |
| [Celer Network](celer.md) ([registry](registry/celer.md)) | — | `Celer`: ethereum, optimism, bsc, polygon, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| [Connext (Everclear)](connext.md) ([registry](registry/connext.md)) | — | `Connext`: ethereum, optimism, base, arbitrum | ethereum, optimism, base, arbitrum |
| [deBridge](debridge.md) ([registry](registry/debridge.md)) | — | `Debridge`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Hop Protocol](hop.md) ([registry](registry/hop.md)) | — | `Hop`: ethereum, optimism, polygon, base, arbitrum | ethereum, optimism, polygon, base, arbitrum |
| [LI.FI](lifi.md) ([registry](registry/lifi.md)) | — | `Lifi`: ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| [Linea Native Bridge](linea-bridge.md) ([registry](registry/linea-bridge.md)) | — | `LineaBridge`: ethereum, linea | ethereum, linea |
| [Optimism Native Bridge](optimism-bridge.md) ([registry](registry/optimism-bridge.md)) | — | `OptimismBridge`: ethereum, optimism | ethereum, optimism |
| [Polygon Native Bridge](polygon-bridge.md) ([registry](registry/polygon-bridge.md)) | — | `PolygonBridge`: ethereum, polygon | ethereum, polygon |
| [Scroll Native Bridge](scroll-bridge.md) ([registry](registry/scroll-bridge.md)) | — | `ScrollBridge`: ethereum, scroll | ethereum, scroll |
| [Socket](socket.md) ([registry](registry/socket.md)) | — | `Socket`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Squid Router](squid.md) ([registry](registry/squid.md)) | — | `Squid`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Stargate](stargate.md) ([registry](registry/stargate.md)) | — | `Stargate`: ethereum, base, arbitrum | ethereum, base, arbitrum |
| [Synapse Protocol](synapse.md) ([registry](registry/synapse.md)) | — | `Synapse`: ethereum, optimism, polygon, base, arbitrum, avalanche | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [zkSync Native Bridge](zksync-bridge.md) ([registry](registry/zksync-bridge.md)) | — | `ZksyncBridge`: ethereum, zksync | ethereum, zksync |

## Cross-chain messaging (6)

### Choosing between them

Messaging protocols (LayerZero, Wormhole, Axelar, Chainlink CCIP, Hyperlane) carry arbitrary
messages, each with its own set of verifiers and a fee paid at send time in the native coin (an
`evm.call` with value). Circle Gateway keeps one USDC balance spendable across chains.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Axelar](axelar.md) ([registry](registry/axelar.md)) | — | `Axelar`: ethereum, optimism, polygon, base, arbitrum, avalanche | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [Chainlink CCIP](chainlink-ccip.md) ([registry](registry/chainlink-ccip.md)) | — | `ChainlinkCcip`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |
| [Circle Gateway](circle-gateway.md) ([registry](registry/circle-gateway.md)) | — | `CircleGateway`: ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |
| [Hyperlane](hyperlane.md) ([registry](registry/hyperlane.md)) | — | `Hyperlane`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [LayerZero](layerzero.md) ([registry](registry/layerzero.md)) | — | `Layerzero`: ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [Wormhole](wormhole.md) ([registry](registry/wormhole.md)) | — | `Wormhole`: ethereum, optimism, polygon, arc, base, arbitrum, avalanche | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |

## Liquid staking (7)

### Choosing between them

Staking ETH returns a liquid token of one of two kinds. A **rebasing** balance (stETH) changes
on its own, so measure it as a delta at the moment you use it, and hold the wrapped form
(wstETH) instead. An **exchange-rate** token (rETH, cbETH, sfrxETH, ETHx, swETH, mETH) keeps its
balance and grows in value. Withdrawals to ETH go through each protocol's queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Coinbase Wrapped Staked ETH](cbeth.md) ([registry](registry/cbeth.md)) | — | `Cbeth`: ethereum, base | ethereum, base |
| [Frax Ether](frax-ether.md) ([registry](registry/frax-ether.md)) | — | `FraxEther`: ethereum | ethereum |
| [Lido](lido.md) ([registry](registry/lido.md)) | — | `Lido`: ethereum, arbitrum | ethereum, arbitrum |
| [Mantle mETH](mantle-meth.md) ([registry](registry/mantle-meth.md)) | — | `MantleMeth`: ethereum | ethereum |
| [Rocket Pool](rocket-pool.md) ([registry](registry/rocket-pool.md)) | — | `RocketPool`: ethereum | ethereum |
| [Stader](stader.md) ([registry](registry/stader.md)) | — | `Stader`: ethereum | ethereum |
| [Swell](swell.md) ([registry](registry/swell.md)) | — | `Swell`: ethereum | ethereum |

## Restaking (5)

### Choosing between them

Restaking (EigenLayer, and the liquid restaking tokens of ether.fi, Renzo, Kelp and Puffer) adds
the risk of slashing to staking for extra rewards. A liquid restaking token can trade below its
underlying, and withdraws through a queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [EigenLayer](eigenlayer.md) ([registry](registry/eigenlayer.md)) | — | `Eigenlayer`: ethereum | ethereum |
| [ether.fi](etherfi.md) ([registry](registry/etherfi.md)) | — | `Etherfi`: ethereum | ethereum |
| [Kelp DAO](kelp.md) ([registry](registry/kelp.md)) | — | `Kelp`: ethereum | ethereum |
| [Puffer Finance](puffer.md) ([registry](registry/puffer.md)) | — | `Puffer`: ethereum | ethereum |
| [Renzo](renzo.md) ([registry](registry/renzo.md)) | — | `Renzo`: ethereum | ethereum |

## Staking (1)

### Choosing between them

Olympus stakes OHM into its staked forms.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Olympus DAO](olympus.md) ([registry](registry/olympus.md)) | — | `Olympus`: ethereum | ethereum |

## Yield and vaults (9)

### Choosing between them

- **Vaults** (Yearn V3, Beefy, Sommelier, Tokemak, Harvest; ERC-4626 where they follow it) take
  a deposit and return shares whose value grows: measure shares and assets as deltas.
- **Yield split** (Pendle): PT is the principal, redeemable at a fixed expiry, YT the yield until
  then.
- **Managed liquidity** (Gamma, Arrakis) runs concentrated-liquidity positions for you.
- **Boosted LP** (Convex) stakes Curve LP tokens for boosted rewards.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Arrakis Finance](arrakis.md) ([registry](registry/arrakis.md)) | — | `Arrakis`: ethereum | ethereum |
| [Beefy Finance](beefy.md) ([registry](registry/beefy.md)) | — | `Beefy`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Convex Finance](convex.md) ([registry](registry/convex.md)) | — | `Convex`: ethereum | ethereum |
| [Gamma Strategies](gamma.md) ([registry](registry/gamma.md)) | — | `Gamma`: ethereum, polygon | ethereum, polygon |
| [Harvest Finance](harvest.md) ([registry](registry/harvest.md)) | — | `Harvest`: ethereum | ethereum |
| [Pendle](pendle.md) ([registry](registry/pendle.md)) | — | `Pendle`: ethereum, monad, arbitrum | ethereum, monad, arbitrum |
| [Sommelier](sommelier.md) ([registry](registry/sommelier.md)) | — | `Sommelier`: ethereum | ethereum |
| [Tokemak](tokemak.md) ([registry](registry/tokemak.md)) | — | `Tokemak`: ethereum | ethereum |
| [Yearn V3](yearn-v3.md) ([registry](registry/yearn-v3.md)) | `Yearn` | `YearnV3`: ethereum | ethereum |

## Perpetuals (7)

### Choosing between them

Leveraged positions often execute in two steps: the program sends a request, and a keeper
executes it later at a price it reads then (GMX's orders are this way). A program cannot see
that fill in its own transaction, so it bounds the request (acceptable price, deadline) instead.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Gains Network](gains-network.md) ([registry](registry/gains-network.md)) | — | `GainsNetwork`: polygon, arbitrum | polygon, arbitrum |
| [GMX V1](gmx-v1.md) ([registry](registry/gmx-v1.md)) | `Gmx` | `GmxV1`: arbitrum, avalanche | arbitrum, avalanche |
| [GMX V2](gmx-v2.md) ([registry](registry/gmx-v2.md)) | `Gmx` | `GmxV2`: arbitrum | arbitrum |
| [Level Finance](level-finance.md) ([registry](registry/level-finance.md)) | — | `LevelFinance`: bsc, arbitrum | bsc, arbitrum |
| [MUX Protocol](mux-protocol.md) ([registry](registry/mux-protocol.md)) | — | `MuxProtocol`: arbitrum | arbitrum |
| [Perpetual Protocol](perpetual-protocol.md) ([registry](registry/perpetual-protocol.md)) | — | `PerpetualProtocol`: optimism | optimism |
| [Vertex](vertex.md) ([registry](registry/vertex.md)) | — | `Vertex`: arbitrum | arbitrum |

## Synthetics (1)

### Choosing between them

Synthetix V3 takes collateral into an account and mints against it; positions and rewards are
per account.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Synthetix V3](synthetix-v3.md) ([registry](registry/synthetix-v3.md)) | `Synthetix` | `SynthetixV3`: base | base |

## Options (5)

### Choosing between them

Options protocols (Premia, Hegic, Opyn, Thales, Aevo) settle at expiry or exercise; a program
buys, exercises or settles a position it holds.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aevo](aevo.md) ([registry](registry/aevo.md)) | — | `Aevo`: ethereum | ethereum |
| [Hegic](hegic.md) ([registry](registry/hegic.md)) | — | `Hegic`: arbitrum | arbitrum |
| [Opyn](opyn.md) ([registry](registry/opyn.md)) | — | `Opyn`: ethereum | ethereum |
| [Premia](premia.md) ([registry](registry/premia.md)) | — | `Premia`: arbitrum | arbitrum |
| [Thales](thales.md) ([registry](registry/thales.md)) | — | `Thales`: optimism | optimism |

## Oracles (3)

### Choosing between them

Chainlink feeds are read on chain (`latestRoundData`): check `updatedAt` against a staleness
bound and scale by the feed's decimals. Pyth is pulled: the price is updated in the same
transaction (`updatePriceFeeds`, paying its fee as value) before it is read. Space and Time
answers a SQL query over indexed chain data later, proven, by calling the requester back; a
program asks it with `@sauce/zk` (`sauce-zk`).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Chainlink](chainlink.md) ([registry](registry/chainlink.md)) | — | `Chainlink`: ethereum, arc | ethereum, arc |
| [Pyth Network](pyth.md) ([registry](registry/pyth.md)) | — | `Pyth`: ethereum | ethereum |
| [Space and Time](space-and-time.md) ([registry](registry/space-and-time.md)) | — | `SpaceAndTime`: ethereum, base | ethereum, base |

## Payments and streaming (2)

### Choosing between them

Sablier locks tokens into a schedule a recipient withdraws from; Superfluid streams Super Tokens
per second, so tokens are wrapped into Super Tokens first.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Sablier](sablier.md) ([registry](registry/sablier.md)) | — | `Sablier`: ethereum | ethereum |
| [Superfluid](superfluid.md) ([registry](registry/superfluid.md)) | — | `Superfluid`: ethereum, optimism, polygon, base, arbitrum | ethereum, optimism, polygon, base, arbitrum |

## NFT marketplaces (1)

### Choosing between them

Seaport fills orders that makers signed off chain.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Seaport](seaport.md) ([registry](registry/seaport.md)) | — | `Seaport`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |

## Infrastructure and standards (11)

### Choosing between them

Standards and services a program calls directly: ERC-20 (Sauce's token writes are SafeERC20),
ERC-4626 vaults, ERC-3156 flash loans, Permit2 (signed transfers and allowances), Safe accounts,
ENS, Gelato automation, Instadapp flash-loan routing, and Eco Routes, the intents layer
(`sauce-intents`). Boundless is RISC Zero's proof market, on Base: it proves a guest program
ran and calls the requester back with its journal; a program waits on it with `@sauce/zk`
(`sauce-zk`). Succinct's SP1 verifier gateways check a proof that an SP1 program ran in the
same call, on Ethereum and Base, for a program that brings its proof with it.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Boundless](boundless.md) ([registry](registry/boundless.md)) | — | `Boundless`: base | base |
| Eco Routes ([registry](registry/eco-routes.md)) | — | `EcoRoutes`: ethereum, optimism, unichain, polygon, monad, ronin, arc, base, plasma, arbitrum | none recorded |
| [ENS](ens.md) ([registry](registry/ens.md)) | — | `Ens`: ethereum | ethereum |
| [ERC20](erc20.md) ([registry](registry/erc20.md)) | — | — | none recorded |
| [ERC-3156](erc3156.md) ([registry](registry/erc3156.md)) | — | — | none recorded |
| [ERC-4626](erc4626.md) ([registry](registry/erc4626.md)) | — | — | none recorded |
| [Gelato Network](gelato.md) ([registry](registry/gelato.md)) | — | `Gelato`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Instadapp](instadapp.md) ([registry](registry/instadapp.md)) | — | `Instadapp`: ethereum | ethereum |
| [Permit2](permit2.md) ([registry](registry/permit2.md)) | — | `Permit2`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| [Safe](safe.md) ([registry](registry/safe.md)) | — | `Safe`: ethereum, optimism, polygon, arc, base, arbitrum | ethereum, optimism, polygon, arc, base, arbitrum |
| [Succinct SP1](succinct.md) ([registry](registry/succinct.md)) | — | `Succinct`: ethereum, base | ethereum, base |
