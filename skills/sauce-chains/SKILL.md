---
name: sauce-chains
description: How a Sauce program's names resolve per chain, and each chain's facts from the SDK's registries. One file compiled for Ethereum and for Base gets each chain's own USDC, WETH, tokenized stocks, protocol contracts (UniswapV3.Factory) and chainId; a name the chain lacks is refused at compile; Base.UniswapV3.Factory is only Base's address, to pass across chains and never to call, and tokens are never qualified. Writing for an EVM chain versus Solana (Account parameters, token accounts, SPL Token transfer and Token-2022 transferChecked for stock mints, --account). Which chains take transactions (Ethereum, Base, Solana; the rest are preview chains) and how to request one. Per chain, its id, slug, native coin, Sauce engine and Kitchen, intents, CCTP domain, tokens and every protocol with its address. Use when the user asks what is on a chain, needs an address, picks a chain, writes one program for several chains or for Solana, a name fails to compile on one chain, or a transaction is refused on a preview chain.
---

# Chains

A program names no chain and no address. It names tokens and contracts (`USDC`, `bCSPX`,
`UniswapV3.Factory`), and the chain it is compiled for decides what each one is: compiled with
`--chain base`, every name is Base's. Every chain the SDK knows has a file in
[references/](references/index.md), generated from the SDK's registries: its tokens, its protocols
with how a program names each contract, its Sauce deployment, whether it takes intents, and whether
the release sends transactions there ([references/base.md](references/base.md),
[references/solana.md](references/solana.md), …).

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
    usdc: USDC.balanceOf(pot),
    weth: WETH.balanceOf(pot),
    bcspx: bCSPX.balanceOf(pot),
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

`bCSPX` is Backed's tokenized S&P 500 fund, one of the chains' tokenized stocks. The pool the
factory returns differs per chain too, and every balance is read on the chain the cook runs on.

The names a chain scopes, all resolved when the file is compiled:

- **Token symbols**, the chain's tokenized stocks among them: a symbol is the token's address, and
  `USDC.transfer(to, amount)` / `USDC.balanceOf(account)` call it with no import.
- **Protocol namespaces and their contracts**: `UniswapV3.Factory`, `AaveV3.Pool`, called or used as
  an address.
- **`chainId`**: the id of the chain the file was compiled for.

Look a name up before writing it:

```sh
sauce globals --chain base                      # the chain's tokens and protocol contracts
sauce globals --chain base --search tesla       # a token or stock by symbol, name or ticker
sauce globals --chain base --protocol UniswapV3 # one namespace, with its methods
sauce compile holdings.sauce.ts --chain base --json
```

The `--json` compile lists what the program's names became: `defines` holds each token and
`chainId` with its value, and `contracts` each namespace contract with its address. The chain's
file in [references/](references/index.md) says the same, with every stock in
`references/<slug>-stocks.md`.

### A name the chain lacks

A name is either the chain's or a compile error, never a zero address at run time. Base registers
no USDT:

```sauce chain=base fails
function main(recipient: Address, amount: Uint256) {
  USDT.transfer(recipient, amount);
}
```

```text
sauce compile: pay.sauce.ts does not compile for base
error: `USDT` is not a token or protocol on base. Did you mean `USDC`? A token the registry does not carry is `Token(address)`, …
```

A contract the chain does not have is refused the same way, naming the chains that do:
`AerodromeSlipstream.CLFactory` compiled for Ethereum fails with
`Contract 'CLFactory' (aerodrome-slipstream) is not deployed on 'ethereum' (available: …)`. A
symbol the chain lacks is refused the same way wherever it is used: `return TSLAx;` compiled for
Base is refused as "`TSLAx` is not a token or protocol on base".
The same company often has a different symbol per issuer and chain: Tesla is `TSLAx` on Ethereum
and on Solana, but `TSLAc` or `bTSLA` on Base, so search by name or ticker on each chain. Then pick
a chain that has the name, or, for a token the registry does not carry, use `Token(address)` with
the address as a `main` parameter.

## Another chain's names

**A contract qualified by a chain's name is only that chain's address.** In a program compiled for
Ethereum, `Base.UniswapV3.Factory` is the address Base's factory has on Base: a value, nothing
more. The program still runs on Ethereum, so calling it (`Base.UniswapV3.Factory.getPool(…)`)
calls that address on Ethereum, where it is some other contract or none, and the compile does not
stop it. Use a qualified name to pass an address across chains: as an argument of a bridge message,
or inside an intent whose body runs on another chain and must name a contract back on this one.
Never call one.

```sauce chain=ethereum
// Base's factory, as an address to hand to something that acts on Base. Not a contract to call
// from here: on Ethereum, nothing at this address is Base's factory.
function main(): Address {
  return Base.UniswapV3.Factory;
}
```

