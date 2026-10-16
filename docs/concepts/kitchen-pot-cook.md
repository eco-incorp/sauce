# Kitchen, Pot and cook

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Architecture](architecture.md)

> Your program is a recipe. Your **Pot** is your own kitchen counter on the blockchain: it holds your
> ingredients (tokens) and follows your recipe step by step. A **cook** is one go at the recipe, and
> if any step fails, nothing happens at all, as if you never started. The **Kitchen** is the shop
> that builds the counters and charges a small fee for each go.

This page says what each of the three does, and who may do what with it.

|             | What it is                                                                      | What it does for you                                                                        |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Pot**     | Your account on chain: a small contract with one owner, created by the Kitchen  | Holds the tokens your programs spend, and is the address every call of a program comes from |
| **Cook**    | The transaction that runs a program: `cook(engine, program)`, sent to your Pot  | Runs one compiled program, every step or none, and pays the Kitchen's fee                   |
| **Kitchen** | The contract that creates Pots, at the same address on every EVM chain it is on | Gives your Pot an address known before it exists, and sets the fee each cook pays           |

The fourth piece is the **engine**, the interpreter that executes Sauce bytecode. A cook names the
engine, and on an EVM chain the engine runs only inside a Pot its Kitchen created, so a cook is the
only way to reach it. You never call the engine yourself: the SDK and the `sauce` command name the
released one.

