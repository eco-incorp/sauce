# Write your first program

**Tutorial** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Swap by name](swap-by-name.md)

> In the quick start you ran a program someone else wrote. Now you will write your own, one small
> change at a time, like adapting a recipe: first a limit on how much it pays, then a list of people
> to pay, then a running total it reports back. After each change you compile it and try it for
> free, so you see what it does before it could cost anything.

This is the second tutorial. It is for you once you have done the [quick start](quick-start.md):
you have the `sauce` command, a wallet named `me`, and the quick start's `pay.sauce.ts`. You change
that program into one of your own, using only what SauceScript, the language of programs, offers.
The quick start's words, such as Pot, cook and simulate, are in the
[glossary](../concepts/glossary.md).

## You will need

- No funds. Nothing in this tutorial is signed or sent: every run is a free simulation.
- The quick start done: the `sauce` command installed and the wallet `me`.
- A text editor and a terminal, in the folder where you saved `pay.sauce.ts`.

## You will have

- `payout.sauce.ts`, a program of your own that pays a list of people from your Pot, never more
  than a limit you give it, and returns what it paid;
- read a compile error, and fixed it;
- simulated each version of the program, and read what it did.

## 1. Start from the quick start's program

Make a new file, `payout.sauce.ts`, with the quick start's program in it, without its comments:

```js
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

You will change it in small steps. The first change is a mistake, on purpose.

## 2. Read a compile error

Rename the recipient in the last line only, so it reads `USDC.transfer(recipient, amount);`. Then
compile the program for Base:

```sh
sauce compile payout.sauce.ts --chain base
```

It refuses, and says where and why:

```text
sauce compile: payout.sauce.ts does not compile for base
compiling the program failed
│
├─▶ compilation failed
│
╰─▶ `recipient` is not a declared variable
    ├╴`recipient` is not a declared variable (bytes 267..276)
    ╰╴error: `recipient` is not a declared variable
       --> payout.sauce.ts:3:17
        |
      3 |   USDC.transfer(recipient, amount);
        |                 ^^^^^^^^^
