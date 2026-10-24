# Glossary

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Kitchen, Pot and cook](kitchen-pot-cook.md)

> Sauce has a few words of its own, mostly borrowed from a kitchen. Each one stands for something
> you probably know already. This page puts the two side by side, so you can read every other page
> with the word you know in mind.

This page is for any reader, at any point. The words are grouped by topic, in the order you meet
them: the first group is all the [quick start](../guides/quick-start.md) needs. Each group links the
page that explains its words. To find one word, look it up in the index below: it names the group
the word is in.

## Index

The groups: [First words](#first-words), [Chain words](#chain-words), [Writing programs](#writing-programs), [Running programs](#running-programs), [Swaps](#swaps), [Solana](#solana), [Coding agents](#coding-agents).

- **A**: ABI (Chain words) · Account (Solana) · Account manifest (Solana) · Actions (Writing programs) · Address (Chain words) · Agent skills (Coding agents) · Allowance (Chain words)
- **B**: Builtin (Writing programs) · Bytecode (Chain words)
- **C**: Compile (Writing programs) · Compute units (Solana) · Cook (First words) · CPI (Solana)
- **D**: Decimals (Chain words) · Defines (Writing programs) · Derived account (Solana)
- **E**: Engine (First words) · EVM chain (Chain words) · Explorer (Chain words)
- **G**: Gas (Chain words)
- **K**: Kitchen (First words) · Kitchen fee (Running programs)
- **L**: Lamports (Solana) · Lookup table (Solana) · Lowering (Writing programs)
- **M**: `main`'s arguments (Writing programs) · MCP server (Coding agents) · Minimum output (Swaps)
- **N**: Namespace (Writing programs) · Native coin (Chain words) · `NotOwner()` (Running programs)
- **O**: Owner (First words)
- **P**: PDA (Solana) · Policy (Running programs) · Pool (Swaps) · Pot (First words) · `pot` (Writing programs) · Preview chain (Running programs) · Price limit (Swaps) · Private Pot (Running programs) · Program (First words) · Program header (Writing programs)
- **R**: Registry (Writing programs) · Rent (Solana) · `require` (Writing programs) · Revert (Chain words) · Router (Running programs) · RPC endpoint (Chain words)
- **S**: SafeERC20 (Chain words) · Salt (Running programs) · `@sauce/router` (Writing programs) · `@sauce/token` (Writing programs) · SauceScript (First words) · Script (Writing programs) · Settle program (Running programs) · Shared Pot (Running programs) · Simulate (First words) · Slippage (Swaps) · Staging (Solana) · stdio (Coding agents) · Supported chain (Running programs) · SVM (Chain words)
- **T**: Target (Writing programs) · Tick (Swaps) · Token account (Solana) · Token symbol (Writing programs) · Token-2022 (Solana)
- **U**: Unsigned transaction (Running programs)
- **V**: Venue (Swaps)
- **W**: Wallet (Running programs)

## First words

Read these before anything else. [What Sauce is](what-is-sauce.md) puts them together, and
[Kitchen, Pot and cook](kitchen-pot-cook.md) explains the three kitchen words in full.

| Sauce says      | Think of it as                              | What it is                                                                                                                                                                                                    |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Program**     | A script                                    | A short `.sauce.ts` file whose `main` function says what to do on chain: read a balance, swap, pay.                                                                                                           |
| **SauceScript** | A small, strict TypeScript                  | The language programs are written in. It looks like TypeScript, and the compiler checks it before anything runs.                                                                                              |
| **Pot**         | Your own smart account                      | Your account on chain, which belongs to your wallet: a small contract on Ethereum, Base and Arc, an account on Solana. It holds the tokens your programs spend, and every call a program makes comes from it. |
| **Owner**       | The wallet that controls the Pot            | The fixed address whose authorization a private Pot requires for every cook: as sender, or through a signed cook on new EVM Pots.                                                                             |
| **Cook**        | The transaction that runs a program         | One transaction running a program on a Pot. A private Pot requires its owner's authorization. Every step happens, or none does.                                                                               |
| **Kitchen**     | The factory contract                        | The contract that makes Pots and charges a small flat fee, in the chain's own coin, for each cook.                                                                                                            |
| **Engine**      | An interpreter, like a tiny virtual machine | The on-chain code that reads a compiled program and carries it out, inside your Pot. You never call it yourself.                                                                                              |
| **Simulate**    | A dry run                                   | `sauce simulate` runs your program on a copy of the chain as it is right now. It needs no key and no money, and changes nothing.                                                                              |

A program is a recipe, your Pot is your own counter on the blockchain, a cook is one go at the
recipe, and the Kitchen is the shop that builds counters and charges for each go. An uncaught failure
undoes the cook; on EVM a failed atomic `try` undoes its own work and runs its handler instead.

## Chain words

Sauce uses these words as every chain does. [Costs](costs.md) says what gas, fees and rent come to.

| Sauce says       | Think of it as             | What it is                                                                                                                                                 |
| ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ABI**          | A function signature list  | A contract's interface: its functions, their arguments and what they return. A program calls a contract through its ABI.                                   |
| **Address**      | An account number          | Where an account or a contract lives: `0x` and 40 hex digits on an EVM chain, a base58 key on Solana. A program's `Address` type holds one.                |
| **Allowance**    | A spending permission      | What one address lets another spend of its token, set by an approval (`USDC.approve(spender, amount)`). It outlives the transaction that sets it.          |
| **Bytecode**     | A compiled binary          | The compact code the compiler makes from a program, which only a Sauce engine runs. `sauce compile` prints it as hex.                                      |
| **Decimals**     | Cents in a dollar          | How many digits of a token's amount come after the point. Amounts are whole numbers of the smallest unit: USDC has 6 decimals, so 1000000 is 1 USDC.       |
| **EVM chain**    | Ethereum and its relatives | A chain that runs Ethereum's virtual machine: Ethereum, Base and most chains Sauce knows. A program for one compiles for the `evm` target.                 |
| **Explorer**     | A receipt lookup           | A website, such as Basescan or Solscan, that shows a transaction by its hash.                                                                              |
| **Gas**          | Postage                    | What an EVM chain charges to run a transaction, paid in its native coin by the wallet that sends it.                                                       |
| **Native coin**  | The house currency         | The coin a chain charges its fees in: ETH on Ethereum and Base, USDC on Arc, SOL on Solana.                                                                |
| **Revert**       | Undo                       | What a failed transaction does: nothing it did stays, and only its gas is spent.                                                                           |
| **RPC endpoint** | A server's URL             | The address of a node that answers questions about a chain and takes its transactions. The `sauce` command has public ones built in.                       |
| **SafeERC20**    | Careful token calls        | OpenZeppelin's rules for calling a token, which every Sauce token write follows: a token that returns nothing works, and one that returns `false` reverts. |
| **SVM**          | Solana's machine           | How Solana runs programs. A program for Solana compiles for the `svm` target.                                                                              |

## Writing programs

[SauceScript](saucescript.md) explains the language, and [Names and registries](names-and-registries.md)
where the names come from.

| Sauce says             | Think of it as                | What it is                                                                                                                                                                                                    |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`main`'s arguments** | Command-line arguments        | A program's inputs are the parameters of its `main` function. You pass them when you run it (`--args`), so one program serves every call.                                                                     |
| **`pot`**              | `this`                        | Your Pot, inside a program: `pot.USDC` is the USDC the Pot holds, `pot.balance` its native coin.                                                                                                              |
| **Script**             | A program with no inputs      | A program file with statements at its top level and no `main`. It takes no arguments.                                                                                                                         |
| **Program header**     | The label on a recipe         | The comment a program starts with: what it does, the command that runs it, and each parameter with its unit.                                                                                                  |
| **Token symbol**       | A named constant              | `USDC`, `WETH`, `PYUSD`: Sauce knows each token's address on every chain, so a program writes the name.                                                                                                       |
| **Namespace**          | An address book entry         | `UniswapV3.Factory`, `AaveV3.Pool`: a protocol's contract on the chain the program runs on, with its functions ready to call.                                                                                 |
| **Registry**           | The address book itself       | Every chain, token and protocol Sauce knows, with where each is deployed. [Chains](../reference/chains.md) and its neighbours list it.                                                                        |
| **Builtin**            | A standard function           | A name the language provides: `require`, `ctx.self()`, `crypto.keccak256`, `Math.mulDiv`.                                                                                                                     |
| **Target**             | A build target                | `evm` or `svm`: the kind of chain a program is compiled for. A builtin that one target lacks is a compile error there.                                                                                        |
| **`@sauce/token`**     | A standard library for tokens | The functions that move and read tokens safely. `USDC.transfer(to, amount)` calls it for you.                                                                                                                 |
| **`@sauce/router`**    | A standard library for swaps  | One function per kind of pool, for swapping inside a program.                                                                                                                                                 |
| **Compile**            | Build                         | Turning a program into bytecode for one chain. `sauce compile` does it.                                                                                                                                       |
| **`require`**          | An assertion                  | `require(condition, "message")` reverts when false. Uncaught it undoes the cook; inside an EVM atomic `try`, its failure rolls back that block before `catch` runs.                                           |
| **Actions**            | A recipe written as JSON      | A list of steps (swap here, supply there) as a JSON document, which Sauce turns into a program.                                                                                                               |
| **Lowering**           | Translating                   | Turning something into the SauceScript program that runs: an actions document, or a token write such as `USDC.transfer(...)` into its `@sauce/token` call.                                                    |
| **Defines**            | Build-time constants          | Values fixed into a program when it compiles. A chain's names (its token symbols, its protocols' contracts, its chain id) reach a program this way. A value you supply each run is a `main` argument instead. |

