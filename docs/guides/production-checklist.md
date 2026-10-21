# Production checklist

**How-to guide** · [Documentation](../README.md) · [Run a program](cli-run.md) · [Safety](../concepts/safety.md)

> A program that worked once with 1 USDC is not yet ready for real money. This page is the list to
> go through before it is: bounds in the program, limits on the wallet, a simulation you have read,
> endpoints you trust, a transaction you have checked, and versions that do not move under you.

This page is for someone who can already write, simulate and run a program
([Run a program](cli-run.md)) and is about to run one with funds that matter. Work through each
section in order. Each item is a check you can do with the `sauce` command; the
[Safety](../concepts/safety.md) concept says why each one matters.

## Bound what the program can do

- **Every amount is an input.** Amounts, recipients and limits are `main` parameters given with
  `--args`, never values edited into the file between runs. Amounts are in the token's smallest
  unit: 1000000 is 1 USDC.
- **Every swap has a floor.** Each swap takes a minimum output, a price limit, or both. A swap
  with a zero limit and a zero minimum takes any price. [Swap by name](swap-by-name.md) and the
  [`@sauce/router` reference](../api/router.md) show both.
- **The program checks what it relies on.** A `require` before each step that needs a balance or
  a price stops the whole cook, and nothing moves. Prove that each one fires with
  `sauce simulate … --expect-revert "<message>"`.
- **Results end where you mean them to.** What a program produces stays in your Pot unless it
  sends it on. For each result, decide: your wallet, another address, or the Pot
  ([Where a program's results end](../concepts/kitchen-pot-cook.md#where-a-programs-results-end)).

## Limit the wallet that signs

- **Keep small balances in hot wallets.** A wallet `sauce` keeps is as safe as its file and its
  password. For large amounts, let a wallet that keeps its own key sign
  ([Sign with your wallet's MCP server](wallet-mcp.md)), or sign elsewhere with `sauce tx` and
  `sauce send`.
- **Give each wallet a policy.** A `<name>.policy.json` beside it names the chains it sends on, the
  addresses it sends to, and how much of each token and of the chain's coin may leave, per
  transaction and per day ([Put a spending limit on a wallet](cli-wallets.md#put-a-spending-limit-on-a-wallet)).
- **Lock the files down.** The policy and any password file are readable and writable only by
  you (`chmod 600`). The command refuses either one when it is not.
- **Name the password's source.** In a script or CI job, use `--password-file` or
  `--password-command` with a secret manager. Never put a key on the command line.

## Simulate exactly what you will send

- **Same program, same arguments.** Simulate the file you will run, with the arguments you will
  give it, from the owner who will send it.
- **On the state your numbers came from.** A price limit taken from `sauce pools` or `sauce price`
  is for one block. Pass that block to `sauce simulate --block <number>`, then simulate again at
  `latest` just before sending.
- **Read the whole report.** Check what leaves your wallet, what arrives where, what stays in the
  Pot, and the gas ([Read what it prints](cli-run.md#read-what-it-prints)). It counts tokens only:
  a position a protocol keeps in its own books shows in no balance.
- **Simulate the funding too.** With `--fund`, simulate with the owner's wallet so the pulls are
  signed and run as the real cook will run them.

## Use endpoints you trust

- **Your own endpoints.** Give each chain's endpoint in a `--config` file, kept out of git
  ([Your own endpoints](cli.md#your-own-endpoints)). The built-in public ones are fine for trying
  things, and can be slow or rate-limited.
- **With `eth_simulateV1`.** A full simulation report, and a wallet policy's limits, need an
  endpoint that serves it. Without it, a send whose limits cannot be measured is refused.
- **On a supported chain.** The command sends on Ethereum, Base and Solana only. A program that
  opens an intent to a preview chain is refused before anything is sent.

## Check the transaction you sign

- **Review three things together**: the final program, the arguments it is called with, and what
  the simulation says will happen.
- **Check unsigned transactions before signing them.** When another signer signs, print the
  transaction with `sauce tx`, and take its `data` apart against your file:

  ```sh
  sauce inspect <data> --chain base --source pay.sauce.ts
  ```

  This checks that the program in the call is the one your file compiles to, and decodes the
  arguments after it. `to` must be your Pot.

- **Sign with the gas the plan gives.** For a Pot not created yet, `sauce tx` prints its creation
  and the cook, each with `gas`. A signer's own estimate of the cook is far too low.
- **Accepting settlements from someone else?** Verify them before you rely on them, with
  `sauce verify` or the SDK's checks ([Verifying settlement programs](verification.md)).

## Know what it costs

- **Your wallet pays.** It pays the gas and the Kitchen's fee in the chain's coin, and the first
  run pays for your Pot's creation too. On Solana it also pays rent for new accounts.
- **Fund the Pot first, or with the cook.** Send tokens to the Pot's address, or pass `--fund`.
- [Costs](../concepts/costs.md) lists every part.

## Pin the versions

- **Pin the package exactly.** `sauce init` writes an exact version; in another project use
  `npm i -D -E @eco-incorp/sauce`, and run `npx sauce`, so every machine and CI job runs the same
  command and compiler.
- **Keep the skills in step.** If agents write your programs, run `sauce skills status` in CI: it
  exits 1 while the skills are outdated.
- **Upgrade on purpose.** Read the [changelog](../changelog.md) before moving to a new version, then
  simulate your programs again on it ([Upgrading](upgrading.md)).

## Next

- When something fails on the way: [Troubleshooting](troubleshooting.md).
- How to move to a new release safely: [Upgrading](upgrading.md).
- Why each check matters: [Safety](../concepts/safety.md).
