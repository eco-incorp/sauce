# Quick start

**Tutorial** · [Documentation](../README.md) · [Write your first program](write-your-first-program.md) · [Glossary](../concepts/glossary.md)

> You are going to write a tiny program that pays someone 1 USDC, try it for free, and then run it
> for real on Base. Think of the program as a recipe. Sauce gives you your own kitchen counter on
> the blockchain, called a **Pot**. You put ingredients (tokens) on the counter, and the Pot follows
> your recipe step by step. If any step goes wrong, nothing happens at all, as if you never started.

This is the first tutorial. It is for you if you know TypeScript and what a wallet, a transaction
and a token are, and have never used Sauce. [What Sauce is](../concepts/what-is-sauce.md) gives the
picture first, in five minutes, if you want it. The tutorial takes about ten minutes.

## You will need

- **For the last step only, real funds on Base:** about 0.001 ETH for the network's fees, and
  1 USDC for the program to pay. Send them from an exchange or another wallet. Every step before
  step 5 is free.
- [Node.js](https://nodejs.org) 24 or newer (`node --version` tells you), and a terminal.
- An address on Base to pay. Your own works: step 2 makes one.

## You will have

- the `sauce` command, and a wallet it signs with;
- a program, `pay.sauce.ts`, that pays USDC and refuses to pay more than its Pot holds;
- a free simulation of it, read line by line;
- one real transaction on Base that paid 1 USDC, and your own Pot.

## 1. Install

Install the `sauce` command:

```sh
npm install -g @eco-incorp/sauce
sauce --version
```

It prints the version you installed. Work in any empty folder from here on.

## 2. Make a wallet

```sh
sauce wallet new me
```

It asks for a password twice, at least 8 characters. Then it says how the key is kept, and prints
the wallet's address:

```text
…
Created wallet me (EVM): 0x2b89…71cc
  file    ~/.sauce/wallets/me.json
  policy  none (~/.sauce/wallets/me.policy.json would set limits)
```

`me` is the wallet's name, which every later command uses. `EVM` says it is a wallet for Ethereum
and chains that work like it, such as Base. The key is stored encrypted in that file, and the
password unlocks it whenever you send something. Keep only small amounts in it: it lives on your
computer.

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
  require(pot.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

The comments are for you: what the program does, the commands that run it (steps 4 and 5 below),
and what each input means. The program is the last four lines.

- `main` is where the program starts. Its parameters are its inputs: who to pay, and how much.
  `Address` and `Uint256` are their types: an address, and a whole number.
- `USDC` needs no import and no address. Sauce knows where USDC lives on every chain it supports.
- `pot` is your Pot, and `pot.USDC` is how much USDC it holds: a token's name after a holder
  reads that holder's balance.
- `require` checks something. If it is false, the whole run stops and nothing moves.
- `USDC.transfer(to, amount)` pays, from your Pot.

Check that it compiles for Base:

```sh
sauce compile pay.sauce.ts --chain base
```

It prints the compiled program, the **bytecode**, as one long line of hex:

```text
0xa502011fd1514702000eb19000b6d00200df01209554e10200ff01209554010014833589fcd6edb6…
```

That is what runs on chain: there is no contract to write or deploy. A mistake in the file prints
an error with its line and column instead.

## 4. Try it for free

You will now **simulate** the program: run it on a copy of Base as it is right now, with nothing
signed or sent. The transaction that runs a program on your Pot is called a **cook**, and the
**Kitchen** is the contract that makes Pots and charges a small fee for each cook. The simulation
shows both.

```sh
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args <recipient> 1000000
```

- `--chain base` names the chain.
- `--wallet me` says whose Pot to use. No password is needed, because nothing is signed.
- `--assume-balance USDC:5` pretends your Pot holds 5 USDC, for this simulation only.
- `--args` gives `main` its inputs, in order: the recipient, then the amount. Put any Base address
  in place of `<recipient>`; `sauce wallet address me` prints your own. 1000000 is 1 USDC.

It prints what would happen:

```text
The cook succeeds from 0x2b89…71cc: gas used 94721 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  4 USDC (it held 5 USDC before)
…
What moved, in order:
  [1] wallet 0x2b89…71cc -> Pot 0x95A8…F2E5      0.00000374478538635 ETH  the cook's value
  [2] Pot                -> Kitchen 0x…          0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot                -> 0x2222…2222          1 USDC
```

Your addresses and numbers will differ. Read it from the bottom:

- **[3]** your Pot paid 1 USDC to the recipient;
- **[2]** your Pot paid the Kitchen its fee;
- **[1]** your wallet sent the fee to the Pot, as the cook's value;
- **gas used** is the network's charge for the cook, paid by your wallet in ETH;
- **after the Pot's deploy**: your Pot does not exist yet, so the simulation creates it first, as
  the real run will;
- **Left in the Pot**: 4 of the 5 assumed USDC stay in the Pot, not in your wallet.

Now ask for more than the Pot holds. Run the same command with `--assume-balance USDC:0.5`:

```text
The cook reverts: the program threw "not enough USDC"
```

That is your `require` doing its job: the cook would fail whole, and nothing would move.

## 5. Run it on Base

This step spends real money: about 0.001 ETH covers the fees, and the program pays 1 USDC.

Your Pot's address is known before the Pot exists, so you can send it tokens now. Print it:

```sh
sauce pot --chain base --wallet me
```

It prints the address as `"pot"`:

```text
{
  "chainId": 8453,
  "pot": "0x95A8…F2E5",
…
```

From an exchange or another wallet, send 1 USDC on Base to that address, and 0.001 ETH on Base to
your wallet's address (`sauce wallet address me`). Then run:

```sh
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

It asks for your password. The first time, it also asks to deploy your Pot, which is one extra
transaction, and says what it costs in gas: answer `deploy`. Then it simulates the cook again,
sends it, waits for it, and prints what happened:

```text
cook 0x5f…: success, gas used 184211, block 21004500
  explorer: https://basescan.org/tx/0x5f…
…
What moved, in order:
  [1] Pot 0x95A8… -> 0x66…  1 USDC
```

Open the explorer link to see the transaction on Basescan, Base's block explorer.

## What just happened

You wrote a program, and Sauce compiled it for Base. Your wallet sent one transaction, a cook, to
your Pot. The Pot ran the program: it checked its USDC, paid the recipient and paid the Kitchen's
fee. Had the check failed, nothing at all would have moved, and only the gas would have been spent.

What the Pot holds stays there until a program moves it. It is yours, but your wallet app will not
show it.

You can now: make a wallet, compile a program, read a simulation, and send a cook on Base.

## Next

- The next tutorial: [Write your first program](write-your-first-program.md), where you change this
  program into one of your own.
- What you just did, explained: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
