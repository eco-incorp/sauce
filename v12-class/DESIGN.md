# Intents as a SauceScript class: design for the v12 stack rewrite

Status: APPROVED by the user 2026-10-05, with the four decisions below.

## The goal

The SDK writes the intent syntax as an ordinary SauceScript class in a library. It gives the
compiler no DSL object, record type, ending, `bind` or splice:

```ts
// @sauce/intents: the SDK's library (sketch)
export class Portal {
  constructor(chain) { this.chain = chain; }               // the destination chain object
  send(...reward) { return new Intent(this.chain, reward); }
}

class Intent {
  constructor(destination, reward) {
    this.destination = destination;
    this.reward = reward;                                  // [{ token, amount }, { native }]
    this.delivery = [];
  }
  refundee(to) { this.creator = to; return this; }
  deadline(t) { /* reward or route deadline, by stage */ return this; }
  receive(...delivery) { this.delivery = delivery; return this; }
  then(body) { this.body = body; return this; }
  catch(handler) { this.handler = handler; return this; }

  [Symbol.dispose]() {                                     // the statement ends: emit it
    if (this.body === undefined) throw new Error("… has no body. Finish it with .then(() => { … })");
    const body = program(this.body, this.destination.chainId);   // { code, args }
    const intent = {
      destination: this.destination.chainId,
      route: abi.encode(ROUTE, { salt, deadline, portal, nativeAmount, tokens: …, calls: [
        …transfers into the Pot,
        { target: POT, data: Pot.cook(ENGINE, body.code.concat(body.args)), value: FEE },
      ] }),
      reward: { deadline, creator: this.creator, prover, nativeAmount, tokens: this.reward },
    };
    const vault = EcoPortal.intentVaultAddress(intent);
    for (const item of this.reward) transfer(item.token, vault, item.amount);
    EcoPortal.publish(intent);
  }
}
```

A program writes `Base.Portal.send({ token: USDC, amount }).refundee(r).receive({ … }).then(() => { … })`.
The compiler RUNS the builder at compile time and emits only what is left to do at run time:

```ts
const intent = { … };          // the whole chain folded into one literal, run-time values as holes
const vault = EcoPortal.intentVaultAddress(intent);
transfer(USDC, vault, amount);
EcoPortal.publish(intent);
```

Nothing is built step by step at run time, and no builder method survives as a call or an inlined
body. Static parts of `intent` (the compiled body, Portal, prover, Pot, engine, fee) are constant
bytes; a run-time value (a measured amount, `ctx.timestamp() + 300`) is written into its slot.

## Compiler features (all generic: a non-Sauce host could use each unchanged)

1. **Static objects.** A class instance (`new C(…)`), an object literal, an array literal and a
   closure are *static values*: they exist only while compiling. A field or element may hold a
   constant, a run-time value, a string, or another static value. Static values never reach run time
   whole: storing one, returning it from `main`, or passing it to a run-time function is a compile
   error. Encoding one is allowed (see 4).
2. **Classes.** `class` with fields, `constructor`, methods, `static` methods; `new`; `this`;
   `return this`; rest parameters (`send(...items)` gives a static array, so mixed item shapes are
   fine); `for … of` over a static array (unrolled); `=== undefined` on an unset field (folds).
