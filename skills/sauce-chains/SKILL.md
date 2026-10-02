---
name: sauce-chains
description: Everything about one chain a Sauce program can run on, generated from the SDK's registries — whether the initial release supports transactions there (Ethereum, Base and Solana; every other chain is a preview chain, compile and simulate only) and how to request one, its id, slug and aliases, kind, native coin, the Sauce engine, Kitchen and Router, whether it takes intents and its CCTP domain, its tokens with addresses, and every protocol deployed there with each contract's address and how a program names it. Covers how a name resolves per --chain, chain-qualified names, what compiling for a chain produces, and confirming that a recorded address has code. Use when the user asks what is on a chain or which chains are supported, needs a token or contract address on a chain, asks whether a chain has a protocol, takes intents or has a CCTP domain, picks a chain, a transaction is refused on a preview chain, or a name fails to compile on one chain but not another.
---

# Chains

Every chain the SDK knows has a file in [references/](references/index.md):
[references/index.md](references/index.md) lists them, and `references/<slug>.md` is one chain
(for example [references/base.md](references/base.md)). All of it is generated from the SDK's
registries, so it says what the package resolves when a program is compiled for that chain.

## Supported and preview chains

For the initial release, Sauce supports transactions on **Ethereum, Base and Solana** (`ethereum`,
`base`, `solana`). Every other chain is a **preview chain**: a program compiles for it, and
`sauce simulate` and the dry runs rehearse it there, but the `sauce` command and the MCP server
build and send no transaction on it — `sauce tx`, `sauce run`, `sauce pot --deploy`,
`sauce intent publish` and the intent steps sent there are refused before anything is read or
signed. The refusal names the supported chains and links that chain's chain-support request.
[references/index.md](references/index.md) has a Support column, and each chain's file says which
it is at the top.