hint: if recipient is a value you supply, make it a parameter of main (`recipient: Uint256`, or `Address`) and pass it with --args
```

The line `--> payout.sauce.ts:3:17` points at line 3, column 17 of your file, and the `hint:` line
says what to do. Here the name is simply wrong: change it back to `to`, and compile again. It
prints the bytecode, the compiled program, as one line of hex.

A program captures nothing from outside it. Every value it uses is a parameter of `main`, a name
Sauce knows on the chain (such as `USDC`), or something the program declares itself.

## 3. Add a parameter and a check

Give the program a limit: the most it may pay. Add a third parameter, `limit`, and a `require` that
stops the program when `amount` is above it:

```js
function main(to: Address, amount: Uint256, limit: Uint256) {
  require(amount <= limit, "more than the limit");
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

`Uint256` is a whole number, and amounts are in the token's smallest unit: USDC has 6 decimals, so
1000000 is 1 USDC. Ask the compiler what `main` takes now:

```sh
sauce compile payout.sauce.ts --chain base --json
```

Among what it prints is `entryParams`, the parameters it found, in order:

```text
  "entryParams": [
    {
      "name": "to",
      "type": "Address"
    },
    {
      "name": "amount",
      "type": "Uint256"
    },
    {
      "name": "limit",
      "type": "Uint256"
    }
  ],
```

Each is one value after `--args`, in that order. Simulate a payment of 2 USDC with a limit of
1 USDC, giving the Pot 5 USDC for the simulation as in the quick start:

```sh
sauce simulate payout.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args <recipient> 2000000 1000000
```

```text
The cook reverts: the program threw "more than the limit"
…
```

Your check stopped it: the whole cook would fail, and nothing would move. Run it again with
`1000000 1000000` after the recipient, a payment of 1 USDC with a limit of 1 USDC, and it succeeds:

```text
The cook succeeds from 0x2b89…71cc: gas used 96500 for the cook, after the Pot's deploy (1. below), returns 0x
…
```

## 4. Pay a list of people

Pay several recipients the same amount. Change `to: Address` into `recipients: Address[]`, an array
of addresses, and loop over it with `for (const to of recipients)`. The limit now covers the total,
`amount * recipients.length`, and so does the balance check:

```js
function main(recipients: Address[], amount: Uint256, limit: Uint256) {
  require(amount * recipients.length <= limit, "more than the limit");
  require(self.USDC >= amount * recipients.length, "not enough USDC");
  for (const to of recipients) {
    USDC.transfer(to, amount);
  }
}
```

`recipients.length` is the number of addresses in the array. An array argument is given as JSON,
in single quotes so the shell passes it whole. Simulate paying two recipients 1 USDC each, with a
limit of 2 USDC:

```sh
sauce simulate payout.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args '["<recipient>","<another recipient>"]' 1000000 2000000
```

```text
The cook succeeds from 0x2b89…71cc: gas used 136185 for the cook, after the Pot's deploy (1. below), returns 0x
Left in the Pot, not in the owner's wallet:
  3 USDC (it held 5 USDC before)
…
What moved, in order:
  [1] wallet 0x2b89…71cc -> Pot 0x95A8…F2E5      0.00000374478538635 ETH  the cook's value
  [2] Pot                -> Kitchen 0x…          0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot                -> 0x2222…2222          1 USDC
  [4] Pot                -> 0x3333…3333          1 USDC
```

Two transfers, [3] and [4], in one cook. With a limit of `1500000` instead, the first `require`
fails, and neither recipient is paid: a check that fails stops every step, even the ones before it.

## 5. Pay as many as the limit allows

Change the rule: instead of refusing the whole list, pay recipients in order and stop before the
payment that would pass the limit. Keep a running total, `paid`, decide with `if` before each
payment, leave the loop with `break`, and return the total:

```js
function main(recipients: Address[], amount: Uint256, limit: Uint256): Uint256 {
  let paid = 0;
  for (const to of recipients) {
    if (paid + amount > limit) {
      break;
    }
    require(self.USDC >= amount, "not enough USDC");
    USDC.transfer(to, amount);
    paid += amount;
  }
  return paid;
}
```

- `let paid = 0;` declares a variable that can change. Integers are written plainly, `0`.
- `: Uint256` after the parameters says what `main` returns.
- `paid += amount;` adds to the total. If a sum ever overflowed, the program would revert, failing
  whole with nothing moved, rather than wrap around.

Simulate the same two recipients with a limit of 1.5 USDC:

```sh
sauce simulate payout.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args '["<recipient>","<another recipient>"]' 1000000 1500000
```

```text
The cook succeeds from 0x2b89…71cc: gas used 117115 for the cook, after the Pot's deploy (1. below), returns 0x00000000000000000000000000000000000000000000000000000000000f4240
main returns Uint256: 1000000
Left in the Pot, not in the owner's wallet:
  4 USDC (it held 5 USDC before)
…
What moved, in order:
  [1] wallet 0x2b89…71cc -> Pot 0x95A8…F2E5      0.00000374478538635 ETH  the cook's value
  [2] Pot                -> Kitchen 0x…          0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot                -> 0x2222…2222          1 USDC
```

The first recipient was paid. The second payment would have made 2 USDC, past the limit, so the
loop stopped, and `main returns Uint256: 1000000` says it paid 1 USDC in all. The return value
comes back from the cook, and the simulation reads it as the type `main` declares.

## 6. Write its header

A program starts with a comment that says what it does, the command that runs it, and each input
with its type and unit, as `pay.sauce.ts` does. Anyone reading it, you included in a month, then
knows how to run it. The finished program:

```js
// Pays `amount` of USDC from your Pot to each of `recipients` in turn, and stops paying once the
// next payment would take the total past `limit`. Returns the total it paid.
//
//   sauce simulate payout.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args '["<recipient>","<recipient>"]' 1000000 1500000
//
//   recipients: Address[]   who gets paid, in order: addresses on Base
//   amount: Uint256         what each one gets, in USDC's smallest unit: 1000000 is 1 USDC
//   limit: Uint256          the most it pays in all, in the same unit
function main(recipients: Address[], amount: Uint256, limit: Uint256): Uint256 {
  let paid = 0;
  for (const to of recipients) {
    if (paid + amount > limit) {
      break;
    }
    require(self.USDC >= amount, "not enough USDC");
    USDC.transfer(to, amount);
    paid += amount;
  }
  return paid;
}
```

Compile it once more with `sauce compile payout.sauce.ts --chain base`: it prints the bytecode.

This program is for Base, and for Ethereum, where the same names exist. Compiled for Solana it is
refused: there, each recipient's token account must be known when the transaction is built, and a
recipient taken from a list is only known as the program runs.

## What just happened

You changed a program four times, and the compiler and the simulation told you, each time, what
it would do. You used typed inputs, including an array, two kinds of check (`require`, which stops
everything, and `if`, which decides one step), a loop, a running total and a return value. Every
run was a simulation, so nothing was spent.

To run `payout.sauce.ts` for real, use `sauce run` with the same `--chain`, `--wallet` and `--args`,
as in step 5 of the quick start.

## Next

- The next tutorial: [Swap by name](swap-by-name.md), where a program trades through a protocol
  it names.
- Why the language is shaped this way, and how values reach a program:
  [SauceScript](../concepts/saucescript.md). Every construct, with its rules, is in the
  [SauceScript reference](../reference/saucescript.md).
- Have your editor check SauceScript as you type: [In an editor](cli-programs.md#in-an-editor).
