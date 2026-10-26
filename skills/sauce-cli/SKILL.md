---
name: sauce-cli
description: The sauce command line, and the same steps as tools of the Sauce MCP server. Getting the command; looking up a chain's names and pools; compiling a program file or a JSON actions document; the owner's Pot, deployed when first needed and recorded; funding it (--fund and its modes); simulating the cook with no key and reading what it prints; sauce run to sign and send, sauce tx for the user's wallet MCP server (Coinbase, Phantom) or any signer, sauce send for what it signed, sauce sign for a cook another account sends; arguments to main; sauce inspect; endpoints and signers; an agent's own wallets, password sources and policies; what a preview chain refuses. Use when asked to compile, simulate, run, test, send or deploy a Sauce program (*.sauce.ts), pass arguments to its main, get its bytecode or unsigned transaction, fund or create a Pot, check what a transaction did, sign with a wallet's MCP server or an agent's own wallet and its policy, map a command to its MCP tool, or when a command refuses a chain.
---

# The sauce command

The `sauce` command compiles a program file, deploys its Pot, simulates the cook, signs and sends
it, and reads it back. It needs no other tool and no configuration. This skill owns the command:
getting it, every command and flag that matters, endpoints, signers and wallets, the run in order,
transactions for other signers, arguments to `main`, and each command's MCP tool. What to write is
the other skills'; how a program runs on Solana is `sauce-solana`'s.

## When to use

| Task                                                                | Here                | Elsewhere                              |
| ------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| Compile, simulate, send, read back a program or an actions document | yes                 |                                        |
| Deploy, fund or list a Pot                                          | yes                 |                                        |
| Hand a transaction to another wallet, then broadcast what it signed | yes                 | a Solana plan of steps: `sauce-solana` |
| Sign a cook for another account to send; cancel one                 | yes                 |                                        |
| Sign through a wallet's MCP server (Coinbase, Phantom)              | yes                 |                                        |
| Create or use an agent wallet; a policy refusal                     | yes                 |                                        |
| A command stops with a message                                      | yes                 |                                        |
| A command refuses a preview chain                                   | yes, which commands | the policy: `sauce-overview`           |
| Writing the program                                                 |                     | `sauce-script`                         |

## Core model

