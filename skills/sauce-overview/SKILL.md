---
name: sauce-overview
description: Start here for any Sauce task, before any other Sauce skill. What Sauce is (SauceScript programs, .sauce.ts files, run atomically inside one transaction on EVM chains and Solana), the Pot, the cook, the Kitchen and the engine, the protocol for working with a user (write the program yourself, ask where its results end, show the program, its arguments and its simulation before anything is sent, report the links after), the rules every program keeps, which chains take transactions (Ethereum, Base and Solana; the rest are preview chains) and how to request another, the path from a file to a transaction, and the skill map that names the one skill owning each topic. Use when the user mentions Sauce, SauceScript, a .sauce.ts file, @eco-incorp/sauce, the sauce command, a Pot, Kitchen, cook or engine, Eco intents, or asks to do something atomically on chain, and whenever it is unclear which Sauce skill covers a topic.
---

# Sauce

Sauce runs a program written in **SauceScript**, a checked subset of TypeScript in a `.sauce.ts`
file, atomically inside one transaction, on EVM chains and on Solana. This skill owns the model, the
protocol for working with a user, the rules every program keeps, which chains take transactions,
and the map of the other skills. Every other fact has one owner in the map: load it there.

## When to use

| Situation                                        | Do                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Any Sauce task                                   | Read this skill first, then the skill [The skill map](#the-skill-map) names |
| Unsure which skill owns a topic                  | [Routes by need](#routes-by-need)                                           |
| A command refuses a chain                        | [Supported and preview chains](#supported-and-preview-chains)               |
| Syntax, names, flags, addresses, a protocol, ... | Not here: each has an owner in the map                                      |

## Core model

| Term              | What it is                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program           | A `.sauce.ts` file. It names no chain: it is compiled for one (`--chain`), which decides what every name in it means, into bytecode. Its inputs are `main`'s parameters.                                                                                                                                                                                                  |
| Pot               | The owner's account on chain, a small contract the Kitchen creates. It holds what a program spends, and every call a program makes comes from it. Only its owner cooks on it. Its address follows from the owner and a salt (zero unless `--salt` names another), so it is known before it exists. It has no withdraw function: what it holds leaves only through a cook. |
| Cook              | The one transaction that runs a program: the owner calls the Pot's `cook(engine, program)`, `main`'s arguments appended to the program, the Kitchen's fee as its value. Every step lands or none does: a failed `require` reverts the whole cook, the fee with it.                                                                                                        |
| Kitchen           | Creates Pots (anyone may deploy an owner's Pot; it is the owner's whoever sends it), sets the flat fee every cook pays in the native coin, and the Router new Pots start on. It cannot change an existing Pot or move what it holds.                                                                                                                                      |
| Engine            | The interpreter that runs the bytecode as the Pot. On an EVM chain it runs only inside a Pot the Kitchen created; the `sauce` command names the released one.                                                                                                                                                                                                             |
| Intent            | An offer: run this on another chain, and the reward escrowed here is yours. A solver decides whether to fill it (`sauce-intents`).                                                                                                                                                                                                                                        |
| Shared intent Pot | The one Pot per destination chain that every intent's program body cooks on, driven by solvers. A leftover there belongs to the next intent (`sauce-intents`).                                                                                                                                                                                                            |

A program has control flow, reads and checks, and the engine runs it as written:
it is not a multicall, and it does not use a magic header. On Solana the Kitchen and the engine are
programs, the Pot is the Kitchen's account for the owner and salt, and a cook is the Kitchen's
`cook` instruction signed by the owner (`sauce-solana`).

## The protocol with a user

1. **Write the program yourself**, in SauceScript, for the task as asked. The skills teach the
   language, the names and the patterns; their examples show idioms and are not templates. Never
   ask the user which example or existing file to begin with. The one exception is the Solana
   distributed swap, whose program is used whole (`sauce-solana-distributed-swap`).
2. **Ask only what the request leaves open**: an amount, a price limit, a recipient, the chain, and
   **where the results end**. Before writing a program that produces assets (a swap's output, a
   lending market's aTokens, a vault's shares, what a bridge delivers), ask whether they should end
   in the user's wallet or stay in the Pot, and say the difference in one line: what stays in the
   Pot is theirs, but only another cook moves it out, and their wallet does not show it. Decide the
   rest yourself.
3. **Simulate** with `sauce simulate` before anything is sent: it signs nothing and sends nothing.
4. **Show, then send.** Before sending, or handing over `sauce tx`'s unsigned JSON, show the user:
   - the final program, as it will be compiled;
   - each argument, with its meaning and units (`1000000` is 1 USDC);
   - what the simulation says will happen: what leaves the wallet, what arrives where, and what is
     left in the Pot (the lines under `Left in the Pot`, or `leftInPot` in JSON; none when it
     leaves nothing).

   Send only once the user agrees.

5. **Report what was sent.** Every command that sends prints the transaction's hash, its explorer
   page and its trace (calls and balance changes). Give the user both links to open in a browser;
   never fetch or read them yourself. Report what the command printed from the receipt: what left
   the wallet, what arrived where, what stayed in the Pot.

## Rules every program keeps

1. **Nothing is left behind by surprise.** Measure outputs as balance deltas, deliver them where
   the user chose, return unspent input, and approve exactly what the next call spends.
2. **A swap leg never strands input.** Exact input, a minimum output it `require`s, and what a
   price limit leaves unspent returned (`sauce-swaps`).
3. **Every check is in the program.** A failed `require` reverts the whole transaction; that
   atomicity is the safety mechanism.
4. **An intent is an offer.** Say it is offered, never that it will execute.
5. **No endpoint, key or password in a program or a committed file.** The package reads no
   environment variable but the one a `--password-env` flag names (`sauce-cli`).
6. **Every address comes from the registry or the user**, never invented: write the name
   (`sauce-globals`), or take the address as a `main` parameter.
7. **Every program opens with its header**: what it does, the command that runs it, each `main`
   parameter with its units, one real run (`sauce-script` owns the format).
8. **Transactions go to supported chains only** (below).

## Supported and preview chains

Transactions are built and sent on **Ethereum, Base and Solana** (`ethereum`, `base`, `solana`)
only. Every other chain the SDK knows is a **preview chain**: a program compiles for it, and
simulations, dry runs and reads work there, but the `sauce` command and the MCP server build and
send no transaction on it. The refusal comes before any key or endpoint is read, names the
supported chains, and links that chain's request; no flag lifts it. An intent publishes only when
its source and every destination it opens are supported; a cascade's later levels are not checked,
so keep every level on a supported chain. Each chain's file in `sauce-chains` says which it is, and
`sauce-cli` lists which commands are refused.

When a command refuses a chain, tell the user and offer the request, never another way to send:
add the use case to that chain's request among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support),
or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the
chain and its id, what runs there, the protocols and tokens it needs, and the expected volume and
timing. The refusal carries both links, prefilled for its chain.

## From a file to a transaction

A program names what its chain supplies, with no import: token symbols such as `USDC`, protocol
namespaces such as `UniswapV3.Factory`, and the language's builtins such as `ctx`. The smallest
complete program:

```sauce chain=base,ethereum
function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self());
  require(held >= floor, "not enough USDC in the Pot");
  USDC.transfer(recipient, held);
}
```

Compiled with `--chain base`, `USDC` is Base's; with `--chain ethereum`, Ethereum's. Saved as
`payout.sauce.ts`, the whole path is five commands:

```sh
sauce globals --chain base                     # the names a program on Base can use
sauce compile payout.sauce.ts --chain base     # the bytecode, or the compile error
sauce simulate payout.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1 --args <recipient> 1000000
sauce tx payout.sauce.ts --chain base --owner <address> --args <recipient> 1000000
sauce run payout.sauce.ts --chain base --keystore <keystore> --args <recipient> 1000000
```

- `sauce tx` prints the cook unsigned, `{ chainId, to, data, value }`, for any wallet or signer,
  with the Pot's deployment first while it has no code; `sauce send` broadcasts what that signer
  signed.
- `sauce run` signs and sends it itself, deploying the Pot first when it is missing (it asks, or
  `--yes`).
- The command, its install, its flags and its units (`--args` in base units, `--assume-balance` in
  whole tokens) are `sauce-cli`'s; the same steps as MCP tools of `sauce mcp` are there too.

## The skill map

Each skill is a `SKILL.md` to read whole, with the same shape: When to use, Core model, the body,
Pitfalls, Files. `references/` are looked up, not read through (the generated ones list every
chain, token and protocol); `examples/` hold programs (`.sauce.ts`), actions documents (`.json`) and
runners (`.mts`) that pin what the skill says. Each topic has exactly one owner; a skill points at
the owner rather than repeat it.

| Layer   | Skills                                                                     | The question it answers                                     |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Start   | `sauce-overview`                                                           | What is Sauce, how do I work with the user, what next?      |
| Write   | `sauce-script`, `sauce-globals`, `sauce-chains`, `sauce-actions`           | How do I write the program, and what can it name where?     |
| Build   | `sauce-protocols`, `sauce-swaps`                                           | How does a program call a protocol, or swap?                |
| Compose | `sauce-distributed-swap`, `sauce-solana-distributed-swap`, `sauce-intents` | How do I build a limit order, or continue on another chain? |
| Target  | `sauce-solana`                                                             | What changes on Solana?                                     |
| Run     | `sauce-cli`, `sauce-typescript`                                            | How do I compile, simulate, send and read back?             |
| Index   | `sauce-examples`                                                           | Where is a complete program for this idiom?                 |

### `sauce-overview`

- **Owns**: the model, the protocol with a user, the rules, supported and preview chains, this map.
- **Load**: first, for any Sauce task.

### `sauce-script`

- **Owns**: the language. The two program forms, the header, inputs and constants, values, the
  three ways to call a contract, who receives a call's output, helpers, what compiles and what to
  write instead, failure and `.catch`, gas, the editor, compile errors.
- **Holds**: [references/builtins.md](../sauce-script/references/builtins.md), every type,
  operator, statement and builtin with its targets, an example and the error a misuse gives.
- **Load**: to write or fix any program. Not for which names a chain has (`sauce-globals`).

### `sauce-globals`

- **Owns**: the names a program uses with no import. Token symbols and their methods (SafeERC20),
  `Token(address)`, the `@sauce/token` functions, tokenized stocks, protocol namespaces, interfaces
  and family aliases, `available(...)`, chain names, the imports the package serves.
- **Holds**: generated indexes of every token, stock, protocol contract and chain name.
- **Load**: to find a name, check it exists, or fix "is not a declared variable". Not for its
  address (`sauce-chains`).

### `sauce-chains`

- **Owns**: what each chain makes of the names. One file compiled for several chains, a name a
  chain lacks, another chain's names, `chainId` against `ctx.chainId()`, each chain's facts, and
  the Sauce deployment.
- **Holds**: a generated file per chain (support, ids, native coin, intents, tokens with addresses,
  every protocol deployment) and `references/deployments.json`, the release's addresses.
- **Load**: for an address, what one chain offers, or one program for several chains.

### `sauce-actions`

- **Owns**: a program written as a JSON actions document: actions, names, pools by key, chaining
  amounts, running it.
- **Holds**: [references/actions.md](../sauce-actions/references/actions.md), every action and
  field, generated from the schema.
- **Load**: when the steps are fixed, or produced as data by a service. A condition, a loop, a best
  venue or an intent needs SauceScript.

### `sauce-protocols`

- **Owns**: choosing and calling a protocol: the index by category with "Choosing between them",
  a registry file and a document of pitfalls per protocol.
- **Load**: before calling a protocol, or to pick one. Not for a swap (`sauce-swaps`).

### `sauce-swaps`

- **Owns**: `@sauce/router`, the swap library, on both targets: one function per venue, the `try`
  forms, which venues are paid first and which call back through the Pot's Router, price limits
  and `sauce price`, partial fills, reverts, the guard every leg needs; on Solana, each venue's
  namespace and its function forms.
- **Load**: for one swap, or a swap as one step of a program.

### `sauce-distributed-swap`

- **Owns**: one exact-input order over several price-limited pools under one maximum price: the
  rules, `maxPrice`, `minTokens` and `maxAvgPrice`, setting the price, simulating it, and the
  complete program for EVM chains.
- **Load**: when an order should take the best of several pools or stop at a price, on an EVM
  chain.

### `sauce-solana-distributed-swap`

- **Owns**: the same order on Solana: pools as `main`'s `Address` arguments found with
  `sauce pools`, each swapped with `Solana.swap` at whichever venue owns it, the program used whole,
  what fits in one cook, running it.
- **Load**: for a split or limit order on Solana, with `sauce-solana`.

### `sauce-intents`

- **Owns**: work continued on another chain: the intent file, the lifecycle (publish, fund, fill,
  prove, claim, refund, cancel, each a `sauce intent` command), bodies, on which chain each name
  resolves, cascades, the destination side, simulating both sides.
- **Load**: whenever the work crosses chains.

### `sauce-solana`

- **Owns**: everything Solana changes: accounts and their roles, the accounts compiling derives,
  `--account` names, the Pot's key, token accounts, `@sauce/token` for SPL Token and Token-2022,
  transaction size, and running (through the Kitchen or the engine, simulating in a local copy,
  plans of several transactions, rent left open).
- **Load**: for any program compiled for Solana, beside the skill for its task.

### `sauce-cli`

- **Owns**: the `sauce` command: getting it, endpoints, signers, wallets and their policies, the
  run in order (look up, compile, simulate, Pot, fund, run, check), unsigned transactions and
  `sauce send`, arguments to `main`, and each command's MCP tool.
- **Load**: to compile, simulate, send or read back, or when a command refuses.

### `sauce-typescript`

- **Owns**: the package from application code: compiling for a chain, encoding arguments, the Pot
  and its cook, the raw compiler, the registry, actions, verification, Solana, intents, testing.
- **Load**: when code, not a person at a terminal, builds the transactions.

### `sauce-examples`

- **Owns**: the cookbook of complete programs for common tasks, and the index of every example in
  every skill with the chains it is checked on.
- **Load**: to see a complete program for an idiom, then write the program the task needs.

## Routes by need

| You need                                                | Load, in order                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| A token's symbol, or whether a name exists on a chain   | `sauce-globals`                                                           |
| An address, or what a chain offers                      | `sauce-chains`                                                            |
| A program that does not compile                         | `sauce-script` (Compile errors) → `sauce-globals` → `sauce-chains`        |
| A protocol call (lend, stake, bridge)                   | `sauce-protocols` → `sauce-script` (Calling a contract)                   |
| One swap, or swap then use the output                   | `sauce-swaps` → `sauce-protocols` for the next step                       |
| Buy up to a price across pools (EVM)                    | `sauce-globals` → `sauce-distributed-swap` → `sauce-cli`                  |
| Buy up to a price across pools (Solana)                 | `sauce-solana` → `sauce-solana-distributed-swap` → `sauce-cli`            |
| Move a token or a tokenized stock on Solana             | `sauce-globals` (Tokenized stocks) → `sauce-solana` → `sauce-cli`         |
| Work on another chain                                   | `sauce-intents` → `sauce-chains` (both chains take intents) → `sauce-cli` |
| Steps that arrive as JSON from a service                | `sauce-actions` → `sauce-cli`                                             |
| Compile, simulate, send, read back; a wallet; a refusal | `sauce-cli`                                                               |
| The same from Node or a browser                         | `sauce-typescript`, with `sauce-script` for the program                   |

## Reading the skills over MCP

An agent with no skill files reads the same files from the Sauce MCP server (`sauce mcp`):

- `sauce_skills` lists every skill with its description and files.
- `sauce_skill` returns a skill's `SKILL.md`; with `path`, one of its files
  (`references/builtins.md` of `sauce-script`); with `section`, only the part under the heading
  holding those words; with `query`, only the lines holding a term. Read a large reference that
  way: `references/base.md` of `sauce-chains` with `section` set to Tokens, or
  `references/stocks.md` of `sauce-globals` with `query` set to a company's name.
- The same files are resources, `sauce://skills/<skill>/SKILL.md` and
  `sauce://skills/<skill>/<path>`, listed at `sauce://skills/index`.
- `sauce_dev` returns the package's own documents on a topic, for TypeScript work with
  `sauce-typescript`; `sauce_install_skills` says how to put the skills in a project.

## Pitfalls

- **Asking which example to begin with.** Write the program the task needs.
- **Leaving outputs in the Pot without asking.** A call that credits its caller, or names
  `ctx.self()`, leaves its output in the Pot; ask where results end first.
- **Sending before the user has seen the program, its arguments and the simulation.** Never.
- **Fetching the explorer or trace link.** Give both to the user; report what the command printed.
- **Working around a preview-chain refusal.** Offer the chain-support request instead.
- **Promising an intent will be filled.** It is offered.
- **Inventing an address.** Write the registry's name, or take the address from the user.

## Files

This skill has no examples of its own; `sauce-examples` indexes every one.
[../sauce-distributed-swap/examples/distributed-swap.sauce.ts](../sauce-distributed-swap/examples/distributed-swap.sauce.ts)
is one complete program that keeps every rule above: it buys a token across several venues' pools
up to one price, names everything through the chain's names and `@sauce/router`, checks the amount
bought and its average price, refunds the unspent budget, and opens with its header.
