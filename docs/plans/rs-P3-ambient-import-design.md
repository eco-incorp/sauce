# P3 [RS] — Ambient-import primitive (`CompileOptions.ambient`) — build-ready design

**Status:** design-ready (fire#49). Stacks on P2 (`plugin-inline-contracts`) → new branch `plugin-ambient`.
The core NEW compiler feature of the plugin epic. Companion: `ambient-import-chain-scope-design.md`
§1.2/§5.3/§6 (mechanism, stack slot, risks). This note pins the mechanism against the ACTUAL RS code
so it dispatches without re-investigation.

## What ambient means (settled)
"Ambient" = the same resolution + registration a normal `import { x } from "./mod"` does, but seeded
from an **option list** instead of `ImportDeclaration` nodes, and **broadcast into every module's
resolution tables** so an un-imported program body can name the exports. An OPTION, not new syntax
(base SauceScript has no ambient-import form; RS's frontend rejects arrows/closures — do NOT fork the
grammar). Trigger: `CompileOptions.ambient: Vec<String>` (specifiers, each resolved exactly as a
bare/relative import is), surfaced on wasm next to `contracts`/`defines`.

## Facts confirmed against the RS code (crates/sauce-core/src/lower/assembly.rs)
- **Imported consts ARE already cross-module.** `import { FEE }` draws an exported module-scope const:
  "an import binds one namespace: exported functions then exported bindings" (`:1459-1460`);
  `module_values` fills `values.exported` for an exported const/binding (`:1179-1200`); test
  `an unexported binding is not importable` (`:5433`). So the ambient CONST channel reuses the existing
  `ModuleValue` representation — no new evaluation. (Resolves design-doc §6 risk #1: NOT net-new
  machinery, just a broadcast.)
- **`inject_defines` (`:1134`)** already broadcasts `(name, Word)` into EVERY module's `own` value
  table as a module-scope const, and a function-local/param still shadows it (`Lowerer::module_value`
  returns `None` under a lexical binding, `:1131`). This is the exact broadcast+precedence shape the
  ambient CONST channel needs — but see the precedence difference below.
- **`assign_global_ids` (`:918`)** tables EVERY loaded module's functions into one global `FunctionId`
  space and returns `(own_tables, exported_tables)` per module. A function is only CALLABLE from module
  X if it is in X's SCOPE — wired by `resolve_module_scopes` (`:1428`) from import specifiers. So an
  ambient function needs to be injected into every module's scope (it has no import line).
- **`load_graph` (`:339`)** walks the entry's imports to build the module set; `resolve_package`
  (`:550`) maps a bare specifier. Ambient specifiers must be added as EXTRA graph roots.

## Mechanism — two broadcasts + graph roots
1. **Ambient specifiers → extra module-graph roots.** In `program()`/`load_graph`, after seeding from
   the entry's `ImportDeclaration`s, ALSO seed from `ambient` specifiers (resolve each via the same
   `resolve_package`/`resolve` path, dedup against already-loaded modules by resolved path). Each
   ambient module is parsed + frontend-checked like any module. **Reject an ambient module that
   defines `main`** (mirror the import-side `main` rejection; an ambient module is a library).
2. **Ambient exported CONSTS → every module's `own` value table** (broadcast, like `inject_defines`)
   — source the `(name, ModuleValue)` pairs from each ambient module's `exported` `ModuleValues`
   (already built by `module_values`). **Precedence: insert-if-ABSENT (ambient is a fallback; user
   code wins).** This DIFFERS from `inject_defines`, which OVERRIDES a source const (caller's flag
   wins). Ambient is stdlib-like: the standing `stdlib-injects-into-globals` constraint says user
   names shadow injected globals. So add a sibling `inject_ambient_consts` (insert-if-absent), do NOT
   reuse `inject_defines`'s override insert. A function-local/param still shadows it for free (the
   `module_value`-returns-None-under-lexical-binding path is unchanged).
3. **Ambient exported FUNCTIONS → every module's function SCOPE** (broadcast) — inject each ambient
   module's exported `FunctionSignature` (global id already assigned by `assign_global_ids`) into every
   module's scope table, **insert-if-absent** so a user's own declared/imported function of the same
   name WINS (shadows ambient) silently — the "ambient loses to user" precedence (design-doc §6 risk
   #2 decision). An ambient-vs-ambient duplicate name across two ambient modules IS an error
   (`DuplicateFunction`-style, since neither is "the user's").

## Precedence summary (decided)
`function-local / param` > `user module-scope const|let` / `user declared|imported function` >
**ambient const|function** > (`defines` remain override-the-source, unchanged — a caller flag, not a
library symbol). Ambient never overrides user code; user code never needs to know ambient exists.

## Surfaces to touch
- `options.rs`: `#[builder(default)] pub ambient: Vec<String>` + doc.
- `lower/assembly.rs`: thread `ambient: &[String]` into `program()`; extend `load_graph` roots; add
  `inject_ambient_consts` (own-table, insert-if-absent) + ambient-function scope injection; reject
  `main` in an ambient module; dedup ambient roots vs the import graph by resolved path.
- `lib.rs`: pass `&options.ambient` into `program()`.
- `sauce-wasm/src/lib.rs`: `ambient?: Array<string>` on the TS `CompileOptions` + `optional_ambient`
  marshaller (a plain `Array<string>`, simpler than `optional_contracts`) + builder call.

## Tests (TDD, borrow the import-side patterns)
- An ambient module's exported FN + CONST resolve in a program with **NO import line** (the headline).
- Shadowing: a user function-local/param and a user top-level fn/const of the same name WIN over
  ambient (compiles to the user's meaning, ambient ignored).
- Ambient-vs-ambient duplicate name → a clear error.
- An ambient module defining `main` → rejected.
- Negative control: with `ambient: []`, byte-identical to today (no behavioral change).
- Parity seed for PR-4: keep the fixture SauceScript identical to what the TS side will compile in P4.

## Gate
`cargo build --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` ·
`~/.cargo/bin/cargo +nightly fmt --all` + diff-check · `cargo test -p sauce-core` · `-p sauce-wasm`.
No push, no PR, no AI attribution. Report SHA + per-command results.

## Out of scope (deferred, per the epic)
`Ty::Named`/namespace registry (Rank-2); chain-scoping (that's SDK PR-7, Option B, on top of this);
value-method sugar. P3 is purely the resolver-driven ambient broadcast.
