---
name: sauce-protocols
description: Every DeFi protocol a Sauce program can call, from the SDK's registry — an index by category with how to choose between them (a lending market versus another, a concentrated-liquidity pool versus a V2 pair or a stable pool, an aggregator, a bridge), a registry file per protocol (its deployments on every chain, how a program names each contract there, its ABI functions), and a document per protocol (what it is for, its pitfalls, a compiled example, its templates and notes). Covers every protocol as a registry namespace (deployed contracts, address-only contracts, interfaces called with .at(address)), available(...) for a chain that may lack one, ABI imports for unrecorded contracts, factories and pool lookups, and checking a recorded address has code. Use when a program must call a protocol (PancakeSwap V3, Aerodrome Slipstream, Curve, Balancer, Camelot, Lido, …), when the user asks which protocols or pools exist on a chain or which to use, needs a factory or router address, or wants a protocol's pitfalls.
---

# Protocols

Every protocol the SDK registers is in [references/index.md](references/index.md), grouped by
category, each with **how to choose between them**. Each protocol then has:

- `references/registry/<slug>.md`, generated from the registry: its deployments on every chain, how
  a program names each contract there, and its ABI functions (for example
  [references/registry/uniswap-v3.md](references/registry/uniswap-v3.md));
- `references/<slug>.md`, its document: what it is for, its pitfalls for a program, a compiled
  example, its templates and notes (for example [references/aave-v3.md](references/aave-v3.md)).

## When to use

- A program must call a protocol: find how it is named on the program's chain.
- Choosing between protocols that do the same job: the category's "Choosing between them".
- You need a factory, router or pool address on a chain, or want a protocol's pitfalls first.

## Quick reference

A program reaches a catalogued protocol through its **registry namespace**, with no import: the
address and the ABI come from the registry for the chain the program is compiled for. A namespace
member is one of three kinds:

| Member              | Example                                                  | In a program                         |
| ------------------- | -------------------------------------------------------- | ------------------------------------ |
| A deployed contract | `PancakeswapV3.Factory`, `AerodromeSlipstream.CLFactory` | its address; `.method(...)` calls it |
| An address only     | `Camelot.V3Factory` (no ABI the registry has verified)   | its address                          |
| An interface        | `Erc4626.Vault` (a vault has no one fixed address)       | `.at(address).method(...)`           |

`.at(address)` also reaches another deployment of a deployed contract's ABI. A contract the
registry does not record at all is called through its ABI, imported from
`./protocols/<slug>/<Export>.json` and bound with `.at(address)` to an address passed in as a
`main` input or a define.

A program that should also compile for a chain without the protocol asks `available(...)`, which is
decided when it is compiled; the branch it rules out is left out, names and all:

```sauce chain=base,arbitrum,optimism
function main(fee: Uint256) {
  const uni = UniswapV3.Factory.getPool(WETH, USDC, fee);
  let pancake = 0n;
  if (available(PancakeswapV3.Factory)) {
    pancake = PancakeswapV3.Factory.getPool(WETH, USDC, fee);
  }
  require(uni != 0n || pancake != 0n, "no WETH/USDC pool at that fee");
}
```

With that program in `pools.sauce.ts`, a run on Base passes nothing but the fee (in millionths:
`500` is the 0.05% tier):

```sh
npx sauce run pools.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --args 500
```

Written without `available(...)`, a member is required: the program does not compile for a chain
that lacks it.

## Decision guidance

| Question                     | Answer                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Which protocol for a job     | the category's "Choosing between them" in [references/index.md](references/index.md)                     |
| How to name a contract       | the registry file's "In a program" column for your chain                                                 |
| A chain may lack it          | `if (available(Namespace.Contract)) { … }`                                                               |
| A pool, not a fixed contract | look it up at run time through the factory (`getPool`, `getPair`), which returns `0` where there is none |
| A swap                       | through the Sauce Router wherever it services the pool (`sauce-swaps`), not the protocol's own router    |
| Code on another chain        | a Sauce intent (`sauce-intents`), not a bridge call alone                                                |

## Workflow

1. Find the protocol in [references/index.md](references/index.md) and open its registry file:
   check it is deployed on your chain and how a program names the contract there.
2. Read its document's pitfalls before writing the call.
3. Write the program, compile it for the chain (`sauce compile <file> --chain <slug>`), and hand the
   cook to any signer as `sauce tx`'s unsigned JSON, `{ chainId, to, data, value }`, or send it with
   `sauce run` (`sauce-run`). For the initial release that is on Ethereum, Base or Solana: every
   protocol on every chain compiles and simulates, but on a preview chain `sauce tx` and `sauce run`
   are refused with the chain-support request for that chain (`sauce-chains`).

## Common gotchas

- **Recorded is not live.** A registry address is what the registry records, not proof of code on
  the chain: confirm `eth_getCode` returns code before relying on it.
- **A document's templates are typed programs for the raw compiler**: their
  `import { PoolABI as IPool } from "./abis"` is served by the template's caller. In a program for a
  chain, use the namespace instead.
- **Some factories are addresses only** (Algebra forks such as Camelot V3 and QuickSwap V3): the
  registry has no verified ABI with their pool lookup, so discover the pool off chain and pass its
  address as a `main` input.
- **Solidity idioms in a document have SauceScript spellings**: `msg.sender` is `ctx.msgSender()`,
  `address(this)` is `ctx.self()`, and `type(uint256).max` is `~0n`
  ([../sauce-script/references/builtins.md](../sauce-script/references/builtins.md)).
- **Approve exactly what the call spends**: the Pot keeps any allowance it grants.

## Verification checklist

- [ ] The protocol is deployed on the program's chain, and the address has code.
- [ ] Each contract is named as its registry file says for that chain, or behind `available(...)`.
- [ ] The document's pitfalls are handled: approvals, balance deltas, minimums.
- [ ] The program compiles with `--chain`.
- [ ] Its transaction goes to a supported chain (Ethereum, Base or Solana); a protocol on a preview
      chain is compiled and simulated, and the chain requested.

## Example

[examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave and, where the chain has it,
PancakeSwap V3 through their namespaces; [examples/protocols.mts](examples/protocols.mts) compiles it
for Base, Arbitrum and Optimism (the last two preview chains, compiled only), loads a protocol
document, and compiles a protocol template.
