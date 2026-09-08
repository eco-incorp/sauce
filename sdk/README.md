# @eco-incorp/sauce-sdk

Protocol SDK for Sauce — 127 DeFi protocols across every major EVM chain, with verified contract addresses, ABIs, compilable SauceScript functions, and AI-ready skill files.

## Install

```bash
npm install @eco-incorp/sauce-sdk
```

## Quick Start

```typescript
import {
  getProtocol,
  listProtocols,
  getProtocolsByCategory,
  getProtocolsByChain,
  listProtocolSlugs,
} from "@eco-incorp/sauce-sdk";

// Look up a protocol
const aave = getProtocol("aave-v3");
console.log(aave.name); // "Aave V3"
console.log(aave.category); // "lending"
console.log(aave.chains); // [{ chainId: 1, chainName: "Ethereum", addresses: { ... } }, ...]

// Query by category
const dexes = getProtocolsByCategory("dex"); // 26 DEX protocols
const lending = getProtocolsByCategory("lending"); // 16 lending protocols

// Query by chain
const baseProtocols = getProtocolsByChain(8453); // All protocols on Base
const arbProtocols = getProtocolsByChain(42161); // All protocols on Arbitrum

// List everything
const all = listProtocols(); // 127 ProtocolInfo objects
const slugs = listProtocolSlugs(); // ["aave-v2", "aave-v3", "across", ...]
```

## Per-Protocol Imports

Each protocol is tree-shakeable:

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/aave-v3";
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/uniswap-v3";
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/lido";
```

### Protocol Module Structure

Every protocol exports:

| Export           | Type                | Description                                                                   |
| ---------------- | ------------------- | ----------------------------------------------------------------------------- |
| `protocolInfo`   | `ProtocolInfo`      | Name, slug, description, website, GitHub, npm, category, chains, audit status |
| `deployments`    | `ChainDeployment[]` | Verified contract addresses per chain                                         |
| `sauceFunctions` | `SauceFunction[]`   | Compilable SauceScript function templates                                     |
| ABI constants    | `readonly object[]` | ABI fragments for key contract methods                                        |

## Skill Files (AI-Ready Protocol Docs)

The SDK ships markdown skill files for every protocol — designed to be consumed by AI backends for on-the-fly protocol integration.

```typescript
import { getProtocolIndex, getProtocolSkill, listSkillSlugs } from "@eco-incorp/sauce-sdk/skills";

// Master index — all protocols, categories, operations, chain coverage
const index = getProtocolIndex();

// Specific protocol — description, SauceScript examples, addresses, ABI methods.
// `slug` must be one of `listSkillSlugs()`; anything else throws.
const aaveSkill = getProtocolSkill("aave-v3");
const uniSkill = getProtocolSkill("uniswap-v3");

// All available slugs
const slugs = listSkillSlugs(); // 128 slugs
```

Each skill file includes:

- Protocol description and category
- Key operations (swap, supply, borrow, bridge, stake, etc.)
- SauceScript code examples (copy-paste ready)
- Verified contract addresses by chain
- ABI method signatures
- Risk notes and audit status

## Chain Registry

```typescript
import { getChain, getAllChainIds, chains } from "@eco-incorp/sauce-sdk/chains";

const base = getChain(8453);
console.log(base.name); // "Base"
console.log(base.rpcUrl); // "https://mainnet.base.org"
console.log(base.explorerUrl); // "https://basescan.org"

