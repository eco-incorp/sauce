# Testing programs

**How-to guide** · [Documentation](../README.md) · [Compiling programs](compiling.md) · [The sauce command](cli.md)

> Before you trust a program with money, test it. The testing kit starts a private copy of a chain on
> your computer, gives you test accounts with Pots and tokens, runs your program, and lets you check
> what moved. Nothing real is touched, and a test recorded once replays with no network.

`@eco-incorp/sauce/testing` runs your programs on a local chain from a test. It starts Foundry's
`anvil`, makes the released engine, Router and Kitchen ready there, and gives you test accounts with
Pots. You fund an account or a Pot, run a program as a cook, and assert on what `main` returned and
on what moved. Write the tests with `node:test`'s `describe` and `it`; the kit's functions are plain
async functions, so any runner works. Give each test and hook a generous timeout, since a fork boots
anvil and makes the stack ready, which takes seconds: `node:test` has no default limit, mocha allows
2 seconds, and vitest and jest 5.

A test forks a real chain at a block you pin. The first run records every account and storage slot
the tests read into a state file you commit. Every later run, CI included, replays that file: no
RPC, no network, and the same result every time.

The kit is Node.js only. It runs EVM chains on `anvil`, and Solana in LiteSVM: see
[Solana](#solana) for what differs there.

## Setup

Install the package and Foundry, which provides `anvil`:

```sh
npm i -D @eco-incorp/sauce
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

`anvil` must be on `PATH`, or pass its path as the `anvil` option. The kit reads no environment
variables: the RPC, the block and the state file are arguments you pass.

To test on Solana, install LiteSVM too, at the version the package pins (the kit says which, if
yours differs). Solana needs no Foundry:

```sh
npm i -D litesvm@1.6.0
```

## A first test

A program that sells USDC from the Pot for WETH, `swap.sauce.ts`:

```js
import { uniswapV3 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  require(self.USDC >= amountIn, "amountIn is not in the Pot");
  const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  return uniswapV3(pool, USDC, WETH, amountIn, 0, minOut, recipient);
}
```

And its test, `swap.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { CookReverted, fork, type TestChain } from "@eco-incorp/sauce/testing";

const SWAP = new URL("./swap.sauce.ts", import.meta.url);

describe("swap.sauce.ts on Base", () => {
  let base: TestChain;
  before(async () => {
    base = await fork("base", {
      block: 52_384_000,
      state: "test/state/swap-base.json.gz",
      rpcUrl: process.env.BASE_RPC_URL, // read only when the state file is not there yet
    });
  });
  after(() => base.stop());
  beforeEach(() => base.snapshot());
  afterEach(() => base.revert());

  it("buys WETH with the Pot's USDC", async () => {
    const alice = base.account(0);
    await base.fund(alice.pot, { USDC: "100" });
    const result = await base.run(SWAP, { args: [100_000_000n, 0n, alice.address] });

    assert.ok((result.returned as bigint) > 0n);
    assert.equal(result.delta(alice.address, "WETH"), result.returned);
    assert.equal(result.delta(alice.pot, "USDC"), -100_000_000n);
  });

  it("refuses an amount the Pot does not hold", async () => {
    await assert.rejects(
      base.simulate(SWAP, { args: [100_000_000n, 0n, base.account(0).address] }),
      (error) => error instanceof CookReverted && error.reason === "amountIn is not in the Pot",
    );
  });
});
```

Run it with Node's test runner, with a time limit for each test and hook. TypeScript runs through
`tsx` (or Node's own type stripping):

```sh
npx tsx --test --test-timeout=120000 swap.test.ts
```

## Record and replay

`fork(chain, { block, state, rpcUrl, mode })` starts the chain one of three ways:

- **Replay**: `state` exists. Anvil boots from it at the pinned block's number and timestamp, with no
  RPC. This is every run after the first.
- **Record**: `state` does not exist yet. The fork reads through `rpcUrl` at `block`, and `stop()`
  writes every account and slot the tests read, at their values in that block, to `state`. Await
  `stop()`.
- **Live**: no `state` named. A plain fork at `block`, nothing recorded.

`mode` forces one: `"replay"` refuses to start without the file, `"record"` records it again, and
`"live"` never records. The default, `"auto"`, picks as listed.

A replayed chain knows only what the recording run read. A test that starts reading something new
(another token, another pool) reads zeros there, so record again after changing what the tests do,
or after moving the block: delete the file, or pass `mode: "record"`, with `rpcUrl` set. The RPC
must serve state at `block`. A public endpoint usually does for a recent block; an older one needs
an archive node. The state file never contains the RPC URL: the kit refuses to write one that
does. Keep the URL itself out of the repository, for example in an environment variable your test
reads.

Every block after the pinned one is the chain's block time later (12 seconds on Ethereum, 2
elsewhere; set it with `blockInterval`), so nothing depends on the wall clock.

A replay runs on the node the recording ran on. The state file also records the block's gas limit,
the EVM hardfork the fork ran, the base fee of the block after the pinned one, and the test
accounts' nonces, and the replay sets them again. So a cook replayed uses the same gas, pays the same
fees, and is the same transaction, hash included. A replay cannot reproduce block hashes, or the
PREVRANDAO value of the blocks after the pinned one. A state file written by an earlier version of
the kit lacks these values: it still replays at its recorded gas limit, but sets none of the rest.
Record it again to replay them too.

## The chain

`fork` and `local` return a `TestChain`:

| Call                                        | What it does                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `account(i)`                                | Test account `i` (0–9): `address`, `privateKey`, and `pot`, its Pot under the default salt. |
| `fund(holder, { USDC: "100", ETH: "1" })`   | Adds whole tokens (a string) or base units (a bigint) to `holder`.                          |
| `balanceOf(holder, "USDC")`                 | A balance in base units. A token is a registry symbol, an address, or `ETH`.                |
| `run(program, { from, args, value })`       | Sends the program as a cook from account `from`'s Pot and waits.                            |
| `simulate(program, { from, args, value })`  | The same cook as an `eth_call`, sending nothing.                                            |
| `compile(program)`                          | The program compiled for the chain: bytecode, parameters, return type.                      |
| `impersonate(address, send => …)`           | Sends transactions as any address, such as a token holder.                                  |
| `snapshot()`, `revert()`                    | Saves the chain's state, and returns to it. They nest.                                      |
| `increaseTime(seconds)`, `mine(n)`, `now()` | Moves the clock, mines blocks, reads the time.                                              |
| `executionFee()`                            | The Kitchen's fee, which every cook pays.                                                   |
| `stop()`                                    | Stops the node, and writes a recording.                                                     |

`client` and `test` are viem's public and test clients for anything else.

A program is a path, a `file:` URL, or `{ source }`. It compiles for the chain's names, the same way
the `sauce` command compiles it; its relative imports resolve beside the file. `args` are `main`'s
arguments in order: integers as bigints, addresses and bytes as hex.

An account's Pot is deployed on its first cook (account 0's at start). Every cook pays the Kitchen's
fee as value, which the kit adds. On a forked chain that already runs the release, the Kitchen is
that chain's own, fee included; pass `zeroFee: true` to clear it.

## What a cook returns

`run` and `simulate` return:

- `returned`: what `main` returned, read as it declares it. Integers are bigints, an address is hex,
  and a record or array has the same shape.
- `returnData`: the raw bytes.
- `transfers`: every token movement the cook's logs record, including wraps and unwraps.
- `delta(holder, token)`: how much `holder`'s balance of `token` changed.
- `effects`: the decoded logs in full: transfers, approvals, balance changes, the rest.
- `gasUsed`, and `hash` after `run`.

`effects` is an `Effects`, and each of `transfers` a `Movement`; the kit exports both types.

A cook that reverts throws `CookReverted`. Its `reason` is the program's `require` or `throw`
message, a called contract's error, or why the node halted it, such as `out of gas`; `data` is the
raw revert data.

What `run` reports is the transaction it mined: `returned` and a revert's reason are read from the
node's trace of that transaction, so a program reading the block number or the time returns what
it read in its own block. Only the gas is estimated first, for the block the cook is mined in, and a
cook is sent even when the estimate reverts. A reverted cook is mined like any other transaction: it moves nothing, but it
takes a block and a nonce. `simulate` runs the same cook without sending it.

## Funding

`fund` writes a token balance into the token's own storage, in the slot its `balanceOf` reads. It
finds the slot by asking the token, and checks the result. The token's total supply is not changed.
Two kinds of token cannot be funded this way: a token whose balance is computed rather than stored
(a rebasing token, shares), and a Base B20 token (a node precompile anvil cannot run). For the
first, send it from an account that holds it:

```ts
await base.impersonate(holder, (send) =>
  send({
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [pot, amount] }),
  }),
);
```

## An empty chain

`local({ chain })` starts an empty chain, Base by default. It has no protocols or tokens, the
release deployed at its addresses, and no Kitchen fee. Use it for programs that call nothing; fork a
chain for anything that does.

```ts
const chain = await local();
const result = await chain.run(
  { source: "function main(a: Uint256): Uint256 {\n  return a * 2;\n}\n" },
  { args: [21n] },
);
// result.returned === 42n
await chain.stop();
```

## Solana

Think of Solana as a big shared notebook of accounts: who holds how many coins, which programs
exist, what each pool holds. A real cook writes in the real notebook, costs real money, and cannot be
taken back. So for a test, the kit makes a pretend notebook inside your test, on your computer. It
holds the same Sauce engine and Kitchen as the real one and follows the same rules, but you can give
your test accounts as much money as you like, run your program, and look at what changed. Nothing
you do there reaches the real Solana, and it costs nothing.

When a program needs something real, such as USDC or a pool to swap at, the pretend notebook copies
that page from the real one the first time a test asks for it, and writes it down in a file. The
next run reads the file instead. So after the first run your tests need no internet, and they give
the same answer every time.

The pretend notebook is [LiteSVM](https://github.com/LiteSVM/litesvm), which runs Solana's own
runtime in your test's process: there is no node to start.

### A first Solana test

A program that pays USDC from the Pot, `pay.sauce.ts`:

```js
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

