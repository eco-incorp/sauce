<!-- Generated from the SDK's registries. Do not edit. -->

# zkSync Native Bridge (`zksync-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> zkSync Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official zkSync Era bridge via DiamondProxy. Deposits ETH and executes L2 transactions from Ethereum with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ZksyncBridge` on ethereum, zksync |
| Chains | ethereum, zksync |

## Notes

- **L1 to L2** via DiamondProxy. For L2 to L1 withdrawals, use the L2 withdraw mechanism on zkSync Era
- `requestL2Transaction` is a general-purpose L1-to-L2 transaction request -- handles ETH deposits, contract calls, and even contract deployments (via `_factoryDeps`)
- `msg.value` must cover: `_l2Value + l2TransactionBaseCost(gasPrice, _l2GasLimit, _l2GasPerPubdataByteLimit)`
- Use `l2TransactionBaseCost()` to estimate the gas cost component before submitting
- `_l2GasPerPubdataByteLimit`: 800 is the standard value (required for pubdata pricing)
- `_factoryDeps`: used when deploying contracts via L1. Empty array for standard ETH transfers
- zkEVM architecture -- L2 to L1 withdrawals finalize with ZK proofs (typically 1-24 hours)
- L1 to L2 deposits finalize after the batch containing the transaction is committed (~minutes)
- For ERC-20 bridging, use the zkSync ERC20 Bridge contracts (separate from the DiamondProxy)
- Canonical bridge, secured by zkSync's ZK proving system (Matter Labs)
- Audited

## Its names in a program

