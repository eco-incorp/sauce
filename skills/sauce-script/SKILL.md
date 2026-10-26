---
name: sauce-script
description: SauceScript authoring for .sauce.ts programs, including inputs, signed and unsigned integers, contract calls and unread results, helpers, atomic try/catch rollback and revert data, program closures, builtins and compile errors. Use when writing or editing a Sauce program, fixing a compile error, or checking which syntax and builtins a target supports.
---

# SauceScript

The language a Sauce program is written in. This skill owns the program's forms and header, its
values, calls, functions and failure, the builtins, gas and compile errors. The names a chain
supplies (`USDC`, `UniswapV3.Factory`) are `sauce-globals`'s; running a program is `sauce-cli`'s.

## When to use

| Task                                            | Here                                                  | Elsewhere                                          |
| ----------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Write or edit any program; its header           | yes                                                   |                                                    |
| A compile error                                 | yes                                                   | a name that does not resolve: `sauce-globals`      |
| Call a contract; choose who receives its output | yes                                                   | which protocol and its pitfalls: `sauce-protocols` |
| Whether a construct or builtin exists           | yes, [references/builtins.md](references/builtins.md) |                                                    |
| The names a chain has, an address               |                                                       | `sauce-globals`, `sauce-chains`                    |
| Accounts on Solana                              |                                                       | `sauce-solana`                                     |

## Core model

- A program is a `.sauce.ts` file compiled **for a chain** (`--chain`). Compiling lowers the names
  that chain supplies and the token syntax; everything else reaches the compiler as written,
  annotations included.
- **A balance is `<holder>.<TOKEN>`, on any address or contract**: `pot` is the Pot and `pot.USDC`
  its USDC, `recipient.USDC` a parameter's, the same read as `USDC.balanceOf(recipient)`. The native
  coin is `.balance` (wei on an EVM chain, lamports on Solana): `pot.balance` is
  `ctx.selfBalance()`. Which holders each target takes, and the token methods, are
  `sauce-globals`'s.
- Its inputs are `main`'s parameters, taken in declaration order, ABI-encoded and appended to the
  bytecode: one compiled program serves every value. `--args` passes them (`sauce-cli`).
- Integers are checked `Uint256` or `Int256`; amounts are in smallest units.
- Uncaught failure reverts the whole transaction. EVM `try` blocks roll back only their own work
  before running a handler; a single-call catch handles only that external call's failure.
- **Look a builtin up in [references/builtins.md](references/builtins.md) before using it**: every
  type, literal, operator, statement, `ctx`, `crypto`, `Math`, `abi`, `evm` and `svm` builtin,
  value method, account property, contract binding and limit, with its targets, an example and the
  exact error a misuse gives. [references/builtins.json](references/builtins.json) is the same list
  as data.

## Program forms

| Form                   | Inputs                                                    | Use for                                                                 |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| **`function main(…)`** | `main`'s parameters, passed with `--args`                 | every program that takes an input (tokens, amounts, recipients, limits) |
| **Top-level script**   | none: every value is written in the file or read on chain | a program with no inputs                                                |

A `main` program may declare module constants, helpers and imports. (The `chain=…` after a fence
here only says which chains the block is checked on; it is not part of the file.)

```sauce chain=base,arbitrum
// A fixed value of the program: a module constant, folded into the bytecode.
const FEE_BPS = 30;

// A helper. It returns a value on every path.
function afterFee(amount: Uint256, bps: Uint256): Uint256 {
  return amount - (amount * bps) / 10000;
}

// Runtime inputs: main's parameters, passed with the transaction.
function main(recipient: Address, floor: Uint256) {
  const held = pot.USDC;
  if (held < floor) {
    throw "below floor";
  }
  USDC.transfer(recipient, afterFee(held, FEE_BPS));
}
```

**`main` may return a value**, which the cook returns to its caller, so a simulation reads it
without sending anything (`sauce simulate` prints it after `returns`). Declare the type: an
`Address`, `Uint256` or `bool` is one 32-byte word; a record is its fields, one word each; an array
its elements, one word each, with no length or offset in front; `bytes` is the bytes themselves, so
`return abi.encode(spent, bought)` gives two words. A `void` `main` returns nothing. A program that
only reads and returns, simulated, is a way to read a chain:

