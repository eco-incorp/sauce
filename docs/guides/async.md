# Waiting for a callback

[Documentation](../README.md) · [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md)

Some protocols answer later, in a transaction of their own: a random number, an oracle's report, a
message from another chain, a proof. In Sauce a program asks now, and the code that uses the answer
is the request's `.then` body. The request is a promise: it
settles exactly once, fulfilled with a value or rejected with a reason. The body is compiled with
the program and runs when the protocol calls the Pot back, as the same Pot.

```js
Random.vrf({ words: 1 }).then((words) => {
  USDC.transfer(words[0] % 2 == 0 ? heads : tails, prize);
});
```

`Random.vrf` stands for a protocol's package. Every such package is built on `@sauce/async`, the
library this page describes, which the SDK resolves with no install.

## What a callback needs

- **A Private Pot with the package's handlers installed.** The protocol calls the Pot with a
  selector of its own. The Pot's Router answers it with the program its owner registered for that
  selector: the handler, which checks the call came from the protocol and settles the promise the
  callback names. A Shared Pot, and a Private Pot whose Router is fixed, answer no callback.
- **The native coin for the fee.** Each callback is a cook, and the Router pays the Kitchen's fee
  from the Pot's own balance.

Install a package's handlers once per Pot by giving the package where a program file goes:

```sh
sauce run @sauce/<package> --chain base --wallet <name>
```

`sauce compile`, `sauce tx` and `sauce simulate` take the package the same way: one cook, an
`install` for each selector the package answers and each ERC-165 interface it declares, with the
Pot's public `expire(bytes32)`. From TypeScript, `routes.packageInstall(chain, specifier)` compiles
a package's handlers for a chain, and `routes.handlersInstallSource(handlers, name, interfaces)`
writes the program that installs them.

## What the body sees

- **The program around it, as it was at the request.** Every value the body reads from the program
  is carried into it when the request is made, and the body cannot assign it. What the protocol
  delivers arrives as the body's parameters, decoded by the package.
- **One settlement.** The same answer delivered again, or one arriving after the promise settled,
  runs nothing and returns, so the protocol's transaction never fails for it. A call from anyone
  but the protocol is refused.
- **`.catch` in its place.** `.catch((e) => { … })` runs when the promise is rejected and when the
  body reverts, with everything the body did undone. With no `.catch`, the rejection is logged and
  the callback still returns.

## Combinators, timeouts and deferreds

`Promise.all`, `race`, `any`, `allSettled`, `resolve`, `reject` and `withResolvers` behave as
JavaScript's, folded while the program compiles:

```js
import { Async, Promise } from "@sauce/async";

Promise.race([Oracle.price(feed), Async.timeout(3600)])
  .then((price) => { … })
  .catch((e) => { … }); // the oracle failed, or an hour passed
```

- A request's `.within(seconds)` gives it a deadline. After it, anyone may call the Pot's
  `expire(bytes32 key)`, which rejects the promise with `Timeout(bytes32 key)`. The caller pays
  the Kitchen's fee as the call's value: the Router pays every handler's cook from the Pot's
  balance, so a handler anyone could call for free would let anyone drain the Pot, one fee a call.
- `Promise.withResolvers()` makes a promise the program settles itself in a later transaction. The
  Pot logs its key, `PromisePending(bytes32 key, uint256 deadline)`, and a later cook of the owner
  settles it with `Async.resolve(key, value)` or `Async.reject(key, reason)`.

## Writing a package

A package's request is a method on an object the program reads, or a plain function, returning a
`Request`; or a class that extends `Request` and hands `super` the same options. The three compile
to the same program:

```js
import { Request, promiseKey } from "@sauce/async";

class EchoProtocol {
  request(protocol, value) {
    return new Request({
      // At run time, when the statement ends: make the request, and answer the promise's key, the
      // protocol's id under a tag naming the protocol.
      send: (continuation) => {
        const asked = evm.call(protocol, 0, hex`d845a4b3`.concat(abi.encode(value))); // request(uint256)
        return promiseKey(7, abi.decode(asked, ["Uint256"])[0]);
      },
      // In the body's program, when the promise is fulfilled: decode what arrived, or fail.
      deliver: (input, body, fail) => body(abi.decode(input, ["Uint256"])[0]),
    });
  }
}
```

A protocol that carries the requester's bytes back, such as a bridge's message, says `carries:
true`. Its `send` is then handed the promise's key and the body's program to carry, and a plain
`.then` stores nothing on the Pot.

The package lists its handlers in its `package.json`. Each is a program
`main(caller: Address, value: Uint256, data: bytes)`, compiled for the Pot's chain:

