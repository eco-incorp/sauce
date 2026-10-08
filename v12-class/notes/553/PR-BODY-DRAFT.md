## Goal

With this PR an intent's fallback can read why its body failed. Here is a program compiled for Base, written with the SDK's intent syntax:

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
    .catch((e) => {
      // The supply was undone, so the USDC is still here. `e` is what it reverted with,
      // such as the reason its `require` gave: record it, and send the USDC on.
      log(e);
      USDC.transfer(beneficiary, amount);
    });
}
```

`hop(…)` makes an instance of the SDK's intent class. `.then` and `.catch` are its methods, and they store the two arrows. When the statement ends, its `[Symbol.dispose]()` compiles Ethereum's program as one `try` around the body, and hands the handler what the body reverted with:

```ts
// in the SDK's intent class:
[Symbol.dispose]() {
  const body = this.body;
  const handler = this.handler;
  const compiled = program(() => { try { body(); } catch (e) { handler(e); } }, this.destination.chainId);
  // … calls: [{ target: POT, data: Pot.cook(ENGINE, compiled.code.concat(compiled.args)), value: FEE }]
}
```

Ethereum's program compiles to the same bytes as this `try` written out in one closure. `e` is `bytes`: the first `min(returndatasize, 256)` bytes of what the body reverted with.

```ts
try {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
} catch (e) {
  log(e);
  USDC.transfer(beneficiary, amount);
}
```

Before this PR, the handler could not tell what went wrong: `CATCH` left `0` on the caught branch and copied nothing, and `catch` took no parameter.

The compiler knows nothing of intents. Its tests use an invented errand: a class whose `carry(body)` and `catch(fallback)` store two arrows, finished as `program(() => { try { body(); } catch (e) { fallback(e); } }, branch)`.

The same works in a program of its own, around a contract call. Here it `try`s a swap and, when the swap reverts, decodes the `Error(string)` it gave:

```ts
import IPool from "./IPool.json";

