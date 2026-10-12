# Metalayer

Caldera's interchain messaging, built on Hyperlane. A router on each chain dispatches a message through Metalayer's own Hyperlane mailbox to the router on the destination chain, which calls the recipient's `handle` with the message and the results of any cross-chain reads the message asked for.

## Category

cross-chain messaging | Direction: any-to-any | Chains and addresses: [registry/metalayer.md](registry/metalayer.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows.

### quoteDispatch

Price a message: the fee `dispatch` must be sent with, for the gas `metadata` names.

```typescript
import { MetalayerRouterABI as IMetalayerRouter } from "./abis";

function main(
  routerAddress: Address,
  destinationDomain: Uint256,
  recipient: Uint256,
  message: bytes,
  metadata: bytes,
): Uint256 {
  return IMetalayerRouter.at(routerAddress).quoteDispatch(
    destinationDomain,
    recipient,
    message,
    metadata,
  );
}
```

- `metadata`: Hyperlane's standard hook metadata, packed: the variant `1` (2 bytes), a value (32 bytes), the gas limit the destination call is given (32 bytes), the refund address (20 bytes). eco-routes quotes with a value of 10^36 and its gas limit

### dispatch

Send `message` to `recipient` on another chain, with no reads, paying `fee` in the native coin. A contract binding attaches no value, so the call is written out.

```typescript
function main(
  routerAddress: Address,
  destinationDomain: Uint256,
  recipient: Uint256,
  message: bytes,
  gasLimit: Uint256,
  fee: Uint256,
): bytes {
  // dispatch(uint32,bytes32,(uint32,address,bytes)[],bytes,uint8,uint256), with no reads, INSTANT finality
  const selector = 0xe8dd7ad7;
  const reads = new Array(0);
  return evm.call(
    routerAddress,
    fee,
    selector
      .toBytesBe(4)
      .concat(abi.encode(destinationDomain, recipient, reads, message, 0, gasLimit)),
  );
}
```

- `destinationDomain`: the destination's domain, which is its chain id on every chain the registry lists
- `recipient`: the destination contract as 32 bytes (an address, left-padded)
- `0`: the finality the message waits for, `INSTANT`; `1` is `FINALIZED`
- `gasLimit`: the gas the destination call is given, which the fee pays for
- `fee`: what `quoteDispatch` answers for the same message and gas limit

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/metalayer.md](registry/metalayer.md).

## Notes

- The recipient's `handle(uint32 origin, bytes32 sender, bytes message, ReadOperation[] reads, bytes[] results)` is called by the router, so a recipient checks its caller is the router and that `sender` is the contract it expects on `origin`
- The router dispatches through its own Hyperlane mailbox, not Hyperlane's (its `mailbox()`): Metalayer's relayers carry it
- The same router address on every chain the registry lists
