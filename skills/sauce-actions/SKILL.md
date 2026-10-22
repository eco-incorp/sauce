---
name: sauce-actions
description: A Sauce program written as a JSON actions document instead of SauceScript. An ordered list of swaps, bridges, wraps, staking, lending and token moves as data, tokens by registry symbol, protocol contracts by namespace and pools by their factory's key, so one document serves every chain that has its names; chaining one action's output into the next; runtime arguments; when a document fits and when SauceScript is needed; lowering it with sauce actions and running it with the program commands; with a reference of every action and field, generated from the document's JSON Schema. Use when the job is a fixed sequence of protocol operations, when a service or another language produces the steps as data, when the user asks for an action program, actions JSON or an actions document, or when a document must be checked against a schema before it runs.
---

# Actions documents

An **actions document** is JSON: an ordered list of protocol operations that compiles to one Sauce
program, run in order, atomically, in one cook on the Pot, exactly as a hand-written program would
(a swap is the same `@sauce/router` call). This skill owns the document: its shape, names, pools by
key, chaining amounts, and running it. Every action and field is in
[references/actions.md](references/actions.md), generated from the document's JSON Schema.

## When to use

| An actions document, when                                         | A SauceScript program (`sauce-script`), when                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| the job is a fixed sequence of the operations the reference lists | it needs logic: conditions, loops, a price read and compared, a best venue |
| the steps come from a service, a form or another language         | it calls a contract or a method no action covers                           |
| the document must be validated, stored or signed before it runs   | it spends across several venues under one price (`sauce-distributed-swap`) |
| every amount is fixed, an argument, or a balance read on chain    |                                                                            |

## Core model

- `{ "version": 1, "actions": [ … ] }`; each action is an object whose `"type"` picks its fields.
- **Names, not addresses**: a token field takes a registry symbol, a contract field a
  `Namespace.Contract`, a pool its factory's key; each resolves on the chain it is compiled for.
- **No `chainId`**: `--chain` picks the chain each time (a document with one compiles for that chain
  only).
- **Amounts chain**: an action spends its own `amount`, a saved output, or the previous action's
  output.
- **A document the schema refuses is always refused**; beyond the schema, the chaining rules and the
  names are checked when it compiles, every problem at once, each with its path.

```json chain=ethereum,base,arbitrum
{
  "version": 1,
  "actions": [
    { "type": "argument", "name": "amount" },
    {
      "type": "uniswapV3Swap",
      "tokenIn": "USDC",
      "tokenOut": "WETH",
      "factory": "UniswapV3.Factory",
      "fee": 500,
      "amountOutMin": "1",
      "recipient": "self"
    }
  ]
}
```

This sells `amount` USDC for WETH in the pool Uniswap V3's factory keys at the 0.05% fee, and keeps
the WETH in the Pot. It names no chain and no address, so it compiles on Ethereum, Base and
Arbitrum, each time to that chain's USDC, WETH and factory.

## Values

- **Amounts are base-10 strings**: `"1000000"` is 1 USDC. JSON numbers lose precision past 2^53, so
  a number is refused; fee tiers, indices, tick spacings and Unix times are plain integers.
- **`"recipient": "self"`** keeps an action's output in the Pot; an address pays that account. Ask
  the user which they want (`sauce-overview`).
- **`amountOutMin`** is fixed when the document is written: set it from a quote for the amount you
  will pass.

## Names

| Field takes         | Write                                   | Lists them                                       |
| ------------------- | --------------------------------------- | ------------------------------------------------ |
| a token             | its registry symbol: `"USDC"`, `"WETH"` | `sauce globals --chain <chain> --tokens`         |
| a contract          | `"Namespace.Contract"`: `"AaveV3.Pool"` | `sauce globals --chain <chain> --protocols`      |
| the native currency | `"native"`, where the venue trades it   | `uniswapV4Swap`, `ambientSwap`, a Balancer batch |
| any of these        | an address, `0x` and 40 hex digits      | always accepted                                  |

Symbols are upper case. A chain that does not register a name refuses the document when it
compiles, naming the field, the chain and the name:

```json fails chain=avalanche
{
  "version": 1,
  "actions": [
    { "type": "balanceOf", "token": "USDC" },
    { "type": "approve", "token": "USDC", "spender": "Permit2.Permit2" }
  ]
}
```

```text
actions[0].token: no token "USDC" on Avalanche C-Chain (chain 43114), which registers no token symbols — give its address there instead
```

There, give the address: every field takes one. A contract a chain does not have is refused the same
way (`no "BalancerV2.Vault" on …: BalancerV2 is not deployed there`), with the chains that have it; a
misspelt namespace gets the one it most likely means.

