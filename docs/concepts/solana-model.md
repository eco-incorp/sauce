# How Sauce runs on Solana

**Concept** · [Documentation](../README.md) · [Solana quick start](../guides/solana-quick-start.md) · [Kitchen, Pot and cook](kitchen-pot-cook.md)

> A Solana transaction has to list every account it will touch before it starts, and it has a hard
> size limit and a compute budget. The same Sauce program that runs on Base runs on Solana, because
> Sauce works out that list, uploads big programs in pieces and keeps each swap inside the budget.
> This page says how, and why each piece exists.

This page is for you if you know what a [Pot, a cook and the Kitchen](kitchen-pot-cook.md) are and
want to know what changes on Solana. It gives the reasons and no steps. To run a program there,
follow the [Solana quick start](../guides/solana-quick-start.md); for the decisions a program
takes, see the [Solana guide](../guides/solana.md).

## Accounts

On Solana everything that holds data or tokens is an **account**: a wallet, a token balance, a
program, your Pot. A transaction must name every account it will read or write, up front. Each
account is named once, with a role: read-only, writable, or signer (one that signed the
transaction). On an EVM chain a program can reach any address while it runs. Here it cannot reach
an account the transaction did not list.

Sauce keeps that list out of your program. When you compile for Solana, the compiler returns an
**account manifest**: every account the program needs, in order, with the role each has and how to
find it. For most accounts the manifest says how to _derive_ the account from things Sauce already
knows (your wallet, your Pot, the arguments you pass), so `sauce run` fills the list in and you
give none. An account that only the program can name, computed as it runs, is a parameter you pass
yourself. [Solana from the command line](../guides/cli-solana.md) shows both.

Three kinds of derived address appear in a manifest:

- A **program-derived address** (PDA) is an address a program computes from a few seeds, with no
  key behind it. Only the program that derived it can sign for it. Your Pot is one.
- An **associated token account** (ATA) is the token account the token program derives for a
  holder and a mint. It is where that holder's balance of that token lives.
- A **program** is an account too: the System Program (SOL transfers, creating accounts), the token
  programs, and every venue you swap at.

Because every account must be known before the transaction is built, a program whose holder or
seed is only known while it runs is refused at compile time. A program calls another program
through a **cross-program invocation** (CPI): the call goes out with the accounts the transaction
already listed.

A compiled program also checks the accounts it was given. A transaction built by someone else could
attach a different account in a slot, so the program verifies each one against what the program
says it must be: a token account that belongs to the named holder, an address that really derives
from its seeds, the right program. A wrong account fails the whole cook with a reason such as
`wrong holder account`.

## Token accounts

A wallet does not hold USDC. The wallet owns a **token account** for USDC, and the token account
holds the balance. Each holder has one per token. Your Pot works the same way: its USDC sits in the
Pot's own USDC token account, and a recipient's USDC lands in theirs. That is why a Solana
manifest lists `potUSDC` and `toUSDC` where an EVM program names only the Pot and the recipient.
A wallet's address is not a token account, and a token program refuses a wallet where it expects
one.

Every token on Solana belongs to one of two token programs, and so does each of its token
accounts. The older **SPL Token** program holds USDC and USDT. **Token-2022** holds PYUSD and the
tokenized stocks, and adds optional extensions: a transfer fee withheld from what arrives, a
transfer hook, a pause, a display scale. `@sauce/token` takes both programs. For a Token-2022 mint
it moves tokens with the checked transfer, and it refuses a mint whose hook names a program, before
anything moves, because the hook's extra accounts cannot ride in a fixed list.

## The Pot on Solana

A Pot is a PDA of the Kitchen program, derived from the seeds `"pot"`, the owner and a salt, so
its address is known before it exists. The Kitchen creates it with `create_pot`, which the owner
signs and pays for. It is the one Solana account that keeps storage for your programs, 10 KB of
it, fixed when it is created. Solana charges **rent**, a deposit proportional to an account's size
that stays with the account, so the Pot's rent is the largest first-run cost, paid once. The
Kitchen signs for the Pot when it runs a cook, so the program can spend tokens whose authority is
the Pot, and nothing else can.

Programs run by the engine, which sees the Pot as one of its accounts. In a program `ctx.self()`
is the engine's program id, not the Pot, and `self` as a token holder is the Pot.

## Why a program is staged

