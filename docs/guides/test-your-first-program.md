# Test your first program

**Tutorial** · [Documentation](../README.md) · [Sauce from TypeScript](typescript-quick-start.md) · [Testing programs](testing.md)

> Before you trust a program with money, test it. You are going to run programs inside ordinary
> Node.js tests, on a private copy of a chain on your computer. Your test accounts get as many
> tokens as you like, nothing real is touched, and a test recorded once runs again with no network.

This is tutorial 6 of 7. It takes about fifteen minutes and costs nothing: no wallet, no key and
no real tokens. It uses three things from earlier tutorials:

- the `sauce-app` project from [Sauce from TypeScript](typescript-quick-start.md), which has the
  package and viem installed;
- `pay.sauce.ts` from the [quick start](quick-start.md), in that project;
- how a program's `main` and `require` work, from
  [Write your first program](write-your-first-program.md).

**You will need:** Node.js 24 or newer, a terminal, and an internet connection for steps 4 and 5.

**You will have:** two test files. One runs a program on an empty chain, offline from the start.
The other runs `pay.sauce.ts` on a copy of Base, recorded once and replayed offline in under a
second.

## 1. Install Foundry

The testing kit runs EVM chains on `anvil`, a local node that comes with Foundry:

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
anvil --version
```

The last line prints anvil's version. Open a new terminal if `anvil` is not found yet.

## 2. Run a test offline

In `sauce-app`, save this program as `double.sauce.ts`:

```js
// Returns twice `a`, and refuses zero.
function main(a: Uint256): Uint256 {
  require(a > 0, "a is zero");
  return a * 2;
}
```

And its test, `double.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CookReverted, local, type TestChain } from "@eco-incorp/sauce/testing";

const DOUBLE = new URL("./double.sauce.ts", import.meta.url);

describe("double.sauce.ts", () => {
  let chain: TestChain;
  before(async () => {
    chain = await local();
  });
  after(() => chain.stop());

  it("returns twice its input", async () => {
    const result = await chain.run(DOUBLE, { args: [21n] });
    assert.equal(result.returned, 42n);
  });

  it("refuses zero", async () => {
    await assert.rejects(
      chain.simulate(DOUBLE, { args: [0n] }),
      (error) => error instanceof CookReverted && error.reason === "a is zero",
    );
  });
});
```

Run it with Node's own test runner, which runs a `.ts` file as it is:

```sh
node --test --test-timeout=120000 double.test.ts
```

```text
▶ double.sauce.ts
  ✔ returns twice its input (58ms)
  ✔ refuses zero (7ms)
✔ double.sauce.ts (352ms)
ℹ pass 2
```

What happened:

- `local()` started an empty chain on your computer with `anvil`. It has Sauce's Kitchen and
  engine, and ten test accounts. Account 0 already has its **Pot**, its own account that runs
  programs; any other account gets its Pot on its first cook. The chain has no tokens and no
  protocols, and it needs no network.
- `chain.run` sent a **cook**, the transaction that runs a program on a Pot, from test account 0.
  `args` are `main`'s arguments in order, and integers are bigints in TypeScript, so `21n`.
  `result.returned` is what `main` returned.
- `chain.simulate` ran the same cook without sending it. The `require` failed, so the cook threw
  `CookReverted`, whose `reason` is the `require`'s message.

`--test-timeout` gives each test and hook two minutes: starting a chain takes a moment, and a
recording run in step 5 reads from the network.

## 3. Test a program that moves tokens

`double.sauce.ts` calls nothing. `pay.sauce.ts` reads and moves USDC, and an empty chain has no
USDC. So its test runs on a copy of Base. Check that `pay.sauce.ts` is in `sauce-app`; it ends with
these lines:

```js
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

## 4. Pin a block

A copy of a real chain starts at a block you choose, so it is the same chain every time. Save this
as `block.ts`, and run it:

```ts
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http() });
console.log((await client.getBlockNumber()).toString());
```

