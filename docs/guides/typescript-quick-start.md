# Sauce from TypeScript

**Tutorial** · [Documentation](../README.md) · [Solana quick start](solana-quick-start.md) · [Compiling programs](compiling.md)

> Everything the `sauce` command does, your own code can do too. You are going to install Sauce as
> a library in a project, compile a program, build the transaction that runs it and simulate it on
> Base, then compile the same program for every chain Sauce sends on. Nothing is signed or sent.

This is tutorial 5 of 7. It takes about fifteen minutes and costs nothing. It builds on the
[quick start](quick-start.md), whose `pay.sauce.ts` you compile here.

**You will need:** Node.js 24 or newer, a terminal, and an internet connection. You need no wallet
and no tokens: the addresses in the code are stand-ins, and nothing is sent.

**You will have:** a project with three scripts. One compiles a program, one simulates its **cook**
(the transaction that runs a program on your **Pot**, your own account on chain) on Base, and one
compiles the same program for Base, Ethereum and Solana.

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
bytecode: 223 bytes
```

`routes.compileSauceProgram(chain, source)` is what `sauce compile` runs. It compiles the program
for one chain, so `USDC` in the program is Base's USDC. `entryParams` lists what `main` takes, and
`bytecode` is the compiled program: the bytes that run on chain. Your byte count may differ with
the package's version.

## 3. Build and simulate the cook

A cook is one transaction from the Pot's owner to the Pot, carrying the program and `main`'s
arguments. This live step requires the release pinned by your SDK to be deployed and active on
Base: the engine and Router must have code, and the Kitchen must predict the same Pot as the SDK.
The checks below refuse an incomplete rollout rather than treating a call to an empty address as
a successful cook. Deterministic [release addresses](../reference/deployments.md) alone do not
prove those prerequisites. For an offline run with the full released pair deployed locally, use
the [testing kit](testing.md).

Save this as `cook.ts`:

```ts
import { readFileSync } from "node:fs";
import { kitchenExecutionFee, routes, v12PredictPot } from "@eco-incorp/sauce";
import {
  v12EngineAddress,
  v12KitchenAddress,
  v12RouterAddress,
} from "@eco-incorp/sauce/deployments";
import { v12KitchenAbi, v12Pot } from "@eco-incorp/sauce/evm/engine";
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
const engine = getAddress(v12EngineAddress());
const router = getAddress(v12RouterAddress());
const [engineCode, routerCode] = await Promise.all([
  client.getCode({ address: engine }),
  client.getCode({ address: router }),
]);
const unavailable =
  "The release pinned by this SDK is not active on Base; its deployment must be completed before this live example can run.";
if (!engineCode || engineCode === "0x" || !routerCode || routerCode === "0x") {
  throw new Error(unavailable);
}
const kitchenPot = await client.readContract({
  address: getAddress(v12KitchenAddress()),
  abi: v12KitchenAbi,
  functionName: "predictPot",
  args: [owner, salt],
});
if (kitchenPot.toLowerCase() !== pot.toLowerCase()) throw new Error(unavailable);
const feeRead = kitchenExecutionFee();
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

After the deployment checks pass, run it to simulate paying 1 USDC. With an unfunded Pot, expect a
failure such as the illustration below; the gas used depends on the active release and chain state:

```sh
node cook.ts
```

```text
Pot: 0x6c91…D3Fe
Cook: failure using <gas used> gas
Reason: not enough USDC
```

In that unfunded-Pot case, the program's `require` stops the cook and returns its message as the
reason, just as `sauce simulate` does. Once the same deployment checks pass, ask it to pay nothing:

```sh
node cook.ts 0
```

```text
Pot: 0x6c91…D3Fe
Cook: success using <gas used> gas
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
- `kitchenExecutionFee()` reads the Kitchen's fee, which every cook pays as its value.
- `client.simulateCalls` is viem's: it runs the deployment, then the cook, on Base as it is now,
  and sends nothing. The Base endpoint is viem's default for the chain; the Sauce package has none
  of its own.

To send it for real, the owner signs and sends `deploy` once, then `{ to: pot, data, value: fee }`
with any wallet library. [Run a program](cli-run.md) does the same from the command line.

## 4. Compile for every chain

A program names no chain: `USDC` is a name, and compiling for a chain turns it into that chain's
USDC. Save this as `chains.ts`:

```ts
import { readFileSync } from "node:fs";
import { routes } from "@eco-incorp/sauce";

const source = readFileSync("pay.sauce.ts", "utf8");

for (const chain of ["base", "ethereum", "solana"] as const) {
  const program = routes.compileSauceProgram(chain, source);
  const inputs = program.entryParams.map((p) => `${p.name}: ${p.type}`).join(", ");
  console.log(`${chain}: ${program.bytecode.length} bytes, main takes ${inputs}`);
}
```

```sh
node chains.ts
```

```text
base: 223 bytes, main takes to: Address, amount: Uint256
ethereum: 223 bytes, main takes to: Address, amount: Uint256
solana: 695 bytes, main takes to: Address, amount: Uint256
```

One file, three programs. On Base and Ethereum `USDC` is each chain's own USDC contract. On Solana
the program is larger: it also checks the token accounts the payment moves between, the ones the
[Solana quick start](solana-quick-start.md#3-see-the-accounts-sauce-found) listed. `main` takes the
same inputs everywhere, so the same `--args` run it on any of the three.
[Solana from TypeScript](solana-from-typescript.md) builds and sends that Solana cook.

## What just happened

You used Sauce as a library. `routes.compileSauceProgram` compiled a program for one chain, as the
command does. A few calls turned it into a cook, the transaction that runs it on a Pot, and viem
simulated that cook on Base. Then the same file compiled for Base, Ethereum and Solana, each name
resolved on its own chain.

## Next

- Run your programs in your own tests: [Test your first program](test-your-first-program.md), the
  next tutorial.
- Why a cook, a Pot and the Kitchen fit together: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
- Every way to compile from TypeScript, arguments included: [Compiling programs](compiling.md).
- Every import of the package, by task: [the API reference](../api/README.md).
