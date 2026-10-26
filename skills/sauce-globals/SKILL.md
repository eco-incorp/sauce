---
name: sauce-globals
description: The names a Sauce program uses with no import, and what each means. Token symbols (USDC, USDT, WETH, …) and tokenized stocks (SPCXc, TSLAon, TSLAx, NVDA_US, SPACEX, … on Ethereum, Base and Solana), Token(address) and a bound const t = Token(x), the token methods .transfer, .approve and .transferFrom with SafeERC20 behaviour (USDT works), a balance as pot.USDC, the @sauce/token functions, the raw IERC20 import, protocol namespaces (UniswapV3.Factory, UniswapV4.StateView, AaveV3.Pool, …) with their deployed contracts, address-only contracts, interfaces and family aliases, a name a chain may lack (zero there, tested with if (X)), chain names and chainId, and the imports the package serves; with generated indexes of every token, stock, protocol contract and chain name, the lists sauce globals prints. Use when writing a program that moves tokens, calls a protocol or names a chain, when checking whether a name exists, or when a name does not resolve ("is not a declared variable", "ambiguous", "is not deployed").
---

# Names a program uses

A program names tokens, protocol contracts and chains with no import. This skill owns that
vocabulary: what each kind of name is, its methods and their behaviour, and the indexes of every
name. Where a name points on a given chain (its address, whether it exists there) is
`sauce-chains`'s; the language's own builtins (`ctx`, `crypto`, `Math`, `abi`, `evm`, `svm`) are
`sauce-script`'s.

## When to use

| Task                                                        | Here | Elsewhere                                |
| ----------------------------------------------------------- | ---- | ---------------------------------------- |
| Find a token's or a stock's symbol; check a name exists     | yes  |                                          |
| Move, approve or read a token; USDT                         | yes  | on Solana, its accounts: `sauce-solana`  |
| Call a protocol contract; an alias; a name a chain may lack | yes  | which protocol to use: `sauce-protocols` |
| A name's address on one chain, or a name one chain lacks    |      | `sauce-chains`                           |
| A swap                                                      |      | `sauce-swaps`                            |

## Core model

- A name resolves against **the chain the program is compiled for**: `USDC` compiled with
  `--chain base` is Base's USDC. They are program syntax, not JavaScript values.
- A name the chain lacks (a token it does not register, a contract not deployed there) is **zero**
  there. A test of it is decided while compiling; any other use is a **compile error** naming the
  chain, never a wrong address at run time (`sauce-chains` quotes each refusal).
- Kinds of name: a **token symbol**, **`Token(address)`** for any other token, a **namespace
  contract** (`UniswapV3.Factory`), a **family alias** (`Uniswap.UniversalRouter`), a **chain name**
  (`Ethereum`), and **`chainId`**.
- **Look names up before writing**: `sauce globals --chain <chain>` lists one chain's (`--tokens`,
  `--stocks`, `--protocol <Namespace>`, `--search <text>`); these indexes list every chain's, from
  the registries the compile reads:
  - [references/tokens.md](references/tokens.md): every token symbol per chain, its decimals, and
    every `@sauce/token` signature;
  - [references/stocks.md](references/stocks.md): every tokenized stock per chain, what it is and
    its issuer;
  - [references/protocols.md](references/protocols.md): every `Namespace.Contract`, interface and
    family alias;
  - [references/chains.md](references/chains.md): every chain name, its id and whether it is
    supported.

## Tokens

A symbol is that chain's token address: a value (`balanceOf(USDC, account)`) or the target of its
methods. Any other ERC-20 is `Token(address)`, or bound once: `const t = Token(address);` (declared
once, never reassigned, used only as `t.<method>(...)`).

**A balance is `<holder>.<TOKEN>`: any address or contract, then a token's symbol.** `pot` is the
Pot, and `pot.USDC` the USDC it holds, `recipient.TSLAx` the TSLAx `recipient` holds,
`UniswapV4.PoolManager.WETH` the WETH in the PoolManager. It is `USDC.balanceOf(holder)` written
short, and compiles to the same bytes. `.<SYMBOL>` is always a registered token; the native coin is
`.balance` (wei on an EVM chain, lamports on Solana): `pot.balance` is `ctx.selfBalance()`,
`recipient.balance` is `ctx.balance(recipient)`. On Arc, whose coin is USDC, `pot.USDC` is the
token and `pot.balance` the coin. The holder is:

