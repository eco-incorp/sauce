<!-- Generated from the SDK's protocol registry. Do not edit. -->

# Protocol index

Every protocol the SDK registers: the chains its registry records deployments on, and the
SauceScript templates its module carries. Each linked protocol has a document beside this file,
`<slug>.md`, with its addresses, ABI notes and templates. A recorded deployment is an address,
not proof of live code on the chain.

These documents describe each protocol's own contracts. Inside a Sauce program:

- **Swap** through the Sauce Router, with a price limit and a minimum output (`sauce-swaps`);
  across several pools under one limit, `sauce-distributed-swap`. A protocol's own router is
  for a pool the Sauce Router does not service.
- **Call a protocol** by its namespace where `sauce-globals` lists one (`UniswapV3.Factory`,
  `AaveV3.Pool`); otherwise import its ABI and pass its address as a define (`sauce-protocols`).
- **Continue on another chain** with an intent (`sauce-intents`).

## From TypeScript

```typescript
// A protocol module: its info, its deployments, its ABIs and each SauceScript template by name
import { protocolInfo, deployments, supply } from "@eco-incorp/sauce/protocols/aave-v3";

// The registry queries
import {
  getProtocol,
  listProtocols,
  getProtocolsByCategory,
  getProtocolsByChain,
} from "@eco-incorp/sauce";

const aave = getProtocol("aave-v3"); // Single protocol by slug
const dexes = getProtocolsByCategory("dex"); // All DEXes
const baseProt = getProtocolsByChain(8453); // All protocols on Base
```

From TypeScript, `getProtocolSkill(slug)` and `getProtocolIndex()` from
`@eco-incorp/sauce/skills` return these documents.

## By category

### DEX (29)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Aerodrome](aerodrome.md) | `aerodrome` | base | `addLiquidity`, `removeLiquidity`, `swap` |
| [Aerodrome Slipstream](aerodrome-slipstream.md) | `aerodrome-slipstream` | arc, base | `getPool` |
| [Ambient](ambient.md) | `ambient` | ethereum, scroll | `swap` |
| [Balancer V2](balancer-v2.md) | `balancer-v2` | ethereum, optimism, bsc, gnosis, polygon, base, arbitrum, avalanche | `addLiquidity`, `removeLiquidity`, `swap` |
| [BaseSwap](baseswap.md) | `baseswap` | base | `addLiquidity`, `removeLiquidity`, `swap` |
| [Camelot](camelot.md) | `camelot` | arbitrum | `addLiquidity`, `removeLiquidity`, `swapV2`, `swapV3` |
| [Curve Finance](curve.md) | `curve` | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche | `addLiquidity`, `removeLiquidity`, `swap` |
| [DODO](dodo.md) | `dodo` | ethereum, bsc | `swap` |
| [Fenix](fenix.md) | `fenix` | blast | `swap` |
| [Kim](kim.md) | `kim` | mode | `swap` |
| [KyberSwap](kyberswap.md) | `kyberswap` | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | `swap` |
| [Lynex](lynex.md) | `lynex` | linea | `swap` |
| [Maverick](maverick.md) | `maverick` | ethereum, base, arbitrum | `swap` |
| [PancakeSwap V2](pancakeswap-v2.md) | `pancakeswap-v2` | ethereum, bsc, monad, opbnb, base, arbitrum, linea | `addLiquidity`, `removeLiquidity`, `swap` |
| [PancakeSwap V3](pancakeswap-v3.md) | `pancakeswap-v3` | ethereum, bsc, base, arbitrum, linea | `swap` |
| [QuickSwap](quickswap.md) | `quickswap` | polygon | `addLiquidity`, `removeLiquidity`, `swapV2`, `swapV3` |
| [Ramses](ramses.md) | `ramses` | arbitrum | `swap` |
| [SpookySwap](spookyswap.md) | `spookyswap` | fantom | `addLiquidity`, `removeLiquidity`, `swap` |
| [SushiSwap V2](sushiswap-v2.md) | `sushiswap-v2` | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | `addLiquidity`, `removeLiquidity`, `swap` |
| [SyncSwap](syncswap.md) | `syncswap` | zksync | `swap` |
| [Synthra V3](synthra-v3.md) | `synthra-v3` | arc | `swap` |
| [Thena](thena.md) | `thena` | bsc | `swap` |
| [Thruster](thruster.md) | `thruster` | blast | `swap` |
| [Trader Joe](trader-joe.md) | `trader-joe` | bsc, arbitrum, avalanche | `swap` |
| [Uniswap V2](uniswap-v2.md) | `uniswap-v2` | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora | `addLiquidity`, `removeLiquidity`, `swap` |
| [Uniswap V3](uniswap-v3.md) | `uniswap-v3` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche | `addLiquidity`, `removeLiquidity`, `swap` |
| [Uniswap V4](uniswap-v4.md) | `uniswap-v4` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast | `addLiquidity`, `removeLiquidity`, `swap` |
| [UnitFlow V3](unitflow-v3.md) | `unitflow-v3` | arc | `swap` |
| [Velodrome](velodrome.md) | `velodrome` | optimism | `addLiquidity`, `removeLiquidity`, `swap` |

