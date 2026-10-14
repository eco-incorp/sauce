# Cross-chain intents

[Documentation](../README.md) · [The sauce command](cli.md) · [Routes API](../api/routes.md)

An Eco intent is an offer: _run this on that chain, and the reward escrowed on this one is yours_.
A solver who sees it delivers what it asks for on the destination chain, runs its calls there,
proves the fill back to the source, and claims the reward. Nobody promises that a solver will
fill a given intent; if none does, the reward goes back to the creator.

## Coming soon: opening an intent from a program

A program will open an intent by hopping to the chain where its body runs:

```js
function main(recipient: Address, refundTo: Address, amount: Uint256, reward: Uint256) {
  Ethereum.hop({
    send: { token: USDC, amount: reward },
    receive: { token: USDC, amount },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(recipient, amount); // runs on Ethereum, when a solver fills the intent
  });
}
```

- **The chain hopped to** (`Ethereum`) is the destination. The body in `.then(() => { … })` runs
  there, so its names are that chain's: its `USDC`, its protocols.
- **`send`** is the reward, escrowed on the source chain, the one the program runs on, until a
  solver earns it.
- **`receive`** is what the solver delivers on the destination for the body to spend.
- **`refundee`** is who may take back a reward nobody earned.

This is not in the package yet. Until it is, everything that used to open an intent refuses, with
the same sentence everywhere, naming the call it refused: a program that writes `<Chain>.hop(…)`
(or the earlier `<Chain>(() => { … })`), `sauce intent publish`, the MCP server's
`sauce_intent_publish`, and in TypeScript a chain export called as a function (`Base(…)`,
`Base.route(…)`), `routes.openRoute(…)` and the actions package's `programIntent(…)`. Those throw
`IntentsComingSoonError`:

```text
`Ethereum.hop(…)` at line 2: opening an intent is coming soon. It will be written `<Chain>.hop({ send, receive, refundee }).then(() => { … })`; until then, an intent that already exists can be filled, proven, claimed, refunded and cancelled.
```

## An intent that already exists

Whoever published an intent, on the eco-routes Portal, the rest of its life works today. The
`sauce` command stores it from the transaction that published it, then takes it by its hash:

```sh
sauce intent import 0x<publishing tx hash> --chain ethereum
sauce intent status 0x<intent hash>
sauce intent fill 0x<intent hash>                         # a solver's fill, simulated
sauce intent fill 0x<intent hash> --send --wallet solver  # and sent, proving itself
sauce intent claim 0x<intent hash> --wallet solver
```

`prove`, `refund` and `cancel` cover the rest: a proof sent on its own, the creator's reward back
after its deadline, and an unfilled intent stopped after its fill deadline so that it can be
refunded sooner. [The sauce command](cli.md#intents-sauce-intent) has each verb, what it checks
and what it prints, and an intent to Solana. The MCP server's intent tools build the same
transactions unsigned, an intent named by its `record` or its publishing transaction
([An intent's life](mcp.md#an-intents-life)).

In TypeScript, the routes namespace builds every request as `{ to, data, value }` with no RPC:
`intentFromPublished` rebuilds an intent from its `IntentPublished` log, and `fulfillTx`,
`proveTx`, `withdrawTx`, `refundTx` and `cancelTx` are its steps, beside the hashes and the vault
([the Portal's calls](../api/routes.md#the-portals-calls)).

An intent whose body runs a program cooks on one Pot on the destination: the one the destination
Portal's Executor owns, which every intent through that Portal shares. A solver deploys it before
the first fill there; any account may.
