---
name: sauce-chains
description: What each chain makes of a Sauce program's names, and each chain's facts from the registries. One file compiled for Ethereum and for Base gets each chain's own USDC, WETH, tokenized stocks, protocol contracts (UniswapV3.Factory) and chainId; a name a chain lacks is refused when compiling, with the error quoted; Base.UniswapV3.Factory is only Base's address, never a call there; tokens are never qualified; the same names compiled for Solana; chainId against ctx.chainId(). A generated file per chain (supported or preview, ids, native coin, CCTP domain, every token with its address and decimals, every protocol deployment with how a program names it) and one file of the Sauce deployment (engine, Kitchen, Routers, the Solana programs), the same on every chain. Use when the user needs an address, asks what is on a chain or which chain has something, writes one program for several chains, or a name compiles on one chain and not another.
---

# Chains

A program names no chain and no address: it names tokens and contracts, and the chain it is
compiled for decides what each one is. This skill owns that per-chain resolution and every chain's
facts: a generated file per chain in [references/](references/index.md), and the Sauce deployment,
the same everywhere, in [references/deployments.json](references/deployments.json). The vocabulary
of names is `sauce-globals`'s; which chains take transactions is `sauce-overview`'s.

## When to use

| Task                                                               | Here                               | Elsewhere                                      |
| ------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------- |
| A token's or a contract's address on a chain; a chain's id or coin | yes                                |                                                |
| What one chain offers: tokens, protocols, CCTP domain              | yes                                | one protocol on every chain: `sauce-protocols` |
| One program for several chains; a name one chain refuses           | yes                                |                                                |
| The engine, Kitchen or Router addresses                            | yes, `references/deployments.json` |                                                |
| Whether a name exists at all, and how to use it                    |                                    | `sauce-globals`                                |
| Writing for Solana's accounts                                      |                                    | `sauce-solana`                                 |

## Core model

- **The compiled-for chain decides every name.** `--chain base` makes every token symbol, protocol
  contract and `chainId` Base's. One file serves every chain whose names it uses.
- **A name a chain lacks is a compile error**, never a zero address at run time.
- **Another chain's contract, qualified (`Base.UniswapV3.Factory`), is only its address**: a value
  to pass across chains, never a contract to call.
- **Recorded is not live.** Every address here is what the registry records, not proof of code.
- **The Sauce deployment is the same on every chain**, written once in
  [references/deployments.json](references/deployments.json); no chain's file repeats it.

## Names resolve per chain

[examples/holdings.sauce.ts](examples/holdings.sauce.ts) is one file for every EVM chain. It looks
up the USDC/WETH pool on the chain's Uniswap V3 factory and reads what the Pot holds:

```sauce chain=ethereum,base
function main(fee: Uint256): { pool: Address; usdc: Uint256; weth: Uint256; bcspx: Uint256 } {
  const pot = ctx.self();
  const pool = UniswapV3.Factory.getPool(USDC, WETH, fee);
  require(pool != 0, "no USDC/WETH pool at that fee on this chain");
  return {
    pool: pool,
    usdc: pot.USDC,
    weth: pot.WETH,
    bcspx: pot.bCSPX,
  };
}
```

Compiled for each chain, the same names are different contracts:

