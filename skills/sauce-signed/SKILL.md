---
name: sauce-signed
description: Owner-signed programs with @sauce/signed — a program a Private Pot's owner signs once (EIP-712 over the program with its arguments, a salt and a deadline) that anyone then submits to the Pot's execute, which runs it as the Pot, once. Covers installing it on a Pot, the typed data any wallet signs, sauce sign, a signed program that checks what it needs because anyone may submit it early, another Pot paying in and running it in one transaction, a hop whose body delivers to the owner's Pot and runs its signed program in the fill, cancelling a salt, one signature over a program per chain (executeAcross), the Pot answering EIP-1271 so Permit2 takes it as a signer, a contract wallet as the owner, and the costs. Use when the user wants a gasless or relayed run, a meta-transaction, delegated or pre-authorized execution, a signed order, the owner's program run after a hop, or Permit2 or EIP-1271 with a Pot.
---

# Owner-signed programs with `@sauce/signed`

A Pot runs a program only when its owner cooks it. `@sauce/signed` adds a second way: the owner
**signs** a program once, and **anyone** submits it to the Pot's `execute`. The Pot runs it with
everything it holds, as if the owner had cooked it, if and only if the owner signed it:

- for this Pot, on this chain;
- with exactly these bytes: the program and its arguments;
- under a salt not used yet;
- before the deadline.

A relayer can pay the gas. The body of a hop can deliver tokens to the owner's Pot and run the
owner's program there in the same transaction. Another contract can check the owner's signature
with the Pot as the signer.

It is a package of handlers (`sauce-async` covers handlers in general). The Pot answers three calls
it was not written with:

| Call                                                                                                                 | Runs as                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `execute(bytes program, bytes32 salt, uint256 deadline, bytes signature)`                                            | a cook, paid by the Pot     |
| `executeAcross(bytes program, bytes32 salt, uint256 deadline, bytes32[] executions, uint256 index, bytes signature)` | a cook, paid by the Pot     |
| `isValidSignature(bytes32 hash, bytes signature) returns (bytes4)`                                                   | a view, static, with no fee |

## Setting a Pot up

A stranger's `execute` reaches only a Pot that answers it, and only the Pot's owner can make it
answer. So a Pot is set up once, by a cook of its owner's:

- **Any owner cook that uses `Signed`** installs what the Pot lacks as it runs: `Signed.setup()`,
  and `Signed.cancel(salt)` and `Signed.invalidate(word, mask)`, which call it. A later cook finds
  the handlers in place and installs nothing.
- **Or ahead of time,** by giving the package where a program file goes:

  ```sh
  sauce run @sauce/signed --chain base --wallet <name> --password-env <NAME>
  ```

What a Pot needs:

- **A Private Pot whose Router is not fixed.** A Shared Pot, and a Private Pot whose Router is fixed,
  refuse the setup. The owner may be an account or a contract wallet.
- **The native coin for the fee.** Each `execute` is a cook of the Pot, and the Kitchen's fee comes
  from the Pot's own balance, whoever sends the call. A call that is refused pays nothing.

## What the owner signs

EIP-712 typed data, which any wallet signs (`eth_signTypedData_v4`):

```json
{
  "domain": { "name": "Sauce Pot", "version": "1", "chainId": 8453, "verifyingContract": "<pot>" },
  "types": {
    "Execute": [
      { "name": "program", "type": "bytes" },
      { "name": "salt", "type": "bytes32" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "Execute",
  "message": { "program": "<program>", "salt": "<salt>", "deadline": "<deadline>" }
}
```

- **`program`** is the compiled bytecode with `main`'s arguments appended: the exact bytes that run.
  Change an argument and the signature no longer matches, so nothing the owner did not sign
  reaches the program.
- **`salt`** is any 32 bytes, unordered. Each salt runs once, and salts run in any order, so
  signatures made in parallel never wait on each other.
- **`deadline`** is the last unix second the program may run.
- **The signature** is the owner's: a 65-byte signature from an account, with `s` in the lower half
  of the curve's order (every wallet makes these). A contract-wallet owner instead answers
  EIP-1271 for the signature, which may be of any length (a multisig's, a passkey's).

`sauce sign` compiles the program with its arguments and prints all of it. With a signer, the
owner's, it also prints the signature and the call that submits it:

```sh
sauce sign pay-when-delivered.sauce.ts --chain base --wallet <name> --password-env <NAME> \
  --within 3600 --args <recipient> 25000000
```

```json
{
  "chainId": 8453,
  "pot": "<pot>",
  "program": "<program>",
  "salt": "<salt>",
  "deadline": "<deadline>",
  "typedData": { "…": "…" },
  "signature": "<signature>",
  "execute": { "chainId": 8453, "to": "<pot>", "data": "<data>", "value": "0" }
}
```

- **With no signer**, it prints the typed data alone, for the owner to sign elsewhere.
- **The Pot** is the signer's own (`--salt` names another of theirs), or `--pot <address>`.
- **The salt** is random unless `--signed-salt` gives one.
- **The deadline** is `--within <seconds>` from now (an hour by default), or `--deadline <unix>`.

Any account then sends `execute` as it is: `to`, `data`, no value.

## Writing the program the owner signs

A signed program is an ordinary program. What differs is who decides when it runs: **anyone may
submit it as soon as it is signed.** So it checks, with `require`, everything it needs to be true
when it runs. [`examples/pay-when-delivered.sauce.ts`](examples/pay-when-delivered.sauce.ts) pays
out USDC only once the Pot holds it:

```sauce chain=base
function main(recipient: Address, amount: Uint256): void {
  require(USDC.balanceOf(ctx.self()) >= amount, "not delivered yet");
  USDC.transfer(recipient, amount);
}
```

