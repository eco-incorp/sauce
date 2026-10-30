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

A cook runs on an already deployed Pot using its verified persisted release binding.
This Base example needs a trusted `pot-binding.json`, deployment completed separately, and the
exact compiler paired with that service's engine. Missing or mismatched code stops the example;
a predicted address or nonempty engine code is not authentication.
See [Kitchen compatibility](kitchen-compatibility.md) before creating a new service.

Save this as `cook.ts`:

```ts
import { readFileSync } from "node:fs";
import { kitchenExecutionFee, routes } from "@eco-incorp/sauce";
import { v12ReleaseSet } from "@eco-incorp/sauce/deployments";
import { verifyPotBinding, v12Pot, type EvmPotBindingInput } from "@eco-incorp/sauce/evm/engine";
import { bytesToHex, concatHex, createPublicClient, hexToString, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http() });
const input: EvmPotBindingInput = JSON.parse(
  readFileSync(process.argv[3] ?? "pot-binding.json", "utf8"),
);
const binding = await verifyPotBinding(client, input);
if (binding.chainId !== base.id || binding.compiler !== v12ReleaseSet().compiler) {
  throw new Error("Use this service's exact Base compiler/engine pair");
}
const amount = BigInt(process.argv[2] ?? "1000000");
const program = routes.compileSauceProgram("base", readFileSync("pay.sauce.ts", "utf8"));
const args = routes.encodeEntryArguments(program, [binding.owner, amount]);
const payload = concatHex([bytesToHex(program.bytecode), bytesToHex(args)]);
const data = v12Pot.encodeCook(binding.engine, payload, binding.compiler);
const feeRead = kitchenExecutionFee(binding.kitchen);
const answer = await client.call({ to: feeRead.to, data: feeRead.data });
const fee = feeRead.decode(answer.data ?? "0x");
const { results } = await client.simulateCalls({
  account: binding.owner,
  calls: [{ to: binding.pot, data, value: fee }],
});
const cook = results[0]!;
console.log("Pot:", binding.pot);
console.log("Cook:", cook.status, "using", cook.gasUsed.toString(), "gas");
if (cook.status === "failure") console.log("Reason:", hexToString(cook.data));
```

This example verifies the supplied deployed binding and only simulates the cook; it signs and sends
nothing. With an unfunded Pot, expect a failure such as the illustration below.

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

- `verifyPotBinding` checks the actual deployed Pot against trusted explicit release provenance.
  It does not deploy missing code, change a salt or select a replacement engine.
- `routes.encodeEntryArguments` encodes `main`'s arguments the way `--args` does, checked against
  the types `main` declares. The program, then its arguments, is the payload.
- `v12Pot.encodeCook` binds the payload to the verified engine and explicit compiler selection.
- `kitchenExecutionFee()` reads the Kitchen's fee, which every cook pays as its value.
- `client.simulateCalls` runs the cook on Base as it is now and sends nothing. Its endpoint is
  viem's default for the chain; the Sauce package has none of its own.

Before sending for real, retain the verified service binding and review the transaction.
The owner signs `{ to: binding.pot, data, value: fee }`; no new deployment is part of that cook.

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
