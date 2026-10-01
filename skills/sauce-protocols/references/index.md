<!-- Generated from the SDK's registries. Do not edit. -->

# Protocol index

Every protocol the SDK registers, by category: how to choose between them, then each one with
its family, whether a program names it as a namespace (and on which chains), and where it is
deployed. Each protocol's registry file (`registry/<slug>.md`) has its addresses per chain, how a
program names each contract, and its ABI functions; its document (`<slug>.md`) says what it is
for and its pitfalls.

## DEX (29)

### Choosing between them

Inside a Sauce program, swap through the Sauce Router wherever it services the pool
(`sauce-swaps`): Uniswap V3 and its forks (PancakeSwap V3, Aerodrome Slipstream, Algebra pools,
Synthra, UnitFlow) and Uniswap V4 through `swapV3`/`swapV4`, and V2-style pairs, Curve, Balancer
V2, DODO V2, Trader Joe LB and WOOFi through its unified `swap`. Choose by pool type:

- **Concentrated liquidity** (V3-style, V4): the deepest pools for liquid pairs, several fee tiers
  per pair, and a price limit, so a fill can stop part way and return the rest.
- **Constant-product pairs** (Uniswap V2 and its forks, Solidly-style volatile pools): one pool per
  pair, no price limit; a fill is bounded only by the minimum output you check.
- **Stable pools** (Curve, Solidly-style stable pools): built for assets meant to trade near 1:1,
  with less price impact there than a constant-product pair.
