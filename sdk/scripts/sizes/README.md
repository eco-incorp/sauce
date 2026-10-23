# Program sizes and compile time across compiler builds

Tools for holding a compiler bump to the programs this repository ships: every example and recipe
(`docs/examples`, `skills/*/examples`, `sdk/src/recipes`), compiled the way the SDK compiles it, on
each chain it compiles for. None of them is part of a test run; they are run
by hand against a built tree (`pnpm build`), from this directory.

A tree's own installed compiler is measured by default. To compare another published compiler,
set `SAUCE_COMPILER_PKG` to its installed `@eco-incorp/sauce-compiler` package directory.
`register.mjs` loads `compiler-hook.mjs`, which resolves `sauce-compiler` to that directory without
relinking the SDK.

## Sizes and outputs

```sh
node sizes.mjs ../../.. > candidate.json
node diff.mjs baselines/rewrite61-5d9f38f3.json candidate.json
```

The first command measures this SDK tree. The second exits 1 if any compared bytecode grew, and
prints the growth; that result is a size regression, not a failure to run the comparison.
Files found on only one side are listed but not compared.

To exercise the compiler override with this tree's installed published compiler:

```sh
SAUCE_COMPILER_PKG=../../../node_modules/sauce-compiler \
  node --import ./register.mjs sizes.mjs ../../.. > candidate.json
```

- `sizes.mjs`: every bytecode's size, by file and chain.
- `diff.mjs base.json candidate.json`: what grew, what shrank, and what is only in one.
- `bytes.mjs`: a hash of every bytecode (manifests included) and the full text of every refused
  compile, for proving a change to the SDK changes no output (`cmp` two runs).
- `refusals.mjs <sdk-tree>`: what a curated set of refused compiles says, for the same proof about
  the SDK's own refusals; equal but for `(bytes N..M)` offsets into its generated modules.
- `one.mjs <tree-a> <tree-b> <chain> '<source>'`: one program's size on two trees.
- `baselines/`: `main-9a1dac3f-2.5.0.json` and `rewrite61-5d9f38f3.json` record earlier SDK and
  compiler builds. Their filenames identify those recordings, not a source checkout you need.
  Some recorded programs no longer exist; only files present on both trees compare.

## Compile time

- `times.mjs <sdk-tree> [repeats]`: each program's median cold (function cache cleared) and warm
  compile, in ms, as JSON.
- `ab.mjs <tree-a> <tree-b> [repeats]`: two SDK trees in one process, compiles interleaved so machine
  load falls on both alike; a handful of programs that cover a chain's module, where the tree has
  them. Skip timing while the load average is high.
- `profile.mjs <sdk-tree> <chain> <file | -e source> [repeats]`, with
  `SAUCE_COMPILER_PKG=./profiler` and `SAUCE_COMPILER_REAL=<pkg>`: where one compile spends its time — the SDK's own time, the
  compiler's, the host callbacks inside it, and the largest files `resolve` answered.
- `log-all.mjs <sdk-tree> <out dir>` and `record-targets.mjs <sdk-tree> <out dir>`, with
  `SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<pkg>`: every compile's inputs (options, each file
  `resolve` answered, each `programOptions` scope and its answer), so a compile replays with no SDK.
  `replay-all.mjs <logs dir> name=<pkg> …` times the recordings on several builds, interleaved.

## Focused compiler comparisons

`repros/held-asks.mjs <pkg> [<pkg> …]` compares two forms of each small program on installed
published compiler packages: reading a run-time field through a constructed object versus passing
it directly, and calling a held contract import versus its explicit `.at(address)` binding.
It prints each compiled size or compiler refusal. Results depend on the compiler package; a
refusal is reported as data rather than making the comparison process fail.
