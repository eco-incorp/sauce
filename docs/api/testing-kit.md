# Testing kit

**Reference** · [Documentation](../README.md) · [Testing programs](../guides/testing.md) · [Test your first program](../guides/test-your-first-program.md)

> The testing kit runs your programs on a private copy of a chain, inside your tests. This page
> lists everything it exports: the two ways to start a chain, what a chain can do, and what a cook
> gives back.

This page is for a TypeScript developer writing tests. It lists facts; to learn the kit step by
step, do [Test your first program](../guides/test-your-first-program.md) first, and for one task at
a time, read [Testing programs](../guides/testing.md). A **cook** is the transaction that runs a
program on a **Pot**, your account on chain; the [glossary](../concepts/glossary.md) has both.

## The import

```ts
import { CookReverted, fork, local, type TestChain } from "@eco-incorp/sauce/testing";
```

`@eco-incorp/sauce/testing` runs in Node.js only. An EVM chain runs on Foundry's `anvil`, which
must be on `PATH` (or named by the `anvil` option). Solana runs in LiteSVM inside the test's
process, installed in your project at the version the package pins. The kit reads no environment
variables: the endpoint, the block and the state file are arguments.

| Export                 | Kind     | What it is                                                                        |
| ---------------------- | -------- | --------------------------------------------------------------------------------- |
| `fork(chain, options)` | function | Starts a copy of a real chain at a pinned point, replayed from a file or recorded |
| `local(options?)`      | function | Starts an empty chain with the Sauce release and nothing else                     |
| `TestChain`            | class    | An EVM chain a test runs on                                                       |
| `SolanaTestChain`      | class    | The Solana chain a test runs on                                                   |
| `CookReverted`         | class    | The error a cook that reverts throws                                              |
| `DEFAULT_POT_SALT`     | constant | The salt each test account's Pot uses: 32 zero bytes, as `sauce run` uses         |
| `ForkOptions`          | type     | The options of `fork` on an EVM chain                                             |
| `SolanaForkOptions`    | type     | The options of `fork` on Solana                                                   |
| `LocalOptions`         | type     | The options of `local`                                                            |
| `ForkMode`             | type     | `"replay"`, `"record"` or `"live"`                                                |
| `SolanaChainRef`       | type     | The names `fork` and `local` take for Solana                                      |
| `TestAccount`          | type     | An EVM test account: `index`, `address`, `privateKey`, `pot`                      |
| `SolanaTestAccount`    | type     | A Solana test account: `index`, `address`, `secretKey`, `pot`                     |
| `CookOptions`          | type     | What `run` and `simulate` take on an EVM chain                                    |
| `SolanaCookOptions`    | type     | What `run` and `simulate` take on Solana                                          |
| `CookResult`           | type     | What an EVM cook returns                                                          |
| `SolanaCookResult`     | type     | What a Solana cook returns                                                        |
| `SolanaChange`         | type     | One balance a Solana cook changed                                                 |
| `SolanaAccount`        | type     | A Solana account as the chain holds it                                            |
| `CompiledProgram`      | type     | What `compile` returns                                                            |
| `ProgramInput`         | type     | A program: a path, a `file:` URL, or `{ source }`                                 |
| `Value`                | type     | What `main` returned, read as it declares it                                      |
| `Effects`, `Movement`  | type     | The decoded logs of an EVM cook, and one token movement among them                |

## Starting a chain

### `fork(chain, options)`

Starts a copy of `chain` as it was at a pinned point. On an EVM chain it boots `anvil` at
`options.block`; on Solana it starts LiteSVM. The released engine, Router and Kitchen are ready,
ten test accounts exist, and account 0's Pot is deployed. Returns a `TestChain`, or a
`SolanaTestChain` when `chain` is Solana.

| Option          | EVM | Solana | Meaning                                                                                   |
| --------------- | --- | ------ | ----------------------------------------------------------------------------------------- |
| `block`         | yes | no     | The block the copy starts at. Required on an EVM chain; refused on Solana                 |
| `state`         | yes | yes    | The recorded state file (`.json.gz`): replayed when it exists, written when it does not   |
| `rpcUrl`        | yes | yes    | The chain's endpoint, read only to record or to fork live; it must serve state at `block` |
| `mode`          | yes | yes    | `"auto"` (the default), `"replay"`, `"record"` or `"live"`; see the modes below           |
| `zeroFee`       | yes | yes    | `true` clears the Kitchen's fee; by default the chain's own fee is kept                   |
| `blockInterval` | yes | no     | Seconds between blocks after the pinned one: 12 on Ethereum and 2 on every other chain    |
| `anvil`         | yes | no     | The `anvil` binary; by default the one on `PATH`                                          |

| Mode       | Starts when                             | Needs    | What happens                                                          |
| ---------- | --------------------------------------- | -------- | --------------------------------------------------------------------- |
| `"replay"` | `state` exists                          | `state`  | Boots from the file, with no endpoint                                 |
| `"record"` | `state` is named and does not exist yet | `rpcUrl` | Reads through `rpcUrl`; `stop()` writes every account read to `state` |
| `"live"`   | no `state` is named                     | `rpcUrl` | A plain fork; nothing is recorded                                     |

