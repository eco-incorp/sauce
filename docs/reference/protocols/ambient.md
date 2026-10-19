<!-- Generated from the SDK's registries. Do not edit. -->

# Ambient (`ambient`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Ambient is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Single-contract DEX (formerly CrocSwap) with ambient (full-range) and concentrated liquidity in one unified pool. Extremely gas-efficient architecture where all liquidity lives in one contract.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ambient` on ethereum, scroll |
| Chains | ethereum, scroll |

## Key Operations

- **swap**: Swap tokens via the CrocSwapDex contract with base/quote pair addressing

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
): { baseFlow: Int256; quoteFlow: Int256 } {
  const dex = ICrocSwapDex.at(dexAddress);
  return dex.swap(base, quote, poolIdx, isBuy, inBaseQty, qty, 0, 0, minOut, 0);
}
```

- `dexAddress`: CrocSwapDex contract address (`0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` on Ethereum, `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` on Scroll)
- `base`: Base token address (lower address of the pair by convention)
- `quote`: Quote token address (higher address of the pair)
- `poolIdx`: Pool index identifying the pool type (e.g., `420` for standard pools on Ethereum)
- `isBuy`: `true` pays base and receives quote (base -> quote); `false` pays quote and receives base (quote -> base)
- `inBaseQty`: `true` = `qty` is denominated in base; `false` = `qty` is denominated in quote. When `isBuy === inBaseQty`, `qty` names the input; when they differ, it names the output
- `qty`: Amount in the selected token's smallest units
- `minOut`: Minimum output for slippage protection
- Additional params set to `0`: `tip` (optional tip), `limitPrice` (no price limit, so `minOut` is the only bound), `reserveFlags` (no reserve usage)
- Returns `baseFlow` and `quoteFlow` as `Int256` (ABI `int128`): positive flows are tokens paid by the caller, negative flows are tokens received by the caller. Keep these mathematical signs when comparing or calculating net flows

## Notes

- Single contract holds ALL liquidity (similar to Balancer V2 Vault and Uniswap V4 PoolManager)
- Same contract address on both Ethereum and Scroll
- `poolIdx` identifies the pool type: different pool indices have different fee rates and tick spacing
- Common pool indices: `420` (standard on Ethereum), `36000` (stable pairs on Scroll)
- Exact-input: `isBuy: true, inBaseQty: true` specifies base paid; `isBuy: false, inBaseQty: false` specifies quote paid
- Exact-output: `isBuy: true, inBaseQty: false` specifies quote received; `isBuy: false, inBaseQty: true` specifies base received
- `tip`: Optional tip in basis points for priority execution (usually `0`)
- `limitPrice`: Price limit as sqrt price Q64.64 fixed-point (`0` is no limit, which leaves `minOut` as the only bound)
- `reserveFlags`: Bitmask for using surplus collateral (set to `0` for standard swaps)
- `userCmd` is the universal command interface for all non-swap operations (adding/removing liquidity, etc.)
- callpath `1` = liquidity operations, `3` = warm path operations
- Gas-efficient for simple swaps; more complex for LP operations via `userCmd`
- Input token must be ERC20-approved to the CrocSwapDex contract

## Its names in a program

On Ethereum, `Ambient` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's crocSwapDex, `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688`.
  require(Ambient.CrocSwapDex != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | crocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` | `Ambient.CrocSwapDex` |
| [Scroll](../chains/scroll.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `Ambient.CrocSwapDex` |

## ABI

### `CrocSwapDexABI`

`import CrocSwapDexABI from "./protocols/ambient/CrocSwapDexABI.json";` Speaks for: crocSwapDex.

- `swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) payable returns (int128 baseFlow, int128 quoteFlow)`
- `userCmd(uint16 callpath, bytes cmd) payable returns (bytes result)`
