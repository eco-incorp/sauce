# Linea Native Bridge

Official Linea zkEVM bridge via L1MessageService. Deposits ETH from Ethereum to Linea with ZK proof-based finality.

## Category

native L2 bridge | Direction: L1 to L2 (Ethereum to Linea) | Chains and addresses: [registry/linea-bridge.md](registry/linea-bridge.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### bridgeETH

Bridge ETH from Ethereum L1 to Linea L2 via the message service.

```typescript
import { LineaL1MessageServiceABI as IL1MessageService } from "./abis";

function main(messageServiceAddress: Address, recipient: Address, fee: Uint256): Uint256 {
  const service = IL1MessageService.at(messageServiceAddress);
  service.sendMessage(recipient, fee, hex``);
  return 1;
}
```

- `recipient`: Address to receive ETH on Linea L2
- `fee`: Fee for the postman (relayer) to deliver the message on L2. Set to 0 for self-claim
- `_calldata`: Optional calldata to execute on L2 when message is delivered. ` hex`` ` for simple ETH transfers
- ETH amount (minus fee) is sent as `msg.value`

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/linea-bridge.md](registry/linea-bridge.md).

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
