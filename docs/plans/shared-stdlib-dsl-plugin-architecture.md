# Shared stdlib/DSL plugin — architecture + stacked-PR plan (fire#44 design)

## RS current-state

Read complete. Here is the RS-lane characterization.

---

# compiler-rs extensibility — current-state map, gap, and options

**Repo:** `/Users/er/Documents/Projects/sauce-compiler-rs`, crate `compiler/crates/sauce-core`, wasm surface `compiler/crates/sauce-wasm`.

**Headline:** compiler-rs has *already made the plugin-vs-library decision the user's directive is reaching for*, and made it the opposite way from a native plugin API. The accepted design (`docs/superpowers/specs/2026-07-29-libraries-and-external-contract-support-design.md`) is **"libraries compile; plugins don't"** — external functionality is ordinary SauceScript modules fetched through the `Resolver`, built on **compiler-owned, hardcoded target-gated builtins**. It explicitly **deleted** the `BindingProvider`/`LowerCtx`/WASM-plugin seams (spec §"Why now", lines 54-61). So the "stdlib-injects-into-globals" model is not a proposal here — it is the shipped architecture for *functions*. What that model has **no story for at all** is **new nominal types** and **new global namespaces**: those remain 100% hardcoded Rust enums with no data-driven or resolver-driven path.

---

## 1. TYPE VOCABULARY — fully hardcoded, closed enum + one match

**The internal type is `Ty`** (`lower/mod.rs:1041-1071`), a closed Rust enum:
```
Ty::Scalar(Scalar)   // Scalar = Number | Bool
Ty::Account          // ECO-1860, target-aware
Ty::Bytes
Ty::Array { element, len }
Ty::Tuple(Vec<(String, Ty)>)
Ty::Void
```

**Named-type resolution is a single hardcoded match** with no registry:
- `target_free_type_by_name(name)` — `lower/mod.rs:2114-2123` — *the* vocabulary, a bare `match name { "Uint256"|"Address"|"number"|"bigint" => …, "bool"|"boolean" => …, "bytes"|"string" => …, "void" => …, "Account" => …, _ => None }`.
- `type_by_name(name, target)` — `lower/mod.rs:2093-2103` — wraps the above and applies the one target-dependent collapse (`Account` → `Scalar(Number)` on EVM via `Backend::account_is_distinct_type()`).
- `named_type` (`:2128`) and `annotation_ty` (`:1924`) are the two callers; `abi.decode` shape strings read `target_free_type_by_name` directly (`lower/codec.rs:571`). The doc at `:2060-2069` is explicit that this one function is the single definition both an annotation and an `abi.decode` shape read.

**Can a new nominal type be introduced today without editing the enum? No.** There is exactly one code path, and it is a literal `match` on string literals. `None` means "not a type" and raises `Error::UnknownType` (`:2133-2140`) — there is no fallback, no lookup table, no injection.

**What adding one costs — measured against the `Account` precedent (ECO-1860).** `Account` is the most recent nominal-type addition, and its design doc (`docs/superpowers/specs/2026-08-07-eco-1860-account-type-svm-manifest-design.md`) is the concrete cost model. A new `Ty` variant must be threaded through every exhaustive match on `Ty`:
- `is_dynamic` (`:1078`), `is_dynamic_shape` (`:1087`), `tag` (`:1094`), `same_shape`/`compatible` (`:1139`)
- the guards: `require_scalar` (`:1147`), `require_account` (`:1174`), `contains_account` (`:1198`)
- target routing via the `Backend` trait (`account_is_distinct_type`, `targets.rs`), lowering, codegen, and the ABI codec (`lower/codec.rs`).

So "add a type" today = a compiler PR touching ~a dozen match sites across `lower/mod.rs`, `codec.rs`, `targets.rs`, `codegen.rs` + release. There is **no plugin-declared-type path whatsoever**.

