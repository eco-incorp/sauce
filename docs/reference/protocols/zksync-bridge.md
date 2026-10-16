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

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### depositETH

Deposit ETH from Ethereum L1 to zkSync Era L2.

```typescript
import { ZkSyncDiamondProxyABI as IDiamondProxy } from "./abis";

function main(diamondProxyAddress: Address, recipient: Address, l2GasLimit: Uint256): Uint256 {
  const proxy = IDiamondProxy.at(diamondProxyAddress);
  return proxy.requestL2Transaction(
    recipient,
    ctx.msgValue(),
    0x00,
    l2GasLimit,
    800,
    [],
    ctx.msgSender(),
  );
}
```

- `recipient`: Address to receive ETH on zkSync L2 (also the contract to call if `_calldata` is provided)
- `_l2Value`: Amount of ETH to send to the recipient on L2 (use `msg.value`)
- `_calldata`: Optional calldata to execute on L2. `0x00` for simple ETH deposits
- `_l2GasLimit`: Gas limit for L2 execution (e.g. 300000)
- `_l2GasPerPubdataByteLimit`: Gas per pubdata byte limit (800 is the standard value)
- `_factoryDeps`: Array of contract bytecodes to deploy on L2. Empty `[]` for standard operations
- `_refundRecipient`: Address to receive excess gas refund on L2: the user's wallet (in a Sauce program `msg.sender` is the Pot, whose address on L2 holds nothing the user can reach)
- `msg.value` must cover: L2 value + L2 gas costs. Use `l2TransactionBaseCost()` to estimate

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
- Canonical bridge -- no third-party risk, secured by zkSync's ZK proving system (Matter Labs)
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

`import ZkSyncDiamondProxyABI from "./protocols/zksync-bridge/ZkSyncDiamondProxyABI.json";` Speaks for: diamondProxy.

- `requestL2Transaction(address _contractL2, uint256 _l2Value, bytes _calldata, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit, bytes[] _factoryDeps, address _refundRecipient) payable returns (bytes32 canonicalTxHash)`
- `l2TransactionBaseCost(uint256 _gasPrice, uint256 _l2GasLimit, uint256 _l2GasPerPubdataByteLimit) view returns (uint256)`