### Aggregators (6)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [CoW Swap](cowswap.md) | `cowswap` | ethereum, arbitrum | `invalidateOrder`, `preSignOrder` |
| [KyberSwap Aggregator](kyberswap-aggregator.md) | `kyberswap-aggregator` | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll | `swap` |
| [1inch](oneinch.md) | `oneinch` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `unoswap` |
| [OpenOcean](openocean.md) | `openocean` | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche | `swap` |
| [ParaSwap](paraswap.md) | `paraswap` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `simpleSwap` |
| [0x Protocol](zerox.md) | `zerox` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `transformERC20` |

### Lending (17)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Aave V2](aave-v2.md) | `aave-v2` | ethereum, polygon, avalanche | `borrow`, `deposit`, `repay`, `withdraw` |
| [Aave V3](aave-v3.md) | `aave-v3` | ethereum, optimism, bsc, gnosis, polygon, monad, fantom, metis, base, arbitrum, avalanche, scroll | `borrow`, `repay`, `supply`, `withdraw` |
| [Aave V4](aave-v4.md) | `aave-v4` | ethereum, arc, base, avalanche | `borrow`, `repay`, `supply`, `withdraw` |
| [Benqi](benqi.md) | `benqi` | avalanche | `borrow`, `repay`, `supply`, `withdraw` |
| [Compound V2](compound-v2.md) | `compound-v2` | ethereum | `borrow`, `repay`, `supply`, `withdraw` |
| [Compound V3](compound-v3.md) | `compound-v3` | ethereum, optimism, polygon, base, arbitrum, scroll | `supply`, `supplyTo`, `withdraw`, `withdrawTo` |
| [Euler V2](euler-v2.md) | `euler-v2` | ethereum | `borrow`, `deposit`, `repay`, `withdraw` |
| [Fluid](fluid.md) | `fluid` | ethereum, arbitrum | `borrow`, `deposit`, `repay`, `withdraw` |
| [LayerBank](layerbank.md) | `layerbank` | scroll | `borrow`, `repay`, `supply`, `withdraw` |
| [Moonwell](moonwell.md) | `moonwell` | base | `borrow`, `repay`, `supply`, `withdraw` |
| [Morpho Blue](morpho-blue.md) | `morpho-blue` | ethereum, monad, arc, base | `borrow`, `repay`, `supply`, `withdraw` |
| [Radiant](radiant.md) | `radiant` | arbitrum | `borrow`, `deposit`, `repay`, `withdraw` |
| [Seamless](seamless.md) | `seamless` | base | `borrow`, `repay`, `supply`, `withdraw` |
| [Silo](silo.md) | `silo` | ethereum, arbitrum | `borrow`, `deposit`, `repay`, `withdraw` |
| [Spark](spark.md) | `spark` | ethereum | `borrow`, `repay`, `supply`, `withdraw` |
| [Venus](venus.md) | `venus` | bsc | `borrow`, `repay`, `supply`, `withdraw` |
| [ZeroLend](zerolend.md) | `zerolend` | zksync | `borrow`, `repay`, `supply`, `withdraw` |