## Running programs

[Costs](costs.md) says what a run costs, and [Safety](safety.md) what Sauce checks and what you
should.

| Sauce says               | Think of it as          | What it is                                                                                                                                                                                        |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kitchen fee**          | A flat service fee      | What each cook pays the Kitchen, in ETH on Ethereum and Base, in USDC on Arc and in SOL on Solana; also called the execution fee (`executionFee()`). A cook that fails pays no fee, only its gas. |
| **Salt**                 | A label                 | One owner can have many Pots. Each has its own salt, and the first one's is zero.                                                                                                                 |
| **Wallet**               | A keystore              | A key `sauce wallet new` makes and keeps encrypted under your password, on your computer. `--wallet <name>` signs with it.                                                                        |
| **Policy**               | A spending limit        | A file beside a wallet that caps what it may send, per transaction and per day.                                                                                                                   |
| **Unsigned transaction** | A cheque not yet signed | What `sauce tx` prints: the cook's `to`, `data` and `value`, for any wallet or key service to sign.                                                                                               |
| **Signed cook**          | A signed cheque         | A cook the owner signs, as `sauce sign` prints it, for another account to send and pay the gas for, once, until its deadline (EVM).                                                               |
| **`NotOwner()`**         | "Not your account"      | The error a private Pot gives an ordinary `cook` from anyone but its owner. Signed cooks check the owner's signature instead.                                                                     |
| **Private Pot**          | Your own account        | The default kind of Pot: one fixed owner, whose authorization is needed for every cook.                                                                                                           |
| **Shared Pot**           | A public workbench      | A Pot with no owner: anyone may cook on it and spend what it holds, so it is filled and emptied within one transaction.                                                                           |
| **Router**               | A helper for swaps      | A contract on chain that answers when a pool calls back in the middle of a swap, on behalf of your Pot. You rarely see it.                                                                        |
| **Settle program**       | An audited payout       | Sauce's own program that pays everything a Pot holds of each listed token to one recipient, above a floor. `sauce verify` checks that a payload runs exactly it.                                  |
| **Supported chain**      | Where Sauce sends       | A chain the `sauce` command builds and sends transactions on: Ethereum, Base, Arc and Solana.                                                                                                     |
| **Preview chain**        | Look, but don't send    | Every other chain Sauce knows. Programs compile there, but nothing simulates and the command sends nothing.                                                                                       |

