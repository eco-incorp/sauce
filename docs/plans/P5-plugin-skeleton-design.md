# P5 [plugin] — shared plugin skeleton — build-ready design (fire#52)

**Status:** design-ready. Stacks conceptually on P3 (RS ambient) + P4 (TS ambient) — both DONE. Companion:
`shared-stdlib-dsl-plugin-architecture.md` (Layer A/B/C), `ambient-import-chain-scope-design.md` §5.5.
This note pins P5's concrete first cut + flags the ONE decision that is the user's.

## What P5 proves (the concrete deliverable)

The plugin mechanism end-to-end: **both compilers compile a program that uses `@sauce/token`'s functions
with NO `import` line — via the ambient option (P3/P4) — driven by a shared Layer-C manifest that declares
the ambient list + the emit/throw name-parity map.** This is the first REAL stdlib module (not the `double(x)`
toy fixture) proving ambient parity is usable, and the skeleton every later plugin module slots into.

## Resolved unknowns (verified against code this fire)

- **RS bare/package ambient specifier works.** `Loader::visit` keys `index_by_path` by the GRAPH KEY = the
  raw specifier string (assembly.rs:480), not the resolved path; `ambient_module_indices.get("@sauce/token")`
  therefore hits. The P3 "bare-specifier `.expect()` panic" worry is UNFOUNDED — a package ambient specifier
  resolves like any import. (RS `resolve_package` + the per-target-arm `resolve_target_source` pick
  `token.<target>.js`; `@sauce/token` has NO neutral arm, which is fine — the arm resolver only falls back to
  neutral when a target arm is absent.)
- **TS side:** ambient resolves via the same `baseDirs`/node_modules lookup a real import uses (P4's
  `collectFunctionsFromSpecifier`), and `@sauce/token`'s two arms are already handled by the existing
  `resolveModuleSource` arm logic (the existing `sdk/test/std/token/compile.test.ts` compiles both arms today
  via IMPORT — P5 flips that to AMBIENT).

## The one decision that is the USER's (flagged, with a reversible default)

**Where does the shared plugin ultimately live / how is it packaged?** Options span: (a) a new top-level
`plugin/` package in sauce-sdk; (b) keep source in place (`sdk/src/std/token/`, the byte-identical `@sauce/token`
fixture) + add only a manifest; (c) a separate published package. **P5 default (reversible, minimal): (b).**
Do NOT relocate `@sauce/token` — it is deliberately byte-identical to sauce's conformance fixture
(`compiler/crates/sauce-cli/tests/fixtures/sauce-token/`), and moving it complicates that drift contract.
P5 adds only a NEW manifest file + the ambient wiring/tests; the "promote to its own package" step is deferred
to when the user confirms the packaging strategy. Everything P5 builds is additive and survives a later move.

## Layer-C manifest — format + first content (user said "whatever is best for rust/wasm" → declarative serde)

A single declarative file, `plugin/sauce-plugin.manifest.json` (or `.ts` exporting a typed const — pick JSON
for serde-friendliness, the stated criterion), shape:

```
{
  "ambient": ["@sauce/token"],            // the ambient module list both compilers' loaders read
  "nameParity": { "emit": "log", "throw": "revert" }   // TS name ↔ RS/engine name (globals.ts:999-1000/1110-1113)
}
```

- `ambient` feeds each compiler's ambient option (TS `CompileOptions.ambient`, RS `CompileOptions.ambient`).
- `nameParity` is documentation-of-record for now (the actual emit/throw aliasing already lives in each
  compiler); P5 adds a test asserting the manifest's map MATCHES what each compiler actually implements, so the
  manifest can't silently drift from reality. (This is the seed of Layer-C being authoritative later.)

## Build steps (TDD; likely split P5a manifest+TS proof / P5b RS proof if one PR gets large)

1. Add `plugin/sauce-plugin.manifest.json` (the skeleton above) + a tiny typed loader (`loadPlugin()` reading
   it) in the SDK — no behavior change yet, just the declarative source of truth.
2. **TS proof:** a test that compiles a token-using program (e.g. `function main(){ return balanceOf(...); }`
   shape, per the token arm's real signature) with `ambient: manifest.ambient` and NO import line, on BOTH
   `target:'evm'` and `'svm'` — byte-identical to the equivalent IMPORT-based compile in the existing
   `sdk/test/std/token/compile.test.ts` (borrow that test's setup). Proves TS ambient works with the real
   stdlib module.
3. **RS proof:** the analogous compile through compiler-rs (the plugin-ambient branch) with `ambient:
["@sauce/token"]`, resolving the byte-identical sauce-token fixture — a conformance-style vector asserting
   it compiles (parity with the TS side). Confirms the bare-specifier path end-to-end on real code.
4. **Manifest-parity test:** assert `nameParity` matches each compiler's actual emit/throw alias set (fail if
   the manifest drifts from `globals.ts`'s STDLIB_FUNCTIONS / the RS equivalent).
5. Gate each side as P1–P4 did (RS: cargo build/clippy/nightly-fmt/test; TS: typecheck/test/lint/format:check
   via the PACKAGE script, never `pnpm exec jest`). No push, no PR, no AI attribution.

## Explicitly deferred (not P5)

Promoting the plugin to its own package; moving address/token REGISTRIES into Layer-B data (that's P8); the
SDK compiler-selector seam (P6) and chain-bundle activation (P7); any `Ty::Named`/Rank-2 work. P5 is purely:
manifest skeleton + prove `@sauce/token` compiles as an AMBIENT module on both compilers.

## Recommendation

P5 is a genuine cross-repo integration with a user-relevant packaging fork. Build the minimal, reversible cut
(default (b) above) so ambient parity is proven on a real module — but this is the natural point to let the
user confirm the plugin's ultimate home/packaging before P6–P8 build SDK wiring on top of it.