**Could a plugin-declared type map onto `Ty`?** Only if it is representationally one of the existing variants. A plugin type that is "a scalar with a nominal brand" (the DSL's `Chain`, `Reward`, a token handle, an address-newtype) has **no representation** — `Ty` carries no provenance/brand field (the `same_shape` doc at `:1132-1137` explicitly notes `Ty` "tracks no such provenance today"). A plugin type that is structurally a tuple/bytes could *alias* to `Ty::Tuple`/`Ty::Bytes`, but then it is not nominal — it interchanges with any same-shape tuple, losing exactly the type-safety the DSL wants.

---

## 2. GLOBALS / STDLIB — namespaces hardcoded; stdlib functions are pure SauceScript source

**Two hardcoded enums back every builtin global:**

- **`Namespace`** (`lower/mod.rs:2257-2270`): `Abi, Crypto, Ctx, Math, Evm, Svm, Address`. Enumerated in `Namespace::ALL` (`:2276-2284`, note the `const ALL: [Self; 7]`), resolved by `Namespace::from_name` (`:2286`). The doc at `:2273-2275` states the rule bluntly: *"A new variant belongs here."*
- **`Builtin`** (`lower/mod.rs:1253-1277`): the availability-gated constructs (`AbiEncode`, `EvmRawCall`, `ContractBinding`, `EvmSload/Sstore/Tload/Tstore`, `SvmSload/Sstore/Call/RemainingAccount(s)`, `LogWithTopics`), each mapped to a `Feature` (`:1317`) the capability pass checks.

**Method dispatch within a namespace is also hardcoded**, per-namespace, matching method-name strings:
- Call dispatch `call_expression` (`lower/contract.rs:68-149`) is a fixed if-ladder: `namespace_member` → `match namespace { Abi=>…, Crypto=>self.crypto_call, Ctx=>self.ctx_call, Math=>self.math_call, Svm=>…, Evm=>…, Address=>… }` (`:72-87`), then `inline_chain` (contract binding), then bound-contract `t.method()`, then `scalar_method_name`, `bytes_method_name`, then plain `self.call`.
- Each `*_call` is a hardcoded body: e.g. `math_call` (`contract.rs:306`) parses the method into a `MathOp` and checks a hardcoded `math_arity`; `crypto_call` (`:420`) is `match member.property.name { "keccak256"=>…, "ecdsaVerify"=>…, _ => CryptoUnknownMethod }`. Value-method sugar (`.toLe/.toBe/.slice/.concat`, `.length`) is likewise a fixed `match` (`bytes_method_name` `:1078-1087`, `static_member` `.length` at `expression.rs:456`).

**There is no data-driven / registry path for globals.** The *only* registry-shaped thing in the whole compiler is `self.contracts` — the ABI contract table populated from ABI-JSON imports and the `contracts` manifest option (`resolve_all_contracts`, `assembly.rs:1567`). That is data-driven, but it is narrow: it only produces `Contract.at(addr).method()` external-call bindings against an ABI shape — not new globals, not new types, not new value-methods.

**How RS consumes `@sauce/token`: as ordinary SauceScript source through the Resolver — nothing special.** This is the crux for the parity plan. `program` (`assembly.rs:176`) loads the entry + every transitively-imported `.js`/`.ts` module via `load_graph` (`:336`); a bare specifier `@sauce/token` is mapped to an entry path by `Resolver::resolve_package` (`resolver.rs:44-64`) and then loaded through the same relative machinery, **with per-target arm selection** — `token.evm.js` / `token.svm.js` probed before the neutral `token.js` (`resolve_target_source`, arm-inserting at `assembly.rs:815-836`; the tri-state absence contract that makes arm-fallback correct is `resolver.rs:21-42` / ECO-2033). The token functions are compiled, never compiling. Its per-target bodies bottom out on the hardcoded `svm.sload`/`evm.*` builtins (design doc §"Resolved", `2026-07-29` spec lines 331-344: *"the primary model is JS libraries over target builtins, selected per target by module resolution"*).

**Implication for the directive:** the "refactor stdlib + DSL into one plugin both compilers consume" goal is *already achievable for the function/library layer* — a shared SauceScript source tree resolved through both compilers' resolvers gives parity by construction, exactly as `@sauce/token` does today. The unsolved part is any DSL surface that is **not expressible as SauceScript functions over existing builtins** — new named types, new `X.` global namespaces, new value-method sugar.

---

## 3. RESOLVER / IMPORTS — the one real injection seam, but source-only

`Resolver` (`resolver.rs:31-65`) is a 2-method trait:
- `resolve(path) -> Ok(Some(bytes)) | Ok(None) | Err` — tri-state (found / absent / unreadable), `resolver.rs:42`.
- `resolve_package(specifier, importer) -> path` — bare-specifier → entry path, `resolver.rs:60`.

The core does **all** I/O through it (no fs/network in-core; `lib.rs:2-7`). Import kinds are split by extension in `split_imports` (`assembly.rs:599-637`): `.js/.ts/.mjs/.mts` → SauceScript module; `.json` → contract ABI; bare non-`.json` → package. ABI-JSON imports parse into `ContractAbi` (`abi.rs:106`) and feed `self.contracts`.

**Injection a plugin could ride today:** a host can inject arbitrary **modules and ABI contracts** by answering `resolve`/`resolve_package` — this is a genuine, working seam (it is how the SDK will feed the DSL stdlib). Notably, the trait doc at `resolver.rs:9` already anticipates more: *"every source, import, and (later) plugin artifact is fetched through a `Resolver`"* — i.e. the intended future plugin channel is the resolver, not a separate Rust API.

**What the resolver cannot inject:** anything that is not SauceScript source or an ABI JSON — no new `Ty`, no new `Namespace`, no new `Builtin`, no member/method resolver hook, no compile-time-computation callback. The `2026-07-29` spec deleted the Rust `BindingProvider`/`LowerCtx` plugin channel deliberately (spec §"Why now"; §"Risks" line 296 accepts *"no escape hatch… the fix is a compiler change on the normal release cadence"*).

---

## 4. THE npm SURFACE (`crates/sauce-wasm`) — narrower than `CompileOptions`, callbacks are the only hooks

`compile(options)` (`sauce-wasm/src/lib.rs:299-331`). The TS contract (`lib.rs:243-259`) exposes:
```
{ target, resolve, resolvePackage?, entry?, contracts?, optimize? }
```
- `resolve` (required) + `resolvePackage` (optional) are JS callbacks marshalled into `JsResolver` (`lib.rs:105-203`) — **the sole plugin/injection point the SDK can pass through today.**
- `contracts`: `[name, path]` pairs → the manifest-contracts registry (`optional_contracts` `:419`).
- `optimize`: fold on/off.

**Gaps vs core `CompileOptions` (`options.rs:30-70`):** the wasm layer does **not** expose `defines` (compile-time const injection / conditional compilation) or `entry_arg_types` (`ArgShape` param-shape hints). Both exist in the core and both are plausibly needed by a DSL codegen layer (defines especially — the SDK DSL leans on ambient chain-scoped constants). Adding them is pure marshalling in `compile_reported` + a line in the `TYPES` custom section (`:218`).

There is **no** resolver-independent plugin argument, no type-registry argument, no globals argument on the npm surface.

---

## 5. THE GAP + OPTIONS RANKED

To support "extension types" (a plugin declares nominal types + their globals/members/methods + how they lower), compiler-rs needs, in increasing order of size:

**(A) Globals/namespaces + members/methods — LARGE but partially finessable.** Today `Namespace` (`mod.rs:2257`), `Builtin` (`mod.rs:1253`), and every `*_call` dispatcher (`contract.rs:73-149`) are closed enums + hardcoded matches. But note: *most DSL "globals" don't need new builtins* — `USDC.transfer(...)` desugaring to `IERC20.at(addr).transfer(...)` is already expressible as SauceScript over the existing `Contract.at` binding + the ABI contract registry. The genuinely new-namespace cases (`Chain(...)`, `Portal`, `reward` accessors) are the ones with no builtin backing.

**(B) A type registry — LARGE.** Replace the `target_free_type_by_name` match (`mod.rs:2114`) and the `Ty` enum's fixed variants with a seeded registry, and give `Ty` a nominal/brand carrier (it has none today, `:1132-1137`). Every exhaustive `match Ty` (~12 sites) becomes a lookup. This is the single biggest lift and touches the type checker, codec, and codegen.

**(C) A lowering hook per extension type — LARGEST / architecturally forbidden today.** "How it lowers" means emitting `ir::Expr` — which is exactly the `BindingProvider`/`LowerCtx` plugin channel the `2026-07-29` spec deliberately deleted (spec §19-25, §"Why now"). Reintroducing it reverses an Accepted architectural decision and brings back sandboxing/IR-ABI-versioning costs (spec §"The deciding axis", lines 36-42).

### Ranked recommendation

**Rank 1 — SauceScript-level stdlib injected as source (the stdlib-injects-into-globals model). SMALLEST; already the shipped architecture; delivers parity by construction.**
The DSL's *function/library* layer (token member sugar via `Contract.at`, stdlib helpers, actions lowering to existing builtins) should be one shared SauceScript source tree, resolved through **both** compilers' resolvers — the TS `transformModule`/Resolver seam and the RS `Resolver` (`resolver.rs`) + `resolve_package` + per-target arms. This is *exactly* how `@sauce/token` already works on both sides. Zero core changes to `Ty`/`Namespace`; parity is guaranteed because both compilers compile the same bytes. **This should absorb as much of the DSL as can be expressed as SauceScript functions over the existing type + builtin vocabulary.** Cheap enablers on the RS side: expose `defines` and `entry_arg_types` on the wasm surface (§4) so ambient chain-scoped constants and typed entry params flow through.

**Rank 2 — a declarative type/global *schema* seeded into the registry (bounded, data-driven, no code execution).** For the residue that Rank 1 cannot express — the DSL's *nominal types* (`Chain`, `Reward`, address/handle newtypes) and *new global namespaces* — add a data-driven seed: (i) a nominal-brand field on `Ty` + a registry replacing `target_free_type_by_name`; (ii) a namespace/method registry replacing `Namespace::ALL` + the `*_call` matches, where each method **lowers to an existing `ir` construct or a same-shape SauceScript call** (a declarative "this method == that ABI call / that builtin", *not* arbitrary IR emission). This keeps the "libraries don't compile" invariant: the schema is *data*, lowered by the compiler's own general machinery, so it satisfies the `2026-07-29` spec's escape-hatch stance (§"Risks" line 296) while still being plugin-supplied. It is the largest of the *acceptable* options but the only one that actually closes the extension-**type** gap. Precedent for the per-type threading cost: ECO-1860's `Account` addition.

**Rank 3 (reject) — a native Rust plugin API that emits `ir::Expr`.** This is option (C): it reverses the Accepted 2026-07-29 decision, reintroduces the deleted `LowerCtx`/`BindingProvider` seam, and — fatally for the parity goal — a Rust plugin gives you a *third* implementation to keep in step with TS, the exact opposite of "one source of truth." Do not pursue.

**Net:** the parity-by-construction target is reachable for the DSL's function/action/token layer *today* via Rank 1 (source through the resolver, no core change). The only thing forcing core work is nominal **extension types + new global namespaces**; for those, Rank 2 (a declarative schema seeded through the resolver/options, lowered by the compiler's own machinery) is the cleanest path that both stays inside the shipped "libraries not plugins" architecture and yields one shared definition both compilers consume.