function main(pool: Address, amount: Uint256): Uint256 {
  let reason = 0;
  try {
    IPool.at(pool).swap(amount);
  } catch (e) {
    // Error(string): its selector, the message's offset (32), its length, then the message.
    // Nothing catches inside a handler, so check the shape before decoding it.
    if (
      e.length >= 68 &&
      e.slice(0, 4).toBe() == 0x08c379a0 &&
      e.slice(4, 36).toBe() == 32 &&
      e.slice(36, 68).toBe() <= e.length - 68
    ) {
      const [message] = abi.decode(e.slice(4, e.length), ["string"]);
      reason = crypto.keccak256(message);
    }
  }
  return reason;
}
```

**Merge with #552, and cut no compiler release between them.** On its own, #552 trusts whatever the account answers to `inFlightEngine()`, and some `catch` blocks don't compile there. This PR fixes both (see "Also here" below).

## Interface

What this PR adds to the compiler's surface. Everything else is unchanged.

### The language

- **`catch (e) { … }`** on a `try`, either form. `e` is a `const` of type `bytes`, written without an annotation. It holds what the `try` reverted with: the data of the `throw`, `require` or `revert` that ended a block, the revert data of a call in the block that nothing caught, or the revert data of a one-call block's call. It is cut to its first 256 bytes, and holds all of it when there are fewer.
- **`.catch((e) => { … })`**, the built-in form on an external call (`evm.call`/`evm.static`/`evm.delegate`, an ABI call): the same `e`, for that call's revert data.
- **A stored arrow handed `e`.** A class that stores a handler and runs it as `catch (e) { handler(e); }` binds the arrow's own parameter to `e`: the arrow runs in place (#550), and the program is byte-identical to the written-out `catch (handlerParam) { … }`.
- **An arrow drops the arguments it does not name**, as JavaScript does for a callback. An arrow run in place with more arguments than parameters evaluates the extra ones, in order with the others and once each, and drops them. So the one finisher `catch (e) { handler(e); }` takes the user's `.catch(() => { … })` too, compiling it byte for byte as `catch { handler(); }`. An extra argument with an effect, or one that can abort (`x + 1` can overflow), still runs. A method or a function the compiler runs still refuses an argument it does not name (`CompileTimeArity`, unchanged), so a library's own typo fails.
- **An unread `e` costs nothing.** A handler that names `e` and never reads it compiles byte for byte like one that names nothing, at both `-O` levels. The engine copies the revert data only for a handler that reads `e` (below), so a `.catch(() => { … })` or an unread `e` pays nothing for what the callee reverted with, in gas or memory.
- **A handler may leave values behind.** A `catch` block or `.catch()` handler whose last read of a local sits inside an `if`, or that runs a `for` loop, used to fail with `CatchHandlerNotStackNeutral`. Those values are now dropped at the handler's end. `catch (e) { if (…) { …e… } }` is the natural shape, and it hit that error at once.
- **Refused** (subset errors, no code, each message naming what it refuses):

  | Written | Message |
  |---|---|
  | `.catch((e, f) => { … })` | "a `.catch()` handler with more than one parameter (it takes the revert data) is not supported in SauceScript" |
  | `catch ([e])`, `.catch(([e]) => …)` | "a destructuring caught-error parameter (bind a plain variable: it is `bytes`) …" |
  | `.catch((e = 1) => …)` | "a default value for the caught error …" |
  | `catch (e: unknown)`, `.catch((e: Uint256) => …)` | "a type annotation on the caught error (it is `bytes`) …" |
  | `.catch((e) => { return 0; })` | "a `.catch()` fallback value with a parameter (it replaces the call's result) …" |

  A `.catch` on a static value is still that value's own method, taking any arrow (#550).

### What a block-form `try` does at run time

#552 reads the engine with a STATICCALL at every block and trusts the answer. Here:

- **The engine is read the first time a block runs**, into a slot, and once per run however many blocks run. A run that reaches no block never asks.
- **An engine with no code is refused.** The program reverts with the custom error `InFlightEngineHasNoCode()` (selector `0x6ab19304`) before the block runs, outside its `CATCH`, so the `catch` block does not run either. An account that cannot answer (one that is no Pot) reads as answering the zero address, and is refused the same way.
- **Under `eval`** (with #558, an `eval`'d program runs as its Pot, inside the cook that armed it), the read finds the Pot's answer, once per run as in a cook, and a block it does not reach asks nothing. The block runs static, as everything under `eval` does: one that reads succeeds, one that reverts is caught, and `catch (e)` reads why. One that writes is caught too, but the EVM halts a frame that writes in a static one and keeps all the gas it was handed: with a 1,000,000 gas limit, about 930,000 is gone before the `catch` runs.

### Compile options and result

| Rust (`sauce_core`) | npm (`compile(options)`) | |
|---|---|---|
| — | — | **No new option or result field.** |

### Diagnostics

| Rust (`Diagnostic::code`, `LocatedDiagnostic::code`) | npm (`error.diagnostics[i].code`) | |
|---|---|---|
| `CatchHandlerTooLarge` | `"CatchHandlerTooLarge"` | **Changed.** A handler that does not read the revert data is held to 254 bytes (was 255): `0xFF` is no longer a length. One that reads it may be 255. The Rust variant gains `limit: usize` beside `len` and `target_width`, and the message names it ("over the 254-byte limit"). |
| `CatchHandlerNotStackNeutral` | `"CatchHandlerNotStackNeutral"` | **Narrowed.** Values a handler leaves above its entry are dropped at its end. What remains is a handler that consumed or replaced a slot it started with, which no lowering is known to produce. |
| `CompileTimeArity` | `"CompileTimeArity"` | **Narrowed.** No longer raised for an arrow handed more arguments than it names; still raised for a method or a function the compiler runs. |

### The engine (v12-evm, MAJOR)

`CATCH` takes a flag on its own immediate, with no new opcode:

```
[call] 0xB7 <len> <handler>         a handler that does not read the revert data: it is left 0, nothing is copied
[call] 0xB7 0xFF <len> <handler>    CATCH_READS: on failure the handler is left the first min(returndatasize, 256)
                                    bytes of the revert data, as BYTES (CAUGHT_RETURNDATA in Calls.huff)
```

The compiler emits the second form only for a handler that reads `e`. `0xFF` is therefore no longer a length: a plain handler is at most 254 bytes, a marked one 255. The caught branch of `CALL`, `STATIC` and `DELEGATE` is unchanged from 1.2.0: it pushes `0` and copies nothing, and only a marked `CATCH` replaces that `0`.

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
    : program(() => { try { body(); } catch (e) { handler(e); } }, this.destination.chainId);
  // … Pot.cook(ENGINE, compiled.code.concat(compiled.args)) as the route's last call
}
```

