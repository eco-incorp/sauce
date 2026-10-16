# Quick start

**Tutorial** · [Documentation](../README.md) · [Solana quick start](solana-quick-start.md) · [Glossary](../concepts/glossary.md)

> You are going to write a tiny program that pays someone 1 USDC, try it for free, and then run it
> for real on Base. Think of the program as a recipe. Sauce gives you your own kitchen counter on
> the blockchain, called a **Pot**. You put ingredients (tokens) on the counter, and the Pot follows
> your recipe step by step. If any step goes wrong, nothing happens at all, as if you never started.

It takes about ten minutes. Trying the program costs nothing. Running it for real costs a few cents
of ETH on Base, plus the 1 USDC it pays.

## 1. Install

You need [Node.js](https://nodejs.org) 24 or newer (`node --version` tells you). Then install the
`sauce` command:

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

Want your editor to understand Sauce programs too? Start a project, and work in its `programs/`
folder, which your editor checks as SauceScript:

```sh
sauce init my-app
cd my-app
npm install
cd programs
```

## 2. Make a wallet

```sh
sauce wallet new me
```

It asks for a password twice, then prints the wallet's address. The key is stored encrypted in
`~/.sauce/wallets`, and the password unlocks it whenever you send something. Keep only small amounts
in it: it lives on your computer.

Already have a key? `sauce wallet import me <file>` keeps it as a wallet instead.

## 3. Write the program

Save this as `pay.sauce.ts`:

```js
// Pays `amount` of USDC from your Pot to `to`, and stops if the Pot holds less.
// The same file runs on Base and on Solana.
//
// Try it on a copy of the chain first: no password, no money, nothing sent.
//
//   sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args <recipient> 1000000
//
// Then run it for real: your wallet signs and pays the fee, and your Pot pays the USDC.
//
//   sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
//
// On Solana, the same way, with a Solana wallet:
//
//   sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 --args <recipient> 1000000
//   sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
//
//   to: Address       who gets the USDC, an address on the chain it runs on
//   amount: Uint256   how much, in USDC's smallest unit: USDC has 6 decimals, so 1000000 is 1 USDC
function main(to: Address, amount: Uint256) {
  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

The comments are for you; the program is the last four lines.

- `main` is where the program starts. Its parameters are its inputs: who to pay, and how much.
- `USDC` needs no import and no address. Sauce knows where USDC lives on every chain it supports.
- `ctx.self()` is your Pot, so `USDC.balanceOf(ctx.self())` is how much USDC your Pot holds.
- `require` checks something. If it is false, the whole run stops and nothing moves.
- `USDC.transfer(to, amount)` pays, from your Pot.

Check that it compiles:

```sh
sauce compile pay.sauce.ts --chain base
```

It prints the compiled program as hex. That is what runs on chain: there is no contract to write or
deploy.

## 4. Try it for free

```sh
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args <recipient> 1000000
```

Put any Base address in place of `<recipient>`. Your own works: `sauce wallet address me` prints it.

- `--wallet me` says whose Pot to use. No password is needed, because nothing is signed.
- `--assume-balance USDC:5` pretends your Pot holds 5 USDC, for this simulation only.
- `--args` gives `main` its inputs: the recipient, then the amount. 1000000 is 1 USDC.

`sauce simulate` runs the program on a copy of Base as it is right now, and tells you what would
happen:

```text
The cook succeeds from 0x028e…4822: gas used 111821 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  4 USDC (it held 5 USDC before)
…
What moved, in order:
  [1] wallet 0x028e…4822 -> Pot 0x4955…aD84      0.00000374478538635 ETH  the cook's value
  [2] Pot                -> Kitchen 0x1984…506b  0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot                -> 0x2222…2222          1 USDC
```

Your addresses and numbers will differ. Read it from the bottom: your Pot paid 1 USDC to the
recipient, and paid the Kitchen a small fee for running the program. That transaction is called a
**cook**, and the **Kitchen** is the contract that makes Pots and charges that fee. Your Pot does
not exist yet, so the simulation creates it first, as the real run will.

Now ask for more than the Pot holds, `--assume-balance USDC:0.5`, and the simulation says
`The cook reverts: the program threw "not enough USDC"`. That is your `require` doing its job.

## 5. Run it on Base

Two things need money:

- **Your wallet pays the fees**, in ETH on Base. 0.001 ETH is plenty.
- **Your Pot pays the USDC.** Send it 1 USDC on Base.

Your Pot's address is known before the Pot exists, so you can send it tokens now:

```sh
sauce pot --chain base --wallet me
```

It prints the address as `"pot"`. From an exchange or another wallet, send 1 USDC on Base to that
address, and a little ETH on Base to your wallet's address. Then run:

```sh
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

It asks for your password. The first time, it also asks to create your Pot, which is one extra
transaction. Then it simulates the cook again, sends it, waits for it, and prints what happened:

```text
cook 0x5f…: success, gas used 184211, block 21004500
  explorer: https://basescan.org/tx/0x5f…
…
What moved, in order:
  [1] Pot 0x8a… -> 0x66…  1 USDC
```

The explorer link shows the transaction on Basescan.

Rather not send the Pot USDC first? `--fund USDC:1` has the run pull 1 USDC from your wallet into the
Pot, in the same transaction as the cook.

## What just happened

You wrote a program, and Sauce compiled it. Your wallet sent one transaction, a cook, to your Pot.
The Pot ran the program: it checked its USDC, paid the recipient and paid the Kitchen's fee. Had the
check failed, nothing at all would have moved, and only the gas would have been spent.

What the Pot holds stays there until a program moves it. It is yours, but your wallet app will not
show it. [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md) explains the Pot in full.

## Next

- Run the same file on Solana: the [Solana quick start](solana-quick-start.md).
- Swap, lend or bridge by name: [protocols and tokens](protocols-and-tokens.md).
- Reach another chain: [your first cross-chain intent](first-intent.md).
- Every word Sauce uses, next to one you know: the [glossary](../concepts/glossary.md).
- Every command and flag: [the sauce command](cli.md).
