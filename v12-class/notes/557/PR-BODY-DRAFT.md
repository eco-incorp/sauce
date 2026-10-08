# feat(compiler): callOf, undeclared names and globalIn, Object.keys, getters, entrySignature, remaining accounts anywhere, a module cache


## What it enables in the SDK

**A delivery token the source chain does not have.** Base has no `USDT0`; the destination does.

```ts
await Base.hop({
  reward: { token: USDC, amount },
  receive: { token: USDT0, amount: delivered },
  refundee: owner,
});
USDT0.transfer(recipient, delivered); // runs on the destination
```

`USDT0` is undeclared on Base, so it reaches `hop` as a **name**. The SDK's `Intent` class looks it
up on the destination:

```ts
// @sauce/intents, Intent#_deliveryToken
const symbol = nameOf(item.token);                 // "USDT0", or undefined for a Token or address
const token = symbol === undefined ? item.token : globalIn(this._destination.chainId, symbol);
```

`globalIn` reads the destination chain's module, which `programOptions` names as that chain's
ambient module, and returns its `USDT0` Token instance. The route's token list and transfer call
then fold to the destination's address. Outside an argument, `USDT0` is still `UnknownIdentifier`
at the name, so a typo in ordinary code fails as it always did.

**A hop config the SDK checks in its own words.** `hop({ recieve: … })` is refused while compiling:

```ts
for (const key of Object.keys(config)) {
  if (!KNOWN.includes(key)) throw new Error("a hop takes no `" + key + "`");
}
```

**Hooks.** SDK #92's `.before`/`.after` are route calls the Executor makes, not cooks:

```ts
await Optimism.hop({ reward, refundee, before: () => Vault.at(VAULT).unlock(order) });

// in the Intent class:
for (const hook of this._before) calls.add(callOf(hook, this._destination.chainId));
```

`callOf` returns `{ target, data, value }` of the hook's one call. `Vault` and `VAULT` are resolved
on the destination, and `order` is written into `data` at the call site.

**The CLI decodes `main`'s return.** `sauce run`/`simulate` read `entrySignature.returns`
(for example `"{ token: Address, out: Uint256 }[]"`) to decode what the cook returned, including
for a program compiled for its `args`.

**Getters.** A class reads a computed member the way it reads a field:

```ts
class Token {
  constructor(address) { this.address = address; }
  get balance() { return IERC20.at(this.address).balanceOf(ctx.self()); }
}
const pay = new Token(payToken);
const before = pay.balance; // the getter runs at each read: the bytes of a method `pay.balance()`
```

**Smaller methods and loops.** A method passing a constant field and its arguments on compiles to
the bytes of the call written out (`Token(payToken).transfer(to, amount)` is
`__sauce_transfer(payToken, to, amount)`). And a value loops read and the program reads again
after them is read there through a copy, so the copy spills rather than the value the loops read:
the distributed swap, whose refund passes `payToken` on at the end, is 2572 bytes where it was 2658
(2581 with `const pay = payToken` written out).

**Compiles against large ambient modules.** The SDK hands every compile its chain modules (several
hundred kilobytes each), and most of a small program's compile went to reading them. The modules and
ABIs a process has parsed are now reused by later compiles that read the same text, and ambient
exports reach every module through one shared table instead of a copy in each. Every byte is
unchanged; the timings are below.

**A refusal in the library's own words.** A compile-time `throw` builds its message with `+`:

```ts
class Deployment {
  constructor(slug) {
    if (slug != "base") throw new Error("not deployed on '" + slug + "'");
  }
}
```

