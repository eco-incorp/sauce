Title: feat: await calls the value's then, as JavaScript does

## Goal

With this PR, the code after an SDK intent runs on its destination, written as the next lines of the program. Here is a program compiled for Base, written with the SDK's intent syntax:

```ts
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  await Optimism.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: amount * 99 / 100 },
    refundee: refundTo,
  });
  // runs on Optimism, as the intent's body
  USDC.transfer(recipient, amount * 99 / 100);
}
```

It compiles exactly as the `.then` written out, byte for byte:

```ts
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Optimism.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount: amount * 99 / 100 },
    refundee: refundTo,
  }).then(() => {
    USDC.transfer(recipient, amount * 99 / 100);
  });
}
```

`hop(…)` makes an instance of the SDK's intent class (#550), and `then` is its method: it stores the arrow. When the statement ends, the class's `[Symbol.dispose]()` compiles the arrow as Optimism's program (`program(this.body, …)`, #551), where `USDC` is Optimism's and `recipient` and `amount` become the program's arguments. The compiler runs the whole builder while compiling. What reaches Base's program is only what is left to do at run time:

```ts
const amount = USDC.balanceOf(ctx.self());
const intent = { /* the config folded into one literal: Optimism's program as constant bytes,
                    `recipient` and `amount * 99 / 100` written into its arguments */ };
const vault = Portal.intentVaultAddress(intent);
transfer(USDC, vault, amount);
Portal.publish(intent);
```

A cascade reads top to bottom. Each `await` continues the program after it, on the next chain:

```ts
await Ethereum.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: refundTo });
const arrived = USDC.balanceOf(ctx.self()); // Ethereum's USDC: this runs there
await Base.hop({ reward: { token: USDC, amount: arrived }, receive: { token: USDC, amount: arrived }, refundee: refundTo });
USDC.transfer(recipient, arrived); // Base's
```

Each branch of an `if` is a body of its own, so a program can pick its destination at run time. What follows each branch's `await` runs on that branch's destination:

```ts
if (amount > 1000000) {
  await Ethereum.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: refundTo });
  USDC.transfer(recipient, amount); // runs on Ethereum
} else {
  await Optimism.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: refundTo });
  USDC.transfer(recipient, amount); // runs on Optimism
}
```

That is each branch written with `.then(() => { … })`. Nothing may follow such an `if`: it would run wherever the branch taken continued, so the compiler asks for it to move into each branch, or before the `if`.

In a `try`, the `catch` handles what follows the `await` too, where that runs:

```ts
try {
  await Ethereum.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: refundTo });
  USDC.approve(AaveV3.Pool, amount); // runs on Ethereum
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
} catch (e) {
  USDC.transfer(beneficiary, amount); // where it failed: on Ethereum, or on Base
}
```

