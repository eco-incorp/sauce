<!-- Generated from the SDK's registries. Do not edit. -->

# Ambient (`ambient`)

Single-contract DEX (formerly CrocSwap) with ambient and concentrated liquidity in one unified pool. Gas-efficient architecture on Ethereum and Scroll.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ambient` on ethereum, scroll |
| Chains | ethereum, scroll |
| Document | [ambient.md](../ambient.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Ambient` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's crocSwapDex, `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688`.
  require(Ambient.CrocSwapDex != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` | `Ambient.CrocSwapDex` |
| [Scroll](../../../sauce-chains/references/scroll.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `Ambient.CrocSwapDex` |

## ABI

### `CrocSwapDexABI`

`import CrocSwapDexABI from "./protocols/ambient/CrocSwapDexABI.json";` Speaks for: crocSwapDex.

- `swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) payable returns (int128 baseFlow, int128 quoteFlow)`
- `userCmd(uint16 callpath, bytes cmd) payable returns (bytes result)`
