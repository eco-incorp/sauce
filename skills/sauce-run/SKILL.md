---
name: sauce-run
description: Compile a Sauce program file (or a JSON actions document) and run it on a chain with the sauce command — find the names a chain offers, deploy the Pot it runs as, fund it, rehearse the cook with no key, sign and send it, pass arguments to its main, print the unsigned transaction for a wallet, read a transaction back, or publish a file's cross-chain intents from a wallet and fill, prove, claim, refund or cancel them. Use when asked to compile, simulate, run, execute, test, send or deploy a Sauce program (*.sauce.ts), pass arguments to its main, get its bytecode or unsigned transaction, fund or create a Pot, or check what a transaction did.
---

# Run a Sauce program

A Sauce program is a file of SauceScript that a Sauce engine executes atomically inside one
transaction. On an EVM chain it runs as a **Pot**: a small contract its owner controls, which holds
the program's tokens and calls `cook(engine, program)`. The `sauce` command in `@eco-incorp/sauce`
compiles the file, deploys the Pot, rehearses the cook, signs it and sends it. It needs no other
tool, reads no environment variables, and reaches a network only through `--rpc-url` or
`--config`.

Run the project's own copy, `npx sauce <command> --help`, for every option. On Solana the same
commands apply with differences in accounts, signing and fees: read `sauce-solana` alongside.

| Command          | Does                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `sauce globals`  | The tokens, protocol contracts, chains and functions a program on a chain can use |
| `sauce compile`  | Compiles a file for a chain; prints its bytecode, or with `--json` what it takes  |
| `sauce actions`  | Lowers a JSON actions document for a chain; prints its SauceScript and bytecode   |
| `sauce pot`      | Prints the owner's Pot address and its deploy transaction; deploys it             |
| `sauce simulate` | Rehearses the cook from the Pot's owner, with no key: gas, or why it reverts      |
| `sauce run`      | Compiles, rehearses, signs, sends and waits for the cook on the signer's Pot      |
| `sauce tx`       | Prints the unsigned cook transaction, for any wallet to sign                      |
| `sauce intent`   | Publishes, fills, proves, claims, refunds and cancels intents (`sauce-intents`)   |
| `sauce inspect`  | Reads a transaction, calldata or a file back as what the program does             |
| `sauce verify`   | Checks that a payload, cook or transaction runs the audited settle program        |
| `sauce price`    | Turns a price into a pool's `sqrtPriceX96`, a swap's limit and its average floor  |

## Endpoints and signers

- **RPC URL**: `--rpc-url <url>`, or `--config sauce.config.json` holding
  `{ "rpcUrls": { "<chain id>": "<url>" } }`. Keep that file out of git; never commit a URL.
- **Signer**: `--keystore <keystore>`, a JSON keystore; its password is asked for at the terminal,
  or read from `--password-file <file>`. `--private-key <hex>` also works but lands in shell
  history. On Solana, `--keypair <keypair>`. The signer is the Pot's owner: `run` and `pot --deploy` act
  for it, and `sauce intent publish` publishes from it. On an EVM chain `pot --deploy --owner <address>` deploys another
  owner's Pot instead, the signer paying; the Pot is that owner's alone.
- Pass each flag and each value as a word of its own, in any order: a shell variable holding
  several flags reaches the command as one word unless the shell splits it.
- A program can come from stdin: give `-` as the file (`cat pay.sauce.ts | npx sauce compile -
--chain base`). Its relative imports then resolve against the current directory, or
  `--source-dir <dir>`. Stdin is then spent, so questions go to the terminal; with none, pass
  `--password-file` for a keystore, and `--auto-approve` once the user agrees to what the run
  lists.

## Steps

1. **Look up the chain's names** before writing: `npx sauce globals --chain base` lists the token
   symbols with their addresses, the protocol contracts a program can call, and the functions it
   needs no import for. `--protocol UniswapV3` shows one namespace's methods with every parameter
   named; `--json` gives the same for a program to read. Use only names it lists.
2. **Compile**, to check the program: `npx sauce compile pay.sauce.ts --chain ethereum`. It prints the
   bytecode; `--json` adds the size, `main`'s parameters, the compiler and the engine it pairs with,
   and what the compile applied: `defines` (each define the file reads, its value, whether the user
   or the chain set it, and the chain it applied on), `contracts` (each protocol contract it calls,
   resolved on its chain), and `payload`, its size with `main`'s arguments given by `--args`. On
   Solana, `cook` says whether the cook fits one transaction. A failing compile points at the
   file's line and column, and its `hint:` lines name the flag or define to add. Every command
   takes the chain as `--chain <slug or id>`. A file may name its own chain instead, in a
   `// @chain base` line among the `//` comment lines it starts with (and `// @target svm` alone
   picks Solana); `--chain` overrides it. Leave the line out of a file meant for more than one
   chain.