To ask for a preview chain, or one the SDK does not know, look for it among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add the use case to it as a comment, or
[open a request](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with
the chain-support form: the chain and its id, what runs there, the protocols and tokens it needs,
and the expected volume and timing. A preview chain's file links its own request, prefilled.

## When to use

- You need a token's or a contract's address on a chain, or how a program names it there.
- You are choosing a chain: whether it is supported, which protocols it has, whether it takes
  intents, its CCTP domain.
- A transaction was refused on a preview chain: its file links the request to post.
- A program compiles for one chain and not another: the name is not recorded on the second.

## Quick reference

| In a chain's file | What it gives                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- |
| The top           | supported, or a preview chain with the link to request it                                     |
| The facts table   | slug and aliases for `--chain`, chain id, kind, the name a program uses, native coin          |
| Sauce             | the engine, Kitchen and Router a cook uses (EVM), or the engine and Kitchen programs (Solana) |
| Intents           | whether it takes intents, its eco-routes contracts and shared intent Pot (`sauce-intents`)    |
| In a program      | a compiled example of the chain's names                                                       |
| Tokens            | every token symbol a program can name there, with its address and decimals                    |
| Protocols         | every recorded deployment, each with how a program names it                                   |

A program compiled with `--chain <slug>` resolves every name to that chain's value: a token symbol
is that chain's token, a namespace contract that chain's deployment. The same file compiled for
another chain resolves them there, and fails to compile where a name is not recorded:

```sauce chain=base,arbitrum,ethereum
function main(recipient: Address, fee: Uint256) {
  // This chain's tokens: an address where a value is expected, a token where a method is called.
  const held = USDC.balanceOf(ctx.self());
  // Any other ERC-20, by address.
  require(Token(WETH).balanceOf(ctx.self()) >= 0n);
  // A namespace contract, called with no import.
  const pool = UniswapV3.Factory.getPool(USDC, WETH, fee);
  require(pool != 0n, "no USDC/WETH pool at that fee on this chain");
  // A contract on a named chain, from a program compiled for any chain.
  require(Ethereum.UniswapV3.Factory != 0n);
  // The chain the file was compiled for, against the one it runs on.
  require(ctx.chainId() == chainId, "compiled for another chain");
  USDC.transfer(recipient, held);
}
```

A protocol that is not a namespace on the chain is reached by importing its ABI and binding it to
the address the chain's file records, as a module constant a define can replace:

```sauce chain=base,arbitrum
import PancakeSwapV3FactoryABI from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";

const PANCAKE_V3_FACTORY = 0n; // the chain's file gives it: --define PANCAKE_V3_FACTORY=<address>

function main(fee: Uint256): Address {
  require(PANCAKE_V3_FACTORY != 0n, "set PANCAKE_V3_FACTORY");
  return PancakeSwapV3FactoryABI.at(PANCAKE_V3_FACTORY).getPool(USDC, WETH, fee);
}
```

## Decision guidance

| When                          | Look at                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Where a transaction can run   | a supported chain: Ethereum, Base or Solana; elsewhere compile and simulate only        |
| Which chain has a protocol    | the protocol's registry file in `sauce-protocols`, or the Protocols table of each chain |
| Whether a program can name it | the "In a program" column: a namespace needs no import, anything else is an ABI import  |
| Moving value between chains   | "Intents": both chains must take intents (`sauce-intents`); the CCTP domain for USDC    |
| Token order in a pool         | the token addresses: token0 is the lower one, and the order differs per chain           |
| Native coin or its ERC-20     | the native coin row: on some chains the coin is also an ERC-20 with other decimals      |

## Workflow

1. Open the chain's file and check that every name the program uses is listed there.
2. Compile for the chain: `sauce compile <file> --chain <slug>` prints the bytecode, and `--json`
   adds its size and `main`'s parameters.
3. The transaction is a cook on your Pot: `to` the Pot, `data` the Pot's `cook(engine, program)`
   with `main`'s arguments appended to the program, `value` the Kitchen's fee (plus any native the
   program spends). `sauce tx <file> --chain <slug> --owner <address> --args …` prints it as
   unsigned JSON, `{ chainId, to, data, value }`, for any wallet or signer to send; `sauce-cli`
   covers the command that signs and sends it too. On a preview chain `sauce tx` is refused: stop
   at compiling and simulating, and offer the user the chain-support request the refusal links.

## Common gotchas

- **Recorded is not live.** Every address here is as the registry records it; that is not proof of
  code on the chain. Before relying on one, confirm it has code: `eth_getCode` on the chain returns
  more than `0x`, or on Solana `getAccountInfo` returns an executable account. The Sauce release
  addresses are the same on every EVM chain, and deployed only where the release has been.
- **A name resolves on the chain where its part runs.** The file's own code and an intent's
  `.reward(...)` resolve on the chain the file is compiled for; inside an intent's braces, and in
  its delivery argument, `USDC` and every other chain-supplied name are the destination's
  (`sauce-intents`).
- **A chain-qualified name is a contract, not a token.** `Ethereum.UniswapV3.Factory` works from any
  chain; `Ethereum.USDC` does not: use the token's address.
- **Solana has no symbols.** The registry names no Solana token: accounts and mints are `main`'s
  `Account` parameters and defines (`sauce-solana`).

## Verification checklist

- [ ] Every name the program uses is listed in the chain's file, and it compiles with `--chain`.
- [ ] Every address the program relies on has code on that chain.
- [ ] Amounts are in the token's decimals, from the chain's Tokens table.
- [ ] For an intent, both chains take intents.
- [ ] For a transaction, the chain is supported (Ethereum, Base or Solana); a preview chain is
      compiled and simulated, and requested through its chain-support issue.

## Example

[examples/chains.sauce.ts](examples/chains.sauce.ts) is one file for every chain: it checks it runs
on the chain it was compiled for and that the chain's Uniswap V3 factory has a pool, and pays the
chain's USDC.
