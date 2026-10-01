---
name: sauce-protocols
description: Every DeFi protocol a Sauce program can call, from the SDK's registry — an index by category with how to choose between them (a lending market versus another, a concentrated-liquidity pool versus a V2 pair or a stable pool, an aggregator, a bridge), a registry file per protocol (its deployments on every chain, how a program names each contract there as a namespace or an ABI import bound to the address, and its ABI functions), and a document per protocol (what it is for, its pitfalls for a program, a compiled example, its SauceScript templates and notes). Covers registry namespaces versus ABI imports from ./protocols/<slug>/<Export>.json, factories and pool lookups, and confirming that a recorded address has code. Use when a program must call a protocol, when the user asks which protocols or pools exist on a chain or which to use, needs a factory or router address, or wants a protocol's pitfalls.
---

# Protocols

Every protocol the SDK registers is in [references/index.md](references/index.md), grouped by
category, each with **how to choose between them**. Each protocol then has:

- `references/registry/<slug>.md`, generated from the registry: its deployments on every chain, how
  a program names each contract there, and its ABI functions (for example
  [references/registry/uniswap-v3.md](references/registry/uniswap-v3.md));
- `references/<slug>.md`, its document: what it is for, its pitfalls for a program, a compiled
  example where it is a namespace, its SauceScript templates and notes (for example
  [references/aave-v3.md](references/aave-v3.md)).

## When to use

- A program must call a protocol: find how it is named on the program's chain.
- Choosing between protocols that do the same job: the category's "Choosing between them".
- You need a factory, router or pool address on a chain, or want a protocol's pitfalls first.

## Quick reference

A program reaches a protocol in one of two ways, and the registry file says which on each chain:

1. **A namespace** (`AaveV3.Pool`, `UniswapV3.Factory`, …): the address and the ABI both come from
   the registry for the program's chain, with no import.
2. **An ABI import** for everything else: import the ABI the compile serves at
   `./protocols/<slug>/<Export>.json` and bind it to the address the registry records for the
   chain. Make the address a module constant defaulting to `0n`, which a define replaces, so the
   program still compiles (with the protocol left out) on a chain that lacks it.

```sauce chain=base,arbitrum
import IPancakeV3Factory from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";

const PANCAKE_V3_FACTORY = 0n; // pancakeswap-v3 `deployments`, role `factory`, as a define

function main(fee: Uint256) {
  const uni = UniswapV3.Factory.getPool(WETH, USDC, fee);
  let pancake = 0n;
  if (PANCAKE_V3_FACTORY != 0n) {
    pancake = IPancakeV3Factory.at(PANCAKE_V3_FACTORY).getPool(WETH, USDC, fee);
  }
  require(uni != 0n || pancake != 0n, "no WETH/USDC pool at that fee");
}
```

With that program in `pools.sauce.ts`, a run on Base passes the factory:

```sh
npx sauce run pools.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --define PANCAKE_V3_FACTORY=<factory> --args 500
```

A namespace contract can be made optional the same way: it is the define `Namespace_Contract` on
the chains where it is deployed, so `const UniswapV3_Factory = 0n;` plus an ABI import makes
`UniswapV3.Factory` a venue that is simply absent where Uniswap V3 is (`sauce-globals`).

## Decision guidance

| Question                     | Answer                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which protocol for a job     | the category's "Choosing between them" in [references/index.md](references/index.md)                     |
| Namespace or import          | the registry file's "In a program" column for your chain: a namespace when it has one there              |
| A pool, not a fixed contract | look it up at run time through the factory (`getPool`, `getPair`), which returns `0` where there is none |
| A swap                       | through the Sauce Router wherever it services the pool (`sauce-swaps`), not the protocol's own router    |
| Code on another chain        | a Sauce intent (`sauce-intents`), not a bridge call alone                                                |

## Workflow

1. Find the protocol in [references/index.md](references/index.md) and open its registry file:
   check it is deployed on your chain and how a program names the contract there.
2. Read its document's pitfalls before writing the call.
3. Write the program, compile it for the chain (`sauce compile <file> --chain <slug>`), and hand the
   cook to any signer as `sauce tx`'s unsigned JSON, `{ chainId, to, data, value }`, or send it with
   `sauce run` (`sauce-run`).

## Common gotchas

- **Recorded is not live.** A registry address is what the registry records, not proof of code on
  the chain: confirm `eth_getCode` returns code before relying on it.
- **A document's templates are typed programs for the raw compiler**: their
  `import { PoolABI as IPool } from "./abis"` is served by the template's caller. In a program for a
  chain, use the namespace or the `./protocols/<slug>/<Export>.json` import instead.
- **Some protocols record no factory ABI** (Algebra forks such as Camelot V3 and QuickSwap V3 record
  only a `v3Factory` address): discover the pool off chain and pass its address as a `main` input.
- **Solidity idioms in a document have SauceScript spellings**: `msg.sender` is `ctx.msgSender()`,
  `address(this)` is `ctx.self()`, and `type(uint256).max` is `~0n`
  ([../sauce-script/references/builtins.md](../sauce-script/references/builtins.md)).
- **Approve exactly what the call spends**: the Pot keeps any allowance it grants.

## Verification checklist

- [ ] The protocol is deployed on the program's chain, and the address has code.
- [ ] Each contract is named as its registry file says for that chain.
- [ ] The document's pitfalls are handled: approvals, balance deltas, minimums.
- [ ] The program compiles with `--chain`.

## Example

[examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave through its namespace and
PancakeSwap V3 through an ABI import; [examples/protocols.mts](examples/protocols.mts) compiles it
for Base and Arbitrum with the registry's factory as the define, loads a protocol document, and
compiles a protocol template.
