# Solana quick start

**Tutorial** · [Documentation](../README.md) · [Quick start](quick-start.md) · [Solana](solana.md)

> Solana is a tidy chain. Before a transaction starts, it must list every box it will open: your
> wallet, your token balances, the token program, everyone it pays. Those boxes are called
> **accounts**. Writing that list by hand is the hard part of Solana, so Sauce writes it for you. It
> reads your program, your wallet and the address you pay, and works the list out. The program
> you wrote for Base runs on Solana unchanged.

This tutorial runs the [quick start](quick-start.md)'s program on Solana. It uses the same words:
your **Pot** is your own account on chain that holds the tokens your programs spend, a **cook** is
the transaction that runs a program on it, and the **Kitchen** is the program that creates Pots and
charges a small fee for each cook ([glossary](../concepts/glossary.md)).

**You will need:**

- **Real funds for step 4:** 0.1 SOL and 1 USDC on Solana, in any wallet or exchange account you can
  send from. Steps 1 to 3 cost nothing.
- Node.js 24 or newer and the `sauce` command. If you have not done the quick start, install it:

```sh
npm install -g @eco-incorp/sauce
```

**You will have:** a Solana wallet, a Pot on Solana, and a program that paid 1 USDC from that Pot,
run first on a copy of Solana and then for real.

## 1. Save the program

Save this as `pay.sauce.ts`. It is the quick start's program, unchanged:

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
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

## 2. Make a Solana wallet

A wallet is either for Ethereum-style chains or for Solana, so make a second one:

```sh
sauce wallet new me-solana --solana
```

It asks for a password twice and prints the wallet's address. Already use the Solana CLI?
`sauce wallet import me-solana ~/.config/solana/id.json` keeps that keypair as a wallet instead.

## 3. See the accounts Sauce found

```sh
sauce compile pay.sauce.ts --chain solana --json
```

Near the end, `manifest.accounts` lists the accounts the program needs. You wrote none of them:

| Account        | What it is                           | Where Sauce gets it               |
| -------------- | ------------------------------------ | --------------------------------- |
| `potUSDC`      | your Pot's USDC balance              | your wallet, which gives your Pot |
| `pot`          | your Pot, which approves the payment | your wallet                       |
| `tokenProgram` | the program that moves USDC          | USDC, which it knows              |
| `toUSDC`       | the recipient's USDC balance         | the `to` you pass in `--args`     |

On Solana a wallet keeps each token in a separate account, its own pocket for that token, called a
**token account**. That is why the list names `potUSDC` and `toUSDC` and not just the Pot and the
recipient. After each payment the program checks that the pocket it paid really belongs to `to`, so
nobody can swap in another.

## 4. Try it for free

```sh
sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 \
  --args <recipient> 1000000
```

Put any Solana address in place of `<recipient>`; yours works (`sauce wallet address me-solana`).
The first time, the command downloads the small Solana simulator it uses, which takes a moment.
Then it copies the accounts it needs from Solana, runs the program on that copy, and tells you what
would happen:

```text
The cook succeeds from CUVw…2B7V: 60225 compute units
Left in the Pot, not in the owner's wallet:
  4 USDC, in 3x6B…zCZ (it held 5 USDC before)
…
Token balance changes:
  3x6B…zCZ (potUSDC, the Pot's USDC account), owned by 7r16…7aP (the Pot): -1 USDC
  DEgw…gVi (toUSDC, main's argument to's USDC account), owned by 87bm…evT: +1 USDC
```

Your addresses and numbers will differ. The first line says the cook would succeed, and how much
work it took (compute units are Solana's measure of work). The last two lines are the payment: your
Pot's USDC account paid 1 USDC, and the recipient's USDC account received it. Before that, the
output notes which accounts do not exist yet: your Pot's USDC account, and the recipient's if they
never held USDC. The real run creates them, and the output lists what each costs, under its
lamport changes (lamports are SOL's smallest unit).

## 5. Fund your wallet and your Pot

Your wallet pays the fees, in SOL. Send it 0.1 SOL from any wallet or exchange, to the address
`sauce wallet address me-solana` prints. That covers the first run's costs:

- **Rent**, a deposit Solana charges for every new account. Your Pot keeps 10 KB of storage for
  your programs, so its rent is the big one, about 0.072 SOL, paid once. A token account's is about
  0.002 SOL.
- **The Kitchen's fee** and the transaction fees, a fraction of a cent each run.

Your Pot pays the USDC. Find your Pot:

```sh
sauce pot --chain solana --wallet me-solana
```

It prints your Pot's address as `"pot"`, and a note for each token naming the Pot's own account for
it:

```text
The Pot's USDC account, --account NAME=pot:USDC: <address>, not created yet (a wallet's SPL transfer to the Pot creates it)
```

Your Pot holds USDC in that account, not at the Pot's address itself. Send 1 USDC on Solana to the
Pot's address from any wallet: a wallet's USDC transfer to an address lands in that address's USDC
account, and creates it the first time. Run `sauce pot` again, and the note says the account holds
1 USDC.

## 6. Run it on Solana

```sh
sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
```

It asks for your password. Then it asks before each thing it must create: your Pot, and the
recipient's USDC account if they have none (you pay that rent). The program is larger than one
Solana transaction can carry, so the run first uploads it in a few transactions (this is called
**staging**), runs it, and then closes the upload, which gives its rent back:

```text
created Pot 7r16…7aP in dLsm…hU8: success, 8077 compute units
staged the 759-byte program in 3 transactions
cook 5stq…A2k: success, 60220 compute units
  explorer: https://solscan.io/tx/5stq…A2k
…
Token balance changes:
  3x6B…zCZ (potUSDC, the Pot's USDC account), owned by 7r16…7aP (the Pot): -1 USDC
  DEgw…gVi (toUSDC, main's argument to's USDC account), owned by 87bm…evT: +1 USDC
closed the code buffer in 64or…18h4: success, 5874 compute units
```

The explorer link shows the cook on Solscan. The recipient now holds 1 USDC more.

## What is different on Solana

Very little, for you:

- **The same program.** `USDC.transfer` and `self.USDC` work as on Base. Sauce adds the accounts
  and checks them.
- **The Kitchen fee is in SOL**, and the run prints it.
- **New accounts cost rent.** Your Pot's is paid once.
- **Large programs are staged first.** The run does it, and gives the upload's rent back.

Programs that call other Solana programs, swap at Solana pools or use Token-2022 tokens such as
PYUSD and tokenized stocks are in the [Solana guide](solana.md).

## Next

- Next tutorial: [Sauce from TypeScript](typescript-quick-start.md) builds a cook from your own
  code.
- What you just did, explained: [How Sauce runs on Solana](../concepts/solana-model.md) covers
  accounts, staging and the compute budget.
- Swap at Solana pools by name: [venues by namespace](solana.md#venues-by-namespace).
