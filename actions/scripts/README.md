# split-swap

Split a swap across multiple DEX pools to get the best execution price.

Discovers pools at runtime by querying on-chain factories and registries:

- **Uniswap V3** — all fee tiers (0.01%, 0.05%, 0.3%, 1%)
- **Uniswap V2**
- **SushiSwap**
- **Curve** — via MetaRegistry (all registered pools)

## Prerequisites

- An Ethereum mainnet RPC URL (e.g. Alchemy, Infura)
- The Sauce contract artifact built (`engine/out/Sauce.sol/Sauce.json`)
- Hardhat installed in `dev-tools/`

## Usage

```bash
FORK_URL=<rpc-url> npx tsx scripts/split-swap.ts <tokenIn> <tokenOut> [amounts...]
```

Tokens can be addresses or well-known symbols.

### Supported symbols

`USDC`, `USDT`, `DAI`, `WETH`, `WBTC`, `STETH`, `WSTETH`, `FRAX`, `LUSD`,
`MKR`, `UNI`, `LINK`, `AAVE`, `CRV`, `COMP`, `CRVUSD`, `GHO`

### Examples

```bash
# Default swap sizes (1K, 10K, 100K, 1M, 10M)
FORK_URL=https://eth-mainnet.g.alchemy.com/v2/<key> npx tsx scripts/split-swap.ts USDC USDT

# Custom swap sizes (human-readable units)
FORK_URL=https://eth-mainnet.g.alchemy.com/v2/<key> npx tsx scripts/split-swap.ts USDC USDT 500000 2000000

# Using raw addresses
FORK_URL=https://eth-mainnet.g.alchemy.com/v2/<key> npx tsx scripts/split-swap.ts \
  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  0xdAC17F958D2ee523a2206206994597C13D831ec7
```

## What it does

1. **Forks mainnet** via Hardhat at the latest block.
2. **Deploys a Sauce contract** and funds it with the input token (auto-discovers the ERC-20 storage slot for `balanceOf`).
3. **Discovers all pools** for the token pair across supported DEXes, filters by minimum TVL ($50K).
4. **Quotes each pool** at incremental chunk sizes to build a marginal-rate curve.
5. **Greedily allocates** chunks to the pool with the best marginal rate.
6. **Executes the split swap** via the Sauce contract and compares against single-pool swaps.
7. **Reports** a combined table of results, effective rates, and split advantage.

## Output

The script prints:

- **Discovered pools** with TVL for each
- **Per-size results** showing USDT received for split vs each single pool
- **Combined table** comparing all strategies across all sizes
- **Effective rates** (output/input ratio)
- **Split advantage** (how much more the split earns vs each single pool)
- **Allocation breakdown** (which pools get what percentage)
