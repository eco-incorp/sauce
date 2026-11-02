<!-- Generated from the SDK's registries. Do not edit. -->

# deBridge (`debridge`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> deBridge is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Cross-chain trading infrastructure with DLN (DeBridge Liquidity Network). Supports limit orders and market makers for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Debridge` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |

## Notes

- Order-based architecture: users create orders specifying desired outcome, market makers compete to fill
- Uses EVM chain IDs for destination (unlike LayerZero/Wormhole which use their own IDs)
- Same DlnSource and DlnDestination addresses deployed across all supported chains
- `takeAmount` should be set slightly below market rate to incentivize market makers
- Supports cross-chain swaps natively (giveToken and takeToken can be different assets)
- `externalCall` enables arbitrary contract execution on destination after the fill
- Finality: typically 1-5 minutes (market maker fills immediately, then settles asynchronously)
- Requires ERC-20 approval to DlnSource for the give token
- TVL: $200M+. Audited
- On Arc (5042) the DLN `globalFixedNativeFee()` is `1000000000000000000` wei, which is 1 USDC: Arc's native coin is USDC at 18 decimals, paid from the same balance as the USDC ERC-20 `0x3600…0000` (read 2026-09-28)

## Its names in a program

On Ethereum, `Debridge` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's dlnDestination, `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f`.
  require(Debridge.DlnDestination != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Ethereum](../chains/ethereum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Optimism](../chains/optimism.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Optimism](../chains/optimism.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [BNB Chain](../chains/bsc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [BNB Chain](../chains/bsc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Polygon](../chains/polygon.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Polygon](../chains/polygon.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Arc](../chains/arc.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Arc](../chains/arc.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Base](../chains/base.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Base](../chains/base.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Arbitrum One](../chains/arbitrum.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Arbitrum One](../chains/arbitrum.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |
| [Avalanche C-Chain](../chains/avalanche.md) | dlnDestination | `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` | `Debridge.DlnDestination` |
| [Avalanche C-Chain](../chains/avalanche.md) | dlnSource | `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` | `Debridge.DlnSource` |

## ABI

### `DlnDestinationABI`

`import DlnDestinationABI from "./protocols/debridge/DlnDestinationABI.json";` Speaks for: dlnDestination. The import is the contract's full ABI across every deployment; call it through the `Debridge` namespace to have a function a chain's deployment does not run refused.

- `BPS_DENOMINATOR() view returns (uint256)`
- `chainEngines(uint256) view returns (uint8)`
- `deBridgeGate() view returns (address)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `dlnSourceAddresses(uint256) view returns (bytes)`
- `EVM_ADDRESS_LENGTH() view returns (uint256)`
- `externalCallAdapter() view returns (address)`
- `fulfillOrder((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority) payable`
- `fulfillOrder((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority, address _externalCallRewardBeneficiary) payable`
- `getChainId() view returns (uint256 cid)`
- `getOrderId((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order) pure returns (bytes32)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `GOVERNANCE_DELEGATED_ORDER_CANCEL_ROLE() view returns (bytes32)`
- `GOVMONITORING_ROLE() view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize()`
- `MAX_ADDRESS_LENGTH() view returns (uint256)`
- `maxOrderCountPerBatchEvmUnlock() view returns (uint256)`
- `maxOrderCountPerBatchSolanaUnlock() view returns (uint256)`
- `NATIVE_AMOUNT_DIVIDER_FOR_TRANSFER_TO_SOLANA() view returns (uint256)`
- `pause()`
- `paused() view returns (bool)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `sendBatchEvmUnlock(bytes32[] _orderIds, address _beneficiary, uint256 _executionFee) payable`
- `sendBatchSolanaUnlock((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall)[] _orders, bytes32 _beneficiary, uint256 _executionFee, uint64 _initWalletIfNeededInstructionReward, uint64 _claimUnlockInstructionReward) payable`
- `sendEvmOrderCancel((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, address _cancelBeneficiary, uint256 _executionFee) payable`
- `sendEvmUnlock(bytes32 _orderId, address _beneficiary, uint256 _executionFee) payable`
- `sendSolanaOrderCancel((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, bytes32 _cancelBeneficiary, uint256 _executionFee, uint64 _initWalletIfNeededInstructionReward, uint64 _claimCancelInstructionReward) payable`
- `sendSolanaUnlock((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order, bytes32 _beneficiary, uint256 _executionFee, uint64 _initWalletIfNeededInstructionReward, uint64 _claimUnlockInstructionReward) payable`
- `setDlnSourceAddress(uint256 _chainIdFrom, bytes _dlnSourceAddress, uint8 _chainEngine)`
- `setExternalCallAdapter(address _externalCallAdapter)`
- `setMaxOrderCountsPerBatch(uint256 _newEvmCount, uint256 _newSolanaCount)`
- `SOLANA_ADDRESS_LENGTH() view returns (uint256)`
- `subscriptionId() view returns (uint32)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `takeOrders(bytes32) view returns (uint8 status, address takerAddress, uint32 giveChainId, uint256 bigGiveChainId)`
- `takePatches(bytes32) view returns (uint256)`
- `unpause()`
- `version() pure returns (string)`

Left out of this ABI, though its deployments declare them:

- `error AdminBadRole` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CallProxyBadRole` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NativeSenderBadRole` taking `(bytes,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotSupportedDstChain` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Unauthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnexpectedBatchSize` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnknownEngine` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ZeroAddress` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

On Base, no source could give the verified ABI of `0xe7351fd770a37282b91d153ee690b63579d6dd7f` when the registry was checked, so what it declares is kept from a check of 2026-10-27 that recorded only the functions, events and errors the registry declared then: this ABI may lack functions that deployment runs.

### `DlnSourceABI`

`import DlnSourceABI from "./protocols/debridge/DlnSourceABI.json";` Speaks for: dlnSource. The import is the contract's full ABI across every deployment; call it through the `Debridge` namespace to have a function a chain's deployment does not run refused.

- `BPS_DENOMINATOR() view returns (uint256)`
- `chainEngines(uint256) view returns (uint8)`
- `claimBatchCancel(bytes32[] _orderIds, address _beneficiary)`
- `claimBatchUnlock(bytes32[] _orderIds, address _beneficiary)`
- `claimCancel(bytes32 _orderId, address _beneficiary)`
- `claimUnlock(bytes32 _orderId, address _beneficiary)`
- `collectedFee(address) view returns (uint256)`
- `createOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope) payable returns (bytes32 orderId)`
- `createSaltedOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata) payable returns (bytes32)`
- `createSaltedOrderForIntent((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, uint64 _salt, uint32 _referralCode, uint256 _giveTokenFeeAmount, bytes _metadata) payable returns (bytes32)`
- `createSaltedOrderForIntent((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, address _maker, uint64 _salt, uint32 _referralCode, uint256 _giveTokenFeeAmount, bytes _metadata) payable returns (bytes32)`
- `deBridgeGate() view returns (address)`
- `DEFAULT_ADMIN_ROLE() view returns (bytes32)`
- `dlnDestinationAddresses(uint256) view returns (bytes)`
- `EVM_ADDRESS_LENGTH() view returns (uint256)`
- `FEE_COLLECTOR_ROLE() view returns (bytes32)`
- `getChainId() view returns (uint256 cid)`
- `getOrderId((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) _order) pure returns (bytes32)`
- `getRoleAdmin(bytes32 role) view returns (bytes32)`
- `giveOrders(bytes32) view returns (uint8 status, uint160 giveTokenAddress, uint88 nativeFixFee, uint48 takeChainId, uint208 percentFee, uint256 giveAmount, address affiliateBeneficiary, uint256 affiliateAmount)`
- `givePatches(bytes32) view returns (uint256)`
- `globalFixedNativeFee() view returns (uint88)`
- `globalTransferFeeBps() view returns (uint16)`
- `GOVMONITORING_ROLE() view returns (bytes32)`
- `grantRole(bytes32 role, address account)`
- `hasRole(bytes32 role, address account) view returns (bool)`
- `initialize(uint88 _globalFixedNativeFee, uint16 _globalTransferFeeBps)`
- `intentManager() view returns (address)`
- `intentManagerRights() view returns (address)`
- `masterNonce(address) view returns (uint256)`
- `MAX_ADDRESS_LENGTH() view returns (uint256)`
- `pause()`
- `paused() view returns (bool)`
- `renounceRole(bytes32 role, address account)`
- `revokeRole(bytes32 role, address account)`
- `setDlnDestinationAddress(uint256 _chainIdTo, bytes _dlnDestinationAddress, uint8 _chainEngine)`
- `SOLANA_ADDRESS_LENGTH() view returns (uint256)`
- `subscriptionId() view returns (uint32)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `unclaimedAffiliateETHFees(address) view returns (uint256)`
- `unclaimedERC20AffiliateFees(address, address) view returns (uint256)`
- `unexpectedOrderStatusForCancel(bytes32) view returns (address)`
- `unexpectedOrderStatusForClaim(bytes32) view returns (address)`
- `unpause()`
- `updateGlobalFee(uint88 _globalFixedNativeFee, uint16 _globalTransferFeeBps)`
- `validateCreationOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, address _signer) view returns ((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) order)`
- `validateCreationOrder((address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc) _orderCreation, address _signer, uint64 _salt) view returns ((uint64 makerOrderNonce, bytes makerSrc, uint256 giveChainId, bytes giveTokenAddress, uint256 giveAmount, uint256 takeChainId, bytes takeTokenAddress, uint256 takeAmount, bytes receiverDst, bytes givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes allowedCancelBeneficiarySrc, bytes externalCall) order)`
- `version() pure returns (string)`
- `withdrawCollectedFees(address[] _tokens)`
- `withdrawUnclaimedAffiliateFees(address[] _tokens, address _beneficiary)`

Left out of this ABI, though its deployments declare them:

- `error AdminBadRole` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IntentManagerBadRole` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchedOrderId` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Unauthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnknownEngine` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongChain` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RoleAdminChanged` taking `(bytes32,bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