const allIds = getAllChainIds(); // [1, 10, 56, 137, 8453, 42161, ...]
```

31 EVM chains supported: Ethereum, Arbitrum, Optimism, Base, Polygon, BSC, Avalanche, zkSync, Scroll, Linea, Blast, Fantom, Gnosis, Mantle, Mode, Celo, Moonbeam, and more.

## Protocol Coverage

| Category         | Count | Key Protocols                                                                                        |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| DEX              | 26    | Uniswap V2/V3/V4, Curve, Balancer, PancakeSwap, SushiSwap, Velodrome, Aerodrome, Camelot, Trader Joe |
| Lending          | 16    | Aave V2/V3, Compound V2/V3, Morpho Blue, Spark, Euler V2, Radiant, Venus, Moonwell                   |
| Bridges          | 22    | Across, Stargate, LayerZero, Wormhole, Axelar, CCIP, Hyperlane, LI.FI, + 7 native L2 bridges         |
| Liquid Staking   | 8     | Lido, Rocket Pool, Coinbase cbETH, Frax Ether, Swell, Stader, Mantle mETH                            |
| Restaking        | 4     | EigenLayer, ether.fi, Renzo, Kelp, Puffer                                                            |
| Yield            | 10    | Pendle, Convex, Yearn V3, Beefy, Arrakis, Gamma, Harvest, Sommelier, Olympus, Tokemak                |
| Derivatives      | 13    | GMX V1/V2, Synthetix V3, Gains Network, Vertex, Perpetual Protocol, Premia, Hegic, Opyn, Aevo        |
| Aggregators      | 6     | 1inch, ParaSwap, 0x, CoW Swap, OpenOcean, KyberSwap                                                  |
| CDPs/Stablecoins | 10    | MakerDAO, Liquity V1/V2, Ethena, GHO, Frax, crvUSD, Reflexer, Abracadabra, Alchemix                  |
| Oracles          | 2     | Chainlink, Pyth                                                                                      |
| Infrastructure   | 6     | Permit2, Safe, ENS, Seaport, Gelato, Instadapp                                                       |
| Standards        | 2     | ERC-3156 (flash loans), ERC-4626 (tokenized vaults)                                                  |
| Payments         | 2     | Sablier, Superfluid                                                                                  |

**Total: 127 protocols across 31 EVM chains**

## SauceScript Functions

Every protocol includes compilable SauceScript functions — TypeScript-like DSL that compiles to Sauce bytecode via `@eco-incorp/sauce-compiler`.

```typescript
// Example: Aave V3 supply
import { PoolABI as IPool } from "./abis";
function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

```typescript
// Example: Uniswap V3 swap
import { SwapRouterABI as IRouter } from "./abis";
function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  recipient: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
): Uint256 {
  const router = IRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

## Types

```typescript
import type {
  ProtocolInfo,
  ProtocolCategory,
  ChainDeployment,
  SauceFunction,
  SauceParam,
  ChainInfo,
  Address,
} from "@eco-incorp/sauce-sdk";
```

### ProtocolCategory

`"dex" | "lending" | "bridge" | "yield" | "staking" | "liquid-staking" | "restaking" | "derivatives" | "perpetuals" | "options" | "synthetics" | "aggregator" | "oracle" | "cdp" | "stablecoin" | "infrastructure" | "cross-chain" | "nft-marketplace" | "payments" | "automation" | "naming"`

## Testing

```bash
npm test        # 1443 tests — compiles every SauceScript function through the real compiler
npm run typecheck  # TypeScript type checking
npm run build      # Build to dist/
```

## Development

```
sdk/
├── src/
│   ├── index.ts                    # Root exports
│   ├── core/types.ts               # TypeScript type definitions
│   ├── chains/index.ts             # 31 EVM chain registry
│   ├── protocols/                  # 127 protocol modules
│   │   ├── index.ts                # Registry + query functions
│   │   ├── aave-v3/
│   │   │   ├── info.ts             # ProtocolInfo metadata
│   │   │   ├── addresses.ts        # ChainDeployment[] verified addresses
│   │   │   ├── abis.ts             # ABI fragments (as const)
│   │   │   ├── functions.ts        # SauceScript function templates
│   │   │   └── index.ts            # Re-exports
│   │   ├── uniswap-v3/
│   │   └── ... (127 protocol dirs)
│   └── skills/                     # AI-ready protocol documentation
│       ├── index.md                # Master protocol index
│       ├── loader.ts               # getProtocolSkill(), getProtocolIndex()
│       ├── aave-v3.md              # Per-protocol skill files
│       └── ... (127 .md files)
├── test/
│   ├── helpers.ts                  # Compilation test utilities
│   ├── helpers.test.ts             # Helper smoke tests
│   └── compile.test.ts             # Full compilation + structure tests
├── research/                       # Raw protocol research data
├── package.json
├── tsconfig.json
└── jest.config.cjs
```
