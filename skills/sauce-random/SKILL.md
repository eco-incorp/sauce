---
name: sauce-random
description: Verifiable randomness in a Sauce program with @sauce/random — Random.vrf, Chainlink VRF random words paid in the native coin through the chain's VRF wrapper (Ethereum and Base), and Random.entropy, a Pyth Entropy random number (Base), each a promise whose .then body runs with the randomness when the provider calls the Pot back. Covers each request's fields (words, confirmations, provider, gas, deadline), what the Pot pays and must keep for the callback, how the callback's gas is sized and when to give it, what happens when a callback fails, comes twice or never comes (deadlines, expire, racing Async.timeout), installing the handlers on a Private Pot, the chains each provider is on, and Chainlink's and Pyth's official example consumers ported. Use when a program needs a random number, a lottery, a raffle, a draw, a coin flip, a shuffle or a fair pick, or when the user mentions Chainlink VRF, Pyth Entropy, randomness, rawFulfillRandomWords or _entropyCallback.
---

# Randomness with `@sauce/random`

A program asks for verifiable randomness, pays for it, and writes in place what to do with it. The
request is a promise (`sauce-async`): its `.then` body is compiled with the program and runs when
the provider calls the Pot back, as the same Pot, with the randomness. A coin flip for a prize:

```sauce chain=ethereum,base
import { Random } from "@sauce/random";

function main(heads: Address, tails: Address, prize: Uint256) {
  Random.vrf({ words: 1 }).then((words) => {
    USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
  });
}
```

Compiling it for a chain gives the program and the cook transaction that runs it on the owner's
Pot (`to`, `data`, `value`). `sauce run` sends it, and `sauce tx` prints it unsigned for any
signer. The request and its payment happen in that transaction; the body runs later, in the
provider's.

## The two requests

| Request                                               | Provider, chains                                   | The body is handed                |
| ----------------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| `Random.vrf({ words, confirmations, gas, deadline })` | Chainlink VRF by direct funding: Ethereum and Base | `words` random words, `Uint256[]` |
| `Random.entropy({ provider, gas, deadline })`         | Pyth Entropy: Base                                 | one random 32-byte number         |

- **`words`**: 1 to 10, the VRF wrapper's cap; 1 when left out.
- **`confirmations`**: how many blocks VRF waits before answering; 3 when left out, which every
  chain accepts.
- **`provider`**: an Entropy randomness provider; Entropy's default provider when left out.
- **`gas`**: the callback's gas limit (below).
- **`deadline`**: a unix time after which anyone may expire the request. `.within(seconds)` on the
  request says the same from the time it is made.

Every field is optional, and a field a request does not take is a compile error naming it. So is a
request on a chain where the registry has no such provider: `Random.entropy` on Ethereum, either on
Arbitrum.

## What the Pot pays

- **The request** pays the provider's price from the Pot's balance, in the native coin, as the
  program runs: VRF's wrapper price at the transaction's gas price, or Entropy's fee. Exactly the
  price: both providers keep anything paid above it.
- **The callback** is a cook of the Pot, whose Kitchen fee the Pot pays from its balance when the
  provider calls back. A request is refused unless the Pot still holds that fee after paying the
  price, and a Pot keeps that much for every request it is waiting on: VRF never retries a callback
  that could not run.

## The callback's gas

The callback's gas limit is fixed when the request is made, and paid for then. Left out, `gas` is
sized from the program as compiled: what reaching the body costs, plus an
allowance per byte of the body, or for a request inside `Promise.race` or `all`, of its part and the
combinator's body. That covers writes, hashing and a few token transfers. A body that loops, or
calls out more than its size suggests, needs `gas` given:

```sauce chain=base
import { Random } from "@sauce/random";

function main(start: Uint256) {
  Random.vrf({ words: 10, gas: 900000 }).then((words) => {
    for (let i = 0; i < 10; i += 1) {
      evm.sstore(start + i, words[i]);
    }
  });
}
```

VRF's wrapper hands the callback exactly that gas, and a callback that runs out is spent: paid
for, never retried, the request still pending until its deadline. Entropy hands it at most that
gas, never less than its provider's default, and a callback that fails stays open there for anyone
to reveal again.

## When a callback fails, comes twice, or never comes

- **A body that reverts** is undone, and the callback still returns, so the provider records no
  failure: `.catch((e) => { … })` runs in its place with what it reverted with, or with no `.catch`
  the Pot logs the promise unhandled. The handler logs what arrived first,
  `RandomDelivered(bytes32 key, bytes value)` from the Pot, so the randomness is never lost.
