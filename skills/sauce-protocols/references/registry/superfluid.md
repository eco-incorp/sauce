<!-- Generated from the SDK's registries. Do not edit. -->

# Superfluid (`superfluid`)

Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | `Superfluid` on ethereum, optimism, polygon, base, arbitrum |
| Chains | ethereum, optimism, polygon, base, arbitrum |
| Document | [superfluid.md](../superfluid.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Superfluid` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cfaForwarder, `0xcfA132E353cB4E398080B9700609bb008eceB125`.
  require(Superfluid.CFAForwarder != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | host | `0x4E583d9390082B65Bef884b629DFA426114CED6d` | `Superfluid.Host` |
| [Optimism](../../../sauce-chains/references/optimism.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Optimism](../../../sauce-chains/references/optimism.md) | host | `0x567c4B141ED61923967cA25Ef4906C8781069a10` | `Superfluid.Host` |
| [Polygon](../../../sauce-chains/references/polygon.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Polygon](../../../sauce-chains/references/polygon.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [Base](../../../sauce-chains/references/base.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Base](../../../sauce-chains/references/base.md) | host | `0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74` | `Superfluid.Host` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | host | `0xCf8Acb4eF033efF16E8080aed4c7D5B9285D2192` | `Superfluid.Host` |

## ABI

### `CFAForwarderABI`

`import CFAForwarderABI from "./protocols/superfluid/CFAForwarderABI.json";` Speaks for: cfaForwarder.

- `createFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `updateFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `deleteFlow(address token, address sender, address receiver, bytes userData) returns (bool)`