**Key cites:** `Ty` enum `lower/mod.rs:1041`; type vocabulary `lower/mod.rs:2114-2123`; `type_by_name` `:2093`; `Namespace`/`ALL` `:2257-2284`; `Builtin` `:1253`; call/namespace dispatch `lower/contract.rs:68-149`, `math_call:306`, `crypto_call:420`; value-method sugar `contract.rs:1078`, `expression.rs:456`; `Resolver` trait `resolver.rs:31-64` (note "(later) plugin artifact" at `:9`); ABI contract registry `assembly.rs:1567`, per-target arm selection `:815-836`; wasm surface `sauce-wasm/src/lib.rs:243-331`; `CompileOptions` `options.rs:30-70`; the governing architecture decision `docs/superpowers/specs/2026-07-29-libraries-and-external-contract-support-design.md` (§overview, §"deciding axis", §"Why now", §"Risks"); nominal-type-addition precedent `docs/superpowers/specs/2026-08-07-eco-1860-account-type-svm-manifest-design.md`.

## TS + DSL surface

I have a complete picture. Let me write the findings.

---

# TS Compiler Extensibility + Cross-Chain DSL Surface Inventory

## Executive summary

Two facts dominate everything below:

1. **The TS stdlib is *already* a de-facto plugin system — but a bifurcated one.** There are **two distinct stdlib mechanisms**: (a) native-TS `GlobalDef` entries that lower directly to ops or compose primitives (`emit`, `Math.*`), injected into the global namespace by a spread-merge; and (b) **SauceScript *source* libraries** (`@sauce/token`) pulled in through the `Resolver`/import seam as ordinary imported modules. Only (b) is "SauceScript injected into globals" in the literal sense — and even that reaches user code via an *explicit import*, not ambient injection.

2. **The cross-chain intent DSL is 100% an SDK codegen/DSL layer (option (b) in the task), NOT a compiler feature.** It lives entirely in `sdk/src/routes/` (+ `sdk/src/descriptors/`, `sdk/src/token/`). Every "extension type" it exposes is erased *before* `compile()` is ever called: protocol accessors and token sugar are **acorn source-text rewrites** into plain `Contract.at(addr).method()` calls; chain-scoped names become compiler `defines`; ABIs become the compiler `contracts` map. **The compiler sees only plain SauceScript + `defines` + `contracts` + `baseDirs`.** No DSL nominal type (`Chain`, `Token`, `Route`, `Intent`) ever crosses into the compiler on either implementation.

The direct consequence for the "extension types + plugin" plan: **the DSL needs almost no compiler-level extension-type support to work through compiler-rs.** What it needs from compiler-rs is *parity on the two plumbing options it already rides on TS* (`defines` and an **inline** `contracts` map) plus the ability to run the same source-rewrite passes against RS's output. The one genuine compiler-level concept is nominal type *vocabulary* — and even there, the DSL doesn't introduce new nominal types today; the stdlib (`@sauce/token`, `Account`) does.

---

## Part 1 — TS stdlib / globals / extensibility map

### 1a. The three global tables (all in `compiler/src/globals.ts`)

| Table | What it holds | How resolved | Citation |
|---|---|---|---|
| `GLOBALS: Record<string, Record<string, GlobalDef>>` | Member-access namespaces: `Math.*`, `abi.*`, `crypto.*`, `ctx.*`, `msg.*`, `block.*`, `tx.*`, `address.*`, `contract.*`, `storage.*`, `Uint8Array` | member expression `X.y(...)` dispatches through the root identifier before scope lookup | `globals.ts:327` |
| `NATIVE_GLOBAL_FUNCTIONS` | Freestanding intrinsics that lower to a direct op (`gasLeft()`, `blockHash()`, `uint()`, `accountData`, `eval`, …) | bare call intercepted in `processCallExpression` | `globals.ts:867` |
| `STDLIB_FUNCTIONS` | Freestanding **library** functions that *compose* primitives (currently just `emit`) | same bare-call path, after spread-merge | `globals.ts:1009` |

The public export is the **merge**:
```
export const GLOBAL_FUNCTIONS = { ...NATIVE_GLOBAL_FUNCTIONS, ...STDLIB_FUNCTIONS };  // globals.ts:1034
```

### 1b. The `emit()`→library refactor — this is the "stdlib as plugin" model made concrete

`emit` is deliberately NOT a native intrinsic. Its `compile` does no new opcode work — it derives `topic0 = keccak256(signature)`, ABI-encodes non-indexed fields, and lowers to the single native primitive `s.log(data, topics)` (`globals.ts:1014-1023`, helpers `parseEmitArgs`/`buildTopics`/`buildData` at `globals.ts:249-321`). The doc comment (`globals.ts:989-1008`) states the standing design constraint explicitly: *"The standard library is a first-class contributor to the global namespace: stdlib symbols reach user code WITHOUT an explicit import precisely by being INJECTED into globals."* Keeping stdlib in a **separate table then spread-merging** is what makes injection literal — everything downstream (call dispatch, kind inference, `RESERVED_NAMES`) keys off the merged table and sees `emit` identically to a native.

**Note the RS↔TS spelling divergence baked in here** (`globals.ts:999-1000`, `1110-1113`): RS spells the event primitive `log()` and the revert primitive `revert`; TS spells them `emit` and `throw`. TS's freestanding-builtin surface is **wider** than RS's `{revert,require,log,eval}`. This is a real parity seam a shared plugin must reconcile.

### 1c. How a library "claims a global name" (the reservation machinery)

