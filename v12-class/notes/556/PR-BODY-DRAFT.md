Stacked on #555 (`feat/compiler-specialization`, final at c553e59c, which carries main after #549). #557 builds on it.

## What this is for

A wallet publishes an intent file's intents by cooking the file on its own Pot, and the file's inputs are `main`'s parameters, given on the command line:

```ts
// bridge.sauce.ts — sauce intent publish bridge.sauce.ts --chain base --args 1000000,<recipient>
function main(amount: Uint256, recipient: Address) {
  await Optimism.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: amount * 99 / 100 },
    refundee: recipient,
  });
  USDC.transfer(recipient, amount * 99 / 100);
}
```

The SDK now compiles that file **for** those arguments: `compile({ …, args: [1000000n, recipient] })`. `main` is compiled as if it were written with `const amount = 1000000; const recipient = 0x…;`. So `hop`, which runs while compiling (#550), builds an intent whose reward, delivery and refundee are constants, and the body after the `await` folds both values in instead of taking them as arguments. What the compiler emits:

```ts
const intent = { …, reward: { …, creator: 0x…, tokens: [{ token: USDC, amount: 1000000 }] },
                 route: { …, tokens: [{ token: USDC, amount: 990000 }],
                          calls: [{ target: POT, data: cook(ENGINE, BODY), … }] } };
const vault = EcoPortal.intentVaultAddress(intent);
transfer(USDC, vault, 1000000);
EcoPortal.publish(intent);
```

`BODY` is constant bytes, a program that takes no arguments (`programs[0].captures` is `[]`), and the cook appends nothing for `main` (`entryParams` is `[]`). The intents are fixed before anything runs. Without `args`, `amount` and `recipient` are run-time words: holes written into the literal as the program runs, and two arguments of the body.

## Interface

### Options

| Rust (`sauce_core::CompileOptions`) | npm (`compile(options)`) | |
|---|---|---|
| `args: Option<Vec<Word>>` (builder: `.args(vec![…])`) | `args?: Array<bigint \| boolean \| string>` | **New.** The value of each of `main`'s arguments, in the order `entryParams` lists them. `main` is compiled as if each parameter were a `const` of its value. A parameter `main` assigns is instead a `let` starting at its value. npm takes a non-negative `bigint` below 2^256, a `boolean` (0 or 1), or a decimal or `0x`-hex integer string, as a `defines` value is. **An SVM `Account` parameter takes no value**: it is an attached account, not an argument, and stays in `manifest`. `None`/absent: the arguments are decoded from the input as the program runs, as before. |

### Compile result

| Rust (`sauce_core::Artifact`) | npm (`CompileResult`) | With `args` |
|---|---|---|
| `entry_params: Vec<AbiParam>` | `entryParams: AbiParameter[]` | `[]`: nothing is appended to the program. |
| `entry_schema: Option<Vec<u8>>` | `entrySchema?: Uint8Array`, `entryEncoding` | `None`/absent, and `entryEncoding` is `"abi-v1"`, with `compactArgs` too: there is nothing to encode. |
| `manifest: Option<Manifest>` | `manifest?: AccountManifest` | Unchanged: an SVM `Account` parameter keeps its slot. |
| `ProgramReport::captures` | `programs[i].captures` | A bound argument is not listed: the closure's program folds it in. |
| `bytecode` | `bytecode` | `main` with the arguments as `const`s, and each `const` computed from them a constant too. |

### Diagnostics

| Rust (`sauce_core::Error`, in `lower`) | npm (`error.diagnostics[i].code`) | Located at | |
|---|---|---|---|
| `ArgsCount { expected, got }` | `"ArgsCount"` | `main`'s parameter list | "the program is compiled for 1 argument(s), and `main` takes 2: `args` gives each of its arguments its value, in the order `entryParams` lists them". Counts arguments only, so an SVM `Account` is not counted. |
| `ArgNotWord { name, ty }` | `"ArgNotWord"` | the parameter's annotation | "`xs` is an array of number, and an argument the program is compiled for is a word: a number, an address or a bool". |
| `ArgOutOfRange { name, value, ty }` | `"ArgOutOfRange"` | the parameter's annotation | "`on` is a bool, which 2 is not". Raised for a `bool` above 1, and on the EVM an `Address` or an `Account` past 160 bits. On the SVM an `Address` is a public key, the whole word. |
| n/a | thrown `Error`, no diagnostics | | "`args` value -1n at 0 is not a word: give a non-negative `bigint` below 2^256, a `boolean`, or a decimal or `0x`-hex integer string". |

### Language

- **`main` compiled for its arguments is `main` with them as `const`s**, and a `const` computed from them that evaluates is a constant too (`const fee = amount * 99 / 100` is `990000`), so it decides and folds as they do. Every rule of #555's specialization applies to `main` itself. An `if` a value decides compiles only its taken arm. A run-time call passing one calls the copy for it. A call the compiler runs (a method, `hop`) runs with it as the constant it is. A `try` block or `program(closure, scope)` closure folds it in. It can be the scope a `program` call names.
- **What fails written out fails here.** An operation the values make fail to evaluate (`100 / k`, `k` given 0) is a compile error, as it is in `const k = 0; return 100 / k;`.
- The SauceScript reference has a new section, "Compiling `main` for Its Arguments".

### Example

```ts
import { compile } from "sauce-compiler";

// main.ts: function main(a: Uint256, b: bool): Uint256 { return b ? a + 1 : 0; }
const bound = compile({ target: "evm", resolve, args: [5n, true] });
bound.bytecode;    // the bytes of `function main(): Uint256 { return 6; }`
bound.entryParams; // []

// main.ts: function main(a: Uint256): bytes {
//            return program(() => { evm.sstore(1, a * 99 / 100); }, 1).code;
//          }
const folded = compile({ target: "evm", resolve, args: [1000000n] });
folded.programs[0].captures; // []: the closure's program is `evm.sstore(1, 990000)`'s
```

```rust
let options = CompileOptions::builder()
    .target(Target::Svm)
    .args(vec![Word::from(7u64)])
    .build();
// function main(depot: Account<Writable>, weight: Uint256): Uint256 { … }
// `depot` stays manifest slot 0; `weight` is 7.
```

## The generic mechanism

- **The entry's arguments are constants.** `lower_at` maps `Place::args` onto `main`'s parameters (`assembly::entry_known`). It uses the same `is_argument` rule as the decode prologue and `entryParams`, so an SVM `Account` gets no value. `lower_function` takes what it knows as a `Knowing`, and #555's copies take the smaller of `Knowing::Decides` and `Knowing::Constants`. The entry with `args` always takes `Knowing::Constants`: it has no input to read an argument from, so every bound argument is a `const` of its body, whether or not it decides anything, and a `const` computed from them is one too. Nothing about the entry is weighed. Each is declared after the unbound parameters, which keep their slots `0..n`, so an SVM account's slot, role and manifest entry are unchanged.
- **Checks.** `bound_argument` holds each value to its parameter's type. `entry_params::is_address`, factored out of `entryParams`' layout, is the one rule for what is an ABI `address`.
- **An assigned parameter** (`reassigned_names`, which since #555 sees an arrow `main` runs and a `.catch()` handler) is a mutable local whose first statement assigns it its value, rather than a `const`.
- **No decode.** With every argument bound there is no prologue to read them, compact or not. `entryParams` is filtered out of the result.
- **Cache.** The entry is keyed by its arguments (`fn_cache::specialized_context`), so a second compile for the same arguments hits and one for others lowers `main` again.

## Tests

- `tests/entry_args.rs` (a generic shop: an order's quantity, a gate, a numbered branch):
  - **SDK acceptance (A).** `main(a: Uint256, b: bool)` given `[5, true]` is the bytes of `return 6` at `-O` on both targets, with `entryParams` `[]`. An address argument is the literal address.
  - **SDK acceptance (B).** A `program(closure, 1)` reading `a * 99 / 100`, given `[1000000]`, captures nothing, and its code is the closure written with `990000`. Without `args`, it captures `a`.
  - The const-written form at both optimization levels.
  - A call specialized on an argument.
  - An argument deciding an `if`, a `program` scope, and a method the compiler runs. A closed gate's `throw` is a compile error.
  - The refusals.
  - An SVM `Account` staying attached, with the same manifest, while the EVM counts it.
  - Assigned parameters on both targets and levels, including one assigned only inside an arrow `main` runs, or inside a `.catch()` handler.
  - The cache by arguments.
  - A closure entry, compact arguments, a script, and the reference's example.
  - Division by a zero argument failing as written out.
  - A `const` computed from an argument deciding an `if` and folding into a closure's program (captures `[]`).
- Engines (`common/specialized.rs`): one program compiled for its arguments runs on v12 and on the SVM engine with nothing appended, at both levels.
- `try_conformance`: on v12, the arrow-assigned argument returns 6. The `.catch()`-assigned one returns 0 when the call reverts and 1 when it succeeds.
- wasm smoke: `args: [5n, true]`, a string argument folded into a closure's program, and both refusals.
- `tests/base_bytecode.rs`: unchanged. No program grows.
- Locally, at c0309041: `make ci` (3736 passed), `make test-conformance` (745 passed), `make smoke` (88 checks ok, and the web, ready and postbuild scripts).
- Compile time: on the test file's programs, a cold compile with `args` takes 0.25–0.67× as long as the same program without it (natively, release, median of 31). The one exception is a call specialized on an argument, at 1.27×, which tries and weighs a copy; that is 57 µs.

## Since the previous revision

The old #556 compiled for its arguments on the old host API: values reached host program arguments and `bind` sites. Under the class design there is no host. A bound argument is a `const`, and the closure, class and specialization machinery does the rest. Two changes for the SDK:

- **SVM `Account` parameters.** `args` now follows `entryParams`, so an SVM `Account` parameter takes no value. Before, it was counted and refused.
- **npm value types.** The npm option takes `bigint | boolean | string`, where before it took strings only.

## Stack and SDK side

main (with #549) ← #550 ← #551 ← #552 ← #553 ← #554 ← #555 ← **#556** ← #557.

SDK: `compileSauceProgram(chain, body, { args })` passes `args` through instead of refusing it. The values are indexed by `entryParams` (an SVM `Account` takes none), and `sauce intent publish --args` uses it, so a wallet's intents come out fixed. #557's `entrySignature` keeps reporting `main`'s declared signature when `args` is given.
