<!-- Generated from the SDK's registries. Do not edit. -->

# Pyth Entropy (`pyth-entropy`)

Pyth's random number service, v2. A contract pays a fee for a request, and the Entropy contract calls it back with a random number once the provider reveals its commitment.

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `PythEntropy` on base |
| Chains | base |
| Document | [pyth-entropy.md](../pyth-entropy.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `PythEntropy` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's entropy, `0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb`.
  require(PythEntropy.Entropy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | entropy | `0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb` | `PythEntropy.Entropy` |

## ABI

### `EntropyABI`

`import EntropyABI from "./protocols/pyth-entropy/EntropyABI.json";` Speaks for: entropy.

- `requestV2() payable returns (uint64 assignedSequenceNumber)`
- `requestV2(uint32 gasLimit) payable returns (uint64 assignedSequenceNumber)`
- `requestV2(address provider, uint32 gasLimit) payable returns (uint64 assignedSequenceNumber)`
- `requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit) payable returns (uint64 assignedSequenceNumber)`
- `getDefaultProvider() view returns (address provider)`
- `getFeeV2() view returns (uint128 feeAmount)`
- `getFeeV2(uint32 gasLimit) view returns (uint128 feeAmount)`
- `getFeeV2(address provider, uint32 gasLimit) view returns (uint128 feeAmount)`
