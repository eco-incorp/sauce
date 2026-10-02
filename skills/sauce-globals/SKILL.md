---
name: sauce-globals
description: The names a Sauce program uses without any import, and how they resolve on the chain it is compiled for — token symbols (USDC, USDT, WETH, …) and tokenized stocks (SPCXc, TSLAon, TSLAx, NVDA_US, SPACEX, …, on Ethereum, Base and Solana), Token(address) and a bound const t = Token(x), the token methods .transfer/.approve/.transferFrom/.balanceOf with SafeERC20 behaviour and USDT, the @sauce/token functions, protocol namespaces (UniswapV3.Factory, UniswapV4.StateView, AaveV3.Pool, …) and family aliases, available(...) for a venue a chain may lack, the Namespace_Contract compile-time defines, chain names, chainId and ctx.*. Links generated indexes of every token, protocol contract and chain, the same lists sauce globals prints. Use when writing any Sauce program that moves tokens, calls a protocol or names a chain, when checking whether a name exists on a chain, or when a name does not resolve ("is not a declared variable", "ambiguous", "is not deployed").
---

# Globals in a Sauce program

A program compiled for a chain resolves these names against **that chain**, with no import. They
are program syntax, not JavaScript values. **Look names up before writing a program**:
`sauce globals --chain <chain>` lists one chain's, and these indexes list every chain's, from
the same registries the compile reads:

- [references/tokens.md](references/tokens.md): every token symbol per chain, with its decimals,
  and the `@sauce/token` functions.
- [references/stocks.md](references/stocks.md): every tokenized stock per chain, with what it is
  and its issuer.
- [references/protocols.md](references/protocols.md): every `Namespace.Contract`, and the family
  aliases.
- [references/chains.md](references/chains.md): every chain name, its id, and whether it takes
  intents.

These are the names. Where each is deployed and its address there are the full map: per chain in
`sauce-chains` ([../sauce-chains/references/index.md](../sauce-chains/references/index.md)), and per
protocol in `sauce-protocols`
([../sauce-protocols/references/index.md](../sauce-protocols/references/index.md)).

A name that is absent on the target chain (a token the chain does not register, a contract not
deployed there) is a **compile error**, never a wrong address at run time.

The language's own builtins (`ctx`, `crypto`, `Math`, `abi`, `evm`, `svm`, methods on values) are
in [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md): look a builtin
up there before using it.

## Tokens

A symbol is that chain's token address: a value (`balanceOf(USDC, account)`) or the target of its
methods. Any other ERC-20 is `Token(address)`, or bound once: `const t = Token(address);` (declared
once, never reassigned, used only as `t.<method>(...)`).

| Method                            | Behaviour                                                 |
| --------------------------------- | --------------------------------------------------------- |
| `.transfer(to, amount)`           | SafeERC20 transfer                                        |
| `.transferFrom(from, to, amount)` | SafeERC20 transferFrom                                    |
| `.approve(spender, amount)`       | forceApprove: a non-zero allowance is reset to zero first |
| `.balanceOf(owner)`               | balance read; `self.USDC` is `USDC.balanceOf(ctx.self())` |

Writes are **SafeERC20**: a token that returns nothing (USDT) works when it has code; a `false`
return, a malformed return or an address with no code reverts the program. A write returns
nothing, so `const ok = USDT.transfer(...)` does not compile. Approve exactly what the next call
spends: a standing allowance outlives the program.

The same library as functions, token first: `transfer(token, to, amount)`,
`transferFrom(token, from, to, amount)`, `approve(token, spender, amount)`,
`balanceOf(token, account)`, `allowance(token, owner, spender)`, `totalSupply(token)`,
`decimals(token)`, and the signature pulls `permit` and `permitTransferFrom` (the bottom of
[references/tokens.md](references/tokens.md) has every signature). The methods compile to exactly
these.

```sauce chain=ethereum,optimism
function main(payee: Address, amount: Uint256) {
  require(USDT.balanceOf(ctx.self()) >= amount, "not enough USDT");
  USDT.transfer(payee, amount);
  require(allowance(USDT, ctx.self(), payee) == 0, "no allowance left standing");
}
```

**`IERC20` is low level, and only imported.** `import { IERC20 as Erc20 } from
"./artifacts/IERC20.json"` binds the raw ERC-20 ABI for a call the token syntax does not offer. Its
writes decode the declared `bool`, so they are not SafeERC20 (USDT's `transfer` reverts there, and
a `false` return passes): never write a token transfer or approval through it. Import it under a
name of its own, as here, in a file that also uses the token syntax, which binds `IERC20` itself.

