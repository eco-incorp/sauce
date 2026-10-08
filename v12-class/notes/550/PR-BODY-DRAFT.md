## What this enables

The Sauce SDK will write its intent syntax as an ordinary SauceScript class in a library, and hand each chain's names (`USDC`, `UniswapV3.Factory`, `Optimism`, …) to a program as an ambient module. A program opens an intent with one verb and a config object:

```ts
await Optimism.hop({
  reward: { token: USDC, amount },
  receive: { token: USDC, amount: 1000000 },
  refundee: owner,
});
// the code from here on runs on Optimism
```

or, with the destination's code as a body:

```ts
Optimism.hop({
  reward: { token: USDC, amount },
  receive: { token: USDC, amount: 1000000 },
  refundee: owner,
}).then(() => { /* runs on Optimism */ });
```

`Optimism` is an instance of the SDK's chain class, and `hop` is a plain class method that takes a static config object and returns an `Intent` that only records it. Nothing in the compiler is there for `hop`: the instance, the method, the object literal and its fields are ordinary static values, and the call is an ordinary method call. The intent is published by the class's `[Symbol.dispose]()`, which runs when the statement ends. With this PR the compiler **runs that call while compiling**. What reaches the program is only the run-time work the methods leave:

```ts
const intent = { /* the config folded into one literal; `amount` written in where it goes */ };
const vault = Portal.intentVaultAddress(intent);
transfer(USDC, vault, amount);
Portal.publish(intent);
```

No method of the class survives, either as a call or as an inlined body. Nothing is built step by step at run time. A config the class refuses, such as one with no `refundee`, is the class's own compile error at the user's line, from a `throw` it reaches while compiling. A name a chain lacks is simply left out of that chain's module. A dotted path to nothing compares as `0`, so `if (PancakeswapV3.Factory != 0) { … }` is decided while compiling, and its arm is never compiled where the chain has no PancakeSwap V3. Any other use stays a compile error. Every path read as `0` is listed in the result's `absentPaths`, so the SDK rejects the ones no chain declares as typos.

Compiling the destination's code (the `.then(() => { … })` body, or what follows the `await`) as its own program (`program(closure, scope)`) is #551 and the PRs above it. This PR is everything the class needs short of that. The SDK side follows #551.

## Interface

What this PR adds to the compiler's surface: language forms and diagnostic codes. The compile options and the compile result are unchanged.

### Compile options and result

- **Options: nothing new.** `sauce_core::CompileOptions` / npm `compile(options)` are exactly #549's. Classes and static values arrive through the inputs that already exist: a module the program imports, or one named in `ambient` (`CompileOptions::ambient: Vec<String>` / `ambient?: string[]`), whose exported classes and static constants become globals of every module.
- **Result: one new field.**

| Rust (`sauce_core::Artifact`) | npm (`CompileResult`) | |
|---|---|---|
| `absent_paths: Vec<AbsentPath>` | `absentPaths: AbsentPath[]` | **New**, always present. Every dotted path a comparison read as `0` because it names nothing (see the language-forms table), in source order, each once. Empty for a program that names nothing it does not declare. |

```ts
interface AbsentPath {
  name: string;          // the path as written: "PancakeswapV3.Factory"
  path: string;          // its module, as `resolve` was asked for it
  start: SourcePosition; // { offset, line, column }, UTF-16 units, as in error.diagnostics
  end: SourcePosition;
}
```

Rust re-exports `AbsentPath` from `sauce_core`.
- **Removed versus the old #550.** The old head added `CompileOptions::host: Option<HostScope>`, the `sauce_core::host` module behind it, and, on npm, the `declare` callback, the `types` table and the `hostModules` list (`sauce-wasm/src/host.rs`). None of these is in this PR. The host declarations, record types, endings and `unusable` names they carried are now ordinary SauceScript classes and module constants that the SDK ships as source.

### Language forms

