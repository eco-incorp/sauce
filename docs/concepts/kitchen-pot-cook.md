# Kitchen, Pot and cook

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Architecture](architecture.md)

> Your program is a recipe. Your **Pot** is your own kitchen counter on the blockchain: it holds your
> ingredients (tokens) and follows your recipe step by step. A **cook** is one go at the recipe, and
> an uncaught failure undoes the whole cook. On EVM a caught failure can undo just its recovery
> boundary and let the recipe continue. The **Kitchen** builds the counters and charges a fee.

This page says what each of the three does, and who may do what with it. It builds on
[What Sauce is](what-is-sauce.md), and the [quick start](../guides/quick-start.md) shows all three
at work. What they cost is on [Costs](costs.md), and what to check before you sign on
[Safety](safety.md).

|             | What it is                                                                      | What it does for you                                                                        |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Pot**     | Your account on chain: a small contract with one owner, created by the Kitchen  | Holds the tokens your programs spend, and is the address every call of a program comes from |
| **Cook**    | The transaction that runs a program: `cook(engine, program)`, sent to your Pot  | Runs one compiled program, reverts on uncaught failure, and pays the Kitchen's fee          |
| **Kitchen** | The contract that creates Pots, at the same address on every EVM chain it is on | Gives your Pot an address known before it exists, and sets the fee each cook pays           |

The fourth piece is the **engine**, the interpreter that executes Sauce bytecode. A cook names the
engine, and on an EVM chain the engine runs only inside a Pot its Kitchen created, so a cook is the
only way to reach it. You never call the engine yourself: the SDK and the `sauce` command name the
released one.