Two reservation sets, both derived from the global tables:

- `RESERVED_NAMES = new Set([...keys(GLOBALS), ...keys(GLOBAL_FUNCTIONS)])` (`globals.ts:1115`) — refused where a **callable is declared** (function decl / inline arrow-const). Prevents the ECO-2011 silent-shadow hazard. Deliberately wider than RS's function-name set.
- A narrower binding-reservation set = the namespace **roots** only (`globals.ts:1117-1132`), refused as a value binding (`let`/`const`/param), matching RS's `Namespace` rule.

So "claiming a global name" = adding an entry to `GLOBALS` or `STDLIB_FUNCTIONS`; the reserved-name sets update automatically. This is the extension seam on the TS side, and it is *code-level* (editing the table), not a data/manifest plugin.

### 1d. How `src/std/` and `@sauce/token` are consumed (Resolver / transformModule)

This is the **second, source-based** stdlib mechanism, and it is the one that actually matches "SauceScript injected into globals":

- `@sauce/token` is a **bare package specifier**. `resolveModuleSource` (`context.ts:695`) sends non-relative specifiers to `resolvePackage` (`context.ts:716`), node_modules-style. Per-target arm selection happens in `resolveInRoots` (`context.ts:746-779`): for target `t` it probes `<base>.<t>.<ext>` (`token.evm.js`/`token.svm.js`) **before** the neutral file, with `dedupKey` on the neutral identity so cross-arm dedup is arm-agnostic (`context.ts:766-774`).
- The import is pulled by `collectImportedFunctions` (`processor/index.ts:158-220`): resolve → `transformModule` (or built-in `tsPartialEval` for `.ts`) → `acorn.parse` → recurse into transitive imports → register each exported `function` (rejecting a `main`, `processor/index.ts:212`).
- `transformModule` is the caller override seam (`index.ts:179`, `context.ts:281`); absent one, `.ts`/`.sauce.ts` auto-runs the fold+strip front-end (`processor/index.ts:182-186`).

So `@sauce/token`'s methods reach user code as **ordinary imported SauceScript functions**, not injected globals — the "no neutral `token.js`" packaging (CLAUDE.md) is deliberate. `src/std/` itself is validation-only (not in the package `files` list yet).

### 1e. Is the TS stdlib already a de-facto plugin? — **Yes, in two halves, neither complete**

- **Native/composing globals** (`emit`, `Math`): a plugin *surface* (separable table, transparent merge) but the plugin *content is TypeScript host code* (a `compile(s, args, process)` closure emitting via the `SaucerLike` builder). Not portable to RS as-is.
- **Source libraries** (`@sauce/token`): genuinely portable — it is **byte-identical SauceScript source** shared with the sauce repo's conformance fixture (CLAUDE.md: "do not edit it here; change it in sauce and re-copy"). This half is *already* the shared-plugin ideal: one source, both compilers consume it via their Resolver. This is the template the DSL-as-plugin should follow.

---

## Part 2 — The DSL: where it lives + what it is

### Location — entirely `sdk/src/routes/` (SDK codegen layer, category (b))

22 files, ~4,564 LOC. Confirmed **zero DSL leak into the compiler** — the `compiler/src` grep hits for "Chain"/"reward" are coincidental substrings (e.g. "forward" in comments), not DSL references. The compiler's only relevant surface is the two generic options `defines` and `contracts` (`index.ts:153`, `ContractsConfig` from `contracts.ts`).

Key files and roles:

| File | Role |
|---|---|
| `builder.ts` | Chain-global surface: `makeChainGlobal`/`createChainGlobals` — every canonical chain becomes a callable `ChainGlobal` (`Base(sauce,opts)` ≡ `Base.route(...)`) forwarding to `openRoute` (`builder.ts:73-104`) |
| `intent-dsl.ts` | `openRoute` (`:389`), `PendingSauceRoute` (`:240`), `BuiltIntent` (`:126`), `IntentOptions` (`:76`), reward/nest orchestration |
| `closure.ts` | `sauceBodyToSource` — `Function.prototype.toString()` → `function main(){...}` via acorn slice (`:36-95`) |
| `sauce-route.ts` | **The compile seam** — runs rewrites then calls `compile()` (`:105-221`) |
| `protocol-rewrite.ts` | `rewriteProtocolAccessors` — `Uniswap.UniversalRouter.execute(x)` → `IUniswapV4_UniversalRouter.at(<addr>n).execute(x)` + emits a `contracts` map (`:1-90`) |
| `token-rewrite.ts` | `rewriteTokenMembers` — `USDC.transfer(x)` → `IERC20.at(USDC).transfer(x)` (U4), and `holder.USDC` → `IERC20.at(<addr>n).balanceOf(holder)` (balance sugar) (`:1-58`) |
| `ambient.ts` | `chainDefines` — chain-scoped scalar `defines` (chainId, protocol addresses, token symbols) (`:39-63`) |
| `portal.ts` / `vault.ts` / `nest.ts` / `encode.ts` / `intent.ts` | Pure TS host logic: ABI/Borsh encoding, keccak intent hashing, CREATE2 vault prediction, submission calldata, cross-chain cascade |

### The compile pipeline (`sauce-route.ts:105-221`) — the whole story

```
closure/string → wrapSauceBody          (sauce-route.ts:132)
              → rewriteTokenMembers      (:154)  [source-text splice → plain SauceScript + prepends ERC20 import + adds TOKEN_BASE_DIRS]
              → rewriteProtocolAccessors (:170)  [source-text splice → plain SauceScript + merges a `contracts` ABI map]
              → compile(source, { target, baseDirs, tsSource, treeshake, defines, contracts })  (:186-193)
              → buildSauceEvmCall/buildSauceSvmCall → one route.calls entry
```

Order is load-bearing (token pass before accessor `self`-sugar, `:143-152`). Ambient defines are merged in `openRoute` via `chainDefines` (`intent-dsl.ts:19`) underneath the caller's own `compile.defines`.

**Verdict: the DSL is category (b) — an SDK codegen/DSL layer that emits plain SauceScript + `defines` + `contracts` on top of `compile()`.** It is NOT (a) a compiler feature and NOT (c) both. Extension types are therefore *not a compiler concern* as the DSL is currently built.

---

## Part 3 — Extension-type inventory, tagged

For each DSL-exposed shape: does the **compiler** need to understand it (member access / method resolution / type-checking), or is it SDK-level TS ergonomics erased before compile?

