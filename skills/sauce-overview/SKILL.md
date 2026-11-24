---
name: sauce-overview
description: Start here for any Sauce task, before any other Sauce skill. What Sauce is (SauceScript programs, .sauce.ts files, run atomically inside one transaction on EVM chains and Solana), the Pot, the cook, the Kitchen and the engine, the protocol for working with a user (write the program yourself, ask where its results end, show the program, its arguments and its simulation before anything is sent, report the links after), the rules every program keeps, which chains take transactions and how to request another, the path from a file to a transaction, and the skill map that names the one skill owning each topic. Use when the user mentions Sauce, SauceScript, a .sauce.ts file, @eco-incorp/sauce, the sauce command, a Pot, Kitchen, cook or engine, or asks to do something atomically on chain, and whenever it is unclear which Sauce skill covers a topic.
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
| Choosing a chain: a testnet or mainnet           | [Which chain](#which-chain)                                                 |
| Syntax, names, flags, addresses, a protocol, ... | Not here: each has an owner in the map                                      |

## Core model

| Term    | What it is                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program | A `.sauce.ts` file. It names no chain: it is compiled for one (`--chain`), which decides what every name in it means, into bytecode. Its inputs are `main`'s parameters.                                                                                                                                                                                                                           |
| Pot     | The owner's account on chain, a small contract the Kitchen creates. It holds what a program spends, and every call a program makes comes from it. Every cook needs its owner's authorization. Its address is known before it exists, for the selected Kitchen release, owner and salt (zero unless `--salt` names another). It has no withdraw function: what it holds leaves only through a cook. |
| Cook    | The transaction that runs a program: normally the owner calls `cook(engine, program)`, with `main`'s arguments appended and the Kitchen's fee as value. New EVM Pots also accept an owner-signed `cookSigned` submitted by another account. An uncaught failure reverts the whole cook, fee included.                                                                                              |
| Kitchen | Creates Pots (anyone may deploy an owner's Pot; it is the owner's whoever sends it), sets the flat fee every cook pays in the native coin, and the Router new Pots start on. It cannot change an existing Pot or move what it holds.                                                                                                                                                               |
| Engine  | The interpreter that runs the bytecode as the Pot. On an EVM chain it runs only inside a Pot the Kitchen created; the `sauce` command names the released one.                                                                                                                                                                                                                                      |

A program has control flow, reads and checks, and the engine runs it as written:
it is not a multicall, and it does not use a magic header. On Solana the Kitchen and the engine are
programs, the Pot is an account at the Kitchen's program address for the owner and salt, owned by
the engine, and a cook is the Kitchen's `cook` instruction signed by the owner (`sauce-solana`).

A cook runs on one chain, in one transaction; a program that moves tokens to another chain calls a
bridge protocol (`sauce-protocols`).

## The protocol with a user

1. **Write the program yourself**, in SauceScript, for the task as asked. The skills teach the
   language, the names and the patterns; their examples show idioms and are not templates. Never
   ask the user which example or existing file to begin with.
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
3. **Every check is in the program.** An uncaught failed `require` reverts the transaction. On EVM,
   an atomic `try` rolls back its own work and may recover; catch only failures the user intends to tolerate.
4. **No endpoint, key or password in a program or a committed file.** The package reads no
   environment variable but the one a `--password-env` flag names (`sauce-cli`).
5. **Every address comes from the registry or the user**, never invented: write the name
   (`sauce-globals`), or take the address as a `main` parameter.
6. **Every program opens with its header**: what it does, the command that runs it, each `main`
   parameter with its units, one real run (`sauce-script` owns the format).
7. **Transactions go to supported chains only** (below).

## Supported and preview chains

Transactions are built and sent on **Ethereum, Base, Arc and Solana** (`ethereum`, `base`, `arc`,
`solana`), and on the testnets **Arc Testnet, Base Sepolia, Ethereum Sepolia, Solana Devnet and
Solana Testnet** (`arc-testnet`, `base-sepolia`, `sepolia`, `solana-devnet`, `solana-testnet`),
whose coin and tokens have no value, only. Every other chain the SDK knows is a **preview chain**:
a program compiles for it and reads work there, and a simulation runs wherever the release is
deployed on the chain, but
the `sauce` command and the MCP server build and send no transaction on it. The refusal comes
before any key or endpoint is read, names the
supported chains, and links that chain's request; no flag lifts it. Each chain's file in
`sauce-chains` says which it is, and `sauce-cli` lists which commands are refused. On Arc and Arc
Testnet the native coin is USDC: gas, a cook's value and the Kitchen's fee are paid in it (its file
in `sauce-chains` has the details).

When a command refuses a chain, tell the user and offer the request, never another way to send:
add the use case to that chain's request among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support),
or [open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the
chain and its id, what runs there, the protocols and tokens it needs, and the expected volume and
timing. The refusal carries both links, prefilled for its chain.

## Which chain

- **Use the chain the user names.** With none named, ask. A testnet is the place to prototype:
  its coin and tokens have no value.
- **What a testnet has.** Arc Testnet, Base Sepolia and Ethereum Sepolia each have `USDC`, CCTP
  (`Cctp.TokenMessenger`) and Circle Gateway (`CircleGateway.GatewayWallet`,
  `CircleGateway.GatewayMinter`); Arc Testnet has `EURC` too. None of them has a DEX, a lending
  market or an oracle. A program that moves USDC, bridges it or deposits it into Gateway runs on
  a testnet as it would on mainnet.
- **A swap, a pool or a lending market needs mainnet.** Compile it for `arc` (or `base`,
  `ethereum`) and simulate it there with `sauce simulate`, which signs and sends nothing: on Arc
  Testnet its names do not exist, and compiling fails (`sauce-chains`). One file serves both
  chains when every name it uses exists on both and every pool, market id or other address is a
  `main` parameter.
- **An assumed balance is an assumption.** `sauce simulate --assume-balance` gives the Pot that
  balance for the simulation only. A passing simulation then shows the program works if the Pot
  holds it, not that the user does: say so whenever you report one, with the lines under
  `Assumed for this simulation only`.
- **Arc's USDC has two scales, one balance.** The ERC-20 `USDC` has 6 decimals (`pot.USDC`, every
  token amount in `--args`); the native coin has 18 (`pot.balance`, a cook's value, gas). The
  Kitchen's fee is the cook's value, paid from the owner's wallet; a native fee the program itself
  pays (a bridge's or a messenger's) comes out of the Pot's one balance. Give amounts at the two
  scales as separate arguments, and spend a given amount or a measured delta, never `pot.USDC`
  whole. A transaction for Arc or Arc Testnet needs a `maxFeePerGas` of at least 20 gwei
  (`sauce-cli`).

## From a file to a transaction

A program names what its chain supplies, with no import: token symbols such as `USDC`, protocol
namespaces such as `UniswapV3.Factory`, and the language's builtins such as `ctx`. The smallest
complete program:

```sauce chain=base,ethereum
function main(recipient: Address, floor: Uint256) {
  const held = pot.USDC;
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
  with the Pot's deployment first while it has no code, each transaction and the batch beside them
  (`sendCalls`) what a wallet's MCP server takes as they are; `sauce send` broadcasts what a signer
  signed. A wallet's MCP
  server (Coinbase Wallet MCP on Base and Ethereum, Phantom MCP on Solana) is the safer signer; the
  command's own wallets are for experiments and development.
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

| Layer   | Skills                                                           | The question it answers                                 |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Start   | `sauce-overview`                                                 | What is Sauce, how do I work with the user, what next?  |
| Write   | `sauce-script`, `sauce-globals`, `sauce-chains`, `sauce-actions` | How do I write the program, and what can it name where? |
| Build   | `sauce-protocols`, `sauce-swaps`                                 | How does a program call a protocol, or swap?            |
| Compose | `sauce-distributed-swap`, `sauce-solana-distributed-swap`        | How do I build a limit order across several pools?      |
| Target  | `sauce-solana`                                                   | What changes on Solana?                                 |
| Run     | `sauce-cli`, `sauce-typescript`                                  | How do I compile, simulate, send and read back?         |
| Index   | `sauce-examples`                                                 | Where is a complete program for this idiom?             |

### `sauce-overview`

- **Owns**: the model, the protocol with a user, the rules, supported and preview chains, which
  chain to use (a testnet or mainnet), this map.
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
  and family aliases, a name a chain may lack (zero there, tested with `if (X)`), chain names, the
  imports the package serves.
- **Holds**: generated indexes of every token, stock, protocol contract and chain name.
- **Load**: to find a name, check it exists, or fix "is not a declared variable". Not for its
  address (`sauce-chains`).

### `sauce-chains`

- **Owns**: what each chain makes of the names. One file compiled for several chains, a name a
  chain lacks, another chain's names, `chainId` against `ctx.chainId()`, each chain's facts, and
  the Sauce deployment.
- **Holds**: a generated file per chain (support, ids, native coin, tokens with addresses, every
  protocol deployment) and `references/deployments.json`, the release's addresses.
- **Load**: for an address, what one chain offers, or one program for several chains.

### `sauce-actions`

- **Owns**: a program written as a JSON actions document: actions, names, pools by key, chaining
  amounts, running it.
- **Holds**: [references/actions.md](../sauce-actions/references/actions.md), every action and
  field, generated from the schema.
- **Load**: when the steps are fixed, or produced as data by a service. A condition, a loop or a
  best venue needs SauceScript.

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
  rules, `priceLimit`, `minTokens` and `maxAvgPrice`, setting the price, simulating it, and the
  complete program for EVM chains.
- **Load**: when an order should take the best of several pools or stop at a price, on an EVM
  chain.

### `sauce-solana-distributed-swap`

- **Owns**: the same order on Solana: a program for one request, its pools found by key
  (`Orca.Whirlpool.pool(USDC, WSOL, spacing)`) in loops over the keys, each swapped at its venue,
  choosing the keys with `sauce pools`, what fits in one cook, running it.
- **Load**: for a split or limit order on Solana, with `sauce-solana`.

### `sauce-solana`

- **Owns**: everything Solana changes: accounts and their roles, the accounts compiling derives,
  `--account` names, the Pot's key, token accounts, `@sauce/token` for SPL Token and Token-2022,
  transaction size, and running (through the Kitchen or the engine, simulating in a local copy,
  plans of several transactions, rent left open).
- **Load**: for any program compiled for Solana, beside the skill for its task.

### `sauce-cli`

- **Owns**: the `sauce` command: getting it, endpoints, signers, signing through a wallet's MCP
  server, wallets and their policies, the run in order (look up, compile, simulate, Pot, fund, run,
  check), unsigned transactions and `sauce send`, signed cooks another account sends
  (`sauce sign`), arguments to `main`, and each command's MCP tool.
- **Load**: to compile, simulate, send or read back, or when a command refuses.

### `sauce-typescript`

- **Owns**: the package from application code: compiling for a chain, encoding arguments, the Pot
  and its cook, signed cooks, the raw compiler, the registry, actions, verification, Solana, testing.
- **Load**: when code, not a person at a terminal, builds the transactions.

### `sauce-examples`

- **Owns**: the cookbook of complete programs for common tasks, and the index of every example in
  every skill with the chains it is checked on.
- **Load**: to see a complete program for an idiom, then write the program the task needs.

## Routes by need

| You need                                                | Load, in order                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| A token's symbol, or whether a name exists on a chain   | `sauce-globals`                                                    |
| An address, or what a chain offers                      | `sauce-chains`                                                     |
| A program that does not compile                         | `sauce-script` (Compile errors) → `sauce-globals` → `sauce-chains` |
| A protocol call (lend, stake, bridge)                   | `sauce-protocols` → `sauce-script` (Calling a contract)            |
| One swap, or swap then use the output                   | `sauce-swaps` → `sauce-protocols` for the next step                |
| Buy up to a price across pools (EVM)                    | `sauce-globals` → `sauce-distributed-swap` → `sauce-cli`           |
| Buy up to a price across pools (Solana)                 | `sauce-solana` → `sauce-solana-distributed-swap` → `sauce-cli`     |
| Move a token or a tokenized stock on Solana             | `sauce-globals` (Tokenized stocks) → `sauce-solana` → `sauce-cli`  |
| Steps that arrive as JSON from a service                | `sauce-actions` → `sauce-cli`                                      |
| A cook the owner signs for another account to send      | `sauce-cli` (`sauce sign`), or `sauce-typescript` from code        |
| Compile, simulate, send, read back; a wallet; a refusal | `sauce-cli`                                                        |
| Sign through the user's wallet MCP server               | `sauce-cli` (Signing through a wallet's MCP server)                |
| The same from Node or a browser                         | `sauce-typescript`, with `sauce-script` for the program            |

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
  `pot`, leaves its output in the Pot; ask where results end first.
- **Sending before the user has seen the program, its arguments and the simulation.** Never.
- **Fetching the explorer or trace link.** Give both to the user; report what the command printed.
- **Working around a preview-chain refusal.** Offer the chain-support request instead.
- **Inventing an address.** Write the registry's name, or take the address from the user.

## Files

This skill has no examples of its own; `sauce-examples` indexes every one.
[../sauce-distributed-swap/examples/distributed-swap.sauce.ts](../sauce-distributed-swap/examples/distributed-swap.sauce.ts)
is one complete program that keeps every rule above: it buys a token across several venues' pools
up to one price, names everything through the chain's names and `@sauce/router`, checks the amount
bought and its average price, refunds the unspent budget, and opens with its header.