```sauce chain=base,arbitrum
// The Uniswap V3 WETH/USDC pool at the 0.05% tier (500 millionths), or 0 where there is none.
function main(): Address {
  return UniswapV3.Factory.getPool(WETH, USDC, 500);
}
```

A top-level script runs its statements in order, after its imports, and may declare helpers beside
them. A `const` at its top is the script's own local: a helper cannot read it (pass it in). Declare
`main` instead to take inputs, share a module constant with helpers, or return a value.

```sauce chain=base,arbitrum
// A helper takes what it needs as parameters.
function afterFee(amount: Uint256): Uint256 {
  return amount - amount / 1000;
}

// Supplies the USDC this Pot holds, less 0.1%, to Aave V3 for the Pot's owner: in a cook on the
// owner's Pot, `ctx.msgSender()` is the owner who sent it, so the aTokens land in their wallet.
// `pot` there would keep them in the Pot.
const held = pot.USDC;
require(held >= 1000000, "below 1 USDC");
const supplied = afterFee(held);
USDC.approve(AaveV3.Pool, supplied);
AaveV3.Pool.supply(USDC, supplied, ctx.msgSender(), 0);
```

## The header

Every program opens with a comment that says, in order:

1. what it does, in one line;
2. the `sauce` command that runs it, with `--chain <chain>` (a program names no chain) and `--args`
   naming every `main` parameter in order: `--args <tokenIn> <tokenOut> <amountIn>`;
3. one line per parameter, `name: Type`, its meaning and its units, in smallest units
   (`5000000000` is 5,000 USDC, which has 6 decimals); an array or a record is passed as JSON;
4. one concrete run on a supported chain with real values: addresses from the registry
   (`sauce globals --chain <chain> --tokens`), the developer's own inputs as `<placeholders>`.

```sauce chain=base
// Pays each of `recipients` `amount` of the chain's USDC, from the Pot.
//
//   sauce run payout.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <recipients> <amount>
//
//   recipients: Address[]  who is paid, a JSON array: '["<recipient>","<recipient>"]'
//   amount: Uint256        what each is paid, in USDC's smallest units (6 decimals):
//                          5000000 is 5 USDC
//
// On Base, 5 USDC to each of two recipients:
//
//   sauce run payout.sauce.ts --chain base --keystore <keystore> \
//     --args '["<recipient>","<recipient>"]' 5000000
function main(recipients: Address[], amount: Uint256) {
  for (const to of recipients) {
    USDC.transfer(to, amount);
  }
}
```

## Inputs and fixed values

| Value                                                        | Write it as                 | Arrives                                |
| ------------------------------------------------------------ | --------------------------- | -------------------------------------- |
| What the caller chooses per run: tokens, amounts, recipients | a **`main(...)` parameter** | with the transaction (`--args`)        |
| A value the program fixes: a fee, a pool's tier              | a **module constant**       | folded into the bytecode               |
| A value the chain supplies                                   | a name (`sauce-globals`)    | resolved when compiling for that chain |

## Values

- **Integers** are checked 256-bit values, written plainly (`3000`, `10 ** 18`); bigint suffixes
  work too. Nonnegative values default to `Uint256`, negative literals to `Int256`. Write `~0` for
  the unsigned maximum. A signed amount from an unsigned input is `-Int256(amount)`: plain
  `-amount` is checked unsigned negation and rejects nonzero values.
- **Signed operations** use `Int256` and ordinary `/`, `%`, `>>` and comparisons. Convert with
  `Int256(value)`/`Uint256(value)` (checked) or `.fromBits(value)` (bit reinterpretation).
  Mixed arithmetic needs a conversion; mixed comparisons compare mathematical values.
  ABI `intN` outputs and `Math.signExtend` now produce `Int256`; annotate signed helper returns.
