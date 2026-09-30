---
name: sauce-run
description: Compile a Sauce program file and run it on an EVM chain with the `sauce` CLI and Foundry's `cast` — predict and deploy the Pot it runs as, fund it, build the cook transaction, and try it on a local anvil fork first. Use when asked to compile, run, execute, test or deploy a Sauce program (`*.sauce.ts`), or for its bytecode or transaction.
---

# Run a Sauce program

A Sauce program is a file of SauceScript that a Sauce engine executes atomically inside one
transaction. On an EVM chain it runs as a **Pot**: a small contract you own, which holds the
program's tokens and calls `cook(engine, program)`. The `sauce` command in `@eco-incorp/sauce`
compiles the file and prints the transactions; it signs and sends nothing, and it reaches no network
unless given `--rpc-url`. `cast` (or any wallet) sends what it prints.

Run it through the project's pinned copy: `npx sauce <command> --help`.

## What has to exist on chain

- The released Sauce Kitchen and engine on that chain, at the addresses the package records.
- A Pot owned by the account that sends the transaction — `cook` is `onlyOwner` — and funded with
  whatever the program spends: tokens it transfers, native it sends, and the Kitchen's execution fee
  as the transaction's value.

## Steps

1. **Compile**, to check the program: `npx sauce compile pay.sauce.ts --chain base --define NAME=VALUE`.
   It prints the bytecode; `--json` adds the size, the compiler, and the engine it pairs with.
2. **Pot**: `npx sauce pot --owner <address> --chain base` prints the Pot's address — known before it
   exists — and the `Kitchen.deployPot` transaction. Send that once; anyone may, and the Pot is the
   owner's either way.
3. **Fund** the Pot with what the program spends, e.g.
   `cast send <token> "transfer(address,uint256)" <pot> <amount> --rpc-url <RPC_URL> --account <name>`.
4. **Transaction**: `npx sauce tx pay.sauce.ts --chain base --owner <address> --rpc-url <RPC_URL>`
   prints `to` (the Pot), `data` (the cook) and `value` (the fee it read), a `cast send` line, and
   whether the Pot is deployed. Without `--rpc-url`, pass `--value <wei>` yourself. Send it **from
   the owner**.

Fill the printed `cast send` line's `<RPC_URL>` and signer in: prefer a keystore account
(`--account <name>`) or a hardware wallet (`--ledger`) to `--private-key`.

## Try it on an anvil fork first

Fork the chain locally, where the released contracts already are, and do every step against it:

```sh
anvil --fork-url <RPC_URL>
```

Then use `--rpc-url http://127.0.0.1:8545` for `sauce tx` and `cast`, and sign with one of the dev
accounts anvil prints (their keys are public; they exist only on the fork). Fund the Pot on the fork
the same way — send it tokens from an account that has them, or impersonate a holder with
`cast rpc anvil_impersonateAccount <holder>` and `cast send --unlocked --from <holder> …`.

## Writing the program file

- It is plain JavaScript syntax: no type annotations. A bare body is wrapped in `main()` for you.
- The chain's names need no import: token symbols (`USDC`, `WETH`), protocol namespaces
  (`Uniswap.UniversalRouter`), `chainId`, and the `@sauce/token` functions
  (`transfer(token, to, amount)`, `approve`, `balanceOf`).
- `USDC.transfer(...)`, `USDC.approve(...)` and `Token(address).transfer(...)` are SafeERC20 writes,
  so USDT works. A symbol the chain does not register needs `Token(address)`.
- A value the program takes is a module-level `const` that `--define NAME=VALUE` (or a
  `--defines file.json`) replaces; an address is written as its `0x…` integer.
- A leading `// @chain base` line makes `--chain` optional; the flag still wins.
- A program can open an intent to another chain: `Arbitrum(() => { … }).reward({ … })`. Pass
  `--intent-deadline` and `--intent-creator`, and `--intent-execution-fee` when that body runs a
  program. The CLI names whichever is missing.

[examples/pay.sauce.ts](examples/pay.sauce.ts) pays one recipient in USDC and USDT.

## Rules

- Never write an RPC URL or a key into a tracked file, a program or a command you commit. RPC URLs
  belong in the project's gitignored `sauce.config.json`; pass them as `--rpc-url`.
- Read a failing compile's `hint:` lines: they name the flag or define to add.
- `sauce tx` covers EVM chains. For Solana, `sauce compile --chain solana` compiles and reports the
  account manifest; staging and executing it goes through the SDK's Solana API.
