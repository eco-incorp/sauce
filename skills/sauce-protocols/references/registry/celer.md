<!-- Generated from the SDK's registries. Do not edit. -->

# Celer Network (`celer`)

Multi-chain bridging protocol using SGN (State Guardian Network) for cross-chain message validation and token transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Celer` on ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arbitrum, avalanche |
| Document | [celer.md](../celer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Celer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's bridge, `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820`.
  require(Celer.Bridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bridge | `0x5427FEFA711Eff984124bFBB1AB6fbf5E3DA1820` | `Celer.Bridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | bridge | `0x9D39Fc627A6d9d9F8C831c16995b209548cc3401` | `Celer.Bridge` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | bridge | `0xdd90E5E87A2081Dcf0391920868eBc2FFB81a1aF` | `Celer.Bridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | bridge | `0x88DCDC47D2f83a99CF0000FDF667A468bB958a78` | `Celer.Bridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | bridge | `0x1619DE6B6B20eD217a58d00f37B9d47C7663feca` | `Celer.Bridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | bridge | `0xef3c714c9425a8F3697A9C969Dc1af30ba82e5d4` | `Celer.Bridge` |

## ABI

### `CelerBridgeABI`

`import CelerBridgeABI from "./protocols/celer/CelerBridgeABI.json";` Speaks for: bridge. The import is the contract's full ABI across every deployment; call it through the `Celer` namespace to have a function a chain's deployment does not run refused.

- `addGovernor(address _account)`
- `addLiquidity(address _token, uint256 _amount)`
- `addNativeLiquidity(uint256 _amount) payable`
- `addPauser(address account)`
- `addseq() view returns (uint64)`
- `delayedTransfers(bytes32) view returns (address receiver, address token, uint256 amount, uint256 timestamp)`
- `delayPeriod() view returns (uint256)`
- `delayThresholds(address) view returns (uint256)`
- `epochLength() view returns (uint256)`
- `epochVolumeCaps(address) view returns (uint256)`
- `epochVolumes(address) view returns (uint256)`
- `executeDelayedTransfer(bytes32 id)`
- `governors(address) view returns (bool)`
- `increaseNoticePeriod(uint256 period)`
- `isGovernor(address _account) view returns (bool)`
- `isPauser(address account) view returns (bool)`
- `lastOpTimestamps(address) view returns (uint256)`
- `maxSend(address) view returns (uint256)`
- `minAdd(address) view returns (uint256)`
- `minimalMaxSlippage() view returns (uint32)`
- `minSend(address) view returns (uint256)`
- `nativeWrap() view returns (address)`
- `noticePeriod() view returns (uint256)`
- `notifyResetSigners()`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pausers(address) view returns (bool)`
- `relay(bytes _relayRequest, bytes[] _sigs, address[] _signers, uint256[] _powers)`
- `removeGovernor(address _account)`
- `removePauser(address account)`
- `renounceGovernor()`
- `renounceOwnership()`
- `renouncePauser()`
- `resetSigners(address[] _signers, uint256[] _powers)`
- `resetTime() view returns (uint256)`
- `send(address _receiver, address _token, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage)`
- `sendNative(address _receiver, uint256 _amount, uint64 _dstChainId, uint64 _nonce, uint32 _maxSlippage) payable`
- `setDelayPeriod(uint256 _period)`
- `setDelayThresholds(address[] _tokens, uint256[] _thresholds)`
- `setEpochLength(uint256 _length)`
- `setEpochVolumeCaps(address[] _tokens, uint256[] _caps)`
- `setMaxSend(address[] _tokens, uint256[] _amounts)`
- `setMinAdd(address[] _tokens, uint256[] _amounts)`
- `setMinimalMaxSlippage(uint32 _minimalMaxSlippage)`
- `setMinSend(address[] _tokens, uint256[] _amounts)`
- `setWrap(address _weth)`
- `ssHash() view returns (bytes32)`
- `transferOwnership(address newOwner)`
- `transfers(bytes32) view returns (bool)`
- `triggerTime() view returns (uint256)`
- `unpause()`
- `updateSigners(uint256 _triggerTime, address[] _newSigners, uint256[] _newPowers, bytes[] _sigs, address[] _curSigners, uint256[] _curPowers)`
- `verifySigs(bytes _msg, bytes[] _sigs, address[] _signers, uint256[] _powers) view`
- `withdraw(bytes _wdmsg, bytes[] _sigs, address[] _signers, uint256[] _powers)`
- `withdraws(bytes32) view returns (bool)`