## Tokenized stocks

A tokenized stock is a token like any other, named by its symbol with no import:
`SPCXc.balanceOf(ctx.self())`, `SPCXc.transfer(to, amount)`, a value for `@sauce/token`'s
functions, a token a swap buys or sells.

- **Ethereum**: Backed's xStocks (`TSLAx`, `SPCXx`) and bTokens (`bTSLA`), Ondo Global Markets'
  (`TSLAon`, `SPCXon`), and Mt Pelerin's own shares (`MPS`).
- **Base**: Coinbase's (`TSLAc`, `SPCXc`) and Backed's bTokens.
- **Solana**: Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities'
  (`NVDA_US`, `SPCX_US`) and PreStocks' shares of private companies (`SPACEX`, `OPENAI`), each a
  Token-2022 mint (below).

The symbol is the issuer's own ticker for the token, in its case: symbols are case-sensitive, and
`SPCXC` is not `SPCXc`. A `.` in a ticker is written `_`: `BRK.Bx` is `BRK_Bx`, and Backpack's
`NVDA.US` is `NVDA_US`. PreStocks' symbol is the company's name, `SPACEX`. One company has one token
per issuer: SpaceX is `SPCXx` and `SPCXon` on Ethereum, `SPCXc` on Base, and `SPCXx`, `SPCXon`,
`SPCX_US` and `SPACEX` on Solana. Find one by the company's name or ticker with
`sauce globals --chain base --search spacex`, list a chain's with `--stocks`, or read
[references/stocks.md](references/stocks.md).

Buying and selling one on a DEX needs no account with its issuer, and any contract can hold it,
the program's Pot included; only minting and redeeming with the issuer need KYC. What differs from
a plain ERC-20:

- An issuer can pause its token, and refuses a sanctioned or blocked address.
- Backed's tokens rebase: a balance is shares times a multiplier the issuer moves, so it changes
  between transactions, never within one. A transfer can credit one unit less than sent, so paying
  one into a pool that checks what it received can fail; buying one is unaffected.
- Ondo's keep their balance: dividends raise the shares each token stands for (Ondo's multiplier),
  so its price follows the stock with dividends reinvested.
- Coinbase's are B20 tokens, built into the Base node: they run on Base, and not in a local copy of
  the chain. Rehearse a program that moves one with `sauce simulate` against Base itself; no assumed
  balance can give a Pot one, since no state override reaches a B20 balance.

Each issuer's list is copied from the issuer's own published list, and every row is checked on
chain. Backpack lists mints it has not opened yet, and Superstate's can be held only by an
allowlisted holder: neither is registered.

```sauce chain=base
function main(recipient: Address, amount: Uint256) {
  require(SPCXc.balanceOf(ctx.self()) >= amount, "not enough SPCXc");
  SPCXc.transfer(recipient, amount);
}
```

### On Solana

A stock on Solana is a Token-2022 mint, and its symbol is the mint's 32-byte key, a value for
`@sauce/token`'s functions: `balanceOf(TSLAx, account)`. A program moves one with the checked
writes, `transferChecked` and `approveChecked`, which take the mint's token program, the mint and
its decimals beside the token accounts (`transfer` and `approve` take legacy SPL Token mints only).
`sauce` names each of those accounts by the symbol: `program:TSLAx` the token program,
`mint:TSLAx` the mint, `pot:TSLAx` the Pot's token account and `owner:TSLAx` the owner's.

- Amounts are raw, in the mint's decimals. The issuer's multiplier, by which a wallet shows them,
  moves for splits and dividends, so a raw unit is not always one share.
- PreStocks' mints charge a transfer fee: the token program keeps part of every transfer, so the
  recipient gets less than was sent. Measure what arrived, as below; the references mark each mint
  that charges one.
- Every stock mint has a transfer hook that names no program, which is no hook. `@sauce/token`
  refuses a mint whose hook names a program (`transfer hook`), and no registered mint has one.
- The issuer can pause its mint, and can hold a permanent delegate, which can move or burn any
  balance. A new token account is usable, not frozen.

```sauce chain=solana
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  mint: Account,
  destination: Account<Writable>,
  pot: Account<Signer>,
  amount: Uint256,
): Uint256 {
  const before = balanceOf(SPACEX, destination);
  transferChecked(SPACEX, tokenProgram, source, mint, destination, pot, amount, 9);
  return balanceOf(SPACEX, destination) - before;
}
```

