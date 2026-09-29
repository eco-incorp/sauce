# Sauce SDK Protocol Index

Master reference for all protocols in the Sauce SDK. Use this to find the right protocol for any DeFi operation.

## SDK Usage

```typescript
// Import specific protocol
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/{slug}";

// Query the registry
import {
  getProtocol,
  listProtocols,
  getProtocolsByCategory,
  getProtocolsByChain,
} from "@eco-incorp/sauce/protocols";

const aave = getProtocol("aave-v3"); // Single protocol by slug
const dexes = getProtocolsByCategory("dex"); // All DEXes
const baseProt = getProtocolsByChain(8453); // All protocols on Base
```

Each protocol module exports: `protocolInfo`, `deployments`, `abis`, and SauceScript functions.

---

## Protocol Registry

### DEX (29 protocols)

| Slug                   | Name                 | Chains                                          | Key Operations                                                   |
| ---------------------- | -------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `uniswap-v2`           | Uniswap V2           | ETH, ARB, OP, BASE, BSC, AVAX, POLY, BLAST, ARC | swap, addLiquidity, removeLiquidity                              |
| `uniswap-v3`           | Uniswap V3           | ETH, ARB, OP, BASE, BSC, AVAX, POLY, CELO, ARC  | swap (exactInputSingle), addLiquidity (mint), removeLiquidity    |
| `uniswap-v4`           | Uniswap V4           | ETH, ARB, OP, BASE, BSC, AVAX, POLY, BLAST, ARC | swap (UniversalRouter), modifyLiquidities                        |
| `sushiswap-v2`         | SushiSwap V2         | ETH, ARB, POLY, BSC, AVAX, FTM, OP              | swap, addLiquidity, removeLiquidity                              |
| `curve`                | Curve Finance        | ETH, ARB, OP, BASE, POLY, AVAX, FTM, GNOSIS     | exchange (by index), add_liquidity, remove_liquidity             |
| `balancer-v2`          | Balancer V2          | ETH, POLY, ARB, OP, GNOSIS, AVAX, BASE, BSC     | swap (Vault), joinPool, exitPool, flashLoan                      |
| `pancakeswap-v2`       | PancakeSwap V2       | BSC, ETH, ARB, BASE, LINEA, opBNB               | swap, addLiquidity, removeLiquidity                              |
| `pancakeswap-v3`       | PancakeSwap V3       | BSC, ETH, ARB, BASE, LINEA                      | swap (exactInputSingle)                                          |
| `velodrome`            | Velodrome            | OP                                              | swap (stable/volatile routes), addLiquidity, removeLiquidity     |
| `aerodrome`            | Aerodrome            | BASE                                            | swap (stable/volatile routes), addLiquidity, removeLiquidity     |
| `camelot`              | Camelot              | ARB                                             | swapV2, swapV3 (exactInputSingle), addLiquidity, removeLiquidity |
| `trader-joe`           | Trader Joe           | AVAX, ARB, BSC                                  | swap (Liquidity Book path)                                       |
| `kyberswap`            | KyberSwap            | ETH, ARB, OP, POLY, BSC, AVAX, BASE             | swap (Elastic + Meta Aggregation)                                |
| `quickswap`            | QuickSwap            | POLY                                            | swapV2, swapV3, addLiquidity, removeLiquidity                    |
| `maverick`             | Maverick             | ETH, ARB, BASE                                  | swap (exactInputSingle with pool+tokenAIn)                       |
| `ambient`              | Ambient              | ETH, SCROLL                                     | swap (CrocSwapDex)                                               |
| `dodo`                 | DODO                 | ETH, BSC                                        | swap (dodoSwapV2TokenToToken)                                    |
| `syncswap`             | SyncSwap             | zkSync                                          | swap (path-based with encoded data)                              |
| `baseswap`             | BaseSwap             | BASE                                            | swap, addLiquidity, removeLiquidity                              |
| `thruster`             | Thruster             | BLAST                                           | swap (exactInputSingle)                                          |
| `spookyswap`           | SpookySwap           | FTM                                             | swap, addLiquidity, removeLiquidity                              |
| `thena`                | Thena                | BSC                                             | swap (stable/volatile routes)                                    |
| `ramses`               | Ramses               | ARB                                             | swap (stable/volatile routes)                                    |
| `fenix`                | Fenix                | BLAST                                           | swap (stable/volatile routes)                                    |
| `lynex`                | Lynex                | LINEA                                           | swap (stable/volatile routes)                                    |
| `kim`                  | Kim                  | MODE                                            | swap (token path, Camelot-style router)                          |
| `synthra-v3`           | Synthra V3           | ARC                                             | swap (SwapRouter02 exactInputSingle)                             |
| `unitflow-v3`          | UnitFlow V3          | ARC                                             | swap (exactInputSingle with deadline)                            |
| `aerodrome-slipstream` | Aerodrome Slipstream | ARC                                             | getPool (tick-spacing keyed CL pools)                            |