3. **Pot**: `npx sauce pot --chain base --owner <address>` (or `--keystore <keystore>` for the
   signer's own) prints the Pot's address, known before it exists, and its deploy transaction.
   With `--config sauce.config.json` it also says whether the chain has the released engine and
   Kitchen (and the Kitchen's fee) and whether the Pot is deployed.
   `npx sauce pot --deploy --chain base --config sauce.config.json --keystore <keystore>` deploys the
   signer's Pot. `--salt <label>` names another Pot of the same owner (`--salt-hex <bytes32>` for an
   exact salt); use the same salt in every later command.
4. **Fund** the Pot with what the program spends: send its address the tokens from any wallet, or
   pass `--fund USDC:1.5` (repeatable; `USDC:1500000n` in base units, `ETH:0.01` as value) to `run`,
   which pulls it from the signer into the Pot in the same cook; `--sweep` returns what is left.
   `--fund-mode` picks how:
   - `permit2` (the default) signs a one-time Permit2 transfer; the first time per token it asks to
     approve Permit2, a standing approval to Permit2 (not to the Pot).
   - `permit` signs the token's own EIP-2612 permit for exactly the amount: no approval transaction,
     no prompt and nothing left standing. It needs a token that implements it, such as USDC, and is
     refused for one that does not. Prefer it for such tokens.
   - `allowance` approves the Pot for the amount (asking first), and the cook pulls it.
   - `transfer` sends the tokens to the Pot in a transaction of its own before the cook.

   **Units**: `--fund` and `--assume-balance` take whole tokens (`USDC:10` is 10 USDC), or base
   units ending in `n` (`USDC:10000000n`, the same 10 USDC), and a token the chain does not register
   as `<address>:<amount>`, in its own decimals. `--args` and defines always take base units
   (`10000000` is 10 USDC). `simulate --fund` with the owner's key rehearses it.

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
   compiles, rehearses, signs, sends and waits, then prints the hash, status and gas used, what the
   cook cost (gas, any L1 data fee, the value) and the tokens it moved. A Pot not
   deployed yet is deployed first once the user agrees at the prompt. `--auto-approve` approves, in
   advance, everything a run sends before its cook (deploying the Pot, approving Permit2 or the Pot
   for `--fund`) and names each; with no terminal the run lists what it needs approved and sends
   nothing until it is given. Ask the user before passing `--auto-approve`.
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
  the define. In a `--defines` file, give an address or any value past 2^53 as a JSON string, hex
  or decimal: a JSON number loses precision. An address in a program is a hex integer with an `n`,
  as Base's USDC is `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n`; on the command line it is plain
  hex.
- In a project `sauce init` wrote, put programs in `programs/`: its `tsconfig.json` types them as
  SauceScript, so an editor's TypeScript errors there are real ones (with the project's own
  TypeScript running the editor). Elsewhere a program shows TypeScript errors that the compile
  does not have; `sauce compile` is what decides.
- `sauce-script` covers the language and what compiling for a chain adds to it.

[examples/pay.sauce.ts](examples/pay.sauce.ts) pays a recipient in USDC and USDT, on any chain that registers both.
[examples/split.sauce.ts](examples/split.sauce.ts) takes its token, recipients and amount as
arguments.

## Actions documents

An actions document is JSON: a list of protocol operations in place of a program (`sauce-actions`
covers writing one). `npx sauce actions swap.json --chain base` lowers it for the chain and prints
the SauceScript it becomes, `main`'s parameters and the bytecode; `--json` gives the same for a
program to read. `compile`, `simulate`, `tx` and `run` take a document wherever they take a
`.sauce.ts` file, with the same flags:

- its `argument` actions are `main`'s parameters, passed with `--args` in the order they are
  declared;
- `--chain` defaults to the document's `chainId`, and a document without one needs it;
- `--define` and `--defines` are refused: a document's values are its own fields.

## Intents and Solana

