I have everything needed. Writing the design.

---

# Ambient imports + chain-scoped globals — mechanism design, A-vs-B, updated stack

**Scope of this doc.** Builds directly on `docs/plans/shared-stdlib-dsl-plugin-architecture.md` (the Rank-1/Rank-2 split, the hybrid A/B/C plugin, the inline-`contracts` gap). It does **not** re-derive that; it adds the two genuinely-new pieces the refined directive calls for — **ambient imports** (a Resolver-fetched module's exports injected into the global name set *without* an import line) and **chain-scoped globals** (`Base(() => { … })` activating a chain's ambient set for a region) — and answers whether either forces `Ty::Named`. Read-only; no edits/commits/cargo.

The one decisive fact I'll establish early and lean on throughout: **a Sauce program is atomic within a single EVM/SVM transaction on a single chain.** Cross-chain is *inherently* multiple programs (the DSL already models this: nesting = cross-chain cascade, fund head only — `builder.ts` → `openRoute` → `nest.ts`). That runtime fact, more than any compiler cost, settles the A-vs-B fork.

---

## 1. Ambient import on compiler-rs (and how TS's `globals.ts` becomes the same mechanism)

### 1.1 What "ambient" has to mean, mechanically

Today, on **both** compilers, a module's exports reach user code only through an explicit `import { x } from "./mod"`:

- **RS**: `load_graph` (`lower/assembly.rs:339`) walks the entry's `ImportDeclaration`s; `assign_global_ids` (`:918`) tables every imported module's functions into one global `FunctionId` space; `module_values` (`:1153`) builds each module's const table; a bare specifier is mapped by `Resolver::resolve_package` (`:550`, trait `resolver.rs:60`).
- **TS**: `collectImportedFunctions` (`processor/index.ts:158`) resolves each `ImportDeclaration` via `ctx.resolveModuleSource`, parses, recurses, and registers each exported `function` (rejecting a `main`, `:212`).

"Ambient" = the exact same resolution + registration, but **seeded from a manifest/option list instead of from `ImportDeclaration` nodes in the source**, and injected into the *global* resolution set so an un-imported program body can name the exports.

### 1.2 The smallest RS addition — ride two channels that already exist

The insight that makes this small: **RS already has a flat, module-shared, name→value injection channel that is not driven by imports — `inject_defines`** (`lower/assembly.rs:1134`). It inserts each `(name, Word)` into *every* module's `own` value table as a module-scope const (`:1136-1144`), overriding a same-named source const, and — critically — **a function-local or parameter of the same name still shadows it** because `Lowerer::module_value` returns `None` when a lexical binding is in scope (`:1131` comment). That is *precisely* the precedence an ambient global needs.

So the ambient primitive is two merges, each onto an existing table:

1. **Ambient exported CONSTS → the `inject_defines` channel.** An ambient module's exported module-scope literals (`export const USDC_DECIMALS = 6n`) become entries injected into every module's `own` table, identical to a define. New code: resolve the ambient module through the existing Resolver/`load_graph`, read its exported consts, feed them alongside `CompileOptions::defines`. Zero new name-resolution logic — it *is* the defines path.

2. **Ambient exported FUNCTIONS → the global signature table.** An ambient module's `export function`s get global `FunctionId`s via the same `assign_global_ids` (`:918`) that an explicitly-imported module already uses — the only change is that the module enters the graph because it's on the ambient list, not because an `ImportDeclaration` named it.

**The trigger is an option/manifest list, NOT a new import form.** Concretely: `CompileOptions.ambient: Vec<String>` (a list of specifiers, each resolved exactly as a bare/relative import is), surfaced on the wasm boundary next to `contracts`/`defines`. Reasons this beats a new syntax:

- Base SauceScript has **no ambient-import syntax**, and RS's frontend rejects arrow/closure constructs generally (no `Arrow`/`Closure` handling anywhere in `frontend.rs`/`lower/*`). Adding an import *form* forks the grammar from TS; adding an *option* does not.
- `resolver.rs:9` already anticipates exactly this — *"every source, import, and (later) **plugin artifact** is fetched through a `Resolver`."* An ambient list is a plugin artifact fetched through the resolver. It stays inside the shipped "injection channel is the Resolver, not a Rust API" decision.