And its test:

```ts
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { CookReverted, fork, type SolanaTestChain } from "@eco-incorp/sauce/testing";

const PAY = new URL("./pay.sauce.ts", import.meta.url);

describe("pay.sauce.ts on Solana", () => {
  let solana: SolanaTestChain;
  before(async () => {
    solana = await fork("solana", {
      state: "test/state/pay-solana.json.gz",
      rpcUrl: process.env.SOLANA_RPC_URL, // read only when the state file is not there yet
    });
  });
  after(() => solana.stop());
  beforeEach(() => solana.snapshot());
  afterEach(() => solana.revert());

  it("pays USDC from the Pot", async () => {
    const alice = solana.account(0);
    const bob = solana.account(1).address;
    await solana.fund(alice.pot, { USDC: "1" });
    const result = await solana.run(PAY, { args: [bob, 400n] });

    assert.equal(result.delta(bob, "USDC"), 400n);
    assert.equal(result.delta(alice.pot, "USDC"), -400n);
  });

  it("refuses more than the Pot holds", async () => {
    await assert.rejects(
      solana.simulate(PAY, { args: [solana.account(1).address, 400n] }),
      (error) => error instanceof CookReverted && error.reason === "not enough USDC",
    );
  });
});
```

`fork` and `local` give a `SolanaTestChain` when the chain is `"solana"`. It runs `npx tsx --test`
like any other test, and starts in well under a second.

