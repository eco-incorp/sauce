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

The groups: [First words](#first-words), [Chain words](#chain-words), [Writing programs](#writing-programs), [Running programs](#running-programs), [Swaps](#swaps), [Cross-chain intents](#cross-chain-intents), [Solana](#solana), [Coding agents](#coding-agents).

- **A**: ABI (Chain words) · Account (Solana) · Account manifest (Solana) · Actions (Writing programs) · Address (Chain words) · Agent skills (Coding agents) · Allowance (Chain words)
- **B**: Builtin (Writing programs) · Bytecode (Chain words)
- **C**: Cancel (Cross-chain intents) · Claim (Cross-chain intents) · Claimant (Cross-chain intents) · Compile (Writing programs) · Compute units (Solana) · Cook (First words) · CPI (Solana) · Creator (Cross-chain intents)
- **D**: Decimals (Chain words) · Defines (Writing programs) · Derived account (Solana) · Destination (Cross-chain intents)
- **E**: Engine (First words) · EVM chain (Chain words) · Executor (Cross-chain intents) · Explorer (Chain words)
- **F**: Fill (Cross-chain intents) · Fill deadline (Cross-chain intents)
- **G**: Gas (Chain words)
- **I**: Intent (Cross-chain intents) · Intent Pot (Cross-chain intents)
- **K**: Kitchen (First words) · Kitchen fee (Running programs)
- **L**: Lamports (Solana) · Lookup table (Solana) · Lowering (Writing programs)
- **M**: `main`'s arguments (Writing programs) · MCP server (Coding agents) · Minimum output (Swaps)
- **N**: Namespace (Writing programs) · Native coin (Chain words) · Nested intent (Cross-chain intents) · `NotOwner()` (Running programs)
- **O**: Owner (First words)
- **P**: PDA (Solana) · Policy (Running programs) · Pool (Swaps) · Portal (Cross-chain intents) · Pot (First words) · Preview chain (Running programs) · Price limit (Swaps) · Private Pot (Running programs) · Program (First words) · Program header (Writing programs) · Prove (Cross-chain intents) · Prover (Cross-chain intents)
- **R**: Refund (Cross-chain intents) · Registry (Writing programs) · Rent (Solana) · `require` (Writing programs) · Revert (Chain words) · Reward (Cross-chain intents) · Reward deadline (Cross-chain intents) · Route (Cross-chain intents) · Route body (Writing programs) · Router (Running programs) · RPC endpoint (Chain words)
- **S**: SafeERC20 (Chain words) · Salt (Running programs) · `@sauce/router` (Writing programs) · `@sauce/token` (Writing programs) · SauceScript (First words) · Script (Writing programs) · `self` (Writing programs) · Settle program (Running programs) · Shared Pot (Running programs) · Simulate (First words) · Slippage (Swaps) · Solver (Cross-chain intents) · Source (Cross-chain intents) · Staging (Solana) · stdio (Coding agents) · Supported chain (Running programs) · SVM (Chain words)
- **T**: Target (Writing programs) · Tick (Swaps) · Token account (Solana) · Token symbol (Writing programs) · Token-2022 (Solana)
- **U**: Unsigned transaction (Running programs)
- **V**: Vault (Cross-chain intents) · Venue (Swaps)
- **W**: Wallet (Running programs)

## First words

Read these before anything else. [What Sauce is](what-is-sauce.md) puts them together, and
[Kitchen, Pot and cook](kitchen-pot-cook.md) explains the three kitchen words in full.

| Sauce says      | Think of it as                              | What it is                                                                                                                                                                                               |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Program**     | A script                                    | A short `.sauce.ts` file whose `main` function says what to do on chain: read a balance, swap, pay.                                                                                                      |
| **SauceScript** | A small, strict TypeScript                  | The language programs are written in. It looks like TypeScript, and the compiler checks it before anything runs.                                                                                         |
| **Pot**         | Your own smart account                      | Your account on chain, which belongs to your wallet: a small contract on Ethereum and Base, an account on Solana. It holds the tokens your programs spend, and every call a program makes comes from it. |
| **Owner**       | The wallet that controls the Pot            | The address whose Pot it is. Only the owner can run programs on it, and that never changes.                                                                                                              |
| **Cook**        | The transaction that runs a program         | One transaction from you to your Pot, carrying one program. Every step of the program happens, or none does.                                                                                             |
| **Kitchen**     | The factory contract                        | The contract that makes Pots and charges a small flat fee, in the chain's own coin, for each cook.                                                                                                       |
| **Engine**      | An interpreter, like a tiny virtual machine | The on-chain code that reads a compiled program and carries it out, inside your Pot. You never call it yourself.                                                                                         |
| **Simulate**    | A dry run                                   | `sauce simulate` runs your program on a copy of the chain as it is right now. It needs no key and no money, and changes nothing.                                                                         |

A program is a recipe, your Pot is your own counter on the blockchain, a cook is one go at the
recipe, and the Kitchen is the shop that builds counters and charges for each go. If any step of the
recipe fails, nothing happens at all: as if you never started.

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
| **Native coin**  | The house currency         | The coin a chain charges its fees in: ETH on Ethereum and Base, SOL on Solana.                                                                             |
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
| **`self`**             | `this`                        | Your Pot, inside a program: `self.USDC` is the USDC the Pot holds.                                                                                                                                            |
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
| **`require`**          | An assertion                  | `require(condition, "message")` stops the whole cook when the condition is false. Nothing moves, and the message tells you why.                                                                               |
| **Actions**            | A recipe written as JSON      | A list of steps (swap here, supply there) as a JSON document, which Sauce turns into a program.                                                                                                               |
| **Lowering**           | Translating                   | Turning something into the SauceScript program that runs: an actions document, or a token write such as `USDC.transfer(...)` into its `@sauce/token` call.                                                    |
| **Route body**         | A function body, as text      | An intent's job written as code, `Base(() => { ... })`, in a program or in TypeScript. Sauce reads its text and compiles it for the destination; it never runs as JavaScript.                                 |
| **Defines**            | Build-time constants          | Values fixed into a program when it compiles. A chain's names (its token symbols, its protocols' contracts, its chain id) reach a program this way. A value you supply each run is a `main` argument instead. |