**One thing to verify in PR (see §6 risk):** whether RS today exposes an imported module's module-scope **consts** as cross-module *values* at all, or only its functions + ABI contracts. If consts aren't already cross-module importable, channel (1) above is the small new bit — and it rides `inject_defines`'s existing insert, so it's a merge, not new machinery.

### 1.3 How TS's `globals.ts` becomes the *same* mechanism

TS already has the shape: `GLOBAL_FUNCTIONS = { ...NATIVE_GLOBAL_FUNCTIONS, ...STDLIB_FUNCTIONS }` (`compiler/src/globals.ts:1034`) is a **spread-merge injection into the global namespace**, and `RESERVED_NAMES` auto-derives from it (`:1115`). The standing design constraint is stated in-file (`:989-1008`): *"stdlib symbols reach user code WITHOUT an explicit import precisely by being INJECTED into globals."*

To make **one manifest drive both**, the TS side gains a symmetric `ambient` option that:

- runs the existing `collectImportedFunctions` machinery (`processor/index.ts:158`) over the ambient specifiers **as if** they were imports (they're plain source modules; the machinery is unchanged), registering their functions; and
- registers their exported consts via `ctx.setDefines`/`addDefine` (`context.ts:598-610`) — the TS twin of `inject_defines`, with the identical "define wins over source const, but `getVar` shadows `getConstant`" precedence (`context.ts:614`, and the `ambient.ts:3-6` note already relies on exactly this layering).

So both compilers converge on **"ambient = resolve a module through the Resolver, then merge its exported functions into the global function table and its exported consts into the flat define channel."** The manifest (Layer C of the arch doc) carries the ambient list; each compiler's loader reads it and calls its own existing injection plumbing. Parity is by construction because both consume the same source bytes and the same manifest.

---

## 2. Chain-scoped globals: the A-vs-B fork

The target: `Base(() => { /* Base USDC / UniswapRouter ambient here */ Optimism(() => { /* Optimism ambient */ }) })` — entering a chain block activates that chain's ambient set for the block's lexical extent, deactivating on exit; nesting switches sets.

### 2.0 What the SDK does *today* (the baseline both options extend)

`Base(() => …)` is **not** compiled as written. The arrow is a `SauceBody` (`builder.ts:74`, `intent-dsl.ts`); `openRoute` runs at TS runtime; `sauceBodyToSource` (`closure.ts`) turns the arrow body into `function main(){ … }` via `Function.prototype.toString()` + an acorn slice; `chainDefines(chain, opts)` (`ambient.ts:39`) computes that chain's scalar defines (`chainId`, every protocol contract address on that chain, token symbols) and threads them into `compile()`'s `defines` (`intent-dsl.ts:19`, underneath the caller's own). Protocol/token *names* are erased to `Contract.at(addr).method()` by the acorn rewrites (`protocol-rewrite.ts`, `token-rewrite.ts`) **before** `compile()` sees anything. **The compiler never sees an arrow, a chain name, or a chain block — only `function main(){}` + flat defines + a contracts map.** Chain identity today is captured entirely by *which* `chainDefines` bundle was threaded.

### 2.1 Option A — the compiler parses the chain block and scopes globals itself

The compiler would accept `Base(() => { … })` as a lexical construct, maintain a **stack of ambient sets**, push on block entry, pop on exit, and resolve names against the top-of-stack union.

**Cost on compiler-rs (large, architecture-bending):**
- **New grammar.** RS's frontend has no arrow/closure handling at all; a chain-context block is a call-taking-an-arrow-that-defines-a-scope, a shape the frontend rejects outright. This forks base-SauceScript grammar to add a construct.
- **Scoped defines don't exist.** `inject_defines` is *flat* — injected into every module's `own` table (`assembly.rs:1134`), no stack, no push/pop. Name resolution is *namespace-before-scope, then flat module values* (`lower/mod.rs:2243-2253`). A lexical add/remove of globals requires a per-region define layer with push/pop and shadow-on-nest — a new dimension in the resolver that the whole "flat defines / namespaces resolved before any scope lookup" model was explicitly built *without*.
- Directly reopens what the 2026-07-29 spec closed.

**Cost on TS (large):** the core is acorn-only; a program body must be `function main(){}`. The chain block would need new acorn-accepted syntax *and* `defines` would have to become scope-stacked (today `defines` is a single module-shared `Map`, `context.ts:296`) with `getConstant` consulting the stack.

**add/remove-on-exit:** compiler holds a stack; entry pushes the chain's (defines + ambient names), exit pops.
**nesting/switching:** `Base(()=>{ Optimism(()=>{}) })` pushes Optimism over Base; a name in both resolves inner (Optimism); inner exit reverts to Base — i.e. lexical shadowing in the ambient stack.

**The fatal problem with A is not cost — it's the runtime.** A single compiled `main()` executes atomically in **one** transaction on **one** chain. Two chain regions inside one body would have to share one runtime execution — which cross-chain cannot. So A's "one body, switch chains mid-function" is not merely expensive to compile; it has **no runtime it can execute on**. The only coherent reading of A is "compile-time authoring ergonomics where both chains' globals coexist in one editing scope but still emit separate programs" — and that is B with extra grammar.

### 2.2 Option B — SDK erases each chain region into that chain's defines + ambient set before compile()

The compiler stays chain-agnostic (exactly as today). The SDK's fluent/builder layer partitions the authored body by chain region and, per region, produces **one SauceScript program compiled with that chain's define bundle + ambient list**. "Removal on exit" is simply *not carrying* a region's bundle into the next region's compile.

**Cost on compiler-rs: ~zero beyond §1 (ambient imports) + the arch doc's inline-`contracts`.** No grammar, no scoped defines, no stack. The compiler receives erased source + a flat `defines` + a flat `ambient` list — the model it already has.
**Cost on TS: ~zero beyond §1.** SDK codegen only.
**New syntax the frontends must accept: none.** The arrow block stays a TS-runtime closure (or, for a string body, an SDK-side AST marker), never reaching either compiler as arrow syntax — precisely the property that makes today's single-chain `Base(()=>…)` work.
**add/remove-on-exit:** resolved at SDK partition time — each region gets exactly its chain's bundle; the next region gets the next chain's. No compile-time stack exists to unwind.
**nesting/switching:** `Base(()=>{ Optimism(()=>{}) })` **is the DSL's existing nest cascade** (`nest.ts`, "fund head only") — the inner Optimism region becomes its own program compiled with Optimism's bundle, linked as a nested intent. This is already how the DSL means nesting; B needs no new semantics for it.

### 2.3 Recommendation: **B**, decisively

Reasons, in priority order:

1. **A has no runtime for its distinguishing case.** One atomic program runs on one chain; two chain regions sharing one `main()` body cannot execute cross-chain. A's only executable interpretation collapses into B.
2. **B keeps compiler-rs simplest** — the explicit lean in the directive. It needs *no* arrow grammar (which RS rejects) and *no* scoped-defines stack (which fights the flat-`inject_defines` / namespace-before-scope model), whereas A demands both on both compilers.
3. **True parity by construction** — both compilers consume identical erased source + flat defines + flat ambient list. The genuinely-new *compiler* feature (ambient imports, §1) is shared and real; the chain add/remove is SDK orchestration selecting which ambient bundle each compile receives.
4. **B is what the DSL already does** for the single-chain case and for nesting; it's an extension of a working model, not a new one.

**How B still satisfies "chain-scoping is a real compiler feature on both compilers":** the real, shared compiler feature is **ambient imports + per-`compile()` ambient-bundle selection** — the compiler genuinely gains the ability to inject a named module set into the global namespace without an import, and which set is a compile input. The *lexical* add/remove within a block is SDK-side region partitioning on top of that primitive. That is the smallest split that makes ambient imports a bona fide compiler capability while keeping chain add/remove out of the grammar.

**Choose A only if** the user truly needs a single compiled body in which two chains' globals coexist purely for *authoring* and the SDK still emits separate programs — and even then A reduces to "B plus arrow grammar," so B is the substrate regardless.

---

## 3. How a chain is defined in the shared plugin — a named bundle

Yes: **a chain is a named bundle of (defines + ambient imports) the manifest declares, activated by name.** Mapped onto the arch doc's hybrid layers:

- **(a) Scalar defines** — `chainId`/`CHAIN_ID`, every protocol contract address on that chain, token-symbol addresses. These are **per-chain DATA** (they differ by chain), so they live in **Layer B** (JSON: `descriptors/registry.ts`'s `perChainAddress`, `token-registry.ts`) and are surfaced as `compile()` **defines** — exactly `chainDefines` today (`ambient.ts:43-62`: `defines[key] = address`). Type: `Ty::Scalar(Number)` on RS (`inject_defines` hardcodes it, `assembly.rs:1143`), `bigint` on TS.

- **(b) Ambient names** — `USDC.transfer(...)`, `UniswapRouter.execute(...)`. Two sub-cases, and the split matters:
  - The **address** (`USDC`, `UniswapRouter` as a value) is address-bearing DATA → rides **defines** (Layer B), same as (a).
  - The **code/sugar** (`.transfer`, `.execute`) is **address-agnostic SauceScript** → a **Layer A** ambient *source* module: a token/protocol interface (`Contract.at(addr).method()` wrappers, or the `@sauce/token` handle) parameterized on the address define. The module is chain-independent; the *define* it reads is chain-specific. This is why the ambient source module is shared across all chains and only the define bundle changes per chain — the clean factoring.

So the **manifest (Layer C)** declares, per chain name:

```
Base: { defines: <ref into Layer-B Base data>, ambient: ["@sauce/token", "@sauce/uniswap-iface", ...] }
Optimism: { defines: <ref into Layer-B Optimism data>, ambient: [ ...same source modules... ] }
```

Entering a chain context = **selecting that bundle by name**: the SDK threads the bundle's defines into `compile().defines` and passes the bundle's ambient list to the §1 ambient-import mechanism. The ambient *source* modules are typically identical across chains (interface code); only the *define* half varies. This is `chainDefines` generalized from "scalars only" to "scalars + a shared ambient source set," and it is entirely Rank-1.

---

## 4. Does this need `Ty::Named`? — No.

Chain globals ride **existing `Ty`**:

- `chainId`, `CHAIN_ID`, `USDC`-as-address, `UniswapRouter`-as-address → **`Ty::Scalar(Scalar::Number)`** via the define channel (`inject_defines`, `assembly.rs:1143`; TS `bigint` define). A uint256 address literal is already a Number in both compilers.
- `USDC.transfer(...)` / `UniswapRouter.execute(...)` → an ordinary **`Contract.at(addr).method()`** call: `Ty::Contract` binding + a normal external call, which both compilers already resolve (RS `self.contracts` registry, `assembly.rs:1567`; the arch doc's inline-`contracts` variant is the only plumbing gap, unrelated to nominal types).

Nothing here needs a nominal brand. `USDC` never needs to be *distinguishable* from a raw `Uint256` at the type level — it *is* one; the sugar is a rewrite/ambient-function over that scalar. `Ty::Named { brand, repr }` (arch doc Rank-2, PR 8) is only for a branded `Chain`/`Reward`/handle type that must *not* interchange with a raw scalar — a surface the current DSL does not exercise. **Confirmed: the lighter scope holds. This feature is entirely Rank-1** (source + flat defines + ambient imports + inline contracts). No `Ty` enum change, no `target_free_type_by_name` (`lower/mod.rs:2114`) change, no `Namespace::ALL` (`:2276`) change.

---

## 5. Updated stacked-PR plan

Folds ambient-import + chain-scoping into the arch doc's **Rank-1** (its 7 PRs). What changes vs the original Rank-1: two of the original PRs (defines/`entry_arg_types` wasm exposure; inline-`contracts`) stay as the foundation; **the ambient-import primitive is now an explicit, symmetric compiler feature on both compilers (new PRs 3–4)**; the chain-bundle activation becomes an explicit SDK PR (7) built on it. Still **short of Rank-2** (no `Ty::Named`, no namespace registry, PRs 8-12 of the arch doc remain deferred/optional).

Each PR: atomic, dependency-ordered, independently green, repo + gate noted.

1. **[RS] Expose `defines` + `entry_arg_types` on the wasm surface.** Pure marshalling in `sauce-wasm` `compile_reported` + a `TYPES` line. *Gate:* a define passes through wasm; existing tests green. *(unchanged from arch doc)*
2. **[RS] Inline-ABI `contracts` variant** on `CompileOptions` (`options.rs`) + wasm. *Gate:* a program compiles against an inline ABI (no path). *(unchanged; still the single most DSL-forcing plumbing change)*
3. **[RS] Ambient-import primitive** — `CompileOptions.ambient: Vec<String>` (+ wasm). Load each specifier via the existing `load_graph`/`resolve_package`; merge exported functions into the global signature table (`assign_global_ids`) and exported consts into the `inject_defines` channel (`assembly.rs:1134`). *Gate:* an ambient module's exported fn + const resolve in a program with **no import line**; shadowing precedence (function-local/param wins) holds; a name-collision with a user function is a clear error. **NEW — the core compiler feature, RS side.**
4. **[TS] Ambient-import parity** — a `CompileOptions.ambient` list that runs `collectImportedFunctions` over the synthetic specifiers and registers their consts via `setDefines`/`addDefine`, merged into `GLOBAL_FUNCTIONS`/`RESERVED_NAMES` (spread-merge already exists, `globals.ts:1034/1115`). *Gate:* the identical program from PR 3 compiles on TS with the same shadowing precedence. **NEW — the core compiler feature, TS side.**
5. **[plugin] Shared plugin skeleton** — Layer A source (move `@sauce/token` in as the first ambient module) + Layer C manifest carrying the **ambient list** and the **name-parity map** (`emit`↔`log`, `throw`↔`revert`, `globals.ts:999-1000/1110-1113`). *Gate:* both compilers compile `@sauce/token` as an **ambient** module (no import line) via PRs 3/4; conformance-fixture parity holds.
6. **[SDK] Compiler selector in the compile seam** (`sauce-route.ts:105-221`) — drive the TS compiler or the #131 compiler-rs npm dep, feeding erased source + `defines` + inline `contracts` + `ambient`. *Depends on 1,2,3,4. Gate:* a route compiles through RS-wasm to a valid program; TS path unchanged.
7. **[SDK] Chain-bundle activation (chain-scoping, Option B)** — the builder threads each chain region's Layer-B define bundle + Layer-A ambient list per compiled program; nested `Base(()=>{ Optimism(()=>{}) })` partitions into per-chain programs via the existing nest cascade (`nest.ts`). *Depends on 5,6. Gate:* a nested cross-chain route compiles each region with the **correct chain's** ambient set + defines, identically through TS and RS (surface parity). **NEW — chain-scoping lands here, entirely SDK.**
8. **[SDK] Move address/token registries + ABIs into Layer B**; both loaders derive `chainDefines`/`contracts` from plugin data. *Gate:* routes unchanged; data single-sourced. *(= arch doc Rank-1 PR7)*

**The stack can stop after PR 8 and ship full current-DSL parity + ambient imports + chain-scoping across both compilers. Rank-2 (`Ty::Named` + namespace/method registry, arch doc PRs 8-12) stays deferred and is not on this critical path.**

Delta vs the original 7-PR Rank-1: original PRs 4-7 (shared plugin, name-parity, move helpers, move registries) are largely preserved; the substantive additions are the **symmetric ambient-import primitive (3+4)** — promoting "ambient" from an implicit TS-only spread-merge to a real, resolver-driven, both-compiler feature — and the **explicit chain-bundle SDK PR (7)**. Nothing crosses into Rank-2.

---

## 6. Risks + the sharpest open question

**Risks:**

1. **Ambient exported-const channel on RS may be genuinely new.** RS cross-module imports register functions + ABI contracts; whether it *also* surfaces an imported module's module-scope `const`s as cross-module values needs confirming in PR 3. If not, that's the one net-new bit — and it rides `inject_defines`'s existing `own.insert` (`assembly.rs:1136`), so it's a merge onto an existing table, not new resolution.
2. **Ambient-name collisions with user code.** A define/ambient-const already loses to a function-local/param (`inject_defines` precedence, `assembly.rs:1131`; TS `getConstant`-only-when-`getVar`-undefined, `context.ts:614`) — good. But an ambient *function* name colliding with a user function is `Error::Redeclared` on RS today; PR 3 must decide "ambient loses to user" precedence or emit a clear ambient-specific error rather than a confusing redeclaration.
3. **Flat-defines means chain switching is program-granular, not statement-granular.** B gives each chain region its own program; it **cannot** express two chains' globals *live simultaneously inside one running `main()`*. That is a feature only A could provide — and (see the open question) it likely has no runtime anyway.
4. **Name-parity (`emit`/`log`, `throw`/`revert`) and canonical-home drift** carry over unchanged from the arch doc (its risks 3 and 5). A shared *plugin* multiplies the `@sauce/token` "change it in sauce and re-copy" hazard unless it has one home + a CI drift check.

**The sharpest open question for the user (it decides A vs B, and whether any grammar work exists at all):**

> **Is each chain region always a SEPARATE program/intent (the existing nest cascade — fund head only, distinct atomic transactions), or does the user want a SINGLE compiled `main()` body that enters `Base`, then `Optimism`, sequentially, sharing one runtime execution?**

- **Separate programs (Option B):** everything above holds — ambient imports (compiler) + per-region bundle selection (SDK), no arrow grammar, no scoped defines, true parity, Rank-1 only. **This is what I recommend, and what the runtime allows.**
- **One shared body switching chains mid-function (Option A):** this needs arrow-block grammar + a scoped-defines stack in **both** compilers (RS rejects arrows today) — *and*, more fundamentally, **it appears to have no runtime**: a Sauce program is atomic on one chain in one transaction, so a single `main()` cannot execute across Base and Optimism. If the user is picturing A, the real question underneath is whether they want *authoring ergonomics* (both chains' globals visible in one editing scope) that still **emit separate programs** — which is B with a nicer surface — or genuine single-transaction cross-chain execution, which the Sauce runtime does not provide.

Confirming that one point — "separate atomic programs per chain, yes?" — validates B, keeps compiler-rs simplest, keeps the whole feature in Rank-1, and confirms no `Ty::Named` and no new grammar are needed.

**Key cites:** RS ambient channels — `inject_defines` `lower/assembly.rs:1121-1147`, `load_graph` `:339`, `resolve_package` `:550`/`resolver.rs:60`, `assign_global_ids` `:918`, namespace-before-scope resolution `lower/mod.rs:2243-2253`, no arrow handling in `frontend.rs`. TS ambient channels — global spread-merge `globals.ts:1034`, `RESERVED_NAMES` `:1115`, stdlib-injects-into-globals doctrine `:989-1008`, `collectImportedFunctions` `processor/index.ts:158-220`, flat module-shared `defines` `context.ts:296`/`setDefines` `:598`/`getConstant` `:614`. SDK chain model — `chainDefines` `sdk/src/routes/ambient.ts:39-63`, `makeChainGlobal`/`openRoute` `builder.ts:73-104`, install-as-globals `sdk/src/routes/globals.ts:139-186`, nesting/cascade `nest.ts`. Governing arch doc: `docs/plans/shared-stdlib-dsl-plugin-architecture.md` (Rank-1 §5 PRs 1-7, inline-`contracts` gap Part 3, `Ty::Named` Rank-2 §2).