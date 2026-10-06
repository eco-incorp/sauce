<!-- Generated from the SDK's registries. Do not edit. -->

# Intent defaults

An intent opened with `Chain.Portal.send(reward).receive(delivery).then(() => { ... })` may set
each of these with a modifier: after `.send(...)` the reward's, after `.receive(...)` the
route's, each at most once and in any order. Left out, each but the refundee is what Eco's Portal
app gives an intent:

| Modifier | Sets | Left out |
| --- | --- | --- |
| `.refundee(a)` after `.send` | The refund address: who may reclaim an unearned reward, where an unfilled intent's reward goes | Required on every intent, at any depth |
| `.deadline(t)` after `.receive` | The last second the intent may be filled, Unix seconds | 300 seconds (5 minutes) after the intent opens, the window Eco's solver quotes |
| `.deadline(t)` after `.send` | From when an unproven reward may be refunded to the creator | 604800 seconds (7 days) after the fill deadline: Eco's solver fills no intent whose reward is refundable sooner |
| `.prover(p)` after `.send` | The source chain's prover, which accepts the proof of the fill | The one the registry records on both chains, the HyperProver first |
| `.salt(s)` after `.receive` | The route's salt: two otherwise identical intents differ by it | 32 random bytes, as Eco's app picks, so publishing the same intent twice gives two |
| `.fee(f)` after `.receive` | The destination Kitchen's fee, in wei, that the body's cook pays | That Kitchen's fee, read from it when the intent is built, for each destination |
| `{ native: amount }` in `.send` | Native coin in the reward, in wei | None |

**The refundee has no default.** An intent is published by a program a Pot runs, and the Pot may
be shared, so a refund there could go to anyone: every intent, the one a file opens itself and
every one a body opens below it, names its own `.refundee(<address>)`, usually from one of
`main`'s parameters (`.refundee(refundTo)`), or the compile refuses it. Nothing stands in for
it, not even the wallet that sends the cook.

**An intent opens when it is built.** The `sauce` command and its MCP server build the intents a
file opens once per run (`sauce intent publish`, `sauce run`), with one time and one random salt
for the run, so each run builds new intents unless `--intent-deadline` and `--intent-salt` are
given. Compiled with no such time, an intent opens when the program that opens it runs, at
`ctx.timestamp()`; an intent a body opens, one level down, always opens when that body runs.

A modifier's value may be one the program computes as it runs, such as
`.deadline(ctx.timestamp() + 3600)`. Only the `sauce` command and its MCP server read a Kitchen,
so compiled any other way, every intent needs `.fee(...)`: its body is a program, whose cook
pays it.