### Lending (17 protocols)

| Slug          | Name        | Chains                                                          | Key Operations                                                 |
| ------------- | ----------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `aave-v3`     | Aave V3     | ETH, POLY, ARB, OP, AVAX, BASE, BSC, SCROLL, FTM, GNOSIS, METIS | supply, withdraw, borrow, repay, flashLoanSimple               |
| `aave-v2`     | Aave V2     | ETH, POLY, AVAX                                                 | deposit, withdraw, borrow, repay                               |
| `aave-v4`     | Aave V4     | ARC                                                             | supply, withdraw, borrow, repay (Spoke, by reserve id)         |
| `compound-v3` | Compound V3 | ETH, ARB, BASE, POLY, OP, SCROLL                                | supply, withdraw (Comet per base asset)                        |
| `compound-v2` | Compound V2 | ETH                                                             | mint, redeemUnderlying, borrow, repayBorrow (cToken)           |
| `morpho-blue` | Morpho Blue | ETH, BASE, ARC                                                  | supply, withdraw, borrow, repay, supplyCollateral              |
| `spark`       | Spark       | ETH                                                             | supply, withdraw, borrow, repay (Aave V3 fork, MakerDAO)       |
| `euler-v2`    | Euler V2    | ETH                                                             | deposit, withdraw, borrow, repay (ERC-4626 vaults + EVC)       |
| `fluid`       | Fluid       | ETH, ARB                                                        | deposit, withdraw, borrow, repay (unified liquidity)           |
| `radiant`     | Radiant     | ARB                                                             | deposit, withdraw, borrow, repay (Aave V2 fork)                |
| `moonwell`    | Moonwell    | BASE                                                            | mint, redeemUnderlying, borrow, repayBorrow (Compound V2 fork) |
| `benqi`       | Benqi       | AVAX                                                            | mint, redeemUnderlying, borrow, repayBorrow (Compound V2 fork) |
| `venus`       | Venus       | BSC                                                             | mint, redeemUnderlying, borrow, repayBorrow (Compound V2 fork) |
| `seamless`    | Seamless    | BASE                                                            | supply, withdraw, borrow, repay (Aave V3 fork + ILMs)          |
| `silo`        | Silo        | ETH, ARB                                                        | deposit, withdraw, borrow, repay (isolated Silos)              |
| `layerbank`   | LayerBank   | SCROLL                                                          | supply, redeemUnderlying, borrow, repayBorrow (via Core)       |
| `zerolend`    | ZeroLend    | zkSync                                                          | supply, withdraw, borrow, repay (Aave V3 fork)                 |

### Bridges (23 protocols)

| Slug              | Name                | Type                          | Key Operations                              |
| ----------------- | ------------------- | ----------------------------- | ------------------------------------------- |
| `stargate`        | Stargate            | Omnichain bridge (LayerZero)  | swap (native asset bridging)                |
| `across`          | Across              | Optimistic bridge (UMA)       | deposit (fast relayer fills)                |
| `hop`             | Hop Protocol        | Rollup bridge                 | sendToL2, swapAndSend                       |
| `synapse`         | Synapse             | Multi-chain bridge + DEX      | bridge, bridgeAndSwap                       |
| `celer`           | Celer Network       | SGN bridge                    | send (cross-chain transfer)                 |
| `connext`         | Connext (Everclear) | Intent-based bridge           | newIntent (cross-chain transfer)            |
| `debridge`        | deBridge            | DLN bridge                    | send (cross-chain with market makers)       |
| `lifi`            | LI.FI               | Bridge + DEX aggregator       | swapAndBridge                               |
| `socket`          | Socket              | Bridge aggregator             | bridge (optimal route selection)            |
| `squid`           | Squid Router        | Cross-chain router (Axelar)   | route (one-click cross-chain)               |
| `layerzero`       | LayerZero           | Messaging protocol            | send (OFT, arbitrary messages)              |
| `wormhole`        | Wormhole            | Messaging protocol            | transferTokens                              |
| `axelar`          | Axelar              | Messaging protocol            | callContract, sendToken                     |
| `chainlink-ccip`  | Chainlink CCIP      | Messaging protocol            | ccipSend                                    |
| `hyperlane`       | Hyperlane           | Messaging protocol            | dispatch                                    |
| `circle-gateway`  | Circle Gateway      | Chain-abstracted USDC balance | deposit, gatewayMint                        |
| `arbitrum-bridge` | Arbitrum Bridge     | Native L2 bridge              | depositETH, deposit (7-day withdrawal)      |
| `optimism-bridge` | Optimism Bridge     | Native L2 bridge              | depositETH, depositERC20 (7-day withdrawal) |
| `base-bridge`     | Base Bridge         | Native L2 bridge              | depositETH, depositERC20 (7-day withdrawal) |
| `polygon-bridge`  | Polygon Bridge      | Native bridge                 | depositEtherFor, depositFor                 |
| `scroll-bridge`   | Scroll Bridge       | Native zkEVM bridge           | depositETH, depositERC20 (ZK finality)      |
| `linea-bridge`    | Linea Bridge        | Native zkEVM bridge           | sendMessage (ZK finality)                   |
| `zksync-bridge`   | zkSync Bridge       | Native zkEVM bridge           | requestL2Transaction (ZK finality)          |

