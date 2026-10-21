<!-- Generated from the SDK's registries. Do not edit. -->

# Ambient (`ambient`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Ambient is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Single-contract DEX (formerly CrocSwap) with ambient (full-range) and concentrated liquidity in one unified pool. Extremely gas-efficient architecture where all liquidity lives in one contract.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ambient` on ethereum, scroll |
| Chains | ethereum, scroll |

## What it offers

- **swap**: Swap tokens via the CrocSwapDex contract with base/quote pair addressing

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
