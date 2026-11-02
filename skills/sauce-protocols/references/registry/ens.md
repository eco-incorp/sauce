<!-- Generated from the SDK's registries. Do not edit. -->

# ENS (`ens`)

Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Ens` on ethereum |
| Chains | ethereum |
| Document | [ens.md](../ens.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Ens` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's baseRegistrar, `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`.
  require(Ens.BaseRegistrar != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | `Ens.BaseRegistrar` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | `Ens.Registry` |

## ABI

### `BaseRegistrarABI`

`import BaseRegistrarABI from "./protocols/ens/BaseRegistrarABI.json";` Speaks for: baseRegistrar.

- `addController(address controller)`
- `approve(address to, uint256 tokenId)`
- `balanceOf(address owner) view returns (uint256)`
- `baseNode() view returns (bytes32)`
- `controllers(address) view returns (bool)`
- `ens() view returns (address)`
- `getApproved(uint256 tokenId) view returns (address)`
- `GRACE_PERIOD() view returns (uint256)`
- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `isOwner() view returns (bool)`
- `nameExpires(uint256 id) view returns (uint256)`
- `owner() view returns (address)`
- `ownerOf(uint256 tokenId) view returns (address)`
- `reclaim(uint256 id, address owner)`
- `register(uint256 id, address owner, uint256 duration) returns (uint256)`
- `registerOnly(uint256 id, address owner, uint256 duration) returns (uint256)`
- `removeController(address controller)`
- `renew(uint256 id, uint256 duration) returns (uint256)`
- `renounceOwnership()`
- `safeTransferFrom(address from, address to, uint256 tokenId)`
- `safeTransferFrom(address from, address to, uint256 tokenId, bytes _data)`
- `setApprovalForAll(address to, bool approved)`
- `setResolver(address resolver)`
- `supportsInterface(bytes4 interfaceID) view returns (bool)`
- `transferFrom(address from, address to, uint256 tokenId)`
- `transferOwnership(address newOwner)`

Left out of this ABI, though its deployments declare them:

- `available` taking `(uint256)`: its name is an accessor's own property.

### `ENSRegistryABI`

`import ENSRegistryABI from "./protocols/ens/ENSRegistryABI.json";` Speaks for: registry.

- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `old() view returns (address)`
- `owner(bytes32 node) view returns (address)`
- `recordExists(bytes32 node) view returns (bool)`
- `resolver(bytes32 node) view returns (address)`
- `setApprovalForAll(address operator, bool approved)`
- `setOwner(bytes32 node, address owner)`
- `setRecord(bytes32 node, address owner, address resolver, uint64 ttl)`
- `setResolver(bytes32 node, address resolver)`
- `setSubnodeOwner(bytes32 node, bytes32 label, address owner) returns (bytes32)`
- `setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)`
- `setTTL(bytes32 node, uint64 ttl)`
- `ttl(bytes32 node) view returns (uint64)`
