<!-- Generated from the SDK's registries. Do not edit. -->

# Succinct SP1 (`succinct`)

Succinct's SP1 zkVM verifiers: the SP1VerifierGateway checks, in the same call, a Groth16 or PLONK proof that an SP1 program (its verification key) ran and committed its public values, routing the proof to the verifier of the SP1 version its first four bytes name.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Succinct` on ethereum, base |
| Chains | ethereum, base |

## In a Sauce program

A proof verified here arrives with the transaction: the program calls the gateway, which reverts
unless the proof verifies, and acts on the public values straight after, in the same cook. There
is no request, callback or promise ([proofs](../../guides/async.md#proofs-saucezk) covers both kinds, and has the template's
Fibonacci contract ported):

```ts
// The SP1 program this one trusts: its verification key (here, Succinct's template's).
const PROGRAM_VKEY = 0x004a55ed3c7a07d0233a027278a8b7ff8681ffbd5d1ec4795c18966f6e693090;

function main(publicValues: bytes, proof: bytes): Uint256 {
  require(Succinct.VerifierGatewayGroth16);
  Succinct.VerifierGatewayGroth16.verifyProof(PROGRAM_VKEY, publicValues, proof);
  const [n] = abi.decode(publicValues, ["Uint256"]);
  return n;
}
```

## How verification works

1. **The program** is an SP1 guest, built off chain; its verification key (`vkey`, 32 bytes) names
   it, as `cargo run --bin vkey` prints it. It commits public values, the bytes the proof attests.
2. **The proof** is made off chain (locally or by Succinct's prover network) and wrapped for the
   chain as Groth16 (cheaper to verify) or PLONK. Its first four bytes are the selector of the SP1
   version that made it: the first four bytes of that version's verifier's `VERIFIER_HASH()`.
3. **The gateway**, `verifyProof(bytes32 programVKey, bytes publicValues, bytes proofBytes)`, a
   view, reads `routes(selector)`: no route reverts `RouteNotFound(selector)`, a frozen one
   `RouteIsFrozen(selector)`; otherwise it calls that version's verifier, which reverts unless the
   proof shows `programVKey` committed exactly `publicValues`. It returns nothing.
4. **Two gateways**: `VerifierGatewayGroth16` for Groth16 proofs and `VerifierGatewayPlonk` for
   PLONK ones, each with its own routes. A proof sent to the other gateway finds no route.

## Pitfalls

- **Versions are frozen.** Succinct adds a route per SP1 version and freezes one it retires; a
  frozen route refuses every proof, for good. A proof must come from a version whose route is live
  on that gateway: check `routes(selector)` (the `route` template below) before relying on one.
- **The public values are the program's, unchecked.** The gateway proves the program committed
  them, nothing more: decode them as the program encodes them, and check each value the program
  acts on.
- **The verification key is the program.** A proof of any other program verifies too, for its own
  key: a program that accepts a key as an argument accepts every SP1 program's proofs. Fix the key
  the program trusts.
- **Gas.** A Groth16 verification costs about 225,000 gas inside the gateway.

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### verifyProof

Verify a proof through `gateway`, and answer the public values' hash.

```typescript
import { SP1VerifierGatewayABI as ISP1VerifierGateway } from "./abis";

function main(gateway: Address, programVKey: Uint256, publicValues: bytes, proof: bytes): Uint256 {
  ISP1VerifierGateway.at(gateway).verifyProof(programVKey, publicValues, proof);
  return crypto.keccak256(publicValues);
}
```

### route

The verifier a proof's selector routes to, or 0 when the route is frozen.

```typescript
import { SP1VerifierGatewayABI as ISP1VerifierGateway } from "./abis";

function main(gateway: Address, proof: bytes): Uint256 {
  const [verifier, frozen] = ISP1VerifierGateway.at(gateway).routes(
    proof.slice(0, 4).toBe() << 224,
  );
  return frozen ? 0 : verifier;
}
```

## Notes

- Sources: `succinctlabs/sp1-contracts` (`contracts/src/SP1VerifierGateway.sol`,
  `contracts/src/<version>/SP1VerifierGroth16.sol`, `contracts/deployments/`), the gateways' verified
  source on Sourcify, and `succinctlabs/sp1-project-template` (`contracts/src/Fibonacci.sol`).
- Both gateways are owned by Succinct (`owner()`), which adds and freezes routes; a route once added
  is never removed, and a frozen one is never thawed.
- The gateways are at the same addresses on every chain Succinct deploys them to; this registry
  records Ethereum and Base.

## Its names in a program

On Ethereum, `Succinct` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's verifierGatewayGroth16, `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B`.
  require(Succinct.VerifierGatewayGroth16 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | verifierGatewayGroth16 | `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B` | `Succinct.VerifierGatewayGroth16` |
| [Ethereum](../chains/ethereum.md) | verifierGatewayPlonk | `0x3B6041173B80E77f038f3F2C0f9744f04837185e` | `Succinct.VerifierGatewayPlonk` |
| [Base](../chains/base.md) | verifierGatewayGroth16 | `0x397A5f7f3dBd538f23DE225B51f532c34448dA9B` | `Succinct.VerifierGatewayGroth16` |
| [Base](../chains/base.md) | verifierGatewayPlonk | `0x3B6041173B80E77f038f3F2C0f9744f04837185e` | `Succinct.VerifierGatewayPlonk` |

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
