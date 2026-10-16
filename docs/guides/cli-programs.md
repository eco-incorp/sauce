# Programs and arguments

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Run a program](cli-run.md)

> A program is a file whose name ends in `.sauce.ts`. Its `main` function is where it starts, and
> `main`'s parameters are its inputs, like the blanks on a form. You fill in the blanks each time
> you run it, with `--args`, so one program serves every run. This page is about writing that file,
> passing it values, and reading what the compiler says when something is wrong.

## A program file

```js
// Pays each recipient `amount` of a token, and the same in USDC when `alsoUsdc` is true.
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
```

The file is compiled for the chain you name with `--chain`. On that chain:

- `USDC` and the chain's other tokens are names, with no import and no address.
- Protocol contracts are names too: `UniswapV3.Factory`, `AaveV3.Pool`.
- `transfer`, `approve`, `balanceOf` and the other token functions need no import.
- An intent the program opens to another chain resolves its names there
  ([your first cross-chain intent](first-intent.md)).

So one file compiles for every chain whose names it uses. `sauce globals --chain <chain>` lists the
names ([Look things up](cli-lookup.md)). Relative imports are read from beside the file.

A file either declares `function main(...)`, whose parameters are every input it takes, or is a
**script**: statements at the top level, with no inputs. A script's imports come first, and its
top-level `const`s are its own locals, which a function cannot read. Declare `main` to take
inputs, to share a constant with functions, or to return a value.

## Pass it values: `--args`

Every value a program takes from you is a parameter of `main`. Give them after `--args`, in order:

```sh
sauce run split.sauce.ts --chain base --wallet me \
  --args 0xToken '["0xA…","0xB…"]' 1000000 true
```

- An `Address` is `0x` and 40 hex digits (on Solana, a base58 key).
- A `Uint256` is a whole number in the token's smallest units: 1000000 is 1 USDC.
- A `bool` is `true` or `false`.
- An array or a record is JSON.

Each value is checked against its type before anything is sent, and a wrong one is named:

```text
argument 1 (token: Address): '0x12' is not an address: 20 bytes of 0x-prefixed hex
```

`--args-json '[…]'` gives them all as one JSON array instead, inline or in a file. A flag after
`--args` is still a flag; put `--` before an argument that starts with `--`.

A value the program fixes for every run, such as a fee, is a `const` beside `main`.

## When it does not compile

```sh
sauce compile pay.sauce.ts --chain base
```

An error points at your file's line and column, and a `hint:` line says what to add:

```text
sauce compile: pay.sauce.ts does not compile for base
…
    ╰╴error: `recipient` is not a declared variable
       --> pay.sauce.ts:3:17
        |
      3 |   USDC.transfer(recipient, amount);
        |                 ^^^^^^^^^
hint: if recipient is a value you supply, make it a parameter of main (`recipient: Uint256`, or `Address`) and pass it with --args
```

[Writing SauceScript](../concepts/saucescript.md) says what the language accepts, and the
[SauceScript reference](../reference/saucescript.md) lists every builtin.

## In an editor

An editor checks a `.sauce.ts` file as TypeScript, which does not know SauceScript's names. Give it
a TypeScript project that does:

```sh
sauce init programs --tsconfig
```

This writes `programs/tsconfig.json`, which types every `*.sauce.ts` file under `programs/` as
SauceScript: the builtins, every chain's tokens and protocols, and the ABIs a program imports. A
project made with `sauce init` has one already. In VS Code, also pick "TypeScript: Select TypeScript
Version", then "Use Workspace Version", so the editor loads the package's plugin (below).

## A JSON actions document instead

An [actions document](actions.md) is JSON: a list of steps, each one protocol operation. Sauce turns
it into a program, and the program commands take it wherever they take a `.sauce.ts` file:

```sh
sauce actions swap.json --chain base            # print the program it becomes
sauce simulate swap.json --chain base --wallet me --assume-balance USDC:1000 --args 1000000000
sauce run swap.json --chain base --wallet me --args 1000000000
```

Its tokens are symbols (`"USDC"`) and its contracts names (`"UniswapV3.Factory"`), so a document
with no `chainId` compiles for every chain where those names exist. Its `argument` actions are
`main`'s parameters, given after `--args` in the order it declares them.