- **Addresses** are numbers: a `main` parameter, a name such as `USDC`, or a literal from the
  registry written as its hex (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`), never an invented one.
- **`bytes`**: `` hex`a9059cbb` ``, `"text"`, `.concat`, `.slice(a, b)`, `.length`, `b[i]`,
  `x.toBytesBe(32)`, `x.toBytesLe(8)`, `abi.encode`/`abi.decode` (EVM). `hex` is the only template
  form; untagged template literals are rejected. Byte methods also work directly on bytes literals.
- **Arrays and records**: `[a, b]`, `new Array(n)`, `xs[i] = v`, `xs.length`, `{ amount: 1 }`. A
  record type is an `interface` or an inline object type
  (`orders: { amount: Uint256, to: Address }[]`; `;` between fields works too). Destructuring, `const [a, b] = …`, takes a record (a
  multi-output call, `abi.decode`); an array is indexed instead.
- **Annotations** go wherever the language takes them: `function half(x: Uint256): Uint256`,
  `let total: Uint256 = 0;`. An unannotated parameter is a `Uint256`; an unannotated local takes
  its initializer's type. Trailing commas are fine.
- **`Account` parameters** (`Account<Writable>`, `Account<Signer>`) are `main`'s alone: on Solana
  the transaction's accounts (`sauce-solana`); on an EVM chain only a bare `Account` compiles, as
  an address.
- **Module `let`s** start from scalar literals and reset every run; they are not persistent storage.
  A module `const` can hold known expressions, static objects/arrays or contract bindings. Plain
  runtime data belongs inside a function; persistent state is `evm.sstore`/`svm.sstore`.
- **Known values** decide branches and specialize helper calls during compilation. `program((fee)
=> { … }, feeValue)` builds `{ code, args }` from an inline arrow with explicit read-only captures.
  Read the reference's closure rules before using captured arrays, records or cross-target options.

### `ctx`: the transaction's context

Each read is a call; the complete list, per target, is section 6 of
[references/builtins.md](references/builtins.md).

| Read                                                                                                         | EVM                                                     | Solana                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------- |
| `ctx.self()`                                                                                                 | the executing contract: the Pot; a program writes `pot` | the engine's program id; the Pot only as a token's holder |
| `ctx.msgSender()`                                                                                            | the immediate caller: the owner, in a cook on their Pot | the first signer among the accounts the engine receives   |
| `ctx.msgData()`                                                                                              | the program's whole input                               | the instruction data                                      |
| `ctx.timestamp()`, `ctx.chainId()`, `ctx.selfBalance()`                                                      | yes                                                     | yes                                                       |
| `ctx.balance(a)`                                                                                             | the balance of `a`                                      | an attached account's lamports: pass `acct.address`       |
| `ctx.blockNumber()`                                                                                          | block number                                            | slot                                                      |
| `ctx.msgValue()`, `ctx.gasLeft()`, `ctx.codeSize(a)`, `ctx.codeHash(a)`, `ctx.isContract(a)`, `ctx.isEOA(a)` | yes                                                     | rejected                                                  |
| `ctx.txOrigin()`, `ctx.gasPrice()`                                                                           | the transaction's signer and gas price                  | rejected                                                  |
| `ctx.coinbase()`, `ctx.prevrandao()`, `ctx.blockGasLimit()`, `ctx.baseFee()`, `ctx.blobBaseFee()`            | the block's fee recipient, randomness, gas limit, fees  | rejected                                                  |
| `ctx.blockHash(n)`, `ctx.blobHash(i)`                                                                        | a recent block's hash; the transaction's blob hashes    | rejected                                                  |

`ctx.txOrigin()` is the account that signed the transaction, which is not the program's caller
whenever a contract stands between them. Authorize on `ctx.msgSender()`, never on the origin: a
check of the origin passes for any contract the signer calls. `ctx.blobBaseFee()` halts the cook
on a chain that does not implement that read, such as Arbitrum or Polygon, although it compiles
there.

## Calling a contract

Call a contract by name, in this order of preference:

1. **A namespace**, for a contract the chain's registry records: `UniswapV3.Factory.getPool(...)`,
   `AaveV3.Pool.supply(...)`, typed by the registry's ABI, at the chain's address. Which
   namespaces, members and aliases exist is `sauce-globals`'s.
   - **A contract a call returns**: where the registry records which contract an address a
     function returns is (a factory's pool, a pool's tokens, a vault's asset; the function's line
     in its `sauce-protocols` registry file says so), call that contract's methods on the result,
     or on a `const` holding it: `UniswapV3.Factory.getPool(WETH, USDC, 500).liquidity()`,
     `pool.token0().decimals()`. A token returned this way takes the ERC-20 functions, and its
     `transfer`, `approve` and `transferFrom` are SafeERC20, as `Token(address)`'s are. It is the
     same program as naming the contract, below. Keep the result in a `const`, not a `let`.
   - **Any other address**: name the interface that describes it, a registry ABI with no address of
     its own, called with the address in the same expression: `UniswapV3.Pool(pool).slot0()` for a
     pool the program is given, `Erc4626.Vault(vault).totalAssets()`. A method called on an address
     whose contract the registry does not record fails to compile, naming these spellings.
   - `.at(address)` reaches another deployment of a named contract's ABI: `AaveV3.Pool.at(address)`.
2. **A registry ABI import**, where the chain has no namespace for it: the protocol's registry file
   in `sauce-protocols` gives the line, such as
   `import VaultABI from "./protocols/erc4626/VaultABI.json"`, then
   `VaultABI.at(vault).convertToAssets(shares)`.
3. **The program's own ABI**, for a contract no registry knows or a function its registry ABI does
   not declare: a JSON ABI file beside the program, holding only the functions the program calls,
   with the deployed contract's types from its verified source, imported by relative path as its
   default export: `import IOracle from "./IOracle.json"`, then `IOracle.at(pool).observe(...)`. The
   `sauce` command reads it from beside the file; through the MCP server, pass it in `modules`
   (`{ "IOracle.json": "<its JSON>" }`).

Never call through `evm.static` or `evm.call` with a hex selector where one of these exists: the
typed call encodes arguments and names outputs. Select the field you need for clarity, but any read
still decodes **all** declared outputs, including unused siblings. Discarding the entire result skips
all output checks; it is not SafeERC20 validation.

```sauce chain=base,ethereum
function main(vault: Address, shares: Uint256): Uint256 {
  // A contract the chain's registry records: its factory, by name. What getPool returns is a
  // Uniswap V3 pool, so the pool's methods are called on it.
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC 0.05% pool");
  const [sqrtPriceX96] = pool.slot0();
  require(sqrtPriceX96 > 0, "the pool is not initialized");
  require(pool.token0().decimals() > 0, "token0 has no decimals");
  // An address the program is given: named by the interface that describes it.
  return Erc4626.Vault(vault).convertToAssets(shares);
}
```

### Who receives what a call produces

Every call comes from the Pot. A call that credits its caller, or names `pot` as its
beneficiary, leaves the output in the Pot. A call that names a beneficiary (a lending market's
`onBehalfOf`, a vault's `receiver`, a swap's `recipient`, a bridge's `to`) credits that address:
make it a `main` parameter, the user's wallet or `pot` as the user chose (`sauce-overview`
says to ask). In a cook on the user's own Pot `ctx.msgSender()` is its owner.

```sauce chain=base,ethereum
// Supplies `amount` of the Pot's USDC to Aave V3 for `onBehalfOf`, who receives the aTokens: the
// user's wallet, or the Pot itself (`pot`) when the user keeps the position there.
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
}
```

## Functions

- **Call what exists directly**: `USDC.transfer(...)`, `UniswapV3.Factory.getPool(...)`,
  `uniswapV3(...)` from `@sauce/router`. Keep a helper only for real logic used more than once;
  one that wraps a single call adds nothing and costs a call frame of gas.
- Helpers are top-level `function` declarations, annotated on the signature. They may call each
  other and recurse; `main` is never called.
- **A helper returns on every reachable runtime path.** Known arguments may decide branches while
  compiling. If any remaining path can end without a return, add one or reject that path explicitly.

```sauce fails chain=base
function larger(a: Uint256, b: Uint256): Uint256 {
  if (a > b) {
    return a;
  }
}