### Liquid Staking & Restaking (12 protocols)

| Slug          | Name           | Category       | Token        | Key Operations                        |
| ------------- | -------------- | -------------- | ------------ | ------------------------------------- |
| `lido`        | Lido           | liquid-staking | stETH/wstETH | submit (stake ETH), wrap/unwrap       |
| `rocket-pool` | Rocket Pool    | liquid-staking | rETH         | deposit (stake ETH)                   |
| `cbeth`       | Coinbase cbETH | liquid-staking | cbETH        | wrap/unwrap                           |
| `frax-ether`  | Frax Ether     | liquid-staking | sfrxETH      | deposit, withdraw                     |
| `swell`       | Swell          | liquid-staking | swETH/rswETH | deposit                               |
| `stader`      | Stader         | liquid-staking | ETHx         | deposit                               |
| `mantle-meth` | Mantle mETH    | liquid-staking | mETH         | stake                                 |
| `eigenlayer`  | EigenLayer     | restaking      | -            | depositIntoStrategy, queueWithdrawals |
| `etherfi`     | ether.fi       | restaking      | eETH/weETH   | deposit, wrap                         |
| `renzo`       | Renzo          | restaking      | ezETH        | deposit                               |
| `kelp`        | Kelp DAO       | restaking      | rsETH        | depositAsset                          |
| `puffer`      | Puffer Finance | restaking      | pufETH       | deposit                               |

### Yield & Vaults (10 protocols)

| Slug        | Name             | Chains                   | Key Operations                           |
| ----------- | ---------------- | ------------------------ | ---------------------------------------- |
| `pendle`    | Pendle           | ETH, ARB, OP, BSC        | swapExactTokenForPt, swapExactTokenForYt |
| `convex`    | Convex Finance   | ETH                      | deposit, withdraw (Curve LP boosting)    |
| `yearn-v3`  | Yearn V3         | ETH, ARB, BASE, POLY     | deposit, withdraw (ERC-4626 vaults)      |
| `beefy`     | Beefy Finance    | Multi-chain              | deposit, withdraw (auto-compounding)     |
| `arrakis`   | Arrakis Finance  | ETH, POLY, OP, ARB, BASE | deposit, withdraw (Uni V3 LP management) |
| `gamma`     | Gamma Strategies | Multi-chain              | deposit, withdraw (concentrated LP)      |
| `harvest`   | Harvest Finance  | ETH                      | deposit, withdraw (auto-compounding)     |
| `sommelier` | Sommelier        | ETH                      | deposit, withdraw (ERC-4626 Cellars)     |
| `olympus`   | Olympus DAO      | ETH                      | stake, unstake (OHM)                     |
| `tokemak`   | Tokemak          | ETH                      | deposit, withdraw (Autopools)            |

### Derivatives (13 protocols)

| Slug                 | Name               | Category   | Chains    | Key Operations                            |
| -------------------- | ------------------ | ---------- | --------- | ----------------------------------------- |
| `gmx-v1`             | GMX V1             | perpetuals | ARB, AVAX | swap, increasePosition, decreasePosition  |
| `gmx-v2`             | GMX V2             | perpetuals | ARB       | createOrder (GM markets)                  |
| `synthetix-v3`       | Synthetix V3       | synthetics | BASE, OP  | delegateCollateral, mintUsd               |
| `gains-network`      | Gains Network      | perpetuals | ARB, POLY | openTrade, closeTrade (up to 1000x forex) |
| `vertex`             | Vertex             | perpetuals | ARB       | placeOrder (spot+perps+money markets)     |
| `level-finance`      | Level Finance      | perpetuals | BSC, ARB  | addLiquidity, openPosition                |
| `perpetual-protocol` | Perpetual Protocol | perpetuals | OP        | openPosition (vAMM)                       |
| `mux-protocol`       | MUX Protocol       | perpetuals | ARB       | openPosition (aggregated)                 |
| `premia`             | Premia             | options    | ARB       | exercise, settle (v3 option pools)        |
| `hegic`              | Hegic              | options    | ARB       | createHedge (ETH/BTC options)             |
| `opyn`               | Opyn               | options    | ETH       | openVault (Squeeth power perps)           |
| `thales`             | Thales             | options    | OP        | buyFromAMM (positional markets)           |
| `aevo`               | Aevo               | options    | Aevo L2   | deposit (off-chain orderbook)             |

