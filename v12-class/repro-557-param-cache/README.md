# distributed-swap: a parameter passed on vs a local copy (v12 #557 item 9)

The SDK skill's `distributed-swap.sauce.ts` (copied here) compiles 76–84 bytes larger when the
token argument of its last `transfer` is `main`'s parameter `payToken` itself than when it is a
local copy of it (`const pay = payToken`). Released 2.5.0 and #555 final (6dd0e358) agree byte for
byte.

Each directory holds one compile as the SDK made it (`00.json`): the options that are values
(`target`, `entry`, `ambient`, `defines`, …) and every `resolve`/`resolvePackage` call with what it
returned, the entry's text included. Replay it with no SDK, on any build:

    cd /Users/er/Documents/Projects/v12-class/tools/sizes
    node replay.mjs /Users/er/Documents/Projects/v12-class/repro-557-param-cache/main-as-is/00.json <pkg> [<pkg> …]

| Recording           | SDK tree                    | The refund's token                    | 2.5.0 | 6dd0e358 |
| ------------------- | --------------------------- | ------------------------------------- | ----- | -------- |
| main-as-is          | SDK main (textual lowering) | `pay`, a local copy of `payToken`     | 2581  | 2581     |
| main-transfer-param | SDK main                    | `payToken`, the parameter             | 2665  | 2665     |
| rewrite-as-is       | rewrite/61 (Token class)    | `payToken`, as the class's field      | —     | 2658     |
| rewrite-pay-local   | rewrite/61                  | `pay`, a local copy of `payToken`     | —     | 2582     |

The main pair's entries differ in one token, line 140: `__sauce_transfer(pay, refundTo, unspent)`
(2581) against `__sauce_transfer(payToken, refundTo, unspent)` (2665), where line 97 is
`const pay = payToken;`. The rewrite pair differ in how `pay` is written: `Token(payToken)`, whose
field is the parameter, against `payToken` copied to a local. `rewrite-*` uses the class
architecture, so 2.5.0 refuses it.

Recorded by `tools/sizes/record.mjs` through `tools/sizes/recorder/`, a stand-in `sauce-compiler`
that logs each compile (selected with SAUCE_COMPILER_PKG; REAL_SAUCE_COMPILER names the real build):

    cd /Users/er/Documents/Projects/v12-class/tools/sizes
    SAUCE_COMPILER_PKG=$PWD/recorder REAL_SAUCE_COMPILER=<pkg> SAUCE_RECORD_DIR=<dir> \
      node --import ./register.mjs record.mjs <sdk-tree> base \
      skills/sauce-distributed-swap/examples/distributed-swap.sauce.ts '[[from, to], …]'