```sh
node block.ts
```

It prints Base's latest block number, such as `52874178`. Write yours down; the test uses it next.

## 5. Record the test

Save this as `pay.test.ts`, with your block number in place of `52_874_178`:

```ts
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { CookReverted, fork, type TestChain } from "@eco-incorp/sauce/testing";
import { base as baseChain } from "viem/chains";

const PAY = new URL("./pay.sauce.ts", import.meta.url);

describe("pay.sauce.ts on Base", () => {
  let base: TestChain;
  before(async () => {
    base = await fork("base", {
      block: 52_874_178,
      state: "test/state/pay-base.json.gz",
      // Read only while the state file does not exist yet.
      rpcUrl: baseChain.rpcUrls.default.http[0],
    });
  });
  after(() => base.stop());
  beforeEach(() => base.snapshot());
  afterEach(() => base.revert());

  it("pays USDC from the Pot", async () => {
    const pot = base.account(0).pot;
    const recipient = base.account(1).address;
    await base.fund(pot, { USDC: "5" });

    const result = await base.run(PAY, { args: [recipient, 1_000_000n] });

    assert.equal(result.delta(recipient, "USDC"), 1_000_000n);
    assert.equal(result.delta(pot, "USDC"), -1_000_000n);
  });

  it("refuses more than the Pot holds", async () => {
    const recipient = base.account(1).address;
    await assert.rejects(
      base.simulate(PAY, { args: [recipient, 1_000_000n] }),
      (error) => error instanceof CookReverted && error.reason === "not enough USDC",
    );
  });
});
```

Run it:

```sh
node --test --test-timeout=120000 pay.test.ts
```

```text
▶ pay.sauce.ts on Base
  ✔ pays USDC from the Pot (665ms)
  ✔ refuses more than the Pot holds (434ms)
✔ pay.sauce.ts on Base (5098ms)
ℹ pass 2
```

This first run takes a few seconds, because it reads Base through Base's public endpoint, which
viem knows as `baseChain.rpcUrls.default.http[0]`. Run it soon after step 4: a public endpoint
serves the state of recent blocks only.

What the test did:

- `fork("base", …)` started a copy of Base at your block. Base's real USDC is there, and so are
  Sauce's Kitchen and engine.
- `base.fund(pot, { USDC: "5" })` gave test account 0's Pot 5 USDC. A string is whole tokens.
- `result.delta(holder, "USDC")` is how much a holder's USDC changed during the cook, in USDC's
  smallest unit: 1,000,000 is 1 USDC.
- `snapshot()` before each test and `revert()` after it put the chain back, so the 5 USDC from the
  first test is gone in the second, and the `require` stops the cook.

When the test finished, `stop()` wrote every account and storage slot the tests read into
`test/state/pay-base.json.gz`:

```sh
ls test/state
```

```text
pay-base.json.gz
```

## 6. Replay it offline

Run the same command again:

```sh
node --test --test-timeout=120000 pay.test.ts
```

It passes in under a second. The state file exists now, so `fork` boots from it and reads no
endpoint. Turn off your network and run it once more: it still passes. Commit
`test/state/pay-base.json.gz` beside the test, and every later run, CI's included, gets the same
result.

Run every test in the project at once with `node --test --test-timeout=120000`.

## What just happened

You ran programs the way your users will, as cooks on a Pot, but on a chain only your tests can
see. An empty chain from `local()` needs nothing; a copy of a real chain from `fork()` is recorded
once and then replays from a file. The test accounts, the funding and the snapshots are all the
kit's, so nothing you do touches a real chain or costs anything.

## Next

- Hand your programs to a coding agent: [Your first agent session](agent-quick-start.md), the last
  tutorial.
- Record again, fund a token the kit cannot write, test on Solana, and run the tests in CI:
  [Testing programs](testing.md).
- Every call of the kit: the [testing kit reference](../api/testing-kit.md).
- What a Pot and a cook are, in full: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
