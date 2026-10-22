# Kitchen, Pot and cook

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Architecture](architecture.md)

> Your program is a recipe. Your **Pot** is your own kitchen counter on the blockchain: it holds your
> ingredients (tokens) and follows your recipe step by step. A **cook** is one go at the recipe, and
> if any step fails, nothing happens at all, as if you never started. The **Kitchen** is the shop
> that builds the counters and charges a small fee for each go.

This page says what each of the three does, and who may do what with it. It builds on
[What Sauce is](what-is-sauce.md), and the [quick start](../guides/quick-start.md) shows all three
at work. What they cost is on [Costs](costs.md), and what to check before you sign on
[Safety](safety.md).

|             | What it is                                                                      | What it does for you                                                                        |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Pot**     | Your account on chain: a small contract with one owner, created by the Kitchen  | Holds the tokens your programs spend, and is the address every call of a program comes from |
| **Cook**    | The transaction that runs a program: `cook(engine, program)`, sent to your Pot  | Runs one compiled program, every step or none, and pays the Kitchen's fee                   |
| **Kitchen** | The contract that creates Pots, at the same address on every EVM chain it is on | Gives your Pot an address known before it exists, and sets the fee each cook pays           |

The fourth piece is the **engine**, the interpreter that executes Sauce bytecode. A cook names the
engine, and on an EVM chain the engine runs only inside a Pot its Kitchen created, so a cook is the
only way to reach it. You never call the engine yourself: the SDK and the `sauce` command name the
released one.

Up to [On Solana](#on-solana), this page describes an EVM chain, such as Ethereum or Base. Solana
has the same three roles, and that section says what differs.

## A Pot's life

1. **Its address comes first.** A Pot's address follows from the Kitchen, its owner and a salt, so
   it is known before the Pot exists and never changes. An owner has one Pot per salt, a label,
   and the first one's is zero.
2. **It is deployed once.** The Kitchen's `deployPot(owner, salt)` creates it. Anyone may send that
   transaction, and the Pot is the owner's whoever sends it; sending it again returns the Pot
   already there. You need not do it as a step of your own: the `sauce` command deploys your Pot
   the first time a run needs it.
3. **It is funded like any address.** Send it tokens or native coin from any wallet, or let a run
   pull them from your wallet in the same transaction ([Run a program](../guides/cli-run.md)).
4. **Its owner cooks programs on it.** Each cook is one transaction from the owner to the Pot, and
   runs one program. The next section says what happens inside.
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

1. checks that the sender is its owner, and refuses anyone else: the cook reverts with the error
   `NotOwner()`;
2. forwards the fee to the Kitchen;
3. runs the engine's code inside itself, on its own balances, so the program runs **as the Pot**.

Running as the Pot is what makes a program useful:

- `ctx.self()` is the Pot, and so is `self`: `self.USDC` is what the Pot holds.
- Every call the program makes comes from the Pot. A protocol sees the Pot as its caller, an
  approval is the Pot's, and a swap's output lands in the Pot unless the program names another
  recipient.
- The steps run in order inside the one transaction. A failed `require`, or any call that reverts,
  reverts the whole cook, the fee with it: nothing moves, and only the gas is spent.
- What `main` returns comes back from the cook. `sauce simulate` prints it, read as the type `main`
  declares.

The quick start's program shows the first and the third:

```js
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

`self.USDC` reads the Pot's balance, and `USDC.transfer` pays from the Pot. `main`'s arguments
travel in the cook, after the program, so one compiled program serves every call with different
values. A pool that calls back in the middle of a swap reaches the Pot again, and the Pot hands that
callback to its Router, a helper contract for swaps: [A Pot's Router](architecture.md#a-pots-router)
explains it.

## Where a program's results end

What a cook produces lands where the program sends it, and a call that credits its caller credits
the Pot. A swap with no other recipient, a lending market's receipt tokens supplied for
`ctx.self()` (Aave's aTokens, with `onBehalfOf` the Pot), a vault's shares minted to the Pot: all
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

|                     | Can                                              | Cannot                                                                 |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| The Pot's owner     | Cook any program on it; change an unfixed Router | Hand it to another owner: the owner is fixed when the Pot is created   |
| Anyone else         | Deploy a Pot for any owner; send a Pot tokens    | Cook on it, or move anything it holds                                  |
| The Kitchen's owner | Set the fee; choose the Router new Pots start on | Change an existing Pot, its owner or its Router, or move what it holds |
| The engine          | Run a program inside a Pot its Kitchen created   | Run anywhere else: called directly, it refuses                         |

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
- In a program there, `ctx.self()` is the engine's program id, not the Pot; `self` as a token
  holder is still the Pot.
- A program can also run directly on the engine, with no Pot. It then has only the signers its
  transaction gives it.

[How Sauce runs on Solana](solana-model.md#the-pot-on-solana) explains the Pot's account, staging a
large program and the two ways to cook.

## Other kinds of Pot

Everything above describes the default kind, a **private Pot**: one owner, who alone may cook on
it. The Kitchen also makes **Shared Pots**, which have no owner: anyone can cook on one and spend
what it holds, so a Shared Pot is funded and emptied within one transaction.
[Pots and cooks in code](../api/README.md#pots-and-cooks-in-code) lists the Kitchen calls for each
kind.

## Next

- Write a program of your own and simulate it:
  [Write your first program](../guides/write-your-first-program.md).
- Which piece does which job, from your source to the chain: [Architecture](architecture.md).
