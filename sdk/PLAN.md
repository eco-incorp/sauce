# Sauce SDK - Master Plan

## Original Vision

Build a comprehensive SDK (`sdk/`) that wraps **every legitimate on-chain protocol** across **every EVM chain** with:

1. **Protocol registry** - metadata, website, GitHub, npm, category, audit status, TVL
2. **Deployment addresses** - every contract on every chain, verified against official docs
3. **ABIs** - from npm packages or GitHub, with Solidity interfaces for readability
4. **Sauce functions** - TypeScript SauceScript functions for every user-facing operation (swap, supply, bridge, stake, etc.)
5. **Chain registry** - all supported EVM chains with RPC endpoints and explorer URLs

The SDK should be the single import a developer needs to interact with any protocol via Sauce bytecode.

---

## What's Done

### Phase 1: Infrastructure (COMPLETE)

```
sdk/
├── package.json                    # @eco-incorp/sauce, links to ../compiler
├── tsconfig.json                   # Strict, ESNext, bundler resolution
├── PLAN.md                         # This file
├── src/
│   ├── index.ts                    # Root exports (stub)
│   ├── core/
│   │   └── types.ts                # ProtocolInfo, ChainDeployment, SauceFunction, etc.
│   ├── chains/
│   │   └── index.ts                # 30+ EVM chains with IDs, RPCs, explorers
│   ├── protocols/
│   │   └── uniswap/
│   │       └── info.ts             # Example protocol module (template only)
│   └── abis/                       # Empty, awaiting population
└── research/                       # Raw research data from 6 parallel agents
    ├── dex.md                      # 37 DEX protocols
    ├── dex-full.json               # Full JSON (1580 lines)
    ├── lending.md                  # 30+ lending protocols
    ├── bridges.md                  # 33 bridge protocols
    ├── bridges-full.json           # Full JSON
    ├── derivatives.md              # 28 derivatives/perps/options
    ├── derivatives-full.json       # Full JSON
    ├── yield-staking.md            # 31 yield/staking/restaking protocols
    └── aggregators-oracles-infra.md # 50+ aggregators, oracles, CDPs, infra
```

### Phase 2: Research (COMPLETE)

6 parallel research agents completed, covering **209+ protocols** total:

| Category      | Protocols | Key Players                                                                                                                    |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DEXes         | 37        | Uniswap (v2/v3/v4), SushiSwap, Curve, Balancer, PancakeSwap, Velodrome, Aerodrome, Camelot, TraderJoe, + 28 chain-native DEXes |
| Lending       | 30+       | Aave (v2/v3), Compound (v2/v3), MakerDAO, Morpho Blue, Spark, Venus, Moonwell, Silo, Euler, Benqi, + 20 more                   |
| Bridges       | 33        | Across, Stargate, LayerZero, Wormhole, Axelar, Hyperlane, CCIP, Hop, Synapse, + native L2 bridges                              |
| Derivatives   | 28        | GMX, dYdX, Synthetix, Gains Network, Vertex, Opyn, Hegic, Premia, Lyra, + 19 more                                              |
| Yield/Staking | 31        | Lido, Rocket Pool, EigenLayer, ether.fi, Pendle, Yearn, Convex, Beefy, + 23 more                                               |
| Infra/Oracles | 50+       | 1inch, Paraswap, 0x, Chainlink, Pyth, MakerDAO, Liquity, Ethena, Safe, Seaport, + 40 more                                      |

### Agent Skills Created

```
.claude/agents/
├── sauce-writer.md          # SauceScript syntax reference for writing Sauce functions
├── protocol-researcher.md   # How to find and document on-chain protocols
├── sdk-builder.md           # Template for building protocol SDK modules
├── team-orchestrator.md     # Team coordination strategy
├── server-core.md           # Server core architecture
├── server-ai.md             # AI services layer
└── server-tester.md         # Test suite patterns
```

---

## What's NOT Done (Phase 3+)

### Phase 3: Protocol Modules - BUILD

For each of the 209+ researched protocols, create a complete SDK module at `sdk/src/protocols/{slug}/`:

```
sdk/src/protocols/{slug}/
├── index.ts          # Re-exports everything
├── info.ts           # ProtocolInfo metadata
├── addresses.ts      # ChainDeployment[] with verified addresses
├── abis.ts           # ABI constants (from npm or extracted)
├── functions.ts      # SauceScript function strings for every operation
└── types.ts          # Protocol-specific types (optional)
```

**Priority order:**