A Solana transaction holds at most 1,232 bytes, and a compiled program is often most of that. A
program too big for one transaction is **staged**: uploaded first, in several transactions, into a
**code buffer** account of the Kitchen, then run from it. After the cook the buffer is closed and
its rent comes back. `sauce run` does all of it.

Staging adds a question: how does the engine know it runs the bytes you uploaded? The answer
depends on the way you cook (next section). Through the Kitchen, the Kitchen runs only a buffer
that was finalized, and finalizing checks the SHA-256 digest of the upload; a buffer the signing
owner holds cannot be swapped for another's. Directly, the engine checks nothing about the
account, so the cook carries the digest and the engine runs exactly the bytes it hashed. The two
digests are different guarantees about different moments: one is checked when the upload is
finished, the other when the cook runs.

## Lookup tables

Every account a transaction lists takes 32 of its 1,232 bytes, so a cook that names about thirty
accounts no longer fits, even when its program is small. An **address lookup table** is a list of
addresses kept on chain. A transaction points into it and spends one byte per account instead of 32. A table holds the accounts a cook lists, except its signers and the programs it calls. Its
creator pays its rent and owns it, a table stays open until its owner closes it, and a later cook
that names the same accounts can use it again. `sauce run` and the TypeScript client create one
when a cook does not fit; `sauce reclaim` closes what a stopped run left.

## Two ways to cook

The released engine has two entry points, and a cook can use either. Through the Kitchen is the
default, and the way to custody tokens in a Pot. Directly to the engine is for a program that acts
as your wallet and needs no Pot. `sauce` picks with `--via`, a client with `via`.

|                                 | Through the Kitchen: `via: "kitchen"` (the default)                      | Direct to the engine: `via: "engine"`                                                  |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| What the transaction calls      | the Kitchen's `cook`, or `cook_from_account` for a staged program        | the engine's `cookAndPay`, or `cookAndPayFromAccountPinned` for a staged program       |
| Whose authority the program has | the owner's Pot, which the Kitchen signs for, and any signer it is given | only the signers the transaction gives it, such as the wallet; nothing signs for a Pot |
| The execution fee               | charged by the Kitchen, before it calls the engine                       | charged by the engine, before the program runs                                         |
| CPI depth left for the program  | three levels below it, on mainnet; seven where SIMD-0268 is active       | four, on mainnet; eight where SIMD-0268 is active                                      |

**Through the Kitchen** is for custody through a Pot: the program holds and spends what the Pot
owns (token accounts whose owner is the Pot) and writes the Pot's own storage, at an address that
is the same for every cook of that owner and salt. The owner signs every Kitchen cook.

**Direct to the engine** is for a program that acts as the signer: it spends the wallet's own token
accounts, with the wallet signing as their authority, and makes no Pot at all. It also starts the
program's own calls one level higher on Solana's invoke stack, because no Kitchen frame sits under
the engine. Solana allows 4 levels of CPI below a transaction's instruction, and 8 once the feature
of SIMD-0268, a Solana change that raises that limit, is active on a cluster. Through the Kitchen
the engine spends one of them. That is the difference
between fitting and not fitting when the program calls a program that calls others: an aggregator
into a pool into a token program, say.

What does not change between them:

- **The fee.** Both read it from the Kitchen's `["execution_fee"]` config account and pay it into
  that same account, the Kitchen's treasury. Both instructions carry a signed `max_execution_fee`,
  and a fee above it refuses the cook before anything runs or is paid. Directly, the fee payer must
  be a System-owned account that holds no data, and the engine validates the config even when the
  fee is zero, so a lookalike account is refused rather than read as free.
- **The program.** The same compiled bytecode and the same account indices run either way: the
  Kitchen's accounts, and the three a direct cook pays with, are taken off the list before the
  program sees it.
- **`ctx.self()`** is the engine program's id, and **`ctx.msgSender()`** the first signer among the
  program's accounts.

A program cannot write an account that does not sign, so a direct cook cannot write a Pot's
storage, and a transfer whose authority is a Pot fails for the missing signature.

## Compute

A transaction has a budget of 1,400,000 **compute units**, Solana's measure of work, and every
instruction spends from it, the engine's and each venue's. A cook that runs out fails whole.
When assembling a cook yourself, prepend `buildHeapFramePrepend()` from
`@eco-incorp/sauce/svm` exactly once: it requests the required 262,144-byte heap frame.
The command and high-level client include it automatically.

