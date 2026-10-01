# Gelato Network

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

## Category

infrastructure | Chains: Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, Base

## Key Operations

- **createTask**: Create an automated task for scheduled execution
- **cancelTask**: Cancel an existing automated task

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  createTask,
  cancelTask,
} from "@eco-incorp/sauce/protocols/gelato";
```

## SauceScript Examples

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

## Key Addresses

| Chain        | Contract | Address                                      |
| ------------ | -------- | -------------------------------------------- |
| All 7 chains | automate | `0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0` |

## ABI Methods

### GelatoAutomateABI

- `createTask(address,bytes,tuple,address)` - Create automated task. Params: execAddress (contract to call), execDataOrSelector (function calldata or selector), moduleData (tuple: {modules uint8[], args bytes[]} - configures trigger conditions), feeToken (payment token, address(0) for ETH). Returns taskId
  - Module types: 0=Resolver (custom check), 1=Time (interval), 2=Proxy, 3=SingleExec
  - args[] contains encoded config for each module
- `cancelTask(bytes32)` - Cancel a task. Params: taskId (returned from createTask)

## Notes

- Same address across all 7 chains
- Supports time-based triggers, event-based triggers, and custom resolver conditions
- Gelato bots execute tasks when conditions are met, paid via prepaid balance or task fee
- moduleData configures when the task should execute (time interval, resolver function, etc.)
- feeToken: use address(0) for ETH, or an ERC-20 address for token payment