- on an EVM chain, any address: `pot` or `ctx.self()`, a variable or parameter, an address written
  out, a protocol contract (`Aave.Pool`), a contract at an address (`UniswapV3.Pool(pool)` or
  `UniswapV3.Pool.at(pool)`: the address is the holder), or a call that returns an address
  (`UniswapV4.StateView.poolManager()`); a program that declares its own `pot` owns the name and
  reads that variable;
- a token's own contract too: `WETH.balance` is the ETH locked in WETH, `USDC.WETH` the WETH the
  USDC contract holds (on Solana, `USDC.balance` is the mint's lamports, `USDC.WSOL` its own WSOL
  account's balance);
- on Solana, one known when the transaction is built, whose account is added to `main`: `pot`,
  `Solana.owner`, an `Address` parameter of `main`, a token's mint, or a 32-byte key written out
  (`sauce-solana`).

A record or a list is not a holder: on one, a property named like a token is refused, since the
name is reserved for the shorthand (`usdc:` is a fine field name). Nor is an interface with no
address (`UniswapV3.Pool.WETH`). `.balance` on a record or a list reads its field, and so it does
on a contract call's result unless the registry records that result as an address
(`UniswapV4.StateView.poolManager().balance` is the PoolManager's coin): write `ctx.balance(x)` for
the coin there. `Token(address)` has no short form: its balance is
`Token(address).balanceOf(holder)`.

| Method                            | Behaviour                                                 |
| --------------------------------- | --------------------------------------------------------- |
| `.transfer(to, amount)`           | SafeERC20 transfer                                        |
| `.transferFrom(from, to, amount)` | SafeERC20 transferFrom                                    |
| `.approve(spender, amount)`       | forceApprove: a non-zero allowance is reset to zero first |
| `.balanceOf(owner)`               | balance read, the long form of `owner.USDC`               |

- **Writes are SafeERC20**: a token that returns nothing (USDT) works when it has code; a `false`
  return, a malformed return or an address with no code reverts the program. A write returns
  nothing, so `const ok = USDT.transfer(...)` does not compile.
- **Approve exactly what the next call spends**: a standing allowance outlives the program.
- **The same library as functions**, token first, with no import: `transfer(token, to, amount)`,
  `transferFrom(token, from, to, amount)`, `approve(token, spender, amount)`,
  `balanceOf(token, account)`, `allowance(token, owner, spender)`, `totalSupply(token)`,
  `decimals(token)`, and the signature pulls `permit` and `permitTransferFrom`. The methods compile
  to exactly these; [references/tokens.md](references/tokens.md) ends with every signature.
- **On Solana** the methods are the same, `Token(mint)` takes a mint given as an `Address` argument,
  and compiling adds the token accounts each call moves through to `main`, derived and checked
  (`sauce-solana`).

```sauce chain=ethereum,optimism
function main(payee: Address, amount: Uint256) {
  require(pot.USDT >= amount, "not enough USDT");
  USDT.transfer(payee, amount);
  require(allowance(USDT, ctx.self(), payee) == 0, "no allowance left standing");
}
```

**`IERC20` is low level, and only imported.** `import { IERC20 as Erc20 } from
"./artifacts/IERC20.json"` binds the raw ERC-20 ABI, for a call the token syntax does not offer. Its
writes decode the declared `bool`, so they are not SafeERC20 (USDT's `transfer` reverts there, and
a `false` return passes): never write a transfer or an approval through it. Import it under a name
of its own, as here, in a file that also uses the token syntax, which binds `IERC20` itself.

## Tokenized stocks

A tokenized stock is a token like any other, named by its symbol with no import:
`pot.SPCXc`, `SPCXc.transfer(to, amount)`, a value for `@sauce/token`'s
functions, a token a swap buys or sells.

| Chain    | Issuers (example symbols)                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum | Backed's xStocks (`TSLAx`, `SPCXx`) and bTokens (`bTSLA`), Ondo Global Markets' (`TSLAon`, `SPCXon`), Mt Pelerin's own shares (`MPS`)                       |
| Base     | Coinbase's (`TSLAc`, `SPCXc`) and Backed's bTokens                                                                                                          |
| Solana   | Backed's xStocks (`TSLAx`), Ondo Global Markets' (`TSLAon`), Backpack Securities' (`NVDA_US`, `SPCX_US`), PreStocks' private companies (`SPACEX`, `OPENAI`) |

- **The symbol is the issuer's own ticker, in its case**: in a program symbols are case-sensitive
  (`SPCXC` is not `SPCXc`; the `sauce` command's token flags, such as `--fund`, match one without
  regard to case), a `.` is written `_` (`BRK.Bx` is `BRK_Bx`, Backpack's `NVDA.US` is `NVDA_US`),
  and PreStocks' symbol is the company's name (`SPACEX`).
- **One company has one token per issuer**: SpaceX is `SPCXx` and `SPCXon` on Ethereum, `SPCXc` on
  Base, and `SPCXx`, `SPCXon`, `SPCX_US` and `SPACEX` on Solana. Find one by name or ticker with
  `sauce globals --chain base --search spacex`, list a chain's with `--stocks`, or read
  [references/stocks.md](references/stocks.md).
- **Buying or selling one needs no account with its issuer**, and any contract can hold one, the
  Pot included; only minting and redeeming with the issuer need KYC.
- **An issuer can pause its token**, and refuses a sanctioned or blocked address.
- **Backed's tokens rebase**: a balance is shares times a multiplier the issuer moves, so it changes
  between transactions, never within one. A transfer can credit one unit less than sent, so paying
  one into a pool that checks what it received can fail; buying one is unaffected.
- **Ondo's keep their balance**: dividends raise the shares each token stands for, so its price
  follows the stock with dividends reinvested.
- **Coinbase's are B20 tokens**, built into the Base node: they run on Base and not in a local copy
  of the chain. Simulate a program that moves one with `sauce simulate` against Base itself; no
  assumed balance can give a Pot one.
- **Each issuer's list is copied from its own published list**, and every row is checked on chain.
  Backpack's mints it has not opened yet, and Superstate's (allowlisted holders only), are not
  registered.

```sauce chain=base
function main(recipient: Address, amount: Uint256) {
  require(pot.SPCXc >= amount, "not enough SPCXc");
  SPCXc.transfer(recipient, amount);
}
```

### On Solana

A stock on Solana is a Token-2022 mint with the same methods: `SPACEX.transfer(to, amount)` lowers
to the checked write, `transferChecked`, with the mint's decimals, and its symbol alone is the
mint's 32-byte key (`balanceOf(TSLAx, account)`). Token-2022 and the accounts it moves through are
`sauce-solana`'s; what is particular to the stocks:

- **Amounts are raw**, in the mint's decimals. The issuer's multiplier, by which a wallet shows
  them, moves for splits and dividends, so a raw unit is not always one share.
- **PreStocks' mints charge a transfer fee**: the recipient gets less than was sent. Measure what
  arrived; [references/stocks.md](references/stocks.md) marks each mint that charges one.
- **Every stock mint has a transfer hook that names no program**, which is no hook.
- **The issuer can pause its mint**, and can hold a permanent delegate that can move or burn any
  balance. A new token account is usable, not frozen.

```sauce chain=solana
function main(recipient: Address, amount: Uint256): Uint256 {
  const before = recipient.SPACEX;
  SPACEX.transfer(recipient, amount);
  return recipient.SPACEX - before;
}
```

## Protocol namespaces

Every catalogued protocol has a namespace, resolved for the chain the program is compiled for, with
its address and ABI from the registry. A member is one of three kinds:

| Member              | Example                                                       | In a program                                                        |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| A deployed contract | `UniswapV3.Factory`, `AerodromeSlipstream.CLFactory`          | its address as a value; `.method(...)` calls it                     |
| An address only     | `AaveV3.PoolAddressesProvider`, `Maker.Dai` (no ABI recorded) | its address                                                         |
| An interface        | `Erc4626.Vault`, `UniswapV3.Pool` (no one fixed address)      | called with an address in the same expression: `(addr).method(...)` |

- `UniswapV3.Factory.getPool(a, b, 500)` calls the chain's factory; a Uniswap fee is in millionths
  (`500` is the 0.05% tier, `3000` 0.3%).
- An interface is called with the address of a deployment:
  `Erc4626.Vault(vault).deposit(...)`, `UniswapV3.Pool(pool).liquidity()` for a pool the program is
  given (`.at(pool)` is the same). A deployed contract's name is never called with an address;
  `.at(address)` reaches another deployment of its ABI.
- **A contract a call returns** is called on directly where the registry records what it is:
  `UniswapV3.Factory.getPool(a, b, 500).liquidity()`, `Erc4626.Vault(vault).asset().decimals()`
  (`sauce-script`, Calling a contract).
- **A namespace's default contract** is also called by the namespace alone, when the namespace has
  exactly one deployed contract with an ABI: `Cctp.depositForBurn(...)` calls `Cctp.TokenMessenger`.
  A namespace with several (`UniswapV3`) names the contract.
- **A family alias** (`Uniswap`, `Aave`, …) names a contract only when one member has it on the
  chain: `Uniswap.UniversalRouter` is `UniswapV4.UniversalRouter`; `Uniswap.Factory` is ambiguous.
- **A chain-qualified contract** (`Ethereum.UniswapV4.UniversalRouter`) is that chain's address
  only, never a call there (`sauce-chains`).
- **On Solana** there are no protocol namespaces; each price-limit venue is one instead, its
  protocol then its program (`Orca.Whirlpool.swap(pool, …)`, `sauce-swaps`), listed by
  `sauce globals --chain solana` under Venues, with the accounts a program writes where it uses them
  under Accounts (`sauce-solana`).

[references/protocols.md](references/protocols.md) lists every member and alias; how a program
calls one is `sauce-script`'s (Calling a contract).

## A name a chain may lack

Every name the registry has (each protocol namespace with every contract it has on any chain, each
token symbol some chain registers) is declared on every chain. A name the chain being compiled for
lacks is **zero** there.

- A **test** of such a name in a condition (`if`, `?:`, `!`) is decided while the
  program compiles, and the branch it rules out is not compiled at all, so it may call the absent
  contract. The spelling to use is `if (X)`; `if (!X) { return 0; }` (a guard that returns drops
  the rest of its block where `X` is absent), `X != 0`, `X == 0`, `X ? a : b`, `X && …` and
  `X || …` are tests too.
- Any **other** use of an absent name (a call on it, passing it, returning it, `const a = X`) is
  refused when the program compiles, at the use, naming the chain, so a zero never reaches the
  chain as a contract address. `require(X != 0)` on a chain without `X` is refused as well: it
  would fail whatever the program does.
- A decision is made only from registry names, `true`/`false`, `!`, `&&`, `||` and comparisons with
  `0` (`== 0` or `!= 0`; `X > 0` is a use of `X`). A branch behind any other value
  (`let has = X != 0; if (has) { … }`) is live code, and an absent name in it is refused. Outside a
  condition `X && Y` and `X || Y` give true or false and each side is a test, so
  `const both = X && Y` compiles where `X` is absent. A helper function is checked as if it ran: it
  tests the name itself, or is refused on a chain that lacks the name.
- A name no chain has (`Uniswapp`, or a contract its namespace does not have) is refused where it
  is written, with the names it is nearest, so a typo cannot quietly drop a branch.
- There is no `available` call: test the name itself. Calling it is refused.

```sauce chain=base,linea
function main(tokenA: Address, tokenB: Address) {
  if (UniswapV3.Factory) {
    const pool = UniswapV3.Factory.getPool(tokenA, tokenB, 500);
    require(pool != 0, "no 0.05% pool");
  }
}
```

## Chain names and `chainId`

- **A chain name** (`Base`, `Ethereum`, … in [references/chains.md](references/chains.md))
  qualifies another chain's contract address (`sauce-chains`).
- **`chainId`** is the id of the chain the program is compiled for, a constant
  (`sauce-chains` says when it differs from `ctx.chainId()`).

## Imports the package serves

| Import                             | What it is                               |
| ---------------------------------- | ---------------------------------------- |
| `@sauce/router`                    | the swap library (`sauce-swaps`)         |
| `@sauce/token`                     | the token library the methods compile to |
| `./artifacts/IERC20.json`          | the raw ERC-20 ABI (above)               |
| `./artifacts/ISauceRouter.json`    | the Router itself                        |
| `./protocols/<slug>/<Export>.json` | every protocol ABI (`sauce-protocols`)   |

## Pitfalls

- **A write through `IERC20`.** It is not SafeERC20; use the token syntax.
- **A standing allowance.** Approve exactly what the next call spends.
- **A stock's symbol in the wrong case, or another issuer's on this chain.** Search by name or
  ticker on the chain you compile for.
- **A rebasing or fee-charging token paid by its nominal amount.** Measure what arrived.
- **A family alias two members share** (`Uniswap.Factory`). Name the member.
- **A contract a chain may lack, used outside a test.** It is refused where the chain lacks it:
  put the use in `if (X) { … }` or compile only for chains that have it.

## Files

- [examples/globals.sauce.ts](examples/globals.sauce.ts) uses each kind of name.
- [examples/globals.mts](examples/globals.mts) compiles it and pins the SafeERC20 lowering, the
  `IERC20` import rule, the family-alias rules and the rules for a name a chain lacks.
- [references/tokens.md](references/tokens.md), [references/stocks.md](references/stocks.md),
  [references/protocols.md](references/protocols.md), [references/chains.md](references/chains.md):
  generated indexes, the lists `sauce globals` prints.
