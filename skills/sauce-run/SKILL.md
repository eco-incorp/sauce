---
name: sauce-run
description: Compile a Sauce program file and run it on a chain with the sauce command — find the names a chain offers, deploy the Pot it runs as, fund it, rehearse the cook with no key, sign and send it, pass arguments to its main, print the unsigned transaction for a wallet, read a transaction back, or publish a file's cross-chain intents from a wallet. Use when asked to compile, simulate, run, execute, test, send or deploy a Sauce program (*.sauce.ts), pass arguments to its main, get its bytecode or unsigned transaction, fund or create a Pot, or check what a transaction did.
---

# Run a Sauce program

A Sauce program is a file of SauceScript that a Sauce engine executes atomically inside one
transaction. On an EVM chain it runs as a **Pot**: a small contract its owner controls, which holds
the program's tokens and calls `cook(engine, program)`. The `sauce` command in `@eco-incorp/sauce`
compiles the file, deploys the Pot, rehearses the cook, signs it and sends it. It needs no other
tool, reads no environment variables, and reaches a network only through `--rpc-url` or
`--config`.

Run the project's own copy, `npx sauce <command> --help`, for every option.

| Command          | Does                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `sauce globals`  | The tokens, protocol contracts, chains and functions a program on a chain can use |
| `sauce compile`  | Compiles a file for a chain; prints its bytecode, or with `--json` what it takes  |
| `sauce pot`      | Prints the owner's Pot address and its deploy transaction; deploys it             |
| `sauce simulate` | Rehearses the cook from the Pot's owner, with no key: gas, or why it reverts      |
| `sauce run`      | Compiles, rehearses, signs, sends and waits for the cook on the signer's Pot      |
| `sauce tx`       | Prints the unsigned cook transaction, for any wallet to sign                      |
| `sauce publish`  | Publishes a file's fixed intents from a wallet, with no Pot                       |
| `sauce inspect`  | Reads a transaction, calldata or a file back as what the program does             |
| `sauce verify`   | Checks that a payload, cook or transaction runs the audited settle program        |

## Endpoints and signers

- **RPC URL**: `--rpc-url <url>`, or `--config sauce.config.json` holding
  `{ "rpcUrls": { "<chain id>": "<url>" } }`. Keep that file out of git; never commit a URL.
- **Signer**: `--keystore <keystore>`, a JSON keystore; its password is asked for at the terminal,
  or read from `--password-file <file>`. `--private-key <hex>` also works but lands in shell
  history. On Solana, `--keypair <keypair>`. The signer is the Pot's owner: `run`, `publish` and
  `pot --deploy` act for it. On an EVM chain `pot --deploy --owner <address>` deploys another
  owner's Pot instead, the signer paying; the Pot is that owner's alone.
- Pass each flag and each value as a word of its own, in any order: a shell variable holding
  several flags reaches the command as one word unless the shell splits it.

## Steps

1. **Look up the chain's names** before writing: `npx sauce globals --chain base` lists the token
   symbols with their addresses, the protocol contracts a program can call, and the functions it
   needs no import for. `--protocol UniswapV3` shows one namespace's methods with every parameter
   named; `--json` gives the same for a program to read. Use only names it lists.
2. **Compile**, to check the program: `npx sauce compile pay.sauce.ts --chain ethereum`. It prints the
   bytecode; `--json` adds the size, `main`'s parameters, the compiler and the engine it pairs with.
   A failing compile points at the file's line and column, and its `hint:` lines name the flag or
   define to add.
3. **Pot**: `npx sauce pot --chain base --owner <address>` prints the Pot's address, known before it
   exists, and its deploy transaction.
   `npx sauce pot --deploy --chain base --config sauce.config.json --keystore <keystore>` deploys the
   signer's Pot. `--salt <label>` names another Pot of the same owner (`--salt-hex <bytes32>` for an
   exact salt); use the same salt in every later command.
4. **Fund** the Pot with what the program spends: send its address the tokens from any wallet, or
   pass `--fund USDC:1.5` (repeatable; `USDC:1500000n` in base units, `ETH:0.01` as value) to `run`,
   which pulls it from the signer into the Pot in the same cook; `--sweep` returns what is left.
   The default `--fund-mode permit2` signs a one-time Permit2 transfer, and the first time per token
   asks to approve Permit2. `simulate --fund` with the owner's key rehearses it.
5. **Rehearse**:
   `npx sauce simulate pay.sauce.ts --chain ethereum --owner <address> --config sauce.config.json --assume-balance USDC:1 --assume-balance USDT:1 --args <recipient> 1000000`
   runs the cook from the owner with no key and nothing sent, and needs neither a deployed Pot nor
   a funded one, so it can come before steps 3 and 4. A Pot not deployed yet is deployed in the
   same rehearsal first: anyone may send a Pot's deployment, and the Pot is the owner's either way.
   `--assume-balance TOKEN:amount` (repeatable; `ETH:<amount>` for the native currency) gives the
   Pot that balance for the rehearsal only; a token that keeps no stored balance (rebasing, shares)
   is refused. `--fund` with no key credits the Pot what its pull would bring. It prints the gas,
   what the program returns and what the cook did — token transfers and approvals, native
   transfers, each address's net change — or the decoded reason it reverts, and names the route
   it took: `eth_simulateV1`, or `eth_call` where the endpoint lacks it, which shows no transfers.
   `--json` gives the same for a program to read.
