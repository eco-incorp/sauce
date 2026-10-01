---
name: sauce-examples
description: Index of every example in the Sauce skills — each SauceScript program (.sauce.ts) with the chains it is checked on and the sauce command that runs it, and each TypeScript runner (.mts), what it demonstrates and which skill explains it. Use when the user says "show me an example", "sample Sauce program", "example .sauce file", "how do I write X in Sauce", or wants to see how a complete program does something (a payment, a swap, a distributed swap, a cross-chain intent, a protocol call, a Solana transfer).
---

# Sauce examples

Every example lives in the skill that explains it, and demonstrates an idiom. Read one for the
pattern, with its skill, then write the program the task needs (`sauce-overview`): an example is not
a template to fill in. A program names no chain: `--chain` picks one, and the chains below are the
ones it is checked on. Each program's first comment lines say what it does, give the `sauce`
command that runs it with every `main` parameter named, say what each parameter is and its units,
and show one run on a supported chain with real values.

For the initial release, Sauce supports transactions on Ethereum, Base and Solana. A chain marked
(preview) is a preview chain: the program is compiled for it, and its cook is checked to be
refused there, as the `sauce` command and the MCP server refuse every transaction on a preview
chain. Run an example's transaction on a supported chain; on a preview chain compile and simulate
it, and to run it there,
[request the chain](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml)
(or add the use case to its
[existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)). Each program's first comment lines say what it does and give the `sauce`
command that runs it; runtime inputs are `main(...)` parameters passed with `--args`, and an intent
file's values are defines (`sauce-script`).

Before writing a program, look its names up: the chain's file in `sauce-chains`
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)) lists its tokens and
every protocol there with how a program names it, and the generated indexes of globals list the
names alone ([../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md),
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md),
[../sauce-globals/references/chains.md](../sauce-globals/references/chains.md)); or run
`npx sauce globals --chain <chain>`.

## SauceScript programs

| Program                                                                                                                        | Chains                                                                            | Demonstrates                                                                                                                                                                                                                                                                                                                                            | Skill                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`../sauce-cli/examples/pay.sauce.ts`](../sauce-cli/examples/pay.sauce.ts)                                                     | `ethereum`, `optimism` (preview)                                                  | The smallest complete program: pay a recipient in USDC and USDT, SafeERC20 writes, both values `main` inputs                                                                                                                                                                                                                                            | `sauce-cli`              |
| [`../sauce-cli/examples/split.sauce.ts`](../sauce-cli/examples/split.sauce.ts)                                                 | `base`, `arbitrum` (preview), `ethereum`                                          | Array and bool arguments: pay several recipients any token, and the chain's USDC as well                                                                                                                                                                                                                                                                | `sauce-cli`              |
| [`../sauce-chains/examples/chains.sauce.ts`](../sauce-chains/examples/chains.sauce.ts)                                         | `base`, `arbitrum` (preview), `ethereum`                                          | One file for every chain: each name resolves on the chain it is compiled for, and the cook `sauce tx` prints for any signer                                                                                                                                                                                                                             | `sauce-chains`           |
| [`../sauce-script/examples/pool-state.sauce.ts`](../sauce-script/examples/pool-state.sauce.ts)                                 | `base`, `ethereum`                                                                | Calling a contract: a namespace (the Uniswap V3 factory) and the program's own ABI beside it ([`IPool.json`](../sauce-script/examples/IPool.json)), a tuple result destructured to the one field needed                                                                                                                                                 | `sauce-script`           |
| [`../sauce-globals/examples/globals.sauce.ts`](../sauce-globals/examples/globals.sauce.ts)                                     | `ethereum`, `optimism` (preview)                                                  | Every name available without an import: `USDT`/`USDC`, `Token(address)` bound once, `@sauce/token` functions, `AaveV3.Pool`, `ctx`                                                                                                                                                                                                                      | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.sauce.ts`](../sauce-protocols/examples/protocols.sauce.ts)                             | `base`, `arbitrum` (preview), `optimism` (preview)                                | Protocols through their namespaces: Aave V3, and a PancakeSwap V3 factory lookup where the chain has one (`available(...)`)                                                                                                                                                                                                                             | `sauce-protocols`        |
| [`../sauce-swaps/examples/swap-leg.sauce.ts`](../sauce-swaps/examples/swap-leg.sauce.ts)                                       | `base`, `arbitrum` (preview)                                                      | One guarded Uniswap V3 leg: a price limit, the output measured as a delta, `minOut`, the unspent input returned                                                                                                                                                                                                                                         | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.sauce.ts`](../sauce-distributed-swap/examples/distributed-swap.sauce.ts) | `base`, `arbitrum` (preview), `ethereum`, `optimism` (preview), `linea` (preview) | One exact-input swap across every Uniswap V3, PancakeSwap V3, Aerodrome Slipstream and hookless Uniswap V4 pool the chain has: pools with no liquidity skipped, each pool's fee read, ranked by the price a taker gets, one swap per pool up to its own fee-adjusted limit; a minimum output, an average-price floor, a refund and the outcome returned | `sauce-distributed-swap` |
| [`../sauce-intents/examples/cross-chain.sauce.ts`](../sauce-intents/examples/cross-chain.sauce.ts)                             | `base`                                                                            | An intent file (top-level statements, values as defines): forward the Pot's measured USDC to Ethereum and supply it to Aave there, with a solver margin                                                                                                                                                                                                 | `sauce-intents`          |
| [`../sauce-intents/examples/swap-on-base.sauce.ts`](../sauce-intents/examples/swap-on-base.sauce.ts)                           | `ethereum`                                                                        | An intent file whose body is a distributed swap in one pass: WETH delivered on Base is offered to every Uniswap V3 and V4 pool with liquidity, each up to its own fee-adjusted limit, and the solver is paid in WETH on the source chain                                                                                                                | `sauce-intents`          |
| [`../sauce-intents/examples/fund-by-transfer.sauce.ts`](../sauce-intents/examples/fund-by-transfer.sauce.ts)                   | `base`, `ethereum`                                                                | Funds an intent by a transfer into its vault, then publishes it: one cook on a Pot, no approval                                                                                                                                                                                                                                                         | `sauce-intents`          |
| [`../sauce-solana/examples/solana.sauce.ts`](../sauce-solana/examples/solana.sauce.ts)                                         | `solana`                                                                          | A Solana program: `Account` parameters with roles, the mint as a define, the `@sauce/token` SPL arm, proof the destination received the amount                                                                                                                                                                                                          | `sauce-solana`           |