### Aggregators (6 protocols)

| Slug                   | Name          | Chains                              | Key Operations                       |
| ---------------------- | ------------- | ----------------------------------- | ------------------------------------ |
| `oneinch`              | 1inch         | ETH, ARB, OP, BASE, BSC, AVAX, POLY | swap (optimal routing), limitOrder   |
| `paraswap`             | ParaSwap      | ETH, ARB, OP, BASE, BSC, AVAX, POLY | swap (multiSwap, megaSwap)           |
| `zerox`                | 0x Protocol   | ETH, ARB, OP, BASE, BSC, AVAX, POLY | transformERC20                       |
| `cowswap`              | CoW Swap      | ETH, GNOSIS, ARB                    | swap (batch auction, MEV protection) |
| `openocean`            | OpenOcean     | Multi-chain                         | swap (cross-chain routing)           |
| `kyberswap-aggregator` | KyberSwap Agg | Multi-chain                         | swap (meta aggregation)              |

### CDPs & Stablecoins (10 protocols)

| Slug          | Name         | Stablecoin  | Key Operations                                 |
| ------------- | ------------ | ----------- | ---------------------------------------------- |
| `maker`       | Maker        | DAI/USDS    | open vault, draw DAI, deposit sDAI             |
| `liquity-v1`  | Liquity V1   | LUSD        | openTrove, closeTrove (interest-free, 110% CR) |
| `liquity-v2`  | Liquity V2   | BOLD        | openTrove (user-set rates, multi-collateral)   |
| `ethena`      | Ethena       | USDe/sUSDe  | mint USDe, stake as sUSDe                      |
| `gho`         | GHO          | GHO         | borrow GHO via Aave V3 collateral              |
| `frax`        | Frax Finance | FRAX        | mint/redeem FRAX, stake sFRAX                  |
| `crvusd`      | crvUSD       | crvUSD      | create_loan, repay (LLAMMA soft liquidations)  |
| `reflexer`    | Reflexer     | RAI         | openSafe, generateDebt (non-pegged)            |
| `abracadabra` | Abracadabra  | MIM         | borrow MIM via Cauldrons                       |
| `alchemix`    | Alchemix     | alUSD/alETH | deposit, borrow (self-repaying loans)          |

### Oracles (2 protocols)

| Slug        | Name         | Key Operations                                          |
| ----------- | ------------ | ------------------------------------------------------- |
| `chainlink` | Chainlink    | latestRoundData (price feeds), requestRandomWords (VRF) |
| `pyth`      | Pyth Network | updatePriceFeeds, getPrice (pull-based oracle)          |

### Standards (2 protocols)

| Slug      | Name     | Category       | Key Operations                                                       |
| --------- | -------- | -------------- | -------------------------------------------------------------------- |
| `erc3156` | ERC-3156 | infrastructure | flashLoan, flashFee, maxFlashLoan (standard flash loan interface)    |
| `erc4626` | ERC-4626 | yield          | deposit, mint, withdraw, redeem (standard tokenized vault interface) |

### Infrastructure (7 protocols)

| Slug        | Name          | Key Operations                                                        |
| ----------- | ------------- | --------------------------------------------------------------------- |
| `erc20`     | ERC-20        | transfer, approve, transferFrom, balanceOf (standard token interface) |
| `permit2`   | Permit2       | permit, transferFrom (universal token approvals)                      |
| `safe`      | Safe (Gnosis) | execTransaction (multi-sig wallet)                                    |
| `ens`       | ENS           | setAddr, resolve (name resolution)                                    |
| `seaport`   | Seaport       | fulfillOrder (NFT marketplace)                                        |
| `gelato`    | Gelato        | createTask (smart contract automation)                                |
| `instadapp` | Instadapp     | flashLoan, getRoutes (flash loan aggregator)                          |

### Payments & Streaming (2 protocols)