- **A second delivery**, or one for a request the Pot never made, runs nothing and returns.
- **A call from anyone but the provider** reverts: the handler answers only the chain's VRF
  wrapper and Entropy contract.
- **No answer**: give the request a deadline, `.within(seconds)` or `deadline`. After it, anyone
  may call the Pot's `expire(bytes32 key)`, paying the Kitchen's fee as the call's value, which
  rejects the request into its `.catch`. Or race it against a timeout:
  `Promise.race([Random.entropy(), Async.timeout(3600)])`, as
  [`examples/draw.sauce.ts`](examples/draw.sauce.ts) does. An answer after the request expired runs nothing.

A request's key is the provider's own id: VRF's request id under its wrapper, Entropy's sequence
number under its provider and the Entropy contract (a sequence number counts per provider).

## Installing the handlers

The Pot must be a Private Pot with `@sauce/random`'s handlers installed, once:
`sauce run @sauce/random --chain base --wallet <name>`. They answer `rawFulfillRandomWords` from
VRF's wrapper and `_entropyCallback` from Entropy; a chain with one provider installs only its
handler, and every install adds the Pot's public `expire`. `sauce-async` covers the handlers, the
promise table and its combinators.

## The body

- It reads numbers, addresses and booleans from the program around it, as they were at the
  request, not an array: pick among fixed parameters, as `heads` and `tails` above.
- It runs as the Pot, so it moves what the Pot holds: keep the prize there.

## Examples

- [`examples/coin-flip.sauce.ts`](examples/coin-flip.sauce.ts): a VRF coin flip paying USDC to
  heads or tails, which anyone may expire after a day.
- [`examples/draw.sauce.ts`](examples/draw.sauce.ts): an Entropy draw among three entrants, raced
  against an hour.

## The official examples, in Sauce

Chainlink's and Pyth's own example consumers, each ported as a program that keeps the original's
behaviour: its state in the Pot's storage, its events from the Pot, its callback as `.then`. Each
file's header names the source, says where each part of the contract went, and lists what is left
out. What a contract needs to exist at all (a constructor, an owner check, a `receive`, the
callback's sender check) a Pot already has, so a port runs to between a sixth and a little over half
of the original's code lines.

| Ported from                                        | Sauce                                                                                                                                                     | Lines (code)        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Chainlink `DirectFundingConsumer.sol`              | [`examples/vrf-direct-funding.sauce.ts`](examples/vrf-direct-funding.sauce.ts)                                                                            | 119 (66) → 42 (18)  |
| Chainlink `SubscriptionConsumer.sol`               | [`examples/vrf-subscription.sauce.ts`](examples/vrf-subscription.sauce.ts), paid by direct funding in place of a subscription                             | 109 (57) → 41 (19)  |
| Chainlink `VRFD20.sol`                             | [`examples/vrf-d20.sauce.ts`](examples/vrf-d20.sauce.ts), and its `house(player)` as [`examples/vrf-d20-house.sauce.ts`](examples/vrf-d20-house.sauce.ts) | 173 (80) → 86 (46)  |
| Pyth `CoinFlip.sol`                                | [`examples/entropy-coin-flip.sauce.ts`](examples/entropy-coin-flip.sauce.ts)                                                                              | 128 (64) → 33 (11)  |
| Pyth `NFTGrowth.sol` (with its `NFT.sol`, 41 more) | [`examples/entropy-growth.sauce.ts`](examples/entropy-growth.sauce.ts): its ten-minute unlock is the request's deadline and `.catch`                      | 183 (141) → 61 (34) |

The Chainlink sources are `smartcontractkit/documentation`'s `public/samples/VRF/v2-5/`, and the
Pyth ones `pyth-network/pyth-examples`' `entropy/`. Code lines leave out comments, blank lines, and the pragma and import lines.

- **A Pot numbers its own requests.** Each program counts its requests in the Pot's storage and keys
  its records by that number, where the original keys them by the provider's request id or sequence
  number: the program never needs the provider's id, which keys the promise.
- **A view is a read.** A `view` function becomes a program that returns the value, simulated
  rather than sent (`vrf-d20-house.sauce.ts`).
- **The Pot pays.** A request is paid from the Pot's balance in the native coin, so the original's
  LINK payment, subscription, fee checks and withdraw functions have no part here.

The providers' own facts (addresses per chain, the wrapper's limits, how each calls back) are in
`sauce-protocols`, its `chainlink-vrf` and `pyth-entropy` documents.