## Details

### Choosing the chain

`--chain` takes a slug, an alias or a chain id: `base`, `eth`, `8453`, `solana`. A file can also name
its own, in the `//` comment lines it starts with; a flag overrides it:

```js
// @chain base
// Pays `recipient` `amount` of Base's USDC from the Pot.
function main(recipient: Address, amount: Uint256) {
  USDC.transfer(recipient, amount);
}
```

`--target evm|svm` (or a `// @target` line) is a check against the chain. `--target svm` with no
chain means `solana`.

The file is compiled as a standalone program (`routes.compileSauceProgram`, the compile half of
`routes.compileSauceRoute`, with the chain's names `openRoute` gives a route body). The token
syntax (`USDC.transfer(...)`, `Token(address).approve(...)`) has OpenZeppelin `SafeERC20`
semantics. It reaches the compiler as written: imports, helper functions, `interface` declarations
and annotations included.

### Arguments in detail

`sauce compile --json` reports `main`'s parameters (`entryParams`, `entryEncoding`, and
`entrySchema` under `--compact-args`). Each value is checked against its declared type before
anything is sent: `Address`, `Uint256` (also `number`, `bigint`), `bool`, `bytes`, `string`, `T[]`
and `{ field: T }`. They are encoded ABI-v1 by default, compact-v1 under `--compact-args`, and
appended to the program: the SDK's `routes.encodeEntryArguments`, whose inverse
`routes.decodeEntryArguments` is what `sauce inspect` reads them back with.

An intent file takes its inputs the same way, and `sauce intent publish` fixes them into the
intents it publishes ([Intents](cli-intents.md)).

### What `sauce compile --json` reports

- `defines`: each name compiling for the chain gave the program, its value, its `kind` (a `token`
  symbol, a protocol `contract` such as `UniswapV3_Factory`, the `chain id`) and the `chain` it
  applied on. An intent body the file opens reads its own chain's names, so its `USDC` is listed
  again with that chain.
- `contracts`: each protocol contract the program calls or reads (`UniswapV3.Factory.getPool(…)`,
  `Cctp.TokenMessenger`), as written and as resolved, with the chain whose deployment it is. An
  intent body's resolves on the intent's own chain.
- `size`, the program's bytes, and `payload`, the program with `main`'s arguments appended, given
  with `--args` or `--args-json` (`null` until they are).
- `returnType`: the type `main` declares it returns, an `interface` spelled out (`null` when it
  returns nothing), which `simulate` reads the cook's return data as.
- A value is an address where it is a token or a contract (on Solana a base58 key); any other is
  the integer it is, whatever its size.
- On Solana, `manifest`, the accounts the program takes, and `cook`: the size of the cook's
  transaction against the 1232-byte limit, measured as `sauce run` builds it ([Solana](cli-solana.md)).

### A program from stdin

Any command that takes a program file, or an actions document, takes `-` for one read from stdin:

```sh
cat pay.sauce.ts | sauce compile - --chain base --args 0x… 1
sauce inspect - --chain base < cook.hex
```

Stdin is read only when the file is `-`, never because a file is missing: a command whose stdin is
held open (an agent's shell, a CI step) would otherwise wait on it forever. `inspect -` reads hex, a
transaction hash or a program, whichever stdin carries, and `inspect --source -` the program.

A program from stdin has no directory of its own, so its relative imports
(`import { fee } from "./lib/fee.js"`) resolve against the current directory, or the one
`--source-dir <dir>` names; a compile error from one says so. The package's own modules (the
`./artifacts/*.json` and `./protocols/*` ABIs, `@sauce/token`) resolve as they always do.

Stdin carried the program, so it cannot answer questions too. They go to the terminal the command
runs in (`/dev/tty`) when there is one, so a program piped in at a terminal is still asked about.
With no terminal at all (or on Windows, which has no `/dev/tty`) a run sends nothing until `--yes`
approves what it needs, and a keystore needs `--password-file`. Neither ever waits on a stdin that
is spent.

### A program file as a command

A program file may start with a `#!` line that runs it through `sauce simulate`:

