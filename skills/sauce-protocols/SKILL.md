---
name: sauce-protocols
description: Calling any DeFi protocol from a Sauce program and finding its contracts — registry namespaces versus ABI imports from ./protocols/<slug>/<Export>.json bound to a registry address, reading a protocol's per-chain deployments (factories, routers, pools), looking pools up on chain through factories, and the per-protocol documents (operations, addresses, ABI notes, pitfalls, SauceScript templates) this skill carries for every catalogued protocol. Use when a program must call a protocol that has no namespace (PancakeSwap V3, Aerodrome Slipstream, Curve, Balancer, Camelot, Lido, …), when the user asks which protocols or pools exist on a chain, needs a factory or router address, or wants protocol-specific instructions.
---

# Protocols from Sauce

There are two ways a program reaches a protocol:

1. **A registry namespace** (`AaveV3.Pool`, `UniswapV3.Factory`, …): address and ABI both come from
   the registry for the program's chain, with no import.
   [../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md) lists every
   one and its chains.
2. **Everything else** in the catalog: import the ABI the package serves at
   `./protocols/<slug>/<Export>.json`, and bind it to the address the protocol's `deployments`
   record for the program's chain. That address is a compile-time value: a module constant
   defaulting to `0n`, which `--define` replaces, so the program still compiles (with the venue left
   out) on a chain where the protocol is absent.

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

The factory's address is in the protocol's document,
[references/pancakeswap-v3.md](references/pancakeswap-v3.md), and in its registry module
(below). A namespace contract can be made optional the same way: it is the define
`Namespace_Contract` on chains where it is deployed, so `const UniswapV3_Factory = 0n;` plus an ABI
import makes `UniswapV3.Factory` a venue that is simply absent where Uniswap V3 is
(`sauce-globals`).

A factory lookup returns the zero address when no pool exists, so a program discovers pools at run
time instead of trusting a list. Some protocols ship without a factory ABI (Algebra forks such as
Camelot V3 and QuickSwap V3 record only a `v3Factory` address): discover the pool off chain and pass
its address in as a `main` input.

## Reading the registry (from TypeScript)

```ts
import { contracts, getProtocol, getProtocolsByChain, listProtocolSlugs } from "@eco-incorp/sauce";
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";

export const onBase = getProtocolsByChain(8453).map((p) => p.slug); // catalogued on Base
export const info = getProtocol("pancakeswap-v3"); // name, category, chains, website
export const slugs = listProtocolSlugs();
// Per-chain addresses by role, e.g. { factory, smartRouter, nonfungiblePositionManager }.
export const pancakeOnBase = pancakeV3.deployments.find((d) => d.chainId === 8453)?.addresses;
// Whether a namespace contract is callable by name on a chain, and where.
export const aave = contracts.on("base").AaveV3.Pool; // { available, address, abi, methods, … }
```

Each protocol module (`@eco-incorp/sauce/protocols/<slug>`) exports `protocolInfo`, `deployments`,
its ABIs (`…ABI`), and its SauceScript templates by name (`supply`, `swap`, `getPool`, …). A
catalogued protocol is not necessarily callable by name, and an address in `deployments` is a
recorded address, not proof of live code on the chain.

## Per-protocol documents

[references/](references/index.md) holds a document per catalogued protocol, written for agents:
operations, addresses per chain, ABI notes, pitfalls and the module's SauceScript templates. Read
the relevant one before writing protocol code instead of recalling details:
[references/index.md](references/index.md) indexes them by category, and
`references/<slug>.md` is one protocol's (a few catalogued protocols have none). From TypeScript,
`getProtocolSkill(slug)`, `getProtocolIndex()` and `listSkillSlugs()` from
`@eco-incorp/sauce/skills` return the same text.

Read their code with these in mind:

- Their templates are typed programs (`function main(pool: Address, …)`) for the compiler taken
  directly: a template's `import { PoolABI as IPool } from "./abis"` is a contract import, so the
  resolver serves the path `./abis` with that ABI's JSON. In a program for a chain, use the namespace
  or the `./protocols/<slug>/<Export>.json` import instead.
- Some snippets use Solidity idioms with a SauceScript spelling: `msg.sender` is `ctx.msgSender()`,
  `address(this)` is `ctx.self()`, and `type(uint256).max` is `~0n`
  ([../sauce-script/references/builtins.md](../sauce-script/references/builtins.md)).
- Their address tables are for looking up; in a program, pass an address as a define or a `main`
  input rather than pasting it.

## Example

[examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave through its namespace and
PancakeSwap V3 through an ABI import; [examples/protocols.mts](examples/protocols.mts) compiles it
for Base and Arbitrum with the registry's factory as the define, loads a protocol document, and
compiles a protocol template.
