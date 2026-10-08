<!-- Generated from the SDK's registries. Do not edit. -->

# Polymer (`polymer`)

Cross-chain event proofs: a log emitted on one chain is proven on another by its prover contract, CrossL2ProverV2, from a proof anyone fetches from Polymer's prove API and submits. Pull-based: no message is sent and no fee is paid on the source.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Polymer` on ethereum, optimism, unichain, polygon, monad, arc, base, plasma, arbitrum |
| Chains | ethereum, optimism, unichain, polygon, monad, arc, base, plasma, arbitrum |
| Document | [polymer.md](../polymer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Polymer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's crossL2ProverV2, `0x95ccEAE71605c5d97A0AC0EA13013b058729d075`.
  require(Polymer.CrossL2ProverV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Unichain](../../../sauce-chains/references/unichain.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Monad](../../../sauce-chains/references/monad.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Arc](../../../sauce-chains/references/arc.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Base](../../../sauce-chains/references/base.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Plasma](../../../sauce-chains/references/plasma.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | crossL2ProverV2 | `0x95ccEAE71605c5d97A0AC0EA13013b058729d075` | `Polymer.CrossL2ProverV2` |

## ABI

### `CrossL2ProverV2ABI`

`import CrossL2ProverV2ABI from "./protocols/polymer/CrossL2ProverV2ABI.json";` Speaks for: crossL2ProverV2.

- `validateEvent(bytes proof) view returns (uint32 chainId, address emittingContract, bytes topics, bytes unindexedData)`
- `inspectLogIdentifier(bytes proof) pure returns (uint32 srcChain, uint64 blockNumber, uint32 receiptIndex, uint32 logIndex)`
