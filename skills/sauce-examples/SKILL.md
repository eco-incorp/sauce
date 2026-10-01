---
name: sauce-examples
description: Index of every example in the Sauce skills — each SauceScript program (.sauce.ts) with the chains it is checked on and the sauce command that runs it, and each TypeScript runner (.mts), what it demonstrates and which skill explains it. Use when the user says "show me an example", "sample Sauce program", "example .sauce file", "how do I write X in Sauce", or wants a starting point to copy (a payment, a swap, a distributed swap, a cross-chain intent, a protocol call, a Solana transfer).
---

# Sauce examples

Every example lives in the skill that explains it. Copy the closest program, then read its skill
before changing it. A program names no chain: `--chain` picks one, and the chains below are the
ones it is checked on. Each program's first comment lines say what it does and give the `sauce`
command that runs it; runtime inputs are `main(...)` parameters passed with `--args`, and an intent
file's values are defines (`sauce-script`).

Before writing a program, look its names up in the generated indexes of globals:
[../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md) (token symbols per
chain, with addresses and decimals),
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md) (namespace
contracts and their chains) and
[../sauce-globals/references/chains.md](../sauce-globals/references/chains.md) (chain names and
ids), or run `npx sauce globals --chain <chain>`.

## SauceScript programs

| Program                                                                                                                        | Chains                                              | Demonstrates                                                                                                                                                                                                                                                | Skill                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`../sauce-run/examples/pay.sauce.ts`](../sauce-run/examples/pay.sauce.ts)                                                     | `ethereum`, `optimism`                              | The smallest complete program: pay a recipient in USDC and USDT, SafeERC20 writes, both values `main` inputs                                                                                                                                                | `sauce-run`              |
| [`../sauce-run/examples/split.sauce.ts`](../sauce-run/examples/split.sauce.ts)                                                 | `base`, `arbitrum`, `ethereum`                      | Array and bool arguments: pay several recipients any token, and the chain's USDC as well                                                                                                                                                                    | `sauce-run`              |
| [`../sauce-globals/examples/globals.sauce.ts`](../sauce-globals/examples/globals.sauce.ts)                                     | `ethereum`, `optimism`                              | Every name available without an import: `USDT`/`USDC`, `Token(address)` bound once, `@sauce/token` functions, `AaveV3.Pool`, `ctx`                                                                                                                          | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.sauce.ts`](../sauce-protocols/examples/protocols.sauce.ts)                             | `base`, `arbitrum`, `optimism`                      | Protocols through their namespaces: Aave V3, and a PancakeSwap V3 factory lookup where the chain has one (`available(...)`)                                                                                                                                 | `sauce-protocols`        |
| [`../sauce-swaps/examples/swap-leg.sauce.ts`](../sauce-swaps/examples/swap-leg.sauce.ts)                                       | `base`, `arbitrum`                                  | One guarded Uniswap V3 leg: a price limit, the output measured as a delta, `minOut`, the unspent input returned                                                                                                                                             | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.sauce.ts`](../sauce-distributed-swap/examples/distributed-swap.sauce.ts) | `base`, `arbitrum`, `ethereum`, `optimism`, `linea` | One exact-input swap across every Uniswap V3, PancakeSwap V3, Aerodrome Slipstream and hookless Uniswap V4 pool the chain has, ranked best price first, one swap per pool up to a common price limit; a minimum output, an average-price floor and a refund | `sauce-distributed-swap` |
| [`../sauce-intents/examples/cross-chain.sauce.ts`](../sauce-intents/examples/cross-chain.sauce.ts)                             | `base`, `optimism`                                  | An intent file (top-level statements, values as defines): forward the Pot's measured USDC to Arbitrum and supply it to Aave there, with a solver margin                                                                                                     | `sauce-intents`          |
| [`../sauce-intents/examples/swap-on-base.sauce.ts`](../sauce-intents/examples/swap-on-base.sauce.ts)                           | `arbitrum`, `optimism`                              | An intent file whose body is the distributed swap: WETH delivered on Base is sold on every Uniswap V3 and V4 pool up to a limit, and the solver is paid in WETH on the source chain                                                                         | `sauce-intents`          |
| [`../sauce-solana/examples/solana.sauce.ts`](../sauce-solana/examples/solana.sauce.ts)                                         | `solana`                                            | A Solana program: `Account` parameters with roles, the mint as a define, the `@sauce/token` SPL arm, proof the destination received the amount                                                                                                              | `sauce-solana`           |