**A Solana swap library forwards the route's accounts.** `svm.remainingAccounts()` works in any
function (SDK #91, `@sauce/swap`):

```ts
export function forward(program: Account, data: bytes): void {
  svm.call(program, svm.remainingAccounts(), data);
}
```

## Interface

| Surface | Rust (`sauce_core`) | npm (`@eco-incorp/sauce-compiler`) |
| --- | --- | --- |
| Result | `Artifact::entry_signature: EntrySignature { params: Vec<EntryParam { name: String, ty: String, abi: Option<AbiParam> }>, returns: Option<String> }` | `CompileResult.entrySignature: { params: { name, type, abi? }[], returns?: string }` |
| Builtin | `callOf(closure, scope)` → static `{ target: Address, data: bytes, value: Uint256 }` | same |
| Builtin | `globalIn(scope, name)` → the global's value, frozen | same |
| Builtin | `nameOf(value)` → the name's text as a static string, or `undefined` | same |
| Builtin | `Object.keys(value)` → static array of static strings | same |
| Language | an undeclared bare name passed as an argument (or inside an object or array literal argument) is a static **name** value | same |
| Language | `+` of two compile-time strings is a compile-time string | same |
| Language | `svm.remainingAccount(i)` / `svm.remainingAccounts()` in any function, counted from the entry's `Account` count | same |
| Language | a class `get` member is read like a field, its body run at each read (instance and static); a getter that returns a closure is callable | same |
| Callback | `program_options` (`ProgramOptionsFn`) also answers the scope of `callOf` and `globalIn` | `programOptions` likewise |
| Option | `CompileOptions::cache` (default `true`) also covers the **module cache**: each module a compile parses, by path and exact text, and each contract ABI, by name, path and exact JSON, reused by a later compile in the process that reads the same text; `false` neither reads nor fills it | `cache?: boolean`, likewise |
| Bounds | 64 modules and 64 MiB of their text; 4096 ABIs and 16 MiB of their JSON. A new entry past a bound empties that cache first; one larger than a bound alone is read and not kept | same |
| Clearing | `clear_function_cache()` empties the lowering cache and the module cache, releasing their memory, and resets the lowering cache's counters; a compile running holds the modules it reads, so clearing from a resolver frees nothing in use | `clearFunctionCache()` likewise |

`entrySignature` types are written in the language's own names: `Uint256`, `Address`, `bool`,
`string`, `bytes`, `Account`, `T[]`, and `{ a: T, b: U }`, with an entry-module `interface`
written out. `abi` is the parameter's `entryParams` entry, absent for an SVM `Account`. `returns`
is the declared type, `"void"` for a declared or inferred void `main` (a script included), and
absent for an unannotated `main` that returns a value. It is reported on every compile, including
one compiled for its `args`, whose `entryParams` is `[]`.

```ts
const { entrySignature } = compile({ target: "evm", resolve, entry: "main.ts" });
// main(a, b: bool): Uint256  →  { params: [{ name: "a", type: "Uint256", abi: {…} },
//                                          { name: "b", type: "bool", abi: {…} }], returns: "Uint256" }
```

New diagnostics (codes):
- `CallOfArity`, `CallOfNotAClosure`
- `CallOfBody`: anything but one external call, including none, two, a caught call or a delegate call
- `CallOfValue`: a part only the closure's own run could compute
- `CallOfOnSvm`
- `GlobalInArity`, `GlobalInName`, `GlobalInMissing`
- `GlobalInRefused`: a module `let`, a lookup table, or a class this program does not load
- `GlobalInFailed`
- `NameOfArity`, `ObjectKeysArity`, `ObjectKeysNotObject`
- `PlusOfBytes`: `+` of two byte strings, which is not concatenation
- `GetterAssigned` (an assignment, compound included, to a getter's member), `GetterCalled` (a call
  of a getter whose value is not a closure); a setter is refused where it is declared

Removed: `RemainingAccountsOutsideEntry`.

The builtins are not reserved: a program's own `callOf`, `globalIn`, `nameOf` or `Object`
shadows them.

## How it works

- **callOf** compiles the closure exactly as `program(closure, scope)` does, through the same
  preparation, and keeps none of it. The entry's lowered body must be one statement holding one
  `EvmCall`. Its target, value and calldata may contain only constants and the globals the entry
  loads its argument words into. The caller substitutes its own reads of those words. Nothing is
  emitted, numbered or reported.
- **Names.** An argument position arms a one-shot flag. A bare identifier that names nothing
  becomes `Static::Name`, and so does one in an object or array literal written as the argument.
  Any use that needs a value (run time, a member, arithmetic, an annotated parameter) raises the
  name's own `UnknownIdentifier`, rendered in its module. Tests (truthiness, `instanceof`,
  `=== undefined`) treat it as a static value.