```json
{
  "handlers": [{ "selector": "echo(uint256,uint256)", "program": "echo.handler.js" }],
  "interfaces": []
}
```

```js
import { fulfil, promiseKey, requireCaller } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): void {
  requireCaller(Echo, caller); // the protocol's contract, as the chain names it
  const [id, echoed] = abi.decode(data.slice(4, data.length), ["Uint256", "Uint256"]);
  fulfil(promiseKey(7, id), abi.encode(echoed));
}
```

A declaration's `requires` lists the contracts it needs (`Namespace.Contract`), so a chain without
one skips that handler. `interfaces` lists the ERC-165 ids the Pot declares, for a protocol that
checks its receiver before it calls back.

| `@sauce/async`                                                                       | Does                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `fulfil(key, value)`, `reject(key, reason)`                                          | Settle a promise and run its body or its `.catch`; a settled key, nothing.            |
| `settleCarried(key, stored, program, value, ok)`                                     | The same, for a protocol that carried the body back.                                  |
| `promiseKey(tag, id)`                                                                | A protocol's id as a promise's key.                                                   |
| `requireCaller(expected, actual)`, `requireSelf(sender)`                             | A handler's checks: the protocol called; this Pot sent the message.                   |
| `expire(key)`                                                                        | Reject a promise past its deadline with `Timeout(bytes32)`.                           |
| `install(selector, program, readOnly)`, `declareInterface(id, supported)`            | What installing a package's handlers calls.                                           |
| `winner()`                                                                           | In a race's or an any's continuation: the child that settled it.                      |
| `received()`, `fulfilled()`                                                          | Deprecated: what `run` handed its program. A continuation takes it as its parameters. |
| `park`, `run`, `salt`, `isPending`                                                   | The settlement table's parts, for a package that needs them directly.                 |
| `Erc1271.approve(hash)`, `Erc1271.revoke(hash)`, `isValidSignature(hash, signature)` | The Pot as an ERC-1271 signer (above).                                                |

## The Pot as a signer

A Pot answers ERC-1271's `isValidSignature(bytes32 hash, bytes signature)` with one handler the
core ships, `@sauce/async/erc1271.handler.js`, which a package that needs the Pot to sign declares
as its own (a view). Installing two such packages installs it once. It is valid for:

- a hash a program running as the Pot approved, `Erc1271.approve(hash)` (and `Erc1271.revoke`),
  kept in the ERC-7201 namespace `sauce.storage.Erc1271`, whatever the signature bytes, since the
  approval is the authorization: a request the Pot made itself, which a
  market checks with at most 100,000 gas before it spends the Pot's deposit. The check is one
  storage read, about 42,000 gas for the call;
- the owner's signature over the hash bound to the Pot, EIP-712's `PotMessage { hash: bytes32 }`
  under the domain `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: the Pot }`: never
  over the bare hash, so a signature the owner made for its own account or another Pot is not this
  Pot's. A malleable signature (an upper-half `s`) is refused, and an owner that is a contract is
  asked ERC-1271 itself, as OpenZeppelin's `SignatureChecker` does.

## Storage and cost

A pending promise is one word in the Pot's storage, in the ERC-7201 namespace
`sauce.storage.Async`: the address of its body's code, its deadline, its state and its flags. Up
to three words the body captured sit beside it, and more go into code. The body's code is deployed
once per Pot, by CREATE2 at an address its bytes decide, and shared by every request that compiles
to it. Settling clears the word. A carried `.then` stores nothing. A combinator parks a word of its
own and one per child, and keeps each child's value until it is decided: a value of a word or less
in a storage slot, a longer one as code, which costs a CREATE2 but less for each further word.

## Owner-signed programs: `@sauce/signed`

A Private Pot runs a program when its owner cooks it. With `@sauce/signed` installed, it also runs
a program its owner **signed**, for whoever submits it: a relayer that pays the gas, a counterparty
that pays in and runs the owner's side in the same transaction, or a hop's body that delivers to
the owner's Pot on another chain. The Pot runs it with everything it holds, once, only if:

- the owner signed it for this Pot, on this chain;
- it is exactly the bytes signed, its arguments included;
- its salt is not used yet;
- its deadline has not passed.

Install it once per Pot:

```sh
sauce run @sauce/signed --chain base --wallet <name>
```

The Pot then answers three calls:

| Call                                                                                                                 | Mode                      | Does                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `execute(bytes program, bytes32 salt, uint256 deadline, bytes signature)`                                            | cook, paid by the Pot     | Runs `program` when the owner signed it, and returns what it returns                       |
| `executeAcross(bytes program, bytes32 salt, uint256 deadline, bytes32[] executions, uint256 index, bytes signature)` | cook, paid by the Pot     | The same, from one signature over a program per chain                                      |
| `isValidSignature(bytes32 hash, bytes signature)`                                                                    | view, static, with no fee | EIP-1271 for the Pot, the core's handler: the owner's signature of `hash` bound to the Pot |