function main(a: Uint256, b: Uint256): Uint256 {
  return larger(a, b);
}
```

- **Arrays and records are passed by reference**: a helper that writes `xs[i] = v` changes the
  caller's array. Numbers, bools and bytes are copies.
- **A comparison is a `bool`, but a function with no return annotation returns a number**, even
  `return a > b` (1 or 0). Give a yes-or-no helper a `: bool` return type:

```sauce chain=base,arbitrum
// Selling token0 (the lower address) pushes a pool's price down, so a higher price is better.
function isBetter(price: Uint256, than: Uint256, sellsToken0: bool): bool {
  if (sellsToken0) {
    return price > than;
  }
  return price < than;
}

// Fills `best` in place: an array goes to a helper by reference.
function keepBest(best: Uint256[], price: Uint256, sellsToken0: bool): void {
  if (best[0] == 0 || isBetter(price, best[0], sellsToken0)) {
    best[0] = price;
  }
}

function main(prices: Uint256[], tokenIn: Address, tokenOut: Address): Uint256 {
  let best = new Array(1);
  for (const price of prices) {
    keepBest(best, price, tokenIn < tokenOut);
  }
  return best[0];
}
```

## What compiles, and what to write instead

Compiles: `let`/`const`, `if`/`else if`/`else`, `while`, C-style `for`, `for...of` over an array,
`break`/`continue`, `i++` and `+=` as statements, ternaries, `&&`/`||`/`!`, `**`, bit operators,
`/` and `%`, helpers, `Math.mulDiv(a, b, c)`, `Math.sqrt(x)`. The full list, with each rejection's
message, is section 14 of [references/builtins.md](references/builtins.md).

| Rejected                                                       | Write instead                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `switch`, `for...in`, `class`, `enum`, `type` aliases, `await` | `if` chains, arrays, inline object types, plain functions                        |
| `finally`, `throw new Error(...)`                              | EVM `try`/`catch`; `require(cond, "reason")` or `throw "reason"` on both targets |
| arbitrary arrows, nested functions                             | top-level helpers; arrows only in `.catch(...)` and `program(...)`               |
| template literals, comparing bytes with `==`                   | `"text"`, or bytes built with `.concat`; compare `crypto.keccak256` of each      |
| `as` casts, default parameters, spread, object destructuring   | explicit values and field access                                                 |
| `arr.push(x)`, `console.log`, `Math.min`/`max`/`abs`/`pow`     | `new Array(n)` and an index; `if`; `**`                                          |

```sauce fails
function main(x: Uint256): Uint256 {
  switch (x) {
    case 1:
      return 1;
  }
  return 0;
}
```

## Failure, `try` and `.catch`

An uncaught `require(false)`, `throw`, reverting call or checked operation reverts the whole
transaction. Every safety check belongs in the program.

On **EVM**, a multi-statement `try` is an atomic unit. Its calls, writes and assignments all commit
on success, or all roll back on failure before `catch` runs. Work before the block remains.
Unlike JavaScript, a variable assigned before a failure returns to its earlier value.

```sauce chain=base
function main(recipient: Address, amount: Uint256, reserve: Uint256): void {
  try {
    USDC.transfer(recipient, amount);
    require(pot.USDC >= reserve, "keep the reserve");
  } catch (error) {
    // The transfer was undone too. Error bytes may be empty or truncated.
    log(error);
  }
}
```

A `try` containing only one external call has the same boundary as `.catch(...)`: it catches the
call's failure, not argument evaluation or decoding a successful reply. Any read of a bound call's
output still decodes **all** its declared outputs. An unread result, even an unused variable,
skips decoding/checks: empty/malformed replies and a no-code target can then pass. Check
`ctx.isContract` where required; token writes should use the SDK's checked token methods.

`catch (error)` and `.catch((error) => { … })` receive at most 256 raw revert bytes; check their
length and shape before decoding. A handler's own failure propagates; there is no `finally`.
Neither catch form exists on Solana. The full rules are in section 13 of
[references/builtins.md](references/builtins.md).

```sauce chain=base,ethereum
import PoolABI from "./protocols/uniswap-v3/UniswapV3PoolABI.json";