### Recording on Solana

A Solana node only says what an account holds now: no endpoint can read one as it was at an earlier
slot. So there is no `block` to pin. The recording is of the moment you record, and the state file
keeps that slot, its time, and the cluster's rent and epochs; a replay runs there.

What is recorded is every account the test's transactions named, as the cluster held it when first
named, and each program's code among them. A Solana transaction must name every account it touches,
so nothing else can be read. `mode`, `state` and `rpcUrl` work as on an EVM chain, and the file never
contains the RPC URL. A replay that names an account the recording does not hold reads it as missing,
and the error that follows says so: record again after changing what the tests read.

The test accounts' keys are the same on every run, so a recording made with them replays with them.
Use them, or fixed keys, as recipients: a key made up afresh in each run was never recorded.

### The Solana chain

| Call                                          | What it does                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `account(i)`                                  | Test account `i` (0–9): `address`, `secretKey` (as `solana-keygen` writes one), and `pot`. |
| `fund(holder, { USDC: "100", SOL: "1" })`     | Adds whole tokens (a string) or base units (a bigint) to `holder`.                         |
| `balanceOf(holder, "USDC")`                   | A balance in base units. A token is a registry symbol, a mint, or `SOL`.                   |
| `run(program, { from, args, accounts })`      | Sends the program as a cook from account `from`'s Pot, as `sauce run` sends it.            |
| `simulate(program, { from, args, accounts })` | The same cook, and everything before it, run and undone.                                   |
| `compile(program)`                            | The program compiled for Solana: bytecode, parameters, return type, the accounts it takes. |
| `getAccount(key)`, `setAccount(key, account)` | Reads or writes any account: lamports, owner, data.                                        |
| `snapshot()`, `revert()`                      | Saves the chain's state, and returns to it. They nest.                                     |
| `increaseTime(seconds)`, `warp(slots)`        | Moves the clock and the slot together, 400 ms a slot.                                      |
| `now()`, `slot()`                             | The time and the slot a program reads (`ctx.timestamp()`, `ctx.blockNumber()`).            |
| `executionFee()`                              | The Kitchen's fee, which every cook's owner pays.                                          |
| `stop()`                                      | Stops the chain, and writes a recording.                                                   |