Up to [On Solana](#on-solana), this page describes an EVM chain, such as Ethereum or Base. Solana
has the same three roles, and that section says what differs.

## A Pot's life

1. **Its address comes first.** For an EVM Kitchen release, a Pot's address follows from the
   Kitchen, its Pot init-code hash, its owner and a salt (zero by default). It is known before
   deployment and fixed once deployed. A release with new Pot code derives a different address
   for the same owner and salt; it does not move an existing Pot or its balances.
2. **It is deployed once.** The Kitchen's `deployPot(owner, salt)` creates it. Anyone may send that
   transaction, and the Pot is the owner's whoever sends it; sending it again returns the Pot
   already there. You need not do it as a step of your own: the `sauce` command deploys your Pot
   the first time a run needs it.
3. **It is funded like any address.** Send it tokens or native coin from any wallet, or let a run
   pull them from your wallet in the same transaction ([Run a program](../guides/cli-run.md)).
4. **Its owner authorizes programs on it.** Normally the owner sends a `cook` transaction to the
   Pot. Newly created Pots also support [signed cooks](#signed-cooks).
5. **What it holds leaves only through a cook.** A Pot has no withdraw function: a program moves
   its tokens out, in the cook that produced them or in a later one.

## What a cook does

A cook is one transaction with three parts:

```text
to:     your Pot
data:   cook(engine, program)    program = the compiled bytecode, then main's arguments
value:  the Kitchen's fee        plus any native coin the program spends
```

The `sauce` command builds it, and signs and sends it or hands it to another wallet
([Wallets and signing](../guides/cli-wallets.md)). When the Pot receives it, the Pot:

1. checks the owner's authorization: `cook` requires the owner as sender (`NotOwner()` otherwise);
   on new Pots, `cookSigned` instead checks the owner's signed authorization;
2. forwards the fee to the Kitchen;
3. runs the engine's code inside itself, on its own balances, so the program runs **as the Pot**.

Running as the Pot is what makes a program useful:

- `pot` is the Pot (the compiler's `ctx.self()`): `pot.USDC` is what the Pot holds.
- Every call the program makes comes from the Pot. A protocol sees the Pot as its caller, an
  approval is the Pot's, and a swap's output lands in the Pot unless the program names another
  recipient.
- Steps run in order inside one transaction. An uncaught failed check or call reverts the whole
  cook, fee included. On EVM an atomic `try` can undo its own work and run a handler instead;
  work outside that block remains. Solana has no catch support.
- What `main` returns comes back from the cook. `sauce simulate` prints it, read as the type `main`
  declares.

The quick start's program shows the first and the third:

```js
function main(to: Address, amount: Uint256) {
  require(pot.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

`pot.USDC` reads the Pot's balance, and `USDC.transfer` pays from the Pot. `main`'s arguments
travel in the cook, after the program, so one compiled program serves every call with different
values. A pool that calls back in the middle of a swap reaches the Pot again, and the Pot hands that
callback to its Router, a helper contract for swaps: [A Pot's Router](architecture.md#a-pots-router)
explains it.

## Signed cooks

An owner can sign a cook off-chain, and any account can then submit it. A relayer can pay the gas, a
solver can deliver funds and run the owner's program in one transaction, a keeper can send it later.
The Pot runs it exactly as it runs the owner's own `cook`, if and only if the owner signed that
engine, that program with its arguments, that value, that fee ceiling, that nonce, that deadline and
that submitter, for that Pot, on that chain. The submitter calls `cookSigned(engine, program,
maxExecutionFee, nonce, deadline, submitter, signature)` on the Pot.

**What is signed.** The owner signs an EIP-712 `Cook` under the domain `{ name: "Sauce Pot", version:
"1", chainId, verifyingContract: the Pot }`, so one signature is good for one Pot on one chain, and a
chain whose id later changes (a fork) runs none. Each field binds one thing:

| Field             | What it binds                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `engine`          | The engine the Pot delegatecalls. It runs with the Pot's whole authority, so it is signed.                                     |
| `program`         | The bytecode with `main`'s arguments appended: exactly what the engine runs.                                                   |
| `value`           | What the submitter's `msg.value` must be. The Pot hashes what it was sent, so any other amount is `BadSignature`.              |
| `maxExecutionFee` | The most of the Kitchen's fee the Pot pays for this cook.                                                                      |
| `nonce`           | Which authorization this is: each nonce runs once.                                                                             |
| `deadline`        | The last block timestamp at which it runs, inclusive.                                                                          |
| `submitter`       | The only account that may submit it, or zero for anyone. It is the Pot's immediate caller: through a forwarder, that contract. |

Not signed: who submits when `submitter` is zero, when (up to the deadline), the gas, and the
transaction's position in its block. The program sees the submitter as its caller, so it can pay
whoever landed it.

**The fee.** A signed cook pays the Kitchen's fee once, as a cook does, but the **Pot** pays it out of
its balance, which includes the call's value, and never more than `maxExecutionFee`: the Kitchen's
owner sets the fee and may raise it after you sign. The submitter sends exactly the signed value and
pays the gas. A Pot that holds no native coin needs a signed value that covers the fee. A fee above
the smaller of the balance and the ceiling reverts with `FeeNotPaid`.

**Nonces and cancelling.** Nonces are unordered: bit `nonce & 255` of word `nonce >> 8` in the Pot's
storage is set when a nonce is used, in any order, and the bit is set before the program runs. A
cook that fails reverts everything, nonce included, so the same signature can be submitted again
until its deadline. The owner cancels nonces with `invalidateNonces(word, mask)`, which the Pot
itself may also call, so a signed cook can cancel others without the owner paying gas.
`SignedCook(nonce, submitter)` and `NoncesInvalidated(word, mask)` are the events.

**Whose signature counts.** The Pot's owner's, by `ecrecover` of a 65-byte signature, or by the
owner's ERC-1271 `isValidSignature` when the owner has code: a Safe or an EIP-7702 account signs
this way too.

**Which Pots take it.** Private Pots created with EVM Kitchen **1.3.0** or later, a fixed Router or
not. A Pot created before that keeps its code and has no `cookSigned`: a call to it goes to its
Router and reverts. A Shared Pot has no owner to have signed and refuses every signed cook. An old
Pot never acquires the method by upgrading the SDK: keep its earlier SDK/compiler/engine pairing to
manage its funds, or move them to a new Pot and sign for that one.

The SDK builds all of it: `signedCookTypedData`, `encodeCookSigned`, `encodeInvalidateNonces`,
`verifySignedCook` and `checkSignedCookPot` in `@eco-incorp/sauce/evm/engine`, `sauce sign` on the
command line, and `sauce_signed_cook` and `sauce_sign` in the MCP server.
[Signed cooks](../guides/signed-cooks.md) shows each, and what to watch for.

## Where a program's results end

What a cook produces lands where the program sends it, and a call that credits its caller credits
the Pot. A swap with no other recipient, a lending market's receipt tokens supplied for `pot`
(Aave's aTokens, with `onBehalfOf` the Pot), a vault's shares minted to the Pot: all
stay in the Pot. They are yours, but they are not in your wallet, a wallet app does not show them,
and only another cook moves them out. Decide, before writing the program, whether each result
should end in your wallet or stay in the Pot. To deliver it, the program sends it to the wallet, or
names the wallet as the call's beneficiary (`onBehalfOf`, `receiver`, `recipient`, `to`), a `main`
parameter. Keeping a position in the Pot is a choice too: a later cook can then withdraw it or
borrow against it without the wallet moving anything back first.

The `sauce` command says what stays in the Pot, before and after each cook.
[The habit: review before you sign](safety.md#the-habit-review-before-you-sign) shows that output
and what to read in it.

## Who can do what

|                     | Can                                                                                      | Cannot                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| The Pot's owner     | Cook any program on it; authorize signed cooks on new Pots; change an unfixed Router     | Hand it to another owner: the owner is fixed when the Pot is created   |
| Anyone else         | Deploy a Pot for any owner; send it tokens; submit an authorized signed cook on new Pots | Cook without the owner's authorization, or move funds without it       |
| The Kitchen's owner | Set the fee; choose the Router new Pots start on                                         | Change an existing Pot, its owner or its Router, or move what it holds |
| The engine          | Run a program inside a Pot its Kitchen created                                           | Run anywhere else: called directly, it refuses                         |

A Pot's code never changes once it is deployed: nothing upgrades it. To give what a Pot holds to
someone else, cook a program that transfers it to them, or to their own Pot.

## The fee

Every cook pays the Kitchen a flat fee in the chain's native coin, as the cook's value, even when
the program moves only tokens. What the Pot already holds does not pay it, and native coin the
program spends comes on top. The fee is on-chain state: the Kitchen's owner sets it, and withdraws
what the Kitchen collects. A cook reads it when it is built, and a cook that reverts pays none.
[Costs](costs.md) puts it beside the gas and the other costs of a run.

## On Solana

The three roles are the same, and Solana's accounts change the details:

- The **Kitchen** is a program, with the same id on every cluster
  ([Deployments](../reference/deployments.md#solana) lists it).
- A **Pot** is an account the Kitchen derives from its owner and a salt. The owner creates it and
  pays its rent, Solana's deposit for storing an account, and a run asks before creating it.
- A **cook** is the Kitchen's instruction, signed by the owner. The Kitchen charges its fee in
  lamports, then runs the program on the engine and signs for the Pot.
- In a program there, `ctx.self()` is the engine's program id, not the Pot; `pot` is still
  the Pot.
- A program can also run directly on the engine, with no Pot. It then has only the signers its
  transaction gives it.

[How Sauce runs on Solana](solana-model.md#the-pot-on-solana) explains the Pot's account, staging a
large program and the two ways to cook.

## Other kinds of Pot

Everything above describes the default kind, a **private Pot**: one owner, whose authorization
is needed for every cook. The Kitchen also makes **Shared Pots**, which have no owner: anyone can cook on one and spend
what it holds, so a Shared Pot is funded and emptied within one transaction.
[Pots and cooks in code](../api/README.md#pots-and-cooks-in-code) lists the Kitchen calls for each
kind.

## Next

- Write a program of your own and simulate it:
  [Write your first program](../guides/write-your-first-program.md).
- Which piece does which job, from your source to the chain: [Architecture](architecture.md).