- **One trade across several pools** under one limit: `sauce-distributed-swap`.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aerodrome](aerodrome.md) ([registry](registry/aerodrome.md)) | — | `Aerodrome`: base | base |
| [Aerodrome Slipstream](aerodrome-slipstream.md) ([registry](registry/aerodrome-slipstream.md)) | — | — | arc, base |
| [Ambient](ambient.md) ([registry](registry/ambient.md)) | — | — | ethereum, scroll |
| [Balancer V2](balancer-v2.md) ([registry](registry/balancer-v2.md)) | — | — | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche |
| [BaseSwap](baseswap.md) ([registry](registry/baseswap.md)) | — | — | base |
| [Camelot](camelot.md) ([registry](registry/camelot.md)) | — | — | arbitrum |
| [Curve Finance](curve.md) ([registry](registry/curve.md)) | — | — | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| [DODO](dodo.md) ([registry](registry/dodo.md)) | — | — | ethereum, bsc |
| [Fenix](fenix.md) ([registry](registry/fenix.md)) | — | — | blast |
| [Kim](kim.md) ([registry](registry/kim.md)) | — | — | mode |
| [KyberSwap](kyberswap.md) ([registry](registry/kyberswap.md)) | — | — | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Lynex](lynex.md) ([registry](registry/lynex.md)) | — | — | linea |
| [Maverick](maverick.md) ([registry](registry/maverick.md)) | — | — | ethereum, base, arbitrum |
| [PancakeSwap V2](pancakeswap-v2.md) ([registry](registry/pancakeswap-v2.md)) | `Pancakeswap` | `PancakeswapV2`: ethereum, bsc, monad, opbnb, base, arbitrum, linea | ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| [PancakeSwap V3](pancakeswap-v3.md) ([registry](registry/pancakeswap-v3.md)) | — | — | ethereum, bsc, base, arbitrum, linea |
| [QuickSwap](quickswap.md) ([registry](registry/quickswap.md)) | — | — | polygon |
| [Ramses](ramses.md) ([registry](registry/ramses.md)) | — | — | arbitrum |
| [SpookySwap](spookyswap.md) ([registry](registry/spookyswap.md)) | — | — | fantom |
| [SushiSwap V2](sushiswap-v2.md) ([registry](registry/sushiswap-v2.md)) | `Sushiswap` | `SushiswapV2`: ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [SyncSwap](syncswap.md) ([registry](registry/syncswap.md)) | — | — | zksync |
| [Synthra V3](synthra-v3.md) ([registry](registry/synthra-v3.md)) | — | — | arc |
| [Thena](thena.md) ([registry](registry/thena.md)) | — | — | bsc |
| [Thruster](thruster.md) ([registry](registry/thruster.md)) | — | — | blast |
| [Trader Joe](trader-joe.md) ([registry](registry/trader-joe.md)) | — | — | bsc, arbitrum, avalanche |
| [Uniswap V2](uniswap-v2.md) ([registry](registry/uniswap-v2.md)) | `Uniswap` | `UniswapV2`: ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| [Uniswap V3](uniswap-v3.md) ([registry](registry/uniswap-v3.md)) | `Uniswap` | `UniswapV3`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| [Uniswap V4](uniswap-v4.md) ([registry](registry/uniswap-v4.md)) | `Uniswap` | `UniswapV4`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast |
| [UnitFlow V3](unitflow-v3.md) ([registry](registry/unitflow-v3.md)) | — | — | arc |
| [Velodrome](velodrome.md) ([registry](registry/velodrome.md)) | — | — | optimism |

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
| [CoW Swap](cowswap.md) ([registry](registry/cowswap.md)) | — | — | ethereum, arbitrum |
| [KyberSwap Aggregator](kyberswap-aggregator.md) ([registry](registry/kyberswap-aggregator.md)) | — | — | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [1inch](oneinch.md) ([registry](registry/oneinch.md)) | — | `Oneinch`: ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [OpenOcean](openocean.md) ([registry](registry/openocean.md)) | — | — | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| [ParaSwap](paraswap.md) ([registry](registry/paraswap.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [0x Protocol](zerox.md) ([registry](registry/zerox.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

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
| [Aave V4](aave-v4.md) ([registry](registry/aave-v4.md)) | — | — | ethereum, arc, base, avalanche |
| [Benqi](benqi.md) ([registry](registry/benqi.md)) | — | — | avalanche |
| [Compound V2](compound-v2.md) ([registry](registry/compound-v2.md)) | — | — | ethereum |
| [Compound V3](compound-v3.md) ([registry](registry/compound-v3.md)) | `Compound` | `CompoundV3`: ethereum, optimism, polygon, base, arbitrum, scroll | ethereum, optimism, polygon, base, arbitrum, scroll |
| [Euler V2](euler-v2.md) ([registry](registry/euler-v2.md)) | — | — | ethereum |
| [Fluid](fluid.md) ([registry](registry/fluid.md)) | — | — | ethereum, arbitrum |
| [LayerBank](layerbank.md) ([registry](registry/layerbank.md)) | — | — | scroll |
| [Moonwell](moonwell.md) ([registry](registry/moonwell.md)) | — | — | base |
| [Morpho Blue](morpho-blue.md) ([registry](registry/morpho-blue.md)) | — | `MorphoBlue`: ethereum, monad, arc, base | ethereum, monad, arc, base |
| [Radiant](radiant.md) ([registry](registry/radiant.md)) | — | — | arbitrum |
| [Seamless](seamless.md) ([registry](registry/seamless.md)) | — | — | base |
| [Silo](silo.md) ([registry](registry/silo.md)) | — | — | ethereum, arbitrum |
| [Spark](spark.md) ([registry](registry/spark.md)) | — | — | ethereum |
| [Venus](venus.md) ([registry](registry/venus.md)) | — | — | bsc |
| [ZeroLend](zerolend.md) ([registry](registry/zerolend.md)) | — | — | zksync |

## CDPs and stablecoins (10)

### Choosing between them

Mint a stablecoin against collateral (Maker and Sky's DAI and USDS, Liquity's LUSD and BOLD,
crvUSD, GHO, RAI, MIM, Alchemix's self-repaying alUSD and alETH), or hold a yield-bearing
wrapper of one (sDAI, Ethena's sUSDe). Each sets its own collateral ratio, rate and liquidation
rules. The stablecoin itself is an ordinary ERC-20 to transfer.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Abracadabra](abracadabra.md) ([registry](registry/abracadabra.md)) | — | — | ethereum, arbitrum |
| [Alchemix](alchemix.md) ([registry](registry/alchemix.md)) | — | — | ethereum |
| [crvUSD](crvusd.md) ([registry](registry/crvusd.md)) | — | — | ethereum |
| [Ethena](ethena.md) ([registry](registry/ethena.md)) | — | — | ethereum |
| [Frax Finance](frax.md) ([registry](registry/frax.md)) | — | — | ethereum |
| [GHO](gho.md) ([registry](registry/gho.md)) | — | — | ethereum |
| [Liquity V1](liquity-v1.md) ([registry](registry/liquity-v1.md)) | — | — | ethereum |
| [Liquity V2](liquity-v2.md) ([registry](registry/liquity-v2.md)) | — | — | ethereum |
| [Maker](maker.md) ([registry](registry/maker.md)) | — | — | ethereum |
| [Reflexer](reflexer.md) ([registry](registry/reflexer.md)) | — | — | ethereum |

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
| [Across](across.md) ([registry](registry/across.md)) | — | — | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| [Arbitrum Native Bridge](arbitrum-bridge.md) ([registry](registry/arbitrum-bridge.md)) | — | — | ethereum, arbitrum |
| [Base Native Bridge](base-bridge.md) ([registry](registry/base-bridge.md)) | — | — | ethereum, base |
| CCTP ([registry](registry/cctp.md)) | — | `Cctp`: ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea |
| [Celer Network](celer.md) ([registry](registry/celer.md)) | — | — | ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| [Connext (Everclear)](connext.md) ([registry](registry/connext.md)) | — | — | ethereum, optimism, base, arbitrum |
| [deBridge](debridge.md) ([registry](registry/debridge.md)) | — | — | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [Hop Protocol](hop.md) ([registry](registry/hop.md)) | — | — | ethereum, optimism, polygon, base, arbitrum |
| [LI.FI](lifi.md) ([registry](registry/lifi.md)) | — | — | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| [Linea Native Bridge](linea-bridge.md) ([registry](registry/linea-bridge.md)) | — | — | ethereum, linea |
| [Optimism Native Bridge](optimism-bridge.md) ([registry](registry/optimism-bridge.md)) | — | — | ethereum, optimism |
| [Polygon Native Bridge](polygon-bridge.md) ([registry](registry/polygon-bridge.md)) | — | — | ethereum, polygon |
| [Scroll Native Bridge](scroll-bridge.md) ([registry](registry/scroll-bridge.md)) | — | — | ethereum, scroll |
| [Socket](socket.md) ([registry](registry/socket.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Squid Router](squid.md) ([registry](registry/squid.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Stargate](stargate.md) ([registry](registry/stargate.md)) | — | — | ethereum, base, arbitrum |
| [Synapse Protocol](synapse.md) ([registry](registry/synapse.md)) | — | — | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [zkSync Native Bridge](zksync-bridge.md) ([registry](registry/zksync-bridge.md)) | — | — | ethereum, zksync |

## Cross-chain messaging (6)

### Choosing between them

Messaging protocols (LayerZero, Wormhole, Axelar, Chainlink CCIP, Hyperlane) carry arbitrary
messages, each with its own set of verifiers and a fee paid at send time in the native coin (an
`evm.call` with value). Circle Gateway keeps one USDC balance spendable across chains.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Axelar](axelar.md) ([registry](registry/axelar.md)) | — | — | ethereum, optimism, polygon, base, arbitrum, avalanche |
| [Chainlink CCIP](chainlink-ccip.md) ([registry](registry/chainlink-ccip.md)) | — | — | ethereum, optimism, polygon, arc, base, arbitrum |
| [Circle Gateway](circle-gateway.md) ([registry](registry/circle-gateway.md)) | — | — | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche |
| [Hyperlane](hyperlane.md) ([registry](registry/hyperlane.md)) | — | — | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| [LayerZero](layerzero.md) ([registry](registry/layerzero.md)) | — | — | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| [Wormhole](wormhole.md) ([registry](registry/wormhole.md)) | — | — | ethereum, optimism, polygon, arc, base, arbitrum, avalanche |

## Liquid staking (7)

### Choosing between them

Staking ETH returns a liquid token of one of two kinds. A **rebasing** balance (stETH) changes
on its own, so measure it as a delta at the moment you use it, and hold the wrapped form
(wstETH) instead. An **exchange-rate** token (rETH, cbETH, sfrxETH, ETHx, swETH, mETH) keeps its
balance and grows in value. Withdrawals to ETH go through each protocol's queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Coinbase Wrapped Staked ETH](cbeth.md) ([registry](registry/cbeth.md)) | — | — | ethereum, base |
| [Frax Ether](frax-ether.md) ([registry](registry/frax-ether.md)) | — | — | ethereum |
| [Lido](lido.md) ([registry](registry/lido.md)) | — | — | ethereum, arbitrum |
| [Mantle mETH](mantle-meth.md) ([registry](registry/mantle-meth.md)) | — | — | ethereum |
| [Rocket Pool](rocket-pool.md) ([registry](registry/rocket-pool.md)) | — | — | ethereum |
| [Stader](stader.md) ([registry](registry/stader.md)) | — | — | ethereum |
| [Swell](swell.md) ([registry](registry/swell.md)) | — | — | ethereum |

## Restaking (5)

### Choosing between them

Restaking (EigenLayer, and the liquid restaking tokens of ether.fi, Renzo, Kelp and Puffer) adds
the risk of slashing to staking for extra rewards. A liquid restaking token can trade below its
underlying, and withdraws through a queue.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [EigenLayer](eigenlayer.md) ([registry](registry/eigenlayer.md)) | — | — | ethereum |
| [ether.fi](etherfi.md) ([registry](registry/etherfi.md)) | — | — | ethereum |
| [Kelp DAO](kelp.md) ([registry](registry/kelp.md)) | — | — | ethereum |
| [Puffer Finance](puffer.md) ([registry](registry/puffer.md)) | — | — | ethereum |
| [Renzo](renzo.md) ([registry](registry/renzo.md)) | — | — | ethereum |

## Staking (1)

### Choosing between them

Olympus stakes OHM into its staked forms.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Olympus DAO](olympus.md) ([registry](registry/olympus.md)) | — | — | ethereum |

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
| [Arrakis Finance](arrakis.md) ([registry](registry/arrakis.md)) | — | — | ethereum |
| [Beefy Finance](beefy.md) ([registry](registry/beefy.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Convex Finance](convex.md) ([registry](registry/convex.md)) | — | — | ethereum |
| [Gamma Strategies](gamma.md) ([registry](registry/gamma.md)) | — | — | ethereum, polygon |
| [Harvest Finance](harvest.md) ([registry](registry/harvest.md)) | — | — | ethereum |
| [Pendle](pendle.md) ([registry](registry/pendle.md)) | — | `Pendle`: ethereum, monad, arbitrum | ethereum, monad, arbitrum |
| [Sommelier](sommelier.md) ([registry](registry/sommelier.md)) | — | — | ethereum |
| [Tokemak](tokemak.md) ([registry](registry/tokemak.md)) | — | — | ethereum |
| [Yearn V3](yearn-v3.md) ([registry](registry/yearn-v3.md)) | — | — | ethereum |

## Perpetuals (7)

### Choosing between them

Leveraged positions often execute in two steps: the program sends a request, and a keeper
executes it later at a price it reads then (GMX's orders are this way). A program cannot see
that fill in its own transaction, so it bounds the request (acceptable price, deadline) instead.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Gains Network](gains-network.md) ([registry](registry/gains-network.md)) | — | — | polygon, arbitrum |
| [GMX V1](gmx-v1.md) ([registry](registry/gmx-v1.md)) | — | — | arbitrum, avalanche |
| [GMX V2](gmx-v2.md) ([registry](registry/gmx-v2.md)) | — | — | arbitrum |
| [Level Finance](level-finance.md) ([registry](registry/level-finance.md)) | — | — | bsc, arbitrum |
| [MUX Protocol](mux-protocol.md) ([registry](registry/mux-protocol.md)) | — | — | arbitrum |
| [Perpetual Protocol](perpetual-protocol.md) ([registry](registry/perpetual-protocol.md)) | — | — | optimism |
| [Vertex](vertex.md) ([registry](registry/vertex.md)) | — | — | arbitrum |

## Synthetics (1)

### Choosing between them

Synthetix V3 takes collateral into an account and mints against it; positions and rewards are
per account.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Synthetix V3](synthetix-v3.md) ([registry](registry/synthetix-v3.md)) | — | — | base |

## Options (5)

### Choosing between them

Options protocols (Premia, Hegic, Opyn, Thales, Aevo) settle at expiry or exercise; a program
buys, exercises or settles a position it holds.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Aevo](aevo.md) ([registry](registry/aevo.md)) | — | — | ethereum |
| [Hegic](hegic.md) ([registry](registry/hegic.md)) | — | — | arbitrum |
| [Opyn](opyn.md) ([registry](registry/opyn.md)) | — | — | ethereum |
| [Premia](premia.md) ([registry](registry/premia.md)) | — | — | arbitrum |
| [Thales](thales.md) ([registry](registry/thales.md)) | — | — | optimism |

## Oracles (2)

### Choosing between them

Chainlink feeds are read on chain (`latestRoundData`): check `updatedAt` against a staleness
bound and scale by the feed's decimals. Pyth is pulled: the price is updated in the same
transaction (`updatePriceFeeds`, paying its fee as value) before it is read.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Chainlink](chainlink.md) ([registry](registry/chainlink.md)) | — | — | ethereum, arc |
| [Pyth Network](pyth.md) ([registry](registry/pyth.md)) | — | — | ethereum |

## Payments and streaming (2)

### Choosing between them

Sablier locks tokens into a schedule a recipient withdraws from; Superfluid streams Super Tokens
per second, so tokens are wrapped into Super Tokens first.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Sablier](sablier.md) ([registry](registry/sablier.md)) | — | — | ethereum |
| [Superfluid](superfluid.md) ([registry](registry/superfluid.md)) | — | — | ethereum, optimism, polygon, base, arbitrum |

## NFT marketplaces (1)

### Choosing between them

Seaport fills orders that makers signed off chain.

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| [Seaport](seaport.md) ([registry](registry/seaport.md)) | — | — | ethereum, optimism, polygon, arc, base, arbitrum |

## Infrastructure and standards (9)

### Choosing between them

Standards and services a program calls directly: ERC-20 (Sauce's token writes are SafeERC20),
ERC-4626 vaults, ERC-3156 flash loans, Permit2 (signed transfers and allowances), Safe accounts,
ENS, Gelato automation, Instadapp flash-loan routing, and Eco Routes, the intents layer
(`sauce-intents`).

| Protocol | Family | Namespace | Chains |
| --- | --- | --- | --- |
| Eco Routes ([registry](registry/eco-routes.md)) | — | — | none recorded |
| [ENS](ens.md) ([registry](registry/ens.md)) | — | — | ethereum |
| [ERC20](erc20.md) ([registry](registry/erc20.md)) | — | — | none recorded |
| [ERC-3156](erc3156.md) ([registry](registry/erc3156.md)) | — | — | none recorded |
| [ERC-4626](erc4626.md) ([registry](registry/erc4626.md)) | — | — | none recorded |
| [Gelato Network](gelato.md) ([registry](registry/gelato.md)) | — | — | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| [Instadapp](instadapp.md) ([registry](registry/instadapp.md)) | — | — | ethereum |
| [Permit2](permit2.md) ([registry](registry/permit2.md)) | — | `Permit2`: ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche |
| [Safe](safe.md) ([registry](registry/safe.md)) | — | — | ethereum, optimism, polygon, arc, base, arbitrum |
