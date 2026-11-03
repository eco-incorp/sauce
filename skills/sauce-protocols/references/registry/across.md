<!-- Generated from the SDK's registries. Do not edit. -->

# Across (`across`)

Optimistic cross-chain bridge powered by UMA's optimistic oracle. Uses relayers for fast fills and canonical bridges for settlement.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Across` on ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| Chains | ethereum, optimism, polygon, zksync, arc, base, mode, arbitrum, linea, blast, scroll |
| Document | [across.md](../across.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Across` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's hubPool, `0xc186fA914353c44b2E33eBE05f21846F1048bEda`.
  require(Across.HubPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | hubPool | `0xc186fA914353c44b2E33eBE05f21846F1048bEda` | `Across.HubPool` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | spokePool | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `cctpTokenMessenger`, `cctpV2`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `polygonTokenBridger`, `processMessageFromRoot`, `recipientCircleDomainId`, `remoteL1Tokens`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `USDB`, `usdcToken`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | spokePool | `0x6f26Bf09B1C792e3228e5467807a900A503c0281` | `Across.SpokePool`; not on this deployment: `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | spokePool | `0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `remoteL1Tokens`, `renounceOwnership`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | spokePool | `0xE0B015E54d54fc84a6cB9B666099c46adE9335FF` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `fxChild`, `initialize`, `L1_USDB`, `l1Gas`, `L2_BLAST_BRIDGE`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT` |
| [Arc](../../../sauce-chains/references/arc.md) | spokePool | `0x9b4A302A548c7e313c2b74C461db7b84d3074A84` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Base](../../../sauce-chains/references/base.md) | spokePool | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `Across.SpokePool`; not on this deployment: `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Mode](../../../sauce-chains/references/mode.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool`; not on this deployment: `adapterExecuteAcrossV5`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | spokePool | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Linea](../../../sauce-chains/references/linea.md) | spokePool | `0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |
| [Blast](../../../sauce-chains/references/blast.md) | spokePool | `0x2D509190Ed0172ba588407D4c2df918F955Cc6E1` | `Across.SpokePool`; not on this deployment: `adapterExecuteAcrossV5`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `zkUSDCBridge` |
| [Scroll](../../../sauce-chains/references/scroll.md) | spokePool | `0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96` | `Across.SpokePool`; not on this deployment: `__OvmSpokePool_init`, `adapterExecuteAcrossV5`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `cctpTokenMessenger`, `cctpV2`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `recipientCircleDomainId`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `usdcToken`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `AcrossHubPoolABI`

`import AcrossHubPoolABI from "./protocols/across/AcrossHubPoolABI.json";` Speaks for: hubPool. The import is the contract's full ABI across every deployment; call it through the `Across` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity(address l1Token, uint256 l1TokenAmount) payable`
- `bondAmount() view returns (uint256)`
- `bondToken() view returns (address)`
- `claimProtocolFeesCaptured(address l1Token)`
- `crossChainContracts(uint256) view returns (address adapter, address spokePool)`
- `disableL1TokenForLiquidityProvision(address l1Token)`
- `disputeRootBundle()`
- `emergencyDeleteProposal()`
- `enableL1TokenForLiquidityProvision(address l1Token)`
- `exchangeRateCurrent(address l1Token) returns (uint256)`
- `executeRootBundle(uint256 chainId, uint256 groupIndex, uint256[] bundleLpFees, int256[] netSendAmounts, int256[] runningBalances, uint8 leafId, address[] l1Tokens, bytes32[] proof)`
- `finder() view returns (address)`
- `getCurrentTime() view returns (uint256)`
- `haircutReserves(address l1Token, int256 haircutAmount)`
- `identifier() view returns (bytes32)`
- `liquidityUtilizationCurrent(address l1Token) returns (uint256)`
- `liquidityUtilizationPostRelay(address l1Token, uint256 relayedAmount) returns (uint256)`
- `liveness() view returns (uint32)`
- `loadEthForL2Calls() payable`
- `lpFeeRatePerSecond() view returns (uint256)`
- `lpTokenFactory() view returns (address)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `owner() view returns (address)`
- `paused() view returns (bool)`
- `pooledTokens(address l1Token) view returns (address lpToken, bool isEnabled, uint32 lastLpFeeUpdate, int256 utilizedReserves, uint256 liquidReserves, uint256 undistributedLpFees)`: `lpToken` is a token
- `poolRebalanceRoute(uint256 destinationChainId, address l1Token) view returns (address destinationToken)`
- `proposeRootBundle(uint256[] bundleEvaluationBlockNumbers, uint8 poolRebalanceLeafCount, bytes32 poolRebalanceRoot, bytes32 relayerRefundRoot, bytes32 slowRelayRoot)`
- `protocolFeeCaptureAddress() view returns (address)`
- `protocolFeeCapturePct() view returns (uint256)`
- `relaySpokePoolAdminFunction(uint256 chainId, bytes functionData)`
- `removeLiquidity(address l1Token, uint256 lpTokenAmount, bool sendEth)`
- `renounceOwnership()`
- `rootBundleProposal() view returns (bytes32 poolRebalanceRoot, bytes32 relayerRefundRoot, bytes32 slowRelayRoot, uint256 claimedBitMap, address proposer, uint8 unclaimedPoolRebalanceLeafCount, uint32 challengePeriodEndTimestamp)`
- `setBond(address newBondToken, uint256 newBondAmount)`
- `setCrossChainContracts(uint256 l2ChainId, address adapter, address spokePool)`
- `setCurrentTime(uint256 time)`
- `setDepositRoute(uint256 originChainId, uint256 destinationChainId, address originToken, bool depositsEnabled)`
- `setIdentifier(bytes32 newIdentifier)`
- `setLiveness(uint32 newLiveness)`
- `setPaused(bool pause)`
- `setPoolRebalanceRoute(uint256 destinationChainId, address l1Token, address destinationToken)`
- `setProtocolFeeCapture(address newProtocolFeeCaptureAddress, uint256 newProtocolFeeCapturePct)`
- `sync(address l1Token)`
- `timerAddress() view returns (address)`
- `transferOwnership(address newOwner)`
- `unclaimedAccumulatedProtocolFees(address) view returns (uint256)`
- `weth() view returns (address)`

### `AcrossSpokePoolABI`

`import AcrossSpokePoolABI from "./protocols/across/AcrossSpokePoolABI.json";` Speaks for: spokePool. The import is the contract's full ABI across every deployment; call it through the `Across` namespace to have a function a chain's deployment does not run refused.

- `__OvmSpokePool_init(uint32 _initialDepositId, address _crossDomainAdmin, address _withdrawalRecipient, address _l2Eth)`
- `__SpokePool_init(uint32 _initialDepositId, address _crossDomainAdmin, address _withdrawalRecipient)`
- `adapterExecuteAcrossV5(bytes input, bytes jitData) payable`
- `BLAST_RETRIEVER() view returns (address)`
- `BLAST_YIELD_CONTRACT() view returns (address)`
- `cctpTokenMessenger() view returns (address)`
- `cctpV2() view returns (bool)`
- `chainId() view returns (uint256)`
- `claimRelayerRefund(bytes32 l2TokenAddress, bytes32 refundAddress)`
- `crossDomainAdmin() view returns (address)`
- `deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`
- `depositDeprecated_5947912356(address, address, uint256, uint256, int64, uint32, bytes, uint256) payable`
- `depositFor(address, address, address, uint256, uint256, int64, uint32, bytes, uint256) payable`
- `depositNow(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 fillDeadlineOffset, uint32 exclusivityParameter, bytes message) payable`
- `depositQuoteTimeBuffer() view returns (uint32)`
- `depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`
- `depositV3Now(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 fillDeadlineOffset, uint32 exclusivityParameter, bytes message) payable`
- `DEPRECATED_zkErc20Bridge() view returns (address)`
- `emergencyDeleteRootBundle(uint256 rootBundleId)`
- `EMPTY_MSG_BYTES() view returns (bytes)`
- `EMPTY_RELAYER() view returns (bytes32)`
- `EMPTY_REPAYMENT_CHAIN_ID() view returns (uint256)`
- `executeAcrossV5(bytes message, bytes executorMessage) payable`
- `executeExternalCall(bytes message) returns (bytes returnData)`
- `executeRelayerRefundLeaf(uint32 rootBundleId, (uint256 amountToReturn, uint256 chainId, uint256[] refundAmounts, uint32 leafId, address l2TokenAddress, address[] refundAddresses) relayerRefundLeaf, bytes32[] proof) payable`
- `executeSlowRelayLeaf(((bytes32 depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint256 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData, uint256 chainId, uint256 updatedOutputAmount) slowFillLeaf, uint32 rootBundleId, bytes32[] proof)`
- `fill(bytes32 orderId, bytes originData, bytes fillerData)`
- `fillDeadlineBuffer() view returns (uint32)`
- `fillRelay((bytes32 depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint256 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData, uint256 repaymentChainId, bytes32 repaymentAddress)`
- `fillRelayWithUpdatedDeposit((bytes32 depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint256 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData, uint256 repaymentChainId, bytes32 repaymentAddress, uint256 updatedOutputAmount, bytes32 updatedRecipient, bytes updatedMessage, bytes depositorSignature)`
- `fillStatuses(bytes32) view returns (uint256)`
- `fillV3Relay((address depositor, address recipient, address exclusiveRelayer, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint32 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData, uint256 repaymentChainId)`
- `fxChild() view returns (address)`
- `gateway() view returns (address)`
- `getCurrentTime() view returns (uint256)`
- `getRelayerRefund(address l2TokenAddress, address refundAddress) view returns (uint256)`
- `getUnsafeDepositId(address msgSender, bytes32 depositor, uint256 depositNonce) pure returns (uint256)`
- `getV3RelayHash((bytes32 depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint256 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData) view returns (bytes32)`
- `INFINITE_FILL_DEADLINE() view returns (uint32)`
- `initialize(uint32 _initialDepositId, address _withdrawalRecipient)`
- `initialize(uint32 _initialDepositId, address _crossDomainAdmin, address _withdrawalRecipient)`
- `initialize(uint32 _initialDepositId, address _l2GatewayRouter, address _crossDomainAdmin, address _withdrawalRecipient)`
- `initialize(uint32 _initialDepositId, address _polygonTokenBridger, address _crossDomainAdmin, address _withdrawalRecipient, address _fxChild)`
- `L1_USDB() view returns (address)`
- `l1ChainId() view returns (uint256)`
- `l1Gas() view returns (uint32)`
- `L2_ASSET_ROUTER_ADDR() view returns (address)`
- `L2_BLAST_BRIDGE() view returns (address)`
- `L2_NATIVE_TOKEN_VAULT_ADDR() view returns (address)`
- `l2AssetRouter() view returns (address)`
- `l2Eth() view returns (address)`
- `l2GatewayRouter() view returns (address)`
- `l2ScrollMessenger() view returns (address)`
- `MAX_EXCLUSIVITY_PERIOD_SECONDS() view returns (uint32)`
- `MAX_TRANSFER_SIZE() view returns (uint256)`
- `MESSENGER() view returns (address)`
- `multicall(bytes[] data) returns (bytes[] results)`
- `numberOfDeposits() view returns (uint32)`
- `OFT_DST_EID() view returns (uint32)`
- `OFT_FEE_CAP() view returns (uint256)`
- `oftMessengers(address l2TokenAddress) view returns (address l2OftMessenger)`
- `owner() view returns (address)`
- `pausedDeposits() view returns (bool)`
- `pauseDeposits(bool pause)`
- `pausedFills() view returns (bool)`
- `pauseFills(bool pause)`
- `polygonTokenBridger() view returns (address)`
- `processMessageFromRoot(uint256, address rootMessageSender, bytes data)`
- `proxiableUUID() view returns (bytes32)`
- `recipientCircleDomainId() view returns (uint32)`
- `relayerRefund(address, address) view returns (uint256)`
- `relayRootBundle(bytes32 relayerRefundRoot, bytes32 slowRelayRoot)`
- `remoteL1Tokens(address) view returns (address)`
- `renounceOwnership()`
- `requestSlowFill((bytes32 depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 originChainId, uint256 depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) relayData)`
- `rootBundles(uint256) view returns (bytes32 slowRelayRoot, bytes32 relayerRefundRoot)`
- `setCrossDomainAdmin(address newCrossDomainAdmin)`
- `setFxChild(address newFxChild)`
- `setL1GasLimit(uint32 newl1Gas)`
- `setL2GatewayRouter(address _l2GatewayRouter)`
- `setL2ScrollMessenger(address _l2ScrollMessenger)`
- `setOftMessenger(address token, address messenger)`
- `setPolygonTokenBridger(address newPolygonTokenBridger)`
- `setRemoteL1Token(address l2Token, address l1Token)`
- `setTokenBridge(address l2Token, address tokenBridge)`
- `setWithdrawalRecipient(address newWithdrawalRecipient)`
- `speedUpDeposit(bytes32 depositor, uint256 depositId, uint256 updatedOutputAmount, bytes32 updatedRecipient, bytes updatedMessage, bytes depositorSignature)`
- `speedUpV3Deposit(address depositor, uint256 depositId, uint256 updatedOutputAmount, address updatedRecipient, bytes updatedMessage, bytes depositorSignature)`
- `tokenBridges(address) view returns (address)`
- `transferOwnership(address newOwner)`
- `tryMulticall(bytes[] data) returns ((bool success, bytes returnData)[] results)`
- `unsafeDeposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint256 depositNonce, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable`
- `UPDATE_BYTES32_DEPOSIT_DETAILS_HASH() view returns (bytes32)`
- `upgradeTo(address newImplementation)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `USDB() view returns (address)`
- `usdcToken() view returns (address)`
- `V5_MAGIC_PREFIX() view returns (bytes32)`
- `whitelistedTokens(address) view returns (address)`
- `whitelistToken(address l2Token, address l1Token)`
- `withdrawalRecipient() view returns (address)`
- `wrap()`
- `wrappedNativeToken() view returns (address)`
- `YIELD_RECIPIENT() view returns (address)`
- `zkUSDCBridge() view returns (address)`

Not on Ethereum's spokePool (`0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `cctpTokenMessenger`, `cctpV2`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `polygonTokenBridger`, `processMessageFromRoot`, `recipientCircleDomainId`, `remoteL1Tokens`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `USDB`, `usdcToken`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Optimism's spokePool (`0x6f26Bf09B1C792e3228e5467807a900A503c0281`), whose code does not dispatch them or declares them otherwise: `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Optimism is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's spokePool (`0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `remoteL1Tokens`, `renounceOwnership`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on zkSync Era's spokePool (`0xE0B015E54d54fc84a6cB9B666099c46adE9335FF`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `fxChild`, `initialize`, `L1_USDB`, `l1Gas`, `L2_BLAST_BRIDGE`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`. Do not call them there: a program compiled for zkSync Era is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc's spokePool (`0x9b4A302A548c7e313c2b74C461db7b84d3074A84`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's spokePool (`0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64`), whose code does not dispatch them or declares them otherwise: `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Mode's spokePool (`0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96`), whose code does not dispatch them or declares them otherwise: `adapterExecuteAcrossV5`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `L1_USDB`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `USDB`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Mode is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's spokePool (`0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Linea's spokePool (`0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `DEPRECATED_zkErc20Bridge`, `fxChild`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `l2GatewayRouter`, `l2ScrollMessenger`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Linea is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Blast's spokePool (`0x2D509190Ed0172ba588407D4c2df918F955Cc6E1`), whose code does not dispatch them or declares them otherwise: `adapterExecuteAcrossV5`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `l1ChainId`, `L2_ASSET_ROUTER_ADDR`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2GatewayRouter`, `l2ScrollMessenger`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `renounceOwnership`, `setFxChild`, `setL2GatewayRouter`, `setL2ScrollMessenger`, `setPolygonTokenBridger`, `transferOwnership`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `zkUSDCBridge`. Do not call them there: a program compiled for Blast is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Scroll's spokePool (`0x3baD7AD0728f9917d1Bf08af5782dCbD516cDd96`), whose code does not dispatch them or declares them otherwise: `__OvmSpokePool_init`, `adapterExecuteAcrossV5`, `BLAST_RETRIEVER`, `BLAST_YIELD_CONTRACT`, `cctpTokenMessenger`, `cctpV2`, `DEPRECATED_zkErc20Bridge`, `executeAcrossV5`, `fxChild`, `gateway`, `initialize`, `L1_USDB`, `l1ChainId`, `l1Gas`, `L2_ASSET_ROUTER_ADDR`, `L2_BLAST_BRIDGE`, `L2_NATIVE_TOKEN_VAULT_ADDR`, `l2AssetRouter`, `l2Eth`, `MESSENGER`, `owner`, `polygonTokenBridger`, `processMessageFromRoot`, `recipientCircleDomainId`, `remoteL1Tokens`, `renounceOwnership`, `setFxChild`, `setL1GasLimit`, `setPolygonTokenBridger`, `setRemoteL1Token`, `setTokenBridge`, `tokenBridges`, `transferOwnership`, `USDB`, `usdcToken`, `V5_MAGIC_PREFIX`, `whitelistedTokens`, `whitelistToken`, `wrap`, `YIELD_RECIPIENT`, `zkUSDCBridge`. Do not call them there: a program compiled for Scroll is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error CallValidatedAlreadySet` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DisabledRoute` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidClaimedAmount` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPayoutAdjustmentPct` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotCrossChainCall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEOA` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotFxChild` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotHubPool` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OFTFeeUnderpaid` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OftIncorrectAmountReceivedLD` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OftIncorrectAmountSentLD` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OftLzFeeNotZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event AdminChanged` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event BeaconUpgraded` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EnabledDepositRoute` taking `(address,uint256,bool)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event FilledV3Relay` taking `(address,address,uint256,uint256,uint256,uint256,uint32,uint32,uint32,address,address,address,address,bytes,(address,bytes,uint256,uint8))`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RequestedSpeedUpV3Deposit` taking `(uint256,uint32,address,address,bytes,bytes)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RequestedV3SlowFill` taking `(address,address,uint256,uint256,uint256,uint32,uint32,uint32,address,address,address,bytes)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetZkBridge` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event V3FundsDeposited` taking `(address,address,uint256,uint256,uint256,uint32,uint32,uint32,uint32,address,address,address,bytes)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `initialize` taking `(address,address,uint32,address,address)`: an overload of initialize(uint32,address,address,address,address), which takes as many arguments: a call picks its overload by argument count.

On Base, no source could give the verified ABI of `0x09aea4b2242abc8bb4bb78d537a67a245a7bec64` when the registry was checked, so what it declares is kept from a check of 2026-10-27 that recorded only the functions, events and errors the registry declared then: this ABI may lack functions that deployment runs.