That is `try { Ethereum.hop({ … }).then(() => { … }).catch((e) => { … }); } catch (e) { … }`. The SDK's `.catch` compiles the handler into Ethereum's program around the body, as `.then(body).catch(handler)` does (#552, #553).

The compiler knows nothing of intents. It knows that `await x` is `x.then(…)`, as JavaScript's `await` of a thenable is. Its tests use an invented courier: a class whose `ship(parcel)` makes a shipment, whose `then` and `catch` store arrows, and whose disposal compiles them as a program of its own for the courier's region.

## Interface

What this PR adds to the compiler's surface. Everything else is unchanged.

### The language

- **`await x;`**, a statement: the statements after it in its body are a closure passed to `x.then`. It compiles exactly as `x.then(() => { <rest> });`, the same bytes at both `-O` levels. `x` must be a static value whose class has a `then` method taking an argument (an instance's method, a class's `static` one, or an arrow an object holds in a field named `then`).
- **`await` in the block of a `try`**: `try { S1; await a; S2 } catch (e) { H }` compiles exactly as `try { S1; a.then(() => { S2 }).catch((e) => { H }); } catch (e) { H }`, or `.catch(() => { H })` for a `catch` with no parameter. What `then` returns must have a `catch` method. An `await` in `S2` is continued the same way, with the same `catch`.
- **Where it may stand**: directly in `main`'s body (a script's top level included), directly in an arrow function's block body, directly in the block of a `try` standing in one of those, or directly in a branch of an `if` standing in any of these, recursively. Each branch is a body of its own: what follows an `await` in a branch is that branch's continuation, and in a `try` each branch's `await` gets the `catch`. Nothing may follow an `if` whose branches await.
- **No `async` needed.** `async` on a function declaration is accepted and changes nothing, except that `await` may then be followed by `(`, as in JavaScript.
- **Scope**: what follows an `await` is an ordinary arrow function. It reads the locals before the `await` where it is written. A `return` with a value after an `await` is refused, since its value would be that closure's and never `main`'s; a bare `return;` ends what follows, as in JavaScript, and a closure written after the `await` returns what it returns. The body is still one scope, as in JavaScript: a name declared after an `await` cannot be one declared, or taken as a parameter, before it.
- **Refused** (subset errors, each message naming what it refuses; the last two located at the `await` keyword):

  | Written | Message |
  |---|---|
  | a loop, a block, a `catch` block, a `try` nested in any of these | "an `await` inside a loop (what follows it in its body is what it continues with, so it stands directly in `main`'s body, a script's or an arrow's, or in the block of a `try` or a branch of an `if` that does) is not supported in SauceScript" (`a block`, `a `catch` block`, `a `try` block`) |
  | `if (c) { await a; } S;` (`S` any statement, a later `await b;` included) | "a statement after an `if` whose branches `await`: it would run wherever the branch taken continued. Move it into each branch, or before the `if`." Located at `S`, with the `if` as its second label |
  | `function f() { await x; }`, a method | "an `await` in a function other than `main` (only `main`'s body, a script's and an arrow's await) …" |
  | `const d = await x;`, `f(await x)`, `() => await x` | "an `await` used as a value (it is a statement, `await x;`, and the statements after it are what it continues with) …" |
  | `await x; return v;`, at any depth of the `if`s, loops and blocks after it, in `main` or an arrow (not inside a closure written there) | "a value `return` after an `await` (what follows the `await` is the closure its value's `then` takes, so the value would be that closure's, not `main`'s; a bare `return;` ends what follows) …" (`not the arrow's` in an arrow), located at the `return`, with the `await` as its second label |
  | `try { await x; } catch {} f();` | "a statement after a `try` that awaits (it would run before what follows the `await`, not once the `try` is done: move it into the `try`, or into the `catch`) …" |
  | `try { await x; } catch {} finally {}` | "a `finally` block …" (unchanged) |
  | `await (x);`, `await [x]`, `await\n x;` outside `async` | "`await` as a name (outside an `async` function, an `await` followed by `(`, `[`, an operator or a line break reads as one: write `await x;`, its value on the same line, or make the function `async`) …" |
  | an `await` in a closure entry (`entryKind: "closure"`) | "an `await` in a closure entry is not supported in SauceScript (pass what follows it to the awaited value's `then` yourself: `x.then(() => { … })`)" |

### Diagnostics

| Code | Message | Located at |
|---|---|---|
| `AwaitWithoutThen` | "`await` needs a value with a `.then(…)` method that takes a closure, and a number has none" (`an instance of `Courier``, `` `undefined` ``, `an object`, …) | the awaited value |
| `AwaitInTryWithoutCatch` | "an `await` inside `try` needs `.then(…)` to return a value with a `.catch(…)` method, and it returned `undefined`" | the `await` |
| `Redeclared` | "`b` is already declared in this scope", second label "`b` first declared here", for a name declared again after an `await` | the second declaration |

`Redeclared` is lowering's existing code, reported by the frontend for this case. The same pair with no `await` between is refused by lowering as before.

### Compile options and result

| Rust (`sauce_core`) | npm (`compile(options)`) | |
|---|---|---|
| — | — | **No new option or result field.** An awaited closure compiled as a program is reported in `programs` like any other (#551). |

### Behaviour visible through the existing interface

- None beyond the language form above. Two awaits in one `try` (a cascade the SDK wraps body and handler around at each hop) rely on #551/#552's contains-itself guard telling the same library arrow around different closures apart; that fix lands there, and this PR's tests exercise it.

### What the SDK does with it

Nothing new to call. The SDK's intent class already has `then` and `catch` methods (#550–#553), so `await Optimism.hop({ … })` works in any program the SDK compiles:

```ts
import { compile } from "sauce-compiler";

const program = compile({
  target: "evm",
  entry: "intent.sauce.ts", // `await Optimism.hop({ … }); USDC.transfer(recipient, amount);`
  resolve,
  /* the chain's options and `programOptions`, exactly as for `.then(() => { … })` */
});
program.programs; // the body Optimism runs, as for `.then(() => { … })`
```

```ts
try {
  compile({ /* … */ });
} catch (error) {
  const [d] = error.diagnostics;
  if (d.code === "AwaitWithoutThen") {
    // `await` of something that is no intent, e.g. `await USDC.balanceOf(…)`
  }
}
```

## How it works

- **A frontend rewrite, like a script's.** oxc parses an `await` in a function that is not `async` into an `AwaitExpression`, and reports it. `frontend::parse` drops exactly that report (`AWAIT_OUTSIDE_ASYNC`, its words pinned by a test). `check` places every `await` (`Place`). Then `frontend::desugar_awaits` (`frontend/awaits.rs`) rewrites the AST of the entry and of every module the compile loads into the call written out. Everything after the frontend sees an ordinary arrow in the module AST every program of the compile shares: lowering, captures, `program(closure, scope)`, and finding an arrow by where it is written (`Context::arrow`). A continuation that another program captures (the SDK's handler-wrapping arrow) is found there too. The two spellings are one AST, so they compile alike.
- **Spans keep the arrows distinct.** The continuation spans the `await` statement, and its body spans nothing at that statement's end. A `.catch` handler spans from the `await` to the end of the `catch` clause; it is a copy of the clause, desugared before it is copied. The call and its `then` span the `await` itself. That makes an await's call recognisable without any side table: it starts before its own receiver, which no written call can (`frontend::awaited`).
- **Lowering only refuses.** `call_value` lowers an await's receiver once and calls `then` as any method call on a static value is called, or raises `AwaitWithoutThen` at the value. In a `try`, `effect_statement`'s `.catch` path raises `AwaitInTryWithoutCatch` when what `then` returned has no `catch`.
- **Redeclaration** is checked in the frontend (`redeclared_after_await`): after an `await` the second declaration would sit in the continuation's own scope and shadow the first, where JavaScript refuses it.