| DSL shape | Where it's a "type" | Reaches the compiler? | Tag |
|---|---|---|---|
| **`ChainGlobal` / `ChainRoute`** (`Base(sauce,opts)`, `.chain`, `.route`) | TS interface, `builder.ts:32-47` | No — it's a JS callable that runs `openRoute` at *TS runtime*; produces a source string | **SDK-ergonomics** |
| **`PendingSauceRoute`** (`.reward()`, `.nest()`, `.intents()`) | TS interface, `intent-dsl.ts:240` | No — fluent builder, TS runtime only | **SDK-ergonomics** |
| **`BuiltIntent`** (`.hash()`, `.vaultAddress()`, `.publishTx()`, `.publishAndFundTx()`) | TS interface, `intent-dsl.ts:126` | No — pure host calldata/hash helpers (`portal.ts`, `vault.ts`) | **SDK-ergonomics** |
| **`Intent`/`Route`/`Reward`/`Call`/`TokenAmount`** | TS interfaces, `types.ts:40-62` | No — eco-routes schema, encoded by `encode.ts` off-chain | **SDK-ergonomics** |
| **Protocol accessors** (`Uniswap.UniversalRouter.execute`, shapes A–D) | Registry-driven name index, `protocol-rewrite.ts` | **Erased before compile** → becomes `IUniswapV4_UniversalRouter.at(<addr>n).execute(...)`, a call the compiler already handles via `.at()`/`contracts` | **SDK-ergonomics** (source rewrite) |
| **Token member sugar** (`USDC.transfer`, `holder.USDC`) | `token-rewrite.ts` | **Erased before compile** → `IERC20.at(...)` calls | **SDK-ergonomics** (source rewrite) |
| **Chain-scoped ambient names** (`chainId`, `USDC`, `UniswapV4_UniversalRouter` as bare consts) | `ambient.ts` `chainDefines` | **As compiler `defines`** — scalar `bigint\|bool\|number` const bindings | **compiler plumbing** (existing option, not a *type*) |
| **The `contracts` ABI map** the accessor pass emits | `ContractsConfig`, `protocol-rewrite.ts:73` | **As compiler `contracts`** — ABI registration for `.at().method()` resolution | **compiler plumbing** (existing option) |
| **`self`** (bare → `address.self`) | accessor pass `selfSugar` | Erased → `address.self` (native `GLOBALS.address`) | **SDK-ergonomics** (rewrite) |

**Which shapes need compiler-level extension-type support to work through compiler-rs? — None of the DSL's own nominal types.** Every one is either erased to plain SauceScript by an SDK rewrite, or threaded through `defines`/`contracts`. What compiler-rs must provide is **parity on those two options** so the exact same erased output compiles:

- `defines`: **present** in RS (`options.rs:57`, `pub defines: Vec<(String, Word)>`; injected at `assembly.rs:225`/`inject_defines` `:1134`). ✅ parity exists.
- `contracts`: **present but SHAPE-DIVERGENT** — this is the one concrete compiler-level gap. TS `ContractsConfig` = `Record<name, { abi: Abi-object }>` (inline ABI, registered directly by `new CompilerContext`, `index.ts:316`; the DSL relies on this — `protocol-rewrite.ts:27-32` notes "ZERO import line and ZERO baseDirs"). RS `contracts` = `Vec<(String, String)>` = **name → ABI-JSON-*path*** resolved through the `Resolver` (`options.rs:36-39`; wasm `:252-256` "`[name, path]` pairs … each `path` resolves as an inline" ABI file). **compiler-rs cannot accept the DSL's synthesized *inline* ABI map today** — it would need either an inline-ABI contracts variant or the SDK writing each ABI to a resolver-visible path. This is the single most important compiler-rs change the DSL requires, and it is plumbing, not a nominal extension type.

The only genuine *nominal-type vocabulary* concern lives one layer down in the stdlib, not the DSL: RS's type vocabulary is a **closed match** — `target_free_type_by_name` (`lower/mod.rs:2114-2123`: `Uint256|Address|number|bigint|bool|boolean|bytes|string|void|Account`) with the one target-aware entry (`Account`) resolved in `type_by_name` (`:2093-2103`). Adding a new nominal type = editing that match; there is **no plugin hook** for it. Same for `Namespace` (`:2257-2303`, closed 7-variant enum, `ALL` at `:2276`) and `Builtin`. **If a future plugin wants to introduce a real nominal type or namespace (beyond what erases to scalars/calls), *that* is where compiler-rs extension-type support would have to be built.** The DSL as written does not need it.

---

## Part 4 — Shared-plugin readiness: SauceScript-expressible vs TS-host logic

### Already SauceScript (injectable into globals / importable as source) — the easy half

- **`@sauce/token`** — the proven template: byte-identical SauceScript source, per-target arms, consumed by *both* compilers through their Resolvers (RS `resolver.rs:44-64` `resolve_package` explicitly models `@sauce/token`; assembly arm-probing at `assembly.rs:646-652` mirrors TS `context.ts:766`). A shared plugin should be **exactly this shape**.
- **The erased DSL output** — after the rewrites, protocol/token calls are ordinary `Contract.at(addr).method(args)` SauceScript. Nothing host-specific survives into the program body.
- **`emit`/`log`, `Math.*`** — expressible as composing SauceScript-or-primitive libraries in principle, but currently authored as TS `GlobalDef` closures (must be re-authored as source or as a shared lowering spec to be plugin-portable). Spelling divergence (`emit`↔`log`, `throw`↔`revert`) must be resolved in the plugin's name map.

### Genuinely TS-host logic a plugin format must ALSO carry (cannot be SauceScript)

These are the parts of the DSL that run at *TS build time* and have no SauceScript representation. A shared plugin must express them as **data + a portable transform contract**, not as SauceScript:

1. **Address registries** — `descriptors/registry.ts` (per-protocol ABI exports `:31+`, `CONTRACT_LINKS`, `perChainAddress`) and `token-registry.ts` (curated per-chain symbol→address). These become `defines` values and rewrite targets. **Plugin must carry**: chain × protocol × contract → address tables, and chain × symbol → address tables (pure data).
2. **keccak signature / selector computation** — `contracts.ts:58-63` `computeSelector` (viem `keccak256`), and `emit`'s `topic0` derivation. Both compilers compute selectors internally, but the DSL's ABI shaping is TS-side. **Plugin must carry**: the ABIs (data), and rely on each compiler's own selector logic.
3. **ABI shaping / the `contracts` map synthesis** — `protocol-rewrite.ts` builds `ContractsConfig` from descriptors. **Plugin must carry**: the ABI JSON (data) + a way to hand it to compiler-rs inline (blocked today by the `Vec<(name,path)>` shape — see Part 3).
4. **The source-rewrite passes themselves** — `rewriteProtocolAccessors`, `rewriteTokenMembers`, `sauceBodyToSource` are **acorn-based TS transforms**. For "parity by construction," either (a) these rewrites run in the SDK against *both* compilers' inputs identically (cheapest — they already produce plain SauceScript), or (b) they are reimplemented as compiler-rs source transforms. Given they emit plain SauceScript, **(a) is strongly indicated**: keep the rewrites SDK-side, feed the erased source to whichever compiler.
5. **Off-chain-only host logic** — CREATE2 vault prediction (`vault.ts`, viem `encodePacked`/`keccak256`), intent hashing (`encode.ts`), Portal/Borsh submission calldata (`portal.ts`, `nest.ts`). **This never touches either compiler** — it's pure SDK. A "plugin" need not carry it at all; it stays SDK library code.