- **A file that opens intents** (`Arbitrum(() => { … }).reward({ … })`) also takes
  `--intent-deadline <unix seconds>`, `--intent-creator <address>` and, when an intent's body runs a
  program, `--intent-execution-fee <wei>` (`auto` reads it from the destination through
  `--config`). With `--config`, `compile` and `sauce intent publish` warn while the Pot such an intent cooks on
  is not deployed on its destination: no solver can fill it until then, and the warning names the
  `sauce pot --deploy` that deploys it. `sauce run` opens them from the Pot, which is the way when
  an amount is measured on chain; `sauce intent publish` opens fixed ones from a wallet with no Pot, and
  `sauce intent publish <file> --chain <chain> --from <address> --format json` prints its unsigned
  transfers and `publish` for any wallet to send, in that order. Both fund each reward by a transfer
  into the intent's vault, then `publish`: no approval. `--intent-fund-via publishAndFund` switches
  either to an approve and `publishAndFund`. `sauce intent publish … --dry-run --assume-balance
USDC:<amount>` rehearses it from a wallet that does not hold the reward yet.
  `sauce intent fill <file> --chain <chain> --config sauce.config.json` rehearses each intent where its
  body runs: on its destination chain, as the solver who fills it, with no key and nothing sent.
  `publish --dry-run` covers only the source chain. `fill` prints what the body moved, what it left
  in the shared Pot, and why it reverts. `--config` must name the destination chain's endpoint.
  `sauce-intents` covers writing, publishing, funding (including a transfer into the intent's
  vault), rehearsing them, and every later step (`sauce intent fill --send`, `prove`, `claim`,
  `refund`, `cancel`, `status`, `import`).
- **On Solana** (`--chain solana`) a program declares every account it touches, a cook signs with
  `--keypair`, and the execution fee is read from the cluster and printed as `fee`, with no
  `--value`; `--max-execution-fee <lamports>` refuses a cook whose fee is above it. `--via kitchen`,
  the default, cooks through the Kitchen on the owner's Pot; `--via engine` calls the engine
  directly, with no Pot: the signer pays the fee and is the authority the program acts with
  (`--account NAME=owner`), and the program's own calls get one more level of CPI depth. `--fund`
  and `sauce intent publish` are EVM only. A `simulate` that succeeds lists what the cook moved: each token
  account's balance change and each account's lamports, read from the accounts as the simulation
  leaves them. `sauce-solana` covers writing and running one.

## Without the CLI: the MCP tools

The same steps are tools of the Sauce MCP server, for an agent with no local install but Node.js:
`npx -y @eco-incorp/sauce mcp` starts it over stdio. A tool takes the program as text (`source`)
and the command's flags as inputs of the same name in camelCase; `args` is `main`'s arguments as a
JSON array. A tool that reads a chain takes `rpcUrl`, an endpoint for that one call, which is never
returned. Nothing signs: the user signs and sends what `sauce_tx`, `sauce_pot` and the
`sauce_intent_*` tools return, with their own wallet. The server keeps no intents: an intent tool
takes the intent's `record` (which `sauce_intent_publish` and `sauce_intent_import` return), or the
transaction that published it with its source chain.

| Command                | Tool                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `sauce globals`        | `sauce_globals`                                                        |
| `sauce compile`        | `sauce_compile`                                                        |
| `sauce actions`        | `sauce_actions`, and with owner or pot the cook                        |
| `sauce pot`            | `sauce_pot`: the address, the deploy, whether it exists, what it holds |
| `sauce simulate`       | `sauce_simulate`                                                       |
| `sauce tx`             | `sauce_tx`                                                             |
| `sauce intent publish` | `sauce_intent_publish`, unsigned or as a dry run                       |
| `sauce intent fill`    | `sauce_intent_fill`: the solver's fill, unsigned, or rehearsed         |
| `sauce intent import`  | `sauce_intent_import`                                                  |
| `sauce intent status`  | `sauce_intent_status`: where it stands, and what can happen next       |
| `sauce intent prove`   | `sauce_intent_prove`                                                   |
| `sauce intent claim`   | `sauce_intent_claim`                                                   |
| `sauce intent refund`  | `sauce_intent_refund`                                                  |
| `sauce intent cancel`  | `sauce_intent_cancel`                                                  |
| `sauce inspect`        | `sauce_inspect`                                                        |
| `sauce verify`         | `sauce_verify`                                                         |
| `sauce price`          | `sauce_price`, also from a pool read now                               |
| `sauce run`            | none: it signs                                                         |

`sauce_skills` and `sauce_skill` read these skills, and `sauce_install_skills` says how to install
them locally.

## Rules

- Never write an RPC URL or a key into a tracked file, a program or a command you commit.
- Rehearse with `sauce simulate` (or `publish --dry-run`, and `sauce intent fill` for an intent's body)
  before the first real send.
- Do not pass `--auto-approve` or deploy a Pot without the user's go-ahead: deploying costs gas, and with
  `--fund` it also approves Permit2 (or the Pot) to move the user's tokens.
