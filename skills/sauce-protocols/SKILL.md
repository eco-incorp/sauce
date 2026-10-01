---
name: sauce-protocols
description: Calling any DeFi protocol from a Sauce program and finding its contracts — every catalogued protocol as a registry namespace (deployed contracts with their methods, address-only contracts, interfaces called with .at(address)), using a protocol only on chains that have it with available(...), ABI imports from ./protocols/<slug>/<Export>.json for a contract the registry does not record, reading a protocol's per-chain deployments (factories, routers, pools), looking pools up on chain through factories, and the per-protocol documents (operations, addresses, ABI notes, pitfalls, SauceScript templates) this skill carries for every catalogued protocol. Use when a program must call a protocol (PancakeSwap V3, Aerodrome Slipstream, Curve, Balancer, Camelot, Lido, …), when the user asks which protocols or pools exist on a chain, needs a factory or router address, or wants protocol-specific instructions.
---

# Protocols from Sauce

A program reaches a catalogued protocol through its **registry namespace**, with no import: the
address and the ABI come from the registry for the chain the program is compiled for.
[../sauce-globals/references/protocols.md](../sauce-globals/references/protocols.md) lists every
deployed contract and its chains. A namespace member is one of three kinds:

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

With that program in `pools.sauce.ts`, a run on Base passes nothing but the fee:

```sh
npx sauce run pools.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --args 500
```

A factory lookup returns the zero address when no pool exists, so a program discovers pools at run
time instead of trusting a list. Some protocols' factories are addresses only (Algebra forks such as
Camelot V3 and QuickSwap V3): discover the pool off chain and pass its address in as a `main` input.

## Reading the registry (from TypeScript)

```ts
import { contracts, getProtocol, getProtocolsByChain, listProtocolSlugs } from "@eco-incorp/sauce";
import * as pancakeV3 from "@eco-incorp/sauce/protocols/pancakeswap-v3";

export const onBase = getProtocolsByChain(8453).map((p) => p.slug); // catalogued on Base
export const info = getProtocol("pancakeswap-v3"); // name, category, chains, website
export const slugs = listProtocolSlugs();
// Per-chain addresses by role, e.g. { factory, smartRouter, nonfungiblePositionManager }.
export const pancakeOnBase = pancakeV3.deployments.find((d) => d.chainId === 8453)?.addresses;
// Whether a namespace contract is deployed on a chain, and where.
export const aave = contracts.on("base").AaveV3.Pool; // { available, address, abi, methods, … }
export const pancake = contracts.on("optimism").PancakeswapV3.Factory.available; // false
```

Each protocol module (`@eco-incorp/sauce/protocols/<slug>`) exports `protocolInfo`, `deployments`,
its ABIs (`…ABI`), and its SauceScript templates by name (`supply`, `swap`, `getPool`, …). An
address in `deployments` is a recorded address, not proof of live code on the chain.

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
  resolver serves the path `./abis` with that ABI's JSON. In a program for a chain, use the
  namespace instead.
- Some snippets use Solidity idioms with a SauceScript spelling: `msg.sender` is `ctx.msgSender()`,
  `address(this)` is `ctx.self()`, and `type(uint256).max` is `~0n`
  ([../sauce-script/references/builtins.md](../sauce-script/references/builtins.md)).
- Their address tables are for looking up; in a program, pass an address as a define or a `main`
  input rather than pasting it.

## Example

[examples/protocols.sauce.ts](examples/protocols.sauce.ts) calls Aave and, where the chain has it,
PancakeSwap V3 through their namespaces; [examples/protocols.mts](examples/protocols.mts) compiles it
for Base, Arbitrum and Optimism, loads a protocol document, and compiles a protocol template.