- **One command, no configuration.** It reads no environment variable but the one `--password-env`
  names (in `sauce mcp` over stdio, also the one `sauce_wallet_enable`'s `env` names), and reads a
  chain through a built-in public endpoint unless given one of its own (`--rpc-url`, `--config`);
  `--offline` reads none.
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
| `sauce price`    | Turns a price, or a pool's now, into `sqrtPriceX96`, the limits and `priceLimit`  |
| `sauce compile`  | Compiles a file for a chain; prints its bytecode, or with `--json` what it takes  |
| `sauce actions`  | Lowers a JSON actions document for a chain; prints its SauceScript and bytecode   |
| `sauce simulate` | Simulates the cook from the Pot's owner, with no key: gas, or why it reverts      |
| `sauce pot`      | Prints the owner's Pot address and deploy transaction; deploys it; lists yours    |
| `sauce run`      | Compiles, simulates, signs, sends and waits for the cook on the signer's Pot      |
| `sauce tx`       | Prints the unsigned cook transaction, for any wallet to sign                      |
| `sauce send`     | Broadcasts transactions signed elsewhere, waits for them, reports what they did   |
| `sauce sign`     | Signs a cook for another account to send and pay the gas for; cancels one         |
| `sauce inspect`  | Reads a transaction, calldata or a file back as what the program does             |
| `sauce verify`   | Checks that a payload, cook or transaction runs the audited settle program        |
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

## Signing through a wallet's MCP server

The safer signer is a wallet whose key stays with its provider, reached through that wallet's own
MCP server: the key never reaches the agent or this machine, and the wallet applies its own
approvals and limits. On Base and Ethereum that is Coinbase Wallet MCP, the user's own wallet, whose
one batch deploys the Pot and cooks; on Solana, Phantom MCP, which signs on Base and Ethereum too.
Build for the wallet's address (`--owner`), simulate, show the user, then hand the result over.
Every command and tool that prints unsigned transactions writes what these servers take, beside
its own fields, so nothing is converted:

- **Each EVM transaction**, as it is: `{ chainId, to, data, value, gas }`, `value` and `gas` hex
  quantities (`gas` only where the plan gives one), beside labels such as `what` that a wallet's
  tool drops: the input of its send-transaction tool.
- **`sendCalls`** on the result: `{ chain, calls: [{ to, value, data }] }`, every transaction in
  order, `value` hex, `chain` the wallet's name for it (`base`, `ethereum`).
- **`transaction`** on each Solana transaction, as it always is: base64, the fee payer first and its
  signature the only one missing; any other signer (a fresh key the transaction creates an account
  with) signed already.

| Wallet server       | Chains                 | Add it to the agent's MCP servers                                                 |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| Coinbase Wallet MCP | Base, Ethereum         | an HTTP server at `https://wallet-mcp.coinbase.com`; signs in through the browser |
| Phantom MCP         | Solana, Base, Ethereum | a stdio server, `npx -y @phantom/mcp-server@latest`; signs in through the browser |

- **Coinbase Wallet MCP**: `send_calls` with the result's `sendCalls` as its whole input. Every
  transaction runs as one atomic batch after one approval: the user approves in their wallet
  through the link it returns (open it for them where a shell can), and `get_request_status` with
  its request id says when it landed. The signer is a smart wallet: its address (`get_wallets`) is
  the Pot's owner, so one batch deploys the Pot and cooks on it, and a cook that reverts leaves no
  Pot behind. With `--fund USDC:100` (the tool's `fund`), the plan also moves the owner's tokens
  into the Pot between the two (`ETH:<amount>` rides as the cook's value): deploying, funding and
  cooking are one approval, all of it or none. Tokens sent to the Pot's address before it exists
  are there when it is deployed too.
- **Phantom MCP**: the agent gets a wallet of its own, held by Phantom; fund its address
  (`wallet_addresses`) first. On an EVM chain, `evm_send` with each transaction as its input, in
  order, each landed before the next (`sauce inspect <hash>`). On Solana,
  `solana_send` with `{ transaction }`. Without `confirmed` it returns a preview to show the user;
  `confirmed: true` signs and sends, returning the hash or signature.
- **A Solana plan** (a `cursor` beside the transactions): send each transaction, then
  `sauce send --cursor <cursor> --signature <signature>…` (the tool `sauce_send`, `signatures`)
  confirms them and prints the next step, until it is done. A Solana transaction lands within about
  a minute of being built or never: when the user takes longer, build it again
  (`sauce send --cursor <cursor>` alone, or the command that printed it) and hand over the new one.
  Always pass back the signatures of what landed: the plan builds again only what did not.
- **Any other signer** (a KMS, a hardware wallet, another wallet's tool) signs the same fields; what
  it signed but does not send, `sauce send` broadcasts (below).

## Wallets

For experiments and development, the command keeps wallets of its own: a key on this machine,
encrypted, that the agent unlocks and sends with, nobody approving each send. That is quick to set
up and right for test runs and small balances; a wallet's MCP server (above) is the safer signer
for real funds. `sauce wallet` keeps each key in the wallet directory (`.sauce/wallets` in the
user's home, or `--wallets <dir>`), encrypted under a password the agent holds in its `.env` or its
secret store. Name the password's source, never the password:

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
  `--wallet <name>` and the same password source wherever a key signs (`run`, `pot --deploy` and
  `simulate --fund`). An EVM wallet signs on an EVM chain, a Solana one on Solana.
- `sauce wallet import <name> <file>` keeps a key the user has (a private key, a keystore or a
  Solana keypair file), read from the file or from stdin with `-`, never from the command line. An
  EVM wallet's file is a standard keystore, so `--keystore` reads it too, without its policy.
- `sauce wallet export <name>` shows a key only at a terminal, after the user types the wallet's
  name: never run it for the user. It keeps the key out of pipes and logs, not from a program that
  drives a pseudo-terminal, and the file and its password are the key anyway.
- **It is a hot wallet.** Whoever has its file and password has the key, and nothing asks before it
  sends: suggest small balances and a policy, and a wallet's MCP server for anything more.

```sh
sauce run payout.sauce.ts --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD \
  --args '[{"to":"<payee>","bps":10000}]'
```

**A policy limits a wallet** when it signs through `--wallet` or the MCP server's wallet tools.
`<name>.policy.json` beside it, written by the user, sets what it may send. The same file signed
with `--keystore` applies no policy, nor does `--private-key`. Every field is optional; amounts are
strings in whole tokens (`"100"` is 100 USDC):

```json
{
  "chains": ["base"],
  "native": { "perTransaction": "0.01", "perDay": "0.05" },
  "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } }
}
```

`chains` and `to` (a list of addresses) allow only those. `to` limits the transaction's own target:
on an EVM chain the contract the wallet calls, usually its Pot, and on Solana the programs its
instructions call. It does not limit whom a program pays: a cook on an allowed Pot can pay any
address, so a payee is held by the program itself (a recipient it fixes, a `require` on it).
Deploying the wallet's own Pot counts as a transaction to that Pot, so a `to` naming the Pot lets a
run deploy it first. `native` and each token count what leaves the wallet or the Pot a transaction
cooks on, measured by simulating it on the chain's head with the gas and fees the wallet then signs
it with, exactly; `perDay` is the last 24 hours on every chain. On Arc, whose
native coin is also the `USDC` token (one balance), what leaves as either counts against `native`
and the `USDC` limit both, native USDC sent and a USDC allowance left count together, and a USDC
allowance counts against `native` too. A send that breaks a limit is refused, naming it, and
nothing is signed or sent. An allowance a transaction leaves another key counts as sent, per
transaction and per day, with what the transaction moves of the token: an ERC-20's or one granted
through Permit2, as the chain holds it after the transaction (each read in a simulation of its own
on the same block, which counts only where the transaction runs there as it did, with the same
logs, return data and gas; one that cannot be read so is refused where its token is limited), and
on Solana a delegate set
or raised (SPL Token `Approve` or `ApproveChecked`) on a token account of the wallet or the Pot.
Each allowance is its own permission (on the token or through Permit2, the wallet's or its Pot's),
and they add up. A spender that is the wallet or its Pot is none, and an approval of a token whose
decimals cannot be read is refused where it is limited. An approval of Permit2 for a limited token
is refused: it makes spendable again every Permit2 allowance of it the wallet gave before, which
nothing measures, so under such a limit fund with `--fund-mode permit`, `allowance` or `transfer`.
The rule: an allowance of a limited token to anyone but the wallet or its Pot counts only where it
is measured exactly, and is refused where it is not. What the wallet spends as a delegate from an
account it does not own counts as sent. A cook's calldata sent to anything but the wallet's own Pot
is a payment like any other, and a cook on a Pot whose owner cannot be read is refused where a
native or token limit applies. `--fund` signs and sends only for the wallet's own Pot, after the
policy's `chains` and `to`. On Solana a token account handed to another owner is a send of all it
holds, and one whose close authority goes to another key, or a Token-2022 mint whose permanent
delegate the wallet hands to another key, is refused where that token is limited. On Solana
`native` counts every account the wallet controls (its token accounts, wrapped SOL among them,
synced or not, nonce accounts it is the authority of and stake accounts it is the withdrawer of),
net, so wrapping SOL into its own account, or paying the rent of its own token account, counts only
the fee. A transaction is held to the policy of every wallet unlocked to sign it, whichever pays
the fee. The measure errs toward counting, so a refusal may name more than actually leaves. A
Token-2022 mint's permanent delegate the wallet never held needs no approval, and no policy limits
it. A simulation shows what a transaction does on the state it ran on; what it does in the block it
lands in, which may differ (a program that reads the time or the base fee), no simulation bounds,
so a hard bound is the program's own `require` on what it sends.
With no policy, sends work, and each says no limits are set.

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
   `priceLimit` at that price, and how much moves the price 1%. It reads at one block and prints it:
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
   balance (rebasing, shares) is refused. On Arc, `USDC:<amount>` sets the Pot's native balance (the
   token is the native coin, which no token storage holds), and `ETH:<amount>` or
   `native:<amount>` is native USDC there, not ether. On a local chain with Uniswap V3's own pools
   at 2,650 USDC per WETH, it printed, addresses written as their roles:

   ```text
   The cook succeeds from <owner>: gas used 273670 for the cook, after the Pot's deploy (1. below), returns <96 bytes>
   main returns { pool: Address, spent: Uint256, bought: Uint256 }: { pool: <pool>, spent: 100000000, bought: 37716248833222607 }
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
   main returns { pool: Address, spent: Uint256, bought: Uint256 }: { pool: <pool>, spent: 48361532981, bought: 18070827415775813107 }
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
   Deploying the Pot is a transaction of its own, which costs gas once, on top of the cook's. How
   much varies with the chain and its gas price, and the command estimates it: `run`'s question
   says about how much gas and what it costs, the simulation's first step gives the deployment's
   gas used, and `sauce tx` gives the deployment its `gas`.

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
   into the Pot in the same cook; `--sweep` sends the Pot's whole balance of each funded token back
   to the signer (and of the native coin, when native is funded), not only what this run brought,
   so a balance the Pot already held of a funded token goes too. `--fund-mode` picks how:

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
   transaction back: the Pot, the engine, the arguments the program got and what moved:

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
   not the file's program. `inspect` also reads calldata, and compiles a file and reports it.

## For another signer: `sauce tx` and `sauce send`

- **`sauce tx`** with the same arguments prints the unsigned transaction as JSON,
  `{ chainId, to, data, value }` (`value` in wei, a hex quantity) with `sendCalls` beside it, as a
  wallet's MCP server takes them (above), for any wallet to sign from the owner:
  `sauce tx buy.sauce.ts --chain base --owner <address> --value <wei> --args <arguments>`. While the
  Pot has no code its deployment comes first (`transactions`), each with `gas`: have each signed with
  that limit (the cook's is estimated as if the deployment had landed; a signer's own estimate, taken
  while the Pot has no code, is far too low), or send `sendCalls` as one batch.
  `--fund <TOKEN>:<amount>` adds the owner's transfer of each token into the Pot after the
  deployment and before the cook (whole tokens, or base units ending in `n`; `ETH:<amount>` rides
  as the cook's value), simulated with them for its gas where an endpoint is given; a balance short
  of a transfer is said, as the batch would revert. `--format cast` prints a `cast send` line
  instead. It simulates only for gas: show the user the program, the arguments and
  `sauce simulate`'s outcome first.
- **`sauce send <signed>… --chain base`** broadcasts what a hardware wallet, a KMS or another tool
  signed (raw hex for EVM, the base64 wire transaction for Solana), in order, waits for each and
  prints what it did as `run` does. It takes no key. Each is simulated as signed first, and one that
  would fail is not sent (exit 1), nor anything after it; a cook signed short of gas is refused. One
  the chain already has is read back, not sent again; one it had, pending, then lost (dropped or
  reorged out) is reported gone, to sign anew.
- **On Solana**, a transaction lands within about a minute of being built or never, a missing
  signature is refused by name, and a cook needing more than one transaction comes from `sauce tx`
  as a plan with a `cursor` for `sauce send <signed>… --cursor <cursor>` (`sauce-solana`).

## A cook another account sends: `sauce sign`

On an EVM chain the Pot's owner can sign a cook without sending it; any account then sends it, pays
the gas, and the Pot runs exactly what was signed. The owner signs EIP-712 typed data (domain
`Sauce Pot`, the chain and the Pot) over the engine, the program with `main`'s arguments, the value
the sender must send, the most of the Kitchen's fee the Pot pays, a nonce, a deadline and the one
account allowed to send it (anyone, unless named):

```sh
sauce sign buy.sauce.ts --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD --args <arguments>
```

- **What it signs.** The signer's own Pot, or `--pot <address>`, or `--owner <address>` with
  `--salt <label>` or `--salt-hex <bytes32>`; the signer must be its owner. `--value <wei>` is what
  the sender sends (0 unless given). `--max-fee <wei>` is the fee ceiling, else the Kitchen's fee
  now. `--nonce <n>` is the nonce, else a random one. `--within <seconds>` (an hour unless given)
  or `--deadline <unix seconds>` is the last second it runs, inclusive; not both.
  `--submitter <address>` lets only that account send it.
- **What it prints** on stdout, with `--json` or without: `{ chainId, pot, owner, engine,
program, value, maxExecutionFee, nonce, deadline, submitter, typedData, digest, signature, cook }`,
  and its notes, the fee warning among them, on stderr either way. Each
  number a decimal string, `typedData` as `eth_signTypedData_v4` takes it. `cook` is
  `{ chainId, to, data, value }` with `value` a hex quantity, as `sauce tx` writes a transaction:
  hand it to the sender. While the Pot has no code, `deployPot` comes too, for any account to send
  first.
- **Sending it.** Any wallet sends `cook` from the account it names (or any account), with exactly
  its `value`: the Pot refuses another amount. The sender pays only gas; the Pot pays the Kitchen's
  fee out of its balance, which includes the value, up to the ceiling. The notes say the fee now,
  the ceiling and what the Pot holds, and warn when that is short. A transaction a signer signed
  goes to `sauce send`. A cook that reverts spends nothing, and can be sent again until the
  deadline.
- **Another signer.** With `--owner <address>` and no key it prints `typedData` unsigned. Have the
  owner's wallet sign it, then run the same line again with `--max-fee`, `--nonce` and `--deadline`
  as printed and `--signature <hex>`: the signature is checked against the owner (a contract owner
  through its `isValidSignature`) and `cook` is built. One that does not check is refused.
- **Cancelling.** `sauce sign --cancel <nonce> --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD`
  sends the owner's `invalidateNonces` for each word of nonces (`--cancel` repeats); with
  `--owner <address>` instead it prints them unsigned, for `sauce send`.
- **Which Pots.** A Private Pot the Kitchen created since signed cooks arrived, fixed Router or not.
  A Pot created before them has no `cookSigned`, and a Shared Pot refuses every one: the command
  refuses both, with the reason. Solana is refused: there the owner signs the cook transaction
  itself.
- **A wallet's policy.** A `--wallet` whose policy sets `native` or any `tokens` limit refuses to
  sign, naming the limit: a signed cook runs when someone else sends it, on what the chain holds
  then, so nothing simulated at signing measures what it moves. `chains` and `to` (the Pot) still
  apply. Tell the user which limit; never edit the policy.
- **Anyone holding the output can send it**, once, until the deadline: keep the deadline short,
  name the submitter when only one account should send it, and cancel what is no longer wanted.

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
  `Int256` (from -2^255 through 2^255 - 1; a negative value is a word of its own, `--args -5`),
  `bool`, `bytes`, `string`, `T[]` and `{ field: T }`. A parameter with no annotation is a
  `Uint256`.
- An actions document's `argument` actions are its `main`'s parameters, in the order the document
  declares them (`sauce-actions`): `compile`, `simulate`, `tx` and `run` take a document wherever they
  take a file.

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

On a preview chain (`sauce-overview`) `globals`, `compile`, `actions`, `inspect`, `verify`, `price`
and `pools` work, and `sauce pot` predicts the Pot (and reads it) but leaves its deployment out.
`sauce simulate` does not depend on the label: it runs wherever the release is deployed on the
chain, and where it is not it stops with exit 1 (`the released engine … is not deployed on
<chain>`). Everything that leaves a transaction ready to sign, unsigned JSON included, or
sends one is refused before anything is read or signed: `tx`, `run`, `sign`, `pot --deploy` and
`pot --format cast`. No flag overrides it. The refusal exits 1 and names the supported chains and
the chain's request:

```
sauce tx: building the cook transaction is refused: it involves optimism (Optimism, chain id 10), a preview chain. …
To ask for Optimism: add your use case to its request if there is one (https://github.com/eco-incorp/sauce/issues?q=…), or open one (https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&…).
```

Offer the user that request; the command's own help ends with the same note.

## When a command stops

A command that stops prints one message on stderr, after its own name and a colon. It exits 2 when
the invocation is wrong (a flag missing or mistyped) and 1 for any other refusal or failure. A
message saying `nothing was sent` means the transaction it names was not broadcast. A run that
sends several transactions, such as a Solana cook with its setup, may already have landed the
earlier ones: read the hashes the command printed before the message, and check the Pot and the
token accounts, before running it again. Each message below is quoted by its first words, which
name the cause, with `…` for the rest: the values and, often, the flag that fixes it. A question
put at a terminal (a password, a yes or no) is not here: pass the flags that answer it.

- **No endpoint** (exit 2). `missing --rpc-url <url> (or --config <file>)…`: the command reads the
  chain and has no endpoint for it; a few chains have no built-in public one. Pass
  `--rpc-url <url>`, or `--config <file>` naming the chain's id (one of the two, not both).
  `--offline reads no chain…`: the command reads the chain, which `--offline` forbids; drop it.
  `missing --value <wei>…`: with no endpoint the Kitchen's fee could not be read; pass
  `--value <wei>`, or an endpoint.
- **The endpoint is another chain's** (exit 1). `the RPC endpoint serves chain …`: use the chain's
  own endpoint, or a `--config` file with each chain's under its id.
- **The package is not the deployed Kitchen's** (exit 1, EVM). `the Kitchen … puts the Pot of
owner … and salt … at …, but this SDK has it at …`: the chain's Kitchen puts the Pot at another
  address than this copy of the package does, so a cook it built would reach no Pot.
  `… has code, but not the code of a Pot this SDK's release deploys…`: the Pot's address holds
  something other than the package's Pot. Nothing was simulated, built or sent: the user upgrades
  the package (`sauce update`), then runs the command again. Offline nothing is checked, and the
  notes say `The Pot's address is NOT checked against the deployed Kitchen`.
- **No signer** (exit 2). `missing a signer…`: the command sends and was given no key. Pass
  `--wallet <name>` (a Solana wallet on Solana), `--keystore <path>` or, on Solana,
  `--keypair <path>`, with a password source; or build the transaction with `sauce tx` for another
  signer.
- **The wrong kind of wallet** (exit 2). `wallet <name> is a Solana wallet…`: an EVM transaction is
  signed by an EVM wallet. `wallet <name> is an EVM wallet…`: on Solana, sign with a Solana wallet
  (`sauce wallet new <name> --solana`) or `--keypair <path>`. `--keypair is a Solana keypair…`: an
  EVM transaction takes `--wallet`, `--keystore` or `--private-key`.
- **An approval is needed** (exit 1). `nothing was sent: this run needs an approval…` (or
  approvals): before its cook the run must send something, such as the Pot's deployment or an
  approval for `--fund`, and it cannot ask: there is no terminal, or `--json` asks nothing. The
  message lists each one. Show the user the list; once they agree, run it again with `--yes`
  (`-y`) and a password source that needs no prompt.
- **A policy refusal** (exit 1). `refused by the policy of wallet <name> (<policy file>)…`, then the
  limit: `chains allows …`; `to allows <n> address(es), and this transaction …` (a target outside
  `to`, or the wallet's own Pot, deployed first, missing from it: add the Pot to `to`);
  `<limit>.perTransaction is …`; `<limit>.perDay is …`;
  `this transaction approves …` (an approval above what a token's limit leaves); or
  `native is limited, and …` (`tokens.<symbol> is limited, and …`), when what the transaction
  moves could not be measured: on an EVM chain, give an endpoint that runs `eth_simulateV1`. Tell
  the user which limit; the policy is theirs to change. `<policy file> can be written by others…`:
  the user runs `chmod 600` on it.
- **The cook reverts** (exit 1). `sauce simulate` prints `The cook reverts: …` first (with
  `--json`, `reverted: true` and `error` lead the JSON), and a send simulated first and refused
  prints `not sent — it would revert: …`. The reason, by its first words:
  - `the program threw "…`: the program's own `require` or `throw`; its text says which.
  - `The cook reverts: ERC20InsufficientBalance(…`, or Uniswap's
    `"STF" (a token's transferFrom failed…` and `"ST" (a token's transfer failed…`: the payer
    holds, or has approved, less of the token than the transfer moves, most often a Pot short of
    what the program spends. Send the Pot the token, add `--fund USDC:<amount>` to `run`, or give
    a simulation `--assume-balance USDC:<amount>`; amounts in `--args` are base units.
  - `"SPL" (a V3-style pool's price-limit check…`: the swap's price limit is on the wrong side of
    the pool's price, or past a bound. Work it out again with `sauce price` or `sauce pools`, and
    simulate on the block they read (`--block`).
  - `"Too little received" (…`: the swap's output is below its minimum, which is above what the
    pool pays at that price.
  - `revert data …`, then the raw data: an error the command has no name for, the called
    contract's own; read it against that contract's ABI.

  `sauce simulate --expect-revert "<text>"` exits 0 only when the cook reverts with that text. From
  a wallet with a policy, `transaction <n> of <m> would revert in the simulation…` stops a plan at
  the transaction that would revert; `sauce simulate` shows why.

- **Solana's size, compute and rent** (exit 1).
  - `the cook names <n> accounts, more than one lookup table holds…`, or
    `the staged cook is a <n>-byte transaction even with every account it names in a lookup table…`:
    staged in a code buffer and through a lookup table, the cook still does not fit one transaction
    (1232 bytes, and a lookup table holds 256 accounts). Make it smaller: fewer pools or accounts,
    or two programs. `sauce compile --json` reports the cook's size against the limit before a run.
  - `the staged cook is a <n>-byte transaction even through the lookup tables given…`: the lookup
    table given with `--lookup-table` does not hold every account the cook names. Pass one that
    does, or leave the flag out and the run creates one.
  - `The cook runs out of compute units…`: with every pool's stop worked out again, the swaps still
    need more than a transaction's compute budget. Offer fewer pools, or a tighter `priceLimit`,
    and simulate again.
  - `<owner> holds <n> lamports, and the cook takes …`, or a failure that names an account the
    transaction would leave below its rent-exempt minimum: the owner pays, in SOL, the rent of the
    Pot, the token accounts and the code buffer a run creates, the Kitchen's fee and the
    transaction's, and holds too little. Send it more SOL. `sauce reclaim` closes the code buffers
    and lookup tables an earlier run left open and returns their rent.
  - `the engine refused: ExecutionFeeExceedsMaximum…`: the Kitchen's fee rose after the cook read
    it; run it again.
  - `<transaction> would fail, so nothing was sent…`: the cluster's simulation of the transaction
    failed; the reason follows, then the program's logs.

## Over MCP: the tools

The same commands are tools of the Sauce MCP server (`sauce mcp`), by one rule: each
`sauce <command>` is the tool `sauce_<command>` (`sauce pot list` is `sauce_pot_list`), its flags
are the tool's inputs in camelCase, the program goes in as `source` (with any ABI file it
imports in `modules`), and an endpoint of the user's own, optional, is the call's `rpcUrl`. Each
tool's own description gives its inputs. `sauce_simulate` returns `leftInPot` first after `ok`, and
a note when the cook leaves anything in the Pot: tell the user.

- **The tools sign nothing**, so `sauce run` has none: the user signs what they return, through a
  wallet's MCP server (`sendCalls`, each transaction, or a Solana `transaction`, above) or with any other
  signer, and `sauce_send` broadcasts what a signer signed but did not send (`sauce send`).
  `sauce_signed_cook` is `sauce sign` with no signer: the typed data to sign, and with `signature`
  the `cook` to send, or with `cancel` the cancellations unsigned.
- **The server over stdio serves the `sauce wallet` directory's wallets as tools**, for experiments
  and development.
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
  `sauce_sign` signs a cook with a wallet, as `sauce sign --wallet` does, under the same policy
  rule; `sauce_wallet_send` sends its `cook`, or `sauce_signed_cook`'s, from any wallet.
  Whether an agent can sign is settled when the server starts: `sauce mcp --no-wallets` serves no
  wallet tool, and `--no-stores` keeps none of the command's stores, the wallet directory included,
  so with either nothing signs. Without them the agent can enable the wallets itself with
  `sauce_wallet_enable`: start the server with one of the two when an agent must not sign.
- **It keeps the command's stores**: a Pot a send through it deploys is recorded as `sauce` records
  one (`pots` on each transaction of the result; `sauce_pot_list` and `sauce_pot_import`).
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
  simulation.** Simulate with `sauce simulate` first.
- **A `sauce tx` cook signed with the wallet's own gas estimate while the Pot has no code.** Use the
  `gas` the plan gives, or send `sendCalls` as one batch.
- **Converting a result by hand for a wallet's tool.** Pass `sendCalls`, or each transaction, whole:
  `value` and `gas` are hex already, and a decimal value is refused or misread.
- **A Solana transaction handed to a wallet the user approves slowly.** Past about a minute it can
  no longer land: build it again and hand over the new one.
- **Fetching the explorer or trace link.** Give both to the user.
- **Looking for another way to send on a preview chain.** Offer the chain-support request.
- **A signed cook handed around, or signed for days.** Anyone holding `sauce sign`'s output can send
  it until its deadline: give it only to the sender, keep the deadline short, and cancel what is no
  longer wanted.
- **Compiled output or a `sauce tx` result kept across `sauce update`.** Compiler output pairs with
  the engines by exact version: after an update, compile again and rebuild every unsigned
  transaction printed before it. `sauce compile --json` and `sauce pot list` name the compiler and
  engine a result pairs with.

## Files

- [examples/buy.sauce.ts](examples/buy.sauce.ts): the walkthrough's buy, which chooses its pool
  while it runs, guards with `require` and a reason, returns a record and leaves none of the budget
  behind; its `#!` line makes the file a command.
- [examples/payout.sauce.ts](examples/payout.sauce.ts): a JSON array of records as `main`'s argument,
  the Pot's measured USDC paid out by weight.