### CDPs and stablecoins (10)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Abracadabra](abracadabra.md) | `abracadabra` | ethereum, arbitrum | `addCollateral`, `borrow`, `removeCollateral`, `repay` |
| [Alchemix](alchemix.md) | `alchemix` | ethereum | `burn`, `deposit`, `mint`, `withdraw` |
| [crvUSD](crvusd.md) | `crvusd` | ethereum | `approve`, `transfer` |
| [Ethena](ethena.md) | `ethena` | ethereum | `cooldownAssets`, `stakeUSDe`, `unstake` |
| [Frax Finance](frax.md) | `frax` | ethereum | `approve`, `transfer` |
| [GHO](gho.md) | `gho` | ethereum | `approve`, `transfer` |
| [Liquity V1](liquity-v1.md) | `liquity-v1` | ethereum | `closeTrove`, `repayLUSD` |
| [Liquity V2](liquity-v2.md) | `liquity-v2` | ethereum | `approve`, `transfer` |
| [Maker](maker.md) | `maker` | ethereum | `depositToSDAI`, `redeemFromSDAI`, `withdrawFromSDAI` |
| [Reflexer](reflexer.md) | `reflexer` | ethereum | `exitRai`, `joinRai` |

### Bridges (18)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Across](across.md) | `across` | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll | `bridge` |
| [Arbitrum Native Bridge](arbitrum-bridge.md) | `arbitrum-bridge` | ethereum, arbitrum | `depositToL2` |
| [Base Native Bridge](base-bridge.md) | `base-bridge` | ethereum, base | `depositERC20`, `depositETH` |
| CCTP | `cctp` | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea | `depositForBurn` |
| [Celer Network](celer.md) | `celer` | ethereum, optimism, bsc, polygon, arbitrum, avalanche | `bridge` |
| [Connext (Everclear)](connext.md) | `connext` | ethereum, optimism, base, arbitrum | `bridge` |
| [deBridge](debridge.md) | `debridge` | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | `bridge` |
| [Hop Protocol](hop.md) | `hop` | ethereum, optimism, polygon, base, arbitrum | `bridgeFromL1` |
| [LI.FI](lifi.md) | `lifi` | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche | `bridge` |
| [Linea Native Bridge](linea-bridge.md) | `linea-bridge` | ethereum, linea | `bridgeETH` |
| [Optimism Native Bridge](optimism-bridge.md) | `optimism-bridge` | ethereum, optimism | `depositERC20`, `depositETH` |
| [Polygon Native Bridge](polygon-bridge.md) | `polygon-bridge` | ethereum, polygon | `depositERC20`, `depositETH` |
| [Scroll Native Bridge](scroll-bridge.md) | `scroll-bridge` | ethereum, scroll | `depositERC20`, `depositETH` |
| [Socket](socket.md) | `socket` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `bridge` |
| [Squid Router](squid.md) | `squid` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `bridge` |
| [Stargate](stargate.md) | `stargate` | ethereum, base, arbitrum | `bridge` |
| [Synapse Protocol](synapse.md) | `synapse` | ethereum, optimism, polygon, base, arbitrum, avalanche | `bridge` |
| [zkSync Native Bridge](zksync-bridge.md) | `zksync-bridge` | ethereum, zksync | `depositETH` |

### Cross-chain messaging (6)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Axelar](axelar.md) | `axelar` | ethereum, optimism, polygon, base, arbitrum, avalanche | `sendToken` |
| [Chainlink CCIP](chainlink-ccip.md) | `chainlink-ccip` | ethereum, optimism, polygon, arc, base, arbitrum | `sendMessage` |
| [Circle Gateway](circle-gateway.md) | `circle-gateway` | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche | `availableBalance`, `deposit`, `gatewayMint` |
| [Hyperlane](hyperlane.md) | `hyperlane` | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche | `dispatch` |
| [LayerZero](layerzero.md) | `layerzero` | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll | `sendMessage` |
| [Wormhole](wormhole.md) | `wormhole` | ethereum, optimism, polygon, arc, base, arbitrum, avalanche | `bridgeTokens` |

### Liquid staking (7)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Coinbase Wrapped Staked ETH](cbeth.md) | `cbeth` | ethereum, base | `approve`, `transfer` |
| [Frax Ether](frax-ether.md) | `frax-ether` | ethereum | `deposit`, `redeem`, `submitAndDeposit` |
| [Lido](lido.md) | `lido` | ethereum, arbitrum | `submit`, `unwrap`, `wrap` |
| [Mantle mETH](mantle-meth.md) | `mantle-meth` | ethereum | `stake` |
| [Rocket Pool](rocket-pool.md) | `rocket-pool` | ethereum | `burn`, `deposit` |
| [Stader](stader.md) | `stader` | ethereum | `deposit` |
| [Swell](swell.md) | `swell` | ethereum | `stakeRswETH`, `stakeSwETH` |

