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
  require(Gelato.Automate != 0);
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

`import GelatoAutomateABI from "./protocols/gelato/GelatoAutomateABI.json";` Speaks for: automate. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Gelato` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
