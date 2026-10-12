# Boundless

RISC Zero's proof market: a requestor offers ETH for a proof that a guest program (its image id) ran on an input, provers bid by locking the request with collateral, and BoundlessMarket verifies the proof, pays the prover and calls the requestor's callback with the guest's journal.

## Category

infrastructure (proof market) | Chains and addresses: [registry/boundless.md](registry/boundless.md)

## In a Sauce program

A Sauce program requests a proof with `@sauce/zk` (`sauce-zk`): `Zk.risc0({ imageId, imageUrl,
input, offer })`, the guest's journal handed to the request's `.then`, the Pot's handlers for the
callback and for approving its own requests installed on it.

## How a request works

1. **The guest** is a RISC Zero program, built off chain: its image id is the hash that names it,
   and its image is published at a URL provers download (`imageUrl`). It reads its input from stdin
   and commits a journal, the bytes the proof attests.
2. **The request**, `ProofRequest { id, requirements, imageUrl, input, offer }`:
   - `id`: `(1 << 192 for a contract that signs with ERC-1271) | (client << 32) | index`. Each
     `index` of a client is locked, fulfilled and paid once.
   - `requirements`: `{ callback: { addr, gasLimit }, predicate: { predicateType, data }, selector }`.
     The predicate is what the journal must satisfy: `DigestMatch` (0, `imageId ++ sha256(journal)`),
     `PrefixMatch` (1, `imageId ++ prefix`), `ClaimDigestMatch` (2). `selector` 0 takes any proof.
   - `input`: `{ inputType, data }`, inline (0) `data` being one version byte (0, raw) and the
     guest's stdin.
   - `offer`: `{ minPrice, maxPrice, rampUpStart, rampUpPeriod, lockTimeout, timeout, lockCollateral }`:
     the price rises from `minPrice` at `rampUpStart` to `maxPrice` after `rampUpPeriod` seconds; a
     prover locks it (posting `lockCollateral` in ZKC) by `rampUpStart + lockTimeout` and must
     fulfil by `rampUpStart + timeout`.
3. **Submitting.** `submitRequest(request, clientSignature)` emits the request and deposits any
   value to the caller's balance at the market; it checks no signature. A prover's `lockRequest`
   checks it: an ECDSA signature by the client, or, with the id's ERC-1271 bit, the client's
   `isValidSignature(requestHash, clientSignature)` returning `0x1626ba7e`, called static with
   100,000 gas. `requestHash` is the EIP-712 hash of the request under the market's domain
   (`eip712DomainSeparator()`). The lock debits the price from the client's balance.
4. **The callback.** On fulfilment the market calls `callback.addr` with
   `handleProof(bytes32 imageId, bytes journal, bytes seal)` (selector `0xa12da43f`), with exactly
   `gasLimit` gas.

## Pitfalls

- **The callback carries no request id.** Only the image id and the journal identify what was
  proven. Anyone may fund a request naming any contract as its callback, so a receiver keys what it
  waits for by what the journal commits (`@sauce/zk` keys a request by the image id and either the
  journal it named in advance, asked for with a `DigestMatch`, or the sha256 of the guest's stdin,
  which begins with the request's id and which the guest commits first).
- **At least once.** A proof may be delivered again, and a failed callback (`CallbackFailed`) is
  not retried; the prover is paid either way.
- **A contract client approves its own requests.** With ERC-1271, every lock of a request whose id
  names the client spends the client's balance at the market: `isValidSignature` must approve only
  request hashes the client itself made, within the 100,000 gas.
- **Expired.** A request no prover locked costs nothing; its deposit stays as balance, withdrawn
  with `withdraw(amount)`. A locked one unfulfilled by its deadline is slashed by anyone
  (`slash(id)`): the price returns to the client's balance, half the collateral is burned and half
  goes to the market's treasury, or to a prover that fulfils it later.
- **Base only.** Ethereum has RISC Zero's verifiers but no market.

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### balance

What a holder holds at the market, in wei: deposits not yet spent on a locked request.

```typescript
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, holder: Address): Uint256 {
  return IBoundlessMarket.at(market).balanceOf(holder);
}
```

### requestState

A request's state: 1 locked, 2 fulfilled, 0 neither.

```typescript
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, requestId: Uint256): Uint256 {
  const boundless = IBoundlessMarket.at(market);
  if (boundless.requestIsFulfilled(requestId)) {
    return 2;
  }
  return boundless.requestIsLocked(requestId) ? 1 : 0;
}
```

### slashAndWithdraw

A locked request past its deadline and unfulfilled: slash its prover, which refunds the price to the
requestor's balance, and withdraw `amount` of that balance. Run by the requestor.

```typescript
import { BoundlessMarketABI as IBoundlessMarket } from "./abis";

function main(market: Address, requestId: Uint256, amount: Uint256): void {
  const boundless = IBoundlessMarket.at(market);
  boundless.slash(requestId);
  boundless.withdraw(amount);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/boundless.md](registry/boundless.md).

## Notes

- Sources: `boundless-xyz/boundless` (`contracts/src/BoundlessMarket.sol`, `contracts/src/types/`,
  `contracts/src/IBoundlessMarketCallback.sol`, `crates/boundless-market/src/input.rs`) and the
  implementation's verified source on Sourcify.
- The market takes no fee (`MARKET_FEE_BPS` is 0). Payment is in ETH, collateral in ZKC.
- The market's fallback serves the previous ABI (`submitRootAndFulfill`) through its legacy
  implementation, which provers still use.