```sh
#!/usr/bin/env -S sauce simulate
```

After `chmod +x pay.sauce.ts`, `./pay.sauce.ts --chain base --owner <address> --args <recipient>
1000000` simulates the cook, exactly as `sauce simulate pay.sauce.ts` with those flags does. Running
the file never spends: sending it is still `sauce run`. The command blanks the line before
compiling, so the program and its error positions are the file's own.

### The editor project in detail

`programs/tsconfig.json` is a TypeScript project of the `*.sauce.ts` files in `programs/` alone,
typed by the package's `@eco-incorp/sauce/sauce-script` declarations: the builtins (`ctx`, `abi`,
`evm`, `svm`, `crypto`, `require`, `revert`), `Token` and the `@sauce/token` functions, every chain
with its tokens and protocol namespaces, the protocol contracts' `Namespace_Contract` names, and the
ABI a program imports (`import IERC20 from "./artifacts/IERC20.json"`). The project's other
TypeScript is not in it, so a Node file keeps Node's `crypto` and `require`.

Some valid SauceScript is not valid TypeScript: every SauceScript number is one 256-bit integer, so
`xs[i]` with a `bigint` index, `n + 1` with `n` a `bigint`, and `f(500)` where `f` takes a `bigint`
are all fine. The tsconfig names a TypeScript plugin from the package that drops exactly those
diagnostics, in `*.sauce.ts` files only; a misspelled builtin, a wrong argument count or a method a
contract does not have still shows. An editor loads the plugin only when it runs the project's own
TypeScript, and `init` adds `typescript` to `devDependencies` for it. Without the plugin, those
diagnostics show and nothing else changes: whether a program compiles is the compiler's to say, not
the editor's.

`sauce init <dir> --tsconfig` writes the project as `<dir>/tsconfig.json` and nothing else (it
never replaces a different file without `--force`). An editor takes a file's nearest
`tsconfig.json`, so every `*.sauce.ts` under `<dir>` is typed as SauceScript. Where the project's
own `tsconfig.json` also covers those files, add `"exclude": ["**/*.sauce.ts"]` to it, so its
TypeScript leaves them to their own project. The file it writes is this, `<package>` being
`@eco-incorp/sauce`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection": "force",
    "types": ["@eco-incorp/sauce/sauce-script"],
    "strict": true,
    "noImplicitAny": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": false,
    "skipLibCheck": true,
    "plugins": [{ "name": "@eco-incorp/sauce/sdk/dist/sauce-script/ts-plugin.cjs" }]
  },
  "include": ["**/*.sauce.ts"]
}
```

A contract ABI beside a program is typed by its default import, `import IOracle from
"./IOracle.json"`, as a contract whose methods the editor does not check; the compile checks them
against the ABI.

`sauce skills install` and `sauce skills update` write the same file as `tsconfig.json` in each
skills directory, so the skills' example programs open typed as well. Its declarations, like the
plugin, come from the project's own copy of the package: in a project that does not depend on
`@eco-incorp/sauce`, the editor reports that it cannot find `@eco-incorp/sauce/sauce-script`, and
the programs show what they would with no `tsconfig.json` at all.

### Actions documents in detail

`sauce actions <file>` lowers a document for a chain and prints the SauceScript, `main`'s
parameters and the bytecode. `--chain` defaults to the document's `chainId`; a document without one
needs it, and one with a `chainId` compiles for that chain only. A swap may name its pool by its
factory's key. `--json` prints what `sauce compile --json` does, with the parsed `document`, the
`source`, the ABI bindings it calls through (`bindings`) and the argument names (`parameters`);
`contracts` is still the protocol contracts it calls, as `compile` reports them. `--compact-args`
compiles the arguments compact-v1. A name the chain lacks is refused with its path, the chain and
the name:

```text
sauce actions: swap.json does not compile for avalanche:
  actions[1].tokenIn: no token "USDC" on Avalanche C-Chain (chain 43114), which registers no token symbols — give its address there instead
```

`compile`, `tx`, `simulate` and `run` take an actions document with the same flags, and its cook
runs on the Pot `--owner` or `--pot` names, funded with `--fund` if you like.
