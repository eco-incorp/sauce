---
name: sauce-overview
description: Start here for any Sauce task — what Sauce is (a programmable-transaction runtime whose programs, written in SauceScript as .sauce.ts files, run atomically on EVM chains and Solana), what a Pot, a cook and the Kitchen are and who may do what with each, the path from a program file to an executed transaction with the sauce command, the rules every program follows, where its results end (the user's wallet or the Pot) and what the user is shown before anything is sent, and a map of every Sauce skill (what each teaches and holds, when to load it rather than its neighbour, the skills to read in order for common tasks, and how to read them over MCP). Use when the user mentions Sauce, SauceScript, a .sauce or .sauce.ts file, @eco-incorp/sauce, the sauce command, a Pot, Kitchen, cook or engine, Eco intents, or asks to "write a Sauce program", "do this atomically on chain", or "swap/bridge/lend with Sauce".
---

# Sauce

**Sauce is a programmable-transaction runtime.** You write a program in **SauceScript**, a checked
subset of TypeScript, in a `.sauce.ts` file. It compiles for a chain into bytecode, and a Sauce
engine executes it inside one transaction: on an EVM chain through your Pot's
`cook(engine, program)`, on Solana through the Kitchen. Every step lands or none does. A program
has control flow, reads and checks, and the engine runs it as written: it is not a multicall, and
it does not use a magic header.

On top of the runtime sit **intents**: an offer of work on another chain, with a reward escrowed on
this one, written `Ethereum.hop({ send, receive, refundee }).then(() => { … })`, the body running
on Ethereum.
A solver decides whether to fill it (`sauce-intents`).

## Kitchen, Pot and cook

Three words name where a program runs. Use them as defined here, and explain them this way to a
developer who meets them for the first time.

- **Pot**: an owner's account on chain, a small contract the Kitchen creates. It holds the tokens
  a program spends, and every call a program makes comes from it. Only its owner can run programs
  on it. Its address follows from the owner and a salt (zero unless `--salt` names another), so it
  is known before it exists: `sauce pot --chain <chain> --owner <address>` prints it. Anyone may
  deploy an owner's Pot (`sauce pot --deploy`), and it is the owner's whoever sends that. It is
  funded by sending tokens to its address, and what it holds leaves only through a program its
  owner runs on it: a Pot has no withdraw function. So what a cook leaves in the Pot is the
  owner's, but it is not in the owner's wallet, and a wallet does not show it.
- **Cook**: the transaction that runs one program: `cook(engine, program)`, sent by the owner to
  the Pot, with `main`'s arguments appended to the program and the Kitchen's fee as its value. The
  engine runs the program as the Pot, every step or none: a failed `require` reverts the whole
  cook, the fee with it, and nothing moves.
- **Kitchen**: the contract that creates Pots and sets the flat fee every cook pays in the chain's
  native coin. Its owner sets that fee and the Router new Pots start on, and cannot change an
  existing Pot or move what it holds.

The **engine** is the interpreter that executes the bytecode. A cook names it, and on an EVM chain
it runs only inside a Pot the Kitchen created; the `sauce` command names the released one.

An intent's body runs as a cook too, on the destination chain, but on a Pot that is not the
user's: the one Pot every intent to that chain shares, which every solver drives (`sauce-intents`).
On Solana the Kitchen is a program, the Pot is its account for the owner and salt, which a program
is given as an account, and a cook is the Kitchen's `cook` instruction, signed by the owner
(`sauce-solana`).

## You write the program

Write each program yourself, in SauceScript, for the task as it is asked. These skills teach the
language, the names each chain offers and the patterns; their example programs show idioms and the
rules a correct program follows. They are not templates to copy, adapt or choose between: never
ask the user which example or existing file to start from. The one exception is a complete
implementation a skill says to use whole: the Solana distributed swap (`sauce-solana-distributed-swap`),
whose pool slots are the accounts `sauce pools` fills by name. Take its code as given, and
write the header, the slots and the inputs for the task. Ask only for the facts the request
leaves open (an amount, a price limit, a recipient, the chain, where the results end); decide the
rest, write the program, and rehearse it with `sauce simulate`.

## Where the results end, and what the user sees first

**Ask where the results go.** Before writing a program that produces assets (a swap's output, a
lending market's receipt tokens such as aTokens, a vault's shares, what a bridge delivers), ask the
user whether they should end in their wallet, the Pot's owner, or stay in the Pot. Say the
difference in a line: the Pot is their own program account, so what stays there is theirs, but only
another cook moves it out, and their wallet does not show it. Then write the program that way.
Every call a program makes comes from the Pot, so a protocol that credits its caller, or a
beneficiary given as `ctx.self()`, leaves the output in the Pot. To deliver it, send it to the
wallet, or name the wallet as the call's beneficiary (`onBehalfOf`, `receiver`, `recipient`,
`to`), a `main` parameter. The header says which it is.

