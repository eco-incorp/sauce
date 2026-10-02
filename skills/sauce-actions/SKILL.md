---
name: sauce-actions
description: Write a Sauce program as a JSON actions document instead of SauceScript — swaps, bridges, wraps, staking, lending and token moves as data, tokens by registry symbol, protocol contracts by namespace and pools by their factory's key, one document for every chain that has its names — then compile, rehearse and send it with the sauce actions command and the program commands. Use when the job is a fixed sequence of protocol operations, when a service or another language produces the steps as data, when the user asks for an action program, actions JSON or an actions document, or when a document must be checked against a schema before it runs.
---

# Write an actions document

An **actions document** is JSON: an ordered list of protocol operations — swap on a pool, approve,
supply to a lending pool, bridge, wrap, stake — that compiles to one Sauce program. The program
runs every action in order, atomically, in one transaction on the Pot (`sauce-cli`), exactly as a
hand-written SauceScript program would: a swap is the same `@sauce/router` call a program makes.

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
the WETH in the Pot. It names no chain and no address, so the same document compiles on Ethereum,
Base and Arbitrum, each time to that chain's USDC, WETH and factory.

## Actions or SauceScript

| An actions document, when                                       | A SauceScript program (`sauce-script`), when                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| the job is a fixed sequence of the operations listed below      | it needs logic: conditions, loops, a price read and compared, a best venue    |
| the steps come from a service, a form or another language       | it opens an intent to another chain from inside the program (`sauce-intents`) |
| the document must be validated, stored or signed before it runs | it calls a contract or a method no action covers                              |
| every amount is fixed, an argument, or a balance read on chain  | it spends across several venues at once (`sauce-distributed-swap`)            |

Every action an actions document can hold is listed, with every field, in
[references/actions.md](references/actions.md), generated from the document's JSON Schema. A
document the schema refuses is always refused; beyond the schema, the chaining rules below and the
names are checked when it compiles.

## The document

`{ "version": 1, "actions": [ … ] }`. Each action is an object whose `"type"` picks its fields.

- Amounts are base-10 strings: `"1000000"` is 1 USDC. JSON numbers lose precision past 2^53, so a
  number is refused; fee tiers, indices, tick spacings and Unix times are plain integers.
- `"recipient": "self"` keeps an action's output in the Pot. An address there pays that account.
- Leave `chainId` out. A document with a `chainId` compiles for that chain only (its addresses are
  that chain's); without one, `--chain` picks the chain each time.

## Names

A token or contract field takes a name, the way a SauceScript program writes it, and the name
resolves on the chain the document is compiled for:

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

There, give the address — every field takes one. A contract a chain does not have is refused the
same way (`no "BalancerV2.Vault" on …: BalancerV2 is not deployed there`), with the chains that do
have it; a misspelt namespace gets the one it most likely means.

## Pools by key

A swap names its pool by address (`"pool"`), or by the key its factory files it under. The program
then reads the pool from the factory while it runs, and reverts before anything moves when the key
has no pool on that chain (`actions[1]: no pool under that key`). A key keeps a document
chain-agnostic, since pool addresses differ by chain.

| Action            | Give instead of `pool`                            | The factory, by name                                                |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `uniswapV3Swap`   | `factory` + `fee` (500 is 0.05%)                  | `UniswapV3.Factory`, `PancakeswapV3.Factory`                        |
| `uniswapV3Swap`   | `factory` + `tickSpacing`                         | `AerodromeSlipstream.CLFactory` (an Aerodrome Slipstream pool)      |
| `uniswapV2Swap`   | `factory`                                         | `UniswapV2.Factory`, `SushiswapV2.Factory`, `PancakeswapV2.Factory` |
| `traderJoeLBSwap` | `factory` + `binStep`; `tokenX`/`tokenY` optional | `TraderJoe.LBFactory`                                               |

`uniswapV4Swap` is already a key: `poolManager` (`UniswapV4.PoolManager`), the two tokens, `fee`,
`tickSpacing`, and `hooks` when the pool has any. Every other venue takes its pool by address: Curve,
Balancer, DODO, WOOFi, Maverick and the rest file several pools under one pair, or none by token.
A `uniswapV2Swap` on a fork whose fee is not 0.30% also gives `feePpm` (2500 for PancakeSwap V2).

## Chaining amounts

An action that spends an amount takes, in order: its `amount`; or `amountRef`, the output an
earlier action saved with `saveOutputAs`; or else the previous action's output. The first action
that spends must say where its amount comes from.

- A swap's, a stake's or a wrap's output is what it delivered to the Pot; an approve's, a supply's,
  a transfer's or a bridge's is the amount it spent.
- `{ "type": "argument", "name": "amount" }` makes the amount a runtime input: the compiled program
  takes it as `main`'s argument, passed with `--args`, so one compile serves every amount.
- `{ "type": "balanceOf", "token": "USDC" }` spends what the Pot holds when the program reaches it.
- When a later action spends an output, the action delivers it to the Pot, whatever its `recipient`.

[examples/swap-and-supply.json](examples/swap-and-supply.json) swaps an argument's WETH for USDC,
saves the USDC it received as `usdc`, approves the Aave pool for exactly that, and supplies it on
the Pot's behalf. [examples/swap-by-key.json](examples/swap-by-key.json) is the document above.
`amountOutMin` is fixed when the document is written, so set it from a quote for the amount you will
pass.

## Compile, rehearse, send

`sauce actions` prints the SauceScript the document lowers to on a chain, `main`'s parameters and
the bytecode; `--json` adds the document as parsed, the chain, and what `sauce compile --json`
reports. Read the source to check what the document does before it runs.

```sh
sauce actions swap.json --chain base
sauce actions swap.json --chain base --json
```

`compile`, `simulate`, `tx` and `run` take the document wherever they take a `.sauce.ts` file, with
the same flags (`sauce-cli` covers the Pot, endpoints, signers and funding):

```sh
sauce simulate swap.json --chain base --owner <address> \
  --assume-balance USDC:1000 --args 1000000000
sauce tx swap.json --chain base --owner <address> --value 0 --args 1000000000
sauce run swap.json --chain base --keystore <keystore> --args 1000000000
```

- `tx` and `run` build and send the cook on a chain the initial release supports: Ethereum or
  Base, the EVM chains among Ethereum, Base and Solana. On any other chain (a preview chain) the
  document lowers, compiles and simulates, and `tx` and `run` are refused, naming the supported
  chains and the chain-support request for that chain (`sauce-chains` says how to post it).
- `--args` gives the `argument` actions, in the order the document declares them.
- A document is refused with every problem at once, each on a line of its own with its path, such
  as a pool key without its fee:

  ```text
  actions[1].fee: missing: with `factory`, give `fee` too
  ```

Through an MCP client, the `sauce_actions` tool takes the same document and chain and returns what
`sauce actions --json` prints; given an owner it adds the cook as `transaction`, and on a preview
chain `refused` in its place.