- **A token is never qualified.** `Base.USDC` is refused (`a token is never qualified by a chain`);
  the symbol is always the compiled-for chain's, and another chain's token is an address.
- **To act on another chain, open an intent** (`sauce-intents`):
  `Ethereum.Portal.send(reward).receive(delivery).then(() => { ... })`. In `.receive(...)` and the
  body, every name is the destination's; `.send(...)` resolves on the chain the file is compiled
  for, which funds it. Both chains must take intents (each chain's file says).

## EVM chains and Solana

The same names, written for the target's account model:

|                     | An EVM chain                             | Solana                                                                       |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| A token symbol      | the token's address                      | the mint's 32-byte key                                                       |
| Who holds a balance | an address: `USDC.balanceOf(ctx.self())` | a token account the program is given: `balanceOf(USDC, potUsdc)`             |
| Accounts            | none declared                            | every account is an `Account` parameter of `main`, attached with `--account` |
| A transfer          | `USDC.transfer(recipient, amount)`       | `transfer(USDC, usdcProgram, potUsdc, toUsdc, pot, amount)`, SPL Token mints |
| A Token-2022 mint   | no such thing                            | `transferChecked(TSLAx, tslaxProgram, potTslax, tslaxMint, toTslax, pot, …)` |
| Protocol namespaces | yes                                      | none: a program calls another program with `svm.call`                        |
| `ctx.self()`        | the Pot                                  | the engine program; the Pot is an `Account` parameter                        |

[examples/payout-solana.sauce.ts](examples/payout-solana.sauce.ts) pays a recipient `cash` of USDC
and `shares` of TSLAx (Backed's tokenized Tesla) from the Pot's accounts:

```sauce chain=solana
function main(
  pot: Account<Signer>,
  usdcProgram: Account,
  potUsdc: Account<Writable>,
  toUsdc: Account<Writable>,
  tslaxProgram: Account,
  tslaxMint: Account,
  potTslax: Account<Writable>,
  toTslax: Account<Writable>,
  cash: Uint256,
  shares: Uint256
): Uint256 {
  require(balanceOf(USDC, potUsdc) >= cash, "not enough USDC");
  transfer(USDC, usdcProgram, potUsdc, toUsdc, pot, cash);
  const before = balanceOf(TSLAx, toTslax);
  transferChecked(TSLAx, tslaxProgram, potTslax, tslaxMint, toTslax, pot, shares, 8);
  return balanceOf(TSLAx, toTslax) - before;
}
```

- **Every account is a parameter.** `Account` is read-only; `Account<Writable>` and
  `Account<Signer>` declare the role the transaction grants. Only the scalars (`cash`, `shares`)
  are `--args`.
- **A balance is a token account's**, read with the mint first: `balanceOf(USDC, potUsdc)`.
- **Each mint has a token program.** USDC is an SPL Token mint, moved with `transfer`, which is SPL
  Token's alone. TSLAx, like every tokenized stock and PYUSD on Solana, is a Token-2022 mint:
  `transfer` refuses its accounts, and `transferChecked`, which works for both programs, takes the
  mint's account and its decimals (8 for TSLAx; the chain's file lists each mint's). A Token-2022
  mint may withhold a transfer fee, so the program measures what arrived.
- **`--account` attaches each slot by name**, an address or a name the command derives: `pot` is
  the Pot, `pot:USDC` the Pot's USDC account, `owner:USDC` the owner's, `mint:TSLAx` the mint and
  `program:TSLAx` its token program.

```sh
sauce run payout-solana.sauce.ts --chain solana --keypair <keypair> \
  --account pot=pot --account usdcProgram=program:USDC --account potUsdc=pot:USDC \
  --account toUsdc=<the recipient's USDC account> --account tslaxProgram=program:TSLAx \
  --account tslaxMint=mint:TSLAx --account potTslax=pot:TSLAx \
  --account toTslax=<the recipient's TSLAx account> --args 1000000 50000000
```

Two transfers and the reads are past one Solana transaction, so `sauce run` stages the program
before the cook; `sauce simulate` and `sauce tx` refuse it, naming how many bytes it is over.
`sauce-solana` has the rest: binding a slot to the Pot, transaction size, each Token-2022
extension, and running through the Kitchen or the engine.

## Supported and preview chains

For the initial release, Sauce supports transactions on **Ethereum, Base and Solana** (`ethereum`,
`base`, `solana`). Every other chain is a **preview chain**: a program compiles for it and
`sauce simulate` rehearses it there, but the `sauce` command and the MCP server build and send no
transaction on it (`sauce tx`, `sauce run`, `sauce pot --deploy`, `sauce intent publish` and the
intent steps are refused, naming the supported chains and linking the chain's request).
[references/index.md](references/index.md) has a Support column, and each chain's file says which
it is at the top.

To ask for a preview chain, or one the SDK does not know, look for it among the
[existing chain-support requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add the use case to it, or
[open a request](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml) with
the chain and its id, what runs there, the protocols and tokens it needs, and the expected volume
and timing. A preview chain's file links its own request, prefilled.

## `chainId` and `ctx.chainId()`

`chainId` is the chain the file was compiled for, a constant in the program; `ctx.chainId()` is the
chain it runs on, read when it runs. They differ only when a program compiled for one chain is
cooked on another, where every name in it is the first chain's address. A cook is signed for one
chain, so this needs bytes that travel apart from the transaction, such as a compiled program
handed to a service that runs it on several chains. That is when a guard is worth its bytes:

```sauce chain=ethereum,base
function main(recipient: Address, amount: Uint256) {
  require(ctx.chainId() == chainId, "compiled for another chain");
  USDC.transfer(recipient, amount);
}
```

## A chain's file

| In a chain's file | What it gives                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- |
| The top           | supported, or a preview chain with the link to request it                                     |
| The facts table   | slug and aliases for `--chain`, chain id, kind, the name a program uses, native coin          |
| Sauce             | the engine, Kitchen and Router a cook uses (EVM), or the engine and Kitchen programs (Solana) |
| Intents           | whether it takes intents, its eco-routes contracts and shared intent Pot (`sauce-intents`)    |
| In a program      | a compiled example of the chain's names                                                       |
| Tokens            | every token symbol a program can name there, with its address and decimals                    |
| Protocols         | every recorded deployment, each with how a program names it                                   |

| When                        | Look at                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| Where a transaction can run | a supported chain: Ethereum, Base or Solana; elsewhere compile and simulate only        |
| Which chain has a protocol  | the protocol's registry file in `sauce-protocols`, or the Protocols table of each chain |
| Moving value between chains | "Intents": both chains must take intents (`sauce-intents`); the CCTP domain for USDC    |
| Token order in a pool       | the token addresses: token0 is the lower one, and the order differs per chain           |
| Native coin or its ERC-20   | the native coin row: on some chains the coin is also an ERC-20 with other decimals      |
| Amounts                     | the token's decimals, from the Tokens table: the same symbol may differ per chain       |

## Workflow

1. Look up every name the program uses on the chain (`sauce globals --chain <slug>`, or the chain's
   file).
2. Compile for the chain: `sauce compile <file> --chain <slug>` prints the bytecode, and `--json`
   adds what each name resolved to, the size and `main`'s parameters. Compile for each chain the
   program is meant for.
3. The transaction is a cook on your Pot. On an EVM chain: `to` the Pot, `data` the Pot's
   `cook(engine, program)` with `main`'s arguments appended to the program, `value` the Kitchen's
   fee plus any native the program spends. `sauce tx <file> --chain <slug> --owner <address> --args …`
   prints it as unsigned JSON, `{ chainId, to, data, value }`, for any wallet or signer, and
   `sauce simulate` rehearses it. On a preview chain stop at compiling and simulating, and offer the
   chain-support request the refusal links.

## Common gotchas

- **Recorded is not live.** Every address here is as the registry records it; that is not proof of
  code on the chain. Before relying on one, confirm it has code: `eth_getCode` on the chain returns
  more than `0x`, or on Solana `getAccountInfo` returns an executable account. The Sauce release
  addresses are the same on every EVM chain, and deployed only where the release has been.
- **An address in the source is one chain's.** Write the name; an address pasted from one chain's
  file compiles for every chain and is wrong on the others.
- **The same symbol can have other decimals, or another address, per chain.** Take amounts from the
  compiled-for chain's Tokens table.
- **A qualified contract is an address, not a call there.** `Base.UniswapV3.Factory` called from a
  program running on Ethereum calls Ethereum, at Base's address.
- **Token methods are EVM only.** On Solana, `USDC.transfer(...)` does not exist: the `@sauce/token`
  functions take the mint first and the accounts after it.

## Verification checklist

- [ ] Every name the program uses is the chain's, and it compiles with `--chain` for each chain it
      is meant for.
- [ ] No address the registry names is written as a literal: the name resolves per chain.
- [ ] Every address the program relies on has code on that chain.
- [ ] Amounts are in the token's decimals on that chain.
- [ ] On Solana, every account is a parameter, and a Token-2022 mint moves with `transferChecked`.
- [ ] For a transaction, the chain is supported (Ethereum, Base or Solana).

## Examples

[examples/holdings.sauce.ts](examples/holdings.sauce.ts) is the EVM program above, for any chain
with the names; [examples/payout-solana.sauce.ts](examples/payout-solana.sauce.ts) is the Solana
payout; [examples/chains.mts](examples/chains.mts) compiles both and checks the resolution table,
the quoted refusals, chain-qualified names, and the Solana program's accounts and mints.
