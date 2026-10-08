<!-- Generated from the SDK's registries. Do not edit. -->

# Intent defaults

An intent opened with `await Chain.hop({ send, receive, refundee })` may give each of these
fields in the same object. Left out, each but the refundee is what Eco's Portal app gives an
intent:

| Field | Sets | Left out |
| --- | --- | --- |
| `refundee` | The refund address: who may reclaim what was sent, unearned, where an unfilled intent's `send` goes | Required on every intent, at any depth |
| `receive` | What the solver delivers on the destination, for the body: `{ token, amount }` or a list | Nothing delivered |
| `deadline` | The last second the intent may be filled, Unix seconds | 300 seconds (5 minutes) after the intent opens, the window Eco's solver quotes |
| `rewardDeadline` | From when what was sent, if no fill is proven, may be refunded to the refundee (the Portal reward's deadline) | 604800 seconds (7 days) after the fill deadline: Eco's solver fills no intent whose reward is refundable sooner |
| `prover` | The source chain's prover, which accepts the proof of the fill | The one the registry records on both chains, the HyperProver first |
| `salt` | The route's salt: two otherwise identical intents differ by it | 32 random bytes, as Eco's app picks, mixed with how many intents the transaction has opened, so two intents built alike are two, in one program or in two |
| `fee` | The destination Kitchen's fee, in wei, that the body's cook pays | That Kitchen's fee, read from it when the intent is built, for each destination |
| `{ native: amount }` in `send` | Native coin sent, in wei | None |

**The refundee has no default.** An intent is published by a program a Pot runs, and the Pot may
be shared, so a refund there could go to anyone: every intent, the one a file opens itself and
every one a body opens below it, names its own `refundee`, usually one of `main`'s parameters
(`refundee: refundTo`), or the compile refuses it. Nothing stands in for it, not even the wallet
that sends the cook.

**An intent opens when it is built.** The `sauce` command and its MCP server build the intents a
file opens once per run (`sauce intent publish`, `sauce run`), with one time and one random salt
for the run, so each run builds new intents unless `--intent-deadline` and `--intent-salt` are
given. Compiled with no such time, an intent opens when the program that opens it runs, at
`ctx.timestamp()`; an intent a body opens, one level down, always opens when that body runs.

A field's value may be one the program computes as it runs, such as
`deadline: ctx.timestamp() + 3600`. Only the `sauce` command and its MCP server read a Kitchen,
so compiled any other way, every hop needs a `fee`: its body is a program, whose cook pays it.
