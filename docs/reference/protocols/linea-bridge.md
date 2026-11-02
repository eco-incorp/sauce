<!-- Generated from the SDK's registries. Do not edit. -->

# Linea Native Bridge (`linea-bridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Linea Native Bridge is a bridge: it moves tokens from one chain to another. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Official Linea zkEVM bridge via L1MessageService. Deposits ETH from Ethereum to Linea with ZK proof-based finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `LineaBridge` on ethereum, linea |
| Chains | ethereum, linea |

## Notes

- **L1 to L2** via L1MessageService. L2 to L1 via L2MessageService on Linea
- `sendMessage` is a general-purpose L1-to-L2 message sender -- ETH transfer is implicit via msg.value
- The `_fee` parameter incentivizes postmen (relayers) to deliver the message. Set to 0 and self-claim via `claimMessage`
- `_calldata` enables arbitrary contract execution on L2 when the message is delivered
- zkEVM architecture -- finality with ZK proofs (typically 8-32 hours for proof generation)
- L2 to L1 withdrawals also require ZK proof finalization
- For ERC-20 bridging, use the Linea Token Bridge contracts (separate from the message service)
- Canonical bridge, secured by Linea's ZK proving system (Consensys)
- Audited

## Its names in a program

On Ethereum, `LineaBridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's l1MessageService, `0xd19d4B5d358258f05D7B411E21A1460D11B0876F`.
  require(LineaBridge.L1MessageService != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | l1MessageService | `0xd19d4B5d358258f05D7B411E21A1460D11B0876F` | `LineaBridge.L1MessageService` |
| [Linea](../chains/linea.md) | l2MessageService | `0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec` | `LineaBridge.L2MessageService` |

## ABI

### `LineaL1MessageServiceABI`

`import LineaL1MessageServiceABI from "./protocols/linea-bridge/LineaL1MessageServiceABI.json";` Speaks for: l1MessageService. The import is the contract's full ABI across every deployment; call it through the `LineaBridge` namespace to have a function a chain's deployment does not run refused.

- `addressFilter() view returns (address)`
- `blobShnarfExists(bytes32 _shnarf) view returns (uint256 shnarfExists)`
- `claimMessage(address _from, address _to, uint256 _fee, uint256 _value, address _feeRecipient, bytes _calldata, uint256 _nonce)`
- `claimMessageWithProof((bytes32[] proof, uint256 messageNumber, uint32 leafIndex, address from, address to, uint256 fee, uint256 value, address feeRecipient, bytes32 merkleRoot, bytes data) _params)`
- `claimMessageWithProofAndWithdrawLST((bytes32[] proof, uint256 messageNumber, uint32 leafIndex, address from, address to, uint256 fee, uint256 value, address feeRecipient, bytes32 merkleRoot, bytes data) _params, address _yieldProvider)`
- `CONTRACT_VERSION() view returns (string contractVersion)`
- `COOLDOWN_DURATION() view returns (uint256)`
- `currentFinalizedShnarf() view returns (bytes32)`
- `currentFinalizedState() view returns (bytes32)`
- `currentL2BlockNumber() view returns (uint256)`
- `currentPeriodAmountInWei() view returns (uint256)`
- `currentPeriodEnd() view returns (uint256)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `finalizeBlocks(bytes _aggregatedProof, uint256 _proofType, (bytes32 parentStateRootHash, uint256 endBlockNumber, (bytes32 parentShnarf, bytes32 snarkHash, bytes32 finalStateRootHash, bytes32 dataEvaluationPoint, bytes32 dataEvaluationClaim) shnarfData, uint256 lastFinalizedTimestamp, uint256 finalTimestamp, bytes32 lastFinalizedL1RollingHash, bytes32 l1RollingHash, uint256 lastFinalizedL1RollingHashMessageNumber, uint256 l1RollingHashMessageNumber, uint256 l2MerkleTreesDepth, uint256 lastFinalizedForcedTransactionNumber, uint256 finalForcedTransactionNumber, bytes32 lastFinalizedForcedTransactionRollingHash, bytes32[] l2MerkleRoots, address[] filteredAddresses, bytes l2MessagingBlocksOffsets) _finalizationData)`
- `FORCED_TRANSACTION_FEE_SETTER_ROLE() view returns (bytes32)`
- `FORCED_TRANSACTION_SENDER_ROLE() view returns (bytes32)`
- `forcedTransactionFeeInWei() view returns (uint256)`
- `forcedTransactionL2BlockNumbers(uint256 forcedTransactionNumber) view returns (uint256 l2BlockNumber)`
- `forcedTransactionRollingHashes(uint256 forcedTransactionNumber) view returns (bytes32 rollingHash)`
- `fund() payable`
- `getRequiredForcedTransactionFields() view returns (bytes32 finalizedState, bytes32 previousForcedTransactionRollingHash, uint256 previousForcedTransactionBlockDeadline, uint256 currentFinalizedL2BlockNumber, uint256 forcedTransactionFeeAmount)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `INBOX_STATUS_RECEIVED() view returns (uint8)`
- `INBOX_STATUS_UNKNOWN() view returns (uint8)`
- `inboxL2L1MessageStatus(bytes32 messageHash) view returns (uint256 messageStatus)`
- `initialize((bytes32 initialStateRootHash, uint256 initialL2BlockNumber, uint256 genesisTimestamp, address defaultVerifier, uint256 rateLimitPeriodInSeconds, uint256 rateLimitAmountInWei, (address addressWithRole, bytes32 role)[] roleAddresses, (uint8 pauseType, bytes32 role)[] pauseTypeRoles, (uint8 pauseType, bytes32 role)[] unpauseTypeRoles, address defaultAdmin, address shnarfProvider, address addressFilter) _initializationData, address _livenessRecoveryOperator, address _yieldManager)`
- `isMessageClaimed(uint256 _messageNumber) view returns (bool isClaimed)`
- `isPaused(uint8 _pauseType) view returns (bool pauseTypeIsPaused)`
- `isWithdrawLSTAllowed() view returns (bool)`
- `l2MerkleRootsDepths(bytes32 merkleRoot) view returns (uint256 treeDepth)`
- `limitInWei() view returns (uint256)`
- `livenessRecoveryOperator() view returns (address)`
- `nextForcedTransactionNumber() view returns (uint256)`
- `nextMessageNumber() view returns (uint256)`
- `nonSecurityCouncilCooldownEnd() view returns (uint256)`
- `OPERATOR_ROLE() view returns (bytes32)`
- `OUTBOX_STATUS_RECEIVED() view returns (uint8)`
- `OUTBOX_STATUS_SENT() view returns (uint8)`
- `OUTBOX_STATUS_UNKNOWN() view returns (uint8)`
- `outboxL1L2MessageStatus(bytes32 messageHash) view returns (uint256 messageStatus)`
- `PAUSE_ALL_ROLE() view returns (bytes32)`
- `PAUSE_DURATION() view returns (uint256)`
- `PAUSE_FINALIZATION_ROLE() view returns (bytes32)`
- `PAUSE_L1_L2_ROLE() view returns (bytes32)`
- `PAUSE_L2_L1_ROLE() view returns (bytes32)`
- `PAUSE_NATIVE_YIELD_STAKING_ROLE() view returns (bytes32)`
- `PAUSE_STATE_DATA_SUBMISSION_ROLE() view returns (bytes32)`
- `pauseByType(uint8 _pauseType)`
- `pauseTypeExpiryTimestamps(uint8 pauseType) view returns (uint256 expiryTimestamp)`
- `periodInSeconds() view returns (uint256)`
- `RATE_LIMIT_SETTER_ROLE() view returns (bytes32)`
- `reinitializeLineaRollupV9(uint256 _forcedTransactionFeeInWei, address _addressFilter)`
- `renounceRole(bytes32 _role, address _account)`
- `reportNativeYield(uint256 _amount, address _l2YieldRecipient)`
- `resetAmountUsedInPeriod()`
- `resetNonSecurityCouncilCooldownEnd()`
- `resetRateLimitAmount(uint256 _amount)`
- `revokeRole(bytes32 role, address account)`
- `rollingHashes(uint256 messageNumber) view returns (bytes32 rollingHash)`
- `SECURITY_COUNCIL_ROLE() view returns (bytes32)`
- `sender() view returns (address originalSender)`
- `sendMessage(address _to, uint256 _fee, bytes _calldata) payable`
- `SET_ADDRESS_FILTER_ROLE() view returns (bytes32)`
- `SET_YIELD_MANAGER_ROLE() view returns (bytes32)`
- `setAddressFilter(address _addressFilter)`
- `setForcedTransactionFee(uint256 _forcedTransactionFeeInWei)`
- `setLivenessRecoveryOperator(uint256 _messageNumber, bytes32 _rollingHash, uint256 _lastFinalizedForcedTransactionNumber, bytes32 _lastFinalizedForcedTransactionRollingHash, uint256 _lastFinalizedTimestamp)`
- `setVerifierAddress(address _newVerifierAddress, uint256 _proofType)`
- `setYieldManager(address _newYieldManager)`
- `shnarfProvider() view returns (address)`
- `stateRootHashes(uint256 blockNumber) view returns (bytes32 stateRootHash)`
- `storeForcedTransaction(bytes32 _forcedTransactionRollingHash, address _from, uint256 _blockNumberDeadline, bytes _rlpEncodedSignedTransaction) payable`
- `submitBlobs((uint256 dataEvaluationClaim, bytes kzgCommitment, bytes kzgProof, bytes32 finalStateRootHash, bytes32 snarkHash)[] _blobSubmissions, bytes32 _parentShnarf, bytes32 _finalBlobShnarf)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `systemMigrationBlock() view returns (uint256)`
- `transferFundsForNativeYield(uint256 _amount)`
- `UNPAUSE_ALL_ROLE() view returns (bytes32)`
- `UNPAUSE_FINALIZATION_ROLE() view returns (bytes32)`
- `UNPAUSE_L1_L2_ROLE() view returns (bytes32)`
- `UNPAUSE_L2_L1_ROLE() view returns (bytes32)`
- `UNPAUSE_NATIVE_YIELD_STAKING_ROLE() view returns (bytes32)`
- `UNPAUSE_STATE_DATA_SUBMISSION_ROLE() view returns (bytes32)`
- `unPauseByExpiredType(uint8 _pauseType)`
- `unPauseByType(uint8 _pauseType)`
- `unsetVerifierAddress(uint256 _proofType)`
- `updatePauseTypeRole(uint8 _pauseType, bytes32 _newRole)`
- `updateUnpauseTypeRole(uint8 _pauseType, bytes32 _newRole)`
- `USED_RATE_LIMIT_RESETTER_ROLE() view returns (bytes32)`
- `VERIFIER_SETTER_ROLE() view returns (bytes32)`
- `VERIFIER_UNSETTER_ROLE() view returns (bytes32)`
- `verifiers(uint256 proofType) view returns (address verifierAddress)`
- `YIELD_PROVIDER_STAKING_ROLE() view returns (bytes32)`
- `yieldManager() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `error BytesLengthNotMultipleOfTwo` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FeePaymentFailed` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FeeTooLow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FinalBlockStateEqualsZeroHash` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FinalizationDataMissingForcedTransaction` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FinalizationInTheFuture` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FinalStateRootHashIsZeroHash` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ForcedTransactionExistsForBlockOrIsTooLow` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InitializedVersionWrong` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMerkleProof` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IsNotPaused` taking `(uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IsPaused` taking `(uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error L1RollingHashDoesNotExistOnL1` taking `(uint256,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LSTWithdrawalRequiresDeficit` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MessageAlreadyClaimed` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MissingMessageNumberForRollingHash` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MissingRollingHashForForcedTransactionNumber` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MissingRollingHashForMessageNumber` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlySecurityCouncilCanUnpauseIndefinitePause` taking `(uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ParentShnarfNotSubmitted` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PauseUnavailableDueToCooldown` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SafeCastOverflowedUintDowncast` taking `(uint8,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ShnarfAlreadySubmitted` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ShnarfSubmissionIsZeroHash` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StartingRootHashDoesNotMatch` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ValueSentTooLow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ZeroAddressNotAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ZeroValueNotAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
