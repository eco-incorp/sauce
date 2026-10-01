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
  require(Ens.BaseRegistrar != 0n);
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

- `nameExpires(uint256 id) view returns (uint256)`
- `reclaim(uint256 id, address owner)`

### `ENSRegistryABI`

`import ENSRegistryABI from "./protocols/ens/ENSRegistryABI.json";` Speaks for: registry.

- `owner(bytes32 node) view returns (address)`
- `resolver(bytes32 node) view returns (address)`
- `setOwner(bytes32 node, address owner)`
- `setResolver(bytes32 node, address resolver)`
