# Your first cross-chain intent

**Tutorial** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Create an intent](intents.md)

> Sometimes what you want happens on another chain. An **intent** is a job you post: "pay this person
> 1 USDC on Ethereum, and the reward waiting here on Base is yours." Someone called a **solver** sees
> it, does the job on Ethereum with their own money, proves it, and collects the reward. You never
> touch the other chain. If nobody does the job in time, you take your reward back.

This page posts that job from a Sauce program, on your Pot. Do the [quick start](quick-start.md)
first: you will use its wallet `me`, and the same steps of simulating and then running.

## The program

Save this as `cross-chain-intent.sauce.ts`:

```js
// Create a cross-chain intent from inside a Sauce program.
//
// This runs on your Pot, measures the USDC the calls before it left there, and offers a NEW intent
// that carries that amount to `recipient` on another chain. The amount is never known in advance —
// it is whatever the swap, bridge or transfer just before it produced — which is the reason to
// build the intent here rather than off-chain.
//
// `Ethereum(() => { ... }).reward({ ... })` is the whole of it. `amount` is an ordinary variable of
// this program and `recipient` one of its parameters, and using them inside the intent is enough:
// the SDK splices their run-time values into the encoded intent, and fills in the Portal, the
// prover, the vault and the encoding.
//
// `USDC` is a registered symbol, and inside the braces it means Ethereum's USDC, because that is the
// chain those calls run on. In `.reward(...)` it means the USDC of the chain this program runs on,
// which escrows the reward.
//
//   sauce run cross-chain-intent.sauce.ts --chain base --keystore <keystore> \
//     --intent-deadline <unix seconds> --intent-creator <address> --args <recipient> <minAmount>
//
//   recipient: Address   who the intent pays on Ethereum
//   minAmount: Uint256   the least USDC worth forwarding, in its smallest units (6 decimals):
//                        below it the whole transaction reverts and nothing is published
function main(recipient: Address, minAmount: Uint256) {
  const amount = USDC.balanceOf(ctx.self());
  require(amount >= minAmount, "nothing to forward");

  Ethereum(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

Line by line:

- `const amount = USDC.balanceOf(ctx.self())` reads how much USDC your Pot holds on Base right now.
- `require(...)` stops everything when there is too little to bother.
- `Ethereum(() => { ... })` is the job: what happens on Ethereum. Inside the braces, `USDC` means
  Ethereum's USDC.
- `.reward({ ... })` is the bounty, paid on Base, where the program runs. Here it is all the USDC
  the Pot measured, so the solver is paid on Base exactly what it pays out on Ethereum.

So the program says: "whoever pays `recipient` this much USDC on Ethereum gets the same USDC from my
Pot on Base." A real solver wants a little more than it pays out, so a real reward adds a margin.

Nothing here names a contract. Sauce knows eco-routes, Eco's intent system, on every chain it
supports: its Portal, where jobs are posted, and the prover, which carries the proof back.

## Try it for free

An intent needs two things the program does not say: until when a solver may do the job (the
deadline), and who may take the reward back if nobody does (the creator, you). Give them as flags:

```sh
sauce simulate cross-chain-intent.sauce.ts --chain base --wallet me --assume-balance USDC:2 \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <recipient> 1000000
```

The deadline is a moment in the future, in unix seconds: `$(($(date +%s) + 3600))` is an hour from
now in most shells. `sauce wallet address me` prints your address, for the creator and, if you like,
the recipient.

The simulation shows the Pot paying 2 USDC into the intent's own escrow address, called its
**vault**, and one event from the Portal: the intent, published.

## Post it for real

Send your Pot some USDC on Base, as in the quick start, then run the same line with `sauce run` and
no `--assume-balance`:

```sh
sauce run cross-chain-intent.sauce.ts --chain base --wallet me \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <recipient> 1000000
```

The command keeps every intent it publishes. Follow yours with:

```sh
sauce intent list
sauce intent status <intent hash>
```

`status` reads both chains and says where the intent stands: `funded` while it waits for a solver,
then `filled`, `proven` and `claimed`. If the deadline passes with no fill, `sauce intent refund`
gives you the reward back once the Portal allows it.

## From TypeScript

The same intent can be built in an application. This builds an intent to Base, offline: the
creator and the fee are fixtures, and nothing is sent.

```ts
import { Base } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Fixture: read Base's Kitchen fee with destinationExecutionFee().

const built = Base(
  () => {
    USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
  },
  { execution: { value: executionFee }, deadline: 2_000_000_000n },
).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  deadline: 2_000_003_600n,
});

console.log(built.hash().intentHash);
```

`Base` names where the job happens; `.reward(...)` names where the bounty waits. That one expression
looks up USDC and the Universal Router on Base, compiles the body, finds the Portals and the prover,
and assembles the intent. What stays yours: the deadlines, the creator, the Kitchen's fee, and a
reward worth a solver's while. The SDK sends nothing, and does not price the reward.

Three things trip people up:

- **The callback is source, not a function.** It is read as text and compiled. It never runs as
  JavaScript, so it captures nothing: a surrounding `const amount` is invisible inside it. Pass
  application values through `defines`, or write the body as a string.
- **`USDC` and `Uniswap` are not imports.** They are names the compiler resolves on the destination
  chain. `Base`, by contrast, is a named export.
- **The Pot is not yours.** On the destination, an intent's program runs on a Pot that every
  solver's fill shares. Bring assets into it, use them, and take what is left out in the same fill.
  [The destination Pot](intents.md#the-destination-pot) explains it.

[first-intent.ts](../examples/first-intent.ts) builds both sides of a transfer intent and the
transactions that post it.

## To Solana

An intent can pay a Solana wallet too, and you still only send transactions on Ethereum. Inside
the braces, `USDC` is Solana's USDC and `recipient` a Solana wallet, given in base58:

```js
// Pays a Solana wallet USDC, for a USDC reward on the chain that publishes it.
function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
```

```sh
sauce intent publish ethereum-to-solana.sauce.ts --chain ethereum --keystore <path> \
  --intent-deadline <unix seconds> --intent-creator <your address> \
  --args <solana wallet> 1000000 1050000
```

If the wallet has no USDC account yet, the solver creates one first, and the command adds its rent
to what the solver brings. [ethereum-to-solana.ts](../examples/ethereum-to-solana.ts) builds the
same intent from TypeScript.

## Next

- Every option of an intent, and how to fund, publish and follow it: [create an intent](intents.md).
- An intent that posts the next one: [nested intents](nested-intents.md).
- Every intent command: [the sauce command](cli.md#intents-sauce-run-or-sauce-intent).