Swaps are where the budget goes. A swap at a price on a concentrated-liquidity pool walks from one
initialized tick to the next until its price reaches its limit or its input runs out, and the
pool's program charges compute units for each tick it crosses: about 7,000 on Orca, 9,000 on
Raydium, 13,000 to 16,000 on the others. A deep pool with a generous limit can cross a hundred
or more, and then the transaction runs out and fails, every other pool's trade with it. A program
cannot read how many units are left, so `sauce` decides each pool's walk ahead of time. These
decisions are the **stops**.

1. It reads each pool's tick arrays, the ones its slot passes, and counts the initialized ticks
   between the pool's price and its limit, and what the walk buys.
2. It prices that walk from a table of each venue's cost, measured on the venues' own programs: a
   fixed amount for the swap, an amount for each tick crossed (at least the steepest step
   measured), and three more crossings kept back.
3. It gives the transaction's units first to the pool whose walk buys the most per unit, then the
   next. Each walks its whole way while the units last. The pool that the rest no longer cover is
   held a tick short of the first initialized tick it cannot pay to cross; a pool left too little
   for its swap at all is skipped.

A swap in a loop runs as many times as the loop does. Where the loop writes its count out
(`for (let i = 0; i < 3; i++)`, `for (const x of [a, b])`), the command charges the swap's own units
for each run, and its walk once: every run walks the same way to the same limit, starting where
the last one left the price. Where the count is a value or a negative number, or is more runs than
one cook pays for (so the program must leave the loop sooner, at a `break`), how many units the
swap leaves the others is known only as the cook runs, so no pool is held: every swap is the plain
one, and the command says so (`noComputeStops`).

A held or skipped pool's swap is compiled to its Stopped form, its `stop` a tighter `priceLimit`
the command finds with the router's own arithmetic, and the start bound three tick-spacing
positions past the pool's price then. Every other pool's swap stays the plain one. A program no
stop binds is the same program, byte for byte.

Stops lower the risk that a wide limit runs the cook out of compute units. They do not remove it,
because each stop is fixed when the cook is built, from the pools' prices then:

- A held pool whose price has moved more than three positions further from its stop by the time the
  cook runs is skipped, so it crosses at most three more initialized ticks than were priced, and
  those three are charged. That holds while the ticks in its way stay as they were read: a
  liquidity position opened inside its walk before the cook lands adds a crossing nobody priced.
- A pool that walks its whole way runs the plain swap, unchecked. A price that moves further than
  three positions can still cost it more than was priced.
- Three positions is a chosen allowance, not a measured bound on how far prices move in that time.

`sauce simulate` and `sauce run` check the stops in a simulation first. A cook that succeeds with a
pool held is worked out again against the units the simulation measured, and kept only if three
more crossings at every pool still fit; one that still runs out is worked out again with less,
twice, then refused. `sauce tx` does no simulation: there the cost table is all there is, and the
cook it builds can differ from the one `sauce simulate` reports.

Each command prints a line for a pool a stop held or skipped, and gives every pool's stop in
`computeStops`. Here the SpaceX order of the distributed swap is simulated at 1.1 times the dearest
pool's price. Raydium's pool, which buys the most per unit, walks its whole way, and the other two
share what is left:

```text
Byreal.CLMM.pool(USDC, SPCX_US, 1000) stops at 153.799 USDC per SPCX_US, short of its limit: reaching it would cross 22 initialized ticks, about 457,500 compute units, past its share of 314,400
Pancakeswap.CLMM.pool(USDC, SPCX_US, 800) is skipped: the pools ahead of it leave too few compute units for its swap (about 135,000 to its limit, 2 initialized ticks)
```

From TypeScript, `SVM_SWAP_COSTS` in `@eco-incorp/sauce/svm` is the cost table, by each venue's
program id: each venue program's own units under the engine's call, the invoke itself not counted.
`svmPoolWalk` counts a pool's walk with it. What each `@sauce/router` function itself costs is in
[`@sauce/router` on Solana](../api/router-solana.md#size-and-compute).

## Next

- Run it: the [Solana quick start](../guides/solana-quick-start.md) runs one program end to end,
  and [Solana from the command line](../guides/cli-solana.md) covers the commands.
- Write for Solana: the [Solana guide](../guides/solana.md) has the account expressions, token
  methods and pool swaps.
- Build from TypeScript: [Solana from TypeScript](../guides/solana-from-typescript.md).
- Look a word up in the [glossary](glossary.md#solana).
