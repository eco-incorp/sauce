# Ambient

Single-contract DEX (formerly CrocSwap) with ambient (full-range) and concentrated liquidity in one unified pool. Extremely gas-efficient architecture where all liquidity lives in one contract.

## Category

dex | Chains: Ethereum, Scroll

## Key Operations

- **swap**: Swap tokens via the CrocSwapDex contract with base/quote pair addressing

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/ambient";
```

## SauceScript Examples

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

- `dexAddress`: CrocSwapDex contract address (same on both chains: `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688`)
- `base`: Base token address (lower address of the pair by convention)
- `quote`: Quote token address (higher address of the pair)
- `poolIdx`: Pool index identifying the pool type (e.g., `420` for standard pools on Ethereum)
- `isBuy`: `true` = buy base with quote (swap quote->base); `false` = sell base for quote (swap base->quote)
- `inBaseQty`: `true` = qty is denominated in base token; `false` = qty is in quote token
- `qty`: Amount to swap (in wei)
- `minOut`: Minimum output for slippage protection
- Additional params set to `0`: `tip` (optional tip), `limitPrice` (no price limit), `reserveFlags` (no reserve usage)

## Key Addresses

| Chain    | Contract    | Address                                      |
| -------- | ----------- | -------------------------------------------- |
| Ethereum | CrocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` |
| Scroll   | CrocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` |

## ABI Methods

### CrocSwapDexABI

- `swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) -> (int128 baseFlow, int128 quoteFlow)` - Execute a swap with full parameter control. Returns signed token flows (negative = tokens out from user)
- `userCmd(uint16 callpath, bytes cmd) -> bytes result` - Execute arbitrary protocol commands (advanced: liquidity operations, governance, etc.)

## Notes

- Single contract holds ALL liquidity (similar to Balancer V2 Vault and Uniswap V4 PoolManager)
- Same contract address on both Ethereum and Scroll
- `poolIdx` identifies the pool type: different pool indices have different fee rates and tick spacing
- Common pool indices: `420` (standard on Ethereum), `36000` (stable pairs on Scroll)
- `isBuy` + `inBaseQty` together determine the exact swap semantics
- `tip`: Optional tip in basis points for priority execution (usually `0`)
- `limitPrice`: Price limit as sqrt price Q64.64 fixed-point (set to `0` for no limit)
- `reserveFlags`: Bitmask for using surplus collateral (set to `0` for standard swaps)
- `userCmd` is the universal command interface for all non-swap operations (adding/removing liquidity, etc.)
- callpath `1` = liquidity operations, `3` = warm path operations
- Gas-efficient for simple swaps; more complex for LP operations via `userCmd`
- Input token must be ERC20-approved to the CrocSwapDex contract