`.catch((e) => { … })` and `.catch(() => { … })` both go through that one finisher.

## How it works

### The engine stages the revert bytes (v12-evm)

- **Before:** a call whose failure a `CATCH` took pushed `0` and copied nothing, so a handler could not learn why the call failed.
- **Now:** the same, unless the `CATCH` is marked `CATCH_READS`. A marked `CATCH`, on the failure path, copies the bounded prefix of the revert data to the frontier, commits it, and replaces the `0` with a `BYTES` descriptor over it. Nothing calls out between the failed call and its `CATCH`, so the returndata buffer is still the callee's.
- **Unchanged:** the call handlers; the success path; the uncaught failure, which still bubbles the whole revert; and the peek order from AUDIT_FINDINGS #4 (the peek still comes before any staging, and `RETURNDATA_LEN` stays zero on the caught branch).
- **Why a flag:** copying on every caught failure, read or not, grows the frontier by 256 bytes a failure, which is never reclaimed, so a loop of caught failures pays quadratically for a copy nobody reads (the review measured +17% over 1,000 iterations, and 2,300 running out of gas in a 5M limit). Marked, only the handlers that read the revert data pay for it. A plain `CATCH` pays one compare-and-branch on its immediate, 22 gas.

**Why at most 256 bytes (ExcessivelySafeCall).** The callee chooses how wide its revert is. If the engine copied all of it, a hostile callee could spend the caller's gas and memory on a payload nobody reads (a returndata bomb), choose where the heap frontier lands, or push the frontier into the guard, which aborts the program and cannot be caught. So the engine copies `min(returndatasize, 256)`, ExcessivelySafeCall's `maxCopy`. `CATCH` has no operand to carry a per-call bound, so the bound is a fixed engine constant. 256 bytes hold a selector and seven words, or an `Error(string)` whose message is up to 188 bytes. A longer message arrives cut, and decoding it would revert, which is why the example checks the shape first: nothing catches inside a handler. A callee reverting with 1 MB costs the catching program what a 256-byte revert does, plus the callee's own memory expansion.

### The compiler binds `e`