## Actions documents

| Document                                                                                           | Chains                                                         | Demonstrates                                                                                                        | Skill           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| [`../sauce-actions/examples/swap-by-key.json`](../sauce-actions/examples/swap-by-key.json)         | `ethereum`, `base`, `arbitrum` (preview)                       | One swap by token symbols and a pool's factory key, the amount an argument: no chain and no address in the document | `sauce-actions` |
| [`../sauce-actions/examples/swap-and-supply.json`](../sauce-actions/examples/swap-and-supply.json) | `ethereum`, `base`, `arbitrum` (preview), `optimism` (preview) | Chaining: a swap's output saved by name, approved to the Aave pool and supplied on the Pot's behalf                 | `sauce-actions` |

## TypeScript runners

| Runner                                                                                                               | Compiles and checks                                                                                                                                                                                        | Skill                    |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`../sauce-script/examples/saucescript.mts`](../sauce-script/examples/saucescript.mts)                               | what compiles, what a define changes, each rejected construct, per-target differences, and what compiling for a chain adds                                                                                 | `sauce-script`           |
| [`../sauce-globals/examples/globals.mts`](../sauce-globals/examples/globals.mts)                                     | the globals program, the SafeERC20 lowering of every write, the `IERC20` import rule, family aliases and `available(...)`                                                                                  | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.mts`](../sauce-protocols/examples/protocols.mts)                             | the protocols program on chains with and without PancakeSwap V3, registry lookups, a per-protocol document, a protocol template                                                                            | `sauce-protocols`        |
| [`../sauce-swaps/examples/swaps.mts`](../sauce-swaps/examples/swaps.mts)                                             | the guarded leg on two chains, `@sauce/router`'s functions, and the Router's entry points, price parameters and callbacks                                                                                  | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.mts`](../sauce-distributed-swap/examples/distributed-swap.mts) | the distributed swap for Base, Arbitrum and Optimism with each chain's venues, the skill's V4 keys, selectors and worked prices, the cooks for selling and buying WETH, the Router's price-limited entries | `sauce-distributed-swap` |
| [`../sauce-intents/examples/intents.mts`](../sauce-intents/examples/intents.mts)                                     | both intent files: on which chain each name resolves, the fee requirement, a token-only child, the pool ABI's selectors, and the transactions that rehearse a body on a fork                               | `sauce-intents`          |
| [`../sauce-solana/examples/solana.mts`](../sauce-solana/examples/solana.mts)                                         | the Solana program's manifest and arguments, and the client's `rpcUrl` requirement                                                                                                                         | `sauce-solana`           |
| [`../sauce-typescript/examples/cook.mts`](../sauce-typescript/examples/cook.mts)                                     | owner, Pot, deploy call, a program compiled with its arguments, the cook transaction, and the packaged Solana binaries                                                                                     | `sauce-typescript`       |
| [`../sauce-typescript/examples/compiler.mts`](../sauce-typescript/examples/compiler.mts)                             | raw compilation, ABI-v1 and compact-v1 arguments, `@sauce/token` through the package's resolvers                                                                                                           | `sauce-typescript`       |
| [`../sauce-typescript/examples/actions.mts`](../sauce-typescript/examples/actions.mts)                               | JSON action programs: validation, runtime amounts, a quote                                                                                                                                                 | `sauce-typescript`       |
| [`../sauce-typescript/examples/verify.mts`](../sauce-typescript/examples/verify.mts)                                 | settlement verification: a payload, a cook, a tampered program, pins, reproduction                                                                                                                         | `sauce-typescript`       |

## Run them

A program runs with the command in its first comment lines, from a project with
`@eco-incorp/sauce` installed:

```sh
npx sauce compile ../sauce-cli/examples/pay.sauce.ts --chain ethereum
npx sauce tx ../sauce-cli/examples/pay.sauce.ts --chain ethereum --owner <address> --value 0 \
  --args <recipient> 1000000
```

A runner runs with Node, from its own directory, with the inputs its usage line names (the owner of
a Pot, a recipient, a fee in wei); none touches a network:

```sh
node ../sauce-distributed-swap/examples/distributed-swap.mts --owner <address> --recipient <address>
node ../sauce-typescript/examples/cook.mts --owner <address> --recipient <address>
```

Every program here is compiled through the `sauce` command on each chain listed, its command line
run offline (its cook built on each supported chain, and refused on each preview chain), and every
runner executed, by the package's own checks before it ships.
