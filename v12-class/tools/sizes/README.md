# Program sizes across compiler builds

Measures every example and recipe program an SDK tree compiles (docs/examples, skills/*/examples,
sdk/src/recipes; with each intent body), per file and chain, and compares two measurements.

    # an eco-incorp/sauce tree whose SDK is built (`pnpm build`), against any compiler pkg:
    SAUCE_COMPILER_PKG=<v12>/compiler/crates/sauce-wasm/pkg \
      node --import ./register.mjs sizes.mjs /Users/er/Documents/Projects/v12-class/sdk > candidate.json
    node diff.mjs rewrite61-2155102e.json candidate.json   # exits 1 when a bytecode grew

Without SAUCE_COMPILER_PKG the tree's own linked compiler is measured. Baselines here, measured on
SDK rewrite/61 at f6cd8cfd (SDK main 9a1dac3f merged in, token reads inline; 57 programs, 81
bytecodes):
- rewrite61-2155102e.json: on #555 at 2155102e (the bar: nothing may exceed it);
- rewrite61-68ddccf5.json: the same on 68ddccf5 (8 bytecodes larger);
- rewrite61-6dd0e358.json: the same on #555 final (6dd0e358, and 6b2dff83, byte for byte);
- pre-cdc63a81/, pre-merge/: the bar before the inline reads and before SDK main was merged;
- main-2.5.0.json: SDK main 9a1dac3f on the released compiler 2.5.0. Its intent programs are written
  in the old syntax, so only files with the same source compare; the router library is the same on
  both.
`record.mjs` (through `recorder/`, a stand-in `sauce-compiler`) writes the inputs of every compile
one SDK program makes, and `replay.mjs` compiles such a recording on any build, with no SDK.
`log-all.mjs <sdk-tree> <out dir>` (with `SAUCE_COMPILER_PKG=./logger` and `SAUCE_COMPILER_REAL` the
build to compile with, through `logger/`) writes the inputs of every compile of every program, the
`programOptions` scopes and their answers included: use it for programs that open intents, whose
bodies `replay.mjs` does not compile with their options. `replay-all.mjs <logs dir> <name>=<pkg>...`
compiles each logged program on each build in one process, the builds interleaved so machine load
falls on all alike, and prints each one's median cold and warm compile time, in ms, as JSON.
`times.mjs <sdk-tree> [repeats]` (with SAUCE_COMPILER_PKG as above) prints each program's median cold
(cache cleared) and warm compile time, in ms, as JSON.
`three.mjs '<main.js>' ['<lib.js>']` compiles one generic program on 2.5.0, 2155102e and 68ddccf5.
`one.mjs <tree-a> <tree-b> <chain> '<source>'` compiles one SDK program on two trees.