Up to [On Solana](#on-solana), this page describes an EVM chain. Solana has the same three roles,
and that section gives its details.

## A Pot's life

1. **Its address comes first.** A Pot's address follows from the Kitchen, its owner and a salt, so
   it is known before the Pot exists and never changes. `sauce pot --chain base --owner <address>`
   prints it. An owner has one Pot per salt, and the default salt is zero.
2. **It is deployed once.** The Kitchen's `deployPot(owner, salt)` creates it. Anyone may send that
   transaction, and the Pot is the owner's whoever sends it; sending it again returns the Pot
   already there. You need not do it as a step of your own: a command deploys your Pot when it
   first needs it (asks, or `--yes`), `sauce tx` puts the deployment first, and on Solana the
   cook's own transaction creates it. `sauce pot --deploy` does it by hand.
3. **It is funded like any address.** Send it tokens or native coin from any wallet, or let
   `sauce run --fund` pull them from your wallet as part of the run.
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

`sauce tx` prints exactly that, unsigned, for any wallet to sign; `sauce run` signs and sends it.
When the Pot receives it, the Pot:

1. checks that the sender is its owner, and refuses anyone else with `NotOwner()`;
2. forwards the fee to the Kitchen;
3. runs the program with the engine's code in its own context (a `delegatecall`), so the program
   runs **as the Pot**.

Running as the Pot is what makes a program useful:

- `ctx.self()` is the Pot, so `USDC.balanceOf(ctx.self())` is what the Pot holds.
- Every call the program makes comes from the Pot. A protocol sees the Pot as its caller, an
  approval is the Pot's, and a swap's output lands in the Pot unless the program names another
  recipient.
- The steps run in order inside the one transaction. A failed `require`, or any call that reverts,
  reverts the whole cook, the fee with it: nothing moves, and only the gas is spent.
- What `main` returns comes back from the cook. `sauce simulate` prints it, read as the type `main`
  declares.

```js
function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self()); // what the Pot holds
  require(held >= floor, "not enough USDC in the Pot"); // below it, nothing moves
  USDC.transfer(recipient, held); // the Pot pays
}
```

`main`'s arguments travel in the cook, after the program, so one compiled program serves every call
with different values. A pool that calls back in the middle of a swap reaches the Pot again, and the
Pot hands that callback to its Router: [A Pot's Router](architecture.md#a-pots-router) explains it.

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

The `sauce` command says which it was, before and after. A simulation (`sauce simulate`) and a sent
cook (`sauce run`) lead with what the Pot holds after the cook of each token the cook moved, with
what it held before; a cook that leaves the Pot nothing prints none:

```text
The cook succeeds from 0x0305…262A: gas used 268566 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  0.999999 aBasUSDC
  Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
```

`--json` gives it as `leftInPot`, first after `ok`. It counts tokens: a position a protocol keeps in
its own books, with no token for it, shows in no balance. Below it, what moved is listed in order,
each party by its role (`wallet`, `Pot`, `Kitchen`, a registry name, a token's symbol, `mint` and
`burn`). Before sending, review three things together: the final program, the arguments it is
called with, and what the simulation says will happen, meaning what leaves your wallet, what arrives
where, and what stays in the Pot. A sent transaction prints its explorer page and its trace on
BlockSec's Phalcon explorer (its calls and balance changes), to open in a browser.

## Who can do what

|                     | Can                                              | Cannot                                                                 |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| The Pot's owner     | Cook any program on it; change an unfixed Router | Hand it to another owner: the owner is fixed when the Pot is created   |
| Anyone else         | Deploy a Pot for any owner; send a Pot tokens    | Cook on it, or move anything it holds                                  |
| The Kitchen's owner | Set the fee; choose the Router new Pots start on | Change an existing Pot, its owner or its Router, or move what it holds |
| The engine          | Run a program inside a Pot its Kitchen created   | Run anywhere else: called directly, it refuses                         |

A Pot's code never changes once it is deployed: it is not a proxy, and nothing upgrades it. To give
what a Pot holds to someone else, cook a program that transfers it to them, or to their own Pot.

## The fee

Every cook pays the Kitchen's current `executionFee()` in the chain's native coin, as the cook's
value, even when the program moves only tokens. What the Pot already holds does not pay it, and
native coin the program spends comes on top. The fee is on-chain state, read when the cook is
built: `sauce run` and `sauce tx` read it, and in TypeScript `destinationExecutionFee()` builds the
read. A cook that reverts pays no fee. The Kitchen's owner sets the fee and withdraws what the
Kitchen collects.

## Your Pot and the intent Pot

Your own programs run on your Pot. An intent's body runs as a cook too, on the destination chain,
but on a Pot that is not yours: the one owned by that chain's eco-routes Executor under salt zero,
which every solver's fulfillment drives. The solver deploys it and pays the fee for the cook. Every
intent to that chain shares that Pot, so a body takes out everything it brought in within the same
fulfillment: anything left behind is anyone's.
[The destination Pot](../guides/intents.md#the-destination-pot) covers the details.

## On Solana

The three roles are the same; Solana's account model changes the details.

- The **Kitchen** is a program, with the same id on every cluster:
  [Deployments](../reference/deployments.md#solana) lists it with the engine's.
- A **Pot** is an account at the Kitchen's program address for the seeds `"pot"`, the owner and the
  salt. The engine owns its data, which is where a program keeps storage, and the Pot holds tokens
  in token accounts whose owner it is. The owner creates it with the Kitchen's `create_pot`, paying
  its rent, and its size is fixed then; `sauce run` asks before creating a missing one.
- A **cook** is the Kitchen's `cook` instruction, signed by the owner, or `cook_from_account` for a
  program too large for a transaction, staged into an account first. The Kitchen charges the fee in
  lamports, then calls the engine and signs for the Pot.
- A program is given the Pot as an account (`--account pot=pot`), and `ctx.self()` there is the
  engine's program id, not the Pot.
- A program can also run directly on the engine, with no Pot (`--via engine`). It then has only the
  signers its transaction gives it.

The [Solana guide](../guides/solana.md) covers accounts, staging and both ways to cook.

## Other kinds of Pot

The SDK's convenience helpers use **private Pots**. The Kitchen also exposes
`deployPot(owner, salt, true)` for a private Pot with an immutable Router, and
`deploySharedPot(salt)` for an ownerless **Shared Pot** whose Router is always immutable. Anyone
can cook on an ownerless Shared Pot and spend its funds; fund and consume it within one transaction.
Use `v12KitchenAbi` for these variants. The lifecycle and permissions above describe the default
private Pot. An intent's executor-owned Pot is private even though several intents share it.

## In code

| To                          | With the `sauce` command                        | In TypeScript                                                                    |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Find a Pot's address        | `sauce pot --owner <address>`                   | `v12PredictPot(owner, salt)` from `@eco-incorp/sauce`                            |
| Deploy a Pot                | `sauce run` (when needed), `sauce pot --deploy` | `routes.sauceEvmDeployPotCall({ owner, salt })`                                  |
| Simulate a cook             | `sauce simulate`                                | an `eth_call` of the cook from the owner, on a deployed Pot                      |
| Build a cook                | `sauce tx`                                      | `v12Pot.encodeCook(engine, program)` from `@eco-incorp/sauce/evm/engine`         |
| Send a cook                 | `sauce run`                                     | your own wallet client, with the cook as `to`, `data` and `value`                |
| Read the fee                | read by `sauce run` and `sauce tx`              | `destinationExecutionFee()`                                                      |
| Find the Kitchen and engine | `sauce pot` prints the Kitchen                  | `v12KitchenAddress()`, `v12EngineAddress()` from `@eco-incorp/sauce/deployments` |

The [CLI guide's EVM flow](../guides/cli-run.md) runs a program on your own Pot
from start to finish, and [cross-chain-intent.ts](../examples/cross-chain-intent.ts) builds the same
cook from TypeScript.