- `try { } catch (e) { }` and `.catch((e) => …)` declare `e` (const `bytes`) in the handler's scope and assign it `Expr::Caught` first. Codegen implements `Expr::Caught` as a DUP of the slot `CATCH` leaves on top on the failure path. That slot stays for the `DROP` after the handler, on both paths.
- `Expr::Caught` is a total leaf to `dead_store`, which is why an unread `e` costs nothing.
- `Codegen::try_call` marks the `CATCH` (`CATCH_READS`) when the handler reads `Expr::Caught` outside any nested handler, whose revert data is its own `CATCH`'s. An unread `e`'s binding is gone by then, so its `CATCH` is unmarked. `catch_length` holds a plain handler to 254 bytes and a marked one to 255.
- `Codegen::try_call` drops what a handler leaves above its entry at its end, inside the handler, as an `if` arm drops its own. A handler that reverts keeps the entry stack.
- An arrow run in place drops the arguments past its parameters (`Callee::arrow`, read by `statics::frame`'s `bind_parameters`). `execute` settles every argument before the body runs, so a dropped one has already been evaluated, and one that is a plain local leaves nothing.
- The frontend's `check_caught_param` holds the parameter to one plain name. For `.catch()`, the refusal is raised once the receiver is known to be an external call (`builtin_catch_handler`), since on a static value `.catch` is the value's own method.

### The engine read (`lower/engine.rs`)

- Each block runs `if (!engine) reader();` before its delegate call. `reader` is one function a program with a block gets after its declarations. It reads the answer with a caught STATIC, then checks the answer has code.
- `engine::settle`, after unrolling and at both `-O` levels, drops each ask that an ask before it in the same statement list (or one around it) already answered: sequential blocks, an unrolled loop's copies, a `catch` after its block. It also makes the entry's first ask, before any call, the read itself, which leaves the reader uncalled.
- The slot's prologue initializer is a constant zero, one statement per global, so the prune still drops an unread `let`'s initializer after it.
- A block in a function nothing calls adds no read: the reader is never called, so it is never emitted.

## Release: MAJOR

This is a **MAJOR v12-evm release** (1.2.0 → 2.0.0). `engine/STABILITY.md` and the release footer in `.releaserc.js` make an opcode "given different behaviour" a major bump, and `CATCH`'s encoding changes: a first immediate of `0xFF` used to be a 255-byte handler's length and now marks a handler that reads the revert data, which a marked `CATCH` leaves where every `CATCH` left `0`. A program built with V12Saucer or by hand whose `CATCH` skips a handler of exactly 255 bytes now misreads it; every other `CATCH` behaves as before, `0` and no copy included. V12Saucer's `CATCH` now refuses a 255-byte handler.

The marker is on the branch: this repository squash-merges with the branch's commit messages as the body, and the commit `docs(v12-evm): record the caught branch's revert data as an incompatible change` ends with the `BREAKING CHANGE:` footer. That commit also adds the change to `STABILITY.md`'s list of incompatible changes. The squash commit touches the compiler's sources too, so it majors the compiler as well. To major only the engine, land the `feat(v12-evm)` commit on its own with a `!` first, and delete the footer from this PR's squash body. Which release to take is the user's call; the footer stays until then.

`release-compiler.yml`'s `REQUIRED_ENGINES` (#523) gains `v12-evm@2.0.0 v12-evm/engine/handlers/Calls.huff ^#define[[:space:]]+constant[[:space:]]+CATCH_READS[[:space:]]*=[[:space:]]*0xFF`: `catch (e)` output needs that engine, and the pattern matches nothing in v12-evm 1.2.0, so the compiler cannot publish first. The SDK pairs the engine release with a new compiler row in `releases.json`.

## Tests

- **forge**
  - `V12CaughtRevertData.t.sol` (new), both forms through CALL, STATIC and DELEGATE. Marked: revert data shorter than the bound, at it, one past it, far past it, and empty; a 1 MB returndata bomb; the handler run over the copy; both operand bytes and the body skipped on success; gas by size. Unmarked: the handler is left `0` whatever the callee reverted with, and a 4 KB revert costs what an empty one does but for the callee's own memory.
  - `V12ScratchIsolation.t.sol`: unmarked, the frontier stays where it was (as in 1.2.0); marked, it moves by the bounded copy only, stays clean above, and an `abi.encode` after it is canonical.
  - `V12DescriptorCeiling.t.sol`: a wide revert stays catchable, by either form.
- **sauce-core**
  - `try_catch.rs`: `catch (e)` binds `bytes` in both forms and `e + 1` is refused; an unread `e` is byte-identical to no `e` (block, one-call, `.catch()`); a program carries one engine read for each place the slot may first be filled from (one, three, a function's and the entry's blocks, arms, loops, a `catch`), none for a one-call block or a block nothing reaches (entry module or import, both `-O` levels), and an unread `let` after the engine's slot keeps its initializer pruned; **a class storing `(why) => { … }` with its `catch` method, finished as `catch (e) { fallback(e); }`**, is byte-identical to the written-out `catch (why)`, program and the code around it; the same finisher with `() => { … }` is byte-identical to the `catch { fallback(); }` finisher.
  - `static_values.rs`: an arrow handed two extra calls runs both once, in order, byte-identical to the calls written out; an extra constant leaves nothing; a method and an arrow-taking function still refuse an extra argument (`CompileTimeArity`).
  - `catch.rs`: handlers that leave a `for` counter, a local last read in an `if`, or an `e` read only in a branch compile.
  - frontend: every parameter refusal above.
  - `try_catch.rs`: the Hop library's finisher `try { next(); } catch (e) { handler(e); }` compiles two and three deep, handlers reading `e` at some depths; with handlers that name nothing, every program is byte for byte the `catch { handler(); }` finisher's; one hop with `(why) => { … }` is byte for byte the `try … catch (why)` written out by hand.
  - `catch.rs`: only a handler that reads the revert data marks its `CATCH` (a read of `e`, one under an `if`, one passed to a nested call), not one that names nothing, an unread `e`, or an outer handler around a nested `catch (e)`; the 254- and 255-byte limits.
- **sauce-cli conformance** (the real engine under revm)
  - `catch_conformance`: `.catch((e) => …)` reads the length and keccak of `e` for 0, 4, 68, 255, 256, 257, 4096 and 65535 bytes at both `-O` levels; skipped on success; an `Error(string)` decoded; an unread `e` in a loop of caught failures; the value form unchanged; leftovers dropped on both paths; 500 caught 256-byte reverts under a handler that never reads them cost what 500 empty ones do but for the callee's own memory, while a handler that reads them pays for its copy.
  - `try_conformance`: a block's `throw`/`require` data, empty included; a call in a block reverting with up to 4096 bytes; a one-call block's and a raw call's revert data; the reference's guarded decode against a well-formed message, a custom error and a cut one; captures of every kind in order; a Pot answering a codeless engine and the zero address; a run that reaches no block asking nothing; every block delegating whichever ran first, at both `-O` levels; **the class's program**, cooked, with each fallback shape: the body's write stands on success; on revert `(why) => …` reads the five bytes of `"short"`, and `() => …` runs without them.
  - `v12_conformance`: a closure's program run with `eval`, on #558's engine: a block not reached (11), one that reads (11), one that reverts (12), two blocks (16), `catch (e)` reading "short" (15), each under 100,000 gas, and a write caught (12) after about 930,000 of a 1,000,000 gas limit is gone; an arrow handed two extra calls runs each once, in order.
- **config**: `compiler-engine-releases.test.cjs` holds the new `REQUIRED_ENGINES` line to this tree's `Calls.huff` and to v12-evm 1.2.0's.
- **wasm smoke**: `catch (e)` compiles through the package, and an unread one is byte-identical to none.

Local at 44c42d89 (#552's final 8600a4c3 merged in): `try_catch` 23/23, `closure_programs` 63/63, `base_bytecode` green; at 3d637a04 `make ci` 3,642 passed, 0 failed; at d0ccadf7, the same code without the nested test below: `make test-conformance` 735 passed, 0 failed; `make smoke` 85 ok; `forge test` in `v12-evm` 1,427 passed, 0 failed, 6 skipped; `compiler-engine-releases.test.cjs` 10/10 (at 6b9ea638, unchanged since). `tests/base_bytecode.rs` is green: no base program changes.

### Gas

The engine, warm, one caught CALL in a program whose callee reverts with N bytes (`test_caughtRevert_gasBySize`; 1.2.0 measured the same way on #552's engine):

| revert data | 1.2.0 | here, handler does not read it | here, handler reads it |
| ---: | ---: | ---: | ---: |
| 0 B | 9,906 | 9,928 (+22) | 10,133 |
| 32 B | 9,911 | 9,933 (+22) | 10,422 |
| 68 B | 9,915 | 9,937 (+22) | 10,466 |
| 256 B | 9,934 | 9,956 (+22) | 10,595 |
| 1,024 B | 10,012 | 10,034 (+22) | 10,679 |
| 64 KB | 24,254 | 24,276 (+22) | 24,928 |

A handler that does not read the revert data pays 22 gas for `CATCH`'s check of its immediate, whatever the callee returned. One that reads it pays for its copy, which grows up to the bound and then stays flat. The 64 KB row includes the callee's own memory expansion in every column.

The review's loop, `.catch(() => { fails = fails + 1; })` (or an unread `(e) =>`, the same bytes) over a callee reverting 256 bytes, in a 5M gas limit:

| iterations | #552's engine | copying every caught failure (the reviewed d7875111) | here |
| ---: | ---: | ---: | ---: |
| 1,000 | 1,977,857 | +17% (review) | 1,999,857 (+22,000) |
| 2,000 | 3,923,833 | +25% (review) | 3,967,833 (+44,000) |
| 2,300 | 4,508,388 | out of gas (review) | 4,558,988 (+50,600) |

Every iteration costs the same 22 gas more; the frontier no longer grows. The same loop reading `e` costs 2,694,128 for 1,000 iterations, the price of 256 bytes copied each time. (Measured on this branch's engine and on #552's, both on the merged `main`.)

## Also here: #552's open items

- **The engine address is guarded** (above): an answer with no code reverts `InFlightEngineHasNoCode()` before the block, where #552 would skip the block silently.
- **The engine is read when a block first runs, once per run.** Each block runs `if (!engine) reader();`, and the reads a run cannot need are settled away. Against #552's STATICCALL at every block, measured on the engine behind its Pot, each block `try { evm.sstore(k, x); require(x > 1); } catch {}`:

  | blocks run | #552 | here | Δ gas | bytes, #552 → here |
  | ---: | ---: | ---: | ---: | ---: |
  | 1 | 65,136 | 67,196 | +2,060 | 123 → 192 |
  | 2 | 100,438 | 100,166 | −272 | 222 → 276 |
  | 4 | 171,080 | 166,047 | −5,033 | 420 → 444 |
  | 8 | 312,298 | 297,826 | −14,472 | 816 → 780 |
  | 0 (the only block is in an untaken branch) | 31,683 | 33,160 | +1,477 | 131 → 220 |

  A run pays the read once, plus the code check, the caught read's fallback word and the slot, so one block costs about 2k more and every further block about 2.2k less. A block in a function nothing calls adds no read: the reader is never called, so it is never emitted.
- **A handler may leave values behind** (above): #552's `catch` blocks with a `for` loop or a branch-read local compile.

### Rebased onto the class design

`e` on a host handler (`Param::Handler`, `ClosureParameter`, `guarded_main`'s parameter, the host-handler tests) is gone with #550/#551's host API, and so is the `View::Constant` fold of a host-bound scalar. The SDK's `.catch(handler)` is a class method that stores the handler, and its finisher writes `catch (e) { handler(e); }` itself.

## Meeting main

This PR was rebased onto #552's merge of current `main` (through #551 and #549), which carries #558, #559, #561 and #523. What changed for it there:

- **#558 runs `EVAL` through `Pot.eval`.** An `eval`'d program now runs as its Pot, inside the cook that armed it, so the lazy engine read finds the Pot's answer there and a block-form `try` runs, where it used to revert `InFlightEngineHasNoCode()` after the engine called itself out of gas. Re-measured on the engine and rewritten: the reference's `eval` bullet, the builtins reference's `eval` paragraph, `compiler/CLAUDE.md` and `lower/engine.rs`, and the `eval` conformance test, now `a_program_run_with_eval_reads_its_engine_from_the_pot_on_v12` (results under Tests). The measurement found one cost, which #552's text now states too: a block that writes under `eval` is caught, but the EVM keeps all the gas it was handed.
- **#523's `REQUIRED_ENGINES`.** `release-compiler.yml` gains `v12-evm@2.0.0 v12-evm/engine/handlers/Calls.huff ^#define[[:space:]]+constant[[:space:]]+CATCH_READS[[:space:]]*=[[:space:]]*0xFF`: `catch (e)` output needs the engine that reads `CATCH_READS`, which no released engine does. The ctx.blobBaseFee() line stays.
- **#561's `STABILITY.md` sections.** This PR's "Incompatible changes since 1.0.0" section now follows #561's "Approved v1 exception" and "Opcodes that run a chain's instruction". `Runtime.huff`'s tail-commit count merged as is: `main` has the same 22 sites in `handlers/`, and this PR adds the 23rd.
- **The stub Pot.** #552's stub answers `inFlightEngine()` with the engine it arms while a program runs; `pot_answering(engine)` arms another address, for the codeless-engine tests.

## Stack

`main` ← #549 host entry ← #550 classes and static values ← #551 `program(closure, scope)` ← #552 `try`/`catch` ← **#553 (this PR)** ← #554 `await` ← #555 specialization ← #556 `args` ← #557 follow-ups.

## SDK side

`@sauce/intents`' finisher compiles `program(() => { try { body(); } catch (e) { handler(e); } }, destination)`, so `Optimism.hop({ … }).then(cb).catch((e) => h)` runs `try { cb } catch (e) { h }` on Optimism. The SDK pairs v12-evm 2.0.0 with the compiler release that carries this in `releases.json`.

BREAKING CHANGE: v12-evm's CATCH reads a first immediate of 0xFF (CATCH_READS) as marking a handler that reads the revert data, its length in the byte after, where it read a 255-byte handler length; a marked CATCH leaves a BYTES descriptor of the first min(returndatasize, 256) bytes of the revert data where every CATCH left 0.
