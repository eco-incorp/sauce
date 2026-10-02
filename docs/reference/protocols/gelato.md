<!-- Generated from the SDK's registries. Do not edit. -->

# Gelato Network (`gelato`)

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Gelato` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## Key Operations

- **createTask**: Create an automated task for scheduled execution
- **cancelTask**: Cancel an existing automated task

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Create automated task
import { GelatoAutomateABI as IAutomate } from "./abis";
function main(
  automateAddress: Address,
  execAddress: Address,
  execData: bytes,
  moduleData: { modules: Uint256[]; args: bytes[] },
  feeToken: Address,
): Uint256 {
  const automate = IAutomate.at(automateAddress);
  return automate.createTask(execAddress, execData, moduleData, feeToken);
}

// Cancel task
import { GelatoAutomateABI as IAutomate } from "./abis";
function main(automateAddress: Address, taskId: Uint256): Uint256 {
  const automate = IAutomate.at(automateAddress);
  automate.cancelTask(taskId);
  return 1;
}
```

## Notes

- Same address across all 7 chains
- Supports time-based triggers, event-based triggers, and custom resolver conditions
- Gelato bots execute tasks when conditions are met, paid via prepaid balance or task fee
- moduleData configures when the task should execute (time interval, resolver function, etc.)
- feeToken: use address(0) for ETH, or an ERC-20 address for token payment
- Module types: 0=Resolver (custom check), 1=Time (interval), 2=Proxy, 3=SingleExec
- args[] contains encoded config for each module

## Its names in a program

On Ethereum, `Gelato` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's automate, `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0`.
  require(Gelato.Automate != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Optimism](../chains/optimism.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [BNB Chain](../chains/bsc.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Polygon](../chains/polygon.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Base](../chains/base.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Arbitrum One](../chains/arbitrum.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |
| [Avalanche C-Chain](../chains/avalanche.md) | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` | `Gelato.Automate` |

## ABI

### `GelatoAutomateABI`

`import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";` Speaks for: automate.

- `createTask(address execAddress, bytes execDataOrSelector, (uint8[] modules, bytes[] args) moduleData, address feeToken) returns (bytes32 taskId)`
- `cancelTask(bytes32 taskId)`
