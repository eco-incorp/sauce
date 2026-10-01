---
name: sauce-overview
description: Start here for any Sauce task — what Sauce is (a programmable-transaction runtime whose programs, written in SauceScript as .sauce.ts files, run atomically on EVM chains and Solana), the path from a program file to an executed transaction with the sauce command, the rules every program follows, and which Sauce skill to load next. Use when the user mentions Sauce, SauceScript, a .sauce or .sauce.ts file, @eco-incorp/sauce, the sauce command, a Pot, Kitchen, cook or engine, Eco intents, or asks to "write a Sauce program", "do this atomically on chain", or "swap/bridge/lend with Sauce".
---

# Sauce

**Sauce is a programmable-transaction runtime.** You write a program in **SauceScript**, a checked
subset of TypeScript, in a `.sauce.ts` file. It compiles for a chain into bytecode, and a Sauce
engine executes it inside one transaction: on an EVM chain through your Pot's
`cook(engine, program)`, on Solana through the Kitchen. Every step lands or none does. A program
has control flow, reads and checks, and the engine runs it as written: it is not a multicall, and
it does not use a magic header.

On top of the runtime sit **intents**: an offer of work on another chain, with a reward escrowed on
this one, written as a chain name called as a function: `Arbitrum(() => { ... }).reward({ ... })`.
A solver decides whether to fill it (`sauce-intents`).

## Writing a program

A program names what the chain it is compiled for supplies, with no import: token symbols such as
`USDC`, `Token(address)` for any other token, protocol namespaces such as `UniswapV3.Factory` and
`AaveV3.Pool`, chain names such as `Arbitrum`, and `ctx` for the transaction's context. The
smallest complete program:

```sauce chain=base,arbitrum
function main(recipient: Address, floor: Uint256) {
  const held = USDC.balanceOf(ctx.self());
  require(held >= floor, "not enough USDC in the Pot");
  USDC.transfer(recipient, held);
}
```

It names no chain. `sauce run <file> --chain base` compiles it for Base, where `USDC` is Base's
USDC; `--chain arbitrum` gives the same file Arbitrum's. What changes per call, such as `recipient`
and `floor`, is a parameter of `main`, passed with the transaction (`--args`), so one compiled
program serves every call. That program is for an EVM chain: on Solana every account, a recipient
included, is an `Account` parameter attached with `--account`, never an `Address` argument
(`sauce-solana`).

On an EVM chain the executing contract, `ctx.self()`, is the **Pot**: it holds the tokens and
makes the calls. A Pot belongs to one owner, its address follows from the owner
(`sauce pot --owner <address>`), and only the owner can run a program on it. Token writes are
SafeERC20 however they are spelled, so USDT works. On Solana the Pot is the Kitchen's account for
the owner, which the program is given as an account; `ctx.self()` there is the program's id.

Two references hold what a program can name. The language (types, operators, statements, and the
`ctx`, `crypto`, `Math`, `abi`, `evm` and `svm` builtins) is
[../sauce-script/references/builtins.md](../sauce-script/references/builtins.md); the names a chain
supplies are indexed in [../sauce-globals/references/](../sauce-globals/references/tokens.md), and
`sauce globals --chain <chain>` lists them for one chain. Take every address from those or from
the developer; never invent one.

## From a file to a transaction

The `sauce` command comes with the package, which needs Node.js 24 or newer: install it in the
project with `npm i -D -E @eco-incorp/sauce` and run it with `npx sauce`. With the program above
saved as `payout.sauce.ts`:

```sh
npx sauce globals --chain base                     # the names a program on Base can use
npx sauce compile payout.sauce.ts --chain base     # check it compiles: the bytecode
npx sauce simulate payout.sauce.ts --chain base --owner <address> --config sauce.config.json \
  --assume-balance USDC:1 --args <recipient> 1000000
npx sauce tx payout.sauce.ts --chain base --owner <address> --args <recipient> 1000000
npx sauce run payout.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --args <recipient> 1000000
```

**Units differ by flag.** `--args` and defines take base units: `1000000` is 1 USDC (6
decimals). `--assume-balance` and `--fund` take whole tokens: `USDC:1` is 1 USDC, and
`USDC:1000000n`, ending in `n`, the same in base units.

Compiling for a chain produces the program's bytecode; running it is one transaction to the
owner's Pot, `cook(engine, program)` with `main`'s arguments appended to the program, paying the
Kitchen's fee. `sauce tx` prints that transaction unsigned, `{ chainId, to, data, value }`, for
any wallet or signer to send; `sauce run` signs and sends it itself, deploying the Pot first if it
is not there. `sauce-run` covers each command. Endpoints come from a config file the developer passes, never
from the program or the environment. Without the CLI, the same steps are tools of the Sauce MCP
server (`npx -y @eco-incorp/sauce mcp`); `sauce-run` maps each command to its tool.

## Pick the next skill

| Task                                                                                      | Skill                    |
| ----------------------------------------------------------------------------------------- | ------------------------ |
| The language: the two program forms, `main(...)` inputs and defines, compile errors       | `sauce-script`           |
| Names with no import: tokens, `Token(...)`, protocol namespaces, chains, `ctx`            | `sauce-globals`          |
| What is on a chain: tokens, every protocol with its addresses, intents, the Sauce release | `sauce-chains`           |
| Every protocol: how to choose one, its deployments, how a program calls it, its pitfalls  | `sauce-protocols`        |
| Any swap: `@sauce/router`, price limits, the Pot's Router, the guard every leg needs      | `sauce-swaps`            |
| One swap split across every price-limit venue on a chain                                  | `sauce-distributed-swap` |
| Protocol operations as JSON data, not a program: actions documents                        | `sauce-actions`          |
| Continuing on another chain: intents, cascades, rewards                                   | `sauce-intents`          |
| Solana programs: accounts, SPL, the Kitchen                                               | `sauce-solana`           |
| Compiling and running: the `sauce` commands, the Pot, funding, simulating, publishing     | `sauce-run`              |
| Application code: compiling, arguments, cooks, actions and verification from TypeScript   | `sauce-typescript`       |
| An example to start from                                                                  | `sauce-examples`         |

## Rules for every program

1. **Nothing is left behind.** Measure outputs as balance deltas, move them out, return unspent
   input, and approve exactly what the next call spends. An intent's body runs on a Pot every
   intent to that chain shares, so there a leftover is anyone's.
2. **A swap leg must not strand input.** Swap exact input, enforce a minimum output with `require`,
   and return what a partial fill leaves (`sauce-swaps`).
3. **Every check belongs in the program.** A failed `require` reverts the whole transaction; that
   atomicity is the safety mechanism.
4. **An intent is an offer.** Never promise it will be filled.
5. **No endpoints or keys in code.** The package ships no RPC URL and reads no environment
   variable: endpoints and signers are passed on the command line or from a config file.

## Example

[../sauce-run/examples/pay.sauce.ts](../sauce-run/examples/pay.sauce.ts) pays a recipient in USDC
and USDT, and
[../sauce-distributed-swap/examples/distributed-swap.sauce.ts](../sauce-distributed-swap/examples/distributed-swap.sauce.ts)
is a complete swap. `sauce-examples` lists every example in every skill.
