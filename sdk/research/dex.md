# DEX Protocols Research Results

Full JSON data: `dex-full.json` (1580 lines, 37 protocols)

## Tier 1 - Major Multi-chain DEXes

### Uniswap V2 - 10 chains

| Chain     | Factory                                      | Router                                       |
| --------- | -------------------------------------------- | -------------------------------------------- |
| Ethereum  | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| Arbitrum  | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| Optimism  | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` |
| Base      | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| Polygon   | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` |
| BSC       | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| Avalanche | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |

### Uniswap V3 - 10+ chains

- npm: `@uniswap/v3-core`, `@uniswap/v3-periphery`, `@uniswap/v3-sdk`
- Factory (shared): `0x1F98431c8aD98523631AE4a59f267346ea31F984` (Ethereum, Arbitrum, Optimism, Polygon)
- SwapRouter02: `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`

### Uniswap V4 - 11 chains (Jan 2025)

- Singleton PoolManager architecture, unique addresses per chain

### Curve Finance - 8+ chains

- CurveRouterNG addresses per chain
- GitHub: https://github.com/curvefi

### Balancer V2 - 8 chains

- **Shared Vault**: `0xBA12222222228d8Ba445958a75a0704d566BF2C8` (same on ALL chains)
- npm: `@balancer-labs/v2-deployments`

### Balancer V3 - 4 chains

- Vault: `0xbA1333333333a1BA1108E8412f11850A5C319bA9`

### PancakeSwap V2 - 8 chains

### PancakeSwap V3 - 8 chains

- Factory (shared): `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`
- npm: `@pancakeswap/v3-core`

### SushiSwap V2 - 7 chains

### SushiSwap V3 - 5 chains

## Tier 2 - Chain-specific Leading DEXes

| Protocol        | Chain(s)                 | Type                         | Key Address                     |
| --------------- | ------------------------ | ---------------------------- | ------------------------------- |
| Trader Joe (LB) | Avalanche, Arbitrum, BSC | Liquidity Book               | V2.2 documented                 |
| Camelot         | Arbitrum                 | AMM V2/V3/V4 (Algebra)       | Multiple versions               |
| Velodrome       | Optimism                 | Solidly fork ve(3,3)         | V2 router + voter               |
| Aerodrome       | Base                     | Solidly fork ve(3,3)         | Router + factory                |
| QuickSwap       | Polygon                  | V2 + V3 (Algebra)            | Both documented                 |
| SpookySwap      | Fantom                   | V2 + V3                      | Factory + router                |
| Maverick V2     | 6 chains                 | Directional liquidity        | Router + factory + position mgr |
| KyberSwap       | 7 chains                 | Elastic + Classic            | Meta Aggregation Router         |
| DODO            | 3 chains                 | PMM (Proactive Market Maker) | V2 Proxy + Route Proxy          |

## Tier 3 - Chain-native DEXes

| Protocol           | Chain            | Type                   |
| ------------------ | ---------------- | ---------------------- |
| Thena              | BSC              | Solidly fork           |
| Ramses             | Arbitrum         | Solidly fork           |
| Chronos            | Arbitrum         | Solidly fork           |
| SyncSwap           | zkSync           | Classic + Stable pools |
| Koi Finance (Mute) | zkSync           | V2 + V3                |
| SpaceFi            | zkSync           | AMM                    |
| Lynex              | Linea            | Solidly fork (Algebra) |
| Nile Exchange      | Linea            | Solidly fork           |
| Ambient (CrocSwap) | Ethereum, Scroll | Single-contract DEX    |
| Fenix Finance      | Blast            | Solidly fork           |
| Thruster           | Blast            | V2 + V3                |
| Ring Protocol      | Blast            | V2 + V3                |
| Kim Exchange       | Mode             | V2 + V4                |
| BaseSwap           | Base             | V2 + V3                |
| SwapBased          | Base             | V2 + V3                |
| Equalizer          | Fantom, Base     | Solidly fork           |
| Netswap            | Metis            | V1 + V2                |
| Hercules           | Metis            | Camelot fork           |

## Key Observations

- Uniswap V3 factory `0x1F98431c8aD98523631AE4a59f267346ea31F984` shared across Ethereum, Arbitrum, Optimism, Polygon
- Balancer V2 Vault `0xBA12222222228d8Ba445958a75a0704d566BF2C8` same on ALL 8 chains
- Many chain-native DEXes are Solidly forks (ve(3,3) model)
- Several use Algebra protocol for concentrated liquidity instead of Uniswap V3
