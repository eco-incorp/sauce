# Testing programs

**How-to guide** · [Documentation](../README.md) · [Test your first program](test-your-first-program.md) · [Testing kit](../api/testing-kit.md)

> Before you trust a program with money, test it. The testing kit starts a private copy of a chain on
> your computer, gives you test accounts with Pots and tokens, runs your program, and lets you check
> what moved. Nothing real is touched, and a test recorded once replays with no network.

This page is for a developer who has written a first test with the kit, in
[Test your first program](test-your-first-program.md). Each section below gets one task done. The
[testing kit reference](../api/testing-kit.md) lists every call and option the sections use.

`@eco-incorp/sauce/testing` runs your programs from a test as **cooks**, the transactions that run
a program on a **Pot** (see the [glossary](../concepts/glossary.md)). Write the tests with
`node:test`'s `describe` and `it`. The kit's functions are plain async functions, so any runner
works. Give each test and hook a generous timeout, since starting a chain takes seconds:
`node:test` has no default limit, mocha allows 2 seconds, and vitest and jest 5.

## Install the kit

In a project with `"type": "module"`, install the package and viem, and Foundry, which provides
`anvil`:

```sh
npm i -D @eco-incorp/sauce viem
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

`anvil` must be on `PATH`, or pass its path as the `anvil` option. The kit reads no environment
variables: the endpoint, the block and the state file are arguments you pass.

To test on Solana, install LiteSVM too, at the version the package pins (the kit says which, if
yours differs). Solana needs no Foundry:

```sh
npm i -D litesvm@1.6.0
```

## Test a program against a real chain

A program that calls a protocol needs a copy of a chain where the protocol exists. This one sells
USDC from the Pot for WETH on Uniswap V3, `swap.sauce.ts`:

```js
import { uniswapV3 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  require(self.USDC >= amountIn, "amountIn is not in the Pot");
  const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  return uniswapV3(pool, USDC, WETH, amountIn, 0, minOut, recipient);
}
```

And its test, `swap.test.ts`. The endpoint comes from an environment variable your command sets, so
it never lands in the repository:

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
      rpcUrl: process.env.BASE_RPC_URL, // read only while the state file does not exist
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

Record it once, with an endpoint that serves Base's state at block 52,384,000. A block that old
needs an archive node; a public endpoint usually serves only recent blocks:

```sh
BASE_RPC_URL=<your Base endpoint> node --test --test-timeout=120000 swap.test.ts
```

The run writes `test/state/swap-base.json.gz`. Commit it. Every later run replays it with no
endpoint:

```sh
node --test --test-timeout=120000 swap.test.ts
```

## Test a program that calls nothing

A program that calls no protocol and moves no token needs no copy of a real chain. `local()`
starts an empty one, with the Sauce release, test accounts and no Kitchen fee, and it needs no
network:

```ts
import { local } from "@eco-incorp/sauce/testing";

const chain = await local();
const result = await chain.run(
  { source: "function main(a: Uint256): Uint256 {\n  return a * 2;\n}\n" },
  { args: [21n] },
);
// result.returned === 42n
await chain.stop();
```

## Record a test again

A replayed chain knows only what the recording run read. A test that starts reading something new,
such as another token or another pool, reads zeros there. Record again after changing what the
tests do, or after moving the block:

- delete the state file, or pass `mode: "record"` to `fork`;
- run the tests with the endpoint set, as the first time.

The endpoint must serve state at the pinned block. The state file never contains its URL: the kit
refuses to write one that does.

## How recording works

`fork(chain, { block, state, rpcUrl })` starts in one of three modes. With a state file that
exists, it **replays**: `anvil` boots from the file at the pinned block's number and timestamp, and
no endpoint is read. With a state file named that does not exist yet, it **records**: the copy reads
through `rpcUrl` at `block`, and `stop()` writes every account and storage slot the tests read, at
their values in that block. With no state file named, it forks **live** and records nothing.

A replay is the recording run again. The file also keeps the block's gas limit, the EVM hardfork,
the next block's base fee and the test accounts' nonces, so a replayed cook uses the same gas, pays
the same fees and has the same transaction hash. Every block after the pinned one is the chain's
block time later (12 seconds on Ethereum, 2 elsewhere), so nothing depends on the wall clock.

## Fund a token the kit cannot write

`fund` writes a balance into the token's own storage. It cannot do that for a token whose balance
is computed rather than stored, such as a rebasing token or shares. Send such a token to the Pot
from an account that holds it on the chain you forked:

```ts
import { encodeFunctionData, erc20Abi, type Address } from "viem";

const holder: Address = "0x…"; // an account that holds the token at your pinned block
const token: Address = "0x…"; // the token
const amount = 1_000_000n; // in the token's smallest unit

await base.impersonate(holder, (send) =>
  send({
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [base.account(0).pot, amount],
    }),
  }),
);
```

A Base B20 token, such as Coinbase's tokenized stocks, is different: it is a precompile of the Base
node, and `anvil` cannot run its code. `fund` refuses it, and no transfer of it runs on a fork,
impersonated or not. A test that needs a B20 token cannot run on the kit; simulate that program on
Base itself with `sauce simulate` instead.

## Test on Solana

On Solana the kit runs [LiteSVM](https://github.com/LiteSVM/litesvm), Solana's own runtime inside
your test's process: there is no node to start. It holds the same Sauce engine and Kitchen as
Solana itself. When a test first names a real account, such as USDC's mint, the kit copies it from
the cluster and records it; later runs read the file.

This test runs `pay.sauce.ts` from the [quick start](quick-start.md):

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
      rpcUrl: process.env.SOLANA_RPC_URL, // read only while the state file does not exist
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

Record it once with `SOLANA_RPC_URL=<your Solana endpoint>` set, as on Base, and commit the state
file. It starts in well under a second.

Three things differ from an EVM chain:

- **No block to pin.** A Solana node serves accounts only as they are now, so the recording is of
  the moment you record. The file keeps that slot, its time, and the cluster's rent and epochs; a
  replay runs there.
- **Fixed keys.** The test accounts' keys are the same on every run, so a recording made with them
  replays with them. Use them, or fixed keys, as recipients: a key made up afresh in each run was
  never recorded.
- **Accounts by name.** A Solana program names every account it reads or writes. The accounts that
  compiling added for you, for `USDC.transfer(to, amount)` or a venue's swap, are worked out on
  their own, so `pay.sauce.ts` needs none. A program that declares `Account` parameters takes them
  in `accounts`, in the words `sauce run --account` takes:

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

An empty Solana needs no recording: `local({ chain: "solana" })` starts one with the engine, the
Kitchen, the runtime's own programs and wrapped SOL.
[How Sauce runs on Solana](../concepts/solana-model.md) explains accounts and staging.

## Run the tests in CI

A replay needs no endpoint and no secret, so CI runs the committed state files as they are. On
GitHub Actions:

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: foundry-rs/foundry-toolchain@v1
      - run: npm ci
      - run: node --test --test-timeout=120000
```

A state file missing from the commit fails the run with an error naming the file, rather than
reaching a network.

## Next

- Every call, option and result of the kit: the [testing kit reference](../api/testing-kit.md).
- What a cook does and where its results end: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
- The names a test program uses: [tokens](../reference/tokens.md) and
  [chains](../reference/chains.md).
