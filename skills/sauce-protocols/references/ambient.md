# Ambient

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Single-contract DEX (formerly CrocSwap) with ambient (full-range) and concentrated liquidity in one unified pool. Extremely gas-efficient architecture where all liquidity lives in one contract.

## Category

dex | Chains and addresses: [registry/ambient.md](registry/ambient.md)

## Key Operations

- **swap**: Swap tokens via the CrocSwapDex contract with base/quote pair addressing

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { CrocSwapDexABI as ICrocSwapDex } from "./abis";

function main(
  dexAddress: Address,
  base: Address,
  quote: Address,
  poolIdx: Uint256,
  isBuy: bool,
  inBaseQty: bool,
  qty: Uint256,
  minOut: Uint256,
): { baseFlow: Uint256; quoteFlow: Uint256 } {
  const dex = ICrocSwapDex.at(dexAddress);
  return dex.swap(base, quote, poolIdx, isBuy, inBaseQty, qty, 0, 0, minOut, 0);
}
```

- `dexAddress`: CrocSwapDex contract address (`0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` on Ethereum, `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` on Scroll)
- `base`: Base token address (lower address of the pair by convention)
- `quote`: Quote token address (higher address of the pair)
- `poolIdx`: Pool index identifying the pool type (e.g., `420` for standard pools on Ethereum)
- `isBuy`: `true` = buy base with quote (swap quote->base); `false` = sell base for quote (swap base->quote)
- `inBaseQty`: `true` = qty is denominated in base token; `false` = qty is in quote token
- `qty`: Amount to swap (in wei)
- `minOut`: Minimum output for slippage protection
- Additional params set to `0`: `tip` (optional tip), `limitPrice` (no price limit, so `minOut` is the only bound), `reserveFlags` (no reserve usage)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/ambient.md](registry/ambient.md).

## Notes

- Single contract holds ALL liquidity (similar to Balancer V2 Vault and Uniswap V4 PoolManager)
- Same contract address on both Ethereum and Scroll
- `poolIdx` identifies the pool type: different pool indices have different fee rates and tick spacing
- Common pool indices: `420` (standard on Ethereum), `36000` (stable pairs on Scroll)
- `isBuy` + `inBaseQty` together determine the exact swap semantics
- `tip`: Optional tip in basis points for priority execution (usually `0`)
- `limitPrice`: Price limit as sqrt price Q64.64 fixed-point (`0` is no limit, which leaves `minOut` as the only bound)
- `reserveFlags`: Bitmask for using surplus collateral (set to `0` for standard swaps)
- `userCmd` is the universal command interface for all non-swap operations (adding/removing liquidity, etc.)
- callpath `1` = liquidity operations, `3` = warm path operations
- Gas-efficient for simple swaps; more complex for LP operations via `userCmd`
- Input token must be ERC20-approved to the CrocSwapDex contract
