---
name: sauce-examples
description: A cookbook of complete Sauce programs, each run against real contracts before it ships — buying a tokenized stock under a price cap, a dollar-cost-averaging tick, a stop-loss and take-profit on Chainlink's price, an Aave V3 health-factor guard, lending idle USDC above a reserve, a weighted USDC payroll, a two-token rebalance, a read-only price survey run with sauce simulate, a cross-chain cascade that repays a loan on Base from Ethereum and sends the change back, and a Token-2022 stock payment on Solana — on Ethereum, Base and Solana; and an index of every example in the other skills, with the chains it is checked on and the sauce command that runs it. Use when the user says "show me an example", "sample Sauce program", "how do I write X in Sauce", or wants a complete program for a task such as buying a stock, DCA, a limit or stop order, a lending position, payroll, rebalancing, reading prices, a cross-chain intent or a Solana token payment.
---

# Sauce examples

The cookbook below is this skill's own: complete programs for tasks people run, each reading what
it acts on (balances, pool prices, an oracle, a lending position), guarding it, measuring what
moved and returning what it did, which `sauce simulate` prints decoded as the type `main` declares.
Read one for its idioms, with the skill that explains them, then write the program the task needs
(`sauce-overview`): an example shows how a correct program does a thing, and is not a template to
fill in. The examples in the other skills follow, each beside the skill that teaches it.

A program names no chain: `--chain` picks one, and the chains listed are the ones it is checked on.
Each program's first comment lines say what it does, give the `sauce` command that runs it with
every `main` parameter named, say what each parameter is and its units, and show one run on a
supported chain with real values. Runtime inputs are `main(...)` parameters passed with `--args`,
and an intent file's values are defines (`sauce-script`). Tokens and contracts are named, never
written as addresses: `USDC`, `SPCXon`, `UniswapV3.Factory`, `AaveV3.Pool`, `Chainlink.EthUsdFeed`.

For the initial release, Sauce supports transactions on Ethereum, Base and Solana. A chain marked
(preview) is a preview chain: the program is compiled for it, and its cook is checked to be
refused there, as the `sauce` command and the MCP server refuse every transaction on a preview
chain. Run an example's transaction on a supported chain; on a preview chain compile and simulate
it, and to run it there,
[request the chain](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml)
(or add the use case to its
[existing request](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)).

Before writing a program, look its names up: the chain's file in `sauce-chains`
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)) lists its tokens and
every protocol there with how a program names it, and the generated indexes of globals list the
names alone ([../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md),
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md),
[../sauce-globals/references/chains.md](../sauce-globals/references/chains.md)); or run
`sauce globals --chain <chain>`.

## Cookbook

Every program here is run, not only compiled, before the package ships: each EVM program through
`sauce simulate` and `sauce run` on Ethereum's or Base's state, against the real pools, oracle,
lending pool and intent contracts there, with its results held to those contracts' own quotes and
accounts; the Solana program through `sauce run` against the released engine, with `TSLAx`'s mint
as Solana holds it.

