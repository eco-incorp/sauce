---
name: sauce-chains
description: Everything about one chain a Sauce program can run on, generated from the SDK's registries — its id, slug and aliases, kind (EVM or Solana), native coin, the Sauce engine, Kitchen and Router addresses, whether it takes intents (the eco-routes deployment and the shared intent Pot) and its CCTP domain, its tokens with addresses, and every protocol deployed there with each contract's address and how a program names it (a namespace, or an ABI import bound to the address). Covers how a name resolves per --chain, chain-qualified names, what compiling for a chain produces, and confirming that a recorded address has code. Use when the user asks what is on a chain, needs a token or contract address on a chain, asks whether a chain has a protocol, takes intents or has a CCTP domain, picks a chain, or a name fails to compile on one chain but not another.
---

# Chains

Every chain the SDK knows has a file in [references/](references/index.md):
[references/index.md](references/index.md) lists them, and `references/<slug>.md` is one chain
(for example [references/base.md](references/base.md)). All of it is generated from the SDK's
registries, so it says what the package resolves when a program is compiled for that chain.

## When to use

- You need a token's or a contract's address on a chain, or how a program names it there.
- You are choosing a chain: which protocols it has, whether it takes intents, its CCTP domain.
- A program compiles for one chain and not another: the name is not recorded on the second.

## Quick reference

| In a chain's file | What it gives                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- |
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
   unsigned JSON, `{ chainId, to, data, value }`, for any wallet or signer to send; `sauce-run`
   covers the command that signs and sends it too.

## Common gotchas

- **Recorded is not live.** Every address here is as the registry records it; that is not proof of
  code on the chain. Before relying on one, confirm it has code: `eth_getCode` on the chain returns
  more than `0x`, or on Solana `getAccountInfo` returns an executable account. The Sauce release
  addresses are the same on every EVM chain, and deployed only where the release has been.
- **A name resolves on the chain the file is compiled for.** Inside an intent's body a bare token
  symbol is still the source chain's: name a destination token by its address there
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

## Example

[examples/chains.sauce.ts](examples/chains.sauce.ts) is one file for every chain: it checks it runs
on the chain it was compiled for and that the chain's Uniswap V3 factory has a pool, and pays the
chain's USDC.