## Tests

- `sauce-core/tests/awaits.rs` (18), against a generic courier class:
  - an `await` is its `.then` written out, byte for byte at both `-O` levels: captures, a modifier on the way, a held `const`, an empty rest, a `return` after it, a script, a shadowing block, an arrow's body, `async` with `await (x)`;
  - what follows is compiled where the class compiles its closure, in the region's scope, its captures its arguments; a write to one is `CapturedAssignment`;
  - a cascade of two awaits, and an `await` inside a `.then` arrow, equal to the nested `.then`s, with each program's path, scope and captures;
  - two awaits at the end of a body are two closures;
  - an `await` in the branches of an `if` is each branch's `.then` written out, at both `-O` levels: `if … else { if … else … }`, an `else if` chain three deep, an `if` with no `else`, a one-statement branch, two awaits in a branch, after an `await`, in a script, in an arrow, in a `try` (each branch's `.catch`), and a `try` in a branch;
  - a statement after an `if` whose branches await is refused, located, with the `if` named: a plain statement, a later `await`, an `await` nested deeper or in a `try`, inside a branch and inside a `try` block;
  - a `.catch()` handler of an external call awaits as an arrow does, written as an arrow or a `function` expression;
  - a value `return` after an `await` is refused at the `return`, naming the `await`: in an unannotated and an annotated `main`, an arrow, inside an `if` and a loop; a bare `return;` and a closure's own `return` after it compile as the `.then` form;
  - one scope: `Redeclared` at the second declaration, across one and two awaits, for a parameter, in a script, an arrow and a `try` block;
  - `try` with one and two awaits, statements before, between and after, `catch (e)` and `catch`, a `try` after an `await`, and a script: byte-identical to the written `.then(…).catch(…)` at both `-O` levels;
  - a handler keeps only the branch the program it runs in decides (a define that differs per region);
  - the handler runs in each hop's program, which captures what it reads;
  - every refusal, located: placement, value positions, functions and methods, `await` read as a name, a statement after a `try` that awaits, `finally`;
  - `AwaitWithoutThen` (a number, an instance with no `then`, `undefined`, an object literal, a `then` taking nothing, a program with no class) and `AwaitInTryWithoutCatch` (a `then` returning nothing, one returning a value with no `catch`, a `catch` taking nothing);
  - an imported module's arrow awaits as the entry does;
  - a closure entry cannot await.
- `frontend.rs`: the parser's report of an `await` outside `async` is pinned by its words.
- Engines: `v12_conformance` and `svm_conformance` run an `await` whose continuation the courier runs with `eval`: it runs to the end above five and reverts below. Both also run an `await` in each branch of an `if`: whichever branch runs continues with its own rest, which runs to the end or reverts the run. `try_conformance` runs `try { S1; await …; S2 } catch (e) { H }` on v12: the block's part stands while the handed-over program fails and is handled there (reading "small"), and a failure in the block's part is the block's own `catch` (reading "one").
- `smoke.mjs`: an `await` compiles to the same bytes as `.then` written out through the wasm package.
- Gates at 1d3406c8 (on the merge of #553 701dccb4): `make ci` (3662 passed, 0 failed, 2 ignored), `make test-conformance` (740 passed, 0 failed), `make smoke` (all 86 checks, the new one included).

## Stack

main ← #549 host entry ← #550 classes and static values ← #551 `program(closure, scope)` ← #552 try/catch ← #553 catch (e) ← **#554 await** ← #555 specialization ← #556 args ← #557 follow-ups.

## SDK side

The SDK's intent class needs nothing for `await`: its `then` is the method `await` calls. The skills and docs can teach `await Chain.hop({ … })` as the way to continue on a destination, with `.then(() => { … })` as its written-out form.
