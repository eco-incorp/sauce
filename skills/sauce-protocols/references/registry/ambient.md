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

`import CrocSwapDexABI from "./protocols/ambient/CrocSwapDexABI.json";` Speaks for: crocSwapDex. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Ambient` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptCrocDex() pure returns (bool)`
- `protocolCmd(uint16 callpath, bytes cmd, bool sudo) payable`
- `readSlot(uint256 slot) view returns (uint256 data)`
- `swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) payable returns (int128 baseFlow, int128 quoteFlow)`
- `userCmd(uint16 callpath, bytes cmd) payable returns (bytes result)`
- `userCmdRelayer(uint16 callpath, bytes cmd, bytes conds, bytes relayerTip, bytes signature) payable returns (bytes output)`
- `userCmdRouter(uint16 callpath, bytes cmd, address client) payable returns (bytes)`

Left out of this ABI, though its deployments declare them:

- `event CrocKnockoutCross` taking `(bytes32,int24,bool,uint32,uint64,uint160)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
