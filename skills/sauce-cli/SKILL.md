---
name: sauce-cli
description: The sauce command line. Compile a Sauce program file (or a JSON actions document) and run it on a chain with the sauce command — find the names a chain offers, deploy the Pot it runs as, fund it, rehearse the cook with no key, sign and send it, pass arguments to its main, print the unsigned transaction for a wallet, read a transaction back, or publish a file's cross-chain intents from a wallet and fill, prove, claim, refund or cancel them. Transactions are built and sent on Ethereum, Base and Solana, the chains the initial release supports; every other chain is a preview chain, where programs compile and simulate and a transaction is refused with the link to request the chain. Use when asked to compile, simulate, run, execute, test, send or deploy a Sauce program (*.sauce.ts), pass arguments to its main, get its bytecode or unsigned transaction, fund or create a Pot, check what a transaction did, create or use an agent's own wallet and its policy, or when a command refuses a preview chain.
---

# The sauce command

A Sauce program is a file of SauceScript that a Sauce engine executes atomically inside one
transaction. On an EVM chain it runs as a **Pot**: a small contract its owner controls, which holds
the program's tokens and calls `cook(engine, program)`. The `sauce` command in `@eco-incorp/sauce`
compiles the file, deploys the Pot, rehearses the cook, signs it and sends it. It needs no other
tool and no configuration: it reads no environment variable but the one `--password-env` names,
and reads a chain through a built-in public endpoint unless given one of its own.

**Getting the command.** Install it once with `npm i -g @eco-incorp/sauce` (Node.js 24 or newer);
`sauce --version` checks it, and `npm i -g @eco-incorp/sauce@latest` upgrades it. Without an
install, run `npx -y @eco-incorp/sauce <command>` in its place. Never run a bare `npx sauce`
outside a project that depends on the package: npx then fetches and runs npm's unrelated `sauce`
package.

`sauce <command> --help` lists every option. On Solana the same commands apply with
differences in accounts, signing and fees: read `sauce-solana` alongside.

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
| `sauce wallet`   | Creates, lists and imports the wallets `--wallet` signs with                      |
| `sauce inspect`  | Reads a transaction, calldata or a file back as what the program does             |
| `sauce verify`   | Checks that a payload, cook or transaction runs the audited settle program        |
| `sauce price`    | Turns a price, or a pool's now, into `sqrtPriceX96`, the limits and `maxPrice`    |
| `sauce pools`    | Lists a pair's price-limit pools on a chain, deepest first, with their prices     |

## Supported chains

For the initial release, Sauce supports transactions on **Ethereum, Base and Solana**
(`--chain ethereum`, `base`, `solana`). Every other chain is a **preview chain**: `globals`,
`compile`, `actions`, `simulate`, `inspect`, `verify`, `price`, `pools`,
`sauce intent publish --dry-run`, `sauce intent fill` without `--send`, `sauce intent status` and
`sauce intent import` work there, and `sauce pot` predicts the Pot (and reads it)
but leaves its deployment out.
Everything that leaves a transaction ready to sign, unsigned JSON included, or sends one is refused
there before anything is read or signed: `tx`, `run`, `pot --deploy`, `pot --format cast`,
`sauce intent publish` and the intent steps sent there (`sauce intent fill --send`, `prove`,
`claim`, `refund`, `cancel`). An intent publishes only when its source and every destination it
opens are supported; each later step is refused by the chain it is sent on. A cascade's later
levels are not checked: keep them on supported chains too.
There is no flag that overrides it.

The refusal exits 1 and names the supported chains and the chain-support request for the chain:

```
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. …
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=…), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&…).
```