## Running programs

[Costs](costs.md) says what a run costs, and [Safety](safety.md) what Sauce checks and what you
should.

| Sauce says               | Think of it as          | What it is                                                                                                                                                                        |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kitchen fee**          | A flat service fee      | What each cook pays the Kitchen, in ETH on Ethereum and Base and in SOL on Solana; also called the execution fee (`executionFee()`). A cook that fails pays no fee, only its gas. |
| **Salt**                 | A label                 | One owner can have many Pots. Each has its own salt, and the first one's is zero.                                                                                                 |
| **Wallet**               | A keystore              | A key `sauce wallet new` makes and keeps encrypted under your password, on your computer. `--wallet <name>` signs with it.                                                        |
| **Policy**               | A spending limit        | A file beside a wallet that caps what it may send, per transaction and per day.                                                                                                   |
| **Unsigned transaction** | A cheque not yet signed | What `sauce tx` prints: the cook's `to`, `data` and `value`, for any wallet or key service to sign.                                                                               |
| **`NotOwner()`**         | "Not your account"      | The error a Pot gives a cook from anyone but its owner. The cook reverts, and nothing moves.                                                                                      |
| **Private Pot**          | Your own account        | The default kind of Pot: one owner, who alone may cook on it.                                                                                                                     |
| **Shared Pot**           | A public workbench      | A Pot with no owner: anyone may cook on it and spend what it holds, so it is filled and emptied within one transaction.                                                           |
| **Router**               | A helper for swaps      | A contract on chain that answers when a pool calls back in the middle of a swap, on behalf of your Pot. You rarely see it.                                                        |
| **Settle program**       | An audited payout       | Sauce's own program that pays everything a Pot holds of each listed token to one recipient, above a floor. `sauce verify` checks that a payload runs exactly it.                  |
| **Supported chain**      | Where Sauce sends       | A chain the `sauce` command builds and sends transactions on: Ethereum, Base and Solana.                                                                                          |
| **Preview chain**        | Look, but don't send    | Every other chain Sauce knows. Programs compile and simulate there, but the command sends nothing.                                                                                |

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