`"auto"` picks the first row that applies. Passing a mode forces it: `"replay"` refuses to start
without the file, and `"record"` records the file again.

### `local(options?)`

Starts an empty chain: the Sauce release at its addresses, ten test accounts, account 0's Pot, no
Kitchen fee, and no protocols or tokens. It needs no network. Use it for a program that calls
nothing; fork a chain for anything that calls a protocol or moves a token.

| Option  | Meaning                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| `chain` | The chain the empty node runs as: its id, and the names programs compile with. Default `base` |
| `anvil` | The `anvil` binary; by default the one on `PATH`. EVM only                                    |

`local({ chain: "solana" })` gives an empty Solana: the engine and the Kitchen, the runtime's own
programs, wrapped SOL, and nothing else.

## `TestChain`

What `fork` and `local` return on an EVM chain.

| Call                                        | What it does                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `account(i)`                                | Test account `i` (0–9): `address`, `privateKey`, and `pot`, its Pot under the default salt |
| `fund(holder, { USDC: "100", ETH: "1" })`   | Adds whole tokens (a string) or base units (a bigint) to `holder`                          |
| `balanceOf(holder, "USDC")`                 | A balance in base units. A token is a registry symbol, an address, or `ETH`                |
| `run(program, { from, args, value })`       | Sends the program as a cook from test account `from`'s Pot, and waits for it to be mined   |
| `simulate(program, { from, args, value })`  | The same cook, run and not sent                                                            |
| `compile(program)`                          | The program compiled for the chain: `bytecode`, `params`, `returnType`                     |
| `impersonate(address, (send) => …)`         | Sends transactions as any address, such as a token holder                                  |
| `deployPot(account)`                        | Deploys a test account's Pot now, rather than on its first cook                            |
| `snapshot()`, `revert()`                    | Saves the chain's state, and returns to it. They nest                                      |
| `increaseTime(seconds)`, `mine(n)`, `now()` | Moves the clock and mines a block, mines blocks, reads the latest block's time             |
| `executionFee()`                            | The Kitchen's fee, which every cook pays                                                   |
| `stop()`                                    | Stops the node. A recording chain writes its state file here, so await it                  |

| Property                      | What it is                                                        |
| ----------------------------- | ----------------------------------------------------------------- |
| `chain`                       | The chain the node runs as                                        |
| `mode`                        | `"replay"`, `"record"`, `"live"`, or `"local"` for an empty chain |
| `rpcUrl`                      | The local node's URL                                              |
| `client`, `test`              | viem's public and test clients for the node, for anything else    |
| `engine`, `kitchen`, `router` | The release's contracts on the node                               |

### Programs and arguments

A program is a path, a `file:` URL, or `{ source }`. It compiles with the chain's names, as
`sauce compile` compiles it, and its relative imports resolve beside the file. A program that opens
a cross-chain intent does not compile here: the kit takes no intent deadline or creator.

| `CookOptions` | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `from`        | The test account whose Pot cooks: an index or a `TestAccount`. Default 0     |
| `args`        | `main`'s arguments in order: integers as bigints, addresses and bytes as hex |
| `value`       | Native coin sent with the cook beyond the Kitchen's fee, in wei              |

A test account's Pot is deployed on its first cook, account 0's at start. Every cook pays the
Kitchen's fee as value, which the kit adds. On a forked chain that already runs the release, the
Kitchen is that chain's own, fee included.

### `CookResult`

What `run` and `simulate` return on an EVM chain.

| Field                  | What it is                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `returned`             | What `main` returned, read as it declares it: integers as bigints, an address as hex       |
| `returnData`           | The raw bytes `main` returned                                                              |
| `transfers`            | Every token movement the cook's logs record, wraps and unwraps included, as `Movement`s    |
| `delta(holder, token)` | How much `holder`'s balance of `token` changed                                             |
| `effects`              | The decoded logs in full, as an `Effects`: transfers, approvals, balance changes, the rest |
| `gasUsed`              | The gas the cook used                                                                      |
| `hash`                 | The cook's transaction hash, after `run` only                                              |

`run` reports the transaction it mined: `returned` and a revert's reason come from the node's trace
of that transaction, so a program that reads the block number or the time returns what it read in
its own block. Only the gas is estimated first. A cook is sent even when that estimate reverts, and
a reverted cook is mined like any other transaction: it moves nothing, but it takes a block and a
nonce.

### `fund` and the tokens it cannot write

`fund` writes a token balance into the token's own storage, in the slot its `balanceOf` reads, and
checks the result. The token's total supply does not change. It refuses a token whose balance is
computed rather than stored (a rebasing token, shares): send that from an account that holds it,
with `impersonate`. It also refuses a Base B20 token, a node precompile `anvil` cannot run; no
transfer of one runs there, so a test that needs one cannot run on the kit.

## `CookReverted`

A cook that reverts throws `CookReverted`, on both kinds of chain.

| Field    | What it is                                                                                    |
| -------- | --------------------------------------------------------------------------------------------- |
| `reason` | The program's `require` or `throw` message, a called contract's error, or why the cook halted |
| `data`   | The raw revert data                                                                           |
| `logs`   | On Solana, the transaction's program logs, which say where it failed                          |