### Restaking (5)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [EigenLayer](eigenlayer.md) | `eigenlayer` | ethereum | `depositIntoStrategy` |
| [ether.fi](etherfi.md) | `etherfi` | ethereum | `deposit`, `unwrap`, `wrap` |
| [Kelp DAO](kelp.md) | `kelp` | ethereum | `depositAsset` |
| [Puffer Finance](puffer.md) | `puffer` | ethereum | `deposit`, `redeem` |
| [Renzo](renzo.md) | `renzo` | ethereum | `deposit`, `depositETH` |

### Staking (1)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Olympus DAO](olympus.md) | `olympus` | ethereum | `stake`, `unstake` |

### Yield and vaults (9)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Arrakis Finance](arrakis.md) | `arrakis` | ethereum | `addLiquidity`, `removeLiquidity` |
| [Beefy Finance](beefy.md) | `beefy` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `deposit`, `depositAll`, `withdraw`, `withdrawAll` |
| [Convex Finance](convex.md) | `convex` | ethereum | `deposit`, `getReward`, `withdraw` |
| [Gamma Strategies](gamma.md) | `gamma` | ethereum, polygon | `deposit`, `depositLegacy`, `withdraw` |
| [Harvest Finance](harvest.md) | `harvest` | ethereum | `deposit`, `getPricePerFullShare`, `withdraw` |
| [Pendle](pendle.md) | `pendle` | ethereum, monad, arbitrum | `addLiquiditySingleToken`, `removeLiquiditySingleToken`, `swapExactTokenForPt`, `swapExactTokenForYt` |
| [Sommelier](sommelier.md) | `sommelier` | ethereum | `deposit`, `redeem`, `withdraw` |
| [Tokemak](tokemak.md) | `tokemak` | ethereum | `deposit`, `redeem`, `withdraw` |
| [Yearn V3](yearn-v3.md) | `yearn-v3` | ethereum | `deposit`, `redeem`, `withdraw` |

### Perpetuals (7)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Gains Network](gains-network.md) | `gains-network` | polygon, arbitrum | `closeTradeMarket`, `updateStopLoss`, `updateTakeProfit` |
| [GMX V1](gmx-v1.md) | `gmx-v1` | arbitrum, avalanche | `closePosition`, `openPosition`, `swap` |
| [GMX V2](gmx-v2.md) | `gmx-v2` | arbitrum | `cancelOrder`, `createOrder`, `sendTokens` |
| [Level Finance](level-finance.md) | `level-finance` | bsc, arbitrum | `addLiquidity`, `removeLiquidity` |
| [MUX Protocol](mux-protocol.md) | `mux-protocol` | arbitrum | `addLiquidity`, `removeLiquidity` |
| [Perpetual Protocol](perpetual-protocol.md) | `perpetual-protocol` | optimism | `deposit`, `withdraw` |
| [Vertex](vertex.md) | `vertex` | arbitrum | `depositCollateral` |

### Synthetics (1)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Synthetix V3](synthetix-v3.md) | `synthetix-v3` | base | `deposit`, `withdraw` |

### Options (5)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Aevo](aevo.md) | `aevo` | ethereum | `depositERC20` |
| [Hegic](hegic.md) | `hegic` | arbitrum | `exerciseOption` |
| [Opyn](opyn.md) | `opyn` | ethereum | `burnSqueeth`, `withdrawCollateral` |
| [Premia](premia.md) | `premia` | arbitrum | `exercise`, `settle` |
| [Thales](thales.md) | `thales` | optimism | `buyFromAMM`, `exerciseMarket` |

### Oracles (2)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Chainlink](chainlink.md) | `chainlink` | ethereum, arc | `getLatestPrice` |
| [Pyth Network](pyth.md) | `pyth` | ethereum | `getPrice` |

### Payments and streaming (2)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Sablier](sablier.md) | `sablier` | ethereum | `cancelStream`, `withdrawFromStream` |
| [Superfluid](superfluid.md) | `superfluid` | ethereum, optimism, polygon, base, arbitrum | `createFlow`, `deleteFlow`, `updateFlow` |

