<!-- Generated from the SDK's registries. Do not edit. -->

# Safe (`safe`)

The most trusted multi-signature smart contract wallet, securing billions in digital assets. Supports programmable account abstraction and modular security.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Safe` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |
| Document | [safe.md](../safe.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Safe` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's safeL2V130, `0x3E5c63644E683549055b9Be8653de26E0B4CD36E`.
  require(Safe.SafeL2V130 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141`; not on this deployment: `requiredTxGas` |
| [Optimism](../../../sauce-chains/references/optimism.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Polygon](../../../sauce-chains/references/polygon.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../../../sauce-chains/references/arc.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../../../sauce-chains/references/arc.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141`; not on this deployment: `requiredTxGas` |
| [Base](../../../sauce-chains/references/base.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |

## ABI

### `SafeABI`

`import SafeABI from "./protocols/safe/SafeABI.json";` Speaks for: safeV141, safeL2V130.

- `addOwnerWithThreshold(address owner, uint256 _threshold)`
- `approvedHashes(address, bytes32) view returns (uint256)`
- `approveHash(bytes32 hashToApprove)`
- `changeThreshold(uint256 _threshold)`
- `checkNSignatures(bytes32 dataHash, bytes data, bytes signatures, uint256 requiredSignatures) view`
- `checkSignatures(bytes32 dataHash, bytes data, bytes signatures) view`
- `disableModule(address prevModule, address module)`
- `domainSeparator() view returns (bytes32)`
- `enableModule(address module)`
- `encodeTransactionData(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes)`
- `execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)`
- `execTransactionFromModule(address to, uint256 value, bytes data, uint8 operation) returns (bool success)`
- `execTransactionFromModuleReturnData(address to, uint256 value, bytes data, uint8 operation) returns (bool success, bytes returnData)`
- `getChainId() view returns (uint256)`
- `getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)`
- `getOwners() view returns (address[])`
- `getStorageAt(uint256 offset, uint256 length) view returns (bytes)`
- `getThreshold() view returns (uint256)`
- `getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)`
- `isModuleEnabled(address module) view returns (bool)`
- `isOwner(address owner) view returns (bool)`
- `nonce() view returns (uint256)`
- `removeOwner(address prevOwner, address owner, uint256 _threshold)`
- `requiredTxGas(address to, uint256 value, bytes data, uint8 operation) returns (uint256)`
- `setFallbackHandler(address handler)`
- `setGuard(address guard)`
- `setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)`
- `signedMessages(bytes32) view returns (uint256)`
- `simulateAndRevert(address targetContract, bytes calldataPayload)`
- `swapOwner(address prevOwner, address oldOwner, address newOwner)`
- `VERSION() view returns (string)`

Not on Ethereum's safeV141 (`0x41675C099F32341bf84BFc5382aF534df5C7461a`), whose code does not dispatch them or declares them otherwise: `requiredTxGas`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arc's safeV141 (`0x41675C099F32341bf84BFc5382aF534df5C7461a`), whose code does not dispatch them or declares them otherwise: `requiredTxGas`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `event AddedOwner` taking `(address)`: its deployments declare it with different indexed parameters.
- `event ChangedFallbackHandler` taking `(address)`: its deployments declare it with different indexed parameters.
- `event ChangedGuard` taking `(address)`: its deployments declare it with different indexed parameters.
- `event DisabledModule` taking `(address)`: its deployments declare it with different indexed parameters.
- `event EnabledModule` taking `(address)`: its deployments declare it with different indexed parameters.
- `event ExecutionFailure` taking `(bytes32,uint256)`: its deployments declare it with different indexed parameters.
- `event ExecutionSuccess` taking `(bytes32,uint256)`: its deployments declare it with different indexed parameters.
- `event RemovedOwner` taking `(address)`: its deployments declare it with different indexed parameters.
