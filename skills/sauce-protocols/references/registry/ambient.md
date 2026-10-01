<!-- Generated from the SDK's registries. Do not edit. -->

# Ambient (`ambient`)

Single-contract DEX (formerly CrocSwap) with ambient and concentrated liquidity in one unified pool. Gas-efficient architecture on Ethereum and Scroll.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, scroll |
| Document | [ambient.md](../ambient.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's crocSwapDex):

```sauce chain=ethereum
import CrocSwapDexABI from "./protocols/ambient/CrocSwapDexABI.json";

const CROC_SWAP_DEX = 0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688n;

function main() {
  const bound = CrocSwapDexABI.at(CROC_SWAP_DEX);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crocSwapDex | `0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688` | `CrocSwapDexABI.at(0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688n)` |
| [Scroll](../../../sauce-chains/references/scroll.md) | crocSwapDex | `0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106` | `CrocSwapDexABI.at(0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106n)` |

## ABI

### `CrocSwapDexABI`

`import CrocSwapDexABI from "./protocols/ambient/CrocSwapDexABI.json";` Speaks for: crocSwapDex.

- `swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) payable returns (int128 baseFlow, int128 quoteFlow)`
- `userCmd(uint16 callpath, bytes cmd) payable returns (bytes result)`
