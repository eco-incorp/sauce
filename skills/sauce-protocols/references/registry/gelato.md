<!-- Generated from the SDK's registries. Do not edit. -->

# Gelato Network (`gelato`)

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Gelato` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [gelato.md](../gelato.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Gelato` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's automate, `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0`.
  require(Gelato.Automate != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Optimism](../../../sauce-chains/references/optimism.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Polygon](../../../sauce-chains/references/polygon.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Base](../../../sauce-chains/references/base.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |

## ABI

### `GelatoAutomateABI`

`import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";` Speaks for: automate.

- `createTask(address execAddress, bytes execDataOrSelector, (uint8[] modules, bytes[] args) moduleData, address feeToken) returns (bytes32 taskId)`
- `cancelTask(bytes32 taskId)`