On Solana the reason can also be the engine's or the Kitchen's refusal by name, or the runtime's
error.

## Recordings

A replay boots from the state file at the pinned block's number and timestamp. The file holds every
account and storage slot the recording run read, at their values in that block, and also the
block's gas limit, the EVM hardfork the fork ran, the base fee of the block after the pinned one,
and the test accounts' nonces. The replay sets them again, so a replayed cook uses the same gas,
pays the same fees and is the same transaction, hash included. It cannot reproduce block hashes, or
the PREVRANDAO value of the blocks after the pinned one.

A replayed chain knows only what the recording read: an account or slot read for the first time
reads as zero. The state file never contains the endpoint's URL; the kit refuses to write one that
does. A state file that lacks the gas limit, hardfork, base fee and nonces replays at its recorded
gas limit only; record it again to replay the rest.

On Solana a node serves accounts only as they are now, so there is no block to pin. The file keeps
the slot it was recorded at, its time, and the cluster's rent and epochs, and a replay runs there.
It holds every account the test's transactions named, as the cluster held it when first named,
each program's code included. An account the recording does not hold reads as missing, and the
error says so.

## `SolanaTestChain`

What `fork` and `local` return when the chain is Solana.

| Call                                          | What it does                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `account(i)`                                  | Test account `i` (0–9): `address`, `secretKey` (as `solana-keygen` writes one), and `pot` |
| `fund(holder, { USDC: "100", SOL: "1" })`     | Adds whole tokens (a string) or base units (a bigint) to `holder`                         |
| `balanceOf(holder, "USDC")`                   | A balance in base units. A token is a registry symbol, a mint, or `SOL`                   |
| `run(program, { from, args, accounts })`      | Sends the program as a cook from test account `from`'s Pot, as `sauce run` sends it       |
| `simulate(program, { from, args, accounts })` | The same cook, and everything before it, run and undone                                   |
| `compile(program)`                            | The program compiled for Solana: bytecode, parameters, return type, the accounts it takes |
| `getAccount(key)`, `setAccount(key, account)` | Reads or writes any account: lamports, owner, data                                        |
| `deployPot(account)`                          | Creates a test account's Pot now, rather than on its first cook                           |
| `snapshot()`, `revert()`                      | Saves the chain's state, and returns to it. They nest                                     |
| `increaseTime(seconds)`, `warp(slots)`        | Moves the clock and the slot together, 400 ms a slot                                      |
| `now()`, `slot()`                             | The time and the slot a program reads (`ctx.timestamp()`, `ctx.blockNumber()`)            |
| `executionFee()`                              | The Kitchen's fee, which every cook's owner pays                                          |
| `stop()`                                      | Stops the chain. A recording chain writes its state file here, so await it                |

Each test account starts with 1,000 SOL, and account 0's Pot is created at start; another test
account's on its first cook. On a fork the Kitchen's fee is the cluster's, which the owner pays
with each cook. An empty chain charges none.

`fund` writes a token's amount into the holder's associated token account, creating it first where
it is missing; the mint's supply stays as it was. Token-2022 mints work the same way.

### `SolanaCookOptions`

| Option     | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `from`     | The test account whose Pot cooks: an index or a `SolanaTestAccount`. Default 0  |
| `args`     | `main`'s arguments in order: integers as bigints, a key as base58               |
| `accounts` | `main`'s `Account` parameters by name, in the words `sauce run --account` takes |

The account words are `pot`, `owner`, `pot:USDC` (the Pot's USDC account), `@to:USDC` (that of
`main`'s argument `to`), `<address>:USDC`, `mint:USDC`, `program:USDC`, or an address. The accounts
compiling added for you, for `USDC.transfer(to, amount)` or a venue's swap, are worked out on their
own.

A token account the cook names that does not exist yet, such as the recipient's, is created first,
the owner paying its rent. A program too large for one transaction is staged into a code buffer
first, its accounts through a lookup table where they do not fit either, and the buffer is closed
after.

### `SolanaCookResult`

| Field                  | What it is                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `returned`             | What `main` returned, read as it declares it: integers as bigints, a key as base58                 |
| `returnData`           | The raw bytes `main` returned                                                                      |
| `changes`              | Every balance the cook changed, as `{ holder, token, mint, amount }`                               |
| `delta(holder, token)` | How much `holder`'s balance changed. The owner's SOL includes the transaction's and Kitchen's fees |
| `logs`                 | The transaction's program logs                                                                     |
| `computeUnits`         | The compute units the cook used                                                                    |
| `signature`            | The cook's transaction signature, after `run` only                                                 |
| `staged`               | Whether the program was staged into a code buffer first                                            |
| `lookupTable`          | Whether the staged cook's accounts went through a lookup table                                     |

In `changes`, SOL is counted by account, and a token by the owner of the token account that holds
it.

## Next

[Testing programs](../guides/testing.md) puts these calls to work: record a fork, fund a token the
kit cannot write, test on Solana, and run the tests in CI.