- **globalIn** loads the scope's program on an entry that declares nothing, sharing the
  compile's parsed modules. It makes the global there and describes it with the closure-capture
  shapes. It is rebuilt frozen in the asking program, with classes mapped by module path and name.
- **Object.keys** returns a static array, so `for … of` over it unrolls.
- **Remaining accounts.** Every function counts the tail from the entry's declared `Account`s. A
  lowering that reads the tail is keyed on that count (`fn_cache::CAT_ACCOUNTS`). The manifest's
  tail entry is read from reachable functions only.
- **Getters** are class members the frontend keeps (`Member::Getter`); a read of the member calls
  the body with the instance, as a method call would, so a run-time getter is read once per read.
- **Arguments read in place.** A method's frame substitutes an argument at its one read where
  nothing between could change it: a read of a field or a constant has no effect, so it no longer
  makes the next parameter read unclean, and arguments that can abort are substituted only where
  they still abort in the order they were passed.
- **Tail reads** (`tail_reads`, after `loop_reads`, before inlining). The allocator spills the
  local that lives longest, so a value read in a loop and again after it spills, and each of the
  loop's reads becomes a memory read. For a spilled value assigned once, read in a top-level loop
  and after the last such loop, the reads after the loop read a copy: a local already assigned from
  it, or a new one assigned where the value is or where the loop ends. Each is emitted and the
  smallest kept, only where the program is smaller.
- **What tail reads cost.** A copy is compared by emitting only its function
  (`codegen::measure_function`): at the narrowest target immediate a function's bytes are its share
  of the program's. An emission records how each function fit (`codegen::Fit`: bytes, the first
  budget of its ladder that fit, width), which `cse`, `loop_reads` and inlining keep current, so the
  function as it was is read from it, and after a split is kept the program is emitted once more
  with each function starting its ladder at its known budget (`codegen::measure_known`): every rung
  above fails, so the bytes are the same without the failed attempts. The first value whose first
  copy is no smaller ends the pass; at most eight copies are tried.

- **The module cache** (`lower::module_cache`, under `cache`). Each module a compile parses
  (parsed, checked, its `await`s desugared) is kept by the path it was read from and its exact text,
  each a `self_cell` of its own arena and its tree, and each contract ABI by name, path and exact
  JSON. A later compile reading the same text reuses them; a changed text is read anew. A compile
  holds the cached modules it reads in a `typed_arena` declared before its own arena, so its trees
  borrow them safely for its whole run. Two small dependencies, `self_cell` and `typed-arena`, keep
  this free of `unsafe`. Ambient exports reach every module through one shared
  table (`lower::scope_table::ScopeTable`): the module's own names first, then the ambient exports
  none of its names takes on any channel, read, iterated and rendered as the merged copy was.
  Contract fingerprints hash the ABI structurally. An ambient module's instances and classes were
  already made only when first read; the eager part was reading and naming.

No existing program grows: `base_bytecode` holds all 406 programs at both targets and both `-O`
levels, the engine's 22 router gas programs among them, and moves none but the new `tail/`
programs at `-O`. The `entry_decode` golden shrinks at `-O` (EVM 1540 → 1513, SVM 2125 → 2018): its
array decode loops read values after them. The SDK's 81 bytecodes against #556: 36 the same, 45
smaller, none larger.

## Tests

- `call_of.rs`: the parts made by `evm.call` are byte-identical to the raw call, with names from
  the scope and a library hook; every refusal.
- `undeclared_names.rs`, `global_in.rs`: (E) as given, misuse at the name in the module and in
  a library, the scope's define and ambient instance, missing, refused and frozen.
- `object_keys.rs`: (F) refusal `c` at `new C({ a: 1, c: 2 })`, key order, concatenated messages.
- `static_values.rs`: (G) a contract import held by an instance, with `.at`, in the module and
  ambient.
