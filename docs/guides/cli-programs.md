# Programs and arguments

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Run a program](cli-run.md)

> A program is a file whose name ends in `.sauce.ts`. Its `main` function is where it starts, and
> `main`'s parameters are its inputs, like the blanks on a form. You fill in the blanks each time
> you run it, with `--args`, so one program serves every run. This page is about writing that file,
> passing it values, and reading what the compiler says when something is wrong.

This page is for you once you have run a program with the `sauce` command
([Quick start](quick-start.md)). To write your first program step by step, follow
[Write your first program](write-your-first-program.md); why SauceScript is a subset of TypeScript
is in [SauceScript](../concepts/saucescript.md).

## A program file

This is the quick start's program, `pay.sauce.ts`:

```js
// Pays `amount` of USDC from your Pot to `to`, and stops if the Pot holds less.
// The same file runs on Base and on Solana.
//
// Try it on a copy of the chain first: no password, no money, nothing sent.
//
//   sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args <recipient> 1000000
//
// Then run it for real: your wallet signs and pays the fee, and your Pot pays the USDC.
//
//   sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
//
// On Solana, the same way, with a Solana wallet:
//
//   sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 --args <recipient> 1000000
//   sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
//
//   to: Address       who gets the USDC, an address on the chain it runs on
//   amount: Uint256   how much, in USDC's smallest unit: USDC has 6 decimals, so 1000000 is 1 USDC
function main(to: Address, amount: Uint256) {
  require(self.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
```

Head every program with a comment like this one: what it does, the command that runs it with
`--args` naming each of `main`'s parameters in order, and one line per parameter with its type,
meaning and units. A reader, or a coding agent, can then run it without reading the code.

The file names no chain. It is compiled for the chain you name with `--chain`, and on that chain:

- `USDC` and the chain's other tokens are names, with no import and no address.
- Protocol contracts are names too: `UniswapV3.Factory`, `AaveV3.Pool`.
- `transfer`, `approve`, `balanceOf` and the other token functions need no import.

So one file compiles for every chain whose names it uses.
[Names and registries](../concepts/names-and-registries.md) explains how a name becomes an address,
and `sauce globals --chain <chain>` lists a chain's names ([Look things up](cli-lookup.md)).
Relative imports are read from beside the file.

A file either declares `function main(...)`, whose parameters are every input it takes, or is a
**script**: statements at the top level, with no inputs. A script's imports come first, and its
top-level `const`s are its own locals, which a function cannot read. Declare `main` to take
inputs, to share a constant with functions, or to return a value.

## Pass it values: `--args`

Every value a program takes from you is a parameter of `main`. Give them after `--args`, in the
order `main` declares them:

```sh
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args 0x2222222222222222222222222222222222222222 1000000
```

| Type                       | Write it as                                                     |
| -------------------------- | --------------------------------------------------------------- |
| `Address`                  | `0x` and 40 hex digits; on Solana, a base58 key                 |
| `Uint256` (also `number`)  | A whole number in the token's smallest units: 1000000 is 1 USDC |
| `bool`                     | `true` or `false`                                               |
| `T[]`, a record `{ a: T }` | JSON, quoted for the shell: `'["0xA…","0xB…"]'`                 |

Each value is checked against its type before anything is compiled or sent, and a wrong one is
named:

```text
sauce compile: --args: argument 1 (to: Address): '0x12' is not an address: 20 bytes of 0x-prefixed hex
```

`--args-json '[…]'` gives them all as one JSON array instead, inline or in a file. A flag after
`--args` is still a flag; put `--` before an argument that starts with `--`.

A value the program fixes for every run, such as a fee, is a `const` beside `main`.

## When it does not compile

Delete `to: Address, ` from `main` in `pay.sauce.ts`, and compile it:

```sh
sauce compile pay.sauce.ts --chain base
```

An error points at your file's line and column, and a `hint:` line says what to add:

```text
sauce compile: pay.sauce.ts does not compile for base
compiling the program failed
…
    ╰╴error: `to` is not a declared variable
        --> pay.sauce.ts:21:17
         |
      21 |   USDC.transfer(to, amount);
         |                 ^^
hint: if to is a value you supply, make it a parameter of main (`to: Uint256`, or `Address`) and pass it with --args
```

A name the chain does not have is refused the same way, naming the chain: a program calling
`Curve.ThreePool` compiles for Ethereum, and for Base says that contract is not deployed there.
[Write your first program](write-your-first-program.md) teaches what the language accepts, and the
[SauceScript reference](../reference/saucescript.md) lists every builtin.

## Choose the chain

