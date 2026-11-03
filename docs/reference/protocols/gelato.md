<!-- Generated from the SDK's registries. Do not edit. -->

# Gelato Network (`gelato`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Gelato Network is a building block that other protocols are built on. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Web3 automation network for scheduling and executing smart contract functions and off-chain computations.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Gelato` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

## What it offers

- **createTask**: Create an automated task for scheduled execution
- **cancelTask**: Cancel an existing automated task

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
  require(Gelato.Automate != 0);
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

`import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";` Speaks for: automate. The import is the contract's full ABI across every deployment; call it through the `Gelato` namespace to have a function a chain's deployment does not run refused.

- `cancelTask(bytes32 taskId)`
- `createTask(address execAddress, bytes execDataOrSelector, (uint8[] modules, bytes[] args) moduleData, address feeToken) returns (bytes32 taskId)`
- `exec(address _taskCreator, address _execAddress, bytes _execData, (uint8[] modules, bytes[] args) _moduleData, uint256 _txFee, address _feeToken, bool _revertOnFailure)`
- `exec1Balance(address _taskCreator, address _execAddress, bytes _execData, (uint8[] modules, bytes[] args) _moduleData, (address sponsor, address feeToken, uint256 oneBalanceChainId, uint256 nativeToFeeTokenXRateNumerator, uint256 nativeToFeeTokenXRateDenominator, bytes32 correlationId) _oneBalanceParam, bool _revertOnFailure)`
- `execAddresses(bytes32) view returns (address)`
- `execBypassModule(address _taskCreator, address _execAddress, bytes32 _taskId, bytes32 _correlationId, bytes _execData, bool _revertOnFailure, bool _singleExec)`
- `execBypassModuleSyncFee(address _taskCreator, address _execAddress, bytes32 _taskId, uint256 _txFee, address _feeToken, bytes _execData, bool _revertOnFailure, bool _singleExec)`
- `fee() view returns (uint256)`
- `feeToken() view returns (address)`
- `gelato() view returns (address)`
- `getFeeDetails() view returns (uint256, address)`
- `getTaskId(address taskCreator, address execAddress, bytes4 execSelector, (uint8[] modules, bytes[] args) moduleData, address feeToken) pure returns (bytes32 taskId)`
- `getTaskIdsByUser(address _taskCreator) view returns (bytes32[])`
- `nonce1Balance(bytes32) view returns (uint256)`
- `setModule(uint8[] _modules, address[] _moduleAddresses)`
- `taskCreator(bytes32) view returns (address)`
- `taskModuleAddresses(uint8) view returns (address)`
- `timedTask(bytes32) view returns (uint128 nextExec, uint128 interval)`
- `version() view returns (string)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