Submitted early, it reverts. A revert undoes everything, the use of its salt included, so the
signature still runs for the submission that comes once the USDC has arrived.

## Running it from another program

`submit(pot, program, salt, deadline, signature)` makes the Pot's `execute` call from a program, and
returns what the signed program returned. A program that pays into the owner's Pot and runs the
owner's program there does both or neither, in one transaction:
[`examples/deliver-and-run.sauce.ts`](examples/deliver-and-run.sauce.ts).

```sauce chain=base
import { submit } from "@sauce/signed";

function main(pot: Address, amount: Uint256, program: bytes, salt: Uint256, deadline: Uint256, signature: bytes): void {
  USDC.transfer(pot, amount);
  submit(pot, program, salt, deadline, signature);
}
```

## A hop that runs the owner's program

A hop's body runs on the destination's Shared Pot, which keeps nothing between transactions and
answers anyone. With a signed program, the body can hand what it received to the owner's own Pot
there and run the owner's program on it, in the same fill. If the program refuses, the fill fails
whole and nothing is delivered.

The body reads only what is fixed when the intent is published: numbers, addresses and booleans
from `main`, and the file's constants. So the signed call is written into the file:

1. Sign the program for the owner's Pot on the destination with `sauce sign --chain base`.
2. Write the `execute.data` it printed into the file as `SIGNED`.
3. Publish the intent.

```sauce chain=ethereum
// The call sauce sign printed for the owner's Pot on Base, `execute.data`, written in whole.
const SIGNED = hex`82bf0988`;

function main(pot: Address, amount: Uint256, refundTo: Address) {
  const delivered = amount - (amount * 10) / 10000; // the solver keeps 0.1%
  Base.hop({
    send: { token: USDC, amount },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    // On Base: pay the owner's Pot, then run what the owner signed there.
    USDC.transfer(pot, delivered);
    evm.call(pot, 0, SIGNED);
  });
}
```

The program signed for Base must ask for no more than `delivered`, and should `require` it, as
`pay-when-delivered` does. Its deadline must outlast the intent's.

## Cancelling a signature

Only an unused salt can be cancelled. The owner marks it used with a program it cooks on the Pot,
and the signature never runs:
[`examples/cancel-salt.sauce.ts`](examples/cancel-salt.sauce.ts), `Signed.cancel(salt)`.
`Signed.invalidate(word, mask)` cancels up to 256 at once: the salts `word * 256` to
`word * 256 + 255` whose bits `mask` sets. Both set the Pot up too, if it is not yet. The Pot logs `SaltsCancelled(uint256 indexed word, uint256 mask)`.
`isUsed(salt)` reads whether a salt was used or cancelled.

## One signature for several chains

`executeAcross` runs one chain's program from a signature over a program per chain, for a flow
that crosses chains. A Private Pot has the same address on every chain its owner mints it on, so
the domain names the Pot and no chain:

```json
{
  "domain": { "name": "Sauce Pot", "version": "1", "verifyingContract": "<pot>" },
  "types": {
    "Executions": [{ "name": "executions", "type": "Execution[]" }],
    "Execution": [
      { "name": "chainId", "type": "uint256" },
      { "name": "program", "type": "bytes" },
      { "name": "salt", "type": "bytes32" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "Executions",
  "message": { "executions": ["<one per chain>"] }
}
```

On each chain the caller passes four things:

- that chain's `program`, `salt` and `deadline`;
- `executions`, the EIP-712 hash of every execution in the order signed;
- `index`, where that chain's sits;
- the signature.

The Pot hashes its own chain's execution and checks it sits at `index`. Each chain's salt runs once
there.

## The Pot as a signer

`isValidSignature(hash, signature)` answers EIP-1271's magic value when the owner signed `hash` for
this Pot. It is the Pot's one EIP-1271 handler, `@sauce/async`'s, which this package installs, and
which also answers for a hash a program running as the Pot approved (`Erc1271.approve(hash)`, in
`sauce-async`). The owner signs `hash` bound to the Pot, never `hash` itself:

```json
{
  "domain": { "name": "Sauce Pot", "version": "1", "chainId": 8453, "verifyingContract": "<pot>" },
  "types": { "PotMessage": [{ "name": "hash", "type": "bytes32" }] },
  "primaryType": "PotMessage",
  "message": { "hash": "<hash>" }
}
```

- **Permit2 takes the Pot as a signer.** A contract that checks signatures with EIP-1271, Permit2
  included, takes the Pot as the signer. A Permit2 permit's `hash` is its EIP-712 digest.
- **A signature made for anything else is not the Pot's.** That includes the owner's signature of
  the same permit for its own account, and one bound to another of its Pots or another chain.
  Without the binding, a permit the owner signed for its own account would also spend the Pot's
  tokens.

## What is refused

| Revert                                                    | Why                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `signed: not the owner's signature`                       | another signer, Pot or chain, a changed byte, a malleable twin |
| `signed: the salt was used or cancelled`                  | the salt ran, or the owner cancelled it                        |
| `signed: the deadline has passed`                         | after `deadline`                                               |
| `signed: the execution at that index is not this chain's` | `executeAcross` given another chain's execution                |
| the program's own revert                                  | what it `require`d is not true yet: its salt stays unused      |

## What it costs

Measured on a local chain, a program that returns a number, whole transactions:

| Path                                               | Gas      |
| -------------------------------------------------- | -------- |
| the owner cooks the program itself                 | ~48,000  |
| `execute`, the salt's word new to the Pot          | ~138,000 |
| `execute`, the salt's word already written         | ~121,000 |
| `isValidSignature` on the Pot                      | ~81,000  |
| installing the package (three calls), once per Pot | ~780,000 |

Salts that share a word (the same `salt >> 8`) are cheaper after the first: pick them in a run when
signing many.