On Ethereum, `ZksyncBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's diamondProxy, `0x32400084C286CF3E17e7B677ea9583e60a000324`.
  require(ZksyncBridge.DiamondProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | diamondProxy | `0x32400084C286CF3E17e7B677ea9583e60a000324` | `ZksyncBridge.DiamondProxy` |
| [zkSync Era](../chains/zksync.md) | l2Bridge | `0x11f943b2c77b743AB90f4A0Ae7d5A4e7FCA3E102` | `ZksyncBridge.L2Bridge` |

## ABI

### `ZkSyncDiamondProxyABI`

`import ZkSyncDiamondProxyABI from "./protocols/zksync-bridge/ZkSyncDiamondProxyABI.json";` Speaks for: diamondProxy. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `ZksyncBridge` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptAdmin()`
- `allowEvmEmulation() returns (bytes32 canonicalTxHash)`
- `baseTokenGasPriceMultiplierDenominator() view returns (uint128)`
- `baseTokenGasPriceMultiplierNominator() view returns (uint128)`
- `bridgehubRequestL2Transaction((address sender, address contractL2, uint256 mintValue, uint256 l2Value, bytes l2Calldata, uint256 l2GasLimit, uint256 l2GasPerPubdataByteLimit, bytes[] factoryDeps, address refundRecipient) _request) returns (bytes32 canonicalTxHash)`
- `bridgehubRequestL2TransactionOnGateway(bytes32 _canonicalTxHash, uint64 _expirationTimestamp)`
- `changeFeeParams((uint8 pubdataPricingMode, uint32 batchOverheadL1Gas, uint32 maxPubdataPerBatch, uint32 maxL2GasPerBatch, uint32 priorityTxMaxPubdata, uint64 minimalL2GasPrice) _newFeeParams)`
- `commitBatchesSharedBridge(address, uint256 _processFrom, uint256 _processTo, bytes _commitData)`
- `executeBatchesSharedBridge(address, uint256 _processFrom, uint256 _processTo, bytes _executeData)`
- `executeUpgrade(((address facet, uint8 action, bool isFreezable, bytes4[] selectors)[] facetCuts, address initAddress, bytes initCalldata) _diamondCut)`
- `facetAddress(bytes4 _selector) view returns (address)`
- `facetAddresses() view returns (address[])`
- `facetFunctionSelectors(address _facet) view returns (bytes4[])`
- `facets() view returns ((address addr, bytes4[] selectors)[] result)`
- `finalizeEthWithdrawal(uint256 _l2BatchNumber, uint256 _l2MessageIndex, uint16 _l2TxNumberInBatch, bytes _message, bytes32[] _merkleProof)`
- `forwardedBridgeBurn(address _settlementLayer, address _originalCaller, bytes _data) payable returns (bytes chainBridgeMintData)`
- `forwardedBridgeMint(bytes _data, bool _contractAlreadyDeployed) payable`
- `forwardedBridgeRecoverFailedTransfer(uint256, bytes32, address, bytes _chainData) payable`
- `freezeDiamond()`
- `genesisUpgrade(address _l1GenesisUpgrade, address _ctmDeployer, bytes _forceDeploymentData, bytes[] _factoryDeps)`
- `getAdmin() view returns (address)`
- `getBaseToken() view returns (address)`
- `getBaseTokenAssetId() view returns (bytes32)`
- `getBridgehub() view returns (address)`
- `getChainId() view returns (uint256)`
- `getChainTypeManager() view returns (address)`
- `getDAValidatorPair() view returns (address, address)`
- `getFirstUnprocessedPriorityTx() view returns (uint256)`
- `getL2BootloaderBytecodeHash() view returns (bytes32)`
- `getL2DefaultAccountBytecodeHash() view returns (bytes32)`
- `getL2EvmEmulatorBytecodeHash() view returns (bytes32)`
- `getL2SystemContractsUpgradeBatchNumber() view returns (uint256)`
- `getL2SystemContractsUpgradeBlockNumber() view returns (uint256)`
- `getL2SystemContractsUpgradeTxHash() view returns (bytes32)`
- `getPendingAdmin() view returns (address)`
- `getPriorityQueueSize() view returns (uint256)`
- `getPriorityTreeRoot() view returns (bytes32)`
- `getPriorityTreeStartIndex() view returns (uint256)`
- `getPriorityTxMaxGasLimit() view returns (uint256)`
- `getProtocolVersion() view returns (uint256)`
- `getPubdataPricingMode() view returns (uint8)`
- `getRollupDAManager() view returns (address)`
- `getSemverProtocolVersion() view returns (uint32, uint32, uint32)`
- `getSettlementLayer() view returns (address)`
- `getTotalBatchesCommitted() view returns (uint256)`
- `getTotalBatchesExecuted() view returns (uint256)`
- `getTotalBatchesVerified() view returns (uint256)`
- `getTotalBlocksCommitted() view returns (uint256)`
- `getTotalBlocksExecuted() view returns (uint256)`
- `getTotalBlocksVerified() view returns (uint256)`
- `getTotalPriorityTxs() view returns (uint256)`
- `getTransactionFilterer() view returns (address)`
- `getVerifier() view returns (address)`
- `getVerifierParams() view returns ((bytes32 recursionNodeLevelVkHash, bytes32 recursionLeafLevelVkHash, bytes32 recursionCircuitsSetVksHash))`
- `isDiamondStorageFrozen() view returns (bool)`
- `isEthWithdrawalFinalized(uint256 _l2BatchNumber, uint256 _l2MessageIndex) view returns (bool)`
- `isFacetFreezable(address _facet) view returns (bool isFreezable)`
- `isFunctionFreezable(bytes4 _selector) view returns (bool)`
- `isPriorityQueueActive() view returns (bool)`
- `isValidator(address _address) view returns (bool)`
- `l2LogsRootHash(uint256 _batchNumber) view returns (bytes32)`
- `l2TransactionBaseCost(uint256 _gasPrice, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit) view returns (uint256)`
- `makePermanentRollup()`
- `precommitSharedBridge(address, uint256 _batchNumber, bytes _precommitData)`
- `prepareChainCommitment() view returns ((uint256 totalBatchesExecuted, uint256 totalBatchesVerified, uint256 totalBatchesCommitted, bytes32 l2SystemContractsUpgradeTxHash, uint256 l2SystemContractsUpgradeBatchNumber, bytes32[] batchHashes, (uint256 nextLeafIndex, uint256 startIndex, uint256 unprocessedIndex, bytes32[] sides) priorityTree, bool isPermanentRollup, bytes32 precommitmentForTheLatestBatch) commitment)`
- `proveBatchesSharedBridge(address, uint256 _processBatchFrom, uint256 _processBatchTo, bytes _proofData)`
- `proveL1ToL2TransactionStatus(bytes32 _l2TxHash, uint256 _l2BatchNumber, uint256 _l2MessageIndex, uint16 _l2TxNumberInBatch, bytes32[] _merkleProof, uint8 _status) view returns (bool)`
- `proveL2LeafInclusion(uint256 _batchNumber, uint256 _leafProofMask, bytes32 _leaf, bytes32[] _proof) view returns (bool)`
- `proveL2LeafInclusionShared(uint256 _chainId, uint256 _blockOrBatchNumber, uint256 _leafProofMask, bytes32 _leaf, bytes32[] _proof) view returns (bool)`
- `proveL2LogInclusion(uint256 _batchNumber, uint256 _index, (uint8 l2ShardId, bool isService, uint16 txNumberInBatch, address sender, bytes32 key, bytes32 value) _log, bytes32[] _proof) view returns (bool)`
- `proveL2LogInclusionShared(uint256 _chainId, uint256 _blockOrBatchNumber, uint256 _index, (uint8 l2ShardId, bool isService, uint16 txNumberInBatch, address sender, bytes32 key, bytes32 value) _log, bytes32[] _proof) view returns (bool)`
- `proveL2MessageInclusion(uint256 _batchNumber, uint256 _index, (uint16 txNumberInBatch, address sender, bytes data) _message, bytes32[] _proof) view returns (bool)`
- `proveL2MessageInclusionShared(uint256 _chainId, uint256 _blockOrBatchNumber, uint256 _index, (uint16 txNumberInBatch, address sender, bytes data) _message, bytes32[] _proof) view returns (bool)`
- `requestL2ServiceTransaction(address _contractL2, bytes _l2Calldata) returns (bytes32 canonicalTxHash)`
- `requestL2Transaction(address _contractL2, uint256 _l2Value, bytes _calldata, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit, bytes[] _factoryDeps, address _refundRecipient) payable returns (bytes32 canonicalTxHash)`
- `requestL2TransactionToGatewayMailbox(uint256 _chainId, bytes32 _canonicalTxHash, uint64 _expirationTimestamp) returns (bytes32 canonicalTxHash)`
- `revertBatchesSharedBridge(address, uint256 _newLastBatch)`
- `setDAValidatorPair(address _l1DAValidator, address _l2DAValidator)`
- `setPendingAdmin(address _newPendingAdmin)`
- `setPorterAvailability(bool _zkPorterIsAvailable)`
- `setPriorityTxMaxGasLimit(uint256 _newPriorityTxMaxGasLimit)`
- `setPubdataPricingMode(uint8 _pricingMode)`
- `setTokenMultiplier(uint128 _nominator, uint128 _denominator)`
- `setTransactionFilterer(address _transactionFilterer)`
- `setValidator(address _validator, bool _active)`
- `storedBatchHash(uint256 _batchNumber) view returns (bytes32)`
- `storedBlockHash(uint256 _batchNumber) view returns (bytes32)`
- `unfreezeDiamond()`
- `upgradeChainFromVersion(uint256 _oldProtocolVersion, ((address facet, uint8 action, bool isFreezable, bytes4[] selectors)[] facetCuts, address initAddress, bytes initCalldata) _diamondCut)`

Left out of this ABI, though its deployments declare them:

- `error CantExecuteUnprovenBatches` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransactionNotAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BridgeMint` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `getName` taking `()`: no captured deployment dispatches it.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
