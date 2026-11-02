<!-- Generated from the SDK's registries. Do not edit. -->

# Axelar (`axelar`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Axelar is a messenger between chains: it carries messages and tokens from one to another. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Universal cross-chain communication protocol with decentralized validator set. Supports GMP (General Message Passing) and ITS (Interchain Token Service).

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Axelar` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |

## Notes

- Uses chain name strings for destination (e.g. "ethereum", "arbitrum", "Polygon") -- NOT chain IDs
- `sendToken`: Simple token transfer. `callContract`: GMP message. `callContractWithToken`: Both
- GMP calls require pre-paying gas via GasService or including gasValue in ITS calls
- ITS (Interchain Token Service) enables native cross-chain tokens without wrapping
- Same ITS address (`0xB5FB...`) across all chains
- `tokenAddresses(symbol)` to look up the local address of an Axelar-supported token
- Finality: typically 2-5 minutes depending on source chain
- TVL: $800M+. Audited

## Its names in a program

On Ethereum, `Axelar` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's gasService, `0x2d5d7d31F671F86C782533cc367F14109a082712`.
  require(Axelar.GasService != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | gasService | `0x2d5d7d31F671F86C782533cc367F14109a082712` | `Axelar.GasService` |
| [Ethereum](../chains/ethereum.md) | gateway | `0x4F4495243837681061C4743b74B3eEdf548D56A5` | `Axelar.Gateway` |
| [Ethereum](../chains/ethereum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Optimism](../chains/optimism.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Optimism](../chains/optimism.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Polygon](../chains/polygon.md) | gateway | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` | `Axelar.Gateway` |
| [Polygon](../chains/polygon.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Base](../chains/base.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Base](../chains/base.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Arbitrum One](../chains/arbitrum.md) | gateway | `0xe432150cce91c13a887f7D836923d5597adD8E31` | `Axelar.Gateway` |
| [Arbitrum One](../chains/arbitrum.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |
| [Avalanche C-Chain](../chains/avalanche.md) | gateway | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` | `Axelar.Gateway` |
| [Avalanche C-Chain](../chains/avalanche.md) | its | `0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C` | `Axelar.ITS` |

## ABI

### `AxelarGasServiceABI`

`import AxelarGasServiceABI from "./protocols/axelar/AxelarGasServiceABI.json";` Speaks for: gasService.

- `acceptOwnership()`
- `addExpressGas(bytes32 txHash, uint256 logIndex, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `addGas(bytes32 txHash, uint256 logIndex, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `addNativeExpressGas(bytes32 txHash, uint256 logIndex, address refundAddress) payable`
- `addNativeGas(bytes32 txHash, uint256 logIndex, address refundAddress) payable`
- `collectFees(address receiver, address[] tokens, uint256[] amounts)`
- `contractId() pure returns (bytes32)`
- `estimateGasFee(string destinationChain, string, bytes payload, uint256 executionGasLimit, bytes) view returns (uint256 gasEstimate)`
- `gasCollector() view returns (address)`
- `getGasInfo(string chain) view returns ((uint64 gasEstimationType, uint64 l1FeeScalar, uint128 axelarBaseFee, uint128 relativeGasPrice, uint128 relativeBlobBaseFee, uint128 expressFee))`
- `implementation() view returns (address implementation_)`
- `owner() view returns (address owner_)`
- `payGas(address sender, string destinationChain, string destinationAddress, bytes payload, uint256 executionGasLimit, bool estimateOnChain, address refundAddress, bytes params) payable`
- `payGasForContractCall(address sender, string destinationChain, string destinationAddress, bytes payload, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `payGasForContractCallWithToken(address sender, string destinationChain, string destinationAddress, bytes payload, string symbol, uint256 amount, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `payGasForExpressCall(address sender, string destinationChain, string destinationAddress, bytes payload, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `payGasForExpressCallWithToken(address sender, string destinationChain, string destinationAddress, bytes payload, string symbol, uint256 amount, address gasToken, uint256 gasFeeAmount, address refundAddress)`
- `payNativeGasForContractCall(address sender, string destinationChain, string destinationAddress, bytes payload, address refundAddress) payable`
- `payNativeGasForContractCallWithToken(address sender, string destinationChain, string destinationAddress, bytes payload, string symbol, uint256 amount, address refundAddress) payable`
- `payNativeGasForExpressCall(address sender, string destinationChain, string destinationAddress, bytes payload, address refundAddress) payable`
- `payNativeGasForExpressCallWithToken(address sender, string destinationChain, string destinationAddress, bytes payload, string symbol, uint256 amount, address refundAddress) payable`
- `pendingOwner() view returns (address owner_)`
- `proposeOwnership(address newOwner)`
- `refund(address receiver, address token, uint256 amount)`
- `refund(bytes32 txHash, uint256 logIndex, address receiver, address token, uint256 amount)`
- `setup(bytes data)`
- `transferOwnership(address newOwner)`
- `updateGasInfo(string[] chains, (uint64 gasEstimationType, uint64 l1FeeScalar, uint128 axelarBaseFee, uint128 relativeGasPrice, uint128 relativeBlobBaseFee, uint128 expressFee)[] gasUpdates)`
- `upgrade(address newImplementation, bytes32 newImplementationCodeHash, bytes params)`

### `AxelarGatewayABI`

`import AxelarGatewayABI from "./protocols/axelar/AxelarGatewayABI.json";` Speaks for: gateway.

- `allTokensFrozen() pure returns (bool)`
- `approveContractCall(bytes params, bytes32 commandId)`
- `approveContractCallWithMint(bytes params, bytes32 commandId)`
- `authModule() view returns (address)`
- `burnToken(bytes params, bytes32)`
- `callContract(string destinationChain, string contractAddress, bytes payload)`
- `callContractWithToken(string destinationChain, string contractAddress, bytes payload, string symbol, uint256 amount)`
- `contractId() pure returns (bytes32)`
- `deployToken(bytes params, bytes32)`
- `execute(bytes input)`
- `getAddress(bytes32 key) view returns (address)`
- `getBool(bytes32 key) view returns (bool)`
- `getBytes(bytes32 key) view returns (bytes)`
- `getInt(bytes32 key) view returns (int256)`
- `getString(bytes32 key) view returns (string)`
- `getUint(bytes32 key) view returns (uint256)`
- `governance() view returns (address)`
- `implementation() view returns (address)`
- `isCommandExecuted(bytes32 commandId) view returns (bool)`
- `isContractCallAndMintApproved(bytes32 commandId, string sourceChain, string sourceAddress, address contractAddress, bytes32 payloadHash, string symbol, uint256 amount) view returns (bool)`
- `isContractCallApproved(bytes32 commandId, string sourceChain, string sourceAddress, address contractAddress, bytes32 payloadHash) view returns (bool)`
- `mintLimiter() view returns (address)`
- `mintToken(bytes params, bytes32)`
- `sendToken(string destinationChain, string destinationAddress, string symbol, uint256 amount)`
- `setTokenMintLimits(string[] symbols, uint256[] limits)`
- `setup(bytes params)`
- `tokenAddresses(string symbol) view returns (address)`
- `tokenDeployer() view returns (address)`
- `tokenFrozen(string) pure returns (bool)`
- `tokenMintAmount(string symbol) view returns (uint256)`
- `tokenMintLimit(string symbol) view returns (uint256)`
- `transferGovernance(address newGovernance)`
- `transferMintLimiter(address newMintLimiter)`
- `transferOperatorship(bytes newOperatorsData, bytes32)`
- `upgrade(address newImplementation, bytes32 newImplementationCodeHash, bytes setupParams)`
- `validateContractCall(bytes32 commandId, string sourceChain, string sourceAddress, bytes32 payloadHash) returns (bool valid)`
- `validateContractCallAndMint(bytes32 commandId, string sourceChain, string sourceAddress, bytes32 payloadHash, string symbol, uint256 amount) returns (bool valid)`

### `AxelarITSABI`

`import AxelarITSABI from "./protocols/axelar/AxelarITSABI.json";` Speaks for: its.

- `acceptOperatorship(address fromOperator)`
- `acceptOwnership()`
- `chainName() view returns (string chainName_)`
- `chainNameHash() view returns (bytes32)`
- `contractCallValue(string sourceChain, string sourceAddress, bytes payload) view returns (address, uint256)`
- `contractId() pure returns (bytes32)`
- `deployedTokenManager(bytes32 tokenId) view returns (address tokenManager_)`
- `deployInterchainToken(bytes32 salt, string destinationChain, string name, string symbol, uint8 decimals, bytes minter, uint256 gasValue) payable returns (bytes32 tokenId)`
- `execute(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload)`
- `expressExecute(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload) payable`
- `gasService() view returns (address)`
- `gateway() view returns (address)`
- `gatewayCaller() view returns (address)`
- `getExpressExecutor(bytes32 commandId, string sourceChain, string sourceAddress, bytes32 payloadHash) view returns (address expressExecutor)`
- `hasRole(address account, uint8 role) view returns (bool)`
- `implementation() view returns (address implementation_)`
- `interchainTokenAddress(bytes32 tokenId) view returns (address tokenAddress)`
- `interchainTokenDeployer() view returns (address)`
- `interchainTokenFactory() view returns (address)`
- `interchainTokenId(address sender, bytes32 salt) pure returns (bytes32 tokenId)`
- `interchainTransfer(bytes32 tokenId, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata, uint256 gasValue) payable`
- `isOperator(address addr) view returns (bool)`
- `isTrustedAddress(string chain, string address_) view returns (bool)`
- `linkToken(bytes32 salt, string destinationChain, bytes destinationTokenAddress, uint8 tokenManagerType, bytes linkParams, uint256 gasValue) payable returns (bytes32 tokenId)`
- `migrateInterchainToken(bytes32 tokenId)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `owner() view returns (address owner_)`
- `paused() view returns (bool paused_)`
- `pendingOwner() view returns (address owner_)`
- `proposeOperatorship(address operator)`
- `proposeOwnership(address newOwner)`
- `registerCustomToken(bytes32 salt, address tokenAddress, uint8 tokenManagerType, bytes linkParams) payable returns (bytes32 tokenId)`
- `registeredTokenAddress(bytes32 tokenId) view returns (address tokenAddress)`
- `registerTokenMetadata(address tokenAddress, uint256 gasValue) payable`
- `removeTrustedAddress(string chain)`
- `setFlowLimits(bytes32[] tokenIds, uint256[] flowLimits)`
- `setPauseStatus(bool paused)`
- `setTrustedAddress(string chain, string address_)`
- `setup(bytes data)`
- `tokenHandler() view returns (address)`
- `tokenManager() view returns (address)`
- `tokenManagerAddress(bytes32 tokenId) view returns (address tokenManagerAddress_)`
- `tokenManagerDeployer() view returns (address)`
- `tokenManagerImplementation(uint256) view returns (address)`
- `transferOperatorship(address operator)`
- `transferOwnership(address newOwner)`
- `transmitInterchainTransfer(bytes32 tokenId, address sourceAddress, string destinationChain, bytes destinationAddress, uint256 amount, bytes metadata) payable`
- `trustedAddress(string chain) view returns (string trustedAddress_)`
- `trustedAddressHash(string chain) view returns (bytes32 trustedAddressHash_)`
- `upgrade(address newImplementation, bytes32 newImplementationCodeHash, bytes params)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
