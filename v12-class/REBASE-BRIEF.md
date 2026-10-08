# Rebasing #552–#557 onto the class design

Read DESIGN.md and RULES.md first (this directory). They are binding.

## The new stack

main ← #549 host entry (unchanged code) ← #550 classes and static values (PUSHED, 6ff5502e,
branch `feat/compiler-host-declarations`, local `rewrite/550`) ← #551 `program(closure, scope)`
(local `rewrite/551`, owner `v12-551-2`, in review, not pushed yet) ← #552 ← #553 ← #554 ← #555 ←
#556 ← #557.

Each of #552–#557 had been built on the OLD #550/#551 host API: `declare`, host types and records,
endings, `nested(site)`, `bind`, `View`, `Param::Program`/`Param::Handler` on host signatures,
recording. That API is gone. Your job is to PORT your PR's generic feature onto the new stack. Keep
what is generic, drop or replace what leaned on host machinery, and keep its tests passing in
generic vocabulary. Your old branch is tagged `backup/<branch>-20261005`. Read it with
`git show backup/…:path`, or diff it against its old base (the backup tag of the PR below it).

## How

- Your worktree is /Users/er/Documents/Projects/v12-class/<N>, local branch `rewrite/<N>`, which
  starts at `rewrite/551` (3d44424c). The old branches are full of merge commits up the stack, so
  porting your PR's net change by hand (or cherry-picking its own non-merge commits) is usually
  easier than `git rebase`. Your call.
- Build on the PR below you. Until it says "#<N-1> usable at <sha>", study and plan; then merge or
  rebase its branch into yours. Do it again on each new sha it sends. Rewriting history on your
  local branch is fine: it will be force-pushed.
- When your API is stable, tell the PR above you "#<N> usable at <sha>", and later "#<N> final at
  <sha>". Names: #551 `v12-551-2`, #552 `v12-552r`, #553 `v12-553r`, #554 `v12-554r`, #555
  `v12-555r`, #556 `v12-556r`, #557 `v12-557r`. The lead is `main`.
- First, within your first hour, send `main` a plan of at most 250 words: what you keep, what you drop,
  what changes meaning under the class design, and files and sizes.
- Gates: `make ci`, `make test-conformance`, `make smoke` in compiler/, each through
  `/Users/er/Documents/Projects/v12-class/gate.sh` (one heavy run machine-wide), with
  `export CARGO_BUILD_JOBS=2`. Keep #550's base-bytecode guard (tests/base_bytecode.rs) green: no
  program may grow.
- When green on top of the latest lower branch, message `main` "#<N> ready for review at <sha>" with
  what you built, files and sizes, gate counts, and a draft PR body in your worktree (PR-BODY-DRAFT.md,
  untracked). The body opens with the REAL use; right after it, an `## Interface` section listing
  CONCRETELY what the PR adds to the compiler's interface (options, result fields, diagnostics,
  builtins, language forms; Rust beside npm, exact types, a TS example), modelled on #549's. The
  real use is the SDK's intent syntax or the `sauce` CLI capability, with what the compiler emits.
  After the interface: the generic mechanism, tests, stack and SDK side; plain integers
  in examples. Do NOT push until `main` says "push". Then force-push
  `rewrite/<N>:<your PR branch>`, update the title and body, and post one short comment saying it was
  rebased onto the class design. Leave the PR in DRAFT: `main` marks it ready.
- No AI attribution anywhere. Conventional Commits. Keep NOTES.md current for crash recovery.

## Addendum for #557 (USER, 2026-10-06)
#557 is NOT only follow-ups: it also replaces the old recorded calls with the generic builtin
`callOf(closure, scope)` (working name; propose a better one to `main` if you have it). It returns the
static `{ target, data, value }` of a closure whose body is exactly one external contract call, with
names resolved in `scope` through `programOptions`, captured run-time values as run-time words in `data`,
and every other body refused. It reuses #551's closure and scope machinery. The SDK's intent hooks
(`.before`/`.after`, SDK #92) turn these into the route's calls around the cook. See DESIGN.md "Hooks".
Also in #557 (USER, 2026-10-06): destination-only delivery tokens. (1) An unknown bare name passed to a
call the compiler runs arrives as a static "name" value (its text). Any other use stays
`UnknownIdentifier` at the name's location. (2) A builtin, working name `scopeGlobal(scope, name)`, reads
another scope's global through `programOptions`. See DESIGN.md "Destination-only delivery tokens".

## Addendum for #555 (2026-10-06)
Byte-identity gap the SDK found (pushed #550/#551 deliberately not reopened): `Token(X).balanceOf(ctx.self())`,
where `Token` is a module-scope arrow returning an instance whose method calls `@sauce/token`'s
`balanceOf(this.address, holder)`, is 66 bytes, against 65 for the direct `balanceOf(X, ctx.self())`.
`approve(ctx.self(), amount)` has the same gap. The called argument `ctx.self()` is still copied
through the arrow-then-method path, where the direct call reads it in place. Close it in #555 (partial
evaluation) with a byte-identity test. The SDK has an `it.failing` in routes-stock-tokens on it.
Root cause found by the SDK: a compile-time-decided `x === undefined` / `!== undefined` guard in the method
(which emits nothing and runs no user code) makes the walk treat later reads as dirty, so the
invariant `ctx.self()` argument is copied. Repro: `class C { constructor(a){this.a=a} m(to, n) { if
(n === undefined) throw new Error("n"); g(this.a, to, n); } }`, then `new C(t).m(ctx.self(), q)` is 84 bytes,
against 82 for `g(t, ctx.self(), q)`. Treat a decided comparison that emits nothing as clean.

## Addendum for #554 (USER, 2026-10-06)
The SDK's intent syntax is now `await Optimism.hop({ reward, receive, refundee, … })` (one verb, one config
object), not `Optimism.Portal.send(...).receive(...)`. #554's PR body leads with that, and its exact `.then`
equivalent: `Optimism.hop({ … }).then(() => { rest })`. Compiler tests stay generic.
Also for #555: `undefined` (or another value with no run-time form) passed to an ANNOTATED run-time
parameter is refused at the argument (`Unset` / `StaticAtRunTime`, naming the expression) instead of making
the call run at compile time. Today a Token method called with a missing argument gives "`toBytesBe` is
not a member of `amount`", from inside the library.

