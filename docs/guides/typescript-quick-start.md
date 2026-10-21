# Sauce from TypeScript

**Tutorial** · [Documentation](../README.md) · [Your first cross-chain intent](first-intent.md) · [Compiling programs](compiling.md)

> Everything the `sauce` command does, your own code can do too. You are going to install Sauce as
> a library in a project, compile a program, build the transaction that runs it and simulate it on
> Base, then build a cross-chain intent and the transactions that post it. Nothing is signed or
> sent.

This is tutorial 6 of 8. It takes about fifteen minutes and costs nothing. It builds on two earlier
tutorials: the [quick start](quick-start.md), whose `pay.sauce.ts` you compile here, and
[your first cross-chain intent](first-intent.md), which explains what an intent is.

**You will need:** Node.js 24 or newer, a terminal, and an internet connection. You need no wallet
and no tokens: the addresses in the code are stand-ins, and nothing is sent.

**You will have:** a project with three scripts. One compiles a program, one simulates its **cook**
(the transaction that runs a program on your **Pot**, your own account on chain) on Base, and one
builds an intent from Ethereum to Base with the transactions that post it.

## 1. Make a project

```sh
mkdir sauce-app
cd sauce-app
npm init -y
npm pkg set type=module
npm install @eco-incorp/sauce viem
```

The package is the compiler, every chain's names and the builders. viem is the library its
functions take addresses and clients in; install it beside the package, in the same project.
`type=module` lets Node run the scripts below as they are: Node 24 runs a `.ts` file directly.

The package ships its examples. Copy the quick start's program into the project:

```sh
cp node_modules/@eco-incorp/sauce/docs/examples/pay.sauce.ts .
```

## 2. Compile a program

Save this as `compile.ts`:

```ts
import { readFileSync } from "node:fs";
import { routes } from "@eco-incorp/sauce";

const source = readFileSync("pay.sauce.ts", "utf8");
const program = routes.compileSauceProgram("base", source);

console.log("main takes:", program.entryParams.map((p) => `${p.name}: ${p.type}`).join(", "));
console.log("bytecode:", program.bytecode.length, "bytes");
```

```sh
node compile.ts
```

```text
main takes: to: Address, amount: Uint256
bytecode: 250 bytes
```

`routes.compileSauceProgram(chain, source)` is what `sauce compile` runs. It compiles the program
for one chain, so `USDC` in the program is Base's USDC. `entryParams` lists what `main` takes, and
`bytecode` is the compiled program: the bytes that run on chain. Your byte count may differ with
the package's version.

## 3. Build and simulate the cook

A cook is one transaction from the Pot's owner to the Pot, carrying the program and `main`'s
arguments. Save this as `cook.ts`:

```ts
import { readFileSync } from "node:fs";
import { destinationExecutionFee, routes, v12PredictPot } from "@eco-incorp/sauce";
import { v12EngineAddress } from "@eco-incorp/sauce/deployments";
import { v12Pot } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, createPublicClient, getAddress, hexToString, http } from "viem";
import { base } from "viem/chains";

// Any addresses work here: nothing is signed or sent.
const owner = getAddress("0x1111111111111111111111111111111111111111");
const recipient = getAddress("0x2222222222222222222222222222222222222222");
const amount = BigInt(process.argv[2] ?? "1000000"); // 1000000 is 1 USDC

// 1. The program, compiled for Base.
const program = routes.compileSauceProgram("base", readFileSync("pay.sauce.ts", "utf8"));

// 2. The owner's Pot, and the call that creates it.
const salt = `0x${"00".repeat(32)}` as const;
const pot = v12PredictPot(owner, salt);
const deploy = routes.sauceEvmDeployPotCall({ owner, salt });

// 3. The cook: the program with main's arguments after it, sent to the Pot.
const args = routes.encodeEntryArguments(program, [recipient, amount]);
const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(args)]);
const data = v12Pot.encodeCook(getAddress(v12EngineAddress()), payload);

// 4. The cook's value is the Kitchen's fee, read from Base.
const client = createPublicClient({ chain: base, transport: http() });
const feeRead = destinationExecutionFee();
const answer = await client.call({ to: feeRead.to, data: feeRead.data });
const fee = feeRead.decode(answer.data ?? "0x");

// 5. Simulate the Pot's deployment and the cook together, on Base as it is now.
const { results } = await client.simulateCalls({
  account: owner,
  calls: [
    { to: deploy.to, data: deploy.data, value: deploy.value },
    { to: pot, data, value: fee },
  ],
});
const cook = results[1]!;
console.log("Pot:", pot);
console.log("Cook:", cook.status, "using", cook.gasUsed.toString(), "gas");
if (cook.status === "failure") console.log("Reason:", hexToString(cook.data));
```

Run it to pay 1 USDC:

```sh
node cook.ts
```

```text
Pot: 0x2032…641b
Cook: failure using 70756 gas
Reason: not enough USDC
```

