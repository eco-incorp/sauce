# Safe

Multi-signature smart contract wallet. Supports programmable account abstraction and modular security.

## Category

infrastructure | Chains and addresses: [registry/safe.md](registry/safe.md)

## Key Operations

- **getThreshold**: Query the signing threshold of a Safe multisig
- **execTransaction**: Execute a transaction with collected signatures

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Get Safe threshold
import { SafeABI as ISafe } from "./abis";
function main(safeAddress: Address): Uint256 {
  const safe = ISafe.at(safeAddress);
  return safe.getThreshold();
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/safe.md](registry/safe.md).

## Notes

- safeV141 is for Ethereum L1; safeL2V130 is the L2-optimized version (emits events for cheaper indexing)
- operation: 0 = CALL (normal), 1 = DELEGATECALL (execute in Safe context)
- signatures are sorted by owner address, packed as 65 bytes each (r, s, v)
- Modular: supports Guards (pre/post checks), Modules (extend functionality), and Fallback handlers
