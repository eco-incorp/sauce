<!-- Generated from the SDK's registries. Do not edit. -->

# Stargate (`stargate`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Stargate is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Omnichain liquidity transport protocol built on LayerZero. Provides native asset bridging with unified liquidity pools.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Stargate` on ethereum, base, arbitrum |
| Chains | ethereum, base, arbitrum |

## Notes

- Uses LayerZero endpoint IDs (dstEid) for destination chains, NOT EVM chain IDs
- Each token has its own pool contract (poolNative for ETH, poolUSDC for USDC, etc.)
- Native token fees required for LayerZero messaging -- sent as msg.value
- Unified liquidity pools across chains -- no wrapped tokens, receives native assets
- Finality depends on LayerZero verification (typically 1-5 minutes)
- Use `quoteOFT` to get fee estimates before sending
- TVL: $400M+. Audited

## Its names in a program

On Ethereum, `Stargate` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's poolNative, `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931`.
  require(Stargate.PoolNative != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | poolNative | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` | `Stargate.PoolNative`; not on this deployment: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC` |
| [Ethereum](../chains/ethereum.md) | poolUSDC | `0xc026395860Db2d07ee33e05fE50ed7bD583189C7` | `Stargate.PoolUSDC`; not on this deployment: `burnLocked` |
| [Ethereum](../chains/ethereum.md) | poolUSDT | `0x933597a323Eb81cAe705C5bC29985172fd5A3973` | `Stargate.PoolUSDT`; not on this deployment: `burnLockedUSDC` |
| [Base](../chains/base.md) | poolNative | `0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7` | `Stargate.PoolNative`; not on this deployment: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC` |
| [Base](../chains/base.md) | poolUSDC | `0x27a16dc786820B16E5c9028b75B99F6f604b5d26` | `Stargate.PoolUSDC`; not on this deployment: `burnLocked` |
| [Arbitrum One](../chains/arbitrum.md) | poolNative | `0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F` | `Stargate.PoolNative`; not on this deployment: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC` |
| [Arbitrum One](../chains/arbitrum.md) | poolUSDC | `0xe8CDF27AcD73a434D661C84887215F7598e7d0d3` | `Stargate.PoolUSDC`; not on this deployment: `burnLocked` |

## ABI

### `StargatePoolABI`

`import StargatePoolABI from "./protocols/stargate/StargatePoolABI.json";` Speaks for: poolNative, poolUSDC, poolUSDT. The import is the contract's full ABI across every deployment; call it through the `Stargate` namespace to have a function a chain's deployment does not run refused.

- `addTreasuryFee(uint256 _amountLD) payable`
- `allowBurn(address _burnAdmin, uint64 _burnAllowanceSD)`
- `approvalRequired() pure returns (bool)`
- `burnAdmin() view returns (address)`
- `burnAllowanceSD() view returns (uint64)`
- `burnLocked()`
- `burnLockedUSDC()`
- `deficitOffset() view returns (uint256)`
- `deposit(address _receiver, uint256 _amountLD) payable returns (uint256 amountLD)`
- `endpoint() view returns (address)`
- `getAddressConfig() view returns ((address feeLib, address planner, address treasurer, address tokenMessaging, address creditMessaging, address lzToken))`
- `getTransferGasLimit() view returns (uint256)`
- `localEid() view returns (uint32)`
- `lpToken() view returns (address)`
- `oftVersion() pure returns (bytes4 interfaceId, uint64 version)`
- `owner() view returns (address)`
- `paths(uint32 eid) view returns (uint64 credit)`
- `plannerFee() view returns (uint256 available)`
- `poolBalance() view returns (uint256)`
- `quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam) view returns ((uint256 minAmountLD, uint256 maxAmountLD) oftLimit, (int256 feeAmountLD, string description)[] oftFeeDetails, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)`
- `quoteRedeemSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
- `quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
- `receiveCredits(uint32 _srcEid, (uint32 srcEid, uint64 amount)[] _credits)`
- `receiveTokenBus((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, bytes32 _guid, uint8 _seatNumber, address _receiver, uint64 _amountSD)`
- `receiveTokenTaxi((uint32 srcEid, bytes32 sender, uint64 nonce) _origin, bytes32 _guid, address _receiver, uint64 _amountSD, bytes _composeMsg)`
- `recoverToken(address _token, address _to, uint256 _amount) returns (uint256)`
- `redeem(uint256 _amountLD, address _receiver) returns (uint256 amountLD)`
- `redeemable(address _owner) view returns (uint256 amountLD)`
- `redeemSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) msgReceipt, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)`
- `renounceOwnership()`
- `retryReceiveToken(bytes32 _guid, uint8 _index, uint32 _srcEid, address _receiver, uint256 _amountLD, bytes _composeMsg)`
- `send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) msgReceipt, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)`
- `sendCredits(uint32 _dstEid, (uint32 srcEid, uint64 amount, uint64 minAmount)[] _credits) returns ((uint32 srcEid, uint64 amount)[])`
- `sendToken((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) msgReceipt, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt, (uint72 ticketId, bytes passengerBytes) ticket)`
- `setAddressConfig((address feeLib, address planner, address treasurer, address tokenMessaging, address creditMessaging, address lzToken) _config)`
- `setDeficitOffset(uint256 _deficitOffsetLD)`
- `setOFTPath(uint32 _dstEid, bool _oft)`
- `setPause(bool _paused)`
- `setTransferGasLimit(uint256 _gasLimit)`
- `sharedDecimals() view returns (uint8)`
- `stargateType() pure returns (uint8)`
- `status() view returns (uint8)`
- `token() view returns (address)`
- `transferOwnership(address newOwner)`
- `treasuryFee() view returns (uint64)`
- `tvl() view returns (uint256)`
- `unreceivedTokens(bytes32 guid, uint8 index) view returns (bytes32 hash)`
- `withdrawPlannerFee()`
- `withdrawTreasuryFee(address _to, uint64 _amountSD)`

Not on Ethereum's poolNative (`0x77b2043768d28E9C9aB44E1aBfC95944bcE57931`), whose code does not dispatch them or declares them otherwise: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum's poolUSDC (`0xc026395860Db2d07ee33e05fE50ed7bD583189C7`), whose code does not dispatch them or declares them otherwise: `burnLocked`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum's poolUSDT (`0x933597a323Eb81cAe705C5bC29985172fd5A3973`), whose code does not dispatch them or declares them otherwise: `burnLockedUSDC`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's poolNative (`0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7`), whose code does not dispatch them or declares them otherwise: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Base's poolUSDC (`0x27a16dc786820B16E5c9028b75B99F6f604b5d26`), whose code does not dispatch them or declares them otherwise: `burnLocked`. Do not call them there: a program compiled for Base is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's poolNative (`0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F`), whose code does not dispatch them or declares them otherwise: `allowBurn`, `burnAdmin`, `burnAllowanceSD`, `burnLocked`, `burnLockedUSDC`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Arbitrum One's poolUSDC (`0xe8CDF27AcD73a434D661C84887215F7598e7d0d3`), whose code does not dispatch them or declares them otherwise: `burnLocked`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