### Signing from TypeScript

The owner signs EIP-712 typed data, so any wallet can. `routes` builds it and the call:

```ts
import { routes } from "@eco-incorp/sauce";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const owner = createWalletClient({ account: privateKeyToAccount(key), transport: http(rpcUrl) });
const compiled = routes.compileSauceProgram("base", source);
const execution = {
  pot, // the owner's Private Pot on Base
  chainId: 8453,
  program: routes.signedProgram(compiled, [recipient, 25_000_000n]), // bytecode ++ arguments
  salt: routes.signedSalt(), // 32 random bytes; each runs once
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
};
const signature = await owner.signTypedData(routes.executeTypedData(execution));
// Anyone sends it: { to: pot, data, value: 0 }.
const data = routes.encodeExecute({ ...execution, signature });
```

The domain is `{ name: "Sauce Pot", version: "1", chainId, verifyingContract: pot }` and the
message `Execute { bytes program, bytes32 salt, uint256 deadline }`. The signature is the owner's
65-byte signature with `s` in the lower half of the curve's order, which every wallet makes. An
owner with code answers EIP-1271 instead, with a signature of any length.

### Signing from the command line

`sauce sign` compiles a program with `main`'s arguments as `sauce tx` does. It prints the typed
data, and with the owner's key the signature and the `execute` call for anyone to send:

```sh
sauce sign pay.sauce.ts --chain base --wallet <name> --within 3600 --args 0x… 25000000
```

- **With no signer**, it prints the typed data alone.
- **The deadline** is `--within <seconds>` from now, or `--deadline <unix seconds>`.
- **The salt** is random unless `--signed-salt` gives one.

### The program the owner signs

Anyone may submit a signed program as soon as it exists, so it checks what it needs to be true when
it runs:

```js
function main(recipient: Address, amount: Uint256): void {
  require(USDC.balanceOf(ctx.self()) >= amount, "not delivered yet");
  USDC.transfer(recipient, amount);
}
```

Submitted early, it reverts. A revert undoes the use of its salt too, so the same signature runs
once the USDC is there.

- **From another program:** `submit(pot, program, salt, deadline, signature)` from `@sauce/signed`
  makes the call. A program that pays into the owner's Pot and then submits does both or neither.
- **From a hop:** the body on the destination's Shared Pot transfers what it received to the owner's
  Pot and calls its `execute`, all in the fill. A hop's body reads only what is fixed when the
  intent is published, so the signed call is written into the file as a constant:
  `evm.call(pot, 0, SIGNED)`.

### Cancelling, and one signature for several chains

- **Cancelling:** the owner cancels an unused salt with a program it cooks, `cancel(salt)`.
  `invalidate(word, mask)` cancels up to 256 salts that share a word. Salts are Permit2's unordered
  nonces: one bit per salt, 256 to a word, in the ERC-7201 namespace `sauce.storage.Signed`.
  `routes.signedSaltSlot(salt)` says where a salt is recorded, and `routes.cancelSaltsSource(salts)`
  writes the cancelling program.
- **Several chains:** `executeAcross` takes one signature over `Executions { Execution[] }`, each
  `{ chainId, program, salt, deadline }`, under a domain with no chain id. A Private Pot has the
  same address on every chain. `routes.executeAcrossTypedData` and `routes.encodeExecuteAcross`
  build both sides.

### Permit2 and EIP-1271

`@sauce/signed` installs the core's ERC-1271 handler ([The Pot as a signer](#the-pot-as-a-signer)).
Its owner signs `PotMessage { bytes32 hash }` under the Pot's domain (`routes.potMessageTypedData`),
never `hash` itself. Permit2 then takes the Pot as a signer. A permit the owner signs for its own
account is never spent from the Pot, nor one bound to another of its Pots.

### What it costs

Whole transactions on a local chain, the program returning a number:

| Path                                                   | Gas      |
| ------------------------------------------------------ | -------- |
| The owner cooks the program itself                     | ~48,000  |
| `execute`, a salt whose word is new to the Pot         | ~138,000 |
| `execute`, a salt whose word is already written        | ~121,000 |
| The same check written in Solidity, then the same cook | ~75,000  |
| `isValidSignature` on the Pot                          | ~81,000  |
| Installing the package, once per Pot                   | ~780,000 |

The difference from Solidity has three parts:

- the Router's dispatch, which every handler pays;
- the engine running the check;
- the call that runs the signed program inside the same cook.

A native `execute` is possible as a Router function. It would not touch the Pot contract.