`--chain` takes a slug, an alias or a chain id: `base`, `eth`, `8453`, `solana`. Every chain Sauce
knows compiles. The `sauce` command sends only on Ethereum, Base, Arc and Solana; `simulate` runs
wherever the release is deployed on the chain, and stops, naming the missing contract, where it is
not ([Supported and preview chains](cli.md#supported-and-preview-chains)).

`--target evm|svm` is a check against the chain: a program meant for Solana fails fast when
`--chain` names an EVM chain. `--target svm` with no chain means `solana`.

## See what the compiler made: `sauce compile --json`

```sh
sauce compile pay.sauce.ts --chain base --json \
  --args 0x2222222222222222222222222222222222222222 1000000
```

It prints one JSON object. The parts you will read:

- `entryParams`: `main`'s parameters, each with its `name` and `type`, in the order `--args` takes
  them. `entryEncoding` is always `abi-v1`: the encoded arguments are appended to the bytecode.
- `size`, the program's bytes, and `payload`, the size of the program with `main`'s arguments
  appended (`size` and `argumentsSize`). It is `null` until you give `--args` or `--args-json`.
- `defines`: each name the chain gave the program, with its value, its `kind` (a `token` symbol, a
  protocol `contract` such as `UniswapV3_Factory`, the `chain id`) and the `chain` it applied on. A
  value is an address where it is a token or a contract (on Solana a base58 key); any other is the
  integer it is.
- `contracts`: each protocol contract the program calls or reads (`UniswapV3.Factory.getPool(…)`,
  `Cctp.TokenMessenger`), as written and as resolved, with the chain whose deployment it is.
- `returnType`: the type `main` declares it returns, an `interface` spelled out, or `null` when it
  returns nothing. `simulate` reads the cook's return data as that type.
- `compiler` and `engine`: the compiler that compiled it and the engine release it runs on.
- On Solana, `manifest`, the accounts the program takes, and `cook`: the size of the cook's
  transaction against the 1232-byte limit, measured as `sauce run` builds it
  ([Solana](cli-solana.md)).

`sauce inspect` reads a cook's arguments back against the same `main`
([Look things up](cli-lookup.md#read-a-transaction-a-cook-or-a-program-sauce-inspect)).

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

### What the editor project contains

`programs/tsconfig.json` is a TypeScript project of the `*.sauce.ts` files in `programs/` alone,
typed by the package's `@eco-incorp/sauce/sauce-script` declarations:

- the builtins (`ctx`, `abi`, `evm`, `svm`, `crypto`, `require`, `revert`);
- `Token` and the `@sauce/token` functions;
- every chain with its tokens and protocol namespaces, and the protocol contracts'
  `Namespace_Contract` names;
- the ABI a program imports (`import IERC20 from "./artifacts/IERC20.json"`).

The project's other TypeScript is not in it, so a Node file keeps Node's `crypto` and `require`.

Some valid SauceScript is not valid TypeScript. Every SauceScript number is one 256-bit integer, so
`xs[i]` with a `bigint` index, `n + 1` with `n` a `bigint`, and `f(500)` where `f` takes a `bigint`
are all fine. The tsconfig names a TypeScript plugin from the package that drops exactly those
diagnostics, in `*.sauce.ts` files only; a misspelled builtin, a wrong argument count or a method a
contract does not have still shows. An editor loads the plugin only when it runs the project's own
TypeScript, and `init` adds `typescript` to `devDependencies` for it. Without the plugin, those
diagnostics show and nothing else changes: whether a program compiles is the compiler's to say, not
the editor's.

### Add the project to an existing directory

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
[From the command line](actions.md#from-the-command-line-sauce-actions) shows `swap.json` and what
`sauce actions` prints for it.

## Read a program from stdin

Any command that takes a program file, or an actions document, takes `-` for one read from stdin:

```sh
cat pay.sauce.ts | sauce compile - --chain base --args 0x… 1
sauce inspect - --chain base < cook.hex
```

Stdin is read only when the file is `-`, never because a file is missing: a command whose stdin is
held open (an agent's shell, a CI step) would otherwise wait on it forever. `inspect -` reads hex, a
transaction hash or a program, whichever stdin carries, and `inspect --source -` the program.

- **Imports.** A program from stdin has no directory of its own, so its relative imports
  (`import { fee } from "./lib/fee.js"`) resolve against the current directory, or the one
  `--source-dir <dir>` names; a compile error from one says so. The package's own modules (the
  `./artifacts/*.json` and `./protocols/*` ABIs, `@sauce/token`) resolve as they always do.
- **Questions.** Stdin carried the program, so it cannot answer questions too. They go to the
  terminal the command runs in (`/dev/tty`) when there is one, so a program piped in at a terminal
  is still asked about. With no terminal at all (or on Windows, which has no `/dev/tty`) a run
  sends nothing until `--yes` approves what it needs, and a keystore needs `--password-file`.
  Neither ever waits on a stdin that is spent.

## Run a program file as a command

A program file may start with a `#!` line that runs it through `sauce simulate`:

```sh
#!/usr/bin/env -S sauce simulate
```

After `chmod +x pay.sauce.ts`, `./pay.sauce.ts --chain base --owner <address> --args <recipient>
1000000` simulates the cook, exactly as `sauce simulate pay.sauce.ts` with those flags does. Running
the file never spends: sending it is still `sauce run`. The command blanks the line before
compiling, so the program and its error positions are the file's own.

## Next

- Simulate it, run it, and get tokens into your Pot: [Run a program](cli-run.md).
- Call tokens and protocols by name inside a program: [Protocols and tokens](protocols-and-tokens.md).