6. **Run**:
   `npx sauce run pay.sauce.ts --chain ethereum --config sauce.config.json --keystore <keystore> --args <recipient> 1000000`
   compiles, rehearses, signs, sends and waits, then prints the hash, status and gas used. A Pot not
   deployed yet is deployed first once the user agrees at the prompt; `--yes` agrees in advance, and
   with no terminal it is required. Ask the user before passing `--yes`.
7. **Check** what was sent:
   `npx sauce inspect <tx hash> --chain ethereum --config sauce.config.json --source pay.sauce.ts`
   reads the transaction back: the Pot, the engine, the arguments the program got, and the route and
   reward of every intent it opens. It also reads calldata, and a file (its intents, with every value
   measured at run time named).

The transaction's value defaults to the Kitchen's execution fee, read from the chain; pass
`--value <wei>` when the program also spends native currency.

**For a wallet instead**:
`npx sauce tx pay.sauce.ts --chain ethereum --owner <address> --value <wei> --args <recipient> 1000000`
prints the unsigned transaction as JSON, `{ chainId, to, data, value }`, for any wallet to sign from
the owner. `--format cast` prints it as a `cast send` line instead.

## Arguments to `main`

A program whose `main` declares typed parameters takes them at run time, so one compiled program
serves every call. `sauce compile --json` lists them as `entryParams`. Pass them last, in order:

```sh
npx sauce run split.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --args <token> '["<recipient>","<recipient>"]' 1000000 true
```

Arrays and records are JSON; `--args-json '[…]'` (or a file) gives them all as one JSON array.
Every value is checked against its declared type before anything is sent: `Address`, `Uint256`,
`bool`, `bytes`, `string`, `T[]` and `{ field: T }`. A parameter with no annotation is a `Uint256`.

## Writing the program file

- It names no chain: `--chain` picks one, and every name in it resolves on that chain. One file
  compiles for every chain whose names it uses.
- The chain's names need no import: token symbols (`USDC`, `WETH`), protocol namespaces
  (`Uniswap.UniversalRouter`), `chainId`, and the `@sauce/token` functions
  (`transfer(token, to, amount)`, `approve`, `balanceOf`). `sauce-globals` explains them.
- `USDC.transfer(...)`, `USDC.approve(...)` and `Token(address).transfer(...)` are SafeERC20 writes,
  so USDT works. A token the chain does not register is `Token(address)`.
- Runtime values are `main`'s parameters. A compile-time choice is a module-level `const` that
  `--define NAME=VALUE` replaces (`--defines values.json` gives several). A file of top-level
  statements with no `main`, such as an intent file, leaves the name undeclared and takes it from
  the define. An address in a program is a hex integer with an `n`, as Base's USDC is
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n`; on the command line it is plain hex.
- `sauce-script` covers the language and what compiling for a chain adds to it.

[examples/pay.sauce.ts](examples/pay.sauce.ts) pays a recipient in USDC and USDT, on any chain that registers both.
[examples/split.sauce.ts](examples/split.sauce.ts) takes its token, recipients and amount as
arguments.

## Intents to other chains

A program can open an intent to another chain: `Arbitrum(() => { … }).reward({ … })`. Pass
`--intent-deadline <unix seconds>` and `--intent-creator <address>`, and
`--intent-execution-fee <wei>` when the intent's body runs a program; the command names whichever
is missing. `sauce-intents` covers writing them.

- `sauce run` cooks the file on the Pot, which funds the intents: use it when an amount is measured
  on chain while the program runs (a balance, a swap's output).
- `sauce publish <file> --chain <chain> --config sauce.config.json --keystore <keystore>` publishes
  and funds the intents from the signer's wallet, with no Pot: it approves each reward token, then
  publishes. Only a file whose intents are fixed when it is built qualifies; it refuses one with a
  measured amount and says to use `sauce run`. `--dry-run` rehearses without sending.

## Solana

The same commands take `--chain solana`, with three differences:

- A program declares every account it touches as an `Account` parameter of `main`
  (`Account<Writable>`, `Account<Signer>`). Pass each as `--account NAME=<address>`, or
  `NAME=pot` for the Pot, which the Kitchen signs for, or `NAME=owner` for the signer.
  `sauce compile --json` lists them in its `manifest`.
- Sign with `--keypair <keypair>`. The Pot is the Kitchen's address for the owner and salt, so a cook
  names `--owner` (and `--salt`), never `--pot`.
- The Kitchen's fee is read from the cluster; there is no `--value`. A failed `simulate` or `run`
  prints the program logs. `sauce run` stages a program too large for one transaction. `sauce tx`
  prints a base64 transaction for a wallet. `sauce publish` does not work from Solana.

`sauce-solana` covers writing them.

## Rules

- Never write an RPC URL or a key into a tracked file, a program or a command you commit.
- Rehearse with `sauce simulate` (or `publish --dry-run`) before the first real send.
- Do not pass `--yes` or deploy a Pot without the user's go-ahead: deploying costs gas, and with
  `--fund` it also approves Permit2 (or the Pot) to move the user's tokens.
