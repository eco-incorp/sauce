<!-- Generated from the SDK's registries. Do not edit. -->

# ENS (`ens`)

Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Ens` on ethereum |
| Chains | ethereum |

## Key Operations

- **setResolver**: Set the resolver contract for an ENS name
- **setOwner**: Transfer ownership of an ENS name

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- node = namehash of the ENS name (e.g. namehash("vitalik.eth") = keccak256 chain)
- .eth names are ERC-721 NFTs held in the baseRegistrar contract
- Resolver contract stores the address/content records for a name
- Only the owner of a node can setResolver or setOwner
- Registration/renewal happens via the ETHRegistrarController (not in this ABI set)

## Its names in a program

On Ethereum, `Ens` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's baseRegistrar, `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`.
  require(Ens.BaseRegistrar != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | `Ens.BaseRegistrar` |
| [Ethereum](../chains/ethereum.md) | registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | `Ens.Registry` |

## ABI

### `BaseRegistrarABI`

`import BaseRegistrarABI from "./protocols/ens/BaseRegistrarABI.json";` Speaks for: baseRegistrar.

- `nameExpires(uint256 id) view returns (uint256)`
- `reclaim(uint256 id, address owner)`

### `ENSRegistryABI`

`import ENSRegistryABI from "./protocols/ens/ENSRegistryABI.json";` Speaks for: registry.

- `owner(bytes32 node) view returns (address)`
- `resolver(bytes32 node) view returns (address)`
- `setOwner(bytes32 node, address owner)`
- `setResolver(bytes32 node, address resolver)`
