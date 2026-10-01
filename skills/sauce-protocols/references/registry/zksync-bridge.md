<!-- Generated from the SDK's registries. Do not edit. -->

# zkSync Native Bridge (`zksync-bridge`)

Official zkSync Era bridge via DiamondProxy. Deposits ETH and ERC-20 tokens from Ethereum to zkSync with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, zksync |
| Document | [zksync-bridge.md](../zksync-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's diamondProxy):

```sauce chain=ethereum
import ZkSyncDiamondProxyABI from "./protocols/zksync-bridge/ZkSyncDiamondProxyABI.json";

const DIAMOND_PROXY = 0x32400084C286CF3E17e7B677ea9583e60a000324n;

function main() {
  const bound = ZkSyncDiamondProxyABI.at(DIAMOND_PROXY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | diamondProxy | `0x32400084C286CF3E17e7B677ea9583e60a000324` | `ZkSyncDiamondProxyABI.at(0x32400084C286CF3E17e7B677ea9583e60a000324n)` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | l2Bridge | `0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102` | no registry ABI |

## ABI

### `ZkSyncDiamondProxyABI`

`import ZkSyncDiamondProxyABI from "./protocols/zksync-bridge/ZkSyncDiamondProxyABI.json";` Speaks for: diamondProxy.

- `requestL2Transaction(address _contractL2, uint256 _l2Value, bytes _calldata, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit, bytes[] _factoryDeps, address _refundRecipient) payable returns (bytes32 canonicalTxHash)`
- `l2TransactionBaseCost(uint256 _gasPrice, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit) view returns (uint256)`