// A Uniswap V3 pool's liquidity, or 0 when the pool refuses the read.
function main(pool: Address): Uint256 {
  require(ctx.codeSize(pool) > 0, "no contract at the pool address");
  return PoolABI.at(pool)
    .liquidity()
    .catch(() => {
      return 0;
    });
}
```

- **The value form**, `const v = <call>.catch(() => { return <constant>; });`, gives the constant
  when the call fails. It takes a bound method with one output (a namespace contract's, an imported
  ABI's). A raw `evm.call`, `evm.static` or `evm.delegate` returns bytes, which no constant stands in
  for ("a `.catch()` fallback: expected a bytes value, found a number"): test a raw read with the
  statement form, then read again only when it worked. A read changes nothing, so the second call is
  safe; never repeat a write that way.
- **A no-code address succeeds with empty data.** A read result's decode can fail outside its
  single-call catch. Check `ctx.isContract(address)` first when code must exist:

```sauce chain=base,arbitrum
// One word from a read that may fail, or 0: an address with no code, or a read that reverts.
function readWord(target: Address, query: bytes): Uint256 {
  if (ctx.codeSize(target) == 0) {
    return 0;
  }
  let readable = true;
  evm.static(target, query).catch(() => {
    readable = false;
  });
  if (!readable) {
    return 0;
  }
  return abi.decode(evm.static(target, query), ["Uint256"])[0];
}