1. **Tier 1 DEXes** - Uniswap v2/v3/v4, SushiSwap, Curve, Balancer, PancakeSwap
2. **Tier 1 Lending** - Aave v3, Compound v3, Morpho Blue, Spark
3. **Tier 1 Staking** - Lido, Rocket Pool, EigenLayer, ether.fi
4. **Tier 1 Bridges** - Across, Stargate, LayerZero, Wormhole, CCIP
5. **Tier 1 Aggregators** - 1inch, 0x, Paraswap
6. **Tier 1 Infra** - Safe, Permit2, ENS
7. Remaining Tier 2 and Tier 3 protocols

### Phase 4: ABI Collection

For each protocol:

- Download ABIs from npm packages where available (`@uniswap/v3-core`, `@aave/core-v3`, etc.)
- Extract from GitHub repos where no npm exists
- Verify against block explorer verified sources
- Store as typed `as const` arrays in `abis.ts`

### Phase 5: Sauce Function Library

For each protocol, write SauceScript functions covering every user-facing operation:

**DEX functions:**

- `swap(router, tokenIn, tokenOut, amountIn, amountOutMin, recipient)`
- `addLiquidity(router, tokenA, tokenB, amountA, amountB, recipient)`
- `removeLiquidity(router, tokenA, tokenB, liquidity, recipient)`
- `getAmountsOut(router, amountIn, path)`

**Lending functions:**

- `supply(pool, asset, amount, onBehalfOf)`
- `borrow(pool, asset, amount, interestRateMode, onBehalfOf)`
- `repay(pool, asset, amount, interestRateMode, onBehalfOf)`
- `withdraw(pool, asset, amount, to)`
- `flashLoan(pool, assets, amounts, modes, onBehalfOf, params)`

**Bridge functions:**

- `bridge(router, token, amount, destinationChainId, recipient)`
- `sendMessage(endpoint, destinationChainId, payload)`

**Staking functions:**

- `stake(contract, amount)` / `unstake(contract, amount)`
- `wrap(contract, amount)` / `unwrap(contract, amount)`
- `deposit(strategy, token, amount)` (EigenLayer)

### Phase 6: Address Verification

Cross-reference ALL addresses against:

1. Official documentation
2. Block explorer verified contracts
3. npm deployment packages (e.g., `@bgd-labs/aave-address-book`)
4. GitHub deployment scripts/JSON files

Flag and remove any unverified addresses.

### Phase 7: Testing

- Unit tests for each protocol module (addresses resolve, ABIs parse, functions compile)
- Integration tests that compile Sauce functions through the real compiler
- Snapshot tests for bytecode output stability

### Phase 8: Index & Export

- `sdk/src/protocols/index.ts` - re-exports all protocol modules
- `sdk/src/index.ts` - main entry point with getProtocol(), listProtocols(), getChain()
- Protocol lookup by name, slug, or category
- Chain-filtered queries (e.g., "all DEXes on Base")

---

## Polishing Improvements

### Research Gaps to Fill

- [ ] Some Tier 3 DEXes have incomplete addresses (SpaceFi, Hercules)
- [ ] Beefy vault addresses are per-strategy (need API integration or factory enumeration)
- [ ] Pendle market addresses are per-pool (need factory enumeration)
- [ ] RedStone/API3/DIA oracles are per-feed (need registry pattern)
- [ ] Missing protocols: Ambient Finance full addresses, newer L3 DEXes
- [ ] Need to check for any protocols launched after research date

### Architecture Improvements

- [ ] Add `getDeployment(chainId)` helper to each protocol module
- [ ] Add `getSauceFunction(name, chainId)` that auto-fills addresses
- [ ] Version-aware modules (Uniswap v2 vs v3 vs v4 as separate exports)
- [ ] Chain-aware address resolution (pass chainId, get correct addresses)
- [ ] Runtime ABI validation with Zod or viem's `parseAbi`
- [ ] Tree-shakeable exports (import only the protocols you need)

### Developer Experience

- [ ] CLI tool: `sauce list --category dex --chain base`
- [ ] Auto-complete for protocol names and function signatures
- [ ] Documentation generator from protocol info + functions

### Integration with Existing Codebase

- [ ] Connect to `compiler-poc/` for real compilation testing
- [ ] Connect to `dev-tools/` for on-chain execution
- [ ] Align with existing `dev-tools/src/contracts.ts` address registry
- [ ] Ensure Sauce functions match `dev-tools/sauce/ts/call.ts` import pattern

---

## Execution Strategy

Use agent teams (`/go-team-sdk`) to parallelize the build:

- 5-6 builder agents, each handling a category of protocols
- Each agent reads research data, creates protocol modules
- Quality gate: every Sauce function must compile via `@eco-incorp/sauce-compiler`
- Lead agent synthesizes, deduplicates, creates the index

Estimated scope: ~200 protocol modules, ~600 Sauce functions, ~1000 chain deployments.
