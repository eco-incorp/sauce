# SauceScript reference

SauceScript is the checked subset of TypeScript that Sauce programs are written in. You compile a program for
one of two targets:

- **EVM** (`target: "evm"`): Ethereum and other EVM chains.
- **SVM** (`target: "svm"`): Solana.

Every entry below says where it works: **Both**, **EVM** or **SVM**. Using something on the wrong target is a
compile error, never a silent difference.

Every example compiles on each target it names, and every error message is quoted as the compiler prints it,
with `N` for a number and `…` where text is elided. The machine-readable list of every documented builtin, with one
example program each, is `builtins.json`.

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
  `ctx.msgValue`, `gasLeft`, `codeSize`, `codeHash`, `isContract` and `isEOA` do not exist.
- `log` takes no topics (§5).
- `abi`, `evm` and contract bindings with `.catch()` (§9, §10, §13) are EVM only: a call to another
  program is `svm.call`.
- Limits (§15): 64 KiB of working memory, and the program, its arguments and the cook together in
  one 1,232-byte transaction unless the program is staged.

---

## 1. Types

- `Uint256`, `Address`, `number`, `bigint`: A **number**: one unsigned 256-bit integer. An address
  is a number.
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
- An unknown type name is rejected with a list of the valid ones, as in "`uint256` is not a type — write
  `Uint256`, `Address`, `Account`, `bool`, `bytes` or `string`, an array `T[]`, an inline object type `{ a: Uint256 }`
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
| `null`, `undefined`         | rejected                                                                                                      | `0` or a flag                           |
| `` `text` ``, `` `a${b}` `` | rejected, with or without `${}`                                                                               | `"text"`, or bytes built with `.concat` |
| a bad `hex`                 | "`hex`…`` is not a valid hex literal (expected an even number of `[0-9a-fA-F]` digits, optional `0x` prefix)" |                                         |
| `[]` with no declared type  | "an array literal must have at least one element"                                                             | `let xs: Uint256[] = [];`               |
| `[1, true]`                 | "every element of an array literal must have the same type — …"                                               |                                         |

## 3. Operators

- `+ - * / % **`, on numbers → number
  - **Checked.** Overflow, underflow and division by zero revert. With constant operands they are
    compile errors: "constant `-` expression overflows 256 bits", "constant `/` expression divides
    by zero".
- `-x`, on a number → number
  - Two's-complement negation; it never fails. **Use `-x` for a negative amount.** `~x + 1` reverts
    when `x` is `0`, because the `+` is checked. `-1` is 2²⁵⁶ − 1.
- `~x`, on a number → number
  - bitwise NOT. `~0` is the maximum value.
- `& | ^ << >>`, on numbers → number
  - Bitwise. `>>` fills with zeros; use `Math.sShr` for a signed shift.
- `< <= > >=`, on scalars → bool
  - unsigned; use `Math.sLt` and friends for signed
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
- Every path must return ("`f` does not return on every path"). A bare `return;` is allowed only in a `: void`
  function.
- A `: void` function's result is not a value: "a call to a `: void` function produces no value, so its result
  can't be used as one — call it as a statement instead".
- `main` is the entry point and cannot be called from your code.
- A function other than `main` has a fixed budget for its parameters and the values its body keeps live at
  once: about sixteen. Seventeen parameters still compile when the body reads each one once. Past the
  budget — sixteen parameters with a local held beside them, or seventeen with the first one read again — the
  compile fails with "f keeps too many values in use at once — …". Pass a record or an array instead of a long list of numbers. `main`'s
  parameters are the program's arguments and are not limited this way.
- **Arrays and records are passed by reference.** A helper that writes `xs[i] = v` or `r.amount = v` changes
  the caller's array or record, so a helper can fill an array it is given. Numbers, bools and bytes are passed
  by value. A helper cannot replace an array parameter with a new array: "`<name>` cannot be reassigned a value
  of a different type — expected an element count known only at run time, found N element(s)".

**`main`'s arguments**

- `main`'s parameters are the program's runtime inputs. One compiled program serves every argument value.
- By default the arguments are ABI-encoded. With the compile option `compactArgs: true` they use the smaller
  compact encoding; encode them with `encodeCompactArguments` and the schema the compile returns.
- Parameters may be any combination of scalars, bytes, arrays and records, with at most 4 levels of nested
  arrays.
- On **SVM**, `Account` parameters are not encoded arguments: they are the accounts attached to the transaction,
  in declaration order.

**Scripts:** a file with top-level statements and no `main` runs as `main(): void`. Its top-level `const` and
`let` are locals of that entry, so a function cannot read them, and it cannot `return`. Declare `main` to share
a module-level constant with functions, or to return a value.

**Module constants and defines**