When a command refuses a chain, tell the user and offer that request: look for the chain among
the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add the use case to it as a comment, or
[open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the
chain-support form (the chain and its id, what runs there, the protocols and tokens, the expected
volume and timing). The command's own help ends with the same note.

## Endpoints and signers

- **Endpoints**: none needed. A command reads a chain through a built-in public endpoint, and says
  so on stderr; it can be slow or rate-limited. Your own is optional: `--rpc-url <url>`, or
  `--config <file>` holding `{ "rpcUrls": { "<chain id>": "<url>" } }` (a chain the file does not
  name is read through the built-in one). Keep that file out of git; never commit a URL.
  `--offline` reads no chain at all.
- **Signer**: `--wallet <name>`, a wallet `sauce wallet` keeps (see Wallets below), or
  `--keystore <keystore>`, a JSON keystore; either's password comes from the source named, or is
  asked for at the terminal. `--private-key <hex>` also works but lands in shell history. On
  Solana, a Solana `--wallet <name>` or `--keypair <keypair>`. The signer is the Pot's owner: `run` and `pot --deploy` act
  for it, and `sauce intent publish` publishes from it. On an EVM chain `pot --deploy --owner <address>` deploys another
  owner's Pot instead, the signer paying; the Pot is that owner's alone.
- Pass each flag and each value as a word of its own, in any order: a shell variable holding
  several flags reaches the command as one word unless the shell splits it.
- A program can come from stdin: give `-` as the file (`cat buy.sauce.ts | sauce compile -
--chain base`). Its relative imports then resolve against the current directory, or
  `--source-dir <dir>`. Stdin is then spent, so questions go to the terminal; with none, pass a
  password source for a wallet or keystore, and `--auto-approve` once the user agrees to what the
  run lists.

## Wallets

An agent with no wallet makes one, and it persists. `sauce wallet` keeps each key in the wallet
directory (`.sauce/wallets` in the user's home, or `--wallets <dir>`), encrypted under a password
the agent holds in its `.env` or its secret store. Name the password's source; never put the
password itself on a command line, in a file you commit, or in a message:

- `--password-env <NAME>`: the environment variable NAME, and no other.
- `--password-file <file>`: a file only the user can read; one others can read is refused.
- `--password-command "<command>"`: what a secret manager's command prints. Its output is never
  shown.
- With none, the password is asked for at the terminal.

```sh
sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
sauce wallet new agent-sol --solana --password-env SAUCE_WALLET_PASSWORD
sauce wallet list
sauce wallet address agent
```

`new` prints the wallet's name, kind and address, never its key. Fund the address, then sign with
`--wallet <name>` and the same password source wherever a key signs: `run`, `pot --deploy`,
`simulate --fund`, `sauce intent publish` and `sauce intent fill --send` and the steps after it. An
EVM wallet signs on an EVM chain, a Solana one on Solana:

```sh
sauce run payout.sauce.ts --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD \
  --args '[{"to":"<payee>","bps":10000}]'
```

`sauce wallet import <name> <file>` keeps a key the user has (a private key, a keystore or a Solana
keypair file), read from the file or from stdin with `-`, never from the command line. An EVM
wallet's file is a standard keystore, so `--keystore` reads it too. `sauce wallet export <name>`
shows a key only at a terminal, after the user types the wallet's name: never run it for the user.

**A policy limits a wallet.** `<name>.policy.json` beside it, written by the user, sets what it may
send. Every field is optional, and amounts are strings, in whole units or base units ending in `n`:

```json
{
  "chains": ["base"],
  "native": { "perTransaction": "0.01", "perDay": "0.05" },
  "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
}
```

`chains` and `to` (a list of addresses) allow only those. `native` and each token count what
leaves the wallet or the Pot a transaction cooks on, measured by rehearsing it; `perDay` is the
last 24 hours on every chain. A send that breaks a limit is refused, naming it, and nothing is
sent. With no policy, sends work, and each says no limits are set.

**It is a hot wallet.** Whoever has its file and password has the key, and nothing asks before it
sends. Suggest small balances and a policy to the user.

## Steps

[examples/buy.sauce.ts](examples/buy.sauce.ts) carries the steps: it buys a token with the Pot's
USDC on the chain's Uniswap V3 pools, choosing the pool while it runs, under a price limit and a
minimum, and returns the pool, what it spent and what it bought. Here it buys WETH on Base with up
to 100 USDC, at no more than 2,700 USDC per WETH and for at least 0.037 WETH.

1. **Look up the chain's names** before writing: `sauce globals --chain base` lists the token
   symbols with their addresses, the protocol contracts a program can call, and the functions it
   needs no import for. `--protocol UniswapV3` shows one namespace's methods with every parameter
   named; `--json` gives the same for a program to read. Use only names it lists. Before a swap,
   `sauce pools --chain base USDC WETH` lists the pair's pools at every price-limit venue on
   the chain, deepest first: each one's fee, liquidity and `sqrtPriceX96`, what a token costs both
   ways with and without the fee, the distributed swap's `maxPrice` at that price, and how much
   moves the price 1%. A token it is given may be an address; its decimals are read from the
   token. It reads at one block and prints it: rehearse with `sauce simulate --block <number>` on
   the prices you chose from. `sauce price --chain base 2700 USDC per WETH` turns a price into the
   pool's: its
   `sqrtPriceLimitX96` under "Buying WETH", `4116816085950893928074568`, is the buy's limit.
2. **Compile**, to check the program: `sauce compile buy.sauce.ts --chain base`. It prints
   the bytecode; `--json` adds the size, `main`'s parameters and return type, the compiler and the
   engine it pairs with, and what the compile applied: `defines` (each define the file reads, its
   value, whether the user or the chain set it, and the chain it applied on: here `USDC`, Base's),
   `contracts` (each protocol contract it calls, resolved on its chain: here
   `UniswapV3.Factory`), and `payload`, its size with `main`'s arguments given by `--args`. On
   Solana, `cook` says whether the cook fits one transaction. A failing compile points at the
   file's line and column, and its `hint:` lines name the flag or define to add. Every command
   takes the chain as `--chain <slug or id>`. A file may name its own chain instead, in a
   `// @chain base` line among the `//` comment lines it starts with (and `// @target svm` alone
   picks Solana); `--chain` overrides it. Leave the line out of a file meant for more than one
   chain.
3. **Rehearse**, before anything is deployed, funded or signed:

   ```sh
   sauce simulate buy.sauce.ts --chain base --owner <address> --assume-balance USDC:100 \
     --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
     37000000000000000 <recipient>
   ```

   runs the cook from the owner with no key and nothing sent, and needs neither a deployed Pot nor
   a funded one. A Pot not deployed yet is deployed in the same rehearsal first: anyone may send a
   Pot's deployment, and the Pot is the owner's either way. `--assume-balance TOKEN:amount`
   (repeatable; `ETH:<amount>` for the native currency) gives the Pot that balance for the
   rehearsal only; a token that keeps no stored balance (rebasing, shares) is refused. On a local
   chain with Uniswap V3's own pools at 2,650 USDC per WETH, it printed, addresses written as their
   roles:

   ```text
   The cook succeeds from <owner>: gas used 275051 for the cook, after the Pot's deploy (1. below), returns <96 bytes>
   main returns { pool: Address; spent: Uint256; bought: Uint256 }: { pool: <pool>, spent: 100000000, bought: 37716248833222607 }
   Rehearsed with eth_simulateV1 on the state of block <block>; nothing was signed or sent:
     1. Kitchen.deployPot(<owner>, …), gas used 455479: Pot <Pot> is not deployed on base yet. …
     2. the cook, from the owner <owner>, gas used 275051
   Assumed for this rehearsal only, by state override:
     the Pot holds 100 USDC: --assume-balance (…)
   …
   Token transfers:
     0.037716248833222607 WETH: <pool> -> <Pot> (the Pot)
     100 USDC: <Pot> (the Pot) -> <pool>
     0.037716248833222607 WETH: <Pot> (the Pot) -> <recipient>
   …
   Net balance changes:
     <pool>: -0.037716248833222607 WETH, +100 USDC
     <Pot> (the Pot): -100 USDC
     <recipient>: +0.037716248833222607 WETH
   …
   ```

   - **`main returns`** is what `main` returned, read as the type it declares: the pool the
     program chose, the 100 USDC it spent and the 0.0377 WETH it bought. With no declared type,
     the hex after `returns` is all there is.
   - **What the cook did**: the token transfers and approvals in its logs, in whole units; the
     native transfers the node traces (the cook's value, paid to the Kitchen); and each address's
     net change. The rehearsal names its route: `eth_simulateV1`, or `eth_call` where the endpoint
     lacks it, which shows no transfers.
   - **A revert** prints its reason and exits 1. With `minOut` at `40000000000000000`, 0.04 WETH,
     more than 100 USDC buys there:

     ```text
     The cook reverts: the program threw "bought less than minOut"
     ```

     Without `--assume-balance` it is `the budget is not in the Pot`. A pool's short revert string
     says what it checks (`"SPL"`, a price limit on the wrong side of the pool's price or at a
     bound).

   - **`--block <number>`** rehearses on that block instead of the latest (every read is on one
     block, and the output names it): what the cook would have done before the market moved, or on
     the block a sent cook failed in.
   - **`--fund USDC:100`** in place of `--assume-balance` rehearses `sauce run --fund`: with no
     key, the Pot is credited what the pull would bring; with the owner's key (`--wallet`), the
     pull itself is signed and rehearsed, and an approval the first run asks for runs before the
     cook in the same block, listed as a transaction of its own to send first.
   - **`--json`** gives the same for a program to read: `returned` is the record, `transfers` each
     transfer.

   Rehearse what must fail as well as what must succeed, and the edges the program handles. With
   `--assume-balance USDC:100000` and a `budget` of `100000000000`, 100,000 USDC, the pool reaches
   2,700 USDC per WETH first:

   ```text
   main returns { pool: Address; spent: Uint256; bought: Uint256 }: { pool: <pool>, spent: 48361532981, bought: 18070827415775813107 }
   ```

   It spent 48,361.532981 USDC, and the 51,638.467019 left went to the recipient with the WETH.

4. **Pot**: `sauce pot --chain base --owner <address>` (or `--wallet <name>` for the signer's
   own) prints the Pot's address, known before it exists, and its deploy transaction (on a preview
   chain the address alone, with `refused` saying why the deployment is left out). It also
   says whether the chain has the released engine and Kitchen (and the Kitchen's
   fee) and whether the Pot is deployed.
   `sauce pot --deploy --chain base --wallet <name> --password-env <NAME>` deploys the signer's
   Pot. `--salt <label>` names another Pot of the same owner (`--salt-hex <bytes32>` for an exact
   salt); use the same salt in every later command.
5. **Fund** the Pot with what the program spends: send its address the tokens from any wallet, or
   pass `--fund USDC:100` (repeatable; `USDC:100000000n` in base units, `ETH:0.01` as value) to
   `run`, which pulls it from the signer into the Pot in the same cook; `--sweep` returns what is
   left. `--fund-mode` picks how:
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
   (`10000000` is 10 USDC). `simulate --fund` with the owner's key rehearses it: the pulls
   signed, and before the cook, in the same block, each approval or transfer `sauce run` would
   send first, each listed as a transaction of its own with its gas.

6. **Run**, from the Pot's owner:

   ```sh
   sauce run buy.sauce.ts --chain base --wallet <name> --password-env <NAME> \
     --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
     37000000000000000 <recipient>
   ```

   compiles, rehearses, signs, sends and waits (on a supported chain), then prints the hash,
   status and gas used, what the cook cost (gas, any L1 data fee, the value) and the tokens it
   moved:

   ```text
   cook <tx hash>: success, gas used 275051, block <block>
   cost …
   Token transfers:
     0.037716248833222607 WETH: <pool> -> <Pot> (the Pot)
     100 USDC: <Pot> (the Pot) -> <pool>
     0.037716248833222607 WETH: <Pot> (the Pot) -> <recipient>
   Net balance changes:
     <pool>: -0.037716248833222607 WETH, +100 USDC
     <Pot> (the Pot): -100 USDC
     <recipient>: +0.037716248833222607 WETH
   …
   ```

   A Pot not deployed yet is deployed first once the user agrees at the prompt. `--auto-approve`
   approves, in advance, everything a run sends before its cook (deploying the Pot, approving
   Permit2 or the Pot for `--fund`) and names each; with no terminal the run lists what it needs
   approved and sends nothing until it is given. Ask the user before passing `--auto-approve`.

7. **Check** what was sent:
   `sauce inspect <tx hash> --chain base --source buy.sauce.ts` reads the transaction back:
   the Pot, the engine, the arguments the program got, what moved, and the route and reward of
   every intent it opens:

   ```text
   transaction <tx hash> on base: success, block <block>, gas used 275051
     from <owner> to <Pot>, value …
   …
       program: 992 bytes, keccak256 …
         buy.sauce.ts's program, 832 bytes, then 160 of arguments
           token: Address = 0x4200000000000000000000000000000000000006
           budget: Uint256 = 100000000
           sqrtPriceLimitX96: Uint256 = 4116816085950893928074568
           minOut: Uint256 = 37000000000000000
           recipient: Address = <recipient>
     Token transfers:
   …
   ```

   A cook sent with `--fund` runs the program with the pulls around it, and `--source` says it is
   not the file's program. `inspect` also reads calldata, and a file (its intents, with every
   value measured at run time named).

The transaction's value defaults to the Kitchen's execution fee, read from the chain; pass
`--value <wei>` when the program also spends native currency.

**For a wallet instead**:
`sauce tx buy.sauce.ts --chain base --owner <address> --value <wei> --args <arguments>`, with
the same arguments, prints the unsigned transaction as JSON, `{ chainId, to, data, value }`, for
any wallet to sign from the owner. `--format cast` prints it as a `cast send` line instead. Like
`run`, it is refused on a preview chain.

## Arguments to `main`

A program whose `main` declares typed parameters takes them at run time, so one compiled program
serves every call. `sauce compile --json` lists them as `entryParams`. Pass them last, in order;
arrays and records are JSON. [examples/payout.sauce.ts](examples/payout.sauce.ts) takes one, an
array of records, each a payee and its share in basis points, and pays out the USDC the Pot holds
by those weights:

```sh
sauce simulate payout.sauce.ts --chain base --owner <address> --assume-balance USDC:1000 \
  --args '[{"to":"<payee A>","bps":7000},{"to":"<payee B>","bps":3000}]'
```

```text
main returns Uint256[]: [700000000, 300000000]
…
Token transfers:
  700 USDC: <Pot> (the Pot) -> <payee A>
  300 USDC: <Pot> (the Pot) -> <payee B>
…
```

The program measured the Pot's balance and computed each share from it, and `main returns`
reads its array back. Weights that do not add up to 10,000 revert before anything moves:

```text
The cook reverts: the program threw "the weights do not add up to 10000"
```

`--args-json '[…]'` (or a file) gives all of them as one JSON array. Every value is checked
against its declared type before anything is sent: `Address`, `Uint256`, `bool`, `bytes`,
`string`, `T[]` and `{ field: T }`. A parameter with no annotation is a `Uint256`.

## Writing the program file

- It names no chain: `--chain` picks one, and every name in it resolves on that chain. One file
  compiles for every chain whose names it uses.
- It starts with a header comment: what it does in one line; the `sauce` command with
  `--chain <chain>` and `--args` naming every `main` parameter in order; one line per parameter
  with its type, meaning and units (smallest units: `5000000000` is 5,000 USDC; arrays and records
  as JSON); and one concrete run on a supported chain with real values (`sauce-script` has an
  example).
- The chain's names need no import: token symbols (`USDC`, `WETH`), protocol namespaces
  (`Uniswap.UniversalRouter`), `chainId`, and the `@sauce/token` functions
  (`transfer(token, to, amount)`, `approve`, `balanceOf`). `sauce-globals` explains them.
- `USDC.transfer(...)`, `USDC.approve(...)` and `Token(address).transfer(...)` are SafeERC20 writes,
  so USDT works. A token the chain does not register is `Token(address)`.
- Runtime values are `main`'s parameters. A compile-time choice is a module-level `const` that
  `--define NAME=VALUE` replaces (`--defines values.json` gives several). A file of top-level
  statements with no `main`, such as an intent file, leaves the name undeclared and takes it from
  the define. In a `--defines` file, give an address or any value past 2^53 as a JSON string, hex
  or decimal: a JSON number loses precision. An address in a program, as on the command line, is
  its hex: Base's USDC is `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`.
- In a project `sauce init` wrote, put programs in `programs/`: its `tsconfig.json` types them as
  SauceScript, so an editor's TypeScript errors there are real ones (with the project's own
  TypeScript running the editor). For programs anywhere else, `sauce init <dir> --tsconfig`
  writes the same `tsconfig.json` into `<dir>` and nothing else. Without one, an editor shows
  TypeScript errors that the compile does not have; `sauce compile` is what decides.
- `sauce-script` covers the language and what compiling for a chain adds to it.

Both examples follow these: [examples/buy.sauce.ts](examples/buy.sauce.ts) reads the chain to
choose its pool, guards with `require` and a reason, returns a record and leaves none of the budget
behind; [examples/payout.sauce.ts](examples/payout.sauce.ts) computes what it pays from what it
measures.

## A program file as a command

[examples/buy.sauce.ts](examples/buy.sauce.ts) starts with

```sh
#!/usr/bin/env -S sauce simulate
```

so once it is executable (`chmod +x buy.sauce.ts`) it runs as a command, through the installed
`sauce`:

```sh
./buy.sauce.ts --chain base --owner <address> --assume-balance USDC:100 \
  --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
  37000000000000000 <recipient>
```

is `sauce simulate buy.sauce.ts` with those words after it: the rehearsal of step 3. It rehearses
only, so running the file never spends; sending it is `sauce run` on the same file. The compile
ignores the line, and keeps the file's own line numbers in its errors.

## Actions documents

An actions document is JSON: a list of protocol operations in place of a program (`sauce-actions`
covers writing one). `sauce actions swap.json --chain base` lowers it for the chain and prints
the SauceScript it becomes, `main`'s parameters and the bytecode; `--json` gives the same for a
program to read. `compile`, `simulate`, `tx` and `run` take a document wherever they take a
`.sauce.ts` file, with the same flags:

- its `argument` actions are `main`'s parameters, passed with `--args` in the order they are
  declared;
- `--chain` defaults to the document's `chainId`, and a document without one needs it;
- `--define` and `--defines` are refused: a document's values are its own fields.

## Intents and Solana

- **A file that opens intents** (`Ethereum(() => { … }).reward({ … })`) also takes
  `--intent-deadline <unix seconds>`, `--intent-creator <address>` and, when an intent's body runs a
  program, `--intent-execution-fee <wei>` (`auto` reads it from the destination). `compile` and
  `sauce intent publish` warn while the Pot such an intent cooks on
  is not deployed on its destination: no solver can fill it until then, and the warning names the
  `sauce pot --deploy` that deploys it. `sauce run` opens them from the Pot, which is the way when
  an amount is measured on chain; `sauce intent publish` opens fixed ones from a wallet with no Pot, and
  `sauce intent publish <file> --chain <chain> --from <address> --format json` prints its unsigned
  transfers and `publish` for any wallet to send, in that order. Both fund each reward by a transfer
  into the intent's vault, then `publish`: no approval. `--intent-fund-via publishAndFund` switches
  either to an approve and `publishAndFund`. `sauce intent publish … --dry-run --assume-balance
USDC:<amount>` rehearses it from a wallet that does not hold the reward yet.
  `sauce intent fill <file> --chain <chain>` rehearses each intent where its
  body runs: on its destination chain, as the solver who fills it, with no key and nothing sent.
  `publish --dry-run` covers only the source chain. `fill` prints what the body moved, what it left
  in the shared Pot, and why it reverts.
  `sauce-intents` covers writing, publishing, funding (including a transfer into the intent's
  vault), rehearsing them, and every later step (`sauce intent fill --send`, `prove`, `claim`,
  `refund`, `cancel`, `status`, `import`). Publishing, from a wallet or a Pot, needs every chain the
  intent involves supported; the rehearsals run on any chain.
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

The same commands are tools of the Sauce MCP server (`sauce mcp`), by one rule:
each `sauce <command>` is the tool `sauce_<command>` (`sauce intent publish` is
`sauce_intent_publish`), its flags are the tool's inputs in camelCase, the program goes in as
`source`, and an endpoint of the user's own, optional, is the call's `rpcUrl`. Each tool's own
description gives its inputs.

The tools sign nothing, so `sauce run` has none: the user signs what they return. The one exception
is a server started over stdio with `--wallets` and a password source (`--password-env <NAME>`,
given from the client's config): it sends from its own wallets. `sauce_wallet_create` makes one
(`sauce wallet new`), `sauce_wallet_list` names them, and `sauce_wallet_send` rehearses what another
tool returned, holds it to the wallet's policy, signs and sends it: `sauce run` from a wallet.
Over HTTP, nothing signs.

## Rules

- Never write an RPC URL, a key or a wallet's password into a tracked file, a program or a command
  you commit; name the password's source instead.
- Never edit a wallet's policy to get past a refusal: the limit is the user's. Tell the user what
  was refused and which limit.
- Rehearse with `sauce simulate` (or `publish --dry-run`, and `sauce intent fill` for an intent's body)
  before the first real send.
- Send only on a supported chain: Ethereum, Base or Solana. On a preview chain, compile and
  simulate, and offer the user the chain-support request the refusal names; never look for another
  way to send there.
- Do not pass `--auto-approve` or deploy a Pot without the user's go-ahead: deploying costs gas, and with
  `--fund` it also approves Permit2 (or the Pot) to move the user's tokens.