## Protocols

- `Namespace.Contract` is the contract's address on the program's chain where a value is expected,
  and a bound contract where a method is called: `UniswapV3.Factory.getPool(a, b, 500)`. A
  Uniswap fee is in millionths: `500` is the 0.05% tier, `3000` 0.3%.
- A namespace's default contract is also called by the namespace alone:
  `Cctp.depositForBurn(...)` calls `Cctp.TokenMessenger`.
- A family alias (`Uniswap`, `Aave`, …) names a contract only when one member has it on the chain:
  `Uniswap.UniversalRouter` is `UniswapV4.UniversalRouter`; `Uniswap.Factory` is ambiguous.
- `Ethereum.UniswapV4.UniversalRouter` takes Ethereum's address but still executes on the program's
  own chain; running on another chain is an intent (`sauce-intents`).
- Every catalogued protocol has a namespace. An interface, such as `Erc4626.Vault` or
  `UniswapV3.Pool`, has no one address and is called with one, together with a method in the same
  expression: `Erc4626.Vault(vault).deposit(...)`, or `UniswapV3.Pool(pool).liquidity()` for a pool
  its factory returned (`.at(pool)` is the same).
  [references/protocols.md](references/protocols.md) lists every interface.

**A venue a chain may not have** is asked with `available(<name>)`, decided when the program is
compiled for a chain: `if (available(UniswapV3.Factory)) { ... }` keeps its branch where the chain
has the contract, and removes it, names and all, where it does not. It takes a contract or a token
symbol (`available(USDT)`); it folds `if`/`else`, `?:`, `&&`, `||` and `!`; and a guard
`if (!available(X)) { return 0; }` drops the rest of its function. A name no chain has is an
error rather than `false`, so a typo cannot quietly drop a branch. `Namespace.Contract` without it
is for a contract the program requires: on a chain without it, the program does not compile.

```sauce chain=base,linea
function main(tokenA: Address, tokenB: Address) {
  if (available(UniswapV3.Factory)) {
    const pool = UniswapV3.Factory.getPool(tokenA, tokenB, 500);
    require(pool != 0, "no 0.05% pool");
  }
}
```

## Chains, context, imports

- **Chain names** (`Base`, `Ethereum`, … in [references/chains.md](references/chains.md)) open an
  intent from inside a program: `Ethereum.Portal.send(reward).receive(delivery).then(() => { ... })`.
  Every chain's names
  compile; for the initial release its transactions are built and sent only on Ethereum, Base and
  Solana, and [references/chains.md](references/chains.md) marks every other chain a preview chain
  (`sauce-chains` says how to request one).
- **`chainId`** is the chain the program is compiled for.
- **`ctx`**: context reads, each a call. The complete list, with what each returns per target, is
  section 6 of [../sauce-script/references/builtins.md](../sauce-script/references/builtins.md).

| Read                                                                                                         | EVM                                                   | Solana                                                   |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| `ctx.self()`                                                                                                 | the executing contract: the Pot, which holds balances | the executing Sauce program's id                         |
| `ctx.msgSender()`                                                                                            | the immediate caller                                  | the transaction's first signer                           |
| `ctx.msgData()`                                                                                              | the program's whole input                             | the instruction data                                     |
| `ctx.timestamp()`, `ctx.chainId()`, `ctx.selfBalance()`                                                      | yes                                                   | yes                                                      |
| `ctx.balance(a)`                                                                                             | the balance of `a`                                    | the lamports of an attached account: pass `acct.address` |
| `ctx.blockNumber()`                                                                                          | block number                                          | slot                                                     |
| `ctx.msgValue()`, `ctx.gasLeft()`, `ctx.codeSize(a)`, `ctx.codeHash(a)`, `ctx.isContract(a)`, `ctx.isEOA(a)` | yes                                                   | rejected                                                 |

There is no read for the transaction origin.

- **Imports the package serves** to a program: `@sauce/router` (the swap library, `sauce-swaps`),
  `@sauce/token`, `./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json` (the Router itself),
  and every protocol ABI as `./protocols/<slug>/<Export>.json`.

## Example

[examples/globals.sauce.ts](examples/globals.sauce.ts) uses each kind of name;
[examples/globals.mts](examples/globals.mts) compiles it and pins the SafeERC20 lowering, the
`IERC20` import rule, the family-alias rules and `available(...)`.
