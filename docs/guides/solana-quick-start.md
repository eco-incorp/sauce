# Solana quick start

[Documentation](../README.md) · [Quick start](quick-start.md) · [Solana](solana.md)

> Solana is a tidy chain. Before a transaction starts, it must list every box it will open: your
> wallet, your token balances, the token program, everyone it pays. Those boxes are called
> **accounts**. Writing that list by hand is the hard part of Solana, so Sauce writes it for you. It
> reads your program, your wallet and the address you pay, and works the list out. The program
> you wrote for Base runs on Solana unchanged.

This page runs the [quick start](quick-start.md)'s `pay.sauce.ts` on Solana. If you have not done
the quick start, install the command and save that file first:

```sh
npm install -g @eco-incorp/sauce
```

## 1. Make a Solana wallet

A wallet is either for Ethereum-style chains or for Solana, so make a second one:

```sh
sauce wallet new me-solana --solana
```

It asks for a password twice and prints the wallet's address. Already use the Solana CLI?
`sauce wallet import me-solana ~/.config/solana/id.json` keeps that keypair as a wallet instead.

## 2. See the accounts Sauce found

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

On Solana a wallet keeps each token in a separate account, its own pocket for that token. That is
why the list names `potUSDC` and `toUSDC` and not just the Pot and the recipient. After each payment
the program checks that the pocket it paid really belongs to `to`, so nobody can swap in another.

## 3. Try it for free

```sh
sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 \
  --args <recipient> 1000000
```

Put any Solana address in place of `<recipient>`; yours works (`sauce wallet address me-solana`).
The first time, the command installs the small Solana simulator it uses. Then it copies the
accounts it needs from Solana, runs the program on that copy, and tells you what would happen:

```text
The cook succeeds from CUVw…2B7V: 60225 compute units
Left in the Pot, not in the owner's wallet:
  4 USDC, in 3x6B…zCZ (it held 5 USDC before)
…
Token balance changes:
  3x6B…zCZ (potUSDC, the Pot's USDC account), owned by 7r16…7aP (the Pot): -1 USDC
  DEgw…gVi (toUSDC, main's argument to's USDC account), owned by 87bm…evT: +1 USDC
```

Before that, it notes which accounts do not exist yet: your Pot's USDC account, and the recipient's
if they never held USDC. The real run creates them.

## 4. Run it on Solana

Two things need money:

- **Your wallet pays the fees and the rent**, in SOL. Have 0.1 SOL for the first run. Solana charges
  a deposit, called rent, for every new account. Your Pot keeps 10 KB of storage for your programs,
  so its deposit is the big one, about 0.072 SOL, paid once. A token account costs about 0.002 SOL.
  After that, a run costs a fraction of a cent in fees, plus the Kitchen's fee.
- **Your Pot pays the USDC.** Find its address, then send it 1 USDC on Solana from any wallet:

```sh
sauce pot --chain solana --wallet me-solana
```

Then run:

```sh
sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
```

It asks for your password. Then it asks before each thing it must create: your Pot, and the
recipient's USDC account if they have none (you pay that rent). The program is larger than one
Solana transaction can carry, so the run uploads it first, in a few transactions, runs it, and then
closes the upload, which gives its rent back:

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

## What is different on Solana

Very little, for you:

- **The same program.** `USDC.transfer` and `USDC.balanceOf` work as on Base. Sauce adds the accounts
  and checks them.
- **The Kitchen fee is in SOL**, and the run prints it.
- **New accounts cost rent**, the deposit Solana charges for storing data. Your Pot's is paid once.
- **Large programs are uploaded first.** The run does it, and gives the upload's rent back.

Programs that call other Solana programs, swap at Solana pools or use Token-2022 tokens such as
PYUSD and tokenized stocks are in the [Solana guide](solana.md).

## Next

- Send USDC from Ethereum to a Solana wallet, without touching Solana yourself:
  [ethereum-to-solana.ts](../examples/ethereum-to-solana.ts) builds that intent, and
  [your first cross-chain intent](first-intent.md) explains intents.
- Swap at Solana pools by name: [the Solana guide](solana.md#venues-by-namespace).
- Every command and flag for Solana: [the sauce command](cli-solana.md).
