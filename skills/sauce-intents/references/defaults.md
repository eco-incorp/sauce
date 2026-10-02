<!-- Generated from the SDK's registries. Do not edit. -->

# Intent defaults

An intent opened with `Chain.Portal.send(reward).receive(delivery).then(() => { ... })` may set
each of these with a modifier: after `.send(...)` the reward's, after `.receive(...)` the
route's, each at most once and in any order. Left out, each but the creator is what Eco's Portal
app gives an intent:

| Modifier | Sets | Left out |
| --- | --- | --- |
| `.creator(a)` after `.send` | The refund address: who may reclaim an unearned reward, where an unfilled intent's reward goes | Required on every intent a program opens, at any depth. Only a top-level intent a wallet publishes itself (`sauce intent publish`) takes that wallet |
| `.deadline(t)` after `.receive` | The last second the intent may be filled, Unix seconds | 300 seconds (5 minutes) after the intent opens, the window Eco's solver quotes |
| `.deadline(t)` after `.send` | From when an unproven reward may be refunded to the creator | 604800 seconds (7 days) after the fill deadline: Eco's solver fills no intent whose reward is refundable sooner |
| `.prover(p)` after `.send` | The source chain's prover, which accepts the proof of the fill | The one the registry records on both chains, the HyperProver first |
| `.salt(s)` after `.receive` | The route's salt: two otherwise identical intents differ by it | 32 random bytes, as Eco's app picks, so publishing the same intent twice gives two |
| `.fee(f)` after `.receive` | The destination Kitchen's fee, in wei, that a body which is a program pays its cook | That Kitchen's fee, read from it when the intent is built, for each destination |
| `{ native: amount }` in `.send` | Native coin in the reward, in wei | None |

**The creator has no default in a program.** The Pot a program runs on may be shared, so a refund
there could go to anyone: every intent a program opens, the one it opens itself and every one a
body opens below it, names its own `.creator(<address>)`, usually from one of `main`'s parameters
(`.creator(refundTo)`), or the compile refuses it.

**An intent opens when it is built.** The `sauce` command and its MCP server build the intents a
file opens once per run (`sauce intent publish`, `sauce run`), with one time and one random salt
for the run, so each run builds new intents unless `--intent-deadline` and `--intent-salt` are
given. Compiled with no such time, an intent opens when the program that opens it runs, at
`ctx.timestamp()`; an intent a body opens, one level down, always opens when that body runs.

A modifier's value may be one the program computes as it runs, such as
`.deadline(ctx.timestamp() + 3600)`, except the fee, which is known when the intent is built: only
the `sauce` command and its MCP server read a Kitchen, so compiled any other way, an intent whose
body is a program needs `.fee(...)`.
