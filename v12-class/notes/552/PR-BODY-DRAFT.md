## Merge with #553, and cut no compiler release between them

#552 is not releasable on its own. Two things it leaves open are fixed in #553:

- **An engine address with no code skips the block silently.** Here a block-form `try` DELEGATEs into whatever the running account answers to `inFlightEngine()`, unchecked. A delegate call to an address with no code succeeds having run nothing, so the block is skipped and its `catch` never runs. #553 checks the answer when a block first runs, and reverts with `InFlightEngineHasNoCode()` before the block.
- **Some `catch` blocks don't compile.** A `catch` block that leaves a value above its entry, such as a `for` counter or a local last read inside an `if`, fails here with "this `.catch()` handler leaves values behind that outlive it". `.catch()` handlers already had this limit. #553 drops those values at the handler's end.

So merge the two together, with no compiler release cut from `main` between them.

## Goal

This PR lets an intent fall back on its destination instead of failing the fill. Here is a program compiled for Base, written with the SDK's intent syntax:

```ts
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum.hop({
    reward: { token: USDC, amount },
    receive: { token: USDC, amount },
    refundee: refundTo,
  })
    .then(() => {
      USDC.approve(AaveV3.Pool, amount);
      AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
    })
    .catch(() => {
      USDC.transfer(beneficiary, amount);
    });
}
```

Under the class design, `hop(…)` makes an instance of the SDK's intent class, and `.then` and `.catch` are its methods, which store the two arrows. When the statement ends, its `[Symbol.dispose]()` compiles Ethereum's program as one `try` around the body:

```ts
// in the SDK's intent class:
[Symbol.dispose]() {
  const body = this.body;
  const handler = this.handler;
  const compiled = program(() => { try { body(); } catch { handler(); } }, this.destination.chainId);
  // … calls: [{ target: POT, data: Pot.cook(ENGINE, compiled.code.concat(compiled.args)), value: FEE }]
}
```

Ethereum's program compiles to the same bytes as this `try` written out in one closure. What the two arrows read of `main` (`amount`, `beneficiary`) arrives as its argument words:

```ts
try {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
} catch {
  USDC.transfer(beneficiary, amount);
}
```

The `try` block is a program of its own. It is DELEGATEd into the engine already running the Pot, under the existing `CATCH`. If the supply reverts, the approve is undone with it, the delivered USDC goes to the beneficiary, and the fill still succeeds. The delegate frame runs inside the one paid cook, so there is no second Kitchen fee.

Before this PR, a reverting body reverted the solver's fill, and the reward stayed escrowed until it was refunded. SauceScript had no `try` statement, only `.catch()` on a single external call.

The compiler knows nothing of intents. Its tests use an invented errand: a class whose `carry(body)` and `catch(fallback)` store two arrows, finished as `program(() => { try { body(); } catch { fallback(); } }, branch)`. A `.catch` on a static receiver is the class's own method (#550), as the SDK writes it.

## Interface

What this PR adds to the compiler's surface. Everything else is unchanged.

### The language

`try { … } catch { … }`, on the EVM. Its semantics:

- **A block whose one statement is a call `.catch()` catches** compiles to that call under `CATCH`, byte-identical to `<call>.catch(() => { … })`. The calls are `evm.call`/`evm.static`/`evm.delegate`, `C.at(a).m(…)` / `.view(a)` / `.lib(a)` with `C` a bound contract, and `c.m(…)` with `c` a contract-bound local. Its arguments are evaluated in the program's own frame, before the call.
- **Any other block** is compiled as a program of its own, and runs as `CATCH(DELEGATECALL(engine, <block program> ++ <capture words>))`:
  - `engine` is what the running account answers to `inFlightEngine()` (selector `0x9fd004e1`), read with a STATICCALL at the `try`.
  - The block's program compiles in the options of the program it is written in. The compile's `contracts`/`inlineContracts` bind in the compile's entry module wherever the block's program loads it, as for a closure's program.
  - What the block reads of the code around it is one 32-byte big-endian word per run-time scalar, read at the `try`, in the order the block first reads them, one word per variable however many names reach it. Values the compiler knows are rebuilt in the block's program, as for `program()`. In a method the compiler runs, that includes `this`.
