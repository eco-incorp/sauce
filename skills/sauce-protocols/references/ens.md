# ENS

Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.

## Category

infrastructure | Chains and addresses: [registry/ens.md](registry/ens.md)

## Key Operations

- **setResolver**: Set the resolver contract for an ENS name
- **setOwner**: Transfer ownership of an ENS name

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Set resolver for ENS name
import { ENSRegistryABI as IENSRegistry } from "./abis";
function main(registryAddress: Address, node: Uint256, resolver: Address): Uint256 {
  const registry = IENSRegistry.at(registryAddress);
  registry.setResolver(node, resolver);
  return 1;
}

// Transfer ENS name ownership
import { ENSRegistryABI as IENSRegistry } from "./abis";
function main(registryAddress: Address, node: Uint256, owner: Address): Uint256 {
  const registry = IENSRegistry.at(registryAddress);
  registry.setOwner(node, owner);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/ens.md](registry/ens.md).

## Notes

- node = namehash of the ENS name (e.g. namehash("vitalik.eth") = keccak256 chain)
- .eth names are ERC-721 NFTs held in the baseRegistrar contract
- Resolver contract stores the address/content records for a name
- Only the owner of a node can setResolver or setOwner
- Registration/renewal happens via the ETHRegistrarController (not in this ABI set)