| Construct | Accepted | What the compiler does | Refused |
|---|---|---|---|
| `class` | At the top level, `export`ed or not, imported and broadcast by `ambient`. Members: fields (`x;`, `x = e;`), `constructor(…)`, methods, `static` methods, `[Symbol.dispose]()`, `[Symbol.toPrimitive](hint)` | Declares a class, which is a static value | Subset errors: "a class that `extends` another", "a getter or setter", "a private (`#`) member", "a `static` field", "a `static` block", "an `async` or generator method", "a decorator", "a generic class (`<T>` type parameters)", "an `abstract` class", "an `implements` clause", "an `accessor` field", "a member named by anything but an identifier, `[Symbol.dispose]` or `[Symbol.toPrimitive]`" |
| `new C(…)`, `this` | `new` of a class name in scope. `this` in a constructor, a method, or an arrow written there | Makes an instance: field initializers run in declaration order, then the constructor. `this` is the instance (the class in a `static` method), and `return this` chains | `NotAClass`, `ClassCalledWithoutNew`, `ThisOutsideMethod`, `MethodAsValue`, `UnknownMember`, `NotCallable`; subset: "`new` on anything other than a plain class name" |
| A call the compiler runs | A method or `static` method of a static receiver, reached through any member chain (`this.destination.coins[symbol].store(v)`). Also an arrow held by a name or field, and any function given an argument with no run-time form (an instance whose class converts it neither by `[Symbol.toPrimitive]` nor by `valueOf()`, an arrow, a class, `undefined`, or a literal holding one). An instance its class converts, given to a parameter annotated with a type, is converted at the call (hint `"number"`) and the function called; an unannotated parameter takes the instance and the call runs while compiling | Runs the body while compiling. Arguments are evaluated once, in order; one that is a local, a constant or a fixed context read (`ctx.self()`), read exactly once before the body does anything else, is read at that read, so a forwarding method is the direct call byte for byte. Run-time effects are emitted where the call stands, in source order, and the rest leaves nothing | `CompileTimeArity`, `CompileTimeCallsTooDeep` (64 deep), `CompileTimeReturnUnderCondition`, `StaticWriteUnderCondition` (also in a loop's test and update), `StaticAtRunTime` |
| Rest parameter | `m(...items)` in a method, an arrow or a function | Collects the remaining arguments into a static array, whose elements may differ in shape | `RestParameterAtRunTime` (a function called at run time); subset: "a destructuring rest parameter" |
| `for (const x of xs)` over a static array | `xs` held by a `const`, a field or a rest parameter, or an array literal written in place that holds a `new`, an arrow or a static name | Unrolls: the body is compiled once per element, with `x` bound to it | `StaticUnrollTooLong` (past 256), `StaticLoopJump` (`break` or `continue`) |
| A known key | `obj[key]` on a static object or array, `key` a string or number literal or a `const` bound to one. `===`/`!==` between two such strings, or against `undefined` | Reads the member it names, or decides the comparison | `StaticIndexNotKnown` |
| An arrow function as a value | `x => e`, `(a, ...rest) => { … }`, passed, stored in a field and called (`body()`, `this.body()`); a `const` arrow may name itself (`const walk = () => … walk() …`) | Runs in place, in the function it was written in, against the names in scope where it was written; one written at module scope reads no function's locals, so any function may call it. An expression body that is a statement-only builtin (`() => evm.sstore(k, v)`) is that statement | `ClosureOutsideItsFunction`, `NotCallable`; subset: "an `async` arrow function", "a default parameter value", "a destructuring parameter (bind a plain variable instead)" |
| `.catch(…)` | On a static receiver (an instance, or a method chain on one, such as `….then(() => { … }).catch((e) => { … })`): any arrow, concise or block, with or without a parameter. On a run-time external call: the built-in try-call's handler, as before | On a static receiver, the value's own `catch` method, run by the compiler like any other method. The built-in try-call applies only when the receiver is a run-time call, and its output is unchanged | `CatchHandler`: a handler the built-in form cannot take (a parameter, a concise body, anything but one argument, or a `return`/`break`/`continue` leaving it), refused once the receiver is known to be an external call |
| A contract import as a value | `import IPool from "./pool.json"`, then `{ Pool: IPool }`, a field, a module constant; `NS.Pool.at(addr)`; `Shop.at(a).at(b)`, `Stores.Main.at(other)` | An ABI at no address: `.at`/`.view`/`.lib` binds it, and on a binding rebinds its ABI to another address | `StaticAtRunTime` until bound |
| A `const` of a static value | `const coins = this.dest.coins` (a static value made elsewhere); `const xs = []`, or a rest parameter given nothing | The same value under a second name, its reads folded — only a non-empty literal written in the initializer gets a run-time copy. An empty static array has length `0`, unrolls nothing and encodes as an empty array | `EmptyArrayLiteral` only where a run-time array needs an element type (`let xs = []`) |
| `[Symbol.dispose]()` | A class member | Runs once, by whoever made the instance: the expression statement that made it, when it ends; the `const` whose initializer made it, including instances in an array or object literal it binds, at the end of its block, last made first; a `for … of` over a literal written in place, when the loop ends. A `const` that only names an object never takes it over | — |
| `[Symbol.toPrimitive](hint)`, `valueOf()`, `toString()` | Class members | `==`/`!=` runs `[Symbol.toPrimitive]("default")`, else `valueOf()`. Arithmetic, relational operators and any run-time position, an annotated parameter included, run `[Symbol.toPrimitive]("number")`, else `valueOf()`. `toString()` is appended to an `UnknownMember` message as the explanation | `StrictObjectComparison` (`===`/`!==` between an instance and a run-time value), `StaticAtRunTime` (none defined, at a run-time position) |
| A throw while compiling | `throw new Error("…")` or `throw "…"` reached unconditionally in a call the compiler runs, also when the caller's call stands under a run-time `if` or loop | A compile error whose message is the thrown text, located at the user's outermost call, with the `throw` as a second label | `Thrown` |
| A static module constant | `export const X = new C(…)`, `{ F: Abi.at(0x…) }`, an array of statics, an arrow, a string or `hex` constant, a literal holding strings or nested literals (`{ a: 1, t: { x: 2 } }`), or the name of one of these in its module, or a path into it (`export const B = A`, `const P = NS.Pool`); read through an import or `ambient` | Made the first time a function reads it, then frozen. One nothing reads is never made, so a 2,000-item ambient module adds about 4–5 ms (release) and no bytes | `StaticConstantWritten`, `StaticConstantAtRunTime`, `StaticConstantAnnotated`, `DefineOverridesStatic`, `ModuleConstCycle`. A plain value keeps #549's `ModuleConstNotConstant` / `ModuleTableElementNotLiteral` |
| A dotted path to nothing | A member path whose root nothing declares (`Monkey.Jump.Big`), or a member a module constant's object lacks (`UniswapV4.Quoter`), as an operand of `==`/`!=`, or of `===`/`!==` against a number literal | Reads as the constant `0`, so the comparison decides the branch around it, and reports the path in `absentPaths` | Not a bare name: `amonut == 0` stays `UnknownIdentifier`. Any other use (a call, an argument, arithmetic, a value) stays `UnknownIdentifier` / `UnknownMember`. A comparison with `undefined`, and a path rooted at a local, a parameter or `this`, are never folded. Against a run-time value it is the constant all the same: `Monkey.Jump == x` is `x == 0` |
| `x instanceof C` | `C` a class | Decided while compiling: `true` for an instance of `C` (class identity; a class extends none), `false` for any other static value and any run-time value, which is still evaluated when it can abort or do something | `InstanceofNotClass` (the right side is not a class) |
| Decided branches | `if`, `?:`, `&&`, `\|\|`, `while` or `for` whose condition is known while compiling: a literal, a `const`, a define, a static value (by JavaScript's truthiness: `undefined` false, any object true), or a comparison over those | The way the condition rules out is never compiled, at every `-O` level. A decided `?:`, `&&` or `\|\|` may yield a static arm or operand (`this.b \|\| this.a`) | Subset: "the `??` operator" |

### Diagnostic codes

Each is the `code` of a diagnostic (`Diagnostic::code` / `error.diagnostics[i].code`), the field #549 added.

| Code | Raised when |
|---|---|
| `StaticAtRunTime` | a value with no run-time form (an instance with no primitive, a class, an arrow, `undefined`) stands where a run-time value is needed |
| `ThisOutsideMethod` | `this` outside a constructor, a method or an arrow written in one |
| `UnknownMember` | a static value has no such member; names the receiver as written, plus its class's `toString()` |
| `StrictObjectComparison` | `===`/`!==` between a static value and a run-time value |
| `MethodAsValue` | a method read without calling it |
| `NotCallable` | a call of something that is not a function |
| `ClassCalledWithoutNew` | a class called as a function |
| `NotAClass` | `new` of something that is not a class |
| `InstanceofNotClass` | `instanceof` whose right side is not a class |
| `StaticIndexNotKnown` | a static value indexed by a key only known at run time |
| `StaticPushOnConst` | `push` onto an array a `const` keeps a run-time copy of |
| `StaticWriteUnderCondition` | a write to a static value under an `if`, a loop or a `.catch()` handler entered after it was made |
| `StaticConstantWritten` | a write to a module constant's static value |
| `StaticConstantAtRunTime` | a module constant whose initializer would leave work to do at run time |
| `StaticConstantAnnotated` | a type annotation on a module constant holding a static value |
| `ClosureOutsideItsFunction` | an arrow that reads a function's locals, called outside that function |
| `CompileTimeCallsTooDeep` | calls the compiler runs nested past 64 |
| `CompileTimeArity` | a call the compiler runs passes more arguments than the callee takes |
| `CompileTimeReturnUnderCondition` | a `return` in a call the compiler runs, under a run-time condition or loop |
| `Thrown` | a `throw` the compiler reached; the message is the thrown text |
| `RestParameterAtRunTime` | a function with a rest parameter called at run time |
| `StaticUnrollTooLong` | a `for … of` over a static array of more than 256 elements |
| `StaticLoopJump` | `break` or `continue` in a `for … of` the compiler unrolls |
| `DefineOverridesStatic` | a define named like a class or a static module constant |
| `Unset` | a member read that gave `undefined` (a field nothing set) used where a value is needed, or called; names the read as written, plus the object's `toString()` |
| `CatchHandler` | a handler the built-in `.catch()` cannot take, on an external-call receiver; the message is the one the frontend gave before |

### What a host does with it

The SDK leaves a name out of a chain's module when the chain lacks it, and checks the report against every chain's names, to reject a typo:

```ts
const program = compile({
  target: "evm",
  entry: "main.ts",
  ambient: [`./chains/${chain}.ts`],   // e.g. `export const UniswapV4 = { PoolManager: … }`, no Quoter
  resolve,
});
for (const absent of program.absentPaths) {
  if (!chains.some((names) => names.has(absent.name))) {
    throw new Error(`${absent.path}:${absent.start.line}:${absent.start.column}: \`${absent.name}\` is not a name on any chain`);
  }
}
```

A class broadcast through `ambient`:

```ts
import { compile } from "sauce-compiler";

