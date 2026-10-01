# Gelato Network

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

## Category

infrastructure | Chains and addresses: [registry/gelato.md](registry/gelato.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gelato.md](registry/gelato.md).

## Notes

- Same address across all 7 chains
- Supports time-based triggers, event-based triggers, and custom resolver conditions
- Gelato bots execute tasks when conditions are met, paid via prepaid balance or task fee
- moduleData configures when the task should execute (time interval, resolver function, etc.)
- feeToken: use address(0) for ETH, or an ERC-20 address for token payment
- Module types: 0=Resolver (custom check), 1=Time (interval), 2=Proxy, 3=SingleExec
- args[] contains encoded config for each module
