**Title:** feat(compiler): compile a closure as a program of its own with `program(closure, scope)`

## What this is for

An intent's body runs on another chain, so it is a program of its own. With the class design (#550) the SDK writes the intent syntax as an ordinary SauceScript class; this PR gives that class the one thing a class cannot write itself: compiling the body it stored as a separate program, for the destination chain.

```ts
// A program the user writes, on Ethereum:
function main(owner: Address, recipient: Address, amount: Uint256) {
  Optimism.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: owner,
  }).then(() => {
    USDC.transfer(recipient, amount);
  });
}
```

The same intent with `await` (#554), where the code after it is the body and runs on Optimism:

```ts
await Optimism.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: owner });
USDC.transfer(recipient, amount);
```

```ts
// In the SDK's intent library — `hop` makes the intent, `then` only stores the arrow:
then(body) { this.body = body; return this; }

[Symbol.dispose]() {
  const body = program(this.body, this.destination.chainId);
  // … route.calls: [ …transfers into the Pot,
  //   { target: POT, data: Pot.cook(ENGINE, body.code.concat(body.args)), value: FEE } ]
}
```

What the compiler does with `program(this.body, 10)`:

- It hands `10` to the SDK's `programOptions` callback, which answers with Optimism's options: `{ chain: "10", ambient: ["@sauce/chains/optimism"] }`.
- It compiles the arrow `() => { USDC.transfer(recipient, amount); }` as Optimism's program: `USDC` is the name Optimism's ambient module exports, not Ethereum's.
- `recipient` and `amount`, which the arrow reads from `main`, become that program's entry arguments.
- `body.code` is the program's bytecode, a constant; `body.args` is `recipient` and `amount` as two 32-byte words, read where the statement ends. So the route's cook call is constant bytes with two run-time words written in, and `programs` in the compile result reports the body: `{ scope: 10n, chain: "10", captures: ["recipient", "amount"], bytecode, … }`.

Nothing of the class is left at run time: the compiler runs it (#550), and what reaches the program is the encoding of the route with those two words in it.

## Interface

What this PR adds to the compiler's surface. Everything else is unchanged.

### Compile options

| Rust (`sauce_core::CompileOptions`) | npm (`compile(options)`) | |
|---|---|---|
| `program_options: Option<ProgramOptionsFn>` | `programOptions?: (scope: ProgramScope) => ProgramOptions \| undefined \| null` | **New.** Asked once per `program(closure, scope)` call, with the call's scope as plain data. The answer is that program's options; a field left out — or an answer of `undefined`/`null` — is the compile's own. Absent: every such program compiles with the compile's options. A throw fails the compile at the closure, carrying the host's message (`the host \`programOptions\` callback threw: …`); a malformed answer is refused (`the host \`programOptions\` callback's answer is not a valid \`ProgramOptions\``, the field's own error as its cause). |

`ProgramOptionsFn` wraps the callback: `ProgramOptionsFn::new(impl Fn(&ScopeValue) -> Result<ProgramOptions, Report<sauce_core::Error>> + 'static)`. A Rust host's failure is `sauce_core::Error::ProgramOptions` (or any error it returns).

| Rust (`sauce_core::ProgramOptions`) | npm (`ProgramOptions`) | |
|---|---|---|
| `target: Option<Target>` | `target?: "evm" \| "svm"` | The VM the program is compiled for. |
| `chain: Option<String>` | `chain?: string` | A key of the compile's `chain_profiles`/`chainProfiles`, selected exactly as `chain` selects the entry's (#525). Left out: the compile's chain. A chain with no profile, in a compile that has profiles, is `ProgramUnknownChain`, located at the closure. |
| `ambient: Option<Vec<String>>` | `ambient?: string[]` | The program's ambient modules: its global names. Read as the `ambient` option is. |
| `defines: Option<BTreeMap<String, Word>>` | `defines?: [name: string, value: string][]` | Its defines, read as the `defines` option is. |
| `optimize: Option<bool>` | `optimize?: boolean` | |

The scope, as the callback receives it — any value the compiler knows at compile time:

| SauceScript scope | Rust (`sauce_core::ScopeValue`, `#[non_exhaustive]`) | npm (`ProgramScope`) |
|---|---|---|
| a number, an address, a bool (`10`, `0xabc…`, `true`) | `Number(Word)` | `bigint` (`10n`; a bool is `0n`/`1n`) |
| a string (`"base"`) | `String(String)` | `string` |
| an object literal or a class instance (`{ id: 3 }`, `new Branch(4)`) | `Object(Vec<(String, ScopeValue)>)`, fields in the order set | `{ [field: string]: ProgramScope }` |
| an array literal (`[1, "two"]`) | `Array(Vec<ScopeValue>)` | `ProgramScope[]` |

A run-time value anywhere in the scope is `ProgramScopeNotConstant`.

### Compile result

| Rust (`sauce_core::Artifact`) | npm (`CompileResult`) | |
|---|---|---|
| `programs: Vec<ProgramReport>` | `programs: ProgramReport[]` | **New**, always present (empty when none). Every closure compiled with `program`, in the order each finished — a program nested in another's closure before the one around it. |

| Rust (`sauce_core::ProgramReport`) | npm (`ProgramReport`) | |
|---|---|---|
| `id: u32` | `id: number` | The `program` call's number, unique in the compile, in the order the compiler meets them. |
| `path: Vec<u32>` | `path: number[]` | The ids of the programs it is nested in, outermost first. |
| `scope: ScopeValue` | `scope: ProgramScope` | The scope it was compiled for. |
| `target: Target` | `target: "evm" \| "svm"` | |
| `chain: Option<String>` | `chain?: string` | The chain it was compiled for. |
| `bytecode: Vec<u8>` | `bytecode: Uint8Array` | The program: the same bytes `code` holds. |
| `manifest: Option<Manifest>` | `manifest?: AccountManifest` | On the SVM. |
| `captures: Vec<String>` | `captures: string[]` | The run-time values it reads of the program around it, in the order its entry takes them — each one 32-byte big-endian word of `args`: a name (`amount`), a field or element of a static value by its path (`order.qty`, `sizes.1`), a capture of an arrow it reads (`body.amount`), then the module `let`s it reads. One variable is one word however many names or arrows read it, listed once by the first path the program reads it by. |
| `absent_paths: Vec<AbsentPath>` | `absentPaths: AbsentPath[]` | Every dotted path this program read as `0` because it names nothing in **its own** scope (#550's `Artifact::absent_paths`, for this program): a body compiled for another chain folds the names that chain's modules leave out, so the host checks these against that chain's names. A path through a value the closure captures is never one: a capture is a local of the program around it, read as that program reads it (an unset field is `undefined`). The compile's own `absentPaths` stays the entry program's. |

### The builtin

```ts
program(closure, scope): { code: bytes, args: bytes }
```

- `closure` is an arrow function: written in place or held anywhere (a `const`, a field, a parameter). It takes no parameters.
- `scope` is any value known at compile time (the table above).
- The value is a static object (#550): `code` is the program's bytecode, a constant; `args` is its run-time captures as 32-byte big-endian words, read where `program` is called. `eval(code.concat(args))` runs it; `contract.method(code.concat(args))` hands it on.
- **Shadowing.** `program` is not reserved. A function, an import, an ambient export, a local or a module binding named `program` is what the name means there, as a program's own names shadow an ambient module's.
- **Captures are lexical**: the names in scope where the arrow was written, however it reaches `program`, and its `this` there (an arrow written in a method reads that method's `this`). A run-time number, address or bool is a word of `args`. A value the compiler knows is rebuilt in the program: a constant or string folded in; an object, array, class instance (its class's module loaded with the program), contract binding, contract import held as a value, or another arrow function rebuilt, each run-time scalar in it a word; a run-time tuple, or an array of a known length, carried field by field. An arrow the closure reads runs in its program as its own, so a library's arrow that calls the user's (`() => { body(); finish(tag); }`) is one program.
- **Identity.** A value reached along two paths is rebuilt once and shared, so one that holds itself is rebuilt too: a builder holding the closure that reads the builder (`order.then(() => order.qty)`), an arrow stored on the `this` it reads. One binding read by two arrows is one word.
- **A `const`'s literal** that a run-time use may have changed (#550 keeps its run-time copy: a write, a pass to a function, a read under a condition) is read from that copy, field by field.
- **Globals** are the program's own: the ambient modules, defines and chain its options name. A local of the program around the arrow outranks a global of the same name: it is captured.
- **Declared contracts.** The contracts the compile's caller declares (Rust `contracts` and `inline_contracts`, npm `contracts` and `inlineContracts`) are bindings of the entry module, so a closure written there binds them in its program, as it would an `import` of the same ABI (byte for byte), and so does a library arrow's program that runs one.

### Diagnostics

New error codes (`Diagnostic::code` / `diagnostics[i].code`), each located at the call or the closure:

| Code | When |
|---|---|
| `ProgramArity` | `program` is not given exactly a closure and a scope. |
| `ProgramNotAClosure` | The first argument is not an arrow function. |
| `ProgramClosureParameters` | The arrow takes parameters. |
| `ProgramScopeNotConstant` | The scope holds a run-time value. |
| `ProgramScopeHoldsItself` | The scope holds itself (an instance with `this.me = this`): the host reads a scope to its end. |
| `ProgramOptions` | The host's callback threw or answered with something malformed. |
| `ProgramUnknownChain` | The program's chain has no profile, in a compile that has profiles. |
| `ProgramContainsItself` | A function the closure calls compiles the same closure again around the same arrows. A program is keyed by its closure (module and span) and the set of every arrow function among its captures; a key met again among the programs it is nested in is refused. There are finitely many arrow spans, so the key space is finite, any unbounded nesting repeats a key, and compiling ends. The same arrow nested around other arrows (a hop inside a hop's handler) is another program; the same arrows around different static numbers are refused (the documented limit). |
| `ProgramFailed` | The program lowered but could not be emitted (its target refused a builtin); the cause says why. |
| `CaptureRefused` | The closure reads a value its program cannot be given: run-time `bytes`, an array of a run-time length, a local of another function. Located where it reads it. |
| `CaptureClassMissing` | A captured instance's class is not in a module the program loads. |
| `CapturedAssignment` | The program assigns a capture (`=`, a compound assignment, `++`/`--`) — read by the closure itself or by an arrow it runs, such as the user's arrow a library's arrow calls — or writes a field or element of one however it reaches it (directly, a nested field, a method's `this`, an array element), naming the captured value by the path it read it by: `` `order.box` belongs to the program around this closure: the closure's program reads it, and can neither assign it nor change what it holds ``. |

A failure inside the closure's program is reported once, located in the closure's own module. Inside a method the compiler runs, a refusal raised at the closure is moved to the user's statement, with a secondary label at the closure.

### Behaviour visible through the existing interface

- **Lowering reaches.** A compile that has an arrow function lowers only what its lowered calls reach, starting at `main`. A function only a closure's program calls is compiled into that program alone, against its names. A function nothing calls is no longer checked in such a compile.
- **Cache.** A function that compiles a program is never stored in the per-function cache.

### What the SDK does with it

```ts
import { compile } from "sauce-compiler";

const compiled = compile({
  target: "evm",
  entry: "main.ts",
  resolve,
  chain: "1",
  chainProfiles,                                    // one per chain id
  ambient: ["@sauce/chains/ethereum"],              // the source chain's names
  programOptions: (scope) => {
    const chain = String(scope);                    // `program(this.body, this.destination.chainId)`
    return { chain, ambient: [`@sauce/chains/${CHAINS[chain]}`] };
  },
});

for (const body of compiled.programs) {
  body.scope;      // 10n
  body.chain;      // "10"
  body.captures;   // ["recipient", "amount"]: the words of `args`, in order
  body.bytecode;   // the body's program, as Optimism runs it
  for (const path of body.absentPaths) {
    // `UniswapV4.Quoter` read as 0 on Optimism: fine if its names leave it out, a typo otherwise.
    checkLeftOut(CHAINS[body.chain], path.name, path);
  }
}
```

```ts
// SauceScript: a class that compiles the closure it stored, for the branch a field names.
import Courier from "./courier.json";

class Errand {
  constructor(branch) { this.branch = branch; }
  carry(body) { this.body = body; return this; }
  [Symbol.dispose]() {
    const parcel = program(this.body, this.branch);
    Courier.at(DEPOT).deliver(parcel.code.concat(parcel.args));
  }
}

function main(amount: Uint256, to: Address) {
  new Errand(2).carry(() => { Courier.at(to).probe(amount + FEE); });
}
```

compiles to exactly what is written out by hand — nothing of the class survives:

```ts
function main(amount: Uint256, to: Address) {
  const parcel = program(() => { Courier.at(to).probe(amount + FEE); }, 2);
  Courier.at(DEPOT).deliver(parcel.code.concat(parcel.args));
}
```

## How it works

- **One more run of the pipeline.** `program_call` (lower/nested.rs) asks `nested::Programs`, which `lib.rs`'s `ProgramCompiler` implements: it lowers the closure's own module, as the compile parsed it, with the arrow as its `main` (`frontend::closure_main`), in the options the callback gave, then emits it with the back half every program shares (`emit`). Every program of a compile shares one `ParseCache`, so a file is resolved and parsed once; the compile's entry is registered there as it was read, so a script or a closure entry loads as itself.
- **Captures.** `Lowerer::closure_names` describes each name the arrow mentions, and its `this`, as a `nested::Capture`; every object, array and arrow among them is numbered once by identity (`nested::Shapes`), its `Shape` described once, so a cycle ends. The closure's program reads a name lazily (`capture_value`, before module values; `this` through `captured_this`): `rebuild` makes its value there once — each shape made empty and registered, then filled (`make`, `fill`), so a value that holds itself holds the one being made — each run-time scalar in it a module-global slot loaded by an entry prologue from the argument words, behind the same length guard an entry parameter has. Two reads of one binding (`nested::Source`) share a slot. After the program compiles, the program around it reads each taken scalar where the call stands, along its path, spilled unless stable. An arrow captured by the closure is rebuilt with its names bound as values and the program's own function, so it runs there in place; the modules every captured arrow and class is written in are loaded with the program, broadcast nowhere.
- **Reach.** `lower/reach.rs` decides whether a compile has an arrow; one that does lowers from its lowered calls (`assembly::lower_reached`), every other function an unlowered stub nothing calls.
- **The guard.** `Compilation::closures` holds a `nested::ProgramKey` per enclosing program: the closure's module and span and the set of arrows (module, span) among its captured shapes. `program_call` computes the key from the shapes before compiling and refuses one already on the stack with `ProgramContainsItself`. Keying on the arrows rather than the closure alone only relaxes the refusal: anything it now compiles nests around a different set of captured arrows, and the finite key space still bounds the depth.
- **Where it plugs into #550.** `statics::Context` holds the compile's `Compilation`; `Closure` and `Callee` carry the captures of the program a closure was written in; `binds_name`/`static_root`/`identifier_value` know captures; `relocate` and `anchor` leave a report already rendered against its module alone.

## Tests

- `crates/sauce-core/tests/closure_programs.rs` — 63 tests: the class whose dispose compiles a stored closure for the branch a field names (nested and root bytes equal the written-out program); a library arrow that runs the user's arrow as one program (`body.to`, `body.amount`, `tag`; nested and root bytes equal the body written out in one closure); globals from the program's own ambient modules against the root's, a captured local outranking them; scopes of every shape; static captures (objects, arrays, instances, contracts, arrows, run-time tuples, `new Array(3)`); frozen captures; nesting and the `path`/`id` report; chain profiles per program; another VM; module `let`s; imported modules; reach; one resolution per file; the per-function cache; shadowing of `program`; values that hold themselves (an instance, a builder and the arrow that reads it, an arrow stored on its `this`, an array holding its holder) rebuilt once, a closure compiling itself through a method, a module binding or its own name, a scope that holds itself; the same arrow nested 2 and 3 deep around different continuations (byte for byte the hand-nested programs), against a self-recursion, a growing `() => f()` wrapper chain and a compile-time recursion over different numbers, all still `ProgramContainsItself`; declared and inline contracts bound in a closure's program byte for byte as an import, directly and through a library arrow; a contract import held as a value (#550) captured and bound byte for byte as the same value made in the closure and as the import written by name; an unset field of a captured value used as a value refused as #550's `Unset`, located in the closure; `this` in and around the closure; literals read from their run-time copy; one variable two arrows read as one word (a local, a tuple field, an instance field: byte for byte the program a single arrow compiles to); each program's own absent paths against the entry program's, and a path through a captured value (a literal's field, an instance's, a run-time tuple's, a contract binding, an unset field, `this`) read, never folded; every refusal with its location.
- `crates/sauce-cli/tests/{v12,svm}_conformance.rs` + `common/programs.rs` — on v12 and the SVM engine, each program `eval`s its closure's: a captured local and a folded constant, a name of the program's own scope, a bool, a nested program, a module `let`, a class that stores and compiles a closure, the static values a closure reads, a library arrow that runs the program's own (`121012` for `main(7)`), a capture written after `program` that `args` does not see, a static field set between writing the arrow and `program`, a module `let` the program writes, a builder holding the arrow that reads it, a self-holding instance, an arrow stored on its `this`, `this` in the closure and in an arrow it reads, a literal read from its run-time copy, one written again in a loop after `program`, one binding two arrows read, whose `args` is one word per variable, and paths through captured values compared as the program around them reads them; on v12, a program reading its own chain's profile; on both, too few argument bytes revert.
- `crates/sauce-wasm/test/smoke.mjs` — `programOptions` asked with the scope as plain data, an `undefined` answer, another target, a throw, a malformed answer, a chain profile and its refusal, `programs` present and empty, a program's own `absentPaths`, an inline contract bound in a closure's program.
- `make ci` (3611 tests), `make test-conformance` (704), `make smoke` (83 checks) pass. `tests/base_bytecode.rs` (#550's guard) passes: no base program grows.

## Stack

On #550 (classes and static values). #552 (try/catch) is rebased onto this next; the library's `try { body() } catch (e) { … }` is a library arrow running the user's, which this PR compiles as one program.

## SDK side

The SDK's intent class, which `Optimism.hop({ … })` makes, calls `program(this.body, this.destination.chainId)` in its `[Symbol.dispose]()`, and the SDK's `compile()` passes `programOptions` mapping each chain id to that chain's profile and generated names module. `programs` replaces the per-body compiles the SDK makes today.
