<!-- Generated from the SDK's registries. Do not edit. -->

# Intent defaults

An intent opened with `Chain.Portal.send(reward).receive(delivery).then(() => { ... })` may set
each of these with a modifier: after `.send(...)` the reward's, after `.receive(...)` the
route's, each at most once and in any order. Left out, each is what Eco's Portal app gives an
intent, where it has one:

| Modifier | Sets | Left out |
| --- | --- | --- |
| `.deadline(t)` after `.receive` | The last second the intent may be filled, Unix seconds | 300 seconds (5 minutes) after the intent opens, the window Eco's solver quotes |
| `.deadline(t)` after `.send` | From when an unproven reward may be refunded to the creator | 604800 seconds (7 days) after the fill deadline: Eco's solver fills no intent whose reward is refundable sooner |
| `.creator(a)` after `.send` | Who may reclaim an unearned reward | The wallet that publishes the intent, or the owner of the Pot that runs the file; one level down, the creator of the intent above |
| `.prover(p)` after `.send` | The source chain's prover, which accepts the proof of the fill | The one the registry records on both chains, the HyperProver first |
| `.salt(s)` after `.receive` | The route's salt: two otherwise identical intents differ by it | Zero, so a file builds the same intent each time it is compiled |
| `.fee(f)` after `.receive` | The destination Kitchen's fee, in wei, that a body which is a program pays its cook | That Kitchen's fee, read from it when the intent is built, for each destination |
| `{ native: amount }` in `.send` | Native coin in the reward, in wei | None |

A default deadline counts from when the intent opens. The `sauce` command and its MCP server open
the intents a file opens when they build them (`sauce intent publish`, `sauce run`), so each run
builds new ones unless a deadline is given. Compiled with no such time, an intent opens when the
program that opens it runs, at `ctx.timestamp()`; an intent a body opens, one level down, always
opens when that body runs. A modifier's value may be one the program computes as it runs, such
as `.deadline(ctx.timestamp() + 3600)`, but for the fee: that is known when the intent is built.

Only the `sauce` command and its MCP server have a wallet to name and read a Kitchen. Compiled
any other way, an intent needs `.creator(...)`, and one whose body is a program `.fee(...)`, or
the compile refuses it.
