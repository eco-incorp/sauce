# The MCP server's tools

**Reference** · [Documentation](../README.md) · [The MCP server](mcp.md) · [What a local server keeps](mcp-local.md)

> Each tool is a button your coding agent can press. Most are the `sauce` command's own commands
> under another name: `sauce_compile` is `sauce compile`, `sauce_simulate` is `sauce simulate`.
> The agent hands each tool the same things you would type, and gets back the same answer, as data.

This page lists every tool of the [MCP server](mcp.md), what it takes and what it returns. It is
for you when you read what your agent did, or when you call the tools from your own MCP client. To
set the server up, see [The MCP server](mcp.md); for a first session, see
[Your first agent session](agent-quick-start.md).

## A session

An agent writing and running a program on Base goes like this:

```text
sauce_skills    → which skill teaches what
sauce_globals   { chain: "base" }                           → the tokens and protocols it can name
sauce_compile   { source, chain: "base" }                   → the bytecode, or the compile error
sauce_simulate  { source, chain: "base", owner, args, assumeBalance: ["USDC:5"] }  → what would move
sauce_tx        { source, chain: "base", owner, args }      → the transaction, unsigned
                  … the user's signer signs it …
sauce_send      { transactions: ["0x02f8…"] }               → sent, and what it did
```

`assumeBalance` gives the Pot balances for the simulation only, as `--assume-balance` does for
`sauce simulate`. On a local server with wallets, `sauce_wallet_send` takes `sauce_tx`'s result and
signs and sends it instead ([What a local server keeps](mcp-local.md)).

## Every tool

Each tool is the `sauce` command named beside it, called with the same inputs: the server calls the
very functions the command does. Each returns its JSON as the tool's structured content, with the
same JSON as text. Where there are `notes`, they say what must be true for a transaction to land.

How many tools a server has depends on how it runs:

| Server                                 | Tools | Left out                                                                                            |
| -------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Over stdio (what an agent starts)      | 35    | nothing                                                                                             |
| Over stdio with `--no-wallets`         | 29    | the six `sauce_wallet_*` tools                                                                      |
| Over stdio with `--no-stores`, or HTTP | 25    | the wallet tools, `sauce_pot_list`, `sauce_pot_import`, `sauce_intent_list` and `sauce_intent_show` |