### The shape a shared plugin must have

A shared plugin, to give parity by construction, is therefore **not** "the DSL ported into RS." It is:

- **A source layer** (SauceScript, per-target arms) — the `@sauce/token` model, extended with any protocol interface libraries. Consumed identically by TS Resolver and RS Resolver.
- **A data layer** (JSON) — address registries, token registries, ABIs. Fed to each compiler as `defines` + `contracts`.
- **A transform contract** — the acorn rewrite passes, run **once in the SDK** producing plain SauceScript, so both compilers receive identical erased input.
- **One compiler-rs change** — accept an **inline** ABI `contracts` variant (parity with TS `ContractsConfig`), so the SDK's synthesized ABI map works without writing temp files.
- **A name-parity reconciliation** — `emit`/`log`, `throw`/`revert`, and the wider TS freestanding surface, unified in the plugin's global-name map (the one place RS and TS genuinely disagree at the primitive level today).

**Bottom line:** because the DSL already erases to plain SauceScript + `defines` + `contracts`, the extension-type/plugin work is overwhelmingly *plumbing and data-sharing parity*, not new compiler nominal-type machinery. The only compiler-rs code change the current DSL forces is the inline-`contracts` shape; new *nominal* extension types (touching `type_by_name`/`Namespace`/`Builtin`) are a stdlib-evolution concern the DSL does not exercise today.

## SYNTHESIS

# Shared-Plugin / Extension-Type Architecture for DSL Parity Across `sauce-sdk/compiler` (TS) and `compiler-rs`

This synthesizes the two investigations into one buildable design. The decisive fact both investigations converge on: **the cross-chain DSL already erases to plain SauceScript + `defines` + `contracts` before `compile()` is ever called**, and RS has *already made* the "libraries compile, plugins don't" decision (2026-07-29 spec). So this is not a "port the DSL into Rust" problem and it is not a "build a Rust plugin VM" problem. It is overwhelmingly a **plumbing + data-sharing parity** problem, with a *small, optional* declarative extension-type schema reserved for a residue the current DSL does not yet exercise.

The design is therefore biased hard toward **one shared SauceScript source tree + shared data, consumed through both compilers' existing `Resolver` seams** — the `@sauce/token` model, generalized — and keeps the genuinely-new-compiler-machinery to the minimum that RS's architecture already sanctions.

---

## 1. The plugin format — HYBRID, three layers + a manifest

