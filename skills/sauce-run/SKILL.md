---
name: sauce-run
description: Compile a Sauce program file and run it on a chain with the `sauce` CLI — deploy the Pot it runs as, rehearse the cook with no key, sign and send it, or publish a file's cross-chain intents from a wallet. Use when asked to compile, simulate, run, execute, test or deploy a Sauce program (`*.sauce.ts`), pass arguments to its `main`, or get its bytecode or unsigned transaction.
---

# Run a Sauce program

A Sauce program is a file of SauceScript that a Sauce engine executes atomically inside one
transaction. On an EVM chain it runs as a **Pot**: a small contract its owner controls, which holds
the program's tokens and calls `cook(engine, program)`. The `sauce` command in `@eco-incorp/sauce`
compiles the file, deploys the Pot, rehearses the cook, signs it and sends it. It needs no other
tool, reads no environment variables, and reaches a network only through `--rpc-url` or
`--config`.

Run the project's pinned copy, `npx sauce <command> --help`, for every option.

## Endpoints and signers

- **RPC URL**: `--rpc-url <url>`, or `--config sauce.config.json` holding
  `{ "rpcUrls": { "<chain id>": "<url>" } }`. That file is gitignored; never commit a URL.
- **Signer**: `--keystore <path>` (a JSON keystore v3; the password is asked for, or read from
  `--password-file`). `--private-key <hex>` also works but lands in shell history. The signer is the
  Pot's owner: `run`, `publish` and `pot --deploy` act for it.

## Steps

1. **Look up the chain's names** before writing: `npx sauce globals --chain base` lists the token
   symbols with their addresses, the protocol contracts a program can call, and the functions it
   needs no import for. `--protocol UniswapV3` shows one namespace's methods with every parameter
   named. Use only names it lists; `--json` gives the same for a program to read.
2. **Compile**, to check the program: `npx sauce compile pay.sauce.ts --chain base`. It prints the
   bytecode; `--json` adds the size, `main`'s parameters, the compiler and the engine it pairs with.
   A failing compile's `hint:` lines name the flag or define to add.
3. **Pot**: `npx sauce pot --chain base --owner <address>` prints the Pot's address, known before it
   exists. `npx sauce pot --deploy --chain base --config sauce.config.json --keystore <path>`
   deploys the signer's Pot. `--salt <label>` names another Pot of the same owner (`--salt-hex` for
   an exact 32-byte salt); use the same salt in every later command.
4. **Fund** the Pot with what the program spends: send its address the tokens, from any wallet.
5. **Rehearse**: `npx sauce simulate pay.sauce.ts --chain base --owner <address>`, with the
   endpoint, runs the cook as an `eth_call` from the owner — no key, nothing sent — and prints the
   gas it needs or the decoded reason it reverts.
6. **Run**: `npx sauce run pay.sauce.ts --chain base --config sauce.config.json --keystore <path>`
   compiles, rehearses, signs, sends and waits, then prints the hash, status and gas used. A Pot
   not deployed yet is deployed first once the user agrees at the prompt; `--yes` agrees in
   advance, and without a terminal it is required. Ask the user before passing `--yes`.
7. **Check** what was sent: `npx sauce inspect <tx hash> --source pay.sauce.ts`, with the
   endpoint, reads the transaction back — the Pot, the engine, the arguments the program got, and
   the route and reward of every intent it opens. It also reads calldata, and a file (its intents,
   with every value measured at run time named).

"With the endpoint" means `--rpc-url <url>`, or `--config sauce.config.json` beside `--chain`.

The transaction's value defaults to the Kitchen's execution fee, read from the chain; pass
`--value <wei>` when the program also spends native currency.

**For a wallet instead**: `npx sauce tx pay.sauce.ts --chain base --owner <address> --value <wei>`
prints the unsigned transaction as JSON, `{ chainId, to, data, value }`, for any wallet to sign from
the owner. `--format cast` prints it as a `cast send` line instead.

## Arguments to `main`

A program whose `main` declares typed parameters takes them at run time, so one compiled program
serves every call. `sauce compile --json` lists them. Pass them last, in order:

```sh
npx sauce run split.sauce.ts --chain base --config sauce.config.json --keystore <path> \
  --args 0xTOKEN '["0xA…","0xB…"]' 1000000 true
```

Arrays and tuples are JSON; `--args-json '[…]'` (or a file) gives them all as one JSON array.
Types are checked before anything is sent: `Address`, `Uint256` (or `number`, `bigint`), `bool`,
`bytes`, `string`, `T[]` and `{ field: T }`.

## Writing the program file

- It is plain JavaScript syntax; only `main`'s parameters carry type annotations. A bare body is
  wrapped in `main()` for you.
- The chain's names need no import: token symbols (`USDC`, `WETH`), protocol namespaces
  (`Uniswap.UniversalRouter`), `chainId`, and the `@sauce/token` functions
  (`transfer(token, to, amount)`, `approve`, `balanceOf`).
- `USDC.transfer(...)`, `USDC.approve(...)` and `Token(address).transfer(...)` are SafeERC20 writes,
  so USDT works. A symbol the chain does not register needs `Token(address)`.
- A compile-time value is a module-level `const` that `--define NAME=VALUE` replaces in a file with
  a `main` (`--defines file.json` gives several); in a file of top-level statements (no `main`),
  leave the name undeclared and define it. An address is written as its `0x…` integer.
- A leading `// @chain base` line makes `--chain` optional; the flag still wins.

[examples/pay.sauce.ts](examples/pay.sauce.ts) pays one recipient in USDC and USDT, from defines.
[examples/split.sauce.ts](examples/split.sauce.ts) takes its token, recipients and amount as
arguments.

## Intents to other chains

A program can open an intent to another chain: `Arbitrum(() => { … }).reward({ … })`. Pass
`--intent-deadline` and `--intent-creator`, and `--intent-execution-fee` when the intent's body runs
a program; the CLI names whichever is missing.

- `sauce run` cooks the file on the Pot, which funds the intents — use it when an amount is
  measured on chain while the program runs (a balance, a swap's output).
- `sauce publish file.sauce.ts --chain <source> --config … --keystore …` publishes the intents from
  the signer's wallet, with no Pot: it approves each reward token to the Portal and calls
  `publishAndFund`. Only a file whose intents are fixed when it is built qualifies; it refuses one
  with a measured amount and says to use `sauce run`. `--dry-run` rehearses without sending.

## Rules

- Never write an RPC URL or a key into a tracked file, a program or a command you commit.
- Rehearse with `sauce simulate` (or `publish --dry-run`) before the first real send.
- Do not pass `--yes` or deploy a Pot without the user's go-ahead: deploying costs gas.