## Swaps

[Swap by name](../guides/swap-by-name.md) uses these in a program of its own.

| Sauce says         | Think of it as            | What it is                                                                                                              |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Pool**           | An exchange booth         | A contract that holds two tokens and trades one for the other, at a price set by how much of each it holds.             |
| **Venue**          | A kind of exchange        | A family of pools that work the same way: Uniswap V3, Curve, Balancer. `@sauce/router` has one function per venue.      |
| **Minimum output** | The least you will accept | The smallest amount a swap may return, often called `minOut`. Below it, the program reverts and nothing moves.          |
| **Price limit**    | A stop price              | The worst price a swap may reach in a pool. A pool stops filling there, so the swap takes less.                         |
| **Slippage**       | Price drift               | How far the price moves between the quote you saw and what your swap gets, as the swap itself and other trades move it. |
| **Tick**           | A step on a price ladder  | A unit of price in a concentrated-liquidity pool, such as Uniswap V3's: a swap moves the price from tick to tick.       |

## Solana

[How Sauce runs on Solana](solana-model.md) explains why each of these exists.

| Sauce says           | Think of it as                  | What it is                                                                                                                                                            |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account**          | A box with an address           | On Solana, everything that holds data or tokens is an account: a wallet, a token balance, a program, your Pot. A transaction lists every account it touches up front. |
| **Token account**    | A wallet's pocket for one token | Where a wallet's (or a Pot's) balance of one token lives. Each holder has one per token.                                                                              |
| **Derived account**  | Filled in for you               | An account Sauce works out from your program, your wallet and its arguments, so you don't list it.                                                                    |
| **PDA**              | An address with no key          | A program-derived address: computed from a program's id and a few seeds, so only that program can sign for it. Your Pot on Solana is one.                             |
| **Account manifest** | The list of accounts            | What compiling a Solana program reports: every account it needs, in order, with how each is found.                                                                    |
| **CPI**              | One program calling another     | A cross-program invocation: a Solana program calling another, with accounts the transaction listed. `svm.call` makes one.                                             |
| **Rent**             | A deposit                       | The SOL Solana holds for each account, in proportion to its size: about 0.072 SOL for a Pot, about 0.002 SOL for a token account.                                     |
| **Staging**          | Uploading in parts              | A program too big for one transaction is uploaded first, into a code buffer, in a few transactions, then run. `sauce run` does it for you.                            |
| **Lookup table**     | An address book on chain        | An address lookup table: a list of accounts a transaction points at, so a cook that names many accounts still fits.                                                   |
| **Compute units**    | Solana's gas                    | Solana's measure of a transaction's work. Each transaction has a budget, and a cook that runs out fails whole.                                                        |
| **Token-2022**       | The newer token program         | Solana's second token program, with optional extensions such as transfer fees. PYUSD and the tokenized stocks use it, and `@sauce/token` takes both.                  |
| **Lamports**         | Cents of SOL                    | SOL's smallest unit: 1 SOL is 1,000,000,000 lamports.                                                                                                                 |

## Coding agents

[Your first agent session](../guides/agent-quick-start.md) puts these to work.

| Sauce says       | Think of it as                   | What it is                                                                                                                                                                                                                                                                                            |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP server**   | A plugin for your coding agent   | `sauce mcp` gives a coding agent Sauce's commands as tools.                                                                                                                                                                                                                                           |
| **stdio**        | A private line                   | How an agent usually starts the MCP server: as a program on your machine that it talks to through its input and output. Only there can the server sign: it serves your wallet directory's wallets unless started with `--no-wallets`, and an agent can enable them. Served over HTTP, it never signs. |
| **Agent skills** | A handbook for your coding agent | Instructions written for an agent, which `sauce skills install` copies into your project.                                                                                                                                                                                                             |

## Next

- The picture these words make: [What Sauce is](what-is-sauce.md).
- Use the first ones: the [quick start](../guides/quick-start.md).
