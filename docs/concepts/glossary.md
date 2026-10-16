# Glossary

**Concept** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md) · [Kitchen, Pot and cook](kitchen-pot-cook.md)

> Sauce has a few words of its own, mostly borrowed from a kitchen. Each one stands for something
> you probably know already. This page puts the two side by side, so you can read every other page
> with the word you know in mind.

## The words you'll meet first

| Sauce says      | Think of it as                              | What it is                                                                                                                                                   |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Program**     | A script                                    | A short `.sauce.ts` file whose `main` function says what to do on chain: read a balance, swap, pay.                                                          |
| **SauceScript** | A small, strict TypeScript                  | The language programs are written in. It looks like TypeScript, and the compiler checks it before anything runs.                                             |
| **Pot**         | Your own smart account, or vault            | A small contract (on Solana, an account) that belongs to your wallet. It holds the tokens your programs spend, and every call a program makes comes from it. |
| **Owner**       | The wallet that controls the Pot            | The address whose Pot it is. Only the owner can run programs on it, and that never changes.                                                                  |
| **Cook**        | The transaction that runs a program         | One transaction from you to your Pot, carrying one program. Every step of the program happens, or none does.                                                 |
| **Kitchen**     | The factory contract                        | The contract that makes Pots and charges a small flat fee, in the chain's own coin, for each cook.                                                           |
| **Engine**      | An interpreter, like a tiny virtual machine | The on-chain code that reads a compiled program and carries it out, inside your Pot. You never call it yourself.                                             |
| **Simulate**    | A dry run                                   | `sauce simulate` runs your program on a copy of the chain as it is right now. It needs no key and no money, and changes nothing.                             |

A program is a recipe, your Pot is your own counter on the blockchain, a cook is one go at the
recipe, and the Kitchen is the shop that builds counters and charges for each go. If any step of the
recipe fails, nothing happens at all: as if you never started.

## Writing programs

| Sauce says             | Think of it as                | What it is                                                                                                                                |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **`main`'s arguments** | Command-line arguments        | A program's inputs are the parameters of its `main` function. You pass them when you run it (`--args`), so one program serves every call. |
| **Token symbol**       | A named constant              | `USDC`, `WETH`, `PYUSD`: Sauce knows each token's address on every chain, so a program writes the name.                                   |
| **Namespace**          | An address book entry         | `UniswapV3.Factory`, `AaveV3.Pool`: a protocol's contract on the chain the program runs on, with its functions ready to call.             |
| **Registry**           | The address book itself       | Every chain, token and protocol Sauce knows, with where each is deployed. [Chains](../reference/chains.md) and its neighbours list it.    |
| **`@sauce/token`**     | A standard library for tokens | The functions that move and read tokens safely. `USDC.transfer(to, amount)` calls it for you.                                             |
| **`@sauce/router`**    | A standard library for swaps  | One function per kind of pool, for swapping inside a program.                                                                             |
| **Compile**            | Build                         | Turning a program into bytecode, the compact form the engine reads. `sauce compile` does it.                                              |
| **`require`**          | An assertion                  | `require(condition, "message")` stops the whole cook when the condition is false. Nothing moves, and the message tells you why.           |
| **Actions**            | A recipe written as JSON      | A list of steps (swap here, supply there) as a JSON document, which Sauce turns into a program.                                           |

## Running programs

| Sauce says            | Think of it as      | What it is                                                                                                                      |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Kitchen fee**       | A flat service fee  | What each cook pays the Kitchen, in ETH on Ethereum and Base and in SOL on Solana. A cook that fails pays no fee, only its gas. |
| **Salt**              | A label             | One owner can have many Pots. Each has its own salt, and the first one's is zero.                                               |
| **Wallet**            | A keystore          | A key `sauce wallet new` makes and keeps encrypted under your password. `--wallet <name>` signs with it.                        |
| **Policy**            | A spending limit    | A file beside a wallet that caps what it may send, per transaction and per day.                                                 |
| **Router** (on chain) | A helper for swaps  | A contract that answers when a pool calls back in the middle of a swap, on behalf of your Pot. You rarely see it.               |
| **Supported chain**   | Generally available | A chain the `sauce` command builds and sends transactions on: Ethereum, Base and Solana.                                        |
| **Preview chain**     | Beta                | Every other chain Sauce knows. Programs compile and simulate there, but the command sends nothing.                              |

## Cross-chain intents

An intent is how a program reaches another chain. You post a job on one chain with a reward
attached, and someone does the job on the other chain to earn it.

| Sauce says        | Think of it as                | What it is                                                                                                                      |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Intent**        | A job posting with a bounty   | "Do this on that chain, and the reward waiting here is yours." Sauce builds intents for Eco's intent system, called eco-routes. |
| **Source**        | Where you post the job        | The chain where the intent is published and its reward waits.                                                                   |
| **Destination**   | Where the job is done         | The chain where the intent's work happens.                                                                                      |
| **Route**         | The job description           | What happens on the destination: the tokens brought there and the calls made with them, or a Sauce program.                     |
| **Reward**        | The bounty                    | The tokens locked on the source until someone proves they did the job.                                                          |
| **Solver**        | A courier                     | Whoever does the job. A solver uses its own funds on the destination, then claims the reward.                                   |
| **Portal**        | The job board                 | eco-routes' contract on each chain, where intents are published, filled and paid out.                                           |
| **Vault**         | An escrow account             | The address, one per intent, where the reward waits.                                                                            |
| **Prover**        | A messenger                   | The bridge that tells the source chain the job was done, so the reward can be paid.                                             |
| **Creator**       | The person who posted the job | Who may take the reward back if nobody does the job in time.                                                                    |
| **Deadline**      | The closing date              | The last moment a solver may do the job, and the moment after which an unclaimed reward can go back to its creator.             |
| **Intent Pot**    | A shared workbench            | On the destination, an intent's program runs on a Pot that every solver's fill shares, not on yours.                            |
| **Nested intent** | A job that posts the next job | An intent opened inside another intent's program, often from an amount that program just measured.                              |

## Solana

| Sauce says           | Think of it as                  | What it is                                                                                                                |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Account**          | A box with an address           | On Solana, everything that holds data or tokens is an account, and a transaction lists every account it touches up front. |
| **Token account**    | A wallet's pocket for one token | Where a wallet's (or a Pot's) balance of one token lives. Each wallet has one per token.                                  |
| **Derived account**  | Filled in for you               | An account Sauce works out from your program, your wallet and its arguments, so you don't list it.                        |
| **Account manifest** | The list of accounts            | What compiling a Solana program reports: every account it needs, in order, with how each is found.                        |
| **Staging**          | Uploading in parts              | A program too big for one transaction is uploaded first, in a few transactions, then run. `sauce run` does it for you.    |
| **Lamports**         | Cents of SOL                    | SOL's smallest unit: 1 SOL is 1,000,000,000 lamports.                                                                     |

## For coding agents

| Sauce says       | Think of it as                   | What it is                                                                                |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| **MCP server**   | A plugin for your coding agent   | `sauce mcp` gives an agent such as Claude Code or Codex Sauce's commands as tools.        |
| **Agent skills** | A handbook for your coding agent | Instructions written for an agent, which `sauce skills install` copies into your project. |