3. **Compile-time execution, not inlining.** A call whose receiver or arguments include a static
   value is EXECUTED by the compiler. Statements that touch only static values leave nothing behind.
   A statement with a run-time effect (an external call, a run-time computation) is emitted where the
   user's call stands, in source order. A run-time condition may not set a static field, and a
   run-time loop may not change a static value: both are compile errors.
   Decided branches (#550's `fold::decided`) are part of this.
4. **Encoding a static value.** `abi.encode(…)` of a static value, or a static value passed to a
   contract call, is encoded by the compiler: constant bytes, plus one run-time write per run-time
   leaf at an offset the compiler knows. This replaces the host's `bind` and splices.
5. **A closure as a program.** `program(closure, scope)` compiles the closure as a program of its own
   and returns static `{ code, args }`: `code` constant, `args` its captured run-time values (#551's
   captures, scalars only). Its global names resolve in `scope`, a static value the compiler hands to
   ONE host callback that returns that program's options (target, profile, ambient modules). That
   replaces `nested(site)`, `ProgramSite.receiver` and `scope: "nested"`. Calling a static closure
   (`body()`) runs it in place, so a library can wrap a body in `try { body() } catch (e) { … }`.
6. **Finalizing.** An expression statement whose value is a static object with a `[Symbol.dispose]()`
   method (TypeScript's `Disposable`) calls it when the statement ends; a `const` that holds one is
   disposed at the end of its block. This is what lets `.catch` follow `.then`, and what turns a
   missing `.then` into the SDK's own message.
7. **A `throw` reached at compile time.** A `throw new Error("…")` that the compiler reaches
   unconditionally while executing compile-time code is a compile error with that message, located
   at the user's call. A `throw` behind a run-time condition reverts at run time, as today.

## What carries over from the stack

| PR | Fate |
|---|---|
| #549 host entry (codes, suggestions, `entryParams`, closure entry) | Keep; description rewritten around the class design |
| #550 host declarations | Replaced: static objects and classes (1–4, 6, 7), with decided branches moved in |
| #551 program arguments | Replaced: `program(closure, scope)` (5), reusing #551's closure-as-program core (~1.2k lines: `Programs`, `Captures`, reach-only lowering, reports) |
| #552 try/catch | Rebased; the block form keeps #551's core; the host `Param::Handler` goes |
| #553 catch (e) | Rebased, unchanged |
| #554 await | Rebased; `await x; rest` = `x.then(() => { rest })` finds `then` on the class |
| #555 specialization, #556 args | Rebased |
| #557 follow-ups | Keep `entrySignature` and remaining accounts; drop recorded calls |

## SDK side (after the compiler)

- `@sauce/intents` is the class above. The SDK no longer declares `Portal`, `Sent`, `Received`,
  `Opened` or `Caught` types and has no `bindIntent`, sentinels or splices.
- Per-chain names become SDK-generated SauceScript modules: `export const USDC = new Token("USDC", 0x…)`
  with `class Token { transfer(to, amount) { … } balanceOf(holder) { … } }`, `UniswapV3 = { Factory:
  IUniswapV3Factory.at(0x…) }`, and `Base = { chainId: 8453, Portal: new Portal(…) }`.

## Decisions (user, 2026-10-05)

- A, finishing: **dispose at statement end.** An expression statement whose value is a static object
  with `[Symbol.dispose]()` calls it when the statement ends; a `const` holding one is disposed at the
  end of its block. `then`/`catch` only set fields; dispose emits. The SDK words a missing `.then`
  with a compile-time `throw` (7).
- B, delivery tokens: **re-resolve by symbol.** `.receive({ token: USDC })` keeps today's meaning
  (the destination's USDC). Token objects carry their symbol (a static string) and the class looks the
  symbol up in the destination chain's token table at compile time. Needs static strings and a
  computed member access with a static string key (`table[symbol]`). A raw `Token(0x…)` is used as
  written.
- C, per-chain names: **SDK-generated SauceScript modules, in this wave.** No `declare` callback and no
  host types: `export const USDC = new Token("USDC", 0x…)`, protocol namespaces as static objects
  holding contract bindings, chain objects `{ chainId, Portal }`. These are GLOBALS with no import
  (user, 2026-10-05): the SDK hands each chain's module as an `ambient` module, so `USDC` is the
  compiled-for chain's token with no `import` line, and inside `program(closure, scope)` the scope's
  ambient module makes a bare name the destination's. Ambient exports are evaluated lazily: an unused
  `new Token(...)` among 1,000+ costs nothing beyond parsing. A name a chain lacks still needs the
  `if (X != 0) { … }` guard to fold, and a live use to fail in the SDK's words: the #550 owner
  proposes the minimal generic mechanism for that.
- D, GitHub: **rewrite #550 and #551 in place** (force-push, same PR numbers). #549 keeps its code and
  gets a new description. #552–#557 are rebased onto the new #551 afterwards. The old heads are tagged
  `backup/<branch>-20261005` in /Users/er/Documents/Projects/v12-class/repo.
- Later: how `sauce intent publish` from a wallet (no program runs) gets the folded intent's bytes.

## Settled with the PR owners (2026-10-05)

- #550 internals: a value domain `Dynamic(Expr, Ty) | Static(Object | Array | Closure | Class |
  ContractBinding | Undefined)` in lowering; objects and arrays shared by reference. Only a
  static-only receiver or argument makes a call compile-time, so existing helpers called with plain
  literals are unchanged. A compile-time call runs in a child Lowerer; residual statements travel as
  `Expr::Seq`, hoisted by eval_order. Encoding: constant bytes plus one word per hole, falling back to
  ABI_ENCODE for a leaf of run-time length. Limits: 64 nested calls, 256 unrolled iterations.
- Absent names: JS ToPrimitive. `==`/`!=` run `[Symbol.toPrimitive]("default")` (else `valueOf()`) at
  compile time; scalar positions use hint "number". The SDK's `class Absent` returns 0 for "default"
  and throws its reason otherwise. A missing member is the compiler's error, with the object's
  `toString()` appended when its class defines one. `===`/`!==` between a static object and a scalar
  is refused. Tokens: `valueOf()` returns the address, and `COIN.transfer(…)` must compile
  byte-identical to today's `transfer(COIN_ADDRESS, …)`.
- #551: `program(closure, scope)`, a builtin that a user's own `program` shadows. One optional
  `programOptions(scope)` callback returns `{ target, chain, ambient, defines, optimize }`, each
  defaulting to the root's. Lexical capture: a closure captures from where it was written. Calling a
  static closure in place is #550's.
- Encoding (2026-10-06, after review): compile-time ABI layout was DROPPED. The engine's ABI_ENCODE
  encodes the folded literal in every measured case with fewer program bytes (ABI pads every head,
  offset and length to 32 bytes; the engine pushes each leaf in its shortest form). The builder still
  runs entirely at compile time, and the intent is still one inline literal.
- Guard: `tests/base_bytecode.rs` records 400 programs' bytes from base ca0302eb (both targets, -O and
  -O0). No program may grow; a program may shrink through folding (decided branches for any
  compile-time condition, folded reads of a `const` literal's fields).
- Ownership of disposal: an instance is disposed by whoever MADE it (the expression statement or the
  `const` whose initializer created it), never by an alias. An arrow's `return` disposes only what the
  arrow made. Loop tests and a `for` update are lowered under the loop's run-time condition.
- Names a chain lacks (USER, 2026-10-06, supersedes the SDK's `Absent` class): an unknown DOTTED path
  (an undeclared root such as `Monkey.Jump.Big`, or a member a static object lacks) reads as 0 as an
  operand of `==`/`!=` (and `===`/`!==` against a number), so a guard folds and its dead arm is never
  compiled. A bare unknown name stays `UnknownIdentifier` (typos of locals). Any other use of an
  unknown path stays a compile error with its code. The compile result lists every folded path with
  its span; the SDK rejects a path that exists on no chain (a typo) and words real absences per chain.
  A chain's generated module exports only what the chain has. ToPrimitive stays a generic capability.
- Wallet publish (USER, 2026-10-06): there is no offline intent hash and no second encoder. Every publish
  is a cook: a wallet-published intent is the intent file cooked on the wallet's own Pot, with the reward
  pulled by `--fund`'s machinery. `.refundee(addr)` stays REQUIRED on every intent (USER): no default,
  not even the signer's. The intent's hash and record
  are read from the Portal's `IntentPublished` log, from the rehearsal and then the receipt ("our intents
  can be dynamic"). The TS host builder returns the cook, not Portal requests and an offline hash.
- FUTURE, not now (USER, 2026-10-06): off-chain or private intents submitted straight to a solver API
  need the full intent data with no on-chain publish. When that comes, the compiler will output the
  compiled intents in its metadata (a generic way to report folded static values in the compile
  result). Until then every publish is a cook, and the hash and record come from `IntentPublished`.
- Bodies (USER, 2026-10-06): every intent body is a program cooked on the destination's Pot and pays the
  Kitchen fee, transfer-only bodies included ("we want people to do cooks and pay fee to Pot/Kitchen").
  There is no Executor-only route-call path.
- Hooks (USER, 2026-10-06): SDK #92's `.before(…)`/`.after(…)` need ONE contract call extracted from a
  closure as data. Hooks become `route.calls` run by the Executor, not cooks. Compiler: a generic builtin
  (working name `callOf(closure, scope)`) returning the static value `{ target, data, value }` for a
  closure whose body is exactly one external contract call (`X.m(…)`, `X.at(a).m(…)`, or
  `evm.call(target, value, data)` for native value). Names resolve in `scope` through `programOptions`;
  captured run-time values become run-time words in `data`; anything else is refused. It lands in the
  #557 port, replacing the old host `record: "calls"`. #92 is rewritten on the new #61 afterwards.
- Destination-only delivery tokens (USER, 2026-10-06): `.receive({ token: USDT0, amount })` works with a
  BARE symbol even when the source chain has no `USDT0`, and NO chain module carries other chains'
  symbols. The Intent class dereferences it against the destination chain. Compiler (lands in the #557
  port, beside `callOf`):
  (1) an unknown bare name passed to a call the compiler runs arrives as a static "name" value carrying
      its text; ANY other use (run time, a member, an operator) is still `UnknownIdentifier` at the
      name's own location, so typos in ordinary code fail exactly as today;
  (2) a builtin that reads another scope's global by name (working name `scopeGlobal(scope, name)`),
      resolved through the `programOptions` callback, returning that global's static value or failing
      when the scope lacks it.
  The class then resolves every delivery token on the destination: a name by its text, a Token by its
  symbol. That replaces the symbol re-resolution, with no token tables on the source. Until it lands,
  the SDK keeps `Token(0x…)` for such tokens.
- Duplicate intents (2026-10-06): the Portal does NOT reject two identical intents in one program (the vault
  is paid twice, the reward paid once). The default salt is the per-compile base salt hashed with a
  run-time per-transaction nonce (preferably transient storage, which survives a try block's DELEGATE), so
  every intent in a run is distinct, loop iterations included. An explicit `.salt(x)` is used as written.
- INTENT SYNTAX (USER, 2026-10-06; supersedes `Chain.Portal.send(...).refundee(...).receive(...)`):
  `await Optimism.hop({ reward, receive?, refundee, deadline?, rewardDeadline?, prover?, salt?, fee? })`,
  where the code after the await runs on Optimism. Items are one `{ token, amount }`/`{ native }` or an array.
  Also `.then(() => …)` without await, `.catch((e) => …)`, and try/await. "So await syntax reads naturally
  and it's obvious what's going on." SDK-only: a config object literal is a static value, and `await` is
  `.then`. `Chain.Portal` stays as the plain eco-routes namespace. #554's PR body leads with
  `await Optimism.hop({ … })`.
- Arrow arity (2026-10-07, in #553): an ARROW called in place with more arguments than it names evaluates
  the extras for their effects and drops them, as JS does for callbacks, so the SDK's `.catch` finisher
  always calls `handler(e)` whether the user wrote `() => …` or `(e) => …`. Methods and functions keep
  CompileTimeArity.
- catch (e) engine cost (USER, 2026-10-07): the revert-data copy happens ONLY when the handler binds and
  reads `e`. CATCH carries a flag (an operand bit on the same opcode, not a new opcode) that the compiler
  sets only then. Plain `.catch()` and an unread `e` cost what they cost before. Found by review:
  copying on every caught failure grew memory gas quadratically in probe loops (+17% at 1000 catches,
  out of gas past about 2300).

## Name values: allowed uses (decided 2026-10-07, #557 review)
An unknown bare name passed to a compile-time call becomes a static name value. It may only be passed as an argument,
stored in an object/array/field and read back, given to `nameOf` / `globalIn`, and tested for presence with strict
`=== undefined` / `!== undefined` (always "defined"). Every other use (truthiness, `!`, `&&`, `||`, `?:` on it,
`instanceof`, `==`/`!=`, operators, indexing, calling, `Object.keys`, annotation, capture) is `UnknownIdentifier` at the
name. `callOf`: after compile-time evaluation the closure's residual program is straight-line with exactly one external
call and no other effect (a call through a compile-time-run method or helper is fine; anything conditional is refused).
Builtins named `nameOf`, `globalIn(scope, name)`, `callOf(closure, scope)`.

## await in branches (USER, 2026-10-08)
An `await` may stand in the branches of an `if`/`else` chain when that `if` is the last statement of a body an await may
divide (recursively): each branch's remaining statements are its continuation. ONLY the ambiguous case throws: a
statement after an `if` whose branches await ("it would run on whichever chain the branch continued on"). Explicit
`.then` in branches always compiles. Implemented in #554 (v12-554r), cascaded up #555–#557.
