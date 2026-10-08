# Pyth Entropy

Pyth's random number service, v2. A contract pays a fee for a request, and once the provider
reveals its commitment the Entropy contract calls the contract back with a random number.

## Category

oracle | Chains and addresses: [registry/pyth-entropy.md](registry/pyth-entropy.md)

## Key Operations

- **getFee**: the fee for one request with a callback gas limit, from the default provider

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// The fee for one request from the default provider, in wei
import { EntropyABI as IEntropy } from "./abis";
function main(entropyAddress: Address, gasLimit: Uint256): Uint256 {
  const entropy = IEntropy.at(entropyAddress);
  return entropy.getFeeV2(entropy.getDefaultProvider(), gasLimit);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/pyth-entropy.md](registry/pyth-entropy.md).

## Notes

- Entropy is on Base, not on Ethereum mainnet.
- A request is one of the `requestV2` overloads, sent with value: at least the matching `getFeeV2`,
  and any excess is kept. The fee does not depend on the gas price.
- A request is the pair (provider, sequence number): the number counts per provider. The overloads
  without a provider use `getDefaultProvider()`, so read the provider and pass it, and key the
  request by both.
- A gas limit is rounded up to a multiple of 10,000 and raised to the provider's default, so asking
  for less than the default costs the default's fee.
- The Entropy contract, at its own (proxy) address, calls the requester back with
  `_entropyCallback(uint64 sequence, address provider, bytes32 randomNumber)`. Authenticate that
  caller.
- The callback gets at most the request's gas limit. One that reverts leaves the request open:
  the reveal emits `Revealed` with `callbackFailed`, and anyone may reveal it again, then with no
  gas limit.
- A Sauce program receives the number with `@sauce/random`'s `Random.entropy`, which pays the fee,
  keeps the continuation under the provider and sequence number and authenticates the caller.
