<!-- Generated from the SDK's registries. Do not edit. -->

# Succinct SP1 (`succinct`)

Succinct's SP1 zkVM verifiers: the SP1VerifierGateway checks, in the same call, a Groth16 or PLONK proof that an SP1 program (its verification key) ran and committed its public values, routing the proof to the verifier of the SP1 version its first four bytes name.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Succinct` on ethereum, base |
| Chains | ethereum, base |
| Document | [succinct.md](../succinct.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Succinct` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's verifierGatewayGroth16, `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B`.
  require(Succinct.VerifierGatewayGroth16 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | verifierGatewayGroth16 | `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B` | `Succinct.VerifierGatewayGroth16` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | verifierGatewayPlonk | `0x3B6041173B80E77f038f3F2C0f9744f04837185e` | `Succinct.VerifierGatewayPlonk` |
| [Base](../../../sauce-chains/references/base.md) | verifierGatewayGroth16 | `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B` | `Succinct.VerifierGatewayGroth16` |
| [Base](../../../sauce-chains/references/base.md) | verifierGatewayPlonk | `0x3B6041173B80E77f038f3F2C0f9744f04837185e` | `Succinct.VerifierGatewayPlonk` |

## ABI

### `SP1VerifierGatewayABI`

`import SP1VerifierGatewayABI from "./protocols/succinct/SP1VerifierGatewayABI.json";` Speaks for: verifierGatewayGroth16, verifierGatewayPlonk.

- `addRoute(address verifier)`
- `freezeRoute(bytes4 selector)`
- `owner() view returns (address)`
- `renounceOwnership()`
- `routes(bytes4) view returns (address verifier, bool frozen)`
- `transferOwnership(address newOwner)`
- `verifyProof(bytes32 programVKey, bytes publicValues, bytes proofBytes) view`
