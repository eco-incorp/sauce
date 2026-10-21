# Safety

**Concept** · [Documentation](../README.md) · [Kitchen, Pot and cook](kitchen-pot-cook.md) · [Costs](costs.md)

> A program moves real tokens, so know what can go wrong before you send one. Think of signing a
> cheque: the bank checks that it is yours and that the money is there, but only you can check that
> the amount and the name are right. This page says what Sauce checks for you, what it cannot, and
> what to read before you sign.

This page is for you before you run a program with real funds. It uses the Pot, the cook and the
Kitchen ([Kitchen, Pot and cook](kitchen-pot-cook.md)) and explains; the steps to take before going
live are the [production checklist](../guides/production-checklist.md).

## What Sauce guarantees

- **Every step or none.** A program runs inside one transaction. A failed `require`, a call that
  fails, an overflow: any of them reverts the whole cook. Nothing moves, the Kitchen's fee is not
  paid, and only the gas is spent. There is never a half-finished run to clean up.
- **Only you can cook on your Pot.** Your Pot checks that each cook comes from its owner, and
  refuses anyone else with the error `NotOwner()`. The owner is fixed when the Pot is created.
  Anyone may deploy your Pot or send it tokens, and neither gives them any say over it.
- **Nobody else can change your Pot.** Its code never changes once it is deployed: nothing upgrades
  it. The Kitchen's owner can set the fee, and the swap helper (the Router) that new Pots start on,
  and nothing else: not an existing Pot, not its owner, not what it holds. Only you can point your
  Pot at another Router.
- **On Ethereum and Base, the engine runs only inside a Pot.** Called directly, it refuses, so a
  program runs only on the Pot whose owner sent it. On Solana a program can also run on the engine
  with no Pot, holding only what its own transaction's signers give it.
- **The compiler checks before anything runs.** Types, names and the shape of every call are
  checked when the program compiles, and a name the chain does not have fails the compile.
  Arithmetic is checked as it runs: an overflow, an underflow or a division by zero reverts.
- **A program's token writes are checked.** Every token write a Sauce program makes,
  `USDC.transfer(...)`, `USDC.approve(...)`, the `@sauce/token` functions and the swaps of
  `@sauce/router`, follows OpenZeppelin's SafeERC20 rules: a token that returns nothing, as USDT
  does, works; one that returns `false` reverts the cook; and an approval resets a standing one
  before it sets the new amount. The one unchecked spelling is a raw ABI call you write on purpose,
  `IERC20.at(token).transfer(...)`. [Token functions](../reference/tokens.md#token-functions) lists
  each. An intent body made only of token `transfer` and `approve` statements is not a program:
  the intent's Executor runs those as plain calls, and a token that returns `false` does not stop
  them. Any other statement in the body makes it a program, with checked writes
  ([Token-only bodies](../guides/intents.md#token-only-bodies-run-on-the-executor)).
- **Preview chains send nothing.** The `sauce` command builds and sends transactions only on
  Ethereum, Base and Solana. On every other chain a program compiles and simulates, and sending is
  refused before anything is signed ([Names and registries](names-and-registries.md)).

## What Sauce cannot check

- **That the program does what you meant.** It runs what you wrote. A wrong recipient, an amount in
  the wrong unit (1 where you meant 1 USDC, which is 1000000), a missing check: all of these
  compile, and a simulation runs them faithfully.
- **The price when your cook lands.** A simulation runs on the chain as it is now, and the chain
  moves before your transaction is included. A swap must carry its own floor, the least you will
  accept, checked inside the program, so the whole cook reverts below it.
  [Swap by name](../guides/swap-by-name.md) shows how.
- **Where your results should end.** What a program receives stays in the Pot unless the program
  sends it on. It is yours, but it is not in your wallet
  ([Where a program's results end](kitchen-pot-cook.md#where-a-programs-results-end)).
- **Allowances you leave behind.** An approval outlives the cook that made it. Approve exactly what
  the next call spends.
- **That a recorded contract is there.** Sauce records where contracts are deployed; a record is
  not proof that code is at that address today. `sauce pot` reads whether the engine and the
  Kitchen are deployed on a chain. In a program, a token write to an address with no code reverts,
  and so does a call whose result the program reads, so a simulation shows the failure.
- **That someone fills your intent.** An intent is a job others choose to do. Nobody may take it,
  and its reward then waits in its vault until the reward deadline, when you can take it back. On
  the destination, an intent's program runs on a Pot that every intent there shares, so it must
  take out everything it brings in ([Cross-chain intents](cross-chain-intents.md)).

## Keys and wallets

- **A wallet on your computer is a hot wallet.** `sauce wallet new` keeps the key encrypted under
  your password, in a file on your machine. Whoever has the file and the password has the key, so
  keep small balances in it.
- **A policy limits what a wallet sends.** A policy file beside a wallet caps what it may send, per
  transaction and per day: which chains, which addresses a transaction may go to, how much native
  coin and how much of each token. Before each send, the command measures what the transaction
  would move, from a simulation, and refuses what breaks a limit or what it cannot measure. The
  addresses are the transaction's own target: on EVM the contract the wallet calls, usually its
  Pot, and on Solana the programs its instructions call. Allowing a Pot does not limit whom its
  program pays: that is for the program to check, and for you to review.
- **A key can stay somewhere else.** `sauce tx` prints the transaction unsigned, and a hardware
  wallet or a key service signs it ([Wallets and signing](../guides/cli-wallets.md)).
- **A coding agent signs only where you let it.** Over stdio, `sauce mcp` serves the wallets in
  your wallet directory, and an agent can enable them with `sauce_wallet_enable`, naming a
  password file or variable it can read. A policy applies only to a wallet that has one. Start the
  server with `--no-wallets` when the agent must not sign. Served over HTTP, it never signs
  ([The MCP server](../guides/mcp.md)).

## The habit: review before you sign

Before sending, review three things together: the final program, the arguments it is called with,
and what the simulation says will happen. That means what leaves your wallet, what arrives where,
and what stays in the Pot.

The `sauce` command shows what stays, before and after. A simulation and a sent cook lead with
what the Pot holds after the cook, for each token the cook moved, with what it held before. A cook
that leaves the Pot nothing prints none:

```text
The cook succeeds from 0x0305…262A: gas used 268566 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  0.999999 aBasUSDC
  Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
```

It counts tokens: a position a protocol keeps in its own books, with no token for it, shows in no
balance. Below that, "What moved, in order" lists every transfer the cook makes, and the net change
of each address. [Run a program](../guides/cli-run.md) shows how to read the rest of the output.

When someone else built the transaction you are about to sign, `sauce inspect` reads it back: the
program a cook carries, the arguments after it, and the intents it opens
([Look things up](../guides/cli-lookup.md)). When a payment depends on an audited program, such as
a settlement, `sauce verify` checks that the payload runs exactly that program
([Verifying settlement programs](../guides/verification.md)).

## Next

- The steps to take before running with real funds: the
  [production checklist](../guides/production-checklist.md).
- What each of these costs: [Costs](costs.md).
