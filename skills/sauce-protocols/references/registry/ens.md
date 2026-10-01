<!-- Generated from the SDK's registries. Do not edit. -->

# ENS (`ens`)

Ethereum Name Service - the decentralized naming system for wallets, websites, and resources. Maps human-readable names to Ethereum addresses.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [ens.md](../ens.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's baseRegistrar):

```sauce chain=ethereum
import BaseRegistrarABI from "./protocols/ens/BaseRegistrarABI.json";

const BASE_REGISTRAR = 0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85n;

function main() {
  const bound = BaseRegistrarABI.at(BASE_REGISTRAR);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | baseRegistrar | `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` | `BaseRegistrarABI.at(0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` | `ENSRegistryABI.at(0x00000000000C2E074eC69A0dFb2997BA6C7d2e1en)` |

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
