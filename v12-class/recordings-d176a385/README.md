# SDK rewrite/61 compiles, recorded for the compiler's parse cache and lazy declarations

Seven compiles as SDK rewrite/61 makes them at d176a385 (the same inputs as at 6ca67951: `sdk/src` differs
only in passing `args` through, which none of these use), one directory each, with every compile it
makes (`<n>.json`: the options, every file `resolve` answered, every `resolvePackage` answer, and every
`programOptions` scope with its answer), so the intent bodies replay as the SDK compiles them:
trivial@base, trivial@ethereum, trivial@solana, cross-chain@base, cross-chain@ethereum,
swap-on-base@ethereum, distributed-swap@base. Their bytecode: 16, 16, 9, 1218, 1218, 2602, 2658 bytes.

Replay (interleaved per-build medians, cold and warm), from tools/sizes:

    node replay-all.mjs /Users/er/Documents/Projects/v12-class/recordings-d176a385 \
      c0309041=/Users/er/Documents/Projects/v12-class/sauce-compiler-c030 new=<your pkg>

Recorded with `tools/sizes/record-targets.mjs` through `tools/sizes/logger/`, on #556 final c0309041:

    cd tools/sizes && SAUCE_COMPILER_PKG=./logger SAUCE_COMPILER_REAL=<pkg> \
      node --import ./register.mjs record-targets.mjs <sdk-tree> <out dir>
