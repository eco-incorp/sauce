# zkSync Native Bridge

Official zkSync Era bridge via DiamondProxy. Deposits ETH and executes L2 transactions from Ethereum with ZK proof-based finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to zkSync Era) | Chains and addresses: [registry/zksync-bridge.md](registry/zksync-bridge.md)

## SauceScript Functions

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
- `_refundRecipient`: Address to receive excess gas refund on L2 (use `msg.sender`)
- `msg.value` must cover: L2 value + L2 gas costs. Use `l2TransactionBaseCost()` to estimate

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/zksync-bridge.md](registry/zksync-bridge.md).

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