function main(target: Address, query: bytes): Uint256 {
  return readWord(target, query);
}
```

## Gas

Simulation reports the gas a cook needs; it includes the transaction, Kitchen, Pot, protocol calls
and program execution. Bound loops and read repeated values once. Leave headroom for chain state
to change before inclusion, especially swaps that may cross more ticks.

On EVM, `.gas(n)` on a bound call, or the optional final `gas` argument on a raw `evm.call`,
`evm.static` or `evm.delegate`, caps what that call receives. Omitted forwards what the EVM allows;
zero forwards no gas. This is not the transaction's gas limit. A callee running out of gas is a
call failure a catch can handle; the enclosing program still needs gas to recover.

## In an editor

An editor checks a `.sauce.ts` file as TypeScript, which knows none of SauceScript's names: with no
project for them it marks `Token`, `USDC`, `ctx` and every other name as unknown.
`sauce init <dir> --tsconfig` writes `<dir>/tsconfig.json`, which types every `.sauce.ts` under
`<dir>` as SauceScript (its types and builtins, each chain's tokens and namespaces, the ABIs a
program imports); `sauce init` makes `programs/` such a directory. The types come from the package,
so the project must have it installed; with the project's own TypeScript running the editor, what
TypeScript reports on valid SauceScript (a `bigint` index, a plain integer beside a `Uint256`) is
dropped too. The compile, not the editor, decides whether a program is valid.

## Compile errors

A compile error fails the command; there is no warning channel. `sauce compile` points at the
file's line and column, including on a line the package rewrote, and a `hint:` line names what to
add. For any message not here, search [references/builtins.md](references/builtins.md).

| Message                                                | Means                                                                                | Do                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `X is not a declared variable`                         | a typo, a name the chain does not have, or a value that should be a `main` parameter | check the name (`sauce-globals`), or add the parameter    |
| `Unexpected token`                                     | a syntax error at that line and column                                               | fix the syntax                                            |
| `a function argument: expected a number, found a bool` | the called function's parameter has no annotation, so it is a number                 | annotate it: `first: bool`                                |
| `does not return on every path`                        | a helper can end without a `return`                                                  | end it with a `return`                                    |
| `a nested function declaration is not supported`       | a function declared inside another function or a block                               | declare it at the top level                               |
| `X is called but never declared`                       | a function not in scope, usually a typo                                              | fix the name                                              |
| `calling anything other than a plain function name`    | an unsupported call expression                                                       | use a named helper, contract binding or supported builtin |
| `must be initialized with a literal`                   | a module-level `let` or `const` given a computed value                               | compute it inside a function                              |
| `the registry does not record which contract it is`    | a method called on an address a registry function returns, of no recorded contract   | name its interface, as the message spells it              |
| `does not name a function`                             | a method called on an address in a variable or parameter                             | name its interface: `UniswapV3.Pool(pool).liquidity()`    |

## Pitfalls

- **An untyped helper parameter is a `Uint256`.** Annotate every parameter that is not.
- **A comparison returned from an unannotated function is a number.** Annotate `: bool`.
- **A script's top-level `const` is invisible to its helpers.** Pass it in, or use `main` and a
  module constant.
- **A no-code target is not a failed call.** Unread output skips validation; read output can fail
  decoding outside a single-call catch. Check `ctx.isContract` and use checked token writes.
- **A raw selector where a binding exists.** Use the namespace, the registry ABI or an ABI file.
- **Amounts in whole tokens.** Integers are smallest units: 1 USDC is `1000000`.

## Files

- [examples/twap.sauce.ts](examples/twap.sauce.ts) finds a pool through `UniswapV3.Factory` and
  reads its price history through its own ABI beside it,
  [examples/IOracle.json](examples/IOracle.json), which declares the one function the registry's
  pool ABI lacks, `observe`.
- [examples/saucescript.mts](examples/saucescript.mts) compiles a guarded program, asserts each
  rejection above, and pins what compiling for a chain adds.
- [references/builtins.md](references/builtins.md) and
  [references/builtins.json](references/builtins.json): the language reference, held to the
  compiler (every example compiles, every rejection is refused with the message it quotes).