- A top-level `const` must be a literal or a constant expression over other `const`s.
- A top-level `const` array, `const FEES = [100, 500];`, is a lookup table: it is read only at a literal index,
  `FEES[0]`. A loop over it, `.length` or a write gives "a module-scope lookup table `<name>` can only be read
  by a literal index or a field name …", and a computed index "a module-scope lookup table can only be indexed by
  a non-negative integer literal or a `const` bound to one …". Declare an array you loop over or index at run
  time inside a function.
- A top-level `let` is scratch space, reset on every run. It is not persistent storage.
- A top-level `let` starts as a number, address or boolean literal, nothing else: "a module-scope `let <name>`
  must be initialized with a literal — a number, address or boolean literal. …". An array, bytes, a record, a
  negative number, an expression or a call goes inside a function.
- The compile option `defines` replaces a `const` of the same name.

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

**Failure is atomic.** `require`, `revert`, `throw`, a failing call and every checked operation revert the whole
transaction; nothing that ran before them survives. The only failure a program can survive is a failed
external call on EVM, with `.catch()` (§13).

## 6. `ctx`: context reads

Every read is a call: `ctx.self()`, not `ctx.self` (which gives "`ctx` is not a declared variable").

- `ctx.msgSender()` → number, **Both**
  - On EVM: the immediate caller (`msg.sender`)
  - On SVM: the first signer among the accounts the engine receives: the Pot, when a slot is
    attached as the Pot. Not proof of who sent the transaction.
  - Example: `require(ctx.msgSender() == OWNER);`
- `ctx.self()` → number, **Both**
  - On EVM: the executing contract: the Pot, which holds the program's balances and allowances
  - On SVM: the engine's program id, which owns every Pot account: `pot.owner == ctx.self()`
    holds for a Pot, and for any other account assigned to the engine, so it does not prove an
    account is the Pot; re-deriving the Pot's address does
  - Example: `log(ctx.self().toBytesBe(32));`
- `ctx.chainId()` → number, **Both**
  - On EVM: the chain id
  - On SVM: 1399811149 on mainnet, 1399811150 on devnet
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

- A wrong argument count gives "`ctx.timestamp` takes 0 argument(s), but this call passes 1".
- An unknown name gives "`ctx.origin` is not a context builtin".
- A bare `gasLeft()` gives "… is called but never declared; write `ctx.gasLeft()` instead".
- There is no read for the transaction origin, the block hash, the base fee or the gas price. Pass such a value
  in as a `main` argument.

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
  - Example: ``const [vault, bump] = crypto.findPDA(PROGRAM, [hex`01`, "vault"]);``

An unknown name gives "`crypto.sha256` is not a crypto intrinsic".

## 8. `Math`

These are SauceScript's integer functions, on **Both** targets. They are not JavaScript's `Math`: `Math.min`,
`max`, `abs`, `pow`, `floor` and the rest give "`Math.min` is not a Math intrinsic".

- Every argument is a scalar.
- Every result is a **number**, including the signed comparisons. `if (Math.sLt(a, b)) { … }` works, but
  returning one from a `: bool` function fails with "a return value: expected a bool, found a number".

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
- `Math.sDiv(a, b)`: signed division
  - Reverts when: `b` is 0
  - Example: `Math.sDiv(delta, 2)`
- `Math.sMod(a, b)`: signed remainder
  - Reverts when: `b` is 0
  - Example: `Math.sMod(delta, 3)`
- `Math.sShr(value, bits)`: signed (arithmetic) right shift
  - Reverts when: never
  - Example: `Math.sShr(tick, 1)`
- `Math.signExtend(value, byte)`: sign-extends from byte `byte`, where 0 is the lowest byte
  - Reverts when: never
  - Example: `Math.signExtend(raw, 2)` for an int24
- `Math.sLt(a, b)`, `Math.sGt(a, b)`, `Math.sLte(a, b)`, `Math.sGte(a, b)`: signed comparisons,
  giving 1 or 0
  - Reverts when: never
  - Example: `if (Math.sLt(tick, 0)) { … }`

A wrong argument count gives "`Math.sqrt` takes 1 argument(s), but this call passes 2".

## 9. `abi` (EVM)

On SVM both give "`abi.encode` is not available on the svm target" (or `abi.decode`). Program arguments still
work on SVM; they are decoded separately.

- `abi.encode(v1, …, vN)`
  - Types: 1 to 255 values of any type except accounts; returns bytes
  - Standard Solidity ABI encoding of the values as one argument list. A single record argument is
    encoded as its fields. "abi.encode requires at least one value to encode"; "abi.encode takes at most 255 arguments, got 256"
  - Example: `return abi.encode(total, recipient);`
