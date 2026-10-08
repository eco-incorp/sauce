Stacked on #554 (`feat/compiler-await`, final at daed46d1). `args` (#556) builds on it.

First, two fixes to the calls the compiler runs (#550) that the SDK's token class needs; then specialization.

## What this is for

A value a program knows while compiling decides things wherever it goes, including inside the helpers it is passed to. In the SDK that means a helper written once, and called with constants, compiles to the program written for those constants:

**A token method is the direct call, and a missing argument is named where it is missing.** The SDK's `Token` checks its arguments before it forwards them to `@sauce/token`:

```ts
// in the SDK's token class:
balanceOf(holder) {
  if (holder === undefined) throw new Error("balanceOf needs a holder");
  return balanceOf(this.address, holder);
}
```

`USDC.balanceOf(ctx.self())` now compiles to the bytes of `balanceOf(USDC_ADDRESS, ctx.self())`: the guard is decided before the method runs and does nothing at run time, so `ctx.self()` is read where the direct call reads it, not copied first, which cost a byte before. And `USDC.transfer(to)`, with the amount left out, is refused at the user's call, "`amount` is `undefined`, so it has no run-time value here", where it used to fail inside the library with "`toBytesBe` is not a member of `amount`".

**A helper's intent body is compiled for the values it is called with.** The SDK's `hop` runs while compiling (#550) and compiles the `.then` body as a program of its own; a value the helper knows is folded into that program instead of carried in as an argument:

```ts
function bridge(amount: Uint256, recipient: Address) {
  Optimism.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: amount * 99 / 100 },
    refundee: recipient,
  }).then(() => {
    USDC.transfer(recipient, amount * 99 / 100);
  });
}

function main(recipient: Address) {
  bridge(1000000, recipient);
}
```

`bridge(1000000, recipient)` calls a copy of `bridge` compiled knowing `amount = 1000000`: its body program computes the transfer from the constant and takes `recipient` alone. Everywhere else the copy reads `amount` as the argument the call still passes, or as the constant where that compiles smaller, so the intent's own words never cost more than they did.

**A swap with constant tokens encodes them as constants.** `@sauce/router`'s `uniswapV4(pool, USDC, WETH, amount, 500, 10, 0, minOut, 0, ctx.self())` sorts the two tokens to build the pool key and then encodes them. The copy knows them as constants where that is smaller: 215 bytes, where knowing them only for the sort left them arguments at 286. A helper that reads a wide constant again and again keeps it an argument instead (a Curve helper: 598 bytes, where baking the addresses in made 656).

**A helper called with several values compiles once when that is smaller.** The distributed swap's `trade(venue, …)` is called with venues 1, 0 and 2. Three copies were larger in all than the one function (236 bytes against 189 on 2.5.0), so the calls now call the function as written.

**A helper called with a known flag drops its dead arm**, as an inline `if` already does, so a helper that names a protocol compiles on a chain whose module leaves it out:

```ts
function quote(useV4: bool, amount: Uint256): Uint256 {
  if (useV4) {
    return UniswapV4.Quoter.quote(amount);   // never compiled where `useV4` is false
  }
  return UniswapV3.Quoter.quote(amount);
}

function main(amount: Uint256): Uint256 {
  return quote(UniswapV4.Quoter != 0, amount);   // `false` on a chain with no V4 quoter
}
```

With `args` (#556), `main`'s own parameters are known too, so both apply to a program compiled for its arguments.

## Interface

No option, result field, builtin or diagnostic code is added. What changes is visible through the existing interface:

### Diagnostics

| Rust (`sauce_core::Error`) | npm (`error.diagnostics[i].code`) | |
|---|---|---|
| `Unset { what, used, explanation }` | `"Unset"` | **Raised in a new place.** `undefined` given to a *required* parameter — annotated with a run-time type and not optional — is refused at the argument, named as written: "`` `amount` is `undefined`, so it has no run-time value here ``", or "the argument for `amount` …" for a bare `undefined`. Before, the call ran while compiling and failed inside the function. |
| `StaticAtRunTime { what }` | `"StaticAtRunTime"` | **Raised in a new place.** Any other value with no run-time form (an instance whose class converts it to nothing, a closure, a class) given to a required parameter, at the argument. |

An un-annotated or rest parameter, and an optional one (`b?: Uint256`), given such a value still run the call while compiling, and a call that leaves out only optional parameters now does too (Language, below); before, it was `ArityMismatch`. A default parameter value (`b: Uint256 = 5`) stays outside the subset (frontend: "a default parameter value").

### Language

- **Optional parameters.** A call that leaves out only optional parameters (`f(a)` for `function f(a: Uint256, b?: Uint256)`) runs while compiling with them `undefined`, so a guard on one (`if (b === undefined) { … } else { … }`) compiles only the arm it takes, byte for byte the body written with that arm. Given, it is the run-time value it is, and the function is called.
- **Arguments read in place.** A guard `p === undefined` or `p !== undefined` on a parameter is decided before a call the compiler runs executes its body, so it no longer stops an invariant argument (`ctx.self()`, a local, a constant) from being read where the call written out by hand reads it.

A run-time call that passes a function a value known while compiling calls a **copy** of the function compiled with that value in place of the parameter, when the value decides something there. Known: a literal, a define, arithmetic of them, a `const` of them, or a parameter the calling function was itself compiled for. Decides something: an `if`, a loop, a `?:` or `&&`/`||`; a call the compiler runs; a `try` block's or `program(closure, scope)` closure's capture, folded in; a `program` scope; a call passing it on to a function where it decides something. It is a language rule, at every optimization level. The SauceScript reference (`docs/saucescript/language-reference.md`) has a new section, Specialization.

- **A function that fails to compile as written** compiles when no run-time code calls it as written and every call of it knows the values it fails without (it is checked as its copies). Otherwise its error is reported as before, the first in function order.
- **Two forms of a copy, the smaller kept.** Knowing its values only where they decide, a copy reads the argument the call still passes everywhere else, drops a known parameter it no longer reads from itself and from the call, and is never larger than its function. Knowing them as constants, it folds each where it is read, a `const` computed from them included, and takes none of them. Each call's copy is the one that emits fewer bytes with what the call passes, at the compile's optimization level.
- **Copies only where they are smaller in all.** Where the function compiles as written, its calls call copies only if the copies, with their calls, are no larger than the function and the arguments those calls would pass it; otherwise they all call the function. A function that compiles only as its copies is always called through them, so size never decides whether a program compiles.
- **A nested function's own names.** A parameter an arrow or a function expression declares, or a name its body declares at its top, is its own: assigning it there no longer makes the outer parameter of that name unknown.
- **A call the compiler runs is never specialized.** A call with a static argument, a method or a closure runs while compiling (#550) with every argument as it is. The two never apply to one call.

### Compile result

| Rust (`sauce_core::Artifact`) | npm (`CompileResult`) | |
|---|---|---|
| `programs: Vec<ProgramReport>` | `programs: ProgramReport[]` | **Changed.** A `program(closure, scope)` call in a function compiled as copies is reported once per copy, numbered in the order the copies are made. A copy the compiler tries and does not make reports nothing and takes no number. |
| `ProgramReport::captures` | `programs[i].captures` | **Changed.** A known value the closure reads is folded into its program: it is no longer listed, and no longer a word of `args`. |

### Options

| Rust (`CompileOptions`) | npm (`compile(options)`) | |
|---|---|---|
| `program_options: Option<ProgramOptionsFn>` | `programOptions?: (scope) => ProgramOptions` | **Changed contract.** Called for each `program` call compiled, and again where the compiler lowers a copy that holds one: to decide it is worth making, in each of its two forms to choose one, and in that one to make it — or tries one it does not make. It must answer a scope the same way every time. |

### Function cache

| Rust | npm | |
|---|---|---|
| `function_cache_stats()`, `clear_function_cache()` | n/a | A copy is cached by the values it knows. A function holding a `try` block is now cached too, keyed on what its block's program compiles from (every module's text and values, the contracts, the chain profiles, the options and the programs it is nested in). Before, it never was. |

### Example

```ts
import { compile } from "sauce-compiler";

const { programs } = compile({
  target: "evm",
  entry: "main.ts",
  resolve,
  programOptions: (scope) => ({ defines: [["BRANCH", scope]] }),
});
// main.ts:
//   function ship(rate: Uint256, x: Uint256): bytes {
//     const parcel = program(() => rate * x, 1);
//     return parcel.code.concat(parcel.args);
//   }
//   function main(x: Uint256): bytes { return ship(3, x); }
programs[0].captures; // ["x"]: `rate` is the copy's constant, folded in
```

## The generic mechanism

- **Copies** (`lower/specialize.rs`). Made by rewriting each lowered function's run-time calls (`Specializations::rewrite`) right after it is lowered, in both lowering modes. A parameter the body assigns anywhere — an arrow it runs or a `.catch()` handler included (`reassigned_names`) — or one that is not a word, is never known, and nor is one no condition, call, `new`, closure or `try` block reads (`may_decide`, a syntactic pre-filter); a copy that still writes a parameter it knows is refused (`specialize::sound`).
- **Known only where it decides.** A copy is `lower_function` with known values that `specialize::Known` (held in `FunctionState`, so shared with every frame the compiler runs in the function) keeps beside the parameters, and beside each `const` computed from them. Reads are the parameters' locals as ever; a decision (`Lowerer::decide`: `if`, loops, `?:`, `&&`/`||`, in a frame too), a capture folded into a program, and a `program()` scope read the known locals as their values, and mark the parameters they read productive. A call passing a known value on records it (`passed`), and counts once its callee's copy is made.
- **Two forms, weighed** (`specialize::Form`).
  - `Decides` is `lower_function` with `Knowing::Decides`, as above.
  - `Constants` is `Knowing::Constants`: each known parameter is a `const` of the body (`know_constant`). A `const` whose initializer read one and evaluates is a `const` too (`specialize::Constants`, `constant_reads`).
  - `Specializations::choose` weighs both lowerings and takes both back (`weigh`, memoized by key). Inside each, every call passes what its own copy would take (`drops`, which chooses for that copy in turn).
  - The weight is `Lowering::width` = `crate::function_width`: the function run alone through the back half at the compile's level (`fold::function` at `-O`, `eval_order`, `dead_store`, `capability::available`, `codegen::function_width`), in its own frame — the entry's as `main`'s. To that, `choose` adds the calling function emitted passing what that form takes (`Site`).
  - `Constants` is kept only where it weighs strictly less. `nested::Compilation::optimize` carries the level into lowering for this alone.
- **Copies against the function** (`assembly::program`, before the program is assembled).
  - A function only its copies call, in a compile that lowers only what calls reach, is lowered to be weighed, together with what it reaches. This happens under a `Changes` mark and a clone of the `Specializations`.
  - If nothing it reaches as written is held or unlowered, `specialize::shares` measures the reached functions' widths both ways: as they stand, and with every call of a copy a call of the function (`calls_declared`, `Specializations::undone`). If the second is strictly smaller, those calls are rewritten. Otherwise the lowering is taken back.
  - An uncalled copy stays as written, unreached and not emitted, so no held error moves.
  - A copy records whether its lowering changed the program around it: compiled a program, registered a global, or read a path as `0` (`Made::changed`). If the function wins over copies like that, the whole program is lowered again from a mark with the function called as declared only (`Specializations::declared_only`). No program report, number, absent path or global of the discarded copies remains.
  - The calling function's width is measured once per callee and per set of dropped arguments (`Site::widths`), so weighing a caller's calls is linear in them.
  - This is not done in a `try` block's program, since its frame's refused writes are checked along what it reaches.
- **Shadowing** (`statics::assigned_names`). A write inside an arrow or function expression to a name it declares for itself (its parameters, its body's top-level declarations) is no write of the outer name.
- **Decide, then make.** `Specializations::reduce` lowers a trial, takes back what it did to the program around it (`assembly::Changes`: global slots, program numbers and reports, absent paths), and narrows the known values to the productive ones until each decides something; a copy that decides nothing, fails to lower or does not fold (`fold::folds_cleanly`: `100 / k` with `k` known zero, an index past a constant array, in it or a program it compiles) is not made. `request` then lowers the copy for good, takes its id, rewrites its calls, and drops each known parameter the rewritten copy no longer uses (`used_locals`, `without_params`) from it and from the call, unless a recursion reached it while it was being made. Copies are keyed by the values that decide, so calls differing only in a value that rides along share one.
- **Bounds.** A recursion specializes one level per call (`within`); a function has at most 64 copies, past which a call is the call of the function as written.
- **Held failures.** Every function whose lowering fails is held, its changes taken back, and the first that stands reported once all functions and copies are lowered. The entry's always stands. One taking a static value stands only if called as written (#550's rule). Any other also stands when no copy of it was made.
  - "Called" means called by a function the entry reaches (`called_from`), counted on the program as specialized and as weighing left it. A function lowered but never run calls nothing. So whether a program compiles no longer depends on an unrelated closure switching the compile to reached-only lowering (#551).
- **The engine reader.** A `try` block calls #552's engine reader by a placeholder id while the copies are numbered, rewritten once every function is, so the reader comes after the copies.
- **The `try` block cache key** (`fn_cache::CAT_BLOCK`). A function holding a block is keyed on `Compilation::block_key`, together with the options fingerprint (`Compilation::options`). Both are fingerprinted the first time a block, or a lookup of a function holding one, asks for them. Rendering them hashes every define and module value, which is half of a small program's compile. A block whose own program compiles a closure stays uncached (`CAT_PROGRAM`).
- **IR walk.** `ir::map_exprs`/`map_leaves` rebuild every expression of a statement list; `unroll`'s loop-variable substitution is now a call of them.

## Tests

- `tests/static_values.rs`: a guarded method, through a class, an arrow that makes the instance, and either guard, is the direct call byte for byte, while a guard on a field copies the argument; an optional parameter left out (or given `undefined`) decides its guard, byte for byte the body with the taken arm and the direct call; `undefined` to a required parameter is `Unset` at the argument (a forwarded missing argument, a bare `undefined`, an unset field), another static value `StaticAtRunTime`, and a required parameter left out stays `ArityMismatch`.
- `specialize::tests`: copies made and not made, one per value set, a known `const`, values passed on (and a parameter dropped through them), recursion both ways and in both forms (a copy reached while it is made keeps every parameter it reads its values through), the limit (72 requested from 17 call sites), a function checked as its copies, a call the compiler runs making no copy, a value that decides and is encoded made a constant of the copy (a `const` of it too), a wide value read again and again kept an argument, and three copies larger in all than their function calling it instead (one copy, smaller, kept).
- `tests/specialization.rs` (a generic shop and courier): byte equality with the helper written for the value on both targets at both levels; cold against warm numbering; the cache by known values; a dead arm; an operation a known value cannot evaluate; an argument part of which aborts; a known value folded into a `try` block's program (bytes) and a closure's (`captures`); a known scope choosing a program's options; a discarded copy taking back the programs it compiled; a block's write through a copy naming the declared function; and the boundary with #550: an arrow argument runs the call, a known value a method uses makes a copy (where the function as written does not compile), and a run-time call a method makes calls its copy. A copy knowing its values as constants is byte for byte the helper written with them, and an arrow writing a parameter of its own named as the function's leaves the function's known (20 bytes, where it was 51), byte for byte the arrow's renamed. With 2 and 8 call sites of a helper whose copies each compile a closure but lose to the helper, `programs` holds exactly the one program the bytecode carries, numbered 0, and the path read as `0` once.
- `tests/awaits.rs`: a known value specializes in an awaited `try` and its handler.
- A parameter assigned only in an arrow the body runs, or only in a `.catch()` handler, is never known: `specialize::tests`, and on the engines with JavaScript's results (6 in `common/specialized.rs`, 0 in `try_conformance`).
- `tests/try_catch.rs`: a function holding a block hits when unchanged and misses on a changed define or helper; one whose block compiles a closure is never kept.
- Engines (`common/specialized.rs`, v12 and SVM, both levels): two copies of one function, recursion both ways, a value passed through a `const`, a copy made inside another, a copy not made, a class method deciding with a known value, and a method's run-time call; `try_conformance`: blocks in two copies reading the engine through the reader after them.
- `tests/base_bytecode.rs`: six specialized library calls join the corpus (`specialize/`).
  - An exchange helper with all but its amounts known, the same with only its flag known, and a helper reading two constant addresses four times each beside a deciding flag. Recorded from `ce49eef5` and listed in `SMALLER`: they compile to 598, 599 and 182 bytes against 630, 631 and 201.
  - A helper called with three values of a mode (`three-modes`), recorded from `ce49eef5`: the same bytes, 189 and 187.
  - An ordered pair encoded, and a pool-key record built from one (`ordered-pair`, `keyed-pair`), recorded from `2155102e`, where they first folded: the same bytes, 41 and 66 (84 at `-O0`). 68ddccf5 made 44 and 92.
  - Beside them only #550's two `SMALLER` entries move, as on the base. Nothing grows.
- Sizes, by sdk-class's `tools/sizes` (81 SDK bytecodes): none larger than 2155102e. Against released 2.5.0, SDK main's own programs on this build are 42 the same, 3 smaller and none larger.
- Compile time: each recorded SDK compile was replayed on every build in one process, interleaved, cold, median of 5.
  - SDK main programs: 255 ms in total, against 217 on 2.5.0. The worst is ×2.06 (the distributed swap, 13.2 ms).
  - rewrite61 programs: 1419 ms, against 1349 on #554.
  - review-550's shapes: 64 values of one helper take 8 ms, and 48 nested call sites take 12.5 ms (6dd0e358: 114 and 61.5).
- A function that compiles only as its copies, called as written by a function only its copies are called through, compiles with or without an unrelated closure, to the same bytes (`tests/specialization.rs`).
- Locally, at c553e59c: `make ci` (3719 passed), `make test-conformance` (742 passed), `make smoke` (all ok).

## Stack and SDK side

main ← #549 ← #550 ← #551 ← #552 ← #553 ← #554 ← **#555** ← #556 ← #557. The SDK needs nothing to opt in: its helpers called with constants compile to the programs written for those constants, and a helper guarding a name a chain lacks with a flag compiles there.