### NFT marketplaces (1)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| [Seaport](seaport.md) | `seaport` | ethereum, optimism, polygon, arc, base, arbitrum | `fulfillBasicOrder` |

### Infrastructure and standards (9)

| Protocol | Slug | Chains | Templates |
| --- | --- | --- | --- |
| Eco Routes | `eco-routes` | none recorded | `ECO_ROUTES_DEFAULT_ENVIRONMENT`, `ECO_ROUTES_DEFAULT_GENERATION`, `fundIntent`, `rewardStatus` |
| [ENS](ens.md) | `ens` | ethereum | `setOwner`, `setResolver` |
| [ERC20](erc20.md) | `erc20` | none recorded | `approve`, `balanceOf`, `storageTransfer`, `transfer`, `transferFrom` |
| [ERC-3156](erc3156.md) | `erc3156` | none recorded | `flashFee`, `maxFlashLoan` |
| [ERC-4626](erc4626.md) | `erc4626` | none recorded | `convertToAssets`, `convertToShares`, `deposit`, `mint`, `previewDeposit`, `previewWithdraw`, `redeem`, `withdraw` |
| [Gelato Network](gelato.md) | `gelato` | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche | `cancelTask`, `createTask` |
| [Instadapp](instadapp.md) | `instadapp` | ethereum | `getRoutes` |
| [Permit2](permit2.md) | `permit2` | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche | `approve`, `transferFrom` |
| [Safe](safe.md) | `safe` | ethereum, optimism, polygon, arc, base, arbitrum | `getThreshold` |

## By chain

Every protocol with a deployment recorded on the chain.

