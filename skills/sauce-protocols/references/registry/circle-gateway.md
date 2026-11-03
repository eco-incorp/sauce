<!-- Generated from the SDK's registries. Do not edit. -->

# Circle Gateway (`circle-gateway`)

Circle's chain-abstracted USDC balance. Deposit USDC into the GatewayWallet on one chain, then mint it on another through the GatewayMinter with a Circle-signed attestation.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `CircleGateway` on ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, sonic, sei, arc, base, arbitrum, avalanche, base-sepolia, arc-testnet, sepolia |
| Document | [circle-gateway.md](../circle-gateway.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CircleGateway` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gatewayMinter, `0x2222222d7164433c4C09B0b0D809a9b52C04C205`.
  require(CircleGateway.GatewayMinter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Unichain](../../../sauce-chains/references/unichain.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sonic](../../../sauce-chains/references/sonic.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Sei](../../../sauce-chains/references/sei.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arc](../../../sauce-chains/references/arc.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base](../../../sauce-chains/references/base.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Base](../../../sauce-chains/references/base.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayMinter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | `CircleGateway.GatewayMinter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | gatewayWallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | `CircleGateway.GatewayWallet` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | gatewayMinter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `CircleGateway.GatewayMinter` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | gatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `CircleGateway.GatewayWallet` |

## ABI

### `GatewayMinterABI`

`import GatewayMinterABI from "./protocols/circle-gateway/GatewayMinterABI.json";` Speaks for: gatewayMinter. The import is the contract's full ABI across every deployment; call it through the `CircleGateway` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `addAttestationSigner(address signer)`
- `addSupportedToken(address token)`
- `denylist(address addr)`
- `denylister() view returns (address)`
- `domain() view returns (uint32)`
- `gatewayMint(bytes attestationPayload, bytes signature)`
- `initialize(address pauser_, address denylister_, address[] supportedTokens_, uint32 domain_, address attestationSigner_, address[] tokenMintAuthorities_)`
- `isAttestationSigner(address signer) view returns (bool)`
- `isDenylisted(address addr) view returns (bool)`
- `isTokenSupported(address token) view returns (bool)`
- `isTransferSpecHashUsed(bytes32 transferSpecHash) view returns (bool)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pauser() view returns (address)`
- `pendingOwner() view returns (address)`
- `proxiableUUID() view returns (bytes32)`
- `removeAttestationSigner(address signer)`
- `renounceOwnership()`
- `tokenMintAuthority(address token) view returns (address)`
- `transferOwnership(address newOwner)`
- `unDenylist(address addr)`
- `unpause()`
- `updateDenylister(address newDenylister)`
- `updateMintAuthority(address token, address newMintAuthority)`
- `updatePauser(address newPauser)`
- `UPGRADE_INTERFACE_VERSION() view returns (string)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`

Left out of this ABI, though its deployments declare them:

- `error AccountDenylisted` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CursorOutOfBounds` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSAInvalidSignatureS` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAttestationDestinationContractAtIndex` taking `(uint32,address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferPayloadMagic` taking `(bytes4)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferSpecMagic` taking `(bytes4)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferSpecVersion` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchedLengthTokenAndTokenMintAuthorities` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInitializing` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OwnableInvalidOwner` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadDataTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadOverallLengthMismatch` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetElementHeaderTooShort` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetElementTooShort` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetOverallLengthMismatch` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferSpecHashUsed` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferSpecHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnauthorizedDenylister` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnsupportedToken` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnauthorizedCallContext` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnsupportedProxiableUUID` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `GatewayWalletABI`

`import GatewayWalletABI from "./protocols/circle-gateway/GatewayWalletABI.json";` Speaks for: gatewayWallet. The import is the contract's full ABI across every deployment; call it through the `CircleGateway` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `addBatchSigner(address signer)`
- `addBurnSigner(address signer)`
- `addContractSignatureSigner(address signer)`
- `addDelegate(address token, address delegate)`
- `addSupportedToken(address token)`
- `allowlistContractSigner(address contractAddr)`
- `availableBalance(address token, address depositor) view returns (uint256)`
- `balanceOf(address depositor, uint256 id) view returns (uint256 balance)`
- `balanceOfBatch(address[] depositors, uint256[] ids) view returns (uint256[] balances)`
- `contractSignersAllowlister() view returns (address)`
- `contractSignersDisallowlister() view returns (address)`
- `denylist(address addr)`
- `denylister() view returns (address)`
- `deposit(address token, uint256 value)`
- `depositFor(address token, address depositor, uint256 value)`
- `depositWithAuthorization(address token, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)`
- `depositWithAuthorization(address token, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`
- `depositWithPermit(address token, address owner, uint256 value, uint256 deadline, bytes signature)`
- `depositWithPermit(address token, address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `disallowContractSigner(address contractAddr)`
- `domain() view returns (uint32)`
- `domainSeparator() pure returns (bytes32)`
- `EIP712_DOMAIN_TYPE_HASH() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `feeRecipient() view returns (address)`
- `gatewayBurn(bytes calldataBytes, bytes signature)`
- `getTypedDataHash(bytes intent) view returns (bytes32)`
- `initialize((address pauser, address denylister, address[] supportedTokens, uint32 domain, uint256 withdrawalDelay, address burnSigner, address feeRecipient, address contractSignersAllowlister, address contractSignersDisallowlister, address contractSignatureSigner, address batchSigner) config)`
- `initiateWithdrawal(address token, uint256 value)`
- `isAllowlistedContractSigner(address contractAddr) view returns (bool)`
- `isAuthorizedForBalance(address token, address depositor, address addr) view returns (bool)`
- `isBatchSigner(address signer) view returns (bool)`
- `isBurnSigner(address signer) view returns (bool)`
- `isContractSignatureSigner(address signer) view returns (bool)`
- `isDenylisted(address addr) view returns (bool)`
- `isTokenSupported(address token) view returns (bool)`
- `isTransferSpecHashUsed(bytes32 transferSpecHash) view returns (bool)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `pauser() view returns (address)`
- `pendingOwner() view returns (address)`
- `proxiableUUID() view returns (bytes32)`
- `removeBatchSigner(address signer)`
- `removeBurnSigner(address signer)`
- `removeContractSignatureSigner(address signer)`
- `removeDelegate(address token, address delegate)`
- `renounceOwnership() view`
- `submitBatch(bytes calldataBytes, bytes signature)`
- `totalBalance(address token, address depositor) view returns (uint256)`
- `transferOwnership(address newOwner)`
- `unDenylist(address addr)`
- `unpause()`
- `updateContractSignersAllowlister(address newAllowlister)`
- `updateContractSignersDisallowlister(address newDisallowlister)`
- `updateDenylister(address newDenylister)`
- `updateFeeRecipient(address newFeeRecipient)`
- `updatePauser(address newPauser)`
- `updateWithdrawalDelay(uint256 newDelay)`
- `UPGRADE_INTERFACE_VERSION() view returns (string)`
- `upgradeToAndCall(address newImplementation, bytes data) payable`
- `withdraw(address token)`
- `withdrawableBalance(address token, address depositor) view returns (uint256)`
- `withdrawalBlock(address token, address depositor) view returns (uint256)`
- `withdrawalDelay() view returns (uint256)`
- `withdrawingBalance(address token, address depositor) view returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `error AccountDenylisted` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BatchIdUsed` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BurnFeeTooHighAtIndex` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CannotDelegateToSelf` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CursorOutOfBounds` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DepositorIsBlacklisted` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ECDSAInvalidSignatureS` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IntentExpiredAtIndex` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IntentValueMustBePositiveAtIndex` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidIntentSourceSignerAtIndex` taking `(uint32,address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferPayloadMagic` taking `(bytes4)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferSpecMagic` taking `(bytes4)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidTransferSpecVersion` taking `(uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchedBurn` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MustHaveAtLeastOneBurnIntent` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MustHaveAtLeastOneDelta` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MustNetToZero` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotAllSameToken` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInitializing` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OwnableInvalidOwner` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadDataTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadOverallLengthMismatch` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetElementHeaderTooShort` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetElementTooShort` taking `(uint32,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferPayloadSetOverallLengthMismatch` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferSpecHashUsed` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferSpecHeaderTooShort` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferSpecInvalidHookData` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnauthorizedContractSignerAllowlister` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnauthorizedContractSignerDisallowlister` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnauthorizedDenylister` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UnsupportedToken` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnauthorizedCallContext` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UUPSUnsupportedProxiableUUID` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalNotYetAvailable` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalValueMustBePositive` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongGatewayContract` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event EIP712DomainChanged` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
