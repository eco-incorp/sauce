<!-- Generated from the SDK's registries. Do not edit. -->

# Metalayer (`metalayer`)

Caldera's interchain messaging, built on Hyperlane. A router on each chain dispatches a message through Metalayer's own Hyperlane mailbox to the router on the destination chain, which calls the recipient's `handle` with the message and the results of any cross-chain reads the message asked for.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Metalayer` on ethereum, bsc, base, arbitrum |
| Chains | ethereum, bsc, base, arbitrum |

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

## Notes

- The recipient's `handle(uint32 origin, bytes32 sender, bytes message, ReadOperation[] reads, bytes[] results)` is called by the router, so a recipient checks its caller is the router and that `sender` is the contract it expects on `origin`
- The router dispatches through its own Hyperlane mailbox, not Hyperlane's (its `mailbox()`): Metalayer's relayers carry it
- The same router address on every chain the registry lists

## Its names in a program

On Ethereum, `Metalayer` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's router, `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3`.
  require(Metalayer.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [BNB Chain](../chains/bsc.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [Base](../chains/base.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x09cE71C24EE2098e351C0cF2dC6431B414d247f3` | `Metalayer.Router` |

## ABI

### `MetalayerRouterABI`

`import MetalayerRouterABI from "./protocols/metalayer/MetalayerRouterABI.json";` Speaks for: router.

- `dispatch(uint32 _destinationDomain, bytes32 _recipientAddress, (uint32 domain, address target, bytes callData)[] _reads, bytes _writeCallData, uint8 _finalityState, uint256 _gasLimit) payable`
- `quoteDispatch(uint32 destinationDomain, bytes32 recipientAddress, bytes messageBody, bytes defaultHookMetadata) view returns (uint256 fee)`