| Name                | `--chain ethereum`                           | `--chain base`                               |
| ------------------- | -------------------------------------------- | -------------------------------------------- |
| `USDC`              | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `WETH`              | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0x4200000000000000000000000000000000000006` |
| `bCSPX` (a stock)   | `0x1e2C4fb7eDE391d116E6B41cD0608260e8801D59` | `0xC3cE78B037DDA1B966D31EC7979d3f3a38571A8E` |
| `UniswapV3.Factory` | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| `chainId`           | `1`                                          | `8453`                                       |

`bCSPX` is Backed's tokenized S&P 500 fund. The pool the factory returns differs per chain too, and
every balance is read on the chain the cook runs on. To see what a file's names became:

```sh
sauce globals --chain base                      # the chain's tokens and protocol contracts
sauce globals --chain base --search tesla       # a token or stock by symbol, name or ticker
sauce globals --chain base --protocol UniswapV3 # one namespace, with its methods
sauce compile holdings.sauce.ts --chain base --json
```

The `--json` compile lists `defines` (each token and `chainId` with its value) and `contracts`
(each namespace contract with its address).

### A name the chain lacks

Base registers no USDT:

```sauce chain=base fails
function main(recipient: Address, amount: Uint256) {
  USDT.transfer(recipient, amount);
}
```

```text
sauce compile: pay.sauce.ts does not compile for base
compileSauceRoute: `USDT` is not a token or protocol on base. Did you mean `USDC`? A token the registry does not carry is `Token(address)`, …
```

| Refused                                   | Message                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| A token called on a chain without it      | `` `USDT` is not a token or protocol on base. Did you mean `USDC`? ``                      |
| A contract the chain does not have        | `Contract 'CLFactory' (aerodrome-slipstream) is not deployed on 'ethereum' (available: …)` |
| A symbol the chain lacks, used as a value | `` `TSLAx` `` "is not a declared variable" (`return TSLAx;` compiled for Base)             |
| A qualified token (`Base.USDC`)           | `'USDC' is not a known protocol or family alias`                                           |

Then compile for a chain that has the name, guard it with `available(...)` (`sauce-globals`), or,
for a token the registry does not carry, take its address as a `main` parameter and use
`Token(address)`. The same company often has a different symbol per issuer and chain (Tesla is
`TSLAx` on Ethereum and Solana, `TSLAc` or `bTSLA` on Base): search by name or ticker on each chain.

## Another chain's names

**A contract qualified by a chain's name is only that chain's address.** In a program compiled for
Ethereum, `Base.UniswapV3.Factory` is the address Base's factory has on Base: a value, nothing more.
The program still runs on Ethereum, so calling it (`Base.UniswapV3.Factory.getPool(…)`)
calls that address on Ethereum, where it is some other contract or none, and the compile does not
stop it. Pass a qualified name across chains (a bridge message's argument); never call one.

```sauce chain=ethereum
// Base's factory, as an address to hand to something that acts on Base. Not a contract to call
// from here: on Ethereum, nothing at this address is Base's factory.
function main(): Address {
  return Base.UniswapV3.Factory;
}
```

**A token is never qualified**: the symbol is always the compiled-for chain's.

## The same names on Solana

A file compiled with `--chain solana` names Solana's mints by the same symbols: a symbol there is
the mint's 32-byte key, and the token methods compile, each call's token accounts added to `main`
and derived when the cook is built. [examples/payout-solana.sauce.ts](examples/payout-solana.sauce.ts)
pays a recipient `cash` of USDC (an SPL Token mint) and `shares` of TSLAx (Backed's tokenized Tesla,
a Token-2022 mint) from the Pot:

```sauce chain=solana
function main(recipient: Address, cash: Uint256, shares: Uint256): Uint256 {
  require(self.USDC >= cash, "not enough USDC");
  USDC.transfer(recipient, cash);
  const before = recipient.TSLAx;
  TSLAx.transfer(recipient, shares);
  return recipient.TSLAx - before;
}
```

```sh
sauce run payout-solana.sauce.ts --chain solana --keypair <keypair> \
  --args <recipient> 1000000 50000000
