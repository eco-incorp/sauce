---
name: sauce-cli
description: The sauce command line, and the same steps as tools of the Sauce MCP server. Getting the command; looking up a chain's names and pools; compiling a program file or a JSON actions document; the owner's Pot, deployed when first needed and recorded; funding it (--fund and its modes); simulating the cook with no key and reading what it prints (what main returns, what moved, what is left in the Pot); sauce run to sign and send, sauce tx for any other wallet and sauce send for what it signed; arguments to main; sauce inspect; endpoints and signers; an agent's own wallets, password sources and policies; what a preview chain refuses. Use when asked to compile, simulate, run, execute, test, send or deploy a Sauce program (*.sauce.ts), pass arguments to its main, get its bytecode or unsigned transaction, fund or create a Pot, check what a transaction did, create or use an agent's own wallet and its policy, map a command to its MCP tool, or when a command refuses a chain.
---

# The sauce command

The `sauce` command compiles a program file, deploys its Pot, simulates the cook, signs and sends
it, and reads it back. It needs no other tool and no configuration. This skill owns the command:
getting it, every command and flag that matters, endpoints, signers and wallets, the run in order,
transactions for other signers, arguments to `main`, and each command's MCP tool. What to write is
the other skills'; how a program runs on Solana is `sauce-solana`'s.

## When to use

| Task                                                                | Here                | Elsewhere                               |
| ------------------------------------------------------------------- | ------------------- | --------------------------------------- |
| Compile, simulate, send, read back a program or an actions document | yes                 |                                         |
| Deploy, fund or list a Pot                                          | yes                 |                                         |
| Hand a transaction to another wallet, then broadcast what it signed | yes                 | a Solana plan of steps: `sauce-solana`  |
| Create or use an agent wallet; a policy refusal                     | yes                 |                                         |
| A command refuses a preview chain                                   | yes, which commands | the policy: `sauce-overview`            |
| Publish, fill, prove, claim, refund or cancel an intent             |                     | `sauce-intents` (`sauce intent <verb>`) |
| Writing the program                                                 |                     | `sauce-script`                          |

## Core model

- **One command, no configuration.** It reads no environment variable but the one `--password-env`
  names, and reads a chain through a built-in public endpoint unless given one of its own
  (`--rpc-url`, `--config`); `--offline` reads none.
- **The run, in order**: look up names → compile → simulate → (Pot, deployed when first needed) →
  fund → run, or `sauce tx` for another signer → read it back. Every command takes the chain as
  `--chain <slug or id>`.
- **The signer is the Pot's owner.** `run` cooks on the signer's Pot; `tx` and `simulate` take
  `--owner <address>` instead.
- **Units differ by flag.** `--args` and a program take **base units** (`1000000` is 1 USDC);
  `--fund` and `--assume-balance` take **whole tokens** (`USDC:1` is 1 USDC, `USDC:1000000` a
  million), base units there only with a trailing `n` (`USDC:1000000n` is 1 USDC). A token the
  chain does not register is `<address>:<amount>`, in its own decimals.
- **Transactions are built only on supported chains** (`sauce-overview`; the list of refused
  commands is below).
- `sauce <command> --help` lists every option; on Solana the same commands apply, with the
  differences `sauce-solana` gives.

## Getting the command

Install it once with `npm i -g @eco-incorp/sauce` (Node.js 24 or newer); `sauce --version` checks
it, and `sauce update` upgrades it the way it was installed (`sauce update --check` only reports the
latest; a line on stderr saying a newer `sauce` is available changes nothing the command did, and
`--no-update-check` leaves it out). Without an install, run `npx -y @eco-incorp/sauce <command>` in
its place. Never run a bare `npx sauce` outside a project that depends on the package: npx then
fetches and runs npm's unrelated `sauce` package.

## Commands