- `abi.decode(data, ["Shape", …])`
  - Types: `data`: bytes. The shapes must be written in place as an array of strings. Returns a
    record with unnamed fields.
  - Read fields by position or by destructuring. Field types use SauceScript names: `"Uint256"`,
    `"Address"`, `"bool"`, `"bytes"`, `"string"`, `"number"`, `"bigint"`, `"boolean"`, any of them
    followed by `[]`, and records `"{Uint256, bool}"`. Solidity spellings are rejected: "`uint256`
    is not an abi.decode field type — …". Errors: "abi.decode takes exactly 2 arguments (data,
    shape), got N"; "abi.decode's first argument must be bytes"; shapes held in a variable give
    "abi.decode's second argument must be an array literal of shape strings, e.g. ["Uint256",
    "bytes[]"]"; `.name` on the result gives "this tuple's N field(s) are unnamed, so `.name`
    resolves against nothing — read a field by position instead (`t[0]`)".
  - Example: `const [amount, to] = abi.decode(data, ["Uint256", "Address"]);`

A `"bool"` field decodes as a bool, an `"Address"` field keeps only the address-sized low 20 bytes, and every
other single-value field decodes as a number.

## 10. `evm` (EVM)

On SVM every function here gives "`evm.<name>` is not available on the svm target", with a pointer to the `svm`
equivalent.

- `evm.call(address, value, data)`: `(scalar, scalar, bytes) → bytes`
  - A call with native `value`; returns the raw return data. **This is the only way to send value
    with a call.** "`evm.call()` expects 3 argument(s), but this call passes 2"; "`evm.call()`'s
    calldata argument must be bytes"
  - Example: ``evm.call(WETH, amount, hex`d0e30db0`);``
- `evm.static(address, data)`: `(scalar, bytes) → bytes`
  - A read-only call (staticcall)
  - Example: `const reply = evm.static(pool, query);`
- `evm.delegate(address, data)`: `(scalar, bytes) → bytes`
  - A delegatecall
  - Example: `evm.delegate(library, data);`
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
  `evm.create3(initcode, salt, value?)` deploy from the Pot and return the address. Init code must
  be bytes: "evm.create's init code requires a bytes value". CREATE/CREATE2 return zero on failure;
  CREATE3 reverts. These are EVM-only.

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
  - The `i`-th account attached after the ones `main` declares. **Only inside `main`.**
    "`svm.remainingAccount` takes one index, got N"
  - Example: `const extra = svm.remainingAccount(0);`
- `const rest = svm.remainingAccounts()`: `() → Account[]`
  - Every account attached after the declared ones. **Only as a `let`/`const` initializer, and only
    inside `main`:** "svm.remainingAccounts() can only initialize a let/const — bind it first (const rest = svm.remainingAccounts();), then use the binding".
  - Example: `const rest = svm.remainingAccounts(); svm.call(router, rest, data);`

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

**Call methods on a variable, not on a literal.** ``hex`a9`.concat(d)`` and `"ab".concat(d)` are rejected
("calling anything other than a plain function name …"). Write ``const selector = hex`a9059cbb`; selector.concat(d)``.

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
- **Every single-value output is typed as a number, `bool` and `address` included.** Write
  `ERC20.at(t).transfer(to, x) == 1` if you need a bool. A `: bool` function cannot return the call directly
  ("a return value: expected a bool, found a number").
- **Struct arguments** can be object literals with the fields in any order; they are matched to the ABI by name.
- **No value.** A bound call never sends value. Use `evm.call(address, value, data)` (§10) when you need to.
- **Token transfers.** For ERC-20 `transfer` and `approve`, prefer `@sauce/token` (`import { transfer, approve }
from "@sauce/token"`), which handles tokens that return nothing, such as USDT. A bound call decodes exactly
  what the ABI declares.
- **Errors.**
  - "`ERC20` has no method named `totalSupply`".
  - "`ERC20.transfer()` expects 2 argument(s), but this call passes 1".
  - "`.at()` (a contract binding) takes exactly 1 argument (the address)".
  - Overloaded methods with the same argument count are not supported.
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
- A call to an address with no code does not revert: it succeeds with no return data, so
  `.catch()` never runs, and decoding that nothing reverts the cook. Check
  `ctx.codeSize(address) > 0` first when the address may have no code.

Rules and errors:

- The block takes no parameter: "a `.catch()` handler parameter (the caught error is not supported)".
- Use a `{ … }` block, not `() => value`. Arrow functions are allowed nowhere else in the language
  (an intent opened from a program for a chain is not one: see the end of section 14).