const files: Record<string, string> = {
  "main.js": `function main(to: Address, amount: Uint256) { COIN.pay(to, amount); }`,
  "coins.js": `import { pay } from "./till.js";
    export class Coin {
      constructor(address) { this.address = address; }
      valueOf() { return this.address; }
      pay(to, amount) { pay(this.address, to, amount); }
    }
    export const COIN = new Coin(0x00000000000000000000000000000000000000aa);`,
  "till.js": `export function pay(coin: Address, to: Address, amount: Uint256): void {
    log(abi.encode(coin, to, amount));
  }`,
};
const program = compile({
  target: "evm",
  entry: "main.js",
  ambient: ["./coins.js"],          // COIN is a global, with no import line
  resolve: (path) => new TextEncoder().encode(files[path.replace("./", "")]),
});
// program.bytecode is byte for byte that of `pay(0x…aa, to, amount)` written by hand.
```

## The mechanism

All of it is generic: nothing in the compiler, its errors or its tests names a chain, an intent or a token, and a non-Sauce host can use each piece unchanged. The tests use a shop, a courier and coins.

- **Static values.** A class instance, an object or array literal, an arrow function, a class and a contract binding exist while the program compiles. What they hold (constants, run-time values, strings, other static values) is kept by the compiler; only their run-time leaves reach the program. A value with no run-time form used where one is needed is a compile error: returned from `main`, stored in a run-time array, or passed to a run-time function.
- **Classes.** Module-level `class` declarations, exported, imported and broadcast by `--ambient`, with:
  - fields with or without initializers, a `constructor`, methods and `static` methods
  - `new`, `this`, `return this` chaining, and rest parameters (`send(...items)`, items of any shape)
  - `for … of` over a static array, unrolled
  - `=== undefined` on an unset field
  - a member read by a string the compiler knows (`table[symbol]`)
- **Compile-time execution, not inlining.** A call is run by the compiler when its receiver is static (a method, a `static` method, an arrow held by a name or field), or when any argument has no run-time form.
  - Arguments are evaluated once, in order, and copied when they could change, so the body reads each one as it was at the call. One computed from constants alone is bound as that constant, so a recursion on constants decides. Only a local, a constant or a fixed context read is instead read where the body first reads it, and only when nothing runs before that read and the read does not land in a literal that would keep it; anything that can abort (arithmetic, an index, a call) runs at the call even when the body drops it.
  - Statements that only touch static values leave nothing.
  - Statements with a run-time effect are emitted where the user's call stands, in source order. Inside an expression they ride an `Expr::Seq` that `eval_order` hoists.
  - A static value changes only at the run-time depth where it was made. A write under an `if`, a loop (its test and update included) or a `.catch()` handler entered since then is refused, as is a `return` under a run-time condition.
- **Arrow functions as values.** They are passed, stored in fields and called (`body()`, `this.body()`). The call runs in place, in the function the arrow was written in, against the names in scope where it was written. An arrow a module constant holds (`export const Token = (a) => new Coin(a)`) reads no function's locals, so any function may call it.
- **Disposal** (TypeScript's `Disposable`). An instance is disposed of once, by whoever made it:
  - the expression statement that made it, when the statement ends
  - the `const` whose initializer made it, including instances an array or object literal it binds holds, at the end of its block, last made first, and before a `return`, `break` or `continue` that leaves the block
  - a `for … of` over an array literal written in place, when the loop ends

  A `const` that only names an object made elsewhere (`const b = a`, `const self = this`) never takes it over.
- **Converting an instance.** Under `==`/`!=` the compiler runs `[Symbol.toPrimitive]("default")`, else `valueOf()`. Anywhere a run-time value is needed it runs `[Symbol.toPrimitive]("number")`, else `valueOf()`. A coin class whose `valueOf()` is its address compiles `COIN.pay(to, amount)` byte for byte as `pay(<address>, to, amount)`, `pay(COIN, to, amount)` likewise when `pay` annotates the parameter (the function is called, with the address; an unannotated parameter takes the instance, as in JavaScript), and `Till.at(COIN)` as `Till.at(<address>)`. `===`/`!==` between an instance and a run-time value is refused: JavaScript finds them never equal, so the error asks for `==`.
- **Errors in the class's own words.** A `throw` the compiler reaches unconditionally while running a call is a compile error with the thrown text. It is located at the user's outermost call, with the `throw` as a second label. A missing member names the receiver as written and appends the class's `toString()`, run while compiling.
- **Module constants holding static values.** Examples: `export const USDC = new Token(…)`, `export const UniswapV3 = { Factory: IUniswapV3Factory.at(0x…) }`.
  - They are made the first time a function reads them, then frozen.
  - Broadcast with `--ambient`, they are globals a program uses with no `import`. A program's own local or parameter of the same name still wins.
  - One nothing reads is never made: an ambient module of 2,000 instances costs about 4–5 ms to compile in a release build (parse about 1 ms) and no bytes.
- **Decided branches.** These are salvaged from the old #550. A condition known while compiling decides its `if`, `?:`, `&&`, `||`, `while` or `for`; the condition can be a literal, a `const`, a define, a static value (by JavaScript's truthiness) or a comparison over those. The way it rules out is never compiled, at any optimization level. A decided `?:`, `&&` or `||` may select a static arm, so `this.b || this.a` is how a class writes a default.
- **Encoding** is the engine's `ABI_ENCODE`, as before. A compile-time layout was built and then removed: ABI padding made it larger on every measured program.

The language reference has a new "Classes and Static Values" section, and its If / Else, loop, ternary and logical sections are updated. The wasm package needs no new options.

## Programs written without classes

`crates/sauce-core/tests/base_bytecode.rs` compiles 380 programs on both targets, at `-O` and `-O0`, and holds each to the bytes the compiler made before this PR (recorded from #549's head). The 380 are:
- the performance corpus
- the example programs
- the 158 router gas programs
- the deploy smoke fixture
- plain-data shapes: `const` literals read, written, aliased, indexed, encoded and passed to calls

Every one keeps its exact bytes except the two listed shapes. Those shrink because a `const` literal's field reads now fold (`objlit-fields` 49 → 39 bytes, `nested-const` 73 → 41). The `golden_bytecode` goldens shrink the same way: `collections` 155 → 131, and `compile_time_constants` at `-O0` 67 → 52, now equal to `-O`.

## Tests

- `crates/sauce-core/tests/static_values.rs`, 34 tests:
  - byte identity of builder chains against the hand-written code
  - a builder against `const order = {…}; Shop.at(shop).place(order)`
  - method calls on member chains, the coin-class equivalence, the 2,000-item ambient module
  - every refusal and its message, and decided static arms
  - reading another module's values afresh in each compile
  - dotted paths to nothing: guards that fold and drop arms that would not compile, the `absentPaths` report with its spans, and the refusals (a bare unknown name, a live use, a builder's unset field kept as `undefined`)
- On the engines, v12 (12 tests) and SVM (4):
  - disposal order and once-only disposal, including every probe from an adversarial review: returns, arrows, aliases, literal-held instances
  - loop-test work on every iteration, `const` literal aliasing, and argument order and identity
  - one payload encoded the same three ways, and value methods on fields of fields
- The wasm smoke test compiles a builder from an imported and an ambient module.
- `make ci`: 3,537 tests. `make test-conformance`: catch 19, svm 274, token 21, v12 360, erc20 11, playground 13. `make smoke`: green.

## Stack

#549 (host entry) ← **#550 (classes and static values)** ← #551 (`program(closure, scope)`: a closure compiled as a program of its own, returning `{ code, args }`).

The SDK's intent class, its per-chain ambient modules and the token class follow #551.
