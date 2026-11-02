<!-- Generated from the SDK's registries. Do not edit. -->

# Squid Router (`squid`)

Cross-chain liquidity router built on Axelar. Enables one-click cross-chain swaps combining bridge and DEX operations.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Squid` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [squid.md](../squid.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Squid` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's squidRouter, `0xce16F69375520ab01377ce7B88f5BA8C48F8D666`.
  require(Squid.SquidRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Base](../../../sauce-chains/references/base.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | squidRouter | `0xce16F69375520ab01377ce7B88f5BA8C48F8D666` | `Squid.SquidRouter` |

## ABI

### `SquidRouterABI`

`import SquidRouterABI from "./protocols/squid/SquidRouterABI.json";` Speaks for: squidRouter. The import is the contract's full ABI across every deployment; call it through the `Squid` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `acceptPauser()`
- `approveCctpTokenMessenger()`
- `axelarGasService() view returns (address)`
- `bridgeCall(string bridgedTokenSymbol, uint256 amount, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
- `callBridgeCall(address token, uint256 amount, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls, string bridgedTokenSymbol, string destinationChain, string destinationAddress, bytes payload, address gasRefundRecipient, bool enableExpress) payable`
- `CCTP_BRIDGE_DATA_TYPEHASH() view returns (bytes32)`
- `CCTP_BRIDGE_WITNESS_TYPE_STRING() view returns (string)`
- `cctpBridge(uint256 amount, uint32 destinationDomain, bytes32 destinationAddress, bytes32 destinationCaller)`
- `cctpTokenMessenger() view returns (address)`
- `cfReceive(uint32, bytes, bytes payload, address token, uint256 amount) payable`
- `chainflipVault() view returns (address)`
- `contractId() pure returns (bytes32 id)`
- `execute(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload)`
- `executeWithInterchainToken(bytes32 commandId, string sourceChain, bytes sourceAddress, bytes data, bytes32 tokenId, address token, uint256 amount) returns (bytes32)`
- `executeWithToken(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload, string tokenSymbol, uint256 amount)`
- `expressExecute(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload) payable`
- `expressExecuteWithInterchainToken(bytes32 commandId, string sourceChain, bytes sourceAddress, bytes data, bytes32 tokenId, address token, uint256 amount) returns (bytes32)`
- `expressExecuteWithToken(bytes32 commandId, string sourceChain, string sourceAddress, bytes payload, string symbol, uint256 amount) payable`
- `FUND_AND_RUN_MULTICALL_DATA_TYPEHASH() view returns (bytes32)`
- `FUND_AND_RUN_MULTICALL_WITNESS_TYPE_STRING() view returns (string)`
- `fundAndRunMulticall(address token, uint256 amount, (uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls) payable`
- `gateway() view returns (address)`
- `getExpressExecutor(bytes32 commandId, string sourceChain, string sourceAddress, bytes32 payloadHash) view returns (address expressExecutor)`
- `getExpressExecutorWithToken(bytes32 commandId, string sourceChain, string sourceAddress, bytes32 payloadHash, string symbol, uint256 amount) view returns (address expressExecutor)`
- `implementation() view returns (address implementation_)`
- `interchainTokenService() view returns (address)`
- `owner() view returns (address owner_)`
- `pause()`
- `paused() view returns (bool value)`
- `pauser() view returns (address value)`
- `pendingOwner() view returns (address owner_)`
- `pendingPauser() view returns (address value)`
- `permit2() view returns (address)`
- `permitCctpBridge(uint32 destinationDomain, bytes32 destinationAddress, bytes32 destinationCaller, address from, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)`
- `permitFundAndRunMulticall((uint8 callType, address target, uint256 value, bytes callData, bytes payload)[] calls, address from, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature) payable`
- `proposeOwnership(address newOwner)`
- `rescueFunds(address token, address to, uint256 amount)`
- `setup(bytes data)`
- `squidMulticall() view returns (address)`
- `transferOwnership(address newOwner)`
- `unpause()`
- `updatePauser(address newPauser)`
- `upgrade(address newImplementation, bytes32 newImplementationCodeHash, bytes params)`
- `usdc() view returns (address)`