| Tool                   | Like                   | Returns                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sauce_skills`         | —                      | Every agent skill with when to use it and its files' sizes, the package version, and `latest` when a newer one is published                                                                                                                                                                                    |
| `sauce_skill`          | —                      | One skill's `SKILL.md`, or a file under its `references/` or `examples/`; with `section` or `query`, only that part                                                                                                                                                                                            |
| `sauce_dev`            | —                      | For TypeScript against the SDK: the TypeScript skill and the package's guides, API pages and examples for a topic or a question                                                                                                                                                                                |
| `sauce_install_skills` | `sauce skills`         | For one agent, pinned to the server's version: the commands that add the package and install, update and check the skills, where it reads them, and its MCP configuration                                                                                                                                      |
| `sauce_chains`         | —                      | Every chain: slug, id, name, kind, aliases, `support` (`supported` or `preview`) and where the server reads it (`endpoint`: `config`, `public` or `none`); `supported`, the supported slugs; `requestChain`, the chain-support request form                                                                    |
| `sauce_globals`        | `sauce globals`        | The chain's token symbols, protocol namespaces and contracts (with `protocol`, its methods), chain names, defines and `@sauce/token` functions; `stocks` and `search` for its tokenized stocks, 200 tokens a page (`offset`)                                                                                   |
| `sauce_price`          | `sauce price`          | A pair's price as the pool's `sqrtPriceX96` (also the swap's limit) and, each direction, the distributed swap's `priceLimit` and `maxAvgPrice` (input per output) and a single swap's `minAvgPrice` (output per input); with `slippageBps`, the `limits` ([Prices and pools](#prices-and-pools))               |
| `sauce_pools`          | `sauce pools`          | A pair's price-limit pools on the chain at one `block`, deepest first, each with its price both ways and its depth; `empty`, the pools with no liquidity ([Prices and pools](#prices-and-pools))                                                                                                               |
| `sauce_compile`        | `sauce compile`        | `bytecode`, `size`, `entryParams`, `entryEncoding`, `entrySchema`, each define it reads and where it came from, the `contracts` it calls, `compiler`, `engine`, on Solana the `manifest`; with `args` the `payload`, and with `rpcUrls` each intent's Pot checked                                              |
| `sauce_actions`        | `sauce actions`        | An actions document (JSON) compiled for a chain: `sauce_compile`'s report with the generated `source`, its `parameters` and bindings, and, given a Pot, the unsigned cook `transaction` (on a preview chain, `refused` instead)                                                                                |
| `sauce_tx`             | `sauce tx`             | The unsigned cook on the Pot, with who signs it and the Kitchen's fee; while the Pot has no code, its deployment first. On Solana a base64 transaction, or the first step of a plan ([What it returns](#what-sauce_tx-returns))                                                                                |
| `sauce_pot`            | `sauce pot`            | The Pot's address, its unsigned deployment (EVM `Kitchen.deployPot`; Solana `create_pot`; on a preview chain, `refused` instead), `deployed` (null with no endpoint), and with an endpoint what it holds and the Kitchen's fee                                                                                 |
| `sauce_reclaim`        | `sauce reclaim`        | Solana: an owner's open code buffers and Sauce lookup tables, the rent they hold, and the unsigned `transactions` that close the ones not in use                                                                                                                                                               |
| `sauce_simulate`       | `sauce simulate`       | `ok`, then `leftInPot` (what the Pot holds after the cook of what it moved, with a note when that is anything), the `path` taken, each transaction's gas (`transactions`), what `main` returns, `moves` by role, transfers, approvals and net balance changes; or the `stage` and `reason` it reverts          |
| `sauce_intent_publish` | `sauce intent publish` | Each fixed intent's `intentHash`, its `vault`, its `record` (what the other intent tools take) and its unsigned `transactions` (transfers into the vault, then `Portal.publish`; with `intentFundVia: "publishAndFund"`, approvals then `Portal.publishAndFund`); with `dryRun`, their status and `funded`     |
| `sauce_intent_fill`    | `sauce intent fill`    | For the solver `from`, its unsigned fill on the destination: approvals, then `fulfillAndProve` (the prover's fee in its value) or `fulfill`; with `dryRun`, the fill simulated: the calls and gas, what moved, or the decoded `reason`                                                                         |
| `sauce_intent_import`  | `sauce intent import`  | The intents a source transaction published, each its `record`, vault, block, whether it was funded, and the transaction's `explorer` and `trace` links; over stdio, each stored (`stored`: `created` or `exists`)                                                                                              |
| `sauce_intent_status`  | `sauce intent status`  | `state`, both sides as read, the deadlines, the prover, and `can`: whether fill, prove, claim, refund and cancel can happen now, why not, and from when                                                                                                                                                        |
| `sauce_intent_list`    | `sauce intent list`    | Over stdio only: every intent the store holds, each its `intentHash`, chains, `last` (the last event recorded) and, where an endpoint reaches its chains, `state` and `can`                                                                                                                                    |
| `sauce_intent_show`    | `sauce intent show`    | Over stdio only: one stored intent by `intentHash`: its `record`, every recorded event (chain, transaction, block, time) and `status`                                                                                                                                                                          |
| `sauce_intent_prove`   | `sauce intent prove`   | The unsigned `Portal.prove` for one or more fills or cancellations, its bridge fee in its value                                                                                                                                                                                                                |
| `sauce_intent_claim`   | `sauce intent claim`   | The unsigned `withdraw` (`batchWithdraw` for several) that pays each proven intent's claimant                                                                                                                                                                                                                  |
| `sauce_intent_refund`  | `sauce intent refund`  | The unsigned `refund` that returns the reward to its creator                                                                                                                                                                                                                                                   |
| `sauce_intent_cancel`  | `sauce intent cancel`  | The unsigned `cancel` (or, with `prove`, `cancelAndProve`) that stops an unfilled intent after its route's deadline                                                                                                                                                                                            |
| `sauce_send`           | `sauce send`           | Signed transactions simulated as signed, broadcast in order and confirmed: `ok`, and in `sent` each one's `hash`, `status`, `explorer` and `trace`, and for a cook what moved; with a plan's `cursor`, `next` ([`sauce_send`](#sauce_send))                                                                    |
| `sauce_inspect`        | `sauce inspect`        | A cook, Kitchen, Portal or ERC-20 call, or a program, taken apart; with `source`, the arguments decoded against `main`                                                                                                                                                                                         |
| `sauce_verify`         | `sauce verify`         | `valid` with the settle's tokens, `minOut` and recipient, or `valid: false` with the rejection `code`                                                                                                                                                                                                          |
| `sauce_wallet_enable`  | —                      | Over stdio: the wallets enabled for the server's life by the password source it names (`env`, `file`, `dotenv` and `variable`, or `generate`), never the password: `dir`, `source`, the `wallets` there, and with `generate` the new `passwordFile`                                                            |
| `sauce_wallet_create`  | `sauce wallet new`     | Over stdio, once the wallets are enabled: a new wallet's `name`, `kind` (`evm` or `solana`), `address` and `policy` (null: none), never its key                                                                                                                                                                |
| `sauce_wallet_import`  | `sauce wallet import`  | Over stdio, once the wallets are enabled: the key in a file given by its `path` (a keystore, a Solana keypair file or a hex key), as a new wallet: its `name`, `kind`, `address` and `policy`, never its key                                                                                                   |
| `sauce_wallet_list`    | `sauce wallet list`    | Over stdio, with no password: the wallet `dir`, whether the wallets are `enabled` and by which `source`, and each wallet's name, kind, address and policy                                                                                                                                                      |
| `sauce_wallet_address` | `sauce wallet address` | Over stdio, with no password: one wallet's `name`, `kind`, `address` and `policy`                                                                                                                                                                                                                              |
| `sauce_wallet_send`    | —                      | Over stdio, once the wallets are enabled: another tool's result (or a transaction, or a list; a Solana plan sent step by step) simulated, held to the wallet's policy, signed and sent; each one's `hash`, `status`, `explorer` and `trace`, and for a cook `moves`, `leftInPot` and `summary`; or the refusal |
| `sauce_pot_list`       | `sauce pot list`       | Over stdio, where the server keeps the Pot store: each recorded Pot's chain, address, owner, salt, kind, Kitchen, `release` and `engine`, and the `deployment` that made it                                                                                                                                    |
| `sauce_pot_import`     | `sauce pot import`     | Over stdio, where the server keeps the Pot store: the Pot `pot` names (EVM), or an `owner`'s at its salt, read from the chain and recorded; the records, as `sauce_pot_list` gives them                                                                                                                        |

## Inputs

Every input is described in the tool's schema, which `tools/list` returns. An unknown field is
refused, which is how a misspelt one is caught.

### The command's flags as inputs

A skill or a note may name a `sauce` command line. `sauce <command>` is the tool
`sauce_<command>` (`sauce intent status` is `sauce_intent_status`); a program file is `source`, its
text, or over stdio `path`, the file; every result is the command's `--json`; and a tool that reads
several chains takes `rpcUrls`, one endpoint per chain. Each flag is the input beside it, as the
server's instructions also list:

| Flag                       | Input                  |
| -------------------------- | ---------------------- |
| `--args`, `--args-json`    | `args`                 |
| `--assume-balance`         | `assumeBalance`        |
| `--fund-mode`              | `fundMode`             |
| `--fund`                   | `fund`                 |
| `--sweep`                  | `sweep`                |
| `--salt-hex`               | `saltHex`              |
| `--salt`                   | `salt`                 |
| `--owner`                  | `owner`                |
| `--pot`                    | `pot`                  |
| `--value`                  | `value`                |
| `--account`, `--accounts`  | `accounts`             |
| `--intent-deadline`        | `intentDeadline`       |
| `--intent-creator`         | `intentCreator`        |
| `--intent-execution-fee`   | `intentExecutionFee`   |
| `--intent-fund-via`        | `intentFundVia`        |
| `--intent-reward-deadline` | `intentRewardDeadline` |
| `--intent-prover`          | `intentProver`         |
| `--no-prove`               | `prove: false`         |
| `--max-execution-fee`      | `maxExecutionFee`      |
| `--lookup-table`           | `lookupTables`         |
| `--cursor`                 | `cursor`               |
| `--signature`              | `signatures`           |
| `--close`                  | `close: true`          |
| `--keep-tables`            | `keepTables`           |
| `--keep`                   | `keep`                 |
| `--via`                    | `via`                  |
| `--compact-args`           | `compactArgs`          |
| `--chain`                  | `chain`                |
| `--target`                 | `target`               |
| `--rpc-url`                | `rpcUrl`               |
| `--block`                  | `block`                |
| `--from`, `--solver`       | `from`                 |
| `--claimant`               | `claimant`             |
| `--dry-run`                | `dryRun`               |
| `--pin`                    | `pins`                 |
| `--engine`                 | `engines`              |
| `--min-out`                | `minOut`               |
| `--spl-count`              | `splCount`             |
| `--protocol`               | `protocol`             |
| `--stocks`                 | `stocks`               |
| `--search`                 | `search`               |
| `--sqrt-price-x96`         | `sqrtPriceX96`         |
| `--pool`                   | `pool`                 |
| `--v4-key`                 | `v4Pools`              |
| `--pay`                    | `pay`                  |
| `--price-limit`            | `priceLimit`           |
| `--per-venue`              | `perVenue`             |
| `--slots`                  | `slots`                |
| `--expect-revert`          | `expectRevert`         |

Error messages and notes are the `sauce` command's, in the tools' words: a flag is named as the
tool input (`--salt-hex` as `saltHex`, `--args` as `args`), and a command line as the tool
(`sauce pot --deploy …` as `sauce_pot`).

### The program

The compiling tools take the program as text:

| Input                                                   | Meaning                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `source`                                                | The program, the whole text of a `.sauce.ts` file (at most 256 KiB)                                                    |
| `path`                                                  | Over stdio only, instead of `source`: a program file on the same machine, relative to the server's directory           |
| `file`                                                  | Its name, for messages and relative imports (default `program.sauce.ts`)                                               |
| `modules`                                               | Files it imports by relative path, as path → text from the directory of `file`. Nothing is read from the server's disk |
| `chain`, `target`                                       | The chain, by slug, alias or id. `target: "svm"` alone is Solana                                                       |
| `compactArgs`                                           | Encode `main`'s arguments as compact-v1                                                                                |
| `intentDeadline`, `intentCreator`, `intentExecutionFee` | For intents the program opens: Unix seconds, a `0x` address, wei                                                       |
| `intentFundVia`                                         | How their reward reaches the vault: `transfer` (default: paid into it, then `publish`) or `publishAndFund`             |

`path` is taken by `sauce_compile`, `sauce_simulate` and `sauce_tx`, read with its relative imports
beside it. A server over HTTP reads no file and refuses `path`. Each of the three returns
`sourceSha256`, the sha256 of the program's text, which ties a simulation to the file it came from.

`sauce_compile` also takes:

- a cook's `args` and `accounts`, to size the payload and, on Solana, the cook's transaction (with
  `via`, the Kitchen's or the engine's direct one);
- `rpcUrls`, each intent destination's endpoint by chain, to check that the Pot an intent's cook
  runs on is deployed there;
- `omitBytecode`, which leaves the bytecode out.

### The cook

A cook (`sauce_tx`, `sauce_simulate`, `sauce_actions`) adds these inputs:

- the Pot: `owner` and `salt` (a label, hashed) or `saltHex` (the salt itself). On an EVM chain the
  Pot can be named by its address as `pot` instead.
- `value` in wei, on an EVM chain. The default is the Kitchen's fee, read from the chain.
- `args`: `main`'s arguments as JSON values, in order. Integers are in base units, as decimal
  strings.
- `accounts`, on Solana: each account `main` takes, by name. Each is an address, `pot`, `owner`,
  `system` or an account named by its token (`pot:USDC`, `@to:USDC`), by a pool
  (`slot:@pool:USDC.vaultA`) or by the seeds a program derives it from (`pda:<program>:<seeds>`).
  The accounts the token methods and the venue namespaces add to `main` (`USDC.transfer(to,
amount)`, `Orca.Whirlpool.swap(pool, …)`), and those a program writes where it uses them
  (`Solana.pda(program, [seeds])`, `USDC.accountOf(holder)`; `sauce_globals` lists them as
  `accounts`), are derived from the cook, so a call names them only to replace one;
  `sauce_compile`'s manifest shows each one's `derive`.
- `via`, on Solana: `kitchen` (the default), the Kitchen's cook on the owner's Pot, or `engine`,
  the engine's own paid cook with no Kitchen and no Pot: the owner signs as the authority the
  program acts with and pays the fee, and the program's own calls get one more level of CPI depth
  ([Solana guide](solana.md#two-ways-to-run-a-program)).
- `maxExecutionFee` in lamports, on Solana: a cook whose execution fee, read from the cluster, is
  above it is refused before anything is built.
- `lookupTables`, on Solana: address lookup tables holding the cook's accounts, each one byte in the
  transaction instead of 32.
- `rpcUrl`.

`sauce_tx` also takes `fund`, such as `["USDC:100"]` (EVM): the owner's transfer of each token into
the Pot, planned after its deployment and before the cook, each with its gas when an endpoint is
given; `ETH:<amount>` is added to the cook's value instead. With `sendCalls`, a smart wallet
deploys the Pot, funds it and cooks with one approval.

`sauce_simulate` also takes:

- `assumeBalance`, such as `["USDC:2", "ETH:0.1"]`: balances the Pot holds for the simulation only.
  On Solana, as for a cook too large for one transaction, the simulation then runs in a local copy
  of the accounts the cook names ([the sauce command](cli-solana.md)), its program staged as
  `sauce run` stages it;
- `fund`, `fundMode` and `sweep`, which simulate [`sauce run --fund`](cli-run.md#put-tokens-in-your-pot).
  The Pot is credited what the pulls would bring;
- `scenarios`, which simulates one program with several sets of `args` and `assumeBalance` at one
  block;
- `summary`, which returns only `ok` or the revert reason, what `main` returned, `leftInPot`, the
  balance changes, the transfers, each transaction's gas and the block.

### Token amounts

A token amount is in whole tokens: `USDC:1.5` is 1.5 USDC, exact through the token's decimals, and
`USDC:1500000` is 1.5 million USDC, which the result's `notes` point out. For base units, end it in
`n`, as a JavaScript bigint is written: `USDC:1500000n` is 1.5 USDC.

### The Pot's reads

`sauce_pot` reads what a cook needs: on an EVM chain the Kitchen's fee (the least a cook's `value`
can be) and the Pot's balance of the native currency and of each token the chain registers but its
tokenized stocks (`null` where a token cannot be read there); on Solana the Pot's associated token
account for each registered mint but the tokenized stocks, whether it exists, and its balance.
`balances: false` skips those reads.

### Prices and pools

`sauce_price` takes the price one of three ways: `price` (a decimal), `sqrtPriceX96`, or `pool`, a
Uniswap V3-style pool of the pair read through an endpoint (its `slot0` price, liquidity and fee).
With `slippageBps`, `limits` gives each direction's `sqrtPriceLimitX96` that far from the price,
and a `minAvgPrice` that also pays the pool's fee (`feePpm`, or the pool's own). A token the chain
does not register is `<address>:<decimals>`, or the address alone: its decimals are read from the
token.

`sauce_pools` takes `chain`, `tokenA` and `tokenB` (each a registered symbol or an address, whose
decimals and symbol are then read from the token), `v4Pools` (more hookless Uniswap V4 keys to
try, each `"<fee>:<tickSpacing>"`), and `rpcUrl`. It returns what
[`sauce pools --json`](cli-lookup.md#a-pairs-pools-sauce-pools) prints:

- `pools`, the ones with liquidity, deepest first. Each has its venue, contract, address or V4
  key, fee, liquidity and `sqrtPriceX96`, and two `sides` (paying `tokenA` for `tokenB`, then the
  reverse). A side has the price before and with the fee, the distributed swap's `priceLimit` and
  the depth to a 1% move. On Solana each pool also has `byKey`, how a program finds it.
- `empty`, the pools with no liquidity;
- `checked`, the tiers, tick spacings and keys each venue was asked for.

### Actions documents

`sauce_actions` takes the document as `program`, an object or its JSON text, validated against the
[action-program schema](../../actions/action-program.schema.json), also served as
`sauce://actions/schema.json`, and `chain` for a document without a `chainId`. It calls the
function `sauce actions` runs, so its names (tokens by symbol, contracts by namespace) resolve on
that chain as they do for the command.