- **The frame runs as the program's account.** `ctx.self()` reads the same in the block as around it, and a test runs that on the engine. Nothing else about the frame's context is promised: the block is a program of its own. The frame's payload is its own: inside the block, `ctx.msgData()` is the block program's payload (its code followed by its captured values), as in any program compiled on its own. Read the program's calldata before the `try` if the block needs it; a word of it reaches the block as a capture. The one-call form and the `catch` block run in the program's frame and read the program's payload.
- **On success** the block's effects stand and the `catch` block is skipped. **On revert** everything the block did is undone, and the `catch` block runs in place. It may read and assign the program's variables, under a `.catch()` handler's rules.
- **A module `let`** the block writes is the block frame's own copy. That write is refused wherever code after the block reads the frame, and allowed in a `try` that is the last statement of a program's `main` with no disposal pending (see below).
- **A block-form `try` needs an account to run as.** That means a cook, a program delegated into the engine, or a program run with `eval`, which (since #558) re-enters as the Pot inside the cook that armed it, so the Pot answers `inFlightEngine()` there too. Under `eval` the block's frame is static, as everything there is. A block that reads runs and one that reverts is caught, each costing what it ran. One that writes state is caught too, but the EVM halts a frame that writes in a static context, and that halt keeps ALL the gas the block's frame was handed (63/64 of what was left): with a 1,000,000 gas limit about 930,000 is gone before the `catch` block runs, and with 10,000,000 about 9,250,000 (measured on the engine). An account that does not answer `inFlightEngine()` with the engine running it (anything but a v12 Pot) cannot run a block-form `try`; a host that runs Sauce bytecode outside one must answer it. A block of one external call runs anywhere.

### Compile options and result

| Rust (`sauce_core`) | npm (`compile(options)`) | |
|---|---|---|
| — | — | **No new option or result field.** |
| `Artifact::programs` | `result.programs` | **Unchanged.** A `try` block's program is part of the program it is written in and is never reported: it takes no `id` and adds nothing to a nested program's `path`. |

### Diagnostics

| Rust (`Diagnostic::code`, `LocatedDiagnostic::code`) | npm (`error.diagnostics[i].code`) | |
|---|---|---|
| `TryBlockAssigns` | `"TryBlockAssigns"` | **New.** The block assigns something of the code around it: a parameter, a local (itself, or through an arrow it runs, which reads the name where the arrow was written), a field or element of an object or array it reads (named by the path it read it by, `order.box`, `this`), or a module `let` the frame after it reads. Also raised for a write in a body the compiler ran inside the block. Where #551 says `CapturedAssignment` for a closure's program, a block says this. |
| `TryBlockAssignsThrough` | `"TryBlockAssignsThrough"` | **New.** A function the block calls, at any depth, assigns a module `let` the frame after it reads. The message names the function and the `let`. |
| `TryBlockCaptureRefused` | `"TryBlockCaptureRefused"` | **New.** The block reads a value its frame cannot be given, such as a run-time `bytes` or an array of run-time length. |
| `TryBlockContainsItself` | `"TryBlockContainsItself"` | **New.** The block calls back into the function holding it, directly or through another function, around the same arrows. A block's program is keyed as #551 keys a closure's: the block and every arrow function among what it captures. So a library's `try { next(); }` compiled again inside the `next` of another of its instances is another program and compiles. |
| `TryBlockFailed` | `"TryBlockFailed"` | **New.** The block's program lowered but failed in the back half (codegen). An error located inside the block keeps its own code. |
| `UnavailableOnTarget` | `"UnavailableOnTarget"` | Existing code, now also for `try`/`catch` on the SVM. |

Subset errors carry no code, as before: `finally`, a `try` with no `catch`, a `catch (e)` parameter, and a `return` or an outer `break`/`continue` in either block. Each message names what it refuses: "a `return` in a `try` block is not supported in SauceScript".

### What the SDK does with it

```ts
// @sauce/intents (sketch): `Ethereum.hop({ reward, receive, refundee })` makes one of these
then(body) { this.body = body; return this; }
catch(handler) { this.handler = handler; return this; }
[Symbol.dispose]() {
  const body = this.body;
  const handler = this.handler;
  const compiled = handler === undefined
    ? program(body, this.destination.chainId)
    : program(() => { try { body(); } catch { handler(); } }, this.destination.chainId);
  // … Pot.cook(ENGINE, compiled.code.concat(compiled.args)) as the route's last call
}
```

## How it works

`try { … } catch { … }` is built on the existing `CATCH`, following Solidity's model: `try` is an external call, and the `catch` block runs in place when that call reverts. There is no engine change and no new opcode.

### The two forms

- **A block of one external call** is that call, caught exactly as its `.catch()` is, and compiles byte-identical to the `.catch()` spelling. This is Solidity's `try other.f()`. The calls are the ones `.catch()` catches: `evm.call`/`evm.static`/`evm.delegate`, a contract bound in place (`ITill.at(a).probe(…)`, `.view`, `.lib`), or a method of a contract-bound local. The form is decided from the call's shape, so nothing is lowered twice.
- **Any other block** runs in a frame of its own:
  - It compiles as a program of its own through #551's closure-as-program core (`Programs::compile_block`, `frontend::block_main`). It compiles in the options of the program it is written in: the same target, chain, ambient modules, defines and `optimize`. The compile's `contracts` reach it as they reach a closure's program. The host's `programOptions` is not asked.
  - What it reads of the code around it arrives as its program's arguments, read where the `try` stands. These are the same captures a closure's program takes (#551's `closure_names`, over the scope at the `try`): each run-time variable is one word, and a value the compiler knows is rebuilt. That includes another arrow function, which is how `try { body(); }` runs the user's arrow, and the method's `this` when the `try` is in a method the compiler runs.
  - That program is DELEGATECALLed into the engine running the program, wrapped in `CATCH`. The frame runs as the same account, so the block's effects stand when it succeeds and are undone together when it reverts. The `catch` block then runs in the program's own frame.
  - It is a frame of the program it is written in, not a program the host asked for. So it takes no program number, adds nothing to a nested program's `path`, and is not reported in `Artifact.programs`.
  - It runs where the program runs as an account: a cook, a program delegated into the engine, or an `eval`'d program, which re-enters as the Pot through its `eval` (#558) inside the armed cook. Under `eval` the frame is static, so a block that writes state is halted, losing the gas its frame was handed, and then caught.
  - Its frame runs as the program's account, and has a payload of its own: `ctx.msgData()` in it is the block program's code followed by its captured values.

### The engine's address

The compiler reads it at run time from the running account's `inFlightEngine()`. That is one static call, about 2.6k gas. It isn't a compile-time value, for two reasons:

- A delegate call to an address with no code *succeeds having run nothing*, so a wrong compile-time address would silently skip the block.
- The account answers with the engine actually running it, so no host or profile input is needed. An answer with no code is refused only from #553 on (see the merge order above).

Why a delegate call and not a call to the account's own `cook`: a self-cook charges the Kitchen's execution fee again on every `try`, out of the account's balance.

### Module `let`s, and the last `try` of a program

The block's frame has its own copy of every module `let`, so a write to one is lost when the frame ends. Where code after the block reads the frame, such a write is refused:

- in the block itself, or a body the compiler runs there (`TryBlockAssigns`);
- in any function its program lowers, named (`TryBlockAssignsThrough`, over `ir::writes_global`).

The one exception is a `try` that is the **last statement of a program's `main`**, with no disposal pending. Nothing after it reads the frame, so the block's write is its own to lose. The `catch` block, which runs once the block is undone, sees each `let` as the code around the block holds it. This is the SDK's finisher shape, so a user's body that counts through a function compiles as it did when this was a host handler. A last `try` inside a block whose own frame is read after it stays guarded.

### Refused, each by name

- `catch (e)`: `CATCH` keeps no revert data on the caught branch, so in this PR `catch` takes no parameter. #553 adds it.
- `finally`, and a `try` with no `catch`.
- A `return`, and a `break`/`continue` of a loop outside it, in either block (`check_exits`, shared with the `.catch()` handler check).
- An assignment, from the block, to anything it captures (`TryBlockAssigns`), and the module-`let` writes above.
- A captured value the block's frame cannot be given, such as a run-time `bytes` (`TryBlockCaptureRefused`).
- A block that calls back into the function holding it, directly or through another function, around the same arrows (`TryBlockContainsItself`). Its program would contain itself. The same block around other arrows is another program, as #551 has it for closures, so nested intents whose finisher holds the same `try` compile. Recursion the block doesn't call into compiles.
- SVM, under `Feature::TryCatch`, as `.catch()` is.

### Rebased onto the class design

The host machinery this PR had is gone with #550/#551's host API: `Param::Handler`, `Body::Guarded`, `nested::Handoff`, the `HostHandler*` errors, `program_handlers.rs` and the wasm handler case. The SDK's `.catch(handler)` is now a class method that stores the handler, and its finisher writes the `try` itself, as above.

## Tests

- `sauce-core/tests/try_catch.rs` (16):
  - the one-call form is byte-identical to `.catch()` for `evm.call`, `evm.static`, `evm.delegate`, a contract bound in place, `.view`, and a contract-bound local, and reports no program;
  - the block form contains the block compiled alone as an entry, asks for `inFlightEngine()`, reports nothing, and keeps a capture out of its code;
  - a one-statement block that isn't an external call (`evm.sstore`, a file function) takes the block form;
  - a nested `try`;
  - a block in a closure's program compiles in that program's options;
  - the compile's contracts bind in the entry module only;
  - a function holding a block is never reused from the cache (a define, a helper);
  - a `try` in a method the compiler runs: a parameter, and `this`, compile byte-identical to the same value read into a `const`;
  - every refusal, including a writer called both around and inside the block, two calls below it, in the `catch` of a `try` in a function it calls, or in a body the compiler runs there; recursion through the block (recursion beside it compiles); a `bytes` capture;
  - the last-`try` rule: allowed at the end of `main` and of a closure's program; refused when a statement follows, a disposal is pending, it is in a helper, or it is the last statement of a guarded block;
  - a block's program is its statements compiled on their own: the same bytes as those statements in a closure's program, `ctx.msgData()` included;
  - a library `Hop` whose finisher compiles `program(() => { try { next(); } catch { handler(); } }, region)`, used as `new Hop(1).then(() => { new Hop(2).then(…).catch(…) }).catch(…)`, compiles two and three deep, one program per hop; a function whose `try` block calls it again is still `TryBlockContainsItself`;
  - SVM;
  - **a class that stores two arrows** with `carry` and `catch` methods, and finishes with `program(() => { try { body(); } catch { fallback(); } }, 2)`. Both arrows read `main`'s `amount`, the realistic case, and the fallback also reads `to`. The program captures `body.amount` and `fallback.to`, so `amount` is one word. It is byte-identical to the same `try`/`catch` written out in one closure, and the program around it is byte-identical too: nothing of the class survives.
- A unit test pins `ir::writes_global`: it reads a handler at any depth and the statements an expression runs first (`Expr::Seq`).
- A unit test checks that `RUNNING_ENGINE` is `keccak256("inFlightEngine()")[..4]`.
- `sauce-cli/tests/try_conformance.rs` (11) runs on the v12 runtime behind the stub Pot. The stub (one hand-assembled contract, merged with #558's) answers `gateSalt()`, `inFlightEngine()` (the engine armed in its transient slot while a program runs, zero outside one, as the real Pot does) and `eval(bytes)` from the armed engine. It is added to `EVM_INTEGRATION_TESTS`, and covers:
  - a reverting block is undone and its `catch` runs: two writes undone, the catch's write stands;
  - a succeeding block's writes stand;
  - captures (a scalar and an object's fields) and file functions;
  - a nested `try`;
  - a one-statement non-call block;
  - the one-call form against reverting and succeeding code;
  - the last-`try` rule: a block that counts through a function, on both paths;
  - a block reads `ctx.self()` as the code around it does: it runs as the program's account;
  - inside a block, `ctx.msgData()` is the block program's code and its captured word: its length is that program's plus 32, its last word the capture. Outside, it is the program's own payload;
  - a block-form `try` in an `eval`'d program runs as the Pot, static: a block that reads returns 1, one that reverts and one that writes are caught and return 2;
  - **the class's program**, cooked with its two words: the body's write stands when it succeeds; when it reverts it is undone, and the fallback's write (`to + amount`) stands.
- A wasm smoke case: a `try` block in a closure's program compiles in that program's options, and only the closure is reported.

Local at 68e4ed75 (#551's d9de0a90 merged in): `make ci` 3,631 passed, 0 failed; `make test-conformance` 715 passed, 0 failed; `make smoke` all checks pass (84 ok). At 8600a4c3 (#551's final d7dce3b4, a message-text fix, merged on top): `closure_programs` 63/63, `try_catch` 16/16 and `base_bytecode` pass; fmt and clippy are clean. `tests/base_bytecode.rs` shows no program growing; the shrinks it lists are #550's.

## Stack

`main` ← #549 host entry ← #550 classes and static values ← #551 `program(closure, scope)` ← **#552 (this PR)** ← #553 `catch (e)` ← #554 `await` ← #555 specialization ← #556 `args` ← #557 follow-ups.

`catch (e)` (#553) needs the engine to stage the callee's revert data on the caught branch (`CATCH_RETURNDATA`), so it comes with a v12-evm release.

## SDK side

The SDK's `@sauce/intents` declares `.catch(handler)` as a method that stores the handler. Its finisher compiles `program(() => { try { body(); } catch { handler(); } }, destination)`, so `Optimism.hop({ … }).then(cb).catch(h)` runs `try { cb } catch { h }` on Optimism. This lands with the SDK's move to the class design, which builds against a local compiler build of this stack and waits for a compiler release from it.