- A `return`, or a `break`/`continue` leaving the block, is not allowed in the statement form ("a `return` in a
  `.catch()` handler …").
- The value form needs exactly `return <constant>;`:
  - "a captured `.catch()` requires exactly `return <constant scalar>;` in its handler";
  - "the `.catch()` fallback must be a constant scalar that fits the declared ABI result width".
- A long block can be too large ("a .catch() handler compiles to N bytes, over the 255-byte limit — shorten the handler"). Move the work into a
  function and call it.
- On anything other than an external EVM call, the compiler rejects it ("a `.catch()` on something other than an
  external contract call …"). On SVM: "`.catch()` is not available on the svm target".

## 14. Not supported, and what to write instead

| Not supported                                                    | Write instead                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `switch`                                                         | `if` / `else if` chains                                                                                           |
| `do { } while (…)`                                               | `while (true) { …; if (!cond) { break; } }`                                                                       |
| `for (k in obj)`, `for await`                                    | an index loop or `for (const x of array)`                                                                         |
| `try { } catch { }`, `throw new Error(…)`                        | `require(cond, "reason")`, `throw "reason"`; `.catch()` for a failing EVM call                                    |
| arrow functions, function expressions, nested functions          | top-level `function` declarations (`.catch(() => { … })` is the one exception)                                    |
| `class`, `enum`, `type` aliases, generics, `namespace`           | records, `interface`, constants                                                                                   |
| `async function`, `await`                                        | plain functions. **`async function` and `function*` compile today, but as ordinary functions: don't write them.** |
| default parameters, rest parameters, destructuring parameters    | plain parameters                                                                                                  |
| object destructuring `const { a } = t`                           | `const a = t.a;`                                                                                                  |
| spread `[...xs]`, `f(...xs)`                                     | explicit elements, or a loop                                                                                      |
| `?.`, `??`, `x!`, `as`, `satisfies`                              | explicit checks; annotations                                                                                      |
| `>>>`, `typeof`, `instanceof`, `in`, `delete`, `void`, unary `+` | `Math.sShr`, or plain values                                                                                      |
| `>>>=`, `\|\|=`, `&&=`, `??=`                                    | `x = …`                                                                                                           |
| `a[i] += v`, `t.f += v`, `a[i]++`                                | `a[i] = a[i] + v`                                                                                                 |
| `i++` used as a value                                            | `i += 1` on its own line                                                                                          |
| `t[0] = v` on a record                                           | `t.field = v`                                                                                                     |
| template strings                                                 | `"text"`, or bytes built with `.concat`                                                                           |
| `1e18`, `1.5`, `null`, `undefined`                               | `10 ** 18`, integers in the smallest unit, `0`                                                                    |
| `xs.push(v)`, `console.log`, any JavaScript library              | `new Array(n)` with an index; `log(…)`                                                                            |
| `Math.min`, `max`, `abs`, `pow`                                  | `if` or a ternary; `**`                                                                                           |
| comparing bytes with `==`                                        | compare `crypto.keccak256` of each                                                                                |
| `export default`, `export { … }`, `import * as X`                | `export function` / `export const`; named imports                                                                 |
| a method on a literal (``hex`…`.concat(d)``)                     | bind the literal to a `const` first                                                                               |
| sending value through a bound call                               | `evm.call(address, value, data)`                                                                                  |
| labeled statements, labeled `break`/`continue`                   | a flag variable                                                                                                   |
| computed object keys, object methods                             | plain named fields                                                                                                |

The compiler rejects each of these. Most messages read "… is not supported", naming the construct.

One closure is not the compiler's: in a program compiled for a chain, `Base(() => { … }).reward(…)`
opens a cross-chain intent whose body runs on that chain. The chain's body is taken out of the
program and compiled on its own before the compiler sees the rest, so it is not an arrow function
of the language; the raw compiler, given the same source, rejects it.

## 15. Limits

| Limit                                                                                   | Value                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Parameters of a function other than `main`, plus the values its body keeps live at once | about 16 (§4)                                    |
| `log` topics                                                                            | 4 on EVM; none on SVM                            |
| `eval` arguments                                                                        | 16                                               |
| `abi.encode` values, record fields encoded, `abi.decode` fields                         | 255                                              |
| Elements in an array literal                                                            | 65,535                                           |
| Bytes in a string or `hex` literal                                                      | 65,535                                           |
| `.catch()` block                                                                        | about 255 bytes of compiled code                 |
| `crypto.findPDA` seeds                                                                  | 15 (checked when run)                            |
| Nested arrays in a `main` parameter                                                     | 4 levels                                         |
| One caller-supplied collection in `main`'s arguments                                    | 16 KiB                                           |
| Working memory on SVM                                                                   | 64 KiB per run                                   |
| One Solana transaction: the program, its arguments and the cook                         | 1,232 bytes; `sauce run` stages a larger program |
