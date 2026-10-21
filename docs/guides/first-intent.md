# Your first cross-chain intent

**Tutorial** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Cross-chain intents](../concepts/cross-chain-intents.md)

> Sometimes what you want happens on another chain. An **intent** is a job you post: "pay this person
> 1 USDC on Ethereum, and the reward waiting here on Base is yours." Someone called a **solver** sees
> it, does the job on Ethereum with their own money, proves it, and collects the reward. You never
> touch the other chain. If nobody does the job in time, you take your reward back.

In this tutorial you post that job from a Sauce program on your Pot on Base, follow it, and then
simulate a second job that pays a wallet on Solana. It takes about fifteen minutes. It follows the
[quick start](quick-start.md): the same wallet, and the same habit of simulating before running.

**Posting the job uses real funds**: a little ETH on Base for gas and the Kitchen's fee, and the
USDC you put up as the reward. That USDC waits in escrow on Base until a solver earns it or you take
it back. Every simulation is free.

## You will need

- The `sauce` command and the wallet `me` from the [quick start](quick-start.md), holding a little
  ETH on Base (0.001 ETH is plenty).
- 2 USDC on Base, which you send to your Pot in step 3.
- An address on Ethereum to pay, `<recipient>`. Your own works: `sauce wallet address me` prints
  it.

## You will have

- An intent published on Base: a job that pays `<recipient>` on Ethereum, its reward locked in
  escrow on Base.
- The intent kept by the `sauce` command, and the commands that follow it to its end: filled and
  claimed by a solver, or refunded to you.
- A simulated intent to Solana, published from Ethereum.

## 1. Write the program

The program's comments name three parts of eco-routes, Eco's intent system, which Sauce uses on
every chain it supports:

- the **Portal**, a contract on each chain where jobs are posted and paid out;
- the **vault**, an escrow address, one per intent, where your reward waits;
- the **prover**, which carries word back to Base that the job was done.

You never call them yourself. [Cross-chain intents](../concepts/cross-chain-intents.md) explains
each.

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
  const amount = self.USDC;
  require(amount >= minAmount, "nothing to forward");

  Ethereum(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

Line by line:

- `const amount = self.USDC` reads how much USDC your Pot holds on Base right now. The program
  forwards all of it.
- `require(...)` stops everything when there is too little to bother.
- `Ethereum(() => { ... })` is the job: what happens on Ethereum. Inside the braces, `USDC` means
  Ethereum's USDC.
- `.reward({ ... })` is the bounty, paid on Base, where the program runs. Here it is all the USDC
  the Pot measured, so the solver is paid on Base exactly what it pays out on Ethereum.

So the program says: "whoever pays `recipient` this much USDC on Ethereum gets the same USDC from my
Pot on Base."

The header signs with `--keystore`, a key file. This tutorial signs with your wallet, `--wallet me`,
instead; the two work the same way.

## 2. Simulate it

An intent needs two things the program does not say: until when a solver may do the job (its
deadline), and who may take the reward back if nobody does (its creator, you). Give them as flags:

```sh
sauce simulate cross-chain-intent.sauce.ts --chain base --wallet me --assume-balance USDC:2 \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <recipient> 1000000
```

- `--intent-deadline` is a moment in the future, in Unix seconds: `$(($(date +%s) + 3600))` is an
  hour from now in most shells.
- `--intent-creator` is your address, which `sauce wallet address me` prints.
- `--args` gives `main` the recipient, then `minAmount`: 1000000 is 1 USDC.

The simulation shows the Pot paying the Kitchen its fee and 2 USDC into the intent's vault. Under
`Intents published` it lists the new intent: its route to Ethereum, its 2 USDC reward, its vault,
and from when the reward can be refunded if no fill is proven.

Now pretend the Pot holds less than `minAmount`, with `--assume-balance USDC:0.5`. The simulation
says `The cook reverts: the program threw "nothing to forward"`, and nothing is published.

## 3. Post it

Find your Pot's address on Base, as in the quick start, and send it 2 USDC:

```sh
sauce pot --chain base --wallet me
```

Then run the same line with `sauce run`, and no `--assume-balance`:

```sh
sauce run cross-chain-intent.sauce.ts --chain base --wallet me \
  --intent-deadline <unix seconds> --intent-creator <your address> --args <recipient> 1000000
```

It asks for your password, then sends one cook. In that one transaction your Pot measures its USDC,
pays it into the intent's vault on Base, and publishes the intent.

## 4. Follow it

The command keeps every intent it publishes. List them, then ask where yours stands:

```sh
sauce intent list
sauce intent status <intent hash>
```

`status` reads both chains. It says `funded` while the intent waits for a solver, then `filled`,
`proven` and `claimed` as a solver does the job and collects the reward.

This reward equals what the solver pays out, so a solver earns nothing for its gas and fees, and may
well leave the job alone. That is fine for a first intent. Once the deadline has passed, `status`
says a refund is possible, and this returns the USDC to you:

```sh
sauce intent refund <intent hash> --chain base --wallet me
```

A real intent offers a reward a little larger than what the solver pays out, so the fill is worth
its while.

## 5. Simulate an intent to Solana

The destination can be Solana too, while you only send transactions on Ethereum or Base. Save this
as `ethereum-to-solana.sauce.ts`:

```js
// Pays a Solana wallet USDC, for a USDC reward on the chain that publishes it.
function main(recipient: Address, amount: Uint256, reward: Uint256) {
  Solana(() => {
    USDC.transfer(recipient, amount);
  }).reward({ tokens: [{ token: USDC, amount: reward }] });
}
```

Inside the braces, `USDC` is Solana's USDC and `recipient` a Solana wallet. Here the reward, 1.05
USDC, is larger than the 1 USDC delivered. Every amount is one of `main`'s arguments, so your wallet
can publish this intent directly, with no Pot. Simulate publishing it from Ethereum:

```sh
sauce intent publish ethereum-to-solana.sauce.ts --chain ethereum --dry-run \
  --from <your address> --assume-balance USDC:2 \
  --intent-deadline <unix seconds> --intent-creator <your address> \
  --args <solana wallet> 1000000 1050000
```

Give any Solana wallet's address in base58, the way Solana writes addresses. `--dry-run` simulates
the transactions your wallet would send on Ethereum, the reward paid into the vault and then the
publication, and asks the Portal whether the intent is funded. Nothing is signed or sent.

## What just happened

Your Pot ran one cook on Base. It measured its USDC, paid it into the vault of a new intent, and
published the intent on Base's Portal. Nothing has happened on Ethereum: a solver does that part, if
the reward is worth it, and the reward waits in the vault until a solver claims it or you refund
it. Then you simulated a second intent, published by your wallet instead of your Pot, whose job is
done on Solana.

## Next

- The next tutorial: run the quick start's program on Solana, in the
  [Solana quick start](solana-quick-start.md).
- What you just did, explained: [cross-chain intents](../concepts/cross-chain-intents.md).
- Every intent command, for the one who posts and the one who fills:
  [intents from the command line](cli-intents.md).