- `entry_params.rs`: (D) every repro, `args` included.
- `remaining_accounts.rs` and `svm_conformance`: library and compile-time-method tail reads, cache
  keying.
- `getters.rs`: instance and static getters, a run-time getter read once per read, byte identity
  with the method call, the getter refusals.
- `base_bytecode`: twins holding a method's in-place argument reads to the call written out
  (`binding-at-a-field-and-an-argument`, `field-then-arguments-read-in-place`,
  `arguments-that-abort-keep-their-order`), and `tail/` programs recorded from `ce49eef5`.
- `tail_reads` unit tests (both targets): a value read after its loops compiles to the bytes of the
  program reading the copy it holds, and with no copy to no more than the copy written out;
  `v12_conformance`/`svm_conformance` run that program optimized and not, with the same results.
- `module_cache.rs`: a program with an ambient module, a library and an ABI compiles to the same
  bytes cache off, on, again and after `clear_function_cache`; a library, ambient or ABI text that
  changed at the same path is read anew; a resolver that empties the cache on every read gets the
  same bytes. `scope_table` unit test: the shared table reads, iterates and renders as the merged one.
- `object_keys.rs`: a constructor's `throw new Error("not deployed on '" + slug + "'")` reads as
  written.
- `smoke.mjs`: `entrySignature` (also with `args`), `globalIn` with a name, and `callOf` across the
  wasm boundary.

Gates at 975b70df: `make ci` 3794 passed, 0 failed; `make test-conformance` 749 passed, 0 failed;
`make smoke` all 91 checks ok. The head adds only the ABI cache's bound on its JSON, with its tests;
`module_cache`, `base_bytecode` and clippy pass on it.

## Size and compile time

Bytes, against #556 (c0309041): the SDK's 81 bytecodes (rewrite/61 at f6cd8cfd) are 36 the same,
45 smaller, none larger; the engine's 22 router gas programs and every `base_bytecode` program but the
new `tail/` ones are unchanged. sdk-class's recordings (rewrite/61 at d176a385): 16 / 16 / 9 / 1215 /
1215 / 2600 / 2572 bytes, against 16 / 16 / 9 / 1218 / 1218 / 2602 / 2658.

Compile time, wasm, interleaved in one process, median of 5, ms cold (`clearFunctionCache()` first,
which empties the module cache too) / warm:

| recording | #556 | #557 |
| --- | --- | --- |
| trivial@base | 8.3 / 7.9 | 7.7 / 1.7 |
| trivial@ethereum | 16.4 / 16.3 | 14.5 / 3.7 |
| trivial@solana | 6.2 / 5.8 | 5.6 / 2.6 |
| cross-chain@base | 28.3 / 27.5 | 24.5 / 7.9 |
| cross-chain@ethereum | 37.0 / 36.9 | 31.5 / 11.8 |
| swap-on-base@ethereum | 31.9 / 31.6 | 28.4 / 12.0 |
| distributed-swap@base | 18.3 / 18.5 | 18.6 / 11.9 |

Over every program the SDK compiles (cold sums, ms): SDK main 51 programs, 2.5.0 193.8, #556 234.8,
#557 221.4; rewrite/61 57 programs, #556 1327.6, #557 1158.3 (warm 1319.0 → 427.7); the 22 router
helpers, 2.5.0 89.0, #556 115.3, #557 106.1. No program compiles more than 10% slower than on #556
(the slowest, +0%), and none of SDK main's or the router helpers' is over max(2× 2.5.0, 20 ms).

## Stack

main ← #555 ← #556 ← **#557** (on #556 at c0309041). This replaces the old
#557's host `record: "calls"` with `callOf`. Site spans are dropped: no host sites remain, and
nothing in the SDK uses them.

## SDK side

- `@sauce/intents` resolves names with `nameOf`/`globalIn`. Chain modules stop carrying other
  chains' token tables.
- `hop` checks its keys with `Object.keys`.
- Hooks (#92) use `callOf`.
- The CLI decodes returns with `entrySignature`.
- `@sauce/swap` (#91) forwards `svm.remainingAccounts()` from library code.