| Command          | Does                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `sauce globals`  | The tokens, protocol contracts, chains and functions a program on a chain can use |
| `sauce pools`    | Lists a pair's price-limit pools on a chain, deepest first, with their prices     |
| `sauce price`    | Turns a price, or a pool's now, into `sqrtPriceX96`, the limits and `maxPrice`    |
| `sauce compile`  | Compiles a file for a chain; prints its bytecode, or with `--json` what it takes  |
| `sauce actions`  | Lowers a JSON actions document for a chain; prints its SauceScript and bytecode   |
| `sauce simulate` | Simulates the cook from the Pot's owner, with no key: gas, or why it reverts      |
| `sauce pot`      | Prints the owner's Pot address and deploy transaction; deploys it; lists yours    |
| `sauce run`      | Compiles, simulates, signs, sends and waits for the cook on the signer's Pot      |
| `sauce tx`       | Prints the unsigned cook transaction, for any wallet to sign                      |
| `sauce send`     | Broadcasts transactions signed elsewhere, waits for them, reports what they did   |
| `sauce inspect`  | Reads a transaction, calldata or a file back as what the program does             |
| `sauce verify`   | Checks that a payload, cook or transaction runs the audited settle program        |
| `sauce intent`   | Publishes, fills, proves, claims, refunds and cancels intents (`sauce-intents`)   |
| `sauce wallet`   | Creates, lists and imports the wallets `--wallet` signs with                      |
| `sauce reclaim`  | Lists the code buffers and lookup tables a Solana owner left open; closes them    |

## Endpoints and signers

- **Endpoints**: none needed. A command reads a chain through a built-in public endpoint, and says
  so on stderr; it can be slow or rate-limited. Your own is optional: `--rpc-url <url>`, or
  `--config <file>` holding `{ "rpcUrls": { "<chain id>": "<url>" } }` (a chain the file does not
  name is read through the built-in one). Keep that file out of git.
- **Signers**: `--wallet <name>`, a wallet `sauce wallet` keeps (below), or `--keystore <keystore>`,
  a JSON keystore, each with its password from a source named on the command line or asked at the
  terminal; on Solana a Solana `--wallet <name>` or `--keypair <keypair>`. `--private-key <hex>`
  also works but lands in shell history. On an EVM chain `pot --deploy --owner <address>` deploys
  another owner's Pot, the signer paying; the Pot is that owner's alone.
- **Each flag and value is a word of its own**, in any order: a shell variable holding several flags
  reaches the command as one word unless the shell splits it.
- **A program from stdin**: give `-` as the file
  (`cat buy.sauce.ts | sauce compile - --chain base`); its relative imports resolve against the current directory, or `--source-dir <dir>`.
  Stdin is then spent, so pass a password source for a wallet or keystore, and `--yes` (`-y`) once
  the user agrees to what the run lists.

## Wallets