## Cross-chain intents

An intent is how a program reaches another chain. You post a job on one chain with a reward
attached, and someone does the job on the other chain to earn it.
[Cross-chain intents](cross-chain-intents.md) explains the model.

| Sauce says          | Think of it as                | What it is                                                                                                                                                                      |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intent**          | A job posting with a bounty   | "Do this on that chain, and the reward waiting here is yours." Sauce builds intents for Eco's intent system, called eco-routes.                                                 |
| **Source**          | Where you post the job        | The chain where the intent is published and its reward waits.                                                                                                                   |
| **Destination**     | Where the job is done         | The chain where the intent's work happens.                                                                                                                                      |
| **Route**           | The job description           | What happens on the destination: the tokens brought there and the calls made with them, or a Sauce program. The SDK's `routes` module, which builds intents, is named after it. |
| **Reward**          | The bounty                    | The tokens locked on the source until someone proves they did the job.                                                                                                          |
| **Solver**          | A courier                     | Whoever does the job. A solver uses its own funds on the destination, then claims the reward.                                                                                   |
| **Portal**          | The job board                 | eco-routes' contract on each chain, where intents are published, filled and paid out.                                                                                           |
| **Executor**        | The Portal's hands            | A contract the destination Portal owns. It receives what the solver delivers and makes the route's calls; an intent's program runs on the Pot it owns.                          |
| **Vault**           | An escrow account             | The address, one per intent, where the reward waits.                                                                                                                            |
| **Prover**          | A messenger                   | The bridge that tells the source chain the job was done, so the reward can be paid.                                                                                             |
| **Creator**         | The person who posted the job | Who may take the reward back if nobody does the job in time.                                                                                                                    |
| **Claimant**        | Who gets paid                 | The address a fill records as the one to receive the reward.                                                                                                                    |
| **Fill deadline**   | The closing date              | The last moment a solver may do the job. Also called the route deadline.                                                                                                        |
| **Reward deadline** | The refund date               | When a reward nobody proved earning becomes refundable to its creator.                                                                                                          |
| **Fill**            | The courier does the job      | A solver delivers what the route needs on the destination, and the Portal's Executor makes the calls. The Portal records who filled it, the claimant.                           |
| **Prove**           | Sending word home             | The destination Portal hands its record of the fill to the prover, which carries it to the source chain, for a fee.                                                             |
| **Claim**           | Collecting the bounty         | Once the source knows of the fill, anyone may send `withdraw`: it pays the reward to the claimant the proof names.                                                              |
| **Refund**          | Taking the bounty back        | Returns what the vault holds to the creator: from the reward deadline when no fill is proven, or at once after a proven cancellation.                                           |
| **Cancel**          | Calling the job off           | Anyone may cancel an unfilled intent on the destination strictly after its fill deadline; proving the cancellation allows an early refund.                                      |
| **Intent Pot**      | A shared workbench            | The Pot owned by the destination Portal's Executor, one per Portal, shared by every intent through it. An intent's program runs there, not on your Pot.                         |
| **Nested intent**   | A job that posts the next job | An intent opened inside another intent's program, often from an amount that program just measured.                                                                              |

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

| Sauce says       | Think of it as                   | What it is                                                                                                                                                                                                          |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP server**   | A plugin for your coding agent   | `sauce mcp` gives a coding agent Sauce's commands as tools.                                                                                                                                                         |
| **stdio**        | A private line                   | How an agent usually starts the MCP server: as a program on your machine that it talks to through its input and output. Only there can the server sign, with wallets you give it; served over HTTP, it never signs. |
| **Agent skills** | A handbook for your coding agent | Instructions written for an agent, which `sauce skills install` copies into your project.                                                                                                                           |

## Next

- The picture these words make: [What Sauce is](what-is-sauce.md).
- Use the first ones: the [quick start](../guides/quick-start.md).