**Show it before it is sent.** Before a transaction is sent, or handed to the user's wallet as
`sauce tx`'s unsigned JSON, show the user, and ask them to confirm:

1. the final program, as it will be compiled;
2. the arguments it will be called with, each with its meaning and units (`1000000` is 1 USDC);
3. what the rehearsal (`sauce simulate`) says will happen: what leaves the wallet, what arrives
   where, and what is left in the Pot. The rehearsal leads with what the cook leaves in the Pot,
   in the lines under `Left in the Pot`, or as `leftInPot` in its JSON, and prints none when it
   leaves nothing.

Send only once the user agrees.

**Report what was sent.** Every command that sends a transaction prints its hash and two links: the
chain's explorer page and its trace (calls and balance changes). Give the user both, to open in a
browser, and never fetch or read them yourself. With them, report what the command printed from
the transaction's receipt: what left the wallet, what arrived where, and what stayed in the Pot
(`Left in the Pot`).

Call typed bindings, namespaces and library functions directly: `USDC.transfer(...)`,
`UniswapV3.Factory.getPool(...)`, `uniswapV3(...)` from `@sauce/router`. Do not wrap a single call
in a helper, and do not hand-roll a raw selector with `evm.static` and `abi.decode` where a typed
binding or a namespace exists. Keep a helper only for real logic used more than once.

Start every program with a comment that says, in order: what it does, in one line; the `sauce`
command that runs it, with `--chain <chain>` and `--args` naming every `main` parameter in order
(`--args <tokenIn> <tokenOut> <amountIn>`); one line per parameter with its type, its meaning and
its units, in smallest units (`5000000000` is 5,000 USDC, which has 6 decimals; an array or a
record is passed as JSON); and one concrete invocation on a supported chain with real values,
addresses taken from the registry and the developer's own inputs left as `<placeholders>`. An
intent file is written the same way: its inputs are `main` parameters too. `sauce-script` shows
one.

## Supported chains

For the initial release, Sauce supports transactions on **Ethereum, Base and Solana** (`ethereum`,
`base`, `solana`). Every other chain the SDK knows is a **preview chain**: a program compiles for
it, and `sauce simulate` and the dry runs rehearse it there, but the `sauce` command and the MCP
server build and send no transaction on it. `sauce tx`, `sauce run`, `sauce pot --deploy`,
`sauce intent publish` and the intent steps sent there are refused before anything is read or
signed, and the refusal names the supported chains and the chain-support request for that chain.
An intent publishes only when every chain it involves is supported. `sauce-chains` marks each
chain supported or preview.

