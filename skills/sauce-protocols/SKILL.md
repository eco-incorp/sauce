---
name: sauce-protocols
description: Choosing and calling a DeFi protocol from a Sauce program, from the SDK's registry. An index of every protocol by category with how to choose between them (a lending market against another, a concentrated-liquidity pool against a V2 pair or a stable pool, an aggregator, a bridge), a generated registry file per protocol (its deployments on every chain, how a program names each contract there, its ABI functions), and a document per protocol (what it is for, its pitfalls for a program, a compiled example, its templates). Covers reaching a protocol through its namespace or an ABI import, a chain that may lack it, factories and pool lookups, address-only factories, Solidity idioms in SauceScript, and checking a recorded address has code. Use when a program must call a protocol (Aave, Morpho, Lido, Curve, Balancer, PancakeSwap V3, Aerodrome Slipstream, Camelot, CCTP, …), when the user asks which protocols or pools exist on a chain or which to use, needs a factory or router address, or wants a protocol's pitfalls.
---

# Protocols

Every protocol the SDK registers, and how a program reaches it. This skill owns choosing a
protocol and the per-protocol facts: the index by category, a registry file and a document per
protocol. How a call is written is `sauce-script`'s; what a namespace member is, `sauce-globals`'s;
a swap, `sauce-swaps`'s.

## When to use

| Task                                                       | Here | Elsewhere                                                             |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| Pick a protocol for a job (lend, stake, bridge, a pool)    | yes  |                                                                       |
| A protocol's deployments, contract names and ABI functions | yes  | one chain's every protocol: `sauce-chains`                            |
| A protocol's pitfalls before calling it                    | yes  |                                                                       |
| A swap                                                     |      | `sauce-swaps` (a program never swaps through a protocol's own router) |
| Work on another chain                                      |      | `sauce-intents` (not a bridge call alone)                             |

## Core model

Each protocol has three files under [references/](references/index.md):

| File                                                                                  | Generated | Gives                                                                                      |
| ------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| [references/index.md](references/index.md)                                            | yes       | every protocol by category, each category with "Choosing between them"                     |
| `references/registry/<slug>.md`, e.g. [uniswap-v3](references/registry/uniswap-v3.md) | yes       | its deployments on every chain, how a program names each contract there, its ABI functions |
| `references/<slug>.md`, e.g. [aave-v3](references/aave-v3.md)                         | no        | what it is for, its pitfalls for a program, a compiled example, its templates and notes    |

A program reaches a protocol through its **registry namespace**, with no import: address and ABI
come from the registry for the chain it is compiled for (`AaveV3.Pool.supply(...)`). Where the
chain has no namespace for it, through the protocol's **ABI import**,
`./protocols/<slug>/<Export>.json`, bound with `.at(address)` to an address passed as a `main`
input. Namespace members (deployed contract, address only, interface) are `sauce-globals`'s.

## Choosing

| Question                     | Answer                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which protocol for a job     | the category's "Choosing between them" in [references/index.md](references/index.md)                     |
| How to name a contract       | the registry file's "In a program" column for your chain                                                 |
| A chain may lack it          | `if (available(Namespace.Contract)) { … }` (`sauce-globals`)                                             |
| A pool, not a fixed contract | look it up at run time through the factory (`getPool`, `getPair`), which returns `0` where there is none |
| An address-only factory      | discover the pool off chain and pass its address as a `main` input                                       |
| A swap                       | a `@sauce/router` function for the venue (`sauce-swaps`)                                                 |
| Code on another chain        | an intent (`sauce-intents`)                                                                              |

## Calling a protocol

1. **Find it**: its category in [references/index.md](references/index.md), then its registry file:
   is it deployed on the program's chain, and how does a program name the contract there?
2. **Read its document's pitfalls** (`references/<slug>.md`) before writing the call: approvals,
   who receives the output, caps and pauses, rebasing receipts.
3. **Write the call** through the namespace, deciding who receives the output (`sauce-script`).
   A program meant also for a chain without the protocol asks `available(...)`, decided when it is
   compiled; the branch it rules out is left out, names and all:

```sauce chain=base,arbitrum,optimism
function main(fee: Uint256) {
  const uni = UniswapV3.Factory.getPool(WETH, USDC, fee);
  let pancake = 0;
  if (available(PancakeswapV3.Factory)) {
    pancake = PancakeswapV3.Factory.getPool(WETH, USDC, fee);
  }
  require(uni != 0 || pancake != 0, "no WETH/USDC pool at that fee");
}
```

4. **Compile, simulate and run it** (`sauce-cli`). With that program in `pools.sauce.ts`, a run on
   Base passes nothing but the fee, in millionths (`500` is the 0.05% tier):

```sh
sauce run pools.sauce.ts --chain base --keystore <keystore> \
  --args 500
```

## Reading a protocol document

- **Its templates are typed programs for the raw compiler**: their
  `import { PoolABI as IPool } from "./abis"` is served by the template's caller. In a program for
  a chain, use the namespace instead.
- **Its Solidity idioms have SauceScript spellings**:

| Solidity            | SauceScript       |
| ------------------- | ----------------- |
| `msg.sender`        | `ctx.msgSender()` |
| `address(this)`     | `ctx.self()`      |
| `type(uint256).max` | `~0`              |

- **"The caller" or "self" is the Pot** in a Sauce program: what lands there stays in the Pot, not
  in the user's wallet, until another cook moves it.

## Pitfalls

- **Recorded is not live.** A registry address is not proof of code: confirm `eth_getCode` returns
  code before relying on it.
- **Swapping through a protocol's own router.** Use `@sauce/router` (`sauce-swaps`).
- **An address-only factory called for a pool** (Algebra forks such as Camelot V3 and QuickSwap
  V3): the registry has no verified ABI with its pool lookup; pass the pool as a `main` input.
- **A standing allowance.** Approve exactly what the call spends: the Pot keeps any allowance it
  grants.
- **An output left in the Pot by default.** A call naming no beneficiary credits its caller, the
  Pot; pass the user's wallet where they chose it.
- **A receipt measured by the amount supplied.** Rebasing receipts (aTokens) grow: measure deltas.

## Files

- [examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave and, where the chain has
  it, PancakeSwap V3 through their namespaces.
- [examples/protocols.mts](examples/protocols.mts) compiles it for Base, Arbitrum and Optimism (the
  last two preview chains, compiled only), loads a protocol document, and compiles a protocol
  template.
- [references/index.md](references/index.md), `references/registry/<slug>.md` (generated) and
  `references/<slug>.md` (one document per protocol).