## TypeScript runners

| Runner                                                                                                               | Compiles and checks                                                                                                                                                 | Skill                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`../sauce-script/examples/saucescript.mts`](../sauce-script/examples/saucescript.mts)                               | what compiles, what a define changes, each rejected construct, per-target differences, and what compiling for a chain adds                                          | `sauce-script`           |
| [`../sauce-globals/examples/globals.mts`](../sauce-globals/examples/globals.mts)                                     | the globals program, the SafeERC20 lowering of every write, the `IERC20` import rule, family aliases and optional-venue defines                                     | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.mts`](../sauce-protocols/examples/protocols.mts)                             | the protocols program on chains with and without PancakeSwap V3, registry lookups, a per-protocol document, a protocol template                                     | `sauce-protocols`        |
| [`../sauce-swaps/examples/swaps.mts`](../sauce-swaps/examples/swaps.mts)                                             | the guarded leg on two chains, `@sauce/router`'s functions, and the Router's entry points, price parameters and callbacks                                           | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.mts`](../sauce-distributed-swap/examples/distributed-swap.mts) | the distributed swap for Base, Arbitrum and Optimism with each chain's venues, its arguments for a WETH to USDC trade, the cook, the Router's price-limited entries | `sauce-distributed-swap` |
| [`../sauce-intents/examples/intents.mts`](../sauce-intents/examples/intents.mts)                                     | both intent files: on which chain each name resolves, the fee requirement, a token-only child                                                                       | `sauce-intents`          |
| [`../sauce-solana/examples/solana.mts`](../sauce-solana/examples/solana.mts)                                         | the Solana program's manifest and arguments, and the client's `rpcUrl` requirement                                                                                  | `sauce-solana`           |
| [`../sauce-typescript/examples/cook.mts`](../sauce-typescript/examples/cook.mts)                                     | owner, Pot, deploy call, a program compiled with its arguments, the cook transaction, and the packaged Solana binaries                                              | `sauce-typescript`       |
| [`../sauce-typescript/examples/compiler.mts`](../sauce-typescript/examples/compiler.mts)                             | raw compilation, ABI-v1 and compact-v1 arguments, `@sauce/token` through the package's resolvers                                                                    | `sauce-typescript`       |
| [`../sauce-typescript/examples/actions.mts`](../sauce-typescript/examples/actions.mts)                               | JSON action programs: validation, runtime amounts, a quote                                                                                                          | `sauce-typescript`       |
| [`../sauce-typescript/examples/verify.mts`](../sauce-typescript/examples/verify.mts)                                 | settlement verification: a payload, a cook, a tampered program, pins, reproduction                                                                                  | `sauce-typescript`       |

## Run them

A program runs with the command in its first comment lines, from a project with
`@eco-incorp/sauce` installed:

```sh
npx sauce compile ../sauce-run/examples/pay.sauce.ts --chain ethereum
npx sauce tx ../sauce-run/examples/pay.sauce.ts --chain ethereum --owner <address> --value 0 \
  --args <recipient> 1000000
```

A runner runs with Node, from its own directory, with the inputs its usage line names (the owner of
a Pot, a recipient, a fee in wei); none touches a network:

```sh
node ../sauce-distributed-swap/examples/distributed-swap.mts --owner <address> --recipient <address>
node ../sauce-typescript/examples/cook.mts --owner <address> --recipient <address>
```

Every program here is compiled through the `sauce` command on each chain listed, its command line
run offline, and every runner executed, by the package's own checks before it ships.