The owner's Pot holds no USDC, so the program's `require` stopped the cook, and its message came
back as the reason. That is the same answer `sauce simulate` gives. Now ask it to pay nothing:

```sh
node cook.ts 0
```

```text
Pot: 0x2032…641b
Cook: success using 89085 gas
```

Your gas figures may differ. Step by step:

- `v12PredictPot(owner, salt)` works out the owner's Pot address, which is known before the Pot
  exists. The salt is a label, so one owner can have several Pots.
- `routes.sauceEvmDeployPotCall` is the transaction that creates the Pot, through the **Kitchen**,
  the contract that makes Pots. Anyone may send it, once.
- `routes.encodeEntryArguments` encodes `main`'s arguments the way `--args` does, checked against
  the types `main` declares. The program, then its arguments, is the payload.
- `v12Pot.encodeCook` is the cook's calldata: the payload, and the engine that runs it.
  `v12EngineAddress()` is the Sauce release's engine, the same on every chain.
- `destinationExecutionFee()` reads the Kitchen's fee, which every cook pays as its value.
- `client.simulateCalls` is viem's: it runs the deployment, then the cook, on Base as it is now,
  and sends nothing. The Base endpoint is viem's default for the chain; the Sauce package has none
  of its own.

To send it for real, the owner signs and sends `deploy` once, then `{ to: pot, data, value: fee }`
with any wallet library. [Run a program](cli-run.md) does the same from the command line.

## 4. Build an intent

An **intent** is a job posted on one chain for a **solver** to do on another, paid by a reward that
waits where it was posted. The package ships an example that builds one from Ethereum to Base.
Copy it and run it:

```sh
cp node_modules/@eco-incorp/sauce/docs/examples/first-intent.ts intent.ts
node intent.ts
```

```text
Ethereum → Base intent: 0x4eaf…7d32
Prepared source transactions: 2
```

The heart of `intent.ts` is one expression:

```ts
const built = Base(
  () => {
    USDC.transfer(recipient, amount);
  },
  {
    // The route's native amount, which the solver sends with the fill, defaults to this fee.
    execution: { value: executionFee },
    deadline: 2_000_000_000n,
    // Callbacks capture nothing: explicitly supply every external scalar.
    defines: { recipient, amount },
    tokens: [{ token: baseUsdc, amount }],
    // Route assets arrive at the Executor; the Sauce program spends from the Pot.
    precalls: [token.Token.transfer({ token: baseUsdc, to: pot, amount }).toCall()],
  },
).reward({
  source: Ethereum.chain,
  creator: "0x6666666666666666666666666666666666666666",
  deadline: 2_000_003_600n,
  tokens: [{ token: sourceUsdc, amount }],
});
```

Read it from the outside in:

- `Base(...)` is the job, on Base. The arrow function is a Sauce program, not JavaScript: the
  package reads its text and compiles it for Base, so `USDC` means Base's USDC. It never runs as
  JavaScript, so it sees no variable around it; `defines` hands it `recipient` and `amount`.
- `tokens` are what the solver brings to Base, and `precalls` move them into the Pot the program
  spends from. On Base, an intent's program runs on a Pot that every solver's fill shares, not on
  yours.
- `.reward(...)` is the bounty, on Ethereum: 1 USDC, which the **creator** may take back if no
  solver does the job by the deadline.
- `built.hash().intentHash` names the intent, and `built.sourceTxs()` are the transactions that
  post it on Ethereum: a transfer of the reward into the intent's vault, then the Portal's
  `publish`. Those are the two "prepared source transactions".

The deadlines and the creator are stand-ins, and so is the fee: before posting a real intent, read
Base's Kitchen fee with `destinationExecutionFee()`, as `cook.ts` did. Sending `built.sourceTxs()`
in order from the creator's wallet on Ethereum posts the intent:
[submit the source reward](intents.md#submit-the-source-reward) says how, and
`sauce intent publish` does it for you.

## What just happened

You used Sauce as a library. `routes.compileSauceProgram` compiled a program for one chain, as the
command does. A few calls turned it into a cook, the transaction that runs it on a Pot, and viem
simulated that cook on Base. Then `Base(...).reward(...)` built a whole cross-chain intent offline:
the program that runs on Base, the reward on Ethereum, and the transactions that post it.

## Next

- Run your programs in your own tests: [Test your first program](test-your-first-program.md), the
  next tutorial.
- Why a cook, a Pot and the Kitchen fit together: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
- Who does what in an intent, and where the reward waits: [Cross-chain intents](../concepts/cross-chain-intents.md).
- Every option of `Base(...).reward(...)`: [build an intent in TypeScript](intents.md#build-an-intent-in-typescript).
- Every way to compile from TypeScript, arguments included: [Compiling programs](compiling.md).
- Every import of the package, by task: [the API reference](../api/README.md).
