<!-- Generated: a copy of skills/sauce-script/references/builtins.md. Edit that file, not this one. -->

# SauceScript reference

**Reference** · [Documentation](../README.md)

> SauceScript is the language programs are written in: a small, strict TypeScript. This page is its
> dictionary: every type, statement and built-in function, and which chains allow each. Learning the
> language? Start with [Write your first program](../guides/write-your-first-program.md);
> [SauceScript](../concepts/saucescript.md) explains why it is shaped this way.

SauceScript is the checked subset of TypeScript that Sauce programs are written in. You compile a program for
one of two targets:

- **EVM** (`target: "evm"`): Ethereum and other EVM chains.
- **SVM** (`target: "svm"`): Solana.

Every entry below says where it works: **Both**, **EVM** or **SVM**. Using something on the wrong target is a
compile error, never a silent difference.

Examples state their supported targets. Diagnostic wording is illustrative; applications should
use structured diagnostic locations and codes rather than matching text. `builtins.json` lists
documented builtins with one example program per target.

**Contents**

1. [Types](#1-types)
2. [Literals](#2-literals)
3. [Operators](#3-operators)
4. [Variables, control flow, functions and modules](#4-variables-control-flow-functions-and-modules)
5. [`require`, `revert`, `throw`, `log`, `eval`](#5-require-revert-throw-log-eval)
6. [`ctx`: context reads](#6-ctx-context-reads)
7. [`crypto`](#7-crypto)
8. [`Math`](#8-math)
9. [`abi`](#9-abi-evm) (EVM)
10. [`evm`](#10-evm-evm) (EVM)
11. [`svm`](#11-svm-svm) (SVM)
12. [Methods on values, and account properties](#12-methods-on-values-and-account-properties)
13. [Contract bindings and `.catch()`](#13-contract-bindings-and-catch-evm) (EVM)
14. [Not supported, and what to write instead](#14-not-supported-and-what-to-write-instead)
15. [Limits](#15-limits)

**On Solana (SVM), at a glance.** Entries marked **Both** work there too. What differs:

- Accounts are `main` parameters with roles: `Account` in §1, account properties in §12, and the
  `svm` calls in §11, which only SVM has.
- `ctx` (§6): `ctx.self()` is the engine's program id (it owns every Pot account, and not only
  Pot accounts),
  `ctx.msgSender()` the first signer among the accounts the engine receives, and
  `ctx.msgValue`, `gasLeft`, `codeSize`, `codeHash`, `isContract`, `isEOA` and the block and
  transaction reads (`txOrigin`, `baseFee`, `blockHash`, …) do not exist.
- `log` takes no topics (§5).
- `abi`, `evm` and contract bindings with `.catch()` (§9, §10, §13) are EVM only: a call to another
  program is `svm.call`.
- Limits (§15): 64 KiB of working memory, and the program, its arguments and the cook together in
  one 1,232-byte transaction unless the program is staged.

---

## 1. Types

- `Uint256`, `Address`, `number`, `bigint`: A **number**: one unsigned 256-bit integer. An address
  is a number.
- `Int256`: A signed integer from −2²⁵⁵ through 2²⁵⁵ − 1. Negative literals infer this type.
- `bool`, `boolean`: A **bool**: true or false. It is kept apart from numbers, so `flag + 1` is an
  error. Comparisons produce bools.
- `bytes`, `string`: A **bytes value**. A `"text"` literal is its UTF-8 bytes.
- `T[]`: An array whose elements all have type `T`
- `{ a: T, b: U }`, or the name of an `interface`: A **record** with named fields
- `Account`, `Account<Writable>`, `Account<Signer>`, `Account<Writable, Signer>`: **SVM:** an
  account the transaction attaches, declared as a `main` parameter, optionally with the roles it
  must have. **EVM:** `Account` is just an address, and roles are an error: "`an Account role` is
  not available on the evm target; an `Account` is an address value on the EVM — write `Account`
  alone".
- `void`: No value (return type only)

- A parameter without an annotation is a number. So is the result of a function without a return annotation,
  even one that returns a comparison or `true`: it comes back as 1 or 0. `if`, `while`, `&&` and `!` take that,
  but a `: bool` function cannot return it: "a return value: expected a bool, found a number". Give a helper
  that answers yes or no a `: bool` return type.
- A signed helper result needs `: Int256`; an unannotated helper defaults to `Uint256`.
- `Uint256` and `Int256` are reserved type names, not names for locals, parameters, constants,
  imports or functions. A negative literal cannot initialize a `Uint256`; use
  `const delta: Int256 = -10`.
- An unknown type name is rejected with a list of the valid ones, as in "`uint256` is not a type — write
  `Uint256`, `Int256`, `Address`, `Account`, `bool`, `bytes` or `string`, an array `T[]`, an inline object type `{ a: Uint256 }`
  for a tuple …". Union types, `Array<T>` and `[A, B]` tuple types are rejected the same way.
- In this reference, **scalar** means a number or a bool.

Common type errors:

- "`<what>` requires a scalar value": you passed bytes, an array or a record where one value is needed.
- "`<what>` requires a bytes value": you passed a value where bytes are needed.
- "`<what>`: expected a number, found a bool". At a call site, "a function argument: expected a number,
  found a bool" usually means the function's parameter has no annotation, so it is a number:
  annotate it, `flag: bool`.
- "`<what>`: expected an account, found a value" (and the reverse).

A builtin that does not exist on your target fails as "`<name>` is not available on the `<evm|svm>` target",
usually followed by what to use instead.

## 2. Literals

| Literal                            | Meaning                                                                | Example                                    |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| integers: `1`, `0xff`, `1_000_000` | numbers                                                                | `const ONE_TOKEN = 1000000000000000000;`   |
| `true`, `false`                    | bools                                                                  | `let filled = true;`                       |
| `"text"`                           | bytes (UTF-8)                                                          | `throw "below floor";`                     |
| `` hex`…` ``                       | raw bytes: an even number of hex digits, optional `0x`, spaces ignored | ``const selector = hex`a9059cbb`;``        |
| `[a, b, c]`                        | an array; every element has the same type                              | `const amounts = [100, 200];`              |
| `{ a: 1, b }`                      | a record; shorthand fields work                                        | `const order = { amount, recipient: to };` |

Write integers plainly. Each is read from its text as a 256-bit integer, so one past 2^53 is
exact. TypeScript's bigint spelling, `1n` or `0xffn`, is accepted too and is the same integer.

**Not literals:**

| Rejected                    | Error                                                                                                         | Write instead                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `1e18`                      | "not a valid integer literal"                                                                                 | `10 ** 18` or `1000000000000000000`     |
| `1.5`                       | "`1.5` is not a valid 256-bit literal"                                                                        | integers in the smallest unit           |
| `null`                      | has no supported runtime value                                                                                | `0` or a flag                           |
| `` `text` ``, `` `a${b}` `` | rejected, with or without `${}`                                                                               | `"text"`, or bytes built with `.concat` |
| a bad `hex`                 | "`hex`…`` is not a valid hex literal (expected an even number of `[0-9a-fA-F]` digits, optional `0x` prefix)" |                                         |
| `[1, true]`                 | "every element of an array literal must have the same type — …"                                               |                                         |

`undefined` can represent a missing compile-time member or an unused value, but cannot be returned,
encoded or otherwise consumed at runtime. An empty static array `[]` is accepted; annotate a runtime
array's element type when the program needs one.

## 3. Operators

- `+ - * / % **`, on integers → the operands' integer kind
  - **Checked.** Overflow, underflow and division by zero revert. Signed division also rejects
    `Int256`'s minimum divided by `-1`; division truncates toward zero and remainder keeps the
    dividend's sign. Known invalid constant expressions fail compilation.
  - Unsigned is the default: `1 - 2` underflows. `const delta: Int256 = 1 - 2` is signed `-1`.
    Fitting literals take context; an existing variable keeps its kind. Mixed signed/unsigned
    arithmetic needs an explicit conversion.
- `-x`, on an integer → the same integer kind
  - Checked negation. Negating a nonzero `Uint256` fails; write `-Int256(amount)`. Negating the
    signed minimum overflows. A negative literal such as `-1` is an `Int256`, not the unsigned maximum.
- `Int256(value)`, `Uint256(value)`: checked numeric conversions
  - Signed conversion rejects values above 2²⁵⁵ − 1; unsigned conversion rejects negatives.
    An annotation or scalar parameter/return conversion applies the same checks.
  - `Int256.fromBits(word)` and `Uint256.fromBits(value)` instead preserve the 256-bit pattern.
    Use these only when reinterpreting bits is intended.
- `~x`, on an integer → the same integer kind
  - Bitwise NOT. `~0` is the unsigned maximum.
- `& | ^ << >>`, on integers
  - `>>` is arithmetic on `Int256`, zero-filling on `Uint256`. A negative shift count is rejected.
- `< <= > >=`, on scalars → bool
  - Integer comparisons are mathematical, including across kinds: a negative signed value sorts
    below every unsigned value. Use `Int256.fromBits(raw)` to compare a raw word as signed.
- `== === != !==`, on scalars, or two accounts → bool
  - Bytes cannot be compared: "a comparison operator requires a scalar value". Compare
    `crypto.keccak256(a) == crypto.keccak256(b)` instead.
- `!x`, on a scalar → bool
- `a && b`, `a || b`, on scalars → bool
  - Short-circuit. The result is true or false, not one of the operands.
- `c ? a : b`, on `a` and `b` of the same type → that type
  - "the two arms of `? :` must have the same type — …"
- `=`, and `+= -= *= /= %= **= &= |= ^= <<= >>=`
  - Compound forms work on plain variables only: "a compound assignment to an array element …", "a
    compound assignment to a tuple field …".
- `x++`, `x--`, `++x`, `--x`, on a plain variable, **as a statement only**
  - "`++`/`--` as a value (they are statement-only here — write `i += 1n`)"

Accounts compare only with `==` and `!=`: "accounts compare for identity only — `==` and `!=`. …".
`>>>`, `??`, `typeof`, `instanceof`, `in`, `void`, `delete` and unary `+` are not supported (see §14).

## 4. Variables, control flow, functions and modules

**Variables**

- `let` and `const`, with several declarators per statement and optional annotations.
- A variable keeps its type: "`a` cannot be reassigned a value of a different type — …". A `const` cannot be
  reassigned: "`a` is declared `const` and cannot be reassigned".
- Read an array or bytes value with `a[i]`. A record is read by name (`t.amount`) or by a constant position
  (`t[0]`). A computed position is rejected: "a tuple index must be a number literal or a `const` bound to one — …".
- Write with `a[i] = v` or `t.amount = v`. An out-of-range constant index is a compile error ("array index 5 is
  out of range — this array has 2 element(s). …"), and a computed out-of-range index reverts.
- **Destructuring:** `const [a, b] = …` works on anything that produces a record: a multi-output contract call,
  `abi.decode`, a record, or `crypto.findPDA`. It does not work on an array: "a destructuring binding needs an
  initializer that produces a tuple — this one does not, so bind it to one name instead".
- `new Array(n)` makes an array of `n` zeros to fill by index.

**Control flow:** `if`/`else`, `while`, `for (init; test; update)`, `for (const x of array)`, unlabeled
`break`/`continue`, `return`, and blocks.

**Functions**

- Declare functions at the top level. They may call each other and recurse.
- A function other than `main` that returns bytes, an array or a record needs a return type: "returning a bytes
  value from a function other than `main` needs a return-type annotation — …".
- Every reachable runtime path must return. Known conditions may remove paths while compiling;
  a helper that can still fall through is rejected. Bare `return;` is only for `: void`.
- A `: void` function's result is not a value: "a call to a `: void` function produces no value, so its result
  can't be used as one — call it as a statement instead".
- `main` is the entry point and cannot be called from your code.
- A large helper may fail with "f keeps too many values in use at once — …". Pass related inputs
  as a record/array and shorten the helper. `main`'s input list does not have that helper limit.
- **Arrays and records are passed by reference.** A helper that writes `xs[i] = v` or `r.amount = v` changes
  the caller's array or record, so a helper can fill an array it is given. Numbers, bools and bytes are passed
  by value. A helper cannot replace an array parameter with a new array: "`<name>` cannot be reassigned a value
  of a different type — expected an element count known only at run time, found N element(s)".

**`main`'s arguments**

- `main`'s parameters are the program's runtime inputs. One compiled program serves every argument value.
- Arguments are ABI-encoded on both targets. Compact entry arguments and `entrySchema` were removed
  in compiler 2.6. Use `routes.encodeEntryArguments` for an SDK program, or the raw compiler's
  `entryParams` ABI, honoring `indirect` tuple parameters.
- Parameters may be any combination of scalars, bytes, arrays and records, with at most 4 levels of nested
  arrays.
- On **SVM**, `Account` parameters are not encoded arguments: they are the accounts attached to the transaction,
  in declaration order.

**Scripts:** a file with top-level statements and no `main` runs as `main(): void`. Its top-level `const` and
`let` are locals of that entry, so a function cannot read them, and it cannot `return`. Declare `main` to share
a module-level constant with functions, or to return a value.

**Module constants and defines**

- A top-level `const` may hold literals, constant expressions, static objects/arrays, or contract
  bindings. Static members resolve while compiling; a branch whose condition is known compiles only
  its taken arm. A module lookup table is indexed by a known value, not a runtime index.
- A local object/array literal can keep known fields alongside runtime values. Runtime indexing and
  iteration need a plain-data array; an array of contract bindings keeps its interfaces and must be
  indexed with a known value. `undefined` may mark a missing static member, but has no runtime value.
- Helpers called with known deciding arguments may specialize; this also works when optimization is
  disabled. The same source must remain valid regardless of that option.
- A top-level `let` is scratch space, reset on every run. It is not persistent storage.
- A top-level `let` starts from a scalar literal, including a negative integer. Computed values,
  arrays, bytes and records belong inside functions; mutable module state resets every run.
- The compile option `defines` replaces a `const` of the same name.

**Program closures**

`program((fee) => { … }, feeValue)` compiles its inline arrow as a separate program and returns
`{ code, args }`. Run it read-only with `eval(parcel.code.concat(parcel.args))`, or pass the payload
to a consumer that executes programs. One argument follows per arrow parameter; an optional last
literal `{ chain: "...", target: "evm" | "svm" }` chooses its compilation target/profile.

Known captures fold into code. Runtime integers, addresses and bools, and statically shaped
scalar records/arrays, become explicit captured arguments. Runtime bytes and dynamic-size arrays
cannot be captured. Captured names/arrow parameters and values reachable through them are read-only,
including aliases and helper writes. Names/imports are resolved in the closure's lexical module;
this does not capture host JavaScript variables or allow arbitrary arrow-function values.

A host can also compile a single function-expression string with raw `entryKind: "closure"`:
its parameters/body become the entry without wrapping or executing JavaScript. This is distinct
from arbitrary first-class function values inside a `.sauce.ts` module.

```sauce chain=base,solana
function main(amount: Uint256): bytes {
  const parcel = program((fee: Uint256): Uint256 => amount + fee, 2);
  return eval(parcel.code.concat(parcel.args));
}
```

**Imports**

| Import                                                                  | Binds                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `import { f, FEE, Order } from "./lib.ts"` (also `.js`, `.mjs`, `.mts`) | exported functions, constants and interfaces                                                         |
| `import ERC20 from "./erc20.abi.json"`                                  | a contract ABI (§13)                                                                                 |
| `import cfg from "./config.json" with { type: "json" }`                 | JSON data, read as compile-time constants (`cfg.fee`)                                                |
| `import { approve } from "@sauce/token"`                                | a package. Import the package itself, not a file inside it ("subpath imports are not supported: …"). |

A default import of a SauceScript module is rejected: "a `.js` module import must be named — … has no `default`
export".

## 5. `require`, `revert`, `throw`, `log`, `eval`

Available on **Both** targets. These are statements, except `eval`, which returns a value. Their names are
reserved: you cannot declare a function named `require`, `revert`, `log` or `eval` ("`log` is a reserved
builtin and cannot be a function name").

- `require(cond)`, `require(cond, message)`
  - Types: `cond`: scalar. `message`: bytes.
  - Reverts unless `cond` is nonzero. "`require` takes 1 or 2 arguments (a condition and an optional
    bytes payload), got N"; "a `require` condition requires a scalar value". Used as a value:
    "`require` aborts execution and produces no value — use it as a statement".
  - Example: `require(out >= minOut, "slippage");`
- `revert()`, `revert(data)`
  - Types: `data`: bytes
  - Reverts with `data` as the revert data. "`revert` takes at most 1 argument (an optional bytes
    payload), got 2"; "a revert payload requires a bytes value"
  - Example: `revert(code.toBytesBe(32));`
- `throw data`
  - Types: `data`: bytes
  - The same as `revert(data)`. "a `throw` payload requires a bytes value".
  - Example: `throw "below floor";`
- `log(data)`, `log(data, topic1, …)`
  - Types: `data`: bytes. Up to 4 scalar topics, **EVM only**.
  - Emits a log record. On SVM pass `data` alone: "`log with topics` is not available on the svm
    target; … call log(data) alone and fold any event discriminator into data (concat or abi.encode
    it in front of the fields)". Other errors: "`log` requires a bytes data payload — `log()`
    records nothing"; "`log` carries at most 4 indexed topics after its data payload, got 5".
  - Example: `log(amount.toBytesLe(8));`
- `eval(program, ...args)`
  - Types: `program`: compiled Sauce program bytes. Up to 16 scalar `args`. Returns bytes.
  - Runs another program and returns what it returns; `args` become its `main` arguments. If the
    inner program reverts, so does the outer one. On SVM the inner program can read accounts but
    cannot write them. Errors: "`eval` requires bytecode to run — `eval()` has nothing to execute";
    "`eval` takes at most 16 arguments after its bytecode, got 17"; "an eval argument requires a
    scalar value".
  - Example: `const result = eval(program, amount);`

**Uncaught failure is atomic.** `require`, `revert`, `throw`, a failing call and every checked operation
revert the whole transaction unless caught. EVM supports an atomic `try` block or a single external
call's `.catch()` (§13); their rollback boundaries differ. SVM supports neither.

## 6. `ctx`: context reads

Every read is a call: `ctx.self()`, not `ctx.self` (which gives "`ctx` is not a declared variable").

- `ctx.msgSender()` → number, **Both**
  - On EVM: the immediate caller (`msg.sender`)
  - On SVM: the first signer among the accounts the engine receives: the Pot, when a slot is
    attached as the Pot. Not proof of who sent the transaction.
  - Example: `require(ctx.msgSender() == OWNER);`
- `ctx.self()` → number, **Both**
  - On EVM: the executing contract: the Pot, which holds the program's balances and allowances; a
    program compiled for a chain names it `pot`
  - On SVM: the engine's program id, which owns every Pot account: `pot.owner == ctx.self()`
    holds for a Pot, and for any other account assigned to the engine, so it does not prove an
    account is the Pot; re-deriving the Pot's address does
  - Example: `log(ctx.self().toBytesBe(32));`
- `ctx.chainId()` → number, **Both**
  - On EVM: the chain id
  - On SVM: 1399811149 on mainnet, 1399811150 on devnet and testnet
  - Example: `if (ctx.chainId() == 8453) { … }`
- `ctx.blockNumber()` → number, **Both**
  - On EVM: the block number
  - On SVM: the **slot**
  - Example: `const at = ctx.blockNumber();`
- `ctx.timestamp()` → number, **Both**
  - On EVM: the block time, in seconds
  - On SVM: the cluster time, in seconds
  - Example: `require(ctx.timestamp() <= deadline);`
- `ctx.selfBalance()` → number, **Both**
  - On EVM: the executing contract's balance, in wei
  - On SVM: the executing program's lamports
  - Example: `const wei = ctx.selfBalance();`
- `ctx.msgData()` → bytes, **Both**
  - On EVM: the program's whole input, arguments included
  - On SVM: the instruction data
  - Example: `const input = ctx.msgData();`
- `ctx.balance(address)` → number, **Both**
  - On EVM: the balance of `address`
  - On SVM: the lamports of the attached account with that key. Pass `acct.address`, not the account
    itself ("ctx.balance's address: expected a value, found an account"). A key that is not attached
    fails at run time.
  - Example: `ctx.balance(vault.address)`
- `ctx.msgValue()` → number, **EVM**
  - On EVM: the native value sent (`msg.value`)
  - On SVM: not available: "…; pass the amount as an argument and move the lamports with a
    system-program transfer through svm.call"
  - Example: `require(ctx.msgValue() >= fee);`
- `ctx.gasLeft()` → number, **EVM**
  - On EVM: the gas remaining
  - On SVM: not available
  - Example: `const gas = ctx.gasLeft();`
- `ctx.codeSize(address)` → number, **EVM**
  - On EVM: the size of `address`'s code
  - On SVM: not available
  - Example: `require(ctx.codeSize(token) > 0);`
- `ctx.codeHash(address)` → number, **EVM**
  - On EVM: the hash of `address`'s code
  - On SVM: not available
  - Example: `require(ctx.codeHash(pool) == POOL_CODEHASH);`
- `ctx.isContract(address)` → bool, **EVM**
  - On EVM: true if `address` has code
  - On SVM: not available; check `acct.owner` instead
  - Example: `require(ctx.isContract(token));`
- `ctx.isEOA(address)` → bool, **EVM**
  - On EVM: true if `address` has no code
  - On SVM: not available
  - Example: `require(ctx.isEOA(ctx.msgSender()));`
- `ctx.txOrigin()` → number, **EVM**
  - On EVM: the account that signed the transaction (`tx.origin`). It is not the program's caller
    whenever a contract stands between them, such as a smart wallet or a relayer. Authorize on
    `ctx.msgSender()`: a check of the origin passes for any contract the signer calls.
  - On SVM: not available
  - Example: `const signer = ctx.txOrigin();`
- `ctx.coinbase()` → number, **EVM**
  - On EVM: the block's fee recipient (`block.coinbase`)
  - On SVM: not available
  - Example: `const recipient = ctx.coinbase();`
- `ctx.prevrandao()` → number, **EVM**
  - On EVM: the block's randomness value (`block.prevrandao`). Whoever produces the block can bias
    it: do not decide anything they would profit from choosing with it.
  - On SVM: not available
  - Example: `const seed = ctx.prevrandao();`
- `ctx.blockGasLimit()` → number, **EVM**
  - On EVM: the block's gas limit (`block.gaslimit`), not the transaction's; `ctx.gasLeft()` is
    what the program has left
  - On SVM: not available
  - Example: `const limit = ctx.blockGasLimit();`
- `ctx.baseFee()` → number, **EVM**
  - On EVM: the block's base fee per gas, in wei (`block.basefee`)
  - On SVM: not available
  - Example: `require(ctx.baseFee() <= maxBaseFee);`
- `ctx.gasPrice()` → number, **EVM**
  - On EVM: the price per gas the transaction pays, in wei (`tx.gasprice`): the base fee plus the
    priority fee, not the fee cap
  - On SVM: not available
  - Example: `const price = ctx.gasPrice();`
- `ctx.blockHash(n)` → number, **EVM**
  - On EVM: the hash of block `n`, for the 256 blocks before the current one. It is 0 for the
    current block, a later one or an older one, and never reverts.
  - On SVM: not available
  - Example: `const previous = ctx.blockHash(ctx.blockNumber() - 1);`
- `ctx.blobHash(i)` → number, **EVM**
  - On EVM: the versioned hash of the transaction's blob `i`. It is 0 past the last blob, and for
    every index of a transaction that carries none.
  - On SVM: not available
  - Example: `const first = ctx.blobHash(0);`
- `ctx.blobBaseFee()` → number, **EVM**
  - On EVM: the block's base fee per unit of blob gas, in wei (`block.blobbasefee`). Not every
    chain has it: on Arbitrum and Polygon, a cook that reaches the read halts, using up its gas and
    returning no revert data. It still compiles for those chains, so read it only where the chain
    has it.
  - On SVM: not available
  - Example: `const blobFee = ctx.blobBaseFee();`

- A wrong argument count gives "`ctx.timestamp` takes 0 argument(s), but this call passes 1".
- An unknown name gives "`ctx.origin` is not a context builtin"; the origin is `ctx.txOrigin()`.
- A bare `gasLeft()` gives "… is called but never declared; write `ctx.gasLeft()` instead". A bare
  `blockHash(n)`, `blobHash(i)` or `blobBaseFee()` is pointed to its `ctx` spelling the same way,
  and so are `origin()` and `gasLimit()`, to `ctx.txOrigin()` and `ctx.blockGasLimit()`.

## 7. `crypto`

- `crypto.keccak256(data)`, **Both**
  - Types: `(bytes) → number`
  - The keccak-256 hash. A number argument gives "keccak256's argument requires a bytes value"; hash
    a word with `crypto.keccak256(x.toBytesBe(32))`.
  - Example: `const topic = crypto.keccak256("Transfer(address,address,uint256)");`
- `crypto.ecdsaVerify(hash, signature, signer)`, **Both**
  - Types: `(scalar, bytes, scalar) → bool`. `signature` is the 65-byte `r‖s‖v`.
  - True if `signer` signed `hash`. On EVM a contract signer is also checked (EIP-1271); on SVM only
    key signatures are checked. "ecdsaVerify's signature requires a bytes value"
  - Example: `require(crypto.ecdsaVerify(digest, sig, owner));`
- `const [address, bump] = crypto.findPDA(programId, seeds)`, **Both** (on EVM it derives the same
  Solana address)
  - Types: `programId`: number. `seeds`: `bytes[]`. Gives two numbers.
  - Derives a Solana program address and its bump. **It must be destructured:** "`crypto.findPDA`
    produces two values — bind them by destructuring, as
    `const [address, bump] = crypto.findPDA(programId, seeds)`". `[a]` and `[, bump]` are fine.
    Seeds must be a `bytes[]` ("`crypto.findPDA`'s seeds argument must be a `bytes[]`, got …"). **At
    most 15 seeds;** more compile but fail when run.
  - When the compiler knows the program id and every seed, it derives the address at compile time
    at **every optimization level**, including `optimize: false` / `--no-optimize`. This can
    increase SVM program size; it is not a promise of smaller bytecode.
  - Runtime PDA derivation has target-specific limits: EVM can fail to derive an address that SVM
    can derive from the same inputs. Known inputs derived at compile time need no runtime
    derivation. Successful compile-time evaluation does not predict gas or compute-unit use, or
    guarantee that evaluating the original expression at runtime would fit the target's resources.
  - Example: ``const [vault, bump] = crypto.findPDA(PROGRAM, [hex`01`, "vault"]);``

An unknown name gives "`crypto.sha256` is not a crypto intrinsic".

## 8. `Math`

These are SauceScript's integer functions, on **Both** targets. They are not JavaScript's `Math`: `Math.min`,
`max`, `abs`, `pow`, `floor` and the rest give "`Math.min` is not a Math intrinsic".

- `sqrt`, `mulDiv`, `addMod` and `mulMod` operate on unsigned integers and return `Uint256`.
  A negative `Int256` argument is rejected.
- `signExtend` returns `Int256`. Signed arithmetic and comparisons use ordinary operators on
  `Int256`; the old `Math.sDiv`, `sMod`, `sShr`, `sLt`, `sGt`, `sLte` and `sGte` are removed.

- `Math.sqrt(x)`: the integer square root
  - Reverts when: never
  - Example: `const root = Math.sqrt(k);`
- `Math.mulDiv(x, y, d)`: ⌊x·y / d⌋, without intermediate overflow
  - Reverts when: `d` is 0, or the result does not fit 256 bits
  - Example: `const fee = Math.mulDiv(amount, bps, 10000);`
- `Math.addMod(a, b, n)`: (a + b) mod n
  - Reverts when: `n` is 0
  - Example: `Math.addMod(a, b, P)`
- `Math.mulMod(a, b, n)`: (a · b) mod n
  - Reverts when: `n` is 0
  - Example: `Math.mulMod(a, b, P)`
- `Math.signExtend(value, byte)`: sign-extends from byte `byte`, where 0 is the lowest byte
  - Returns `Int256`; sign extension itself never reverts. Converting a negative result to
    `Uint256` is checked and reverts: `Uint256(Math.signExtend(0xff, 0))` cannot represent `-1`.
  - Example: `const tick = Math.signExtend(raw, 2);` for an int24

A wrong argument count gives "`Math.sqrt` takes 1 argument(s), but this call passes 2".

Migration diagnostic: "`Math.sLt` was removed; use `<` on `Int256` values". Each removed helper
similarly names its replacement.

## 9. `abi` (EVM)

On SVM both give "`abi.encode` is not available on the svm target" (or `abi.decode`). Program arguments still
work on SVM; they are decoded separately.

- `abi.encode(v1, …, vN)`
  - Types: 1 to 255 values of any type except accounts; returns bytes
  - Standard Solidity ABI encoding of the values as one argument list. A single record argument is
    encoded as its fields. "abi.encode requires at least one value to encode"; "abi.encode takes at most 255 arguments, got 256"
  - Deeply nested values can exceed execution limits; keep encoded structures shallow and simulate
    the largest supported input.
  - Example: `return abi.encode(total, recipient);`
- `abi.decode(data, ["Shape", …])`
  - Types: `data`: bytes. The shapes must be written in place as an array of strings. Returns a
    record with unnamed fields.
  - Read fields by position or by destructuring. Field types use SauceScript names: `"Uint256"`,
    `"Int256"`, `"Address"`, `"bool"`, `"bytes"`, `"string"`, `"number"`, `"bigint"`, `"boolean"`, any of them
    followed by `[]`, and records `"{Uint256, bool}"`. Solidity spellings are rejected: "`uint256`
    is not an abi.decode field type — …". Errors: "abi.decode takes exactly 2 arguments (data,
    shape), got N"; "abi.decode's first argument must be bytes"; shapes held in a variable give
    "abi.decode's second argument must be an array literal of shape strings, e.g. ["Uint256",
    "bytes[]"]"; `.name` on the result gives "this tuple's N field(s) are unnamed, so `.name`
    resolves against nothing — read a field by position instead (`t[0]`)".
  - Example: `const [amount, to] = abi.decode(data, ["Uint256", "Address"]);`

A `"bool"` field decodes as bool, an `"Address"` keeps the address-sized low 20 bytes,
and `"Int256"` decodes a signed word. Other single-value fields decode as unsigned numbers.

## 10. `evm` (EVM)

On SVM every function here gives "`evm.<name>` is not available on the svm target", with a pointer to the `svm`
equivalent.

- `evm.call(address, value, data, gas?)`: returns raw bytes
  - Sends native `value`; the only bound-call alternative that sends value.
  - Example: ``evm.call(WETH, amount, hex`d0e30db0`);``
  - Missing input: "`evm.call()` expects 3 argument(s), or 4 with a gas cap, but this call passes 2".
    Non-bytes input: "`evm.call()`'s calldata argument must be bytes".
- `evm.static(address, data, gas?)`: a read-only call (staticcall), returning bytes
  - Example: `const reply = evm.static(pool, query);`
- `evm.delegate(address, data, gas?)`: a delegatecall, returning bytes
  - Example: `evm.delegate(library, data);`
- Optional `gas` is the amount forwarded, not the transaction limit; omitted forwards what the EVM
  allows. Zero forwards no gas. A bound call uses `.gas(n)`; `.gas(n)` and `.catch(...)` compose
  in either order with the same behavior.
- Unread answers are not copied. A read bound output still requires its whole declared decode.
  Raw `evm.call`, `evm.static` and `evm.delegate` bytes can avoid copying an unread tail: a
  fixed-size `abi.decode` shape, a comparison of `.length` with a constant, or `.slice(0, n)`
  with a known `n` can read only what that operation needs. This is not partial decoding of
  bound ABI results. A caught error copies at most 256 bytes only if its handler reads it.
- `evm.sload(slot)`: `(scalar) → number`
  - Reads the executing contract's storage
  - Example: `const count = evm.sload(0);`
- `evm.sstore(slot, value)`: `(scalar, scalar)`, a statement
  - Writes storage. Used as a value: "`evm.sstore` writes storage and produces no value — use it as
    a statement".
  - Example: `evm.sstore(0, count + 1);`
- `evm.tload(key)`: `(scalar) → number`
  - Reads transient storage (EIP-1153), which is cleared after the transaction
  - Example: `const seen = evm.tload(KEY);`
- `evm.tstore(key, value)`: `(scalar, scalar)`, a statement
  - Writes transient storage
  - Example: `evm.tstore(KEY, 1);`

- Storage belongs to the executing contract, the Pot.
- `evm.create(initcode, value?)`, `evm.create2(initcode, salt, value?)`, and
  `evm.create3(initcode, salt, value?)` deploy from the Pot and return the address. Init code is
  creation bytecode, not the deployed code, and must be bytes: "evm.create's init code requires a
  bytes value". An omitted `value` sends none, and the Pot pays any `value` given. CREATE/CREATE2
  return zero on failure; CREATE3 reverts.
- Three builtins predict where those land, each returning an address:
  - `evm.createAddress(deployer, nonce)`: where `evm.create` from `deployer` at `nonce` lands.
  - `evm.create2Address(deployer, salt, initCodeHash)`: where `evm.create2` from `deployer` lands;
    `initCodeHash` is `crypto.keccak256(initcode)`.
  - `evm.create3Address(salt)`: where `evm.create3` run by the Pot lands. It takes no deployer,
    because the deployer is always the Pot running the program: the address depends on the Pot and
    the salt, not on the init code.
- All six are EVM-only. A program that deploys and checks the address:

```sauce chain=base
function main(initcode: bytes, salt: Uint256): Address {
  const expected = evm.create2Address(ctx.self(), salt, crypto.keccak256(initcode));
  const deployed = evm.create2(initcode, salt);
  require(deployed == expected, "create2");
  require(evm.create3Address(salt + 1) != expected, "create3");
  return deployed;
}
```

## 11. `svm` (SVM)

On EVM every function here gives "`svm.<name>` is not available on the evm target", with a pointer to the
`evm` equivalent.

- `svm.sload(account, offset, length)`: `(Account, scalar, scalar) → bytes`
  - Reads `length` bytes of the account's data, starting at `offset`. Reading past the end fails the
    transaction, and that failure cannot be caught, so check `acct.dataLen` first. A number instead
    of an account gives "svm.sload's account: expected an account, found a value".
  - Example: `const amount = svm.sload(tokenAccount, 64, 8).toLe();`
- `svm.sstore(account, offset, data)`: `(Account, scalar, bytes)`, a statement
  - Writes `data` into the account's data at `offset`. A `main` account parameter must be declared
    `Account<Writable, Signer>`: "`state` is not declared writable, so `svm.sstore` may not write it
    — declare it `Account<Writable>` (or `Account<Writable, Signer>`)", then "`state` is not
    declared a signer, so `svm.sstore` may not write it — … declare it `Account<Writable, Signer>`".
    The data must be bytes ("svm.sstore's value requires a bytes value").
  - Example: `svm.sstore(state, 0, counter.toBytesLe(8));`
- `svm.call(program, accounts, data)`: `(Account, Account[], bytes) → bytes`
  - Invokes another program with the listed accounts and returns the return data. The program is an
    account parameter too ("svm.call's program — declare the callee as an `Account` param: …"). The
    list must hold accounts, not numbers ("`svm.call`'s accounts argument must be an array of
    accounts, e.g. `[a, b]` of `Account` params"). `[]` is fine. **A failed call fails the whole
    transaction.**
  - Example: `svm.call(tokenProgram, [source, destination, owner], instruction);`
- `svm.remainingAccount(i)`: `(number) → Account`
  - The `i`-th account attached after the ones `main` declares. Available inside any function.
    "`svm.remainingAccount` takes one index, got N"
  - Example: `const extra = svm.remainingAccount(0);`
- `const rest = svm.remainingAccounts()`: `() → Account[]`
  - Every account attached after the declared ones. Available inside any function, **only as a
    `let`/`const` initializer:** "svm.remainingAccounts() can only initialize a let/const — bind it first (const rest = svm.remainingAccounts();), then use the binding".
    Reverts if the transaction supplies fewer accounts than `main` declares.
  - Example: `const rest = svm.remainingAccounts(); svm.call(router, rest, data);`

A reachable use of either remaining-account builtin adds a remaining-accounts tail to the SVM
manifest, including when the use is inside a called helper. An unused helper alone does not.

An unknown name gives "`svm.rent` is not an svm builtin; `svm` is a reserved namespace root".

## 12. Methods on values, and account properties

### Methods (Both targets)

- `.slice(start, end)`, on bytes
  - Types: `(scalar, scalar) → bytes`
  - Covers bytes `start` up to, but not including, `end`. `end < start` reverts. Arrays have no
    `.slice`: "a bytes method's receiver requires a bytes value". "`.slice` takes exactly 2
    arguments (start, end), got N"
  - Example: `const args = input.slice(4, 68);`
- `.concat(b1, b2, …)`, on bytes
  - Types: `(...bytes) → bytes`
  - Joins bytes values. "a `.concat` argument requires a bytes value"
  - Example: `const call = selector.concat(to.toBytesBe(32), amount.toBytesBe(32));`
- `.toBe()`, on bytes, at most 32
  - Types: `() → number`
  - Reads the bytes as a big-endian number. Longer input fails when run.
  - Example: `const word = input.slice(4, 36).toBe();`
- `.toLe()`, on bytes, at most 32
  - Types: `() → number`
  - Reads the bytes as a little-endian number (Solana's layout)
  - Example: `const amount = input.slice(64, 72).toLe();`
- `.toBytesBe(width)`, on a scalar
  - Types: `(scalar) → bytes`
  - The low `width` bytes, big-endian, with `width` from 1 to 32. A constant outside that range
    gives "a `.toBytesBe`/`.toBytesLe` width must be between 1 and 32 bytes, got 33". A computed
    width above 32 reverts, and a computed 0 gives empty bytes.
  - Example: `log(total.toBytesBe(32));`
- `.toBytesLe(width)`, on a scalar
  - Types: `(scalar) → bytes`
  - The same, little-endian
  - Example: `const field = amount.toBytesLe(8);`
- `.length`, on bytes or an array
  - Types: number
  - The byte count or the element count. On a record, `.length` looks for a field named `length`
    ("`length` is not a field of this tuple — …"). It cannot be assigned.
  - Example: `for (let i = 0; i < amounts.length; i++) { … }`

Bytes methods work on variables, expressions and bytes literals; for example, ``hex`a9`.concat(d)``
is supported. Bind an intermediate value when it improves readability.

### Account properties

- `acct.address` → number, **Both**
  - On SVM: the account's public key
  - On EVM: the address itself
  - Example: `require(acct.address == EXPECTED_MINT);`
- `acct.owner` → number, **SVM**
  - On SVM: the program that owns the account
  - On EVM: not available: "`account.owner` is not available on the evm target; an address on the
    EVM is the code — check it with ctx.isContract"
  - Example: `require(acct.owner == TOKEN_PROGRAM);`
- `acct.dataLen` → number, **SVM**
  - On SVM: the account's data size, in bytes
  - On EVM: not available
  - Example: `require(acct.dataLen == 165);`

- These properties are read-only: "`.owner` is read-only — …".
- On SVM, compare accounts with `a == b` or `a != b`; ordering comparisons are rejected.
- On SVM an account is not an ordinary value. Returning one gives "a return value can't be an account — …", and
  using one where a number is expected, as in arithmetic, gives "…: expected a number, found an account". Use
  `acct.address` when you need its key.

## 13. Contract bindings and `.catch()` (EVM)

**Bind an ABI** with `import ERC20 from "./erc20.abi.json"`, or with the compile option
`inlineContracts: [["ERC20", abiJson]]`. Then call through it:

- `ERC20.at(address).method(args)`: read-only for `view` and `pure` methods; otherwise a regular
  call sending no value
  - Example: `const balance = ERC20.at(token).balanceOf(ctx.self());`
- `ERC20.view(address).method(args)`: always read-only
  - Example: `const supply = ERC20.view(token).totalSupply();`
- `ERC20.lib(address).method(args)`: always a delegatecall
  - Example: `Library.lib(lib).run(x);`
- `const t = ERC20.at(address); t.method(args)`: the same, through a variable
  - Example: `const t = ERC20.at(token); t.approve(router, amount);`

- **Results.**
  - A method with no outputs returns its raw return bytes.
  - A method with one output returns that output.
  - A method with several outputs returns a record named after the ABI's outputs: read `.amountOut` or `[0]`,
    or destructure it with `const [a, b] = …`.
- **Integer outputs keep signedness.** An ABI `intN` output becomes `Int256`; `uintN`, `address`
  and the ABI's low-level `bool` word remain unsigned numbers. Read integer outputs are range-checked
  recursively against their declared widths, not masked. Scalar input conversions also check widths;
  signed/unsigned array and tuple elements must already have matching kinds.
  Use signed values for signed ABI inputs: pass `-1` to `int256`, not the unsigned word `~0`.
  A `Uint256[]` cannot stand in for `intN[]`, nor an `Int256[]` for `uintN[]`; tuple fields
  follow the same rule. Use checked scalar conversions, or `.fromBits` for an intentional bit
  reinterpretation, when constructing a container of the required kind.
- **Unread results skip all decoding and output checks**, even when assigned to an unused variable,
  at every optimization level. Empty, short or malformed successful replies then pass; a call to an
  address with no code can succeed. Check `ctx.isContract(address)` where code must exist.
  Reading any part retains the **whole** declared decode, including siblings and nested fields.
  Destructuring counts as a read even when its names are unused; explicit `abi.decode` still decodes.
- **Struct arguments** can be object literals with fields in any order; ABI names match the fields.
- **No value.** A bound call never sends value; use `evm.call` (§10).
- **Token transfers.** Prefer `@sauce/token`, or the SDK's `USDC.transfer` and `Token(address)`
  syntax: these enforce SafeERC20's empty-or-true result rule. Ignoring a raw bound `transfer` result
  does not check a returned `false`, even though it now tolerates a USDT-style empty reply.
- **Errors.**
  - "`ERC20` has no method named `totalSupply`".
  - "`ERC20.transfer()` expects 2 argument(s), but this call passes 1".
  - "`.at()` (a contract binding) takes exactly 1 argument (the address)".
  - Overloaded methods with the same argument count are not supported.
  - A function whose ABI has a fixed-size array of 256 or more elements, as a parameter or an
    output, cannot be called: "the ABI type `uint256[256]` is a fixed-size array of more than 255
    elements, which SauceScript cannot encode or decode". An ABI may still declare one; only the
    call is refused.
  - On SVM: "`Contract.at` is not available on the svm target; invoke another program with svm.call(program,
    accounts, calldata), or import a library's SVM arm (@sauce/token)".

### `.catch()`: surviving a failed external call (EVM)

- `<call>.catch(() => { … });`
  - If the call fails, its effects are undone and the block runs instead. The block may use and
    assign the enclosing function's variables. Works on bound contract calls and on `evm.call`,
    `evm.static` and `evm.delegate`.
  - Example: `ERC20.at(t).approve(spender, amount).catch(() => { approved = false; });`
- `const v = <call>.catch(() => { return <constant>; });`
  - If the call fails, `v` is the constant. The call must return one value: a bound method with
    one output. A raw `evm.call`, `evm.static` or `evm.delegate` returns bytes, which no constant
    stands in for ("a `.catch()` fallback: expected a bytes value, found a number"); test a raw
    read with the statement form, then read again only when it worked.
  - Example: `const balance = ERC20.at(t).balanceOf(who).catch(() => { return 0; });`
- A call to an address with no code succeeds with empty data. An unread result skips decoding;
  a read result's decoding may revert **outside** the single-call catch. Check `ctx.isContract`
  first when the target must have code.

Rules and errors:

- `catch (e)` or `.catch((e) => { … })` binds raw revert bytes, capped at 256 bytes. No annotation.
  An unused error binding copies nothing. Check its length/shape before decoding: callee data is
  untrusted and may be truncated, and a failure in the handler is not caught by that same handler.
- Statement handlers take at most one plain parameter: "a `.catch()` handler with more than one parameter (it takes the revert data)".
  Captured-result handlers take no parameter and keep the constant-only fallback rule.
- Use a `{ … }` block, not `() => value`. Other arrows are allowed only in `program(...)`.
- A `return`, or a `break`/`continue` leaving the block, is not allowed in the statement form ("a `return` in a
  `.catch()` handler …").
- The value form needs exactly `return <constant>;`:
  - "a captured `.catch()` requires exactly `return <constant scalar>;` in its handler";
  - "the `.catch()` fallback must be a constant scalar that fits the declared ABI result width".
- An oversized handler fails compilation with `CatchHandlerTooLarge`; keep the handler short and
  move substantial recovery work into a helper.
- On anything other than an external EVM call, the compiler rejects it ("a `.catch()` on something other than an
  external contract call …"). On SVM: "`.catch()` is not available on the svm target".

### `try { … } catch (error) { … }`: an atomic block (EVM)

```sauce chain=base
function main(recipient: Address, amount: Uint256, floor: Uint256): void {
  try {
    USDC.transfer(recipient, amount);
    require(pot.USDC >= floor, "keep the reserve");
  } catch (error) {
    // A failed reserve check undoes the transfer too; nothing in this try was committed.
    log(error);
  }
}
```

- A multi-statement block is atomic as the same Pot: failure undoes its calls, storage writes,
  array/record mutations and assignments together. Earlier work outside remains. Success makes its
  changes visible afterwards, including through aliases. Unlike JavaScript, assignments before a
  throw are rolled back, so the handler sees their old values.
- A `try` containing only one external call is that call's `.catch()` form. It catches the call's
  failure, not argument evaluation or successful-return decoding. To catch a decode or checked
  expression, put it inside a multi-statement block.
- `catch { … }` discards the error; `catch (error)` receives at most the first 256 raw revert bytes.
  Empty data cannot distinguish a bare revert from many arithmetic guards. A handler's own failure
  propagates unless an enclosing catch handles it. There is no `finally`.
- `return`, `break` and `continue` may leave a `try` or handler. An oversized handler is a compile
  error (`CatchHandlerTooLarge`); move substantial handling into a helper.
- SVM rejects both forms. Multi-statement blocks require execution as an account (normally a Pot
  cook), not a bare call to the engine. Read-only `eval` stays read-only; a caught attempt to write
  there may consume nearly all gas available to the block.

Only decode a handler's data after checking its shape. For example, this handler inspects a selector
without assuming the payload is a Solidity string or a complete custom error:

```sauce chain=base
function main(target: Address, query: bytes): Uint256 {
  require(ctx.isContract(target), "no contract");
  let selector = 0;
  try {
    evm.static(target, query);
  } catch (error) {
    if (error.length >= 4) {
      selector = error.slice(0, 4).toBe();
    }
  }
  return selector;
}
```

## 14. Not supported, and what to write instead

| Not supported                                                     | Write instead                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `switch`                                                          | `if` / `else if` chains                                                                                           |
| `do { } while (…)`                                                | `while (true) { …; if (!cond) { break; } }`                                                                       |
| `for (k in obj)`, `for await`                                     | an index loop or `for (const x of array)`                                                                         |
| `finally`, `throw new Error(…)`                                   | `try`/`catch` on EVM; `require(cond, "reason")` or `throw "reason"` on either target                              |
| arbitrary arrow functions, function expressions, nested functions | top-level declarations; arrows only in `.catch(...)` and `program(...)`                                           |
| `class`, `enum`, `type` aliases, generics, `namespace`            | records, `interface`, constants                                                                                   |
| `async function`, `await`                                         | plain functions. **`async function` and `function*` compile today, but as ordinary functions: don't write them.** |
| default parameters, rest parameters, destructuring parameters     | plain parameters                                                                                                  |
| object destructuring `const { a } = t`                            | `const a = t.a;`                                                                                                  |
| spread `[...xs]`, `f(...xs)`                                      | explicit elements, or a loop                                                                                      |
| `?.`, `??`, `x!`, `as`, `satisfies`                               | explicit checks; annotations                                                                                      |
| `>>>`, `typeof`, `instanceof`, `in`, `delete`, `void`, unary `+`  | `>>` on `Uint256` for zero-fill, `>>` on `Int256` for sign-fill, or plain values                                  |
| `>>>=`, `\|\|=`, `&&=`, `??=`                                     | `x = …`                                                                                                           |
| `a[i] += v`, `t.f += v`, `a[i]++`                                 | `a[i] = a[i] + v`                                                                                                 |
| `i++` used as a value                                             | `i += 1` on its own line                                                                                          |
| `t[0] = v` on a record                                            | `t.field = v`                                                                                                     |
| template strings                                                  | `"text"`, or bytes built with `.concat`                                                                           |
| `1e18`, `1.5`, `null`                                             | plain integers, smallest units, `0` or a flag                                                                     |
| `xs.push(v)`, `console.log`, any JavaScript library               | `new Array(n)` with an index; `log(…)`                                                                            |
| `Math.min`, `max`, `abs`, `pow`                                   | `if` or a ternary; `**`                                                                                           |
| comparing bytes with `==`                                         | compare `crypto.keccak256` of each                                                                                |
| `export default`, `export { … }`, `import * as X`                 | `export function` / `export const`; named imports                                                                 |
| sending value through a bound call                                | `evm.call(address, value, data)`                                                                                  |
| labeled statements, labeled `break`/`continue`                    | a flag variable                                                                                                   |
| computed object keys, object methods                              | plain named fields                                                                                                |

The compiler rejects each of these. Most messages read "… is not supported", naming the construct.

## 15. Limits

| Limit                                                                 | Value                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Large helper parameter/local combinations                             | Compiler-dependent; simplify the helper (§4)                           |
| `log` topics                                                          | 4 on EVM; none on SVM                                                  |
| `eval` arguments                                                      | 16                                                                     |
| `abi.encode` values, record fields encoded, `abi.decode` fields       | 255                                                                    |
| Elements in a fixed-size array (`T[N]`) of a function a program calls | 255                                                                    |
| Elements in an array literal                                          | 65,535                                                                 |
| Bytes in a string or `hex` literal                                    | 65,535                                                                 |
| `.catch()` / `catch` handler                                          | `CatchHandlerTooLarge` if oversized; keep it short or extract a helper |
| `crypto.findPDA` seeds                                                | 15 (checked when run)                                                  |
| Nested arrays in a `main` parameter                                   | 4 levels                                                               |
| One caller-supplied collection in `main`'s arguments                  | 16 KiB                                                                 |
| Working memory on SVM                                                 | 64 KiB per run                                                         |
| One Solana transaction: the program, its arguments and the cook       | 1,232 bytes; `sauce run` stages a larger program                       |

## Next

- [Write your first program](../guides/write-your-first-program.md): the language, by example.
- [SauceScript](../concepts/saucescript.md): why the language is shaped this way.
- [Glossary](../concepts/glossary.md): the words these pages use, in plain terms.