Also for #557 (2026-10-06): `Object.keys(o)` on a STATIC object in compile-time code, returning a static
array of its own keys as strings in declaration order (or `for…in` with the same semantics). The SDK's
`hop({...})` must refuse an unknown or mistyped config key (`recieve:`) in its own words, and today
nothing can enumerate a static object's keys.

## Addendum (2026-10-07): start from the current stack
Local branches rewrite/555, rewrite/556, rewrite/557 sit at the stale 3d44424c and carry a junk empty file
`compiler/crates/sauce-core/src/lower/alk(element, roots)),|XX|`. Do NOT port from them: branch each
port from the PR below's pushed head (fetched), and never commit that path.

## Acceptance tests from the SDK (2026-10-07, sdk-class). Generic repros; each must pass, byte-exact where stated

### #556 (compile a program for its arguments)
- (A) `args` option: `compile({ …, args: [5n, true] })` on `function main(a: Uint256, b: bool): Uint256 { return b ? a + 1 : 0; }`
  → main takes no run-time arguments, `entryParams` is [], bytecode equals `function main(): Uint256 { return 6; }`.
  Values: uint, address, bool.
- (B) Bound args fold into closures: `function main(a: Uint256): bytes { return program(() => { evm.sstore(1, a * 99 / 100); }, 1).code; }`
  with args [1000000] → `programs[0].captures` is [], and the closure's code equals the closure written with literal 990000.

### #555 (check on the pushed head; believed done)
- (C) `function g(x: Uint256): bytes { return x.toBytesBe(32); } class C { m(x) { return g(x); } } function main(): bytes { return new C().m(); }`
  → refused at the user's argument, kind Unset.

### #557
- (D) `result.entrySignature = { params: [{ name, type, abi? }], returns? }` on EVERY compile (with `args` too):
  - `type` is the language's spelling (Uint256, Address, bool, bytes, string, Account, T[], `{ a: T }` with an entry-module interface written out);
  - `abi` is the param's entryParams entry, absent for an SVM Account;
  - `returns`: the declared type, "void" for a declared or inferred void main, absent for an unannotated main returning a value.
  Repros:
  - `main(a, b: bool): Uint256` → params a/Uint256, b/bool, returns "Uint256" (same with args [5, true]);
  - `(): Address` → "Address";
  - `main() {}` and `(): void` → "void";
  - `interface Out { token: Address; out: Uint256 } function main(): Out[]` → "{ token: Address, out: Uint256 }[]";
  - the script `evm.sstore(1, 1);` → { params: [], returns: "void" }.
- (E) Unknown bare name → static name value, plus `globalIn` (renamed from the working name scopeGlobal, 2026-10-07; detect a name value with `nameOf(x)`). The name may sit INSIDE AN OBJECT LITERAL passed to a compile-time call:
  `class Box { take(o) { return scopeGlobal(2, o.t); } } function main(): Uint256 { return new Box().take({ t: ZETA }); }`
  with programOptions(2) giving ZETA = 7 and main's scope lacking it → 7.
  - Compile-time code can tell a name value from other values (typeof or similar; propose the spelling to `main`).
  - scopeGlobal fails, located, when the scope lacks the name.
  - Any other use (`return ZETA + 1`) stays UnknownIdentifier at ZETA.
- (F) `Object.keys` on a static object:
  `class C { constructor(o) { for (const k of Object.keys(o)) { if (k != "a" && k != "b") throw new Error(k); } } } function main() { new C({ a: 1, c: 2 }); }`
  → compile error "c", located at the user's call. Keys in declaration order as static strings; static string concatenation in the message ("unknown field " + k) if feasible.
- (G) A contract import held by a static value, with `.at`:
  `import Pool from "./pool.json"; class Ns { constructor(c) { this.Pool = c; } } const N = new Ns(Pool); function main(p: Address): Uint256 { return N.Pool.at(p).liquidity(); }`
  → byte-identical to `Pool.at(p).liquidity()`.
- Also #557: `callOf(closure, scope)` (hooks, SDK #92), remainingAccounts anywhere (SDK #91 Solana @sauce/swap), site spans (old #557 follow-ups; nothing in the SDK waits on them; keep only if generic and cheap).
- #557 additions (2026-10-07, sdk-class findings): (7) class GETTERS, run at each member access like a no-argument
  method; `const b = t.x` evaluates once (the SDK's `self.USDC` read-once fix); setters stay refused. (8) Codegen: push an
  inlined method's constant before its run-time arguments (no SWAP); `t.get(ctx.self())` byte-identical to
  `C.at(0x1234).get(ctx.self())` (36 bytes). Plus review-550's fixes: callOf straight-line one-call rule, cache keyed on
  undeclared names, name-value misuse routing, name-value allowed uses (see DESIGN.md "Name values").
