<!-- Generated from the SDK's registries. Do not edit. -->

# Superfluid (`superfluid`)

Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, base, arbitrum |
| Document | [superfluid.md](../superfluid.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's cfaForwarder):

```sauce chain=ethereum
import CFAForwarderABI from "./protocols/superfluid/CFAForwarderABI.json";

const CFA_FORWARDER = 0xcfA132E353cB4E398080B9700609bb008eceB125n;

function main() {
  const bound = CFAForwarderABI.at(CFA_FORWARDER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |
| [Optimism](../../../sauce-chains/references/optimism.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |
| [Polygon](../../../sauce-chains/references/polygon.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |
| [Base](../../../sauce-chains/references/base.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Base](../../../sauce-chains/references/base.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `CFAForwarderABI.at(0xcfA132E353cB4E398080B9700609bb008eceB125n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | no registry ABI |

## ABI

### `CFAForwarderABI`

`import CFAForwarderABI from "./protocols/superfluid/CFAForwarderABI.json";` Speaks for: cfaForwarder.

- `createFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `updateFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `deleteFlow(address token, address sender, address receiver, bytes userData) returns (bool)`