| Slug         | Name       | Key Operations                                 |
| ------------ | ---------- | ---------------------------------------------- |
| `sablier`    | Sablier    | createWithDurations (token streaming, vesting) |
| `superfluid` | Superfluid | createFlow (real-time per-second payments)     |

---

## Quick Reference by Operation

### "I need to swap tokens"

1. **Single DEX**: Use the chain's dominant DEX (Uniswap V3 on ETH, Aerodrome on BASE, Velodrome on OP, Camelot on ARB)
2. **Best price**: Use an aggregator (`oneinch`, `paraswap`, `cowswap`, `zerox`)
3. **Stablecoin swap**: Use `curve` for lowest slippage between pegged assets
4. **Cross-chain swap**: Use `lifi`, `squid`, or `socket` for bridge+swap in one tx

### "I need to lend/borrow"

1. **Multi-chain**: `aave-v3` (most chains), `compound-v3` (major chains)
2. **Ethereum-only**: `morpho-blue` (gas-efficient), `spark` (best DAI rates), `euler-v2` (modular)
3. **Chain-specific**: `moonwell` (Base), `benqi` (Avalanche), `venus` (BSC), `zerolend` (zkSync)
4. **Isolated risk**: `silo` (pair-based isolation), `morpho-blue` (market-level isolation)

### "I need to bridge tokens"

1. **Fast**: `across` (relayer-based, minutes), `stargate` (LayerZero, minutes)
2. **Cheapest**: Native bridges (`arbitrum-bridge`, `optimism-bridge`, `base-bridge`) but 7-day withdrawals
3. **Best route**: `lifi`, `socket`, or `squid` (bridge aggregators)
4. **Arbitrary messages**: `layerzero`, `wormhole`, `axelar`, `chainlink-ccip`, `hyperlane`

### "I need to stake ETH"

1. **Liquid staking**: `lido` (stETH, largest), `rocket-pool` (rETH, decentralized), `cbeth` (Coinbase)
2. **Restaking**: `eigenlayer` (restake LSTs), `etherfi` (eETH), `renzo` (ezETH), `kelp` (rsETH)

### "I need yield optimization"

1. **Yield trading**: `pendle` (split PT/YT, trade future yield)
2. **Auto-compounding**: `beefy` (multi-chain), `yearn-v3` (ETH), `convex` (Curve LP)
3. **LP management**: `arrakis`, `gamma` (automated Uni V3 positions)

### "I need to trade perpetuals/options"

1. **Perps**: `gmx-v2` (ARB), `gains-network` (up to 1000x), `vertex` (orderbook)
2. **Options**: `premia` (AMM), `aevo` (orderbook), `hegic` (simplified)

### "I need a stablecoin/CDP"

1. **Overcollateralized**: `maker` (DAI), `liquity-v1` (LUSD, interest-free), `crvusd` (soft liquidations)
2. **Synthetic dollar**: `ethena` (USDe, delta-neutral), `frax` (FRAX)
3. **Self-repaying**: `alchemix` (alUSD/alETH)

---

## Chain Coverage

| Chain     | Chain ID | Top Protocols                                                     |
| --------- | -------- | ----------------------------------------------------------------- |
| Ethereum  | 1        | uniswap-v3, aave-v3, curve, balancer-v2, lido, maker, morpho-blue |
| Arbitrum  | 42161    | uniswap-v3, aave-v3, gmx-v2, camelot, radiant, silo               |
| Base      | 8453     | aerodrome, uniswap-v3, aave-v3, compound-v3, moonwell, seamless   |
| Optimism  | 10       | velodrome, uniswap-v3, aave-v3, synthetix-v3, thales              |
| Polygon   | 137      | quickswap, aave-v3, uniswap-v3, compound-v3, balancer-v2          |
| BSC       | 56       | pancakeswap-v2, venus, thena, pancakeswap-v3, dodo                |
| Avalanche | 43114    | trader-joe, aave-v3, benqi, curve, sushiswap-v2                   |
| Blast     | 81457    | thruster, fenix, uniswap-v4                                       |
| zkSync    | 324      | syncswap, zerolend                                                |
| Scroll    | 534352   | ambient, layerbank, aave-v3                                       |
| Fantom    | 250      | spookyswap, sushiswap-v2, aave-v3                                 |
| Linea     | 59144    | lynex, pancakeswap-v3                                             |
| Mode      | 34443    | kim                                                               |

---

## Per-Protocol Skill Files

Detailed skill files with SauceScript examples, contract addresses, and ABI signatures are at:
`@eco-incorp/sauce/skills/{slug}.md` (or `sdk/src/skills/{slug}.md` in the repo)

Load the specific protocol file when you need full implementation details.
