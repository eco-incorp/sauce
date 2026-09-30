# The sauce command

[Documentation](../README.md) · [Compiling programs](compiling.md) · [Create an intent](intents.md)

`@eco-incorp/sauce` installs a `sauce` command. It compiles a program file exactly as the SDK
compiles a route body, and prints the transactions that run it on an EVM chain. It signs and sends
nothing — [`cast`](https://getfoundry.sh/cast/overview) or any wallet sends what it prints — and it
reaches no network unless you pass `--rpc-url`.

| Command                | What it does                                                            |
| ---------------------- | ----------------------------------------------------------------------- |
| `sauce compile`        | Compile a program file; print its bytecode                              |
| `sauce tx`             | Print the transaction that runs a program on a Pot, and its `cast send` |
| `sauce pot`            | Predict a Pot's address and print the transaction that deploys it       |
| `sauce init`           | Scaffold a project that uses this package                               |
| `sauce skills install` | Install this package's Claude Code agent skills into a project          |

Every command takes `--help`. A mistyped invocation exits 2; a program that does not compile, or a
chain that disagrees, exits 1.

## Install

```sh
npm install @eco-incorp/sauce
npx sauce --help
```

Node.js 24 or newer. To start a new project instead, let the command scaffold it:

```sh
npx @eco-incorp/sauce init my-app
cd my-app
npm install
```

`sauce init` writes a `package.json` that pins `@eco-incorp/sauce` to exactly the version that ran
it, a `CLAUDE.md` pointing an agent at the installed skills, a `.gitignore` that keeps local
configuration out of git, and `sauce.config.example.json`. That file holds placeholders only; copy
it to `sauce.config.json` (ignored) for your RPC URLs, and pass them to the command as `--rpc-url`.
The command itself never reads a configuration file or the environment. `init` refuses to overwrite
a file that already has other content, and lists it, unless you pass `--force`. It runs no package
manager unless you pass `--install`, which runs `npm install`.

## Agent skills

```sh
npx sauce skills install            # into ./.claude/skills/
npx sauce skills install --check    # exit 1 unless the installed copies match this version
```

The package ships Claude Code agent skills: `SKILL.md` files, with their examples, that teach an
agent to use it. `skills install` copies them to `.claude/skills/<name>/` and records what it wrote
in `.claude/skills/.sauce-skills.json`. After you upgrade the package, run it again: it replaces the
copies it wrote, but refuses a file somebody edited, listing it, unless you pass `--force`. Skills of
your own in the same directory are never touched. `--check` is for CI, to notice an upgrade the
skills have not followed.

These are separate from the per-protocol documents the `/skills` export loads.

## Compile

```sh
npx sauce compile pay.sauce.ts --chain base --define RECIPIENT=0x6666666666666666666666666666666666666666
```

The file is compiled as a route body is: the chain's token symbols (`USDC`), protocol namespaces
(`Uniswap.UniversalRouter`), `chainId`, the `@sauce/token` functions (`transfer(token, to, amount)`
and the rest, with no import), the token syntax (`USDC.transfer(...)`, `Token(address).approve(...)`,
both SafeERC20) and [intents opened inside the program](intents.md#create-an-intent-from-inside-a-program)
all resolve against the chain. [Protocols and tokens](protocols-and-tokens.md) lists the names. The
file is plain JavaScript syntax, without type annotations; a bare body is wrapped in `main()`, and a
file that imports another declares `main()` itself. Relative imports are read from beside the file.

It prints the bytecode as `0x` hex; `--out <path>` writes it to a file instead. `--json` prints:

| Field              | Meaning                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `bytecode`, `size` | The program, and its length in bytes                                                       |
| `chain`, `chainId` | The chain it was compiled for                                                              |
| `target`           | `evm` or `svm`, which the chain decides                                                    |
| `compiler`         | The installed compiler package and version                                                 |
| `engine`           | The released engine it pairs with: its release, version, commit, and address or program id |
| `manifest`         | Solana only: the accounts to attach, in order                                              |

### Values the program takes

A program takes values as module-level constants, which a define replaces:

```js
const RECIPIENT = 0n;
const AMOUNT = 0n;

function main() {
  require(RECIPIENT != 0n);
  USDC.transfer(RECIPIENT, AMOUNT);
}
```

Pass `--define NAME=VALUE`, repeated, or `--defines values.json`, one JSON object of name to value;
`--define` wins over the file. A value is one 256-bit word: an integer in decimal or `0x` hex, an
address (which is its integer), `true` or `false`. In the JSON file, a number must be a safe integer;
write anything larger as a string.

### Choosing the chain

`--chain` takes a slug, an alias or a chain id: `base`, `eth`, `8453`. A file can carry its own,
in the `//` comment lines it starts with; a flag overrides it:

```js
// @chain base
// Pays RECIPIENT from the Pot.
USDC.transfer(RECIPIENT, AMOUNT);
```

`--target evm|svm` (or a `// @target` line) is a check against the chain. `--target svm` with no
chain means `solana`.

### Intents the program opens

A program that opens an intent — `Arbitrum(() => { … }).reward({ … })` — needs what the SDK cannot
look up: `--intent-deadline <unix seconds>` and `--intent-creator <address>`, and, when the intent's
body compiles to a program of its own, `--intent-execution-fee <wei>`, the destination Kitchen's fee.
The command names whichever is missing.

### When it does not compile

Errors point at your file's line and column, including on a line the SDK rewrote before compiling
it, and a `hint:` line names the flag or define to add:

```text
sauce compile: pay.sauce.ts does not compile for base
…
    ╰╴error: `RECIPIENT` is not a declared variable
       --> pay.sauce.ts:2:15
        |
      2 | USDC.transfer(RECIPIENT, AMOUNT);
        |               ^^^^^^^^^
hint: if RECIPIENT is a value you supply, pass --define RECIPIENT=<value>
```

## Build the transaction

```sh
npx sauce tx pay.sauce.ts --chain base --owner 0xYourAddress --rpc-url <RPC_URL>
```

A program runs as a **Pot**: a contract you own that holds what the program spends and calls
`cook(engine, program)` on the released engine. `sauce tx` prints that call:

```text
to     0x…          the Pot
data   0x…          cook(engine, program)
value  1000         the Kitchen's execution fee, plus any native the program spends

cast send 0x… 0x… --value 1000 --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>

Pot 0x… belongs to 0xYourAddress (salt 0x00…00).
It is deployed. Fund it with what the program spends.
Send from 0xYourAddress: cook() is onlyOwner.
```

Name the Pot with `--pot <address>`, or give its owner with `--owner` (and `--salt`, default zero)
to derive it. Give the value with `--value <wei>`, or pass `--rpc-url` to read the Kitchen's current
fee. With `--rpc-url` the command also checks that the endpoint serves the chain you named, whether
the Pot is deployed, and who owns it. A `--value` below the fee is refused, since the cook would
revert. `--json` prints the same as one object. The `cast send` line leaves the endpoint and the
signer to you: fill in `<RPC_URL>`, and prefer a keystore (`--account <name>`) or a hardware wallet
(`--ledger`) to `--private-key`.

A program that opens intents is still one cook on your Pot: the Pot publishes and funds each intent,
so it must hold the reward. Building an intent for a solver to fulfill — `Base(...).reward(...)` and
the source-chain Portal transactions — is the API's job; see [Create an intent](intents.md).

## Deploy a Pot

```sh
npx sauce pot --owner 0xYourAddress --chain base
```

A Pot's address is CREATE2 from the Kitchen over its owner and a salt, so it is known before it
exists. `sauce pot` prints it and the `Kitchen.deployPot(owner, salt)` transaction. Any account may
send that; the Pot is the owner's either way, and it deploys once.

## Run it with cast

What has to exist on the chain first:

- the released Sauce Kitchen and engine, at the addresses `@eco-incorp/sauce/deployments` records;
- a Pot you own — deployed, and funded with the tokens and native the program spends;
- the account that sends the cook is the Pot's owner.

Try it on a local fork of the chain first, where the released contracts already are:

```sh
anvil --fork-url <RPC_URL>
```

anvil prints dev accounts and their keys; they exist only on the fork. Then, against it:

```sh
# 1. Deploy your Pot: run the `cast send` line this prints, from any dev account.
npx sauce pot --owner <OWNER> --chain base

# 2. Fund it — here with USDC from a holder, impersonated on the fork.
cast rpc anvil_impersonateAccount <HOLDER> --rpc-url http://127.0.0.1:8545
cast send <USDC> "transfer(address,uint256)" <POT> 1000000 --from <HOLDER> --unlocked \
  --rpc-url http://127.0.0.1:8545

# 3. Build the cook, then run the `cast send` line this prints, from the owner.
npx sauce tx pay.sauce.ts --chain base --owner <OWNER> --define RECIPIENT=<RECIPIENT> \
  --define AMOUNT=1000000 --rpc-url http://127.0.0.1:8545
```

Fill each printed line's `<RPC_URL>` with `http://127.0.0.1:8545` and `<PRIVATE_KEY>` with a dev
key. On a live chain the steps are the same, with your endpoint and your own signer.

## Solana

`sauce compile --chain solana` compiles and reports the account manifest in `--json`. There is no
`sauce tx` for Solana: stage and execute the program through the Kitchen as
[the Solana guide](solana.md) describes.