| Program                                                                                | Chains             | Task                                                                      | What it shows                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../sauce-examples/examples/buy-stock.sauce.ts`](examples/buy-stock.sauce.ts)         | `ethereum`         | Buy a tokenized stock (SpaceX, `SPCXon`) with USDC, under a price cap     | Every fee tier's pool read, the cheapest share after its fee chosen, the cap turned into that pool's price limit, `minShares`, the unspent budget refunded, `{ fee, spent, shares }` returned                                                                         |
| [`../sauce-examples/examples/dca.sauce.ts`](examples/dca.sauce.ts)                     | `base`, `ethereum` | One tick of a dollar-cost-averaging plan                                  | Nothing bought, and no failure, above `maxPrice` or short of a tranche; a limit at `maxPrice` with the fee on top; the average held to it after the swap; what is unspent kept for the next tick                                                                      |
| [`../sauce-examples/examples/stop-loss.sauce.ts`](examples/stop-loss.sauce.ts)         | `ethereum`         | Stop-loss and take-profit on the Pot's WETH                               | Chainlink's ETH/USD feed with a staleness bound, a floor below the oracle as the price limit moved by the pool's fee, a pool already past it left alone, a partial fill kept, `{ price, triggered, sold, received }`                                                  |
| [`../sauce-examples/examples/aave-health.sauce.ts`](examples/aave-health.sauce.ts)     | `base`, `ethereum` | Guard an Aave V3 position's health factor                                 | The account data read, the USDC debt that restores `target` worked out from it and Aave's oracle, capped by what is owed and held, `{ before, after, repaid }`; the reads the registry's Aave V3 ABI lacks in its own [`AaveV3Reads.json`](examples/AaveV3Reads.json) |
| [`../sauce-examples/examples/supply-idle.sauce.ts`](examples/supply-idle.sauce.ts)     | `ethereum`, `base` | Keep a USDC reserve liquid and lend the rest on Aave V3                   | Supply above the reserve, withdraw a shortfall up to what is supplied, skip a move under `minMove`, the aToken read from the pool                                                                                                                                     |
| [`../sauce-examples/examples/payroll.sauce.ts`](examples/payroll.sauce.ts)             | `base`, `ethereum` | Pay a team in USDC by weight                                              | Array arguments, every recipient checked before anything moves, the rounding remainder to the last, each payment measured at its recipient, `Uint256[]` returned                                                                                                      |
| [`../sauce-examples/examples/rebalance.sauce.ts`](examples/rebalance.sauce.ts)         | `base`, `ethereum` | Hold WETH and USDC at a target share of their value                       | Value priced by the pool, a band before any trade, the side over sold with a price limit either way, a partial fill left for the next run, the share before and after                                                                                                 |
| [`../sauce-examples/examples/eth-prices.sauce.ts`](examples/eth-prices.sauce.ts)       | `ethereum`         | Survey ETH's price across venues, changing nothing                        | Run with `sauce simulate`: Chainlink's feed, two Uniswap V3 pools and the V2 pair's price for a trade, the spread and the gap to the oracle, as one named record                                                                                                      |
| [`../sauce-examples/examples/repay-on-base.sauce.ts`](examples/repay-on-base.sauce.ts) | `ethereum`         | Repay a loan on Base with USDC held on Ethereum, and send the change back | An intent file whose body opens the next intent: the Pot's USDC measured; on Base, `BORROWER`'s Aave V3 USDC debt repaid (anyone may repay a debt for its borrower) and the change measured; a second intent paying it to `BORROWER` on Ethereum                      |
| [`../sauce-examples/examples/pay-stock.sauce.ts`](examples/pay-stock.sauce.ts)         | `solana`           | Pay a tokenized stock on Solana                                           | Token-2022 `transferChecked` for `TSLAx`, the source bound to the Pot and the destination to the payee, a floor the Pot keeps, what arrived measured, staged by `sauce run`                                                                                           |

Choosing a pool and a price limit, and the guard every swap needs, are `sauce-swaps`; several pools
under one limit is `sauce-distributed-swap`; how an intent and its cascade are published, filled
and paid is `sauce-intents`; Token-2022 and Solana's accounts are `sauce-solana`.

## Examples in other skills

### SauceScript programs

| Program                                                                                                                        | Chains                                             | Demonstrates                                                                                                                                                                                                                                                                                                                                                     | Skill                    |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`../sauce-chains/examples/holdings.sauce.ts`](../sauce-chains/examples/holdings.sauce.ts)                                     | `ethereum`, `base`                                 | One file for every EVM chain: `USDC`, `WETH`, a stock (`bCSPX`) and `UniswapV3.Factory` resolve to each chain's own, a Uniswap V3 pool looked up per chain, what the Pot holds returned as a record                                                                                                                                                              | `sauce-chains`           |
| [`../sauce-chains/examples/payout-solana.sauce.ts`](../sauce-chains/examples/payout-solana.sauce.ts)                           | `solana`                                           | A payout in cash and stock on Solana: `Account` parameters attached with `--account`, a token account's balance, USDC moved with SPL Token's `transfer` and TSLAx, a Token-2022 stock, with `transferChecked`; staged by `sauce run`                                                                                                                             | `sauce-chains`           |
| [`../sauce-script/examples/twap.sauce.ts`](../sauce-script/examples/twap.sauce.ts)                                             | `base`, `ethereum`                                 | Calling a contract: namespaces (the Uniswap V3 factory, and a pool it returns through `UniswapV3.Pool`) and the program's own ABI beside it ([`IOracle.json`](../sauce-script/examples/IOracle.json)) for the function the registry's pool ABI lacks, a tuple result destructured to the one field needed                                                        | `sauce-script`           |
| [`../sauce-globals/examples/globals.sauce.ts`](../sauce-globals/examples/globals.sauce.ts)                                     | `ethereum`, `optimism` (preview)                   | Every name available without an import: `USDT`/`USDC`, `Token(address)` bound once, `@sauce/token` functions, `AaveV3.Pool`, `ctx`                                                                                                                                                                                                                               | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.sauce.ts`](../sauce-protocols/examples/protocols.sauce.ts)                             | `base`, `arbitrum` (preview), `optimism` (preview) | Protocols through their namespaces: Aave V3, and a PancakeSwap V3 factory lookup where the chain has one (`available(...)`)                                                                                                                                                                                                                                      | `sauce-protocols`        |
| [`../sauce-swaps/examples/swap-leg.sauce.ts`](../sauce-swaps/examples/swap-leg.sauce.ts)                                       | `base`, `arbitrum` (preview)                       | One guarded Uniswap V3 leg: a price limit, the output measured as a delta, `minOut`, the unspent input returned                                                                                                                                                                                                                                                  | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.sauce.ts`](../sauce-distributed-swap/examples/distributed-swap.sauce.ts) | `base`                                             | A limit buy (SPCXc and WETH with USDC in its header) over Base's Slipstream, Uniswap V3 and V4 pools: one `trade` helper per pool per venue that skips missing, empty and past-limit pools and swaps up to the pool's fee-adjusted limit from one `maxPrice`, loops that only find pools, minimum and average-price checks, the rest refunded, a record returned | `sauce-distributed-swap` |
| [`../sauce-intents/examples/cross-chain.sauce.ts`](../sauce-intents/examples/cross-chain.sauce.ts)                             | `base`                                             | An intent file (top-level statements, values as defines): forward the Pot's measured USDC to Ethereum and supply it to Aave there, with a solver margin                                                                                                                                                                                                          | `sauce-intents`          |
| [`../sauce-intents/examples/swap-on-base.sauce.ts`](../sauce-intents/examples/swap-on-base.sauce.ts)                           | `ethereum`                                         | An intent file whose body is a distributed swap in one pass: WETH delivered on Base is offered to every Uniswap V3 and V4 pool with liquidity, each up to its own fee-adjusted limit, and the solver is paid in WETH on the source chain                                                                                                                         | `sauce-intents`          |
| [`../sauce-intents/examples/fund-by-transfer.sauce.ts`](../sauce-intents/examples/fund-by-transfer.sauce.ts)                   | `base`, `ethereum`                                 | Publishes an intent built elsewhere (its route and reward as inputs) from a Pot, funded by a transfer into its vault: one cook, no approval                                                                                                                                                                                                                      | `sauce-intents`          |
| [`../sauce-solana/examples/solana.sauce.ts`](../sauce-solana/examples/solana.sauce.ts)                                         | `solana`                                           | A Solana program: `Account` parameters with roles, the mint as a define, the `@sauce/token` SPL arm, proof the destination received the amount                                                                                                                                                                                                                   | `sauce-solana`           |
| [`../sauce-solana/examples/token-2022.sauce.ts`](../sauce-solana/examples/token-2022.sauce.ts)                                 | `solana`                                           | A Token-2022 transfer: PYUSD moved with `transferChecked`, the mint and its token program as accounts, what arrived measured                                                                                                                                                                                                                                     | `sauce-solana`           |
| [`../sauce-cli/examples/pay.sauce.ts`](../sauce-cli/examples/pay.sauce.ts)                                                     | `ethereum`, `optimism` (preview)                   | The `sauce` command's walkthrough: pay a recipient in USDC and USDT, SafeERC20 writes, both values `main` inputs                                                                                                                                                                                                                                                 | `sauce-cli`              |
| [`../sauce-cli/examples/split.sauce.ts`](../sauce-cli/examples/split.sauce.ts)                                                 | `base`, `arbitrum` (preview), `ethereum`           | Array and bool arguments: pay several recipients any token, and the chain's USDC as well                                                                                                                                                                                                                                                                         | `sauce-cli`              |

### Actions documents

| Document                                                                                           | Chains                                                         | Demonstrates                                                                                                        | Skill           |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| [`../sauce-actions/examples/swap-by-key.json`](../sauce-actions/examples/swap-by-key.json)         | `ethereum`, `base`, `arbitrum` (preview)                       | One swap by token symbols and a pool's factory key, the amount an argument: no chain and no address in the document | `sauce-actions` |
| [`../sauce-actions/examples/swap-and-supply.json`](../sauce-actions/examples/swap-and-supply.json) | `ethereum`, `base`, `arbitrum` (preview), `optimism` (preview) | Chaining: a swap's output saved by name, approved to the Aave pool and supplied on the Pot's behalf                 | `sauce-actions` |

### TypeScript runners

| Runner                                                                                                               | Compiles and checks                                                                                                                                                                                                            | Skill                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| [`../sauce-script/examples/saucescript.mts`](../sauce-script/examples/saucescript.mts)                               | what compiles, what a define changes, each rejected construct, per-target differences, and what compiling for a chain adds                                                                                                     | `sauce-script`           |
| [`../sauce-chains/examples/chains.mts`](../sauce-chains/examples/chains.mts)                                         | the holdings program on Ethereum and Base against the skill's table of resolved addresses, the refusals of names a chain lacks, chain-qualified names, and the Solana payout's accounts and mints                              | `sauce-chains`           |
| [`../sauce-globals/examples/globals.mts`](../sauce-globals/examples/globals.mts)                                     | the globals program, the SafeERC20 lowering of every write, the `IERC20` import rule, family aliases and `available(...)`                                                                                                      | `sauce-globals`          |
| [`../sauce-protocols/examples/protocols.mts`](../sauce-protocols/examples/protocols.mts)                             | the protocols program on chains with and without PancakeSwap V3, registry lookups, a per-protocol document, a protocol template                                                                                                | `sauce-protocols`        |
| [`../sauce-swaps/examples/swaps.mts`](../sauce-swaps/examples/swaps.mts)                                             | the guarded leg on two chains, `@sauce/router`'s functions, and the Router's entry points, price parameters and callbacks                                                                                                      | `sauce-swaps`            |
| [`../sauce-distributed-swap/examples/distributed-swap.mts`](../sauce-distributed-swap/examples/distributed-swap.mts) | the distributed swap for Base: its code in the skill, its typed reads, venues and lookups, V4 ids as `Uint256`, `maxPrice` and its limits, per-pool limits, `minTokens` and `maxAvgPrice`, each command's arguments, the cooks | `sauce-distributed-swap` |
| [`../sauce-intents/examples/intents.mts`](../sauce-intents/examples/intents.mts)                                     | both intent files: on which chain each name resolves, the fee requirement, a token-only child, the pool ABI's selectors, and the transactions that rehearse a body on a fork                                                   | `sauce-intents`          |
| [`../sauce-solana/examples/solana.mts`](../sauce-solana/examples/solana.mts)                                         | the Solana programs' manifests and arguments, the mints' token programs, and the client's `rpcUrl` requirement                                                                                                                 | `sauce-solana`           |
| [`../sauce-typescript/examples/cook.mts`](../sauce-typescript/examples/cook.mts)                                     | owner, Pot, deploy call, a program compiled with its arguments, the cook transaction, and the packaged Solana binaries                                                                                                         | `sauce-typescript`       |
| [`../sauce-typescript/examples/compiler.mts`](../sauce-typescript/examples/compiler.mts)                             | raw compilation, ABI-v1 and compact-v1 arguments, `@sauce/token` through the package's resolvers                                                                                                                               | `sauce-typescript`       |
| [`../sauce-typescript/examples/actions.mts`](../sauce-typescript/examples/actions.mts)                               | JSON action programs: validation, runtime amounts, a quote                                                                                                                                                                     | `sauce-typescript`       |
| [`../sauce-typescript/examples/verify.mts`](../sauce-typescript/examples/verify.mts)                                 | settlement verification: a payload, a cook, a tampered program, pins, reproduction                                                                                                                                             | `sauce-typescript`       |

## Run them

A program runs with the command in its first comment lines, from a project with
`@eco-incorp/sauce` installed. Rehearse it first: `sauce simulate` runs the cook from the Pot's
owner and prints what `main` returns, or why it reverts, and sends nothing.

```sh
sauce simulate examples/eth-prices.sauce.ts --chain ethereum --owner <address> \
  --args 1000000000000000000
sauce simulate examples/dca.sauce.ts --chain base --owner <address> \
  --assume-balance USDC:250 --args 250000000 2800000000
sauce run examples/dca.sauce.ts --chain base --keystore <keystore> --args 250000000 2800000000
```

A runner runs with Node, from its own directory, with the inputs its usage line names (the owner of
a Pot, a recipient, a fee in wei); none touches a network:

```sh
node ../sauce-distributed-swap/examples/distributed-swap.mts --owner <address> --recipient <address>
node ../sauce-typescript/examples/cook.mts --owner <address> --recipient <address>
```

Every program in this index is compiled through the `sauce` command on each chain listed, its
command line run offline (its cook built on each supported chain, and refused on each preview
chain), and every runner executed, by the package's own checks before it ships.