**Verdict: a hybrid package, dominated by the source-library layer, with a small declarative manifest for the residue that SauceScript source cannot express.** Not "SauceScript-only" (it can't carry nominal types or the emit↔log name reconciliation as source); not "declarative-manifest-only" (that would throw away the fact that 90% of the DSL is already SauceScript-expressible and works on both compilers *today*).

The plugin is a package (`@sauce/plugin-*`) with:

**Layer A — Source library (SauceScript, per-target arms). The dominant layer.**
- Ordinary SauceScript modules resolved through each compiler's `Resolver`, with `.evm.js` / `.svm.js` arm selection — *exactly* the `@sauce/token` mechanism that already works on both sides (TS `context.ts:746-779`; RS `resolver.rs:44-64` + arm-probing `assembly.rs:815-836`).
- Holds: token-interface helpers, action-lowering helpers, protocol-interface wrappers — anything expressible as SauceScript over `Contract.at(addr).method()` + existing builtins.
- Parity here is **by construction**: both compilers compile the same bytes. Zero core change.

**Layer B — Data (JSON), surfaced as `defines` + `contracts`.**
- Address registries (chain × protocol × contract → address), token registries (chain × symbol → address), and ABIs.
- Consumed as compiler options, not as a type system. This is where `descriptors/registry.ts`, `token-registry.ts`, and the protocol ABIs go (pure data).

**Layer C — Declarative manifest (`plugin.manifest.json`). Small, and *optional* for today's DSL.**
- **Name-parity map** — the one place TS and RS genuinely disagree at the primitive level: `emit`↔`log`, `throw`↔`revert`, and TS's wider freestanding surface (`globals.ts:999-1000, 1110-1113`). This *must* be data both loaders read; it cannot be SauceScript.
- **Ambient-injection list** — which module exports are pre-bound into the global namespace without an explicit import (the TS "stdlib injected into globals" semantics, `globals.ts:989-1008`). Most of the DSL's "ambient" surface is actually `defines` (scalars) and rewrites, so this list is short.
- **(Reserved / forward-looking) declarative type + namespace schema** — nominal types (`Chain`, `Reward`, address/handle newtypes) and new `X.` namespaces, *each method declaring how it lowers to an existing IR construct or a same-shape SauceScript/ABI call* — **never arbitrary IR emission**. This keeps the "libraries not plugins" invariant (2026-07-29 spec §"Why now"): the schema is *data*, executed by the compiler's own general machinery.

**Why hybrid, justified from what the DSL actually needs (per the TS inventory Part 3):**
- Protocol accessors, token sugar, `self` → **erase to plain `Contract.at().method()`** → Layer A + the SDK rewrite passes. No compiler type needed.
- Chain-scoped ambient names → **`defines`** (scalars) → Layer B. Not a type.
- ABI map → **`contracts`** → Layer B. Not a type.
- keccak sigs / CREATE2 / Borsh / Portal calldata → **host-only TS**, stays in the SDK (a plugin can't and shouldn't express it).
- **New nominal types: zero, today.** Every DSL "type" is a TS interface erased before compile.

So **Layer C's type/namespace schema is not on the critical path for current DSL parity.** It is the hook for when a DSL surface *wants* a nominal type that survives into the compiler (e.g. a branded `Chain` scalar that must not interchange with a raw `Uint256`). Build A+B first; C is a later, gated increment.

---

## 2. Extension types — minimal compiler-rs mechanism (reuse, don't reinvent)

RS's own accepted architecture (2026-07-29 spec) already dictates the shape: **the injection channel is the `Resolver`, not a native Rust plugin API** (`resolver.rs:9` literally anticipates "(later) plugin artifact… fetched through a `Resolver`"). Rank-3 (a Rust plugin emitting `ir::Expr`) is rejected — it reverses the accepted decision *and* creates a third implementation to keep in step, the opposite of one-source-of-truth.

The minimal mechanism, mapped onto existing RS structures:

**(i) Fetch the manifest through the existing `Resolver`.** Add a well-known manifest path resolved via `resolve_package`/`resolve` (`resolver.rs:31-65`). No new I/O channel — the core still does zero fs/network (`lib.rs:2-7`). When the SDK drives RS-wasm, the `JsResolver` (`sauce-wasm/src/lib.rs:105-203`) answers manifest fetches too; when RS runs native (sauce-cli), the FS resolver does.

**(ii) Nominal types: one new `Ty` variant that *delegates to a repr*.**
- Add `Ty::Named { brand, repr: Box<Ty> }` to the enum (`lower/mod.rs:1041-1071`). `brand` gives nominal identity; `repr` is an existing variant (scalar/tuple/bytes).
- Thread it through the ~12 exhaustive matches (ECO-1860's `Account` addition is the exact cost precedent) by **delegating to `repr`** for shape questions — `is_dynamic` (:1078), `tag` (:1094), codec (`codec.rs`), codegen — and keeping `brand` *only* where nominal identity matters: `same_shape`/`compatible` (:1139), whose doc already flags "tracks no such provenance today" (:1132-1137). This is the smallest change that yields nominal safety without an open type system.
- Replace the hardcoded tail of `target_free_type_by_name` (:2114-2123) with **builtins-first, then a seeded registry**. Builtin names resolve byte-identically (no behavior change); manifest-declared names fall through to the registry. `type_by_name` (:2093) and its target collapse are unchanged.

**(iii) New namespaces/methods: a registry with *declarative* lowering.**
- Replace the closed `Namespace::ALL` (:2276) + the `*_call` if-ladder tail (`contract.rs:73-149`) with a registry lookup for *non-builtin* namespaces (builtins stay hardcoded and first).
- Each registered method carries a lowering *template*, drawn from a fixed vocabulary:
  - **"== this ABI call"** → reuse the existing `self.contracts` binding machinery (`assembly.rs:1567`) — this is exactly what `USDC.transfer` → `IERC20.at(addr).transfer` already needs and what the contract registry already does.
  - **"== this existing builtin with these args"** → map onto an existing `Builtin`/`Feature` (:1253-1317). A plugin method may only reference an *existing* builtin; it may **never declare a new `Builtin` or `Feature`** (capability gating stays compiler-owned).
- The registry **never emits `ir::Expr`.** It declares data; the compiler's own general lowering executes it. That is precisely the line between acceptable Rank-2 and forbidden Rank-3, and it satisfies the spec's escape-hatch stance (§"Risks" line 296).

**(iv) Cheap wasm-surface enablers (needed regardless, do first):**
- Expose `defines` (core has it: `options.rs:57`, injected `assembly.rs:1134`) and `entry_arg_types` on the wasm surface — pure marshalling in `compile_reported` + a `TYPES` line (`lib.rs:218`). The DSL's ambient chain-scoped constants ride `defines`.
- **Accept an inline-ABI `contracts` variant** — the single most important DSL-forcing change. TS `ContractsConfig` = name→inline ABI object (`index.ts:316`; the DSL depends on it — `protocol-rewrite.ts:27-32` "ZERO import line and ZERO baseDirs"). RS `contracts` = name→ABI-JSON-*path* (`options.rs:36-39`, wasm `:252-256`). Add an inline variant so the SDK's *synthesized* ABI map compiles without writing temp files.

**TS-side change — small, because TS is already injection-based.**
- TS already spread-merges stdlib into globals (`globals.ts:1034`) and auto-derives `RESERVED_NAMES` (:1115). Add a **manifest loader** that data-populates `GLOBALS` / `STDLIB_FUNCTIONS` from Layer C's namespace schema and applies the name-parity map — the reserved-name sets then update automatically.
- Nominal types matter *less* on TS: the ts-frontend strips types before acorn and the core is uint256-only, so a brand is mostly a front-end/ergonomics concern there. TS parity is primarily about **namespace names, global-name reconciliation, and lowering equivalence**, not a `Ty`-style checker. The manifest is the shared source both loaders read.

---

## 3. What moves where

**Into the shared plugin (authored once):**
| Piece | Layer | Notes |
|---|---|---|
| `@sauce/token` | A (source) | Already byte-identical across repos; becomes the plugin's first source module — retires the copy-drift problem *if* the plugin has one canonical home (see §6). |
| Protocol-interface wrappers, token-sugar helpers, action lowering | A (source) | Anything expressible as SauceScript over `Contract.at` + builtins. |
| Address registries, token registries, protocol ABIs | B (data) | `descriptors/registry.ts`, `token-registry.ts` → JSON. Surfaced as `defines` + inline `contracts`. |
| Name-parity map (`emit`↔`log`, `throw`↔`revert`) | C (manifest) | The one primitive-level disagreement. |
| Ambient-injection list | C (manifest) | Short. |
| *(future)* nominal types + new namespaces | C (manifest) | Not exercised by today's DSL. |

**Stays SDK-host TS (a plugin cannot express it):**
- The **acorn rewrite passes** — `rewriteProtocolAccessors`, `rewriteTokenMembers`, `sauceBodyToSource` (`protocol-rewrite.ts`, `token-rewrite.ts`, `closure.ts`). They run **once in the SDK loader** and emit plain SauceScript, so both compilers receive *identical erased input*. This is the "transform contract": it is SDK code, but its *output* is what gives parity by construction. (Long-term, some of these could fold into Layer C's schema, retiring the bespoke rewrite — but only if RS-native must also produce the sugar; see §6.)
- **Off-chain host logic** — CREATE2 vault prediction (`vault.ts`), intent hashing (`encode.ts`), Portal/Borsh submission calldata (`portal.ts`, `nest.ts`), nest cascade. Never touches a compiler; single-source it in SDK TS.
- **Fluent builder types** — `ChainGlobal`, `PendingSauceRoute`, `BuiltIntent` (`builder.ts`, `intent-dsl.ts`). Pure TS ergonomics; erased before compile.

**Authored once, consumed twice — the two loaders:**
- **TS loader:** extends `collectImportedFunctions`/Resolver (`processor/index.ts:158-220`) for Layer A, feeds Layer B as `defines`/`contracts`, and reads Layer C's manifest to populate `GLOBALS`/`STDLIB_FUNCTIONS`/name-map.
- **RS loader:** the `Resolver` already fetches source (A) and ABI (B); add a manifest-fetch (C) that seeds the type/namespace registries. **Two consumption paths** must both work:
  1. **SDK drives RS-wasm** (the #131 npm dep): SDK runs the rewrites, then feeds erased source + `defines` + inline `contracts` + the plugin source/manifest through the `JsResolver`. Parity with the TS path is guaranteed — same erased bytes.
  2. **RS native** (sauce-cli, conformance): FS resolver supplies A/B/C. Gets the stdlib and manifest surface, but **not the SDK-side sugar** (no rewrites) — see the §6 open question.

---

## 4. Parity definition under this model

**"Same plugin → same surface on both compilers"** = given the same plugin package (A+B+C) and the same *erased* program source + `defines` + `contracts`, both compilers **accept/reject the same programs, resolve the same names to the same meanings, and admit the same type vocabulary**. Parity is defined at the **surface level**, not the byte level.

**What legitimately still diverges:**
- **Engine lineage / wire format.** RS wasm emits for the sauce `main` lineage; the TS compiler emits for the pinned `release/beta` lineage. Opcode encodings already differ (JUMP/JUMP_I, `NEW_ARRAY` scalar encoding, `MLOAD/MSTORE/MALLOC` — per CLAUDE.md). **Bytecode bytes differ; behavior parity is per-engine.** This is orthogonal to plugin parity and must not be conflated with it.
- **Per-target arms** (`.evm.js`/`.svm.js`) — intended divergence, not a parity break.
- **Optimization/fold depth.** TS carries a large ts-frontend fold suite; RS has `optimize`. Bytecode *size* may differ; **semantics must not**.
- **Host-only logic** (CREATE2, hashing, Borsh) — not a compiler surface; no parity claim. Single-sourced in SDK TS regardless.
- **SDK-side sugar in RS-native** — if the rewrites stay SDK-only, an RS-native user sees only erased SauceScript, not the DSL sugar. This is a *deliberate* scope line, not a parity break — unless the user decides RS-native must produce sugar (§6).

Parity is verified by a **cross-compiler conformance suite**: the same programs + plugin compiled through both, asserting equivalent accept/reject and equivalent behavior on each compiler's own engine (the `@sauce/token` `compile.test.ts` + e2e pattern, generalized).

---

## 5. Phased plan — incremental atomic stacked PRs

Ordered by dependency; each independently green; repo + gate noted. **Rank-1 (source + plumbing) delivers full current-DSL parity by PR 7; Rank-2 (nominal-type machinery, PRs 8-12) is only needed when a DSL surface wants a compiler-visible nominal type — the current DSL does not.**

**Rank-1 — plumbing + shared source (delivers DSL parity):**

1. **[RS] Expose `defines` + `entry_arg_types` on the wasm surface.** Pure marshalling (`sauce-wasm/src/lib.rs` `compile_reported` + `TYPES`). *Gate:* wasm builds; new test passes a define through; existing tests green.
2. **[RS] Inline-ABI `contracts` variant** on `CompileOptions` (`options.rs`) + wasm surface. *Gate:* RS compiles a program against an inline ABI (no path). — *The single most important DSL-forcing change.*
3. **[SDK] Compiler selector in the compile seam** (`sauce-route.ts:105-221`): drive either the TS compiler or the #131 compiler-rs npm dep, feeding erased source + `defines` + inline `contracts`. *Depends on 1,2. Gate:* a route compiles through RS-wasm to a valid program; TS path unchanged.
4. **[sauce or SDK — see §6] Shared plugin skeleton:** package with Layer A (move `@sauce/token` in as the first module) + Layer C manifest carrying the name-parity map. *Gate:* both compilers compile `@sauce/token` from the plugin via their resolvers; conformance fixture parity holds.
5. **[RS] Name-parity:** honor the manifest name map (`emit`↔`log`, `throw`↔`revert`) with back-compat aliases. *Gate:* a program in the unified spelling compiles on both compilers.
6. **[SDK] Move source-expressible DSL helpers into Layer A** (token-sugar helpers, action lowering); rewrites now target plugin-provided interfaces. *Gate:* DSL routes compile identically through TS and RS (surface parity).
7. **[SDK] Move address/token registries + ABIs into Layer B**; both loaders derive `chainDefines`/`contracts` from plugin data. *Gate:* routes unchanged; data single-sourced.

**Rank-2 — declarative extension types (only when a DSL nominal type is wanted):**

8. **[RS] `Ty::Named { brand, repr }`** threaded through the ~12 exhaustive matches (delegate-to-repr). *Gate:* builtin types byte-identical; a branded type round-trips through checker/codec/codegen.
9. **[RS] Type registry** — builtins-first, then manifest-seeded (`target_free_type_by_name` tail). *Gate:* a manifest-declared type resolves; builtins unchanged.
10. **[RS] Namespace/method registry with declarative lowering** (== ABI call / == existing builtin); replace `Namespace::ALL` tail + `*_call` fallback. *Gate:* a manifest namespace method lowers correctly; existing namespaces byte-identical.
11. **[TS] Manifest loader** populates `GLOBALS`/`STDLIB_FUNCTIONS` (+ optional nominal-type table) from the same manifest. *Gate:* TS resolves the same manifest-declared surface as RS.
12. **[SDK] Fold remaining DSL nominal surface into Layer C**; retire the bespoke rewrites the schema now covers. *Gate:* full cross-compiler DSL parity suite.

*(The stack can stop after PR 7 and still ship DSL parity across both compilers.)*

---

## 6. Risks + the biggest open question

**Risks:**
1. **Schema creep into IR emission** would reverse the accepted 2026-07-29 "libraries not plugins" decision and reintroduce the deleted `BindingProvider`/`LowerCtx` costs. *Mitigation:* Layer C is strictly data lowered by existing machinery (== ABI call / == existing builtin); a plugin never emits `ir::Expr` and never declares a new `Builtin`/`Feature`.
2. **`Ty::Named` threading regressions** — ~12 exhaustive matches across checker/codec/codegen (ECO-1860 is the precedent for the blast radius). *Mitigation:* delegate-to-repr keeps every shape question unchanged; brand touches only `same_shape`/`compatible`.
3. **Name-parity is a breaking change** if `emit`→`log` (or `throw`→`revert`) is renamed rather than aliased. *Mitigation:* keep both spellings as aliases via the manifest map.
4. **Two consumption paths** (SDK-drives-RS vs RS-native) means the manifest/source loader must behave identically through the `JsResolver` and a native FS resolver — a divergence surface of its own. *Mitigation:* one cross-compiler conformance suite exercising both resolver paths.
5. **Canonical-home drift.** `@sauce/token` is currently kept byte-identical by manual copy across repos ("change it in sauce and re-copy"). A shared *plugin* multiplies that hazard across the whole plugin unless it has exactly one home + a drift check (the sync-artifacts / CI-fails-on-drift pattern already used for engine artifacts is the template).

**The biggest open question for the user (this one decision reshapes the whole stack):**

> **Where does the shared plugin live (canonical home), and must the DSL *sugar* work in the RS-native compiler (sauce-cli / conformance), or only when the SDK drives RS-wasm?**

- The directive says "the DSL source stays in the SDK repo" and "the SDK imports compiler-rs as an npm package (#131)" — which points to **rewrites staying SDK-side**, the plugin's *canonical home being the SDK*, and RS consuming it via the resolver. Under that reading, PRs 1-7 deliver full parity, the acorn rewrites never move, and **RS-native gets only erased SauceScript, not the sugar** — a clean, cheap scope line.
- But if RS-native (sauce-cli, the conformance harness) must *also* accept the DSL sugar directly (`USDC.transfer`, `Uniswap.UniversalRouter.execute`, `Chain(...)`), then the acorn rewrites can no longer stay SDK-only: that sugar must be reimplemented as RS source transforms **or** promoted into Layer C's declarative schema (nominal types + namespaces) — which is precisely what makes PRs 8-12 mandatory rather than optional, and what forces the `Ty::Named`/namespace-registry work.

Everything downstream — whether Layer C's type schema is built at all, whether PRs 8-12 are on the critical path, and whether `@sauce/token`'s copy-drift problem gets solved or multiplied — hinges on this single answer.