## Pools by key

A swap names its pool by address (`"pool"`), or by the key its factory files it under: the program
then reads the pool from the factory while it runs, and reverts before anything moves when the key
has no pool there (`actions[1]: no pool under that key`). A key keeps a document chain-agnostic.

| Action            | Give instead of `pool`                            | The factory, by name                                                |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `uniswapV3Swap`   | `factory` + `fee` (500 is 0.05%)                  | `UniswapV3.Factory`, `PancakeswapV3.Factory`                        |
| `uniswapV3Swap`   | `factory` + `tickSpacing`                         | `AerodromeSlipstream.CLFactory` (an Aerodrome Slipstream pool)      |
| `uniswapV2Swap`   | `factory`                                         | `UniswapV2.Factory`, `SushiswapV2.Factory`, `PancakeswapV2.Factory` |
| `traderJoeLBSwap` | `factory` + `binStep`; `tokenX`/`tokenY` optional | `TraderJoe.LBFactory`                                               |

- `uniswapV4Swap` is already a key: `poolManager` (`UniswapV4.PoolManager`), the two tokens, `fee`,
  `tickSpacing`, and `hooks` when the pool has any.
- Every other venue takes its pool by address: Curve, Balancer, DODO, WOOFi, Maverick and the rest
  file several pools under one pair, or none by token.
- A `uniswapV2Swap` on a fork whose fee is not 0.30% also gives `feePpm` (2500 for PancakeSwap V2).

## Chaining amounts

An action that spends an amount takes, in order: its `amount`; or `amountRef`, the output an earlier
action saved with `saveOutputAs`; or else the previous action's output. The first action that spends
must say where its amount comes from.

| Source                                             | What it is                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| a swap's, a stake's or a wrap's output             | what it delivered to the Pot                                                                 |
| `lidoUnstake`'s output                             | the stETH it queued: it delivers a withdrawal NFT, and the ETH only when that is claimed     |
| an approve's, a supply's, a transfer's, a bridge's | the amount it spent                                                                          |
| `{ "type": "argument", "name": "amount" }`         | a runtime input: `main`'s argument, passed with `--args`, so one compile serves every amount |
| `{ "type": "balanceOf", "token": "USDC" }`         | what the Pot holds when the program reaches it                                               |

When a later action spends an output, the action delivers it to the Pot, whatever its `recipient`.
[examples/swap-and-supply.json](examples/swap-and-supply.json) swaps an argument's WETH for USDC,
saves the USDC received as `usdc`, approves the Aave pool for exactly that, and supplies it on the
Pot's behalf.

## Lower, simulate, send

`sauce actions` prints the SauceScript the document lowers to on a chain, `main`'s parameters and
the bytecode; `--json` adds the document as parsed, the chain, and what `sauce compile --json`
reports. Read the source to check what the document does before it runs.

```sh
sauce actions swap.json --chain base
sauce actions swap.json --chain base --json
```

`compile`, `simulate`, `tx` and `run` take the document wherever they take a `.sauce.ts` file, with
the same flags (`sauce-cli`); `--args` gives the `argument` actions, in the order the document
declares them:

```sh
sauce simulate swap.json --chain base --owner <address> \
  --assume-balance USDC:1000 --args 1000000000
sauce tx swap.json --chain base --owner <address> --args 1000000000
sauce run swap.json --chain base --keystore <keystore> --args 1000000000
```

A document is refused with every problem at once, each on a line of its own with its path, such as
a pool key without its fee:

```text
actions[1].fee: missing: with `factory`, give `fee` too
```

Through an MCP client, the `sauce_actions` tool takes the same document and chain and returns what
`sauce actions --json` prints; given an owner it adds the cook as `transaction`, and on a preview
chain `refused` in its place.

## Pitfalls

- **A JSON number for an amount.** Write a base-10 string.
- **A `chainId` in the document.** It then compiles for that chain only; leave it out.
- **A first spending action with no amount source.** Give `amount`, `amountRef`, or an `argument` or
  `balanceOf` before it.
- **`amountOutMin` left loose.** It is fixed in the document: set it from a quote.
- **A pool key on a venue that has none** (Curve, Balancer, DODO, WOOFi, Maverick): give the pool's
  address.
- **Logic in a document** (a condition, a best venue): write SauceScript instead.

## Files

- [examples/swap-by-key.json](examples/swap-by-key.json): the document above, one swap by token
  symbols and a pool's factory key.
- [examples/swap-and-supply.json](examples/swap-and-supply.json): a swap's output saved by name,
  approved to the Aave pool and supplied on the Pot's behalf.
- [references/actions.md](references/actions.md): every action and field, generated from the JSON
  Schema.