```

Protocol namespaces do not exist on Solana. Its accounts, token programs, transaction size and
running are `sauce-solana`'s.

## `chainId` and `ctx.chainId()`

`chainId` is the chain the file was compiled for, a constant; `ctx.chainId()` is the chain it runs
on, read when it runs. They differ only when bytes compiled for one chain are cooked on another,
where every name in them is the first chain's address. A cook is signed for one chain, so this
needs bytes that travel apart from the transaction, such as a compiled program a service runs on
several chains. Only then is a guard worth its bytes:

```sauce chain=ethereum,base
function main(recipient: Address, amount: Uint256) {
  require(ctx.chainId() == chainId, "compiled for another chain");
  USDC.transfer(recipient, amount);
}
```

## A chain's file

Every chain the SDK knows has a generated file, `references/<slug>.md`
([base.md](references/base.md), [solana.md](references/solana.md), …), indexed in
[references/index.md](references/index.md) with a Support column; a chain with tokenized stocks has
`references/<slug>-stocks.md` too.

| Section          | What it gives                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------- |
| The top          | supported, or a preview chain with the link to request it                                    |
| The facts table  | slug and aliases for `--chain`, chain id, kind, the name a program uses, native coin (below) |
| Notes            | the chain's own caveats, where it has any                                                    |
| In a program     | a compiled example of the chain's names, where the registry names any there                  |
| Tokens           | every token symbol a program can name there, with its address and decimals                   |
| Venues, Accounts | on Solana: each venue's namespace, and the accounts a program writes (`sauce-solana`)        |
| Protocols        | every recorded deployment, each with how a program names it                                  |

The facts table also has a **Sauce** row, pointing at `references/deployments.json`, and, where
the chain has one, its **CCTP domain**, its id on USDC's bridge.

| When you need                 | Look at                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Which chain has a protocol    | the protocol's registry file in `sauce-protocols`, or each chain's Protocols table |
| Moving USDC between chains    | the chain's CCTP domain, in its facts table                                        |
| Token order in a pool         | the token addresses: token0 is the lower one, and the order differs per chain      |
| The native coin or its ERC-20 | the native coin row: on some chains the coin is also an ERC-20 with other decimals |
| Amounts                       | the token's decimals, from the Tokens table: the same symbol may differ per chain  |

## The Sauce deployment

The Sauce contracts have the same address on every EVM chain, and the Sauce programs the same id on
every Solana cluster, so one file lists them, each entry with what it is:
[references/deployments.json](references/deployments.json).

| Key                         | What it is                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `evm.engine`                | the engine a cook names: the Pot's `cook(engine, program)`                                |
| `evm.kitchen`               | creates Pots (`deployPot(owner, salt)`) and sets the fee every cook pays                  |
| `evm.kitchenImplementation` | the implementation behind the Kitchen, an upgradeable proxy: call the Kitchen, never this |
| `evm.router`                | the Router a new Pot starts on, through which swaps with a callback run                   |
| `evm.quoteRouter`           | quotes Uniswap V3 and V4 swaps through `eth_call`; no Pot's Router                        |
| `evm.pot`                   | how a Pot's address follows from its owner and salt                                       |
| `svm.engine`, `svm.kitchen` | the Solana engine and Kitchen programs, each as its id and its 32-byte `key`              |

A program names none of them: the `sauce` command puts the engine and the Kitchen into every cook it
builds, and finds the Pot. Read the file to check a cook's `to` and `data`, to deploy a Pot by hand,
or to confirm the deployment on a chain.

## One program for several chains

1. Look up every name the program uses on each chain: `sauce globals --chain <slug>`, or the
   chain's file.
2. Compile for each chain it is meant for: `sauce compile <file> --chain <slug>` prints the
   bytecode, and `--json` adds what each name resolved to, the size and `main`'s parameters.
3. Wrap what one chain lacks in `available(...)`, or write the program for the chains that have it.
4. Confirm every address the program relies on has code on that chain: `eth_getCode` returns more
   than `0x`, or on Solana `getAccountInfo` returns an executable account.

## Pitfalls

- **An address pasted from one chain's file** compiles for every chain and is wrong on the others:
  write the name.
- **The same symbol with other decimals, or another address, per chain.** Take amounts from the
  compiled-for chain's Tokens table.
- **Calling a qualified contract.** `Base.UniswapV3.Factory` called from a program running on
  Ethereum calls Ethereum, at Base's address.
- **Trusting a recorded address.** Check it has code on the chain before relying on it; the Sauce
  deployment is there only where it has been deployed.
- **Assuming one chain's pool order.** token0 is the lower address, which differs per chain.

## Files

- [examples/holdings.sauce.ts](examples/holdings.sauce.ts): the EVM program above, for any chain
  with its names.
- [examples/payout-solana.sauce.ts](examples/payout-solana.sauce.ts): the Solana payout above.
- [examples/chains.mts](examples/chains.mts) compiles both and pins the resolution table, the quoted
  refusals, chain-qualified names, the Solana program's accounts and mints, and the deployment
  file's keys.
- [references/index.md](references/index.md), a file per chain, and
  [references/deployments.json](references/deployments.json): generated from the registries.
