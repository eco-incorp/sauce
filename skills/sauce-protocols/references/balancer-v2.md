# Balancer V2

Generalized AMM with weighted pools, single Vault architecture, and flash loans. Supports custom pool types (weighted, stable, linear, composable stable) and multi-token pools with up to 8 tokens per pool.

## Category

dex | Chains: Ethereum, Polygon, Arbitrum, Optimism, Gnosis, Avalanche, Base, BSC

## Key Operations

- **swap**: Execute a single swap through the Vault specifying pool ID and assets
- **addLiquidity**: Join a pool by depositing tokens via the Vault
- **removeLiquidity**: Exit a pool by withdrawing tokens via the Vault

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  swap,
  addLiquidity,
  removeLiquidity,
} from "@eco-incorp/sauce/protocols/balancer-v2";
```

## SauceScript Examples

### swap

```typescript
import { BalancerV2VaultABI as IVault } from "./abis";

function main(
  vaultAddress: Address,
  poolId: Uint256,
  assetIn: Address,
  assetOut: Address,
  amount: Uint256,
  limit: Uint256,
  sender: Address,
  recipient: Address,
): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.swap(
    {
      poolId: poolId,
      kind: 0,
      assetIn: assetIn,
      assetOut: assetOut,
      amount: amount,
      userData: 0x00,
    },
    { sender: sender, fromInternalBalance: false, recipient: recipient, toInternalBalance: false },
    limit,
    99999999999,
  );
}
```

- `vaultAddress`: The Balancer V2 Vault (same address on ALL chains: `0xBA12222222228d8Ba445958a75a0704d566BF2C8`)
- `poolId`: bytes32 identifier for the specific pool (encodes pool address + pool type + nonce)
- `assetIn` / `assetOut`: Token addresses to swap between
- `amount`: Input amount when `kind=0` (GIVEN_IN) or output amount when `kind=1` (GIVEN_OUT)
- `limit`: Maximum input (GIVEN_OUT) or minimum output (GIVEN_IN) for slippage protection
- `sender`: Address providing the input tokens (must have approved the Vault)
- `recipient`: Address receiving the output tokens
- `userData`: Extra data for the pool (usually `0x00` for swaps)
- `fromInternalBalance` / `toInternalBalance`: Use Vault internal balances (set false for standard swaps)

### addLiquidity

```typescript
import { BalancerV2VaultABI as IVault } from "./abis";

function main(
  vaultAddress: Address,
  poolId: Uint256,
  sender: Address,
  recipient: Address,
  userData: bytes,
): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.joinPool(poolId, sender, recipient, {
    assets: [],
    maxAmountsIn: [],
    userData: userData,
    fromInternalBalance: false,
  });
  return 1;
}
```

- `userData`: ABI-encoded join type and amounts. Join types vary by pool kind (e.g., EXACT_TOKENS_IN_FOR_BPT_OUT, TOKEN_IN_FOR_EXACT_BPT_OUT)
- `assets`: Array of token addresses in the pool (must match pool composition order)
- `maxAmountsIn`: Maximum amounts to deposit per token (slippage protection)

### removeLiquidity

```typescript
import { BalancerV2VaultABI as IVault } from "./abis";

function main(
  vaultAddress: Address,
  poolId: Uint256,
  sender: Address,
  recipient: Address,
  userData: bytes,
): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.exitPool(poolId, sender, recipient, {
    assets: [],
    minAmountsOut: [],
    userData: userData,
    toInternalBalance: false,
  });
  return 1;
}
```

- `userData`: ABI-encoded exit type and amounts. Exit types: EXACT_BPT_IN_FOR_ONE_TOKEN_OUT, EXACT_BPT_IN_FOR_TOKENS_OUT, BPT_IN_FOR_EXACT_TOKENS_OUT
- `minAmountsOut`: Minimum amounts to receive per token (slippage protection)

## Key Addresses

| Chain     | Contract | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Polygon   | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Arbitrum  | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Optimism  | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Gnosis    | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Avalanche | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| Base      | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |
| BSC       | Vault    | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` |

## ABI Methods

### BalancerV2VaultABI

- `swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData), tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance), uint256 limit, uint256 deadline) -> uint256 amountCalculated` - Execute a single swap. `kind`: 0=GIVEN_IN, 1=GIVEN_OUT
- `batchSwap(uint8 kind, tuple[](bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData), address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance), int256[] limits, uint256 deadline) -> int256[] assetDeltas` - Execute multi-hop swap through multiple pools in one transaction
- `joinPool(bytes32 poolId, address sender, address recipient, tuple(address[] assets, uint256[] maxAmountsIn, bytes userData, bool fromInternalBalance))` - Deposit tokens into a pool
- `exitPool(bytes32 poolId, address sender, address recipient, tuple(address[] assets, uint256[] minAmountsOut, bytes userData, bool toInternalBalance))` - Withdraw tokens from a pool
- `flashLoan(address recipient, address[] tokens, uint256[] amounts, bytes userData)` - Flash loan from the Vault (zero fee for Balancer pools)
- `getPoolTokens(bytes32 poolId) -> (address[] tokens, uint256[] balances, uint256 lastChangeBlock)` - Query pool token composition and balances (view)

## Notes

- Single Vault contract holds ALL pool liquidity (same address `0xBA12...` on every chain)
- Pools are identified by `bytes32 poolId`, NOT by contract address
- The Vault model means tokens only need to be approved to ONE contract for all Balancer pools
- Weighted pools: custom token weights (e.g., 80/20 ETH/USDC); Stable pools: pegged assets; Linear pools: wrapping yield-bearing tokens
- `batchSwap` is gas-efficient for multi-hop trades since tokens only move between Vault internal accounts
- Flash loans from Balancer Vault are zero-fee when the swap route stays within Balancer pools
- Internal balances: users can keep tokens in the Vault to save gas on repeated trades
- `userData` encoding varies by pool type - check Balancer docs for the specific pool's join/exit types
- Use Balancer for multi-token pools (3+ tokens), weighted index exposure, or flash loans