Each test account starts with 1,000 SOL, and account 0's Pot is created at start; another account's
on its first cook. On a fork the Kitchen's fee is the cluster's, which the owner pays with each cook;
pass `zeroFee: true` to clear it. An empty chain charges none.

### The accounts a program takes

A Solana program names every account it reads or writes. `accounts` gives them by name, in the words
`sauce run --account` takes: `pot`, `owner`, `pot:USDC` (the Pot's USDC account), `@to:USDC` (that of
`main`'s argument `to`), `<address>:USDC`, `mint:USDC`, `program:USDC`, or an address. The accounts
compiling added for you, for `USDC.transfer(to, amount)` or a venue's swap, are worked out on their
own, so `pay.sauce.ts` needs none:

```ts
// function main(tokenProgram: Account, source: Account<Writable>,
//   destination: Account<Writable>, authority: Account<Signer>, mint: Address, amount: Uint256)
await solana.run(new URL("./transfer.sauce.ts", import.meta.url), {
  args: [mint, 1_000_000n],
  accounts: {
    tokenProgram: "program:USDC",
    source: "pot:USDC",
    destination: `${bob}:USDC`,
    authority: "pot",
  },
});
```

A token account the cook names that does not exist yet, such as the recipient's, is created first,
the owner paying its rent, as `sauce run` does. A program too large for one transaction is staged
into a code buffer first, its accounts through a lookup table where they do not fit either, and the
buffer is closed after: `result.staged` and `result.lookupTable` say which happened.

`fund` writes a token's amount into the holder's associated token account, creating it first where
it is missing; the mint's supply stays as it was. Token-2022 mints work the same way.

### What a Solana cook returns

`run` and `simulate` return:

- `returned`: what `main` returned, read as it declares it. Integers are bigints, a key is base58.
- `returnData`: the raw bytes.
- `changes`: every balance the cook changed, as `{ holder, token, mint, amount }`: SOL by account,
  and a token by the owner of the token account that holds it.
- `delta(holder, token)`: how much `holder`'s balance changed. The owner's SOL includes the
  transaction's fee and the Kitchen's.
- `logs`: the transaction's program logs.
- `computeUnits`, and `signature` after `run`.

A cook that fails throws `CookReverted`. Its `reason` is the program's `require` or `throw` message,
the engine's or the Kitchen's refusal by name, another program's in its own words, or the runtime's
error; `data` is the program's revert data, and `logs` the program logs.

### An empty Solana chain

`local({ chain: "solana" })` starts an empty Solana: the engine and the Kitchen, the runtime's own
programs, wrapped SOL, and nothing else. Use it for programs that call nothing; fork Solana for
anything that moves a token or calls a program.

```ts
const solana = await local({ chain: "solana" });
const result = await solana.run(
  { source: "function main(a: Uint256): Uint256 {\n  return a * 2;\n}\n" },
  { args: [21n] },
);
// result.returned === 42n
await solana.stop();
```