| Chain | Id | Protocols |
| --- | --- | --- |
| Ethereum (`ethereum`) | 1 | aave-v2, aave-v3, aave-v4, abracadabra, across, aevo, alchemix, ambient, arbitrum-bridge, arrakis, axelar, balancer-v2, base-bridge, beefy, cbeth, cctp, celer, chainlink, chainlink-ccip, circle-gateway, compound-v2, compound-v3, connext, convex, cowswap, crvusd, curve, debridge, dodo, eigenlayer, ens, ethena, etherfi, euler-v2, fluid, frax, frax-ether, gamma, gelato, gho, harvest, hop, hyperlane, instadapp, kelp, kyberswap, kyberswap-aggregator, layerzero, lido, lifi, linea-bridge, liquity-v1, liquity-v2, maker, mantle-meth, maverick, morpho-blue, olympus, oneinch, openocean, optimism-bridge, opyn, pancakeswap-v2, pancakeswap-v3, paraswap, pendle, permit2, polygon-bridge, puffer, pyth, reflexer, renzo, rocket-pool, sablier, safe, scroll-bridge, seaport, silo, socket, sommelier, spark, squid, stader, stargate, superfluid, sushiswap-v2, swell, synapse, tokemak, uniswap-v2, uniswap-v3, uniswap-v4, wormhole, yearn-v3, zerox, zksync-bridge |
| Optimism (`optimism`) | 10 | aave-v3, across, axelar, balancer-v2, beefy, cctp, celer, chainlink-ccip, circle-gateway, compound-v3, connext, curve, debridge, gelato, hop, hyperlane, kyberswap, kyberswap-aggregator, layerzero, lifi, oneinch, openocean, optimism-bridge, paraswap, permit2, perpetual-protocol, safe, seaport, socket, squid, superfluid, sushiswap-v2, synapse, thales, uniswap-v2, uniswap-v3, uniswap-v4, velodrome, wormhole, zerox |
| BNB Chain (`bsc`) | 56 | aave-v3, balancer-v2, beefy, celer, debridge, dodo, gelato, hyperlane, kyberswap, kyberswap-aggregator, layerzero, level-finance, lifi, oneinch, openocean, pancakeswap-v2, pancakeswap-v3, paraswap, permit2, socket, squid, sushiswap-v2, thena, trader-joe, uniswap-v2, uniswap-v3, uniswap-v4, venus, zerox |
| Gnosis (`gnosis`) | 100 | aave-v3, balancer-v2, curve, lifi |
| Unichain (`unichain`) | 130 | cctp, circle-gateway |
| Polygon (`polygon`) | 137 | aave-v2, aave-v3, across, axelar, balancer-v2, beefy, cctp, celer, chainlink-ccip, circle-gateway, compound-v3, curve, debridge, gains-network, gamma, gelato, hop, hyperlane, kyberswap, kyberswap-aggregator, layerzero, lifi, oneinch, openocean, paraswap, permit2, polygon-bridge, quickswap, safe, seaport, socket, squid, superfluid, sushiswap-v2, synapse, uniswap-v2, uniswap-v3, uniswap-v4, wormhole, zerox |
| Monad (`monad`) | 143 | aave-v3, cctp, morpho-blue, pancakeswap-v2, pendle, permit2, uniswap-v3, uniswap-v4 |
| Sonic (`sonic`) | 146 | cctp, circle-gateway |
| opBNB (`opbnb`) | 204 | pancakeswap-v2 |
| Fantom (`fantom`) | 250 | aave-v3, curve, kyberswap-aggregator, lifi, openocean, spookyswap, sushiswap-v2 |
| zkSync Era (`zksync`) | 324 | across, kyberswap-aggregator, layerzero, syncswap, zerolend, zksync-bridge |
| Metis (`metis`) | 1088 | aave-v3 |
| Sei (`sei`) | 1329 | circle-gateway |
| Arc (`arc`) | 5042 | aave-v4, across, aerodrome-slipstream, cctp, chainlink, chainlink-ccip, circle-gateway, debridge, hyperlane, kyberswap, kyberswap-aggregator, layerzero, lifi, morpho-blue, permit2, safe, seaport, synthra-v3, uniswap-v2, uniswap-v3, uniswap-v4, unitflow-v3, wormhole |
| Base (`base`) | 8453 | aave-v3, aave-v4, across, aerodrome, aerodrome-slipstream, axelar, balancer-v2, base-bridge, baseswap, beefy, cbeth, cctp, chainlink-ccip, circle-gateway, compound-v3, connext, curve, debridge, gelato, hop, hyperlane, kyberswap, kyberswap-aggregator, layerzero, lifi, maverick, moonwell, morpho-blue, oneinch, pancakeswap-v2, pancakeswap-v3, paraswap, permit2, safe, seamless, seaport, socket, squid, stargate, superfluid, synapse, synthetix-v3, uniswap-v2, uniswap-v3, uniswap-v4, wormhole, zerox |
| Mode (`mode`) | 34443 | across, kim |
| Arbitrum One (`arbitrum`) | 42161 | aave-v3, abracadabra, across, arbitrum-bridge, axelar, balancer-v2, beefy, camelot, cctp, celer, chainlink-ccip, circle-gateway, compound-v3, connext, cowswap, curve, debridge, fluid, gains-network, gelato, gmx-v1, gmx-v2, hegic, hop, hyperlane, kyberswap, kyberswap-aggregator, layerzero, level-finance, lido, lifi, maverick, mux-protocol, oneinch, openocean, pancakeswap-v2, pancakeswap-v3, paraswap, pendle, permit2, premia, radiant, ramses, safe, seaport, silo, socket, squid, stargate, superfluid, sushiswap-v2, synapse, trader-joe, uniswap-v2, uniswap-v3, uniswap-v4, vertex, wormhole, zerox |
| Celo (`celo`) | 42220 | uniswap-v3 |
| Avalanche C-Chain (`avalanche`) | 43114 | aave-v2, aave-v3, aave-v4, axelar, balancer-v2, beefy, benqi, cctp, celer, circle-gateway, curve, debridge, gelato, gmx-v1, hyperlane, kyberswap, kyberswap-aggregator, layerzero, lifi, oneinch, openocean, paraswap, permit2, socket, squid, sushiswap-v2, synapse, trader-joe, uniswap-v2, uniswap-v3, uniswap-v4, wormhole, zerox |
| Linea (`linea`) | 59144 | across, cctp, kyberswap-aggregator, layerzero, linea-bridge, lynex, pancakeswap-v2, pancakeswap-v3 |
| Blast (`blast`) | 81457 | across, fenix, thruster, uniswap-v2, uniswap-v4 |
| Scroll (`scroll`) | 534352 | aave-v3, across, ambient, compound-v3, kyberswap-aggregator, layerbank, layerzero, scroll-bridge |
| Zora (`zora`) | 7777777 | uniswap-v2 |
