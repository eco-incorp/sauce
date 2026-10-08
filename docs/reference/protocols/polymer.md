<!-- Generated from the SDK's registries. Do not edit. -->

# Polymer (`polymer`)

Cross-chain event proofs. A log emitted on one chain is proven on another by Polymer's prover contract, CrossL2ProverV2, from a proof anyone fetches from Polymer's prove API and submits. Nothing is sent and no fee is paid on the source: the source only emits the log.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Polymer` on ethereum, optimism, unichain, polygon, monad, arc, base, plasma, arbitrum |
| Chains | ethereum, optimism, unichain, polygon, monad, arc, base, plasma, arbitrum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows.

### validateEvent

Check a proof of a log and read it, keeping only logs this contract emitted itself.

```typescript
import { CrossL2ProverV2ABI as ICrossL2ProverV2 } from "./abis";

function main(proverAddress: Address, proof: bytes): bytes {
  const [chainId, emitter, topics, data] = ICrossL2ProverV2.at(proverAddress).validateEvent(proof);
  require(emitter == ctx.self(), "not this contract's log");
  return data;
}
```

- `chainId`: the chain the log was emitted on, as Polymer's sequencer signed it
- `emitter`: the contract that emitted the log. Check it: the prover proves any contract's logs
- `topics`: the log's topics, 32 bytes each, concatenated (the event's signature first)
- `data`: the log's unindexed data, as emitted

## Notes

- Pull-based: nothing relays a log on its own. Someone fetches the proof from Polymer's prove API (by the chain, block and log of the event) and submits it to the contract that checks it, paying that transaction's gas
- `validateEvent` is a view: it checks the proof and answers the log, and records nothing. The same proof validates every time, so a receiver records what it used and refuses it again. `inspectLogIdentifier(proof)` reads the log's place (chain, block number, receipt index, log index) from the proof; once `validateEvent` passed, that place is the proven one, since the proof is checked against exactly that key
- The proof is signed by Polymer's sequencer over Polymer's state root: trust is Polymer's
- One address on every chain listed in the registry; eco-routes' PolymerProver uses the same one, and caps the data it emits for a proof at 2,048 bytes

## Its names in a program

On Ethereum, `Polymer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's crossL2ProverV2, `0x95ccEAE71605c5d97A0AC0EA13013b058729d075`.
  require(Polymer.CrossL2ProverV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Optimism](../chains/optimism.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Unichain](../chains/unichain.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Polygon](../chains/polygon.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Monad](../chains/monad.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Arc](../chains/arc.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Base](../chains/base.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Plasma](../chains/plasma.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Arbitrum One](../chains/arbitrum.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |

## ABI

### `CrossL2ProverV2ABI`

`import CrossL2ProverV2ABI from "./protocols/polymer/CrossL2ProverV2ABI.json";` Speaks for: crossL2ProverV2.

- `validateEvent(bytes proof) view returns (uint32 chainId, address emittingContract, bytes topics, bytes unindexedData)`
- `inspectLogIdentifier(bytes proof) pure returns (uint32 srcChain, uint64 blockNumber, uint32 receiptIndex, uint32 logIndex)`
