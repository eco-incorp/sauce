<!-- Generated from the SDK's registries. Do not edit. -->

# Gelato Network (`gelato`)

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [gelato.md](../gelato.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's automate):

```sauce chain=ethereum
import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";

const AUTOMATE = 0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n;

function main() {
  const bound = GelatoAutomateABI.at(AUTOMATE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Base](../../../sauce-chains/references/base.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `GelatoAutomateABI.at(0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0n)` |

## ABI

### `GelatoAutomateABI`

`import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";` Speaks for: automate.

- `createTask(address execAddress, bytes execDataOrSelector, (uint8[] modules, bytes[] args) moduleData, address feeToken) returns (bytes32 taskId)`
- `cancelTask(bytes32 taskId)`
