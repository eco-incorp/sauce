# ENS

Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.

## Category

infrastructure | Chains: Ethereum

## Key Operations

- **setResolver**: Set the resolver contract for an ENS name
- **setOwner**: Transfer ownership of an ENS name

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/ens";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Ethereum | registry      | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Ethereum | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` |

## ABI Methods

### ENSRegistryABI

- `owner(bytes32)` - Query owner of a name node. Params: node (namehash). Returns owner address
- `resolver(bytes32)` - Query resolver of a name node. Params: node. Returns resolver address
- `setOwner(bytes32,address)` - Transfer name ownership. Params: node, owner (new owner)
- `setResolver(bytes32,address)` - Set resolver contract. Params: node, resolver (new resolver)

### BaseRegistrarABI

- `nameExpires(uint256)` - Check when a .eth name expires. Params: id (label hash as uint256). Returns expiry timestamp
- `reclaim(uint256,address)` - Reclaim ENS registry ownership. Params: id (label hash), owner. Only callable by registrant

## Notes

- node = namehash of the ENS name (e.g. namehash("vitalik.eth") = keccak256 chain)
- .eth names are ERC-721 NFTs held in the baseRegistrar contract
- Resolver contract stores the address/content records for a name
- Only the owner of a node can setResolver or setOwner
- Registration/renewal happens via the ETHRegistrarController (not in this ABI set)
