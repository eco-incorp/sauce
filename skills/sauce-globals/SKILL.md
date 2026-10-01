---
name: sauce-globals
description: The names a Sauce program uses without any import, and how they resolve on the chain it is compiled for — token symbols (USDC, USDT, WETH, …), Token(address) and a bound const t = Token(x), the token methods .transfer/.approve/.transferFrom/.balanceOf with SafeERC20 behaviour and USDT, the @sauce/token functions, protocol namespaces (UniswapV3.Factory, UniswapV4.StateView, AaveV3.Pool, …) and family aliases, available(...) for a venue a chain may lack, the Namespace_Contract compile-time defines, chain names, chainId and ctx.*. Links generated indexes of every token, protocol contract and chain, the same lists sauce globals prints. Use when writing any Sauce program that moves tokens, calls a protocol or names a chain, when checking whether a name exists on a chain, or when a name does not resolve ("is not a declared variable", "ambiguous", "is not deployed").
---

# Globals in a Sauce program

A program compiled for a chain resolves these names against **that chain**, with no import. They
are program syntax, not JavaScript values. **Look names up before writing a program**:
`npx sauce globals --chain <chain>` lists one chain's, and these indexes list every chain's, from
the same registries the compile reads:

- [references/tokens.md](references/tokens.md): every token symbol per chain, with its address and
  decimals, and the `@sauce/token` functions.
- [references/protocols.md](references/protocols.md): every `Namespace.Contract`, the chains it is
  deployed on, and the family aliases.
- [references/chains.md](references/chains.md): every chain name, its id, and whether it takes
  intents.

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
| `.balanceOf(owner)`               | balance read; `self.USDC` is the Pot's own balance        |

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
  require(allowance(USDT, ctx.self(), payee) == 0n, "no allowance left standing");
}
```

**`IERC20` is low level, and only imported.** `import { IERC20 as Erc20 } from
"./artifacts/IERC20.json"` binds the raw ERC-20 ABI for a call the token syntax does not offer. Its
writes decode the declared `bool`, so they are not SafeERC20 (USDT's `transfer` reverts there, and
a `false` return passes): never write a token transfer or approval through it. Import it under a
name of its own, as here, in a file that also uses the token syntax, which binds `IERC20` itself.

## Protocols

- `Namespace.Contract` is the contract's address on the program's chain where a value is expected,
  and a bound contract where a method is called: `UniswapV3.Factory.getPool(a, b, 500n)`.
- A namespace's default contract is also called by the namespace alone:
  `Cctp.depositForBurn(...)` calls `Cctp.TokenMessenger`.
- A family alias (`Uniswap`, `Aave`, …) names a contract only when one member has it on the chain:
  `Uniswap.UniversalRouter` is `UniswapV4.UniversalRouter`; `Uniswap.Factory` is ambiguous.
- `Ethereum.UniswapV4.UniversalRouter` takes Ethereum's address but still executes on the program's
  own chain; running on another chain is an intent (`sauce-intents`).
- Every catalogued protocol has a namespace. An interface, such as `Erc4626.Vault`, has no one
  address and is called at one: `Erc4626.Vault.at(vault).deposit(...)` (`sauce-protocols`).

**A venue a chain may not have** is asked with `available(<name>)`, decided when the program is
compiled for a chain: `if (available(UniswapV3.Factory)) { ... }` keeps its branch where the chain
has the contract, and removes it, names and all, where it does not. It takes a contract or a token
symbol (`available(USDT)`); it folds `if`/`else`, `?:`, `&&`, `||` and `!`; and a guard
`if (!available(X)) { return 0n; }` drops the rest of its function. A name no chain has is an
error rather than `false`, so a typo cannot quietly drop a branch. `Namespace.Contract` without it
is for a contract the program requires: on a chain without it, the program does not compile.

```sauce chain=base,linea
function main(tokenA: Address, tokenB: Address) {
  if (available(UniswapV3.Factory)) {
    const pool = UniswapV3.Factory.getPool(tokenA, tokenB, 500n);
    require(pool != 0n, "no 0.05% pool");
  }
}
```

## Chains, context, imports

- **Chain names** (`Arbitrum`, `Base`, … in [references/chains.md](references/chains.md)) open an
  intent from inside a program: `Arbitrum(() => { ... }).reward({ ... })`.
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

- **Imports the package serves** to a program with `main`: `./artifacts/IERC20.json`,
  `./artifacts/ISauceRouter.json` (the swap Router, `sauce-swaps`), every protocol ABI as
  `./protocols/<slug>/<Export>.json`, and `@sauce/token`.

## Example

[examples/globals.sauce.ts](examples/globals.sauce.ts) uses each kind of name;
[examples/globals.mts](examples/globals.mts) compiles it and pins the SafeERC20 lowering, the
`IERC20` import rule, the family-alias rules and `available(...)`.
