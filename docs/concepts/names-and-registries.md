# Names and registries

**Concept** · [Documentation](../README.md) · [Glossary](glossary.md) · [Protocols and tokens](../guides/protocols-and-tokens.md)

> A program says `USDC`, not `0xA0b8…eB48`. Sauce keeps an address book of chains, tokens and
> protocols, and when it compiles your program for a chain, it looks each name up in that chain's
> pages. This page explains where the names come from, when they turn into addresses, and why some
> chains run programs while others only preview them.

Read it after [Swap by name](../guides/swap-by-name.md), where you used names without asking how
they work. It assumes you know what a program and a compile are ([Glossary](glossary.md)).

## One name, one address per chain

USDC is a different contract on each chain: on Ethereum it lives at `0xA0b8…eB48`, on Base at
`0x8335…2913`. A program that writes `USDC.transfer(to, amount)` does not pick either. It is
compiled for one chain at a time, and the compile puts in that chain's address.

The same goes for a protocol's contracts. `UniswapV3.Factory` is Uniswap V3's factory on the chain
the program is compiled for, with the functions its contract has there. So one file runs on every
chain whose names it uses, and each compile produces bytecode with that chain's addresses in it.

Nothing about the name survives into the transaction. The engine on chain reads addresses; the
names are for you and for the compiler.

## Where the names come from

The SDK carries the address book in its **registries**, which ship inside the package:

| Registry  | What it records                                                                             |
| --------- | ------------------------------------------------------------------------------------------- |
| Chains    | The 45 chains a program can name, each with a slug (`base`), aliases (`eth`) and a chain id |
| Tokens    | Each chain's token symbols with their addresses and decimals, tokenized stocks included     |
| Protocols | 133 protocols, each with its contracts per chain and the ABI of each one                    |

Each registry row is checked, in the SDK's own tests, against the contract deployed at its address:
a token's symbol and decimals, and the functions of each protocol contract the registry has an ABI
for. A contract the registry records by its address only is not checked against the chain. A token
symbol is in the registry because someone recorded it, not because a chain has it: only 18 of the
45 chains register token symbols. On the others, a program names a token by address with
`Token(address)`.

Names follow fixed rules. A protocol's **namespace** is its registry name in PascalCase
(`uniswap-v3` is `UniswapV3`), and its members are its contracts (`UniswapV3.Factory`). An
**interface** is an ABI with no fixed address, such as a pool, which a program calls with an
address it has. A **family alias** such as `Uniswap` groups a protocol's versions, and resolves a
contract only when exactly one version has it.
[Protocols and tokens](../guides/protocols-and-tokens.md#names) has every rule.

## When a name turns into an address

At compile time, for the chain named by `--chain`, and nowhere else.

- **Found:** the compile writes the chain's address in. `sauce compile --json` lists every name it
  applied, with its value and the chain it came from.
- **Not found:** the compile fails and names the chain. A name the chain lacks is zero there, and
  any use of it other than a test of it is refused at the use: a token the chain does not register,
  and a protocol contract not deployed there, with the chains that have it. A name no chain has is
  an unknown name, with the closest names suggested. Nothing is sent, because nothing compiled.
- **Maybe there:** `if (UniswapV3.Factory) { … }` tests the name, at compile time, for the chain
  the program is compiled for. The branch it rules out is not compiled, so one program can use a
  venue only where it exists.

From TypeScript, the same entries hang off each chain's export, `Base.USDC.address`, and do not
exist as bare names at run time. Bare `USDC` is SauceScript, read by the compiler.

## Recorded is not live

A registry says where a contract was deployed when the row was recorded. It does not say that the
contract still has code, that its owner has not paused it, or that a pool has liquidity today. A
compile proves the name is in the book; [`sauce simulate`](../guides/cli-run.md) proves the call
works on the chain as it is now. Simulate before you send.

## Supported and preview chains

Every chain in the registry is one a program can be compiled for. The `sauce`
command, and the MCP server built on it, sends transactions on four of them: **Ethereum**,
**Base**, **Arc** and **Solana**. These are the **supported chains**. Every other chain is a
**preview chain**:

- a program compiles there, and every lookup and read works;
- `sauce simulate` does not depend on the label: it runs wherever the release is deployed on the
  chain, and stops with an error naming the missing contract where it is not;
- the command builds nothing to sign and sends nothing, and says why: a cook is refused before
  anything is signed.

The split is the command's policy, not the registry's or the library's: the SDK's own builders
take any chain, and a TypeScript application that signs for itself decides for itself. A preview
chain becomes supported when the command adds it; until then the refusal links a request form for
it. [The sauce command](../guides/cli.md#supported-and-preview-chains) lists what each command does
on a preview chain, and [Chains](../reference/chains.md) lists every chain with its support.

## Next

- How the language around the names works: [SauceScript](saucescript.md).
- Use the names in a program, and from TypeScript: [Protocols and tokens](../guides/protocols-and-tokens.md).