An agent with no wallet makes one, and it persists. `sauce wallet` keeps each key in the wallet
directory (`.sauce/wallets` in the user's home, or `--wallets <dir>`), encrypted under a password
the agent holds in its `.env` or its secret store. Name the password's source, never the password:

| Source                           | Where the password comes from                                     |
| -------------------------------- | ----------------------------------------------------------------- |
| `--password-env <NAME>`          | the environment variable NAME, and no other                       |
| `--password-file <file>`         | a file only the user can read; one others can read is refused     |
| `--password-command "<command>"` | what a secret manager's command prints; its output is never shown |
| none                             | asked at the terminal                                             |

```sh
sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD
sauce wallet new agent-sol --solana --password-env SAUCE_WALLET_PASSWORD
sauce wallet list
sauce wallet address agent
```

- `new` prints the wallet's name, kind and address, never its key. Fund the address, then sign with
  `--wallet <name>` and the same password source wherever a key signs (`run`, `pot --deploy`,
  `simulate --fund`, `sauce intent publish`, `sauce intent fill --send` and the steps after). An EVM
  wallet signs on an EVM chain, a Solana one on Solana.
- `sauce wallet import <name> <file>` keeps a key the user has (a private key, a keystore or a
  Solana keypair file), read from the file or from stdin with `-`, never from the command line. An
  EVM wallet's file is a standard keystore, so `--keystore` reads it too.
- `sauce wallet export <name>` shows a key only at a terminal, after the user types the wallet's
  name: never run it for the user.
- **It is a hot wallet.** Whoever has its file and password has the key, and nothing asks before it
  sends: suggest small balances and a policy.

```sh
sauce run payout.sauce.ts --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD \
  --args '[{"to":"<payee>","bps":10000}]'
```

**A policy limits a wallet.** `<name>.policy.json` beside it, written by the user, sets what it may
send. Every field is optional; amounts are strings in whole tokens (`"100"` is 100 USDC):

```json
{
  "chains": ["base"],
  "native": { "perTransaction": "0.01", "perDay": "0.05" },
  "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
}
```

`chains` and `to` (a list of addresses) allow only those; deploying the wallet's own Pot counts as a
transaction to that Pot, so a `to` naming the Pot lets a run deploy it first. `native` and each
token count what leaves the wallet or the Pot a transaction cooks on, measured by simulating it;
`perDay` is the last 24 hours on every chain. A send that breaks a limit is refused, naming it, and
nothing is sent. With no policy, sends work, and each says no limits are set.

## The run, step by step

[examples/buy.sauce.ts](examples/buy.sauce.ts) carries the steps: it buys a token with the Pot's
USDC on the chain's Uniswap V3 pools, choosing the pool while it runs, under a price limit and a
minimum, and returns the pool, what it spent and what it bought. Here it buys WETH on Base with up
to 100 USDC, at no more than 2,700 USDC per WETH, for at least 0.037 WETH.

1. **Look up the chain's names.** `sauce globals --chain base` lists the token symbols with their
   addresses, the protocol contracts a program can call, and the functions it needs no import for;
   `--protocol UniswapV3` shows one namespace's methods with every parameter named; `--json` gives
   the same for a program to read. Before a swap, `sauce pools --chain base USDC WETH` lists the
   pair's pools at every price-limit venue, deepest first: each one's fee, liquidity and
   `sqrtPriceX96`, what a token costs both ways with and without the fee, the distributed swap's
   `maxPrice` at that price, and how much moves the price 1%. It reads at one block and prints it:
   simulate with `--block <number>` on the prices you chose from.
   `sauce price --chain base 2700 USDC per WETH` turns a price into the pool's: its
   `sqrtPriceLimitX96` under "Buying WETH", `4116816085950893928074568`, is the buy's limit.
2. **Compile**, to check the program: `sauce compile buy.sauce.ts --chain base` prints the bytecode;
   `--json` adds the size, `main`'s parameters and return type, the compiler and the engine it
   pairs with, `defines` (each name the chain supplied, with its value: here `USDC`, Base's),
   `contracts` (each protocol contract it calls: here `UniswapV3.Factory`) and `payload` (its size
   with `main`'s arguments given by `--args`); on Solana, `cook` says whether the cook fits one
   transaction. A failing compile points at the file's line and column, and its `hint:` lines name
   what to add (`sauce-script`).
3. **Simulate**, before anything is deployed, funded or signed:

   ```sh
   sauce simulate buy.sauce.ts --chain base --owner <address> --assume-balance USDC:100 \
     --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
     37000000000000000 <recipient>
   ```

   It runs the cook from the owner with no key and nothing sent, and needs neither a deployed Pot
   nor a funded one: a Pot not deployed yet is deployed in the same simulation first, as
   `sauce run` deploys it. `--assume-balance TOKEN:amount` (repeatable; `ETH:<amount>` for the
   native currency) gives the Pot that balance for the simulation only; a token that keeps no stored
   balance (rebasing, shares) is refused. On a local chain with Uniswap V3's own pools at 2,650 USDC
   per WETH, it printed, addresses written as their roles:

   ```text
   The cook succeeds from <owner>: gas used 273670 for the cook, after the Pot's deploy (1. below), returns <96 bytes>
   main returns { pool: Address; spent: Uint256; bought: Uint256 }: { pool: <pool>, spent: 100000000, bought: 37716248833222607 }
   Simulated with eth_simulateV1 on the state of block <block>; nothing was signed or sent:
     1. Kitchen.deployPot(<owner>, …), gas used 535944: Pot <Pot> is not deployed on base yet, so the simulation deploys it first, …
     2. the cook, from the owner <owner>, gas used 273670
   Assumed for this simulation only, by state override:
     the Pot holds 100 USDC: --assume-balance (…)
   …
   What moved, in order:
     [1] wallet <owner> -> Pot <Pot>          … ETH                      the cook's value
     [2] Pot            -> Kitchen <Kitchen>  … ETH                      the Kitchen's fee
     [3] <pool>         -> <recipient>        0.037716248833222607 WETH
     [4] Pot            -> <pool>             100 USDC
   …
   Net balance changes:
     <pool>: -0.037716248833222607 WETH, +100 USDC
     <recipient>: +0.037716248833222607 WETH
     <Pot> (the Pot): -100 USDC
   …
   ```

   | Line                   | Means                                                                                                                                                                                      |
   | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `main returns`         | what `main` returned, read as the type it declares (with no declared type, the hex after `returns` is all there is)                                                                        |
   | `Left in the Pot`      | right after the headline: what the Pot holds after the cook of each token the cook moved, with what it held before; none when it leaves nothing; `leftInPot` in `--json`, first after `ok` |
   | `What moved, in order` | every movement of a token or the native coin, in whole units, each party by its role (`wallet`, `Pot`, `Kitchen`, a registry name, a token's symbol, `mint`, `burn`); `moves` in `--json`  |
   | `Net balance changes`  | each address's net change; then the approvals                                                                                                                                              |
   | `The cook reverts: …`  | the reason; the command exits 1                                                                                                                                                            |

   A program that supplies the Pot's USDC to Aave V3 for `ctx.self()` keeps the aTokens there:

   ```text
   The cook succeeds from <owner>: gas used 268566 for the cook, after the Pot's deploy (1. below), returns 0x
   Left in the Pot, not in the owner's wallet:
     0.999999 aBasUSDC
     Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
   ```

   It counts tokens: a position a protocol keeps in its own books, with no token for it, shows in no
   balance, so read it from the protocol. The simulation names its route: `eth_simulateV1`, or
   `eth_call` where the endpoint lacks it, which shows no transfers.

   **Simulate what must fail too.** With `minOut` at `40000000000000000`, 0.04 WETH, more than 100
   USDC buys there:

   ```text
   The cook reverts: the program threw "bought less than minOut"
   ```

   Without `--assume-balance` it is `the budget is not in the Pot`. A pool's short revert string says
   what it checks (`"SPL"`, a price limit on the wrong side of the pool's price or at a bound). With
   `--assume-balance USDC:100000` and a `budget` of `100000000000`, 100,000 USDC, the pool reaches
   2,700 USDC per WETH first:

   ```text
   main returns { pool: Address; spent: Uint256; bought: Uint256 }: { pool: <pool>, spent: 48361532981, bought: 18070827415775813107 }
   ```

   It spent 48,361.532981 USDC, and the 51,638.467019 left went to the recipient with the WETH.

   - **`--block <number>`** simulates on that block instead of the latest: what the cook would have
     done before the market moved, or on the block a sent cook failed in.
   - **`--fund USDC:100`** in place of `--assume-balance` simulates `sauce run --fund`: with no key,
     the Pot is credited what the pull would bring; with the owner's key (`--wallet`), the pull
     itself is signed and simulated, and each approval or transfer `sauce run` would send first runs
     before the cook in the same block, listed as a transaction of its own with its gas.
   - **`--expect-revert "<reason>"`** exits 0 only when the cook reverts with that reason: hold each
     guard to its revert.
   - **`--json`** gives the same for a program to read: `returned` is the record, `transfers` each
     transfer.

4. **The Pot.** `sauce pot --chain base --owner <address>` (or `--wallet <name>` for the signer's)
   prints the Pot's address, known before it exists, its deploy transaction, whether the chain has
   the released engine and Kitchen (and the Kitchen's fee), and whether the Pot is deployed. There is
   no deploy step to take: a command deploys your Pot when it first needs it (asks, or `--yes`), and
   `sauce tx` puts its deployment first.
   `sauce pot --deploy --chain base --wallet <name> --password-env <NAME>` deploys it by hand.
   `--salt <label>` names another Pot of the same owner
   (`--salt-hex <bytes32>` for an exact salt); use the same salt in every later command.

   Every Pot a command deploys (`pot --deploy`, a run that deploys it first, `sauce send` of a
   signed deployment) is recorded on this machine once the chain shows it deployed, in `.sauce/pots`
   in the user's home (`--pots <dir>` for another). `sauce pot list` prints each with its owner,
   salt and kind, the engine and compiler it pairs with, and the transaction that deployed it
   (`--chain`, `--owner` and `--json` narrow and shape it), reading no chain. A Pot deployed
   elsewhere is recorded with `sauce pot import --chain base --pot <pot>`, or by owner and salt
   (`sauce pot import --chain solana --owner <owner> --salt <label>`, the only way on Solana).
   `sauce tx` sends nothing, so it records nothing.

5. **Fund** the Pot with what the program spends: send its address the tokens from any wallet, or
   pass `--fund USDC:100` (repeatable; `ETH:0.01` as value) to `run`, which pulls it from the signer
   into the Pot in the same cook; `--sweep` returns what is left. `--fund-mode` picks how:

   | Mode                    | How                                                                                                                                                                                   |
   | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `permit2` (the default) | signs a one-time Permit2 transfer; the first time per token it asks to approve Permit2, a standing approval to Permit2 (not to the Pot)                                               |
   | `permit`                | signs the token's own EIP-2612 permit for exactly the amount: no approval transaction, nothing left standing; refused for a token without it. Prefer it where it exists, such as USDC |
   | `allowance`             | approves the Pot for the amount (asking first), and the cook pulls it                                                                                                                 |
   | `transfer`              | sends the tokens to the Pot in a transaction of its own before the cook                                                                                                               |

   The command says so when a bare integer for `--fund` reads like base units.

6. **Run**, from the Pot's owner, once the user has seen the program, the arguments and what the
   simulation says will happen, and agreed (`sauce-overview`):

   ```sh
   sauce run buy.sauce.ts --chain base --wallet <name> --password-env <NAME> \
     --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
     37000000000000000 <recipient>
   ```

   It compiles, simulates, signs, sends and waits (on a supported chain), then prints the hash,
   status and gas used, two links for a person to open, what the cook cost (gas, any L1 data fee,
   the value) and what moved, read from the receipt:

   ```text
   cook <tx hash>: success, gas used 273670, block <block>
     explorer: https://basescan.org/tx/<tx hash>
     trace (calls and balance changes, to open in a browser): https://app.blocksec.com/phalcon/explorer/tx/base/<tx hash>
   cost …
   What moved, in order:
     [1] <pool>    -> <recipient>  0.037716248833222607 WETH
     [2] Pot <Pot> -> <pool>       100 USDC
   Net balance changes:
     <pool>: -0.037716248833222607 WETH, +100 USDC
     <recipient>: +0.037716248833222607 WETH
     <Pot> (the Pot): -100 USDC
   …
   ```

   - A cook that leaves anything in the Pot says so after its cost, under
     `Left in the Pot, not in your wallet:`, read at the cook's block; `--json` gives it as
     `leftInPot`, the moves as `moves`, and `explorer` and `trace` beside each hash. A receipt
     records no native transfer inside the cook, so the moves there are tokens only.
   - **Report a sent transaction** with its two links, for the user to open; never fetch them.
   - A missing Pot: `run` asks
     `Your Pot <address> on base isn't deployed yet. Deploy it now (one transaction, about <gas>), then run? [deploy/cancel]`,
     then sends the deployment and the cook.
     `--yes` (`-y`; `--auto-approve` is its older name) approves, in advance, everything a run sends
     before its cook (deploying the Pot, approving Permit2 or the Pot for `--fund`) and names each;
     with no terminal, or with `--json`, the run lists what it needs approved and sends nothing until
     it is given. Ask the user before passing `--yes`.
   - The transaction's value defaults to the Kitchen's execution fee, read from the chain; pass
     `--value <wei>` when the program also spends native currency.

7. **Check** what was sent: `sauce inspect <tx hash> --chain base --source buy.sauce.ts` reads the
   transaction back: the Pot, the engine, the arguments the program got, what moved, and the route
   and reward of every intent it opens:

   ```text
   transaction <tx hash> on base: success, block <block>, gas used 273670
     from <owner> to <Pot>, value …
     explorer: https://basescan.org/tx/<tx hash>
     trace (calls and balance changes, to open in a browser): https://app.blocksec.com/phalcon/explorer/tx/base/<tx hash>
   …
       program: 1067 bytes, keccak256 …
         buy.sauce.ts's program, 907 bytes, then 160 of arguments
           token: Address = 0x4200000000000000000000000000000000000006
           budget: Uint256 = 100000000
           sqrtPriceLimitX96: Uint256 = 4116816085950893928074568
           minOut: Uint256 = 37000000000000000
           recipient: Address = <recipient>
     What moved, in order:
   …
   ```

   A cook sent with `--fund` runs the program with the pulls around it, and `--source` says it is
   not the file's program. `inspect` also reads calldata, and a file (its intents, with every value
   measured at run time named).

## For another signer: `sauce tx` and `sauce send`

- **`sauce tx`** with the same arguments prints the unsigned transaction as JSON,
  `{ chainId, to, data, value }`, for any wallet to sign from the owner:
  `sauce tx buy.sauce.ts --chain base --owner <address> --value <wei> --args <arguments>`. While the
  Pot has no code its deployment comes first (`transactions`), each with `gas`: have each signed with
  that limit (the cook's is estimated as if the deployment had landed; a signer's own estimate, taken
  while the Pot has no code, is far too low). `--format cast` prints a `cast send` line instead. It
  simulates nothing: show the user the program, the arguments and `sauce simulate`'s outcome first.
- **`sauce send <signed>… --chain base`** broadcasts what a hardware wallet, a KMS or another tool
  signed (raw hex for EVM, the base64 wire transaction for Solana), in order, waits for each and
  prints what it did as `run` does. It takes no key. Each is simulated as signed first, and one that
  would fail is not sent (exit 1), nor anything after it; a cook signed short of gas is refused. One
  the chain already has is read back, not sent again; one it had, pending, then lost (dropped or
  reorged out) is reported gone, to sign anew.
- **On Solana**, a transaction lands within about a minute of being built or never, a missing
  signature is refused by name, and a cook needing more than one transaction comes from `sauce tx`
  as a plan with a `cursor` for `sauce send <signed>… --cursor <cursor>` (`sauce-solana`).

## Arguments to `main`

A program whose `main` declares typed parameters takes them at run time, so one compiled program
serves every call; `sauce compile --json` lists them as `entryParams`. Pass them last, in order,
after `--args`; arrays and records are JSON. [examples/payout.sauce.ts](examples/payout.sauce.ts)
takes one, an array of records, each a payee and its share in basis points, and pays out the USDC
the Pot holds by those weights:

```sh
sauce simulate payout.sauce.ts --chain base --owner <address> --assume-balance USDC:1000 \
  --args '[{"to":"<payee A>","bps":7000},{"to":"<payee B>","bps":3000}]'
```

```text
main returns Uint256[]: [700000000, 300000000]
…
What moved, in order:
  [1] wallet <owner> -> Pot <Pot>          … ETH     the cook's value
  [2] Pot            -> Kitchen <Kitchen>  … ETH     the Kitchen's fee
  [3] Pot            -> <payee A>          700 USDC
  [4] Pot            -> <payee B>          300 USDC
…
```

Weights that do not add up to 10,000 revert before anything moves:

```text
The cook reverts: the program threw "the weights do not add up to 10000"
```

- `--args-json '[…]'` (or a file) gives all of them as one JSON array; write an address or a value
  past 2^53 as a JSON string.
- Every value is checked against its declared type before anything is sent: `Address`, `Uint256`,
  `bool`, `bytes`, `string`, `T[]` and `{ field: T }`. A parameter with no annotation is a
  `Uint256`.
- An actions document's `argument` actions are its `main`'s parameters, in the order the document
  declares them (`sauce-actions`): `compile`, `simulate`, `tx` and `run` take a document wherever they
  take a file.
- A file that opens intents also takes `--intent-deadline`, `--intent-creator` and, for a program
  body, `--intent-execution-fee` (`sauce-intents`).

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

That is `sauce simulate buy.sauce.ts` with those words after it: running the file never spends;
sending it is `sauce run` on the same file. The compile ignores the line and keeps the file's own
line numbers in its errors.

## What a preview chain refuses

On a preview chain (`sauce-overview`) `globals`, `compile`, `actions`, `simulate`, `inspect`,
`verify`, `price`, `pools`, `sauce intent publish --dry-run`, `sauce intent fill` without `--send`,
`sauce intent status` and `sauce intent import` work, and `sauce pot` predicts the Pot (and reads
it) but leaves its deployment out. Everything that leaves a transaction ready to sign, unsigned JSON
included, or sends one is refused before anything is read or signed: `tx`, `run`, `pot --deploy`,
`pot --format cast`, `sauce intent publish` and the intent steps sent there
(`sauce intent fill --send`, `prove`, `claim`, `refund`, `cancel`). No flag overrides it. The refusal exits 1 and names
the supported chains and the chain's request:

```
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. …
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=…), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&…).
```

Offer the user that request; the command's own help ends with the same note.

## Over MCP: the tools

The same commands are tools of the Sauce MCP server (`sauce mcp`), by one rule: each
`sauce <command>` is the tool `sauce_<command>` (`sauce intent publish` is `sauce_intent_publish`),
its flags are the tool's inputs in camelCase, the program goes in as `source` (with any ABI file it
imports in `modules`), and an endpoint of the user's own, optional, is the call's `rpcUrl`. Each
tool's own description gives its inputs. `sauce_simulate` returns `leftInPot` first after `ok`, and
a note when the cook leaves anything in the Pot: tell the user.

- **The tools sign nothing**, so `sauce run` has none: the user signs what they return, with any
  signer, and `sauce_send` broadcasts the signed transactions (`sauce send`).
- **The server over stdio serves the `sauce wallet` directory's wallets as tools.**
  `sauce_wallet_list` and `sauce_wallet_address` name them with no password. Creating
  (`sauce_wallet_create`), importing a key file by its path (`sauce_wallet_import`) and sending need
  the wallets enabled: once per server, `sauce_wallet_enable` names where their password comes from,
  never the password: `{ env: NAME }` (a variable the client's configuration passes to the server),
  `{ file: path }` (a file only the user can read), `{ dotenv: path, variable: NAME }` (an entry of
  such a `.env` file) or `{ generate: true }` (a new random password the server writes to a new file
  beside the wallet directory; tell the user where it is). Ask the user which; a server started with
  `--password-env <NAME>` has them enabled already (`sauce_wallet_list` says `enabled`).
  `sauce_wallet_send` simulates what another tool returned, holds it to the wallet's policy, signs
  and sends it: `sauce run` from a wallet. Each transaction it sent comes back with its hash,
  `explorer` and `trace` to give the user, and a cook with `moves`, `leftInPot` and `summary`.
- **It keeps the command's stores**: a Pot a send through it deploys is recorded as `sauce` records
  one (`pots` on each transaction of the result; `sauce_pot_list` and `sauce_pot_import`), and what a
  send does to an intent is recorded too (every intent tool takes `intentHash`; `sauce_intent_list`,
  `sauce_intent_show` and `sauce_intent_import`).
- **Over HTTP**, nothing signs and nothing is kept.

## Pitfalls

- **Units.** `--fund USDC:1000000` is a million USDC; `--args 1000000` is 1 USDC.
- **An RPC URL, a key or a password in a tracked file, a program or a committed command.** Never;
  name the password's source.
- **Editing a wallet's policy to get past a refusal.** The limit is the user's: tell them what was
  refused and which limit.
- **`--yes`, or a Pot deployed, without the user's go-ahead.** Deploying costs gas, and with `--fund`
  it also approves Permit2 (or the Pot) to move the user's tokens.
- **Sending before simulating, or before the user has seen the program, its arguments and the
  simulation.** Simulate with `sauce simulate` (or `sauce intent publish --dry-run`, and
  `sauce intent fill` for an intent's body) first.
- **A `sauce tx` cook signed with the wallet's own gas estimate while the Pot has no code.** Use the
  `gas` the plan gives.
- **Fetching the explorer or trace link.** Give both to the user.
- **Looking for another way to send on a preview chain.** Offer the chain-support request.

## Files

- [examples/buy.sauce.ts](examples/buy.sauce.ts): the walkthrough's buy, which chooses its pool
  while it runs, guards with `require` and a reason, returns a record and leaves none of the budget
  behind; its `#!` line makes the file a command.
- [examples/payout.sauce.ts](examples/payout.sauce.ts): a JSON array of records as `main`'s argument,
  the Pot's measured USDC paid out by weight.
