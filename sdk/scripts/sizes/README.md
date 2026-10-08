# Program sizes and compile time across compiler builds

Tools for holding a compiler bump to the programs this repository ships: every example and recipe
(`docs/examples`, `skills/*/examples`, `sdk/src/recipes`), compiled the way the SDK compiles it, on
each chain it compiles for, with each intent body. None of them is part of a test run; they are run
by hand against a built tree (`pnpm build`), from this directory.

A tree's own linked compiler is measured unless `SAUCE_COMPILER_PKG` names another built
`crates/sauce-wasm/pkg`: `register.mjs` loads `compiler-hook.mjs`, which resolves `sauce-compiler` to
it, so one SDK build is measured against any compiler build without relinking.

## Sizes and outputs

```sh
SAUCE_COMPILER_PKG=<v12>/compiler/crates/sauce-wasm/pkg \
  node --import ./register.mjs sizes.mjs <sdk-tree> > candidate.json
node diff.mjs baselines/rewrite61-5d9f38f3.json candidate.json   # exits 1 when a bytecode grew
```

- `sizes.mjs`: every bytecode's size, by file and chain (the program, then each body).
- `diff.mjs base.json candidate.json`: what grew, what shrank, and what is only in one.
- `bytes.mjs`: a hash of every bytecode (manifests included) and the full text of every refused
  compile, for proving a change to the SDK changes no output (`cmp` two runs).
- `refusals.mjs <sdk-tree>`: what a curated set of refused compiles says, for the same proof about
  the SDK's own refusals; equal but for `(bytes N..M)` offsets into its generated modules.
- `one.mjs <tree-a> <tree-b> <chain> '<source>'`: one program's size on two trees.
- `baselines/`: `main-9a1dac3f-2.5.0.json` is SDK main on the released compiler 2.5.0, the bar a
  release must not exceed (its intent files are the old syntax, so only files with the same source
  compare); `rewrite61-5d9f38f3.json` is this branch on v12 #557 final.

## Compile time

- `times.mjs <sdk-tree> [repeats]`: each program's median cold (function cache cleared) and warm
  compile, in ms, as JSON.
- `ab.mjs <tree-a> <tree-b> [repeats]`: two SDK trees in one process, compiles interleaved so machine
  load falls on both alike; a handful of programs that cover a chain's module, an intent and a
  cascade. Skip timing while the load average is high.
- `profile.mjs <sdk-tree> <chain> <file | -e source> [repeats]`, with
  `SAUCE_COMPILER_PKG=./profiler` and `SAUCE_COMPILER_REAL=<pkg>`: where one compile spends its time — the SDK's own time, the
  compiler's, the host callbacks inside it, and the largest files `resolve` answered.
- `log-all.mjs <sdk-tree> <out dir>` and `record-targets.mjs <sdk-tree> <out dir>`, with
  `SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<pkg>`: every compile's inputs (options, each file
  `resolve` answered, each `programOptions` scope and its answer), so a compile replays with no SDK.
  `replay-all.mjs <logs dir> name=<pkg> …` times the recordings on several builds, interleaved.
