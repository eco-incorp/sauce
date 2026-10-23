# Balancer V2

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Generalized AMM with weighted pools, single Vault architecture, and flash loans. Supports custom pool types (weighted, stable, linear, composable stable) and multi-token pools with up to 8 tokens per pool.

## Category

dex | Chains and addresses: [registry/balancer-v2.md](registry/balancer-v2.md)

## Key Operations

- **swap**: Execute a single swap through the Vault specifying pool ID and assets
- **addLiquidity**: Join a pool by depositing tokens via the Vault
- **removeLiquidity**: Exit a pool by withdrawing tokens via the Vault

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
      userData: hex``,
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
- `userData`: Extra data for the pool (usually ` hex`` ` for swaps)
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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/balancer-v2.md](registry/balancer-v2.md).

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
- From a Pot program, `@sauce/router` swaps through the Vault directly: `balancerV2(vault, tokenIn, tokenOut, amountIn, poolId, minOut, recipient)` approves the Vault for exactly `amountIn` and calls `swap` (GIVEN_IN, internal balances off) with `minOut` as its limit, returning the amount out; the allowance ends at zero. `tryBalancerV2` catches a failed swap, resets the approval and returns `0`. The `balancerV2Swap` action is the same call