### Intents

`sauce_intent_publish` takes `from` (the wallet that funds the reward), `dryRun`, `assumeBalance`,
`rpcUrl`, and the program inputs, `intentFundVia` among them. The program inputs also take the
reward's deadline and prover: `intentRewardDeadline` (Unix seconds; the intent's deadline by
default) and `intentProver` (the registry's for the pair by default).

Each later step names an intent by its `record`, the JSON `sauce_intent_publish`,
`sauce_intent_import` and `sauce_intent_status` return, checked against its own hash before
anything is built from it. It can also name it by the transaction that published it: `txHash` with
its source `chain` (and `index` when it published several). Over stdio, where the server keeps the
intent store, every intent tool also takes `intentHash`, an intent the store holds.
`sauce_intent_fill` also takes the program itself, with the same inputs as `sauce_intent_publish`.

Each tool reads the chains it needs through the server's endpoints, or through `rpcUrls`, each
chain's endpoint by slug or id. `rpcUrl` is the endpoint of the chain the tool names: the source
for import, claim and refund, the destination for fill, prove and cancel. The server's endpoints
fill the gaps.

## Results and errors

A revert and a rejected settle are results (`ok: false`, `valid: false`), not errors. So is an
intent step that cannot happen yet: `ready: false`, with `why`. An error is a call that could not be
answered: a program that does not compile, an input that is wrong, a chain that cannot be read.

A simulation that leaves anything in the Pot adds a note saying so, for the agent to pass on to the
user: what stays in the Pot is not in the owner's wallet
([Where a program's results end](../concepts/kitchen-pot-cook.md#where-a-programs-results-end)).

### What `sauce_tx` returns

- **On an EVM chain:** `{ chainId, to, data, value }`, the cook on the Pot, with `from` (who signs)
  and the `kitchenFee` read. While the Pot has no code, `{ chainId, pot, transactions }`: its
  deployment (marked `deploysPot`), then the cook. Each comes with `gas`, the limit to sign it with,
  and `sendCalls` holds them all for a smart wallet.
- **On Solana:** `{ chain, via, feePayer, pot, fee, maxExecutionFee, createsPot, transaction,
cursor }`, a base64 transaction signed by no one. A cook of several transactions comes as the
  first step of its plan instead: `{ step, plan, transactions, cursor }`.

[Sign with your wallet's MCP server](wallet-mcp.md) covers the order to send them in and how a
plan goes on.

### `sauce_send`

`sauce_send` takes signed transactions in the order to send them, at most 32. On an EVM chain each
is the raw `0x…` hex a signer returns (its chain and sender are read from it); on Solana, the
base64 wire transaction. It never takes a key, and is served over HTTP as over stdio.

- Each is simulated as it was signed first and refused, unsent, when it would fail. On an EVM chain
  that is an `eth_call` from its sender with its gas limit; on Solana, a simulation that checks
  every signature.
- Each lands before the next is simulated, and the first that does not succeed stops the rest.
- A transaction already on chain is read back, not sent again. One the chain had, pending, then lost
  (dropped or reorged out) is reported gone, to sign anew.
- Each entry of `sent` has its `hash` (on Solana, its signature), `status`, `explorer` and `trace`,
  its fee or gas and the decoded `reason`. For a cook it adds what moved, `leftInPot` and, on
  Solana, `returns`.
- `pots` is the record of each Pot a transaction deployed, for you to keep.
- With a plan's `cursor`, `next` is the plan's next step, built fresh.

## What needs an endpoint

On a chain the server cannot read (no `rpcUrl`, no `--config` entry, no public endpoint), this
still works:

- compiling a program or an action document;
- a chain's names and a price conversion;
- the EVM cook, given its `value`, on a supported chain;
- the Pot's address, and on a supported chain its deployment and an intent's publish transactions;
- taking calldata apart, and reading the skills.

What needs an endpoint: `sauce_simulate`, a publish dry run, anything given a transaction hash, a
Solana cook (its blockhash and fee), and reading the Kitchen's fee or whether a Pot exists.
[Use your own endpoints](mcp.md#use-your-own-endpoints) says where the server finds one.

## Supported and preview chains

The server builds transactions only on the chains Sauce supports: Ethereum, Base and Solana. Every
other chain is a preview chain; [Chains](../reference/chains.md) has the policy and every chain.
`sauce_chains` gives each chain's `support`, `"supported"` or `"preview"`.

On a preview chain these work as they do everywhere: `sauce_compile`, `sauce_actions`' report,
`sauce_simulate`, `sauce_globals`, `sauce_price`, `sauce_pools`, `sauce_inspect`, `sauce_verify`,
the dry runs (`sauce_intent_publish` and `sauce_intent_fill` with `dryRun`), `sauce_pot`'s
prediction and reads, `sauce_intent_status` and `sauce_intent_import`. So an agent can prototype
any protocol on any chain.

These are refused there, before any endpoint is reached:

- `sauce_tx`, when the program's chain, or the destination of any intent it opens, is a preview
  chain;
- `sauce_intent_publish` without `dryRun`, unless its source and every destination it opens are
  supported (a cascade's later levels are not checked: keep them on supported chains);
- `sauce_intent_fill` without `dryRun`, `sauce_intent_prove` and `sauce_intent_cancel`, by the
  intent's destination; `sauce_intent_claim` and `sauce_intent_refund`, by its source. An intent
  named by `txHash` is read from its source first, then refused by its destination where that is
  the chain the step is sent on.

A refused call is an error result (`isError: true`) whose structured content is the refusal, also
given as its text:

```json
{
  "refused": {
    "code": "preview-chain",
    "action": "building the cook transaction",
    "message": "building the cook transaction is refused: it involves arbitrum (Arbitrum One, chain id 42161), a preview chain. …",
    "supportedChains": [
      { "slug": "ethereum", "id": 1, "name": "Ethereum" },
      { "slug": "base", "id": 8453, "name": "Base" },
      { "slug": "solana", "id": 1399811149, "name": "Solana" }
    ],
    "previewChains": [
      {
        "slug": "arbitrum",
        "id": 42161,
        "name": "Arbitrum One",
        "request": {
          "chain": { "name": "Arbitrum One", "id": 42161, "slug": "arbitrum" },
          "title": "Chain support: Arbitrum One (42161)",
          "searchUrl": "https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support+%22Arbitrum+One%22",
          "newIssueUrl": "https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml&title=Chain+support%3A+Arbitrum+One+%2842161%29&chain=Arbitrum+One&chain-id=42161",
          "body": "### Chain\n\nArbitrum One\n\n### Chain id\n\n42161\n\n### What you want to run there\n\n…",
          "comment": "Another use case for Arbitrum One (42161):\n\n- What you want to run there: …"
        }
      }
    ]
  }
}
```

`searchUrl` finds the chain-support requests already filed for the chain; `newIssueUrl` opens the
issue form with its title and chain filled in. `body` is the issue as the form would write it, and
`comment` adds one use case to an existing request, each with `<placeholders>` for what the agent
does not know, to post through the user's own GitHub access. The server's instructions tell an
agent to tell the user, offer to find or open that request, and not to build the transaction
another way.

`sauce_pot` on a preview chain returns its prediction (and, with an endpoint, its reads) with
`refused` in place of the deployment's `to`, `data` and `value`. `sauce_actions` given a Pot on a
preview chain returns its report with `refused` in place of `transaction`. Neither is an error.

## The intent tools in order

The tools follow an intent's life, which [Intents from the command line](cli-intents.md) explains
with the command:

1. `sauce_intent_publish`: the creator's transactions on the source chain. Or `sauce_intent_import`
   for an intent published elsewhere.
2. `sauce_intent_status`: where it stands, and `can`, what can happen next and from when.
3. `sauce_intent_fill` with `from`, the solver: its transactions on the destination. With `dryRun`,
   the same fill simulated, from any solver. A fill that proves itself (`fulfillAndProve`) needs no
   step 4.
4. `sauce_intent_prove`: the proof of fills or cancellations, sent from the destination; the
   bridge delivers it to the source's prover.
5. `sauce_intent_claim`: the reward paid to each proven fill's claimant, on the source.

The creator's way back:

- `sauce_intent_refund` returns the reward from the reward's deadline when no one proved a fill, or
  earlier once a proven cancellation is recorded on the source. A source Portal that cannot refuse
  to pay a cancellation is never refunded early.
- `sauce_intent_cancel` stops an unfilled intent after its route's deadline. Anyone may send it,
  and only a destination Portal that can cancel takes it. Prove the cancellation with
  `sauce_intent_prove` once the block it landed in is final (give that block in `cancelledIn`), then
  refund. `prove: true` sends the proof at once, before finality, and the result warns.

**To Solana.** The destination's steps (fill, prove and cancel) come back as Solana transactions:
`feePayer` and `transaction`, a base64 wire transaction with every signature in but the fee
payer's. Pass the Solana key that pays and signs as `from`; a fill also needs `claimant`, the
address on the EVM source the reward pays. Sign each with that key, last, and send it within about
a minute, before its blockhash expires. `dryRun` simulates an EVM destination's fill only; a Solana
fill is simulated as it is built. Claim and refund stay on the EVM source.

**From Solana.** Give `sauce_intent_publish` the file with `chain: "solana"` and `from`, the Solana
key that holds the reward and pays the fees. You get two transactions per intent, in order: `fund`,
which moves the reward into the intent's vault, then `publish`, which announces the intent. Its
fill and proof are the EVM destination's, with `claimant` the Solana key the reward pays.
`sauce_intent_claim` and `sauce_intent_refund` then come back as Solana transactions for `from`,
which anyone may pay.

## Skills, documents and prompts

The [agent skills](skills.md) the package ships are the same files `sauce skills install`
copies into a project. They are served two ways, because many clients call tools but never read
resources:

- as tools. `sauce_skills` lists them. `sauce_skill` returns a `SKILL.md`, or a file it links, by
  skill and path; only shipped files are served. `sauce_dev` returns the TypeScript skill and the
  package's own guides, API pages and examples for a topic or a free-text question.
  `sauce_install_skills` says how to install the skills locally for an agent, at the server's
  own version.
- as resources. `sauce://skills/index` lists every skill and its files.
  `sauce://skills/<skill>/SKILL.md` is a skill, and its `references/…` and `examples/…` sit beside
  it.

When a client connects, the server's instructions tell it five things:

- whether the server signs (only with its wallets, over stdio, once they are enabled);
- to start from `sauce_skills`;
- the steps from `sauce_globals` to `sauce_tx`;
- which chains it builds transactions on, and what to do with a refusal;
- how `rpcUrl` works.

Two prompts walk the main tasks through the tools, with the skill they start from embedded:

- `sauce_write_program` (`task`, `chain`) writes, compiles, simulates and builds a program.
- `sauce_open_intent` (`task`, `source`, `destination`) opens a cross-chain intent and builds its
  publish transactions.

## Next

- Sign and send what these tools build: [Sign with your wallet's MCP server](wallet-mcp.md).
- Wallets, Pots and intents a local server keeps: [What a local server keeps](mcp-local.md).
- The same commands at a terminal: the [command reference](../reference/cli.md).