To ask for a chain, look among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add the use case to that chain's as a comment, or
[open one](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with the
chain-support form: the chain and its id, what runs there, the protocols and tokens, and the
expected volume and timing. The refusal carries both links, prefilled for its chain.

## Writing a program

A program names what the chain it is compiled for supplies, with no import: token symbols such as
`USDC`, `Token(address)` for any other token, protocol namespaces such as `UniswapV3.Factory` and
`AaveV3.Pool`, chain names such as `Ethereum`, and `ctx` for the transaction's context. The
smallest complete program:

```sauce chain=base,ethereum
function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self());
  require(held >= floor, "not enough USDC in the Pot");
  USDC.transfer(recipient, held);
}
```

It names no chain. `sauce run <file> --chain base` compiles it for Base, where `USDC` is Base's
USDC; `--chain ethereum` gives the same file Ethereum's. What changes per call, such as `recipient`
and `floor`, is a parameter of `main`, passed with the transaction (`--args`), so one compiled
program serves every call. That program is for an EVM chain: on Solana every account, a recipient
included, is an `Account` parameter attached with `--account`, never an `Address` argument
(`sauce-solana`).

On an EVM chain the executing contract, `ctx.self()`, is the **Pot**: it holds the tokens and
makes the calls. Token writes are SafeERC20 however they are spelled, so USDT works. On Solana the
Pot is an account the program is given, and `ctx.self()` there is the engine's program id.

Two references hold what a program can name. The language (types, operators, statements, and the
`ctx`, `crypto`, `Math`, `abi`, `evm` and `svm` builtins) is
[../sauce-script/references/builtins.md](../sauce-script/references/builtins.md); the names a chain
supplies are indexed in [../sauce-globals/references/](../sauce-globals/references/tokens.md), and
`sauce globals --chain <chain>` lists them for one chain. Take every address from those or from
the developer; never invent one.

## From a file to a transaction

The `sauce` command comes with the package, which needs Node.js 24 or newer: install it once with
`npm i -g @eco-incorp/sauce`, or run `npx -y @eco-incorp/sauce` in its place (`sauce-cli`). With
the program above saved as `payout.sauce.ts`:

```sh
sauce globals --chain base                     # the names a program on Base can use
sauce compile payout.sauce.ts --chain base     # check it compiles: the bytecode
sauce simulate payout.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:1 --args <recipient> 1000000
sauce tx payout.sauce.ts --chain base --owner <address> --args <recipient> 1000000
sauce run payout.sauce.ts --chain base --keystore <keystore> \
  --args <recipient> 1000000
```

**Units differ by flag.** `--args` takes base units: `1000000` is 1 USDC (6 decimals).
`--assume-balance` and `--fund` take whole tokens: `USDC:1` is 1 USDC, not 1 base unit, and
`USDC:1000000` would be a million USDC; there a trailing `n` means base units (`USDC:1000000n` is
1 USDC).

Compiling for a chain produces the program's bytecode; running it is one transaction to the
owner's Pot, `cook(engine, program)` with `main`'s arguments appended to the program, paying the
Kitchen's fee. `sauce tx` prints that transaction unsigned, `{ chainId, to, data, value }`, for
any wallet or signer to send; `sauce run` signs and sends it itself, deploying the Pot first if it
is not there. Both work on a supported chain only; on a preview chain, compile and simulate.
`sauce-cli` covers each command. A chain is read through a built-in public endpoint, or one the
developer passes, never one from the program or the environment. Without the CLI, the same steps
are tools of the Sauce MCP server (`sauce mcp`); `sauce-cli` maps each command
to its tool.

## Rules for every program

1. **Nothing is left behind by surprise.** Measure outputs as balance deltas, deliver them where
   the user asked (their wallet, unless they chose the Pot), return unspent input, and approve
   exactly what the next call spends. An intent's body runs on a Pot every intent to that chain
   shares, so there a leftover is anyone's.
2. **A swap leg must not strand input.** Swap exact input, enforce a minimum output with `require`,
   and return what a partial fill leaves (`sauce-swaps`).
3. **Every check belongs in the program.** A failed `require` reverts the whole transaction; that
   atomicity is the safety mechanism.
4. **An intent is an offer.** Never promise it will be filled.
5. **No endpoints or keys in code.** A program names no RPC URL or key, and the package reads no
   environment variable: the command reads chains through built-in public endpoints or the
   developer's own, and signers are passed on the command line.
6. **Transactions on supported chains only.** Build and send on Ethereum, Base or Solana. On a
   preview chain, compile and simulate; when a command refuses one, offer the user the
   chain-support request it names instead of looking for another way to send.
7. **The user sees it before it is sent, and what it did after.** The program, its arguments and
   the rehearsal's outcome (what leaves the wallet, what arrives where, what stays in the Pot),
   then their go-ahead; once sent, its explorer and trace links and what its receipt shows.

## The skill map

Each skill is a `SKILL.md`, its instructions, to read whole. Several add `references/`, to look up
rather than read through (the generated ones list every chain, token and protocol), and most add
`examples/`: programs (`.sauce.ts`), actions documents (`.json`) and runners (`.mts`) that pin
what the skill says. Load a skill when the task reaches it. Each entry below says what the skill
teaches, what it holds, when to load it rather than its neighbour, and a request that leads there.

### `sauce-overview`

This skill: what Sauce is, the rules every program follows, where a program's results end and
what the user sees before anything is sent, the path from a file to a transaction, and this map.
It holds no references or examples of its own.

- **Load it** first, for any Sauce task.
- **Asked as:** "What is Sauce, and how do I run something with it?"

### `sauce-script`

The language: the two program forms (`main(...)` with runtime arguments, or top-level statements
with defines), the file's header, values, calling a contract, helpers, atomic failure and `.catch`,
what a program costs, and compile errors.

- **Holds** the language reference,
  [references/builtins.md](../sauce-script/references/builtins.md): every type, operator,
  statement and builtin, its targets, an example and the error a misuse gives. Its example reads a
  pool's price history through an ABI kept beside the program.
- **Load it** to write or fix any program. It says what the language expresses; `sauce-globals`
  says which names a chain supplies.
- **Asked as:** "My helper fails with 'does not return on every path'. What do I write instead?"

### `sauce-globals`

The names a program uses with no import, resolved on the chain it is compiled for: token symbols
and tokenized stocks, `Token(address)`, the SafeERC20 token methods and the `@sauce/token`
functions, protocol namespaces and family aliases, the comparison with zero for a venue a chain may lack, chain names and `ctx`.

- **Holds** generated indexes of names, the lists `sauce globals` prints:
  [tokens](../sauce-globals/references/tokens.md),
  [stocks](../sauce-globals/references/stocks.md) (every tokenized stock per chain, with its
  issuer), [protocols](../sauce-globals/references/protocols.md) and
  [chains](../sauce-globals/references/chains.md).
- **Load it** to find a name or check that it exists. It lists names; `sauce-chains` gives each
  one's address on a chain, and `sauce-protocols` a protocol across every chain.
- **Asked as:** "What is the SpaceX stock token called on Base?"

### `sauce-chains`

How a program's names resolve per chain, and each chain's facts. One file compiled for two chains
gets each one's own tokens, stocks, contracts and `chainId`; a name a chain lacks is refused when
compiling; another chain's contract (`Base.UniswapV3.Factory`) is only its address, never a call;
the same names are written for an EVM chain or for Solana. Per chain: supported or preview (and
how to request it), its id, slug, native coin, intents, CCTP domain, every token and every
protocol deployment with its address; and the Sauce deployment, the same on every chain, in one
file.

- **Holds** [references/index.md](../sauce-chains/references/index.md) and a generated file per
  chain, such as [references/base.md](../sauce-chains/references/base.md), with a separate file of
  tokenized stocks for each chain that has them, and
  [references/deployments.json](../sauce-chains/references/deployments.json): the engine, the
  Kitchen, the Routers, the shared intent Pot and the Solana programs. Its examples read what a Pot
  holds on any EVM chain, and pay cash and stock on Solana.
- **Load it** for an address, for what one chain offers, for one program meant for several chains,
  or when a transaction is refused on a preview chain. For a name alone, `sauce-globals` is
  lighter; for a Solana program in depth, `sauce-solana`.
- **Asked as:** "Does Base take intents, and where is Uniswap V3's factory there?"

### `sauce-protocols`

Every protocol the registry knows: how to choose between protocols that do the same job, and how a
program reaches each (a namespace contract, an address only, an interface called with an address,
or an imported ABI), compared with zero on a chain that may lack it.

- **Holds** [references/index.md](../sauce-protocols/references/index.md), every protocol by
  category with "Choosing between them"; per protocol, a generated registry file
  (`references/registry/<slug>.md`: its deployments on every chain, how a program names each
  contract, its ABI functions) and a document (`references/<slug>.md`: what it is for, its
  pitfalls, a compiled example, its templates).
- **Load it** before calling a protocol, or to pick one. A swap goes through `sauce-swaps` first:
  a program swaps through `@sauce/router`, not through a protocol's own router.
- **Asked as:** "Which lending market on Base takes USDC, and how does a program supply to it?"

### `sauce-swaps`

Any swap inside a program, through `@sauce/router`: one function per venue (Uniswap V2, V3 and V4,
Curve, Balancer V2, DODO V2, Trader Joe LB, WOOFi, Maverick V2), which venues are paid first and
which call back through the Pot's Router, exact input, price limits and partial fills, the reverts,
and the guard every leg needs.

- **Holds** the functions' arguments, `sauce price` for turning a price into a limit, and an
  example: one guarded Uniswap V3 leg that returns its unspent input.
- **Load it** for one swap, or a swap as one step of a program. One order over several pools
  under one price is `sauce-distributed-swap`; a swap as a step of a JSON document is
  `sauce-actions`.
- **Asked as:** "Sell 1 WETH for USDC on Base, no lower than 2,600 USDC per WETH."

### `sauce-distributed-swap`

One exact-input order spread over several price-limited pools: a limit buy that pays no more than
one price for any unit, fees included, and refunds what it did not spend. Covers the rules, a
fee-adjusted limit per pool, a Uniswap V4 pool found by its key, `maxPrice`, `minTokens` and
`maxAvgPrice` for tokens of any decimals, finding a token and its pools, running it, and adding
venues.

- **Holds** one complete program over Base's Aerodrome Slipstream, Uniswap V3 and Uniswap V4 pools
  (its header buys the SpaceX stock token, and WETH, with USDC), and a runner that holds the
  skill's arithmetic and commands to it.
- **Load it** when an order should take the best of several pools or stop at a price; it is built
  from the single swap `sauce-swaps` teaches. On Solana it is `sauce-solana-distributed-swap`.
- **Asked as:** "Buy SpaceX stock on Base with up to 1,000 USDC, never paying more than 150 USDC a
  token."

### `sauce-solana-distributed-swap`

The same limit order on Solana: one exact-input order spread over the pools of every Solana venue
whose swap stops at a price limit (Raydium CLMM and the programs built on it, Orca Whirlpools and
Cropper, DefiTuna, Crema, Phoenix's order book), each pool a slot of accounts found before the
cook with `sauce pools --chain solana`, swapped by `@sauce/router`'s `trySwap`, which reads its
venue from the pool's owner and gives each pool a fee-adjusted limit, the minimum and average-price
checks, and what fits in one cook (about five pools: a staged program and a lookup table).

- **Holds** one complete program over four slots, a reference of each venue's pool layout, its
  `@sauce/router` function and the nine accounts its slot takes, and a runner that holds the
  skill's venues, offsets and arithmetic to the program and the library.
- **Load it** for a split or limit order on Solana, with `sauce-solana` for the accounts.
- **Asked as:** "Buy SOL with up to 1,000 USDC across Raydium and Orca, never above 120 USDC."

### `sauce-actions`

A program as a JSON actions document rather than SauceScript: an ordered list of swaps,
approvals, supplies, bridges, wraps and stakes, with tokens by symbol, contracts by namespace and
pools by their factory's key, so one document serves every chain that has its names.

- **Holds** [references/actions.md](../sauce-actions/references/actions.md), every action and
  field, generated from the document's JSON Schema; its examples swap by a pool's key, and swap
  then supply to Aave.
- **Load it** when the steps are fixed or produced as data by a service. A condition, a loop, a
  best venue or an intent needs SauceScript (`sauce-script`).
- **Asked as:** "Our backend emits swap-then-supply steps as JSON. How do we run them?"

### `sauce-intents`

Work continued on another chain: an intent file (`Base.hop({ send, receive, refundee }).then(…)`
in `main`, its inputs `main`'s parameters, the refundee named, the deadlines, salt and fee defaulted
or set as fields of the hop), its life (fund, publish, fill, prove, claim, refund
or cancel, a `sauce intent` command each), every way to publish and fund one (a cook on your
Pot), the body (a program cooked on the destination's shared Pot), cascades, on which chain each
name resolves, and rehearsing both sides.

- **Holds** a reference of the intent contract's functions, events and errors, and examples that
  forward USDC to Aave on another chain, run a distributed swap as the body, and fund an intent by
  a transfer into its vault.
- **Load it** whenever the work crosses chains; `sauce-chains` says which chains take intents.
- **Asked as:** "Move my USDC from Base to Ethereum and supply it to Aave there."

### `sauce-async`

Promises: a request whose answer arrives later, in a transaction of its own (randomness, an oracle,
a cross-chain message, a proof), its `.then` body run when the protocol calls the Pot back;
`.catch`; `Promise.all`, `race`, `any`, `allSettled` and `withResolvers`; deadlines,
`Async.timeout` and the public `expire`; installing a package's handlers on a Private Pot; and
writing a package of the family.

- **Holds** a payment that waits for the owner's approval within a day, a deferred raced against
  a timeout, and the owner's cook that approves it by its key.
- **Load it** when a program must wait for a callback; a callback's protocol is a package of the
  family, which its own section here or its `sauce-protocols` document covers.
- **Asked as:** "Draw a random winner with Chainlink VRF and pay them when the number arrives."

### `sauce-remote`

Code run on your own Pot on another chain: `Base.remote(() => { … })` sends a program to the same
Pot there over a bridge (Hyperlane, LayerZero, Metalayer or Polymer); a round trip is a promise,
`.then` back with its answer and `.catch` with its revert, and `Promise.all` or `race` take
messages to several chains; which bridge, what each leg costs and which Pot pays, the handlers both
Pots install, and pairing a message with an intent that brings the money.

- **Holds** compiled programs: a body sent one way, a round trip with its answer, a bridge named,
  and a message that waits for an intent's money.
- **Load it** when a program should read or change its own Pot's state on another chain, or get an
  answer back from one. Moving money to another chain for a solver to deliver is `sauce-intents`.
- **Asked as:** "From Ethereum, supply my Pot's USDC on Base to Aave, and tell me what is left."

### `sauce-solana`

Programs for Solana: every account an `Account` parameter with its roles, the account manifest,
the Pot's key and token accounts, `@sauce/token` for SPL Token and Token-2022 (and what each
extension does to a program), CPIs and raw account reads, transaction size, and running through
the Kitchen or directly on the engine.

- **Holds** examples that move a mint's tokens and move PYUSD with `transferChecked`.
- **Load it** for any program compiled for Solana, beside the skill for the task: namespaces and
  token methods do not exist there.
- **Asked as:** "Send 10 TSLAx from my Pot to a wallet on Solana."

### `sauce-cli`

The `sauce` command, in the order a run takes it: look up names, compile, deploy the Pot, fund it,
rehearse (`sauce simulate`), print the unsigned transaction (`sauce tx`) or sign and send it
(`sauce run`), and read it back (`sauce inspect`); endpoints and signers, agent wallets and their
policies, arguments to `main`, and the MCP tool for each command.

- **Holds** a table of every command, the steps of a run with their flags and units, and example
  programs whose headers give the command lines that run them.
- **Load it** to compile, rehearse, send or read back, or when a command refuses a preview chain.
  The other skills say what to write; this one how to run it.
- **Asked as:** "Rehearse this program on Base, then send it from my keystore."

### `sauce-typescript`

The package from application code: compiling a program for a chain as `sauce compile` does,
encoding `main`'s arguments, the owner's Pot and its cook, the raw compiler and compact arguments,
the protocol registry, JSON action programs, settlement verification, the Solana client, intents
and cascades, and compiling in a browser.

- **Holds** runners that build a cook offline, run the raw compiler, compile an action program
  and verify a settlement; it is the one skill that points into the package's own guides.
- **Load it** when code, not a person at the command line, builds the transactions. The program
  itself is still SauceScript (`sauce-script`).
- **Asked as:** "How does my Node service compile a program and build its cook?"

### `sauce-examples`

The index of every example in every skill: each program with the chains it is checked on, each
actions document, and each runner with what it pins, each beside the skill that explains it.

- **Load it** to see a complete program for an idiom, then read its skill and write the program
  the task needs.
- **Asked as:** "Show me a complete Sauce program that swaps on Base."

## Paths for common tasks

- **Buy a token up to a price on Base**: `sauce-globals` (the token's symbol; a stock's is under
  Tokenized stocks) → `sauce-distributed-swap` → `sauce-cli` (`sauce simulate`, then `sauce run`,
  or `sauce tx` for the user's wallet).
- **Swap, then use the output**, such as supplying it to a lending market: `sauce-swaps` (the
  guard) → `sauce-protocols` (the market's registry file and document) → `sauce-script` (Calling a
  contract) → `sauce-cli`.
- **Run protocol steps that arrive as data**: `sauce-actions` (each action's fields in its
  reference) → `sauce-cli` (`sauce actions` prints the program a document lowers to).
- **Call a protocol**: `sauce-protocols` (its category in the index, then its registry file for
  the chain and its document's pitfalls) → `sauce-script` (Calling a contract).
- **A cross-chain intent**: `sauce-intents` → `sauce-chains` (both chains take intents) →
  `sauce-cli` (`sauce intent publish`, then `sauce intent status`).
- **Buy a token up to a price on Solana**: `sauce-solana` (accounts and token accounts) →
  `sauce-solana-distributed-swap` (`sauce pools --chain solana` for the pools and their slots) →
  `sauce-cli` (`sauce simulate` in a local copy, then `sauce run`).
- **Move a Token-2022 stock on Solana**: `sauce-globals` (Tokenized stocks, On Solana: its symbol,
  and how the command names its accounts) → `sauce-solana` (Token-2022 mints and their extensions)
  → `sauce-cli`.
- **Fix a program that does not compile**: `sauce-script` (Reading a compile error, and the
  language reference) → `sauce-globals` (a name that does not resolve) → `sauce-chains` (a name
  recorded on one chain and not another).
- **Integrate from TypeScript**: `sauce-typescript`, with `sauce-script` for the program the code
  compiles.

## Reading the skills over MCP

An agent with no skill files on disk reads the same files from the Sauce MCP server (`sauce mcp`).
`sauce_skills` lists every skill with its description and files (a skill with many references lists
a few, and how the rest are named). `sauce_skill` returns a skill's `SKILL.md`; with `path`, one of
its files, such as `references/builtins.md` of `sauce-script`; with `section`, only the part under
the heading holding those words; with `query`, only the lines holding a term. Read a large reference
that way: `references/base.md` of `sauce-chains` with `section` set to Tokens, or
`references/stocks.md` of `sauce-globals` with `query` set to a company's name. The same files are
resources, `sauce://skills/<skill>/SKILL.md` and `sauce://skills/<skill>/<path>`, listed at
`sauce://skills/index`. For TypeScript work, `sauce_dev` returns the package's own documents on a
topic, with `sauce-typescript`; and `sauce_install_skills` says how to put the skills in a project
for an agent that reads files.

## Example

[../sauce-distributed-swap/examples/distributed-swap.sauce.ts](../sauce-distributed-swap/examples/distributed-swap.sauce.ts)
is one complete program that keeps every rule above: it buys a token on Base across several
venues' pools up to one price, names everything through the chain's globals and `@sauce/router`,
checks the amount bought and its average price, refunds the unspent budget, and opens with the
header that says how to run it. `sauce-examples` lists every example in every skill, with the
chains each is checked on and the skill that explains it.
