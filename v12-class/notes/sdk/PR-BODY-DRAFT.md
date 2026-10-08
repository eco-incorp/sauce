Title: feat(intents)!: intents are a SauceScript class, `await Chain.hop({ … })` (needs an unreleased compiler)

**Draft. Not mergeable yet.** It builds against an unreleased compiler: `package.json` links a local build of eco-incorp/v12 #549–#554 (#554 final daed46d1, on #553 44c42d89), stamped 2.5.0. CI fails until that compiler is published and pinned here. A handler that reads what a body reverted with also needs v12-evm 2.0.0 (#553's `CATCH_READS`); those cases are `it.failing` on the pinned 1.2.0 engine and pass on an engine built from #553.

## The code it enables

A program opens an intent by hopping to a chain, and the code after the `await` runs there:

```js
function main(recipient: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  await Ethereum.hop({
    reward: { token: USDC, amount }, // Base's USDC, escrowed here
    receive: { token: USDC, amount }, // Ethereum's USDC, delivered by the solver
    refundee: refundTo,
  });
  USDC.transfer(recipient, amount); // on Ethereum
}
```

A cascade is one `await` per hop, each line after an `await` on the chain it hopped to:

```js
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  await Base.hop({ reward: { token: USDC, amount: reward }, receive: { token: USDC, amount: delivered }, refundee: refundTo });
  const second = delivered - delivered / 1000; // on Base
  await Ethereum.hop({ reward: { token: USDC, amount: delivered }, receive: { token: USDC, amount: second }, refundee: refundTo });
  USDC.transfer(recipient, second); // on Ethereum
}
```

A `try` around awaited hops handles each body where it failed; what the body did is undone and the fill still succeeds:

```js
function main(beneficiary: Address, refundTo: Address) {
  const amount = USDC.balanceOf(ctx.self());
  try {
    await Ethereum.hop({ reward: { token: USDC, amount }, receive: { token: USDC, amount }, refundee: refundTo });
    USDC.approve(AaveV3.Pool, amount);
    AaveV3.Pool.supply(USDC, amount, beneficiary, 0);
  } catch (e) {
    USDC.transfer(beneficiary, amount); // e: the body's revert data, at most 256 bytes
  }
}
```

**Before** (main today, and the first version of this PR):

```js
Ethereum(() => { USDC.transfer(recipient, amount); }, [{ token: USDC, amount }]).reward({ token: USDC, amount });
// then: Ethereum.Portal.send({ token: USDC, amount }).refundee(refundTo).receive({ token: USDC, amount }).then(() => { … })
```

**After**: `await Ethereum.hop({ reward, receive, refundee })`, or `Ethereum.hop({ … }).then(() => { … }).catch((e) => { … })` without `await`. The compiler reads `await x; rest` as `x.then(() => { rest })`, so the two are the same program, byte for byte.

## Interface

### SauceScript

- **`<Chain>.hop(config)`** on every chain's name opens an intent whose body runs on that chain. `config` is one object, each field at most once:

  | Field | Takes | Left out |
  | --- | --- | --- |
  | `reward` | `{ token, amount }`, `{ native: amount }`, or a list | required; it must offer something |
  | `receive` | `{ token, amount }` or a list; each token is the destination's of that symbol | nothing delivered |
  | `refundee` | the reward's `creator`: who may reclaim an unearned reward | required, at every depth |
  | `deadline` | the last second the intent may be filled | 300 s after it opens |
  | `rewardDeadline` | from when an unproven reward may be refunded | 604800 s after `deadline` |
  | `prover` | the source chain's prover | the registry's for the pair |
  | `salt` | the route's salt, used as written | the compile's salt mixed with a per-transaction count of opened intents (transient slot `keccak256("sauce.intents.nonce")`) |
  | `fee` | the destination Kitchen's fee the body's cook pays | `intents.executionFee` |

- **Steps**: `.then(body)` is the body; `.catch(handler)` after it handles the body. `await` of a hop is its `.then`; inside a `try`, each awaited hop's `.catch` is the `try`'s handler.
- **`<Chain>.Portal`** is that chain's eco-routes Portal contract (`EcoRoutes.Portal`), for low-level calls. It opens nothing.
- **`@sauce/intents`** (new, `sdk/src/std/intents/intents.evm.js`) is the class the compiler runs while it compiles. `[Symbol.dispose]()` builds the intent as one literal, compiles the body as a program for the destination (`program(body, chainId)`), and leaves the run-time work: read the vault, pay the reward into it, `publish` (or `publishAndFund`, `intents.fundVia`). A handler is `() => { try { body(); } catch (e) { handler(e); } }`, the `try` a program would write, byte for byte.
- **`@sauce/names`** (new) holds `Token`: a symbol's writes are `@sauce/token`'s SafeERC20 functions and its reads `balanceOf`, byte for byte the direct call.
- **Per-chain modules** (`routes/chain-module.ts`) give a program its chain's names as an ambient SauceScript module: `chainId`, tokens, protocol namespaces, `self`, `Token(address)`, and every chain's name with its `hop` and contracts. A name the chain lacks compares as zero (`X != 0`); `available(X)` is removed.
- **Every body is a program** cooked on the destination's shared Pot and pays its Kitchen fee, a token transfer included.
- **Refused while compiling**, in the class's words: a hop with no `reward`, no `refundee` or no body, a step out of place, an item missing `token` or `amount`, `{ native }` in `receive`, a token the destination lacks, a chain with no eco-routes deployment. The compiler refuses an `await` in an `if`, loop, block or `catch`, used as a value, before a value `return`, or before a statement after its `try`.

### TypeScript

- `Base.hop({ source, reward, receive, refundee, deadline, rewardDeadline, prover, salt, fee, compile }).then(body)` writes the statement a program opens the intent with, compiles it for `source` with `compile` (`SauceProgramOptions`), and returns `HostIntent`:
  - `source`: the SauceScript statement;
  - `program`: it compiled, with each body in `bodies`;
  - `cook(target, value)`: `Pot.cook(engine, program)` on a Pot or `{ owner, salt? }`;
  - `intents(logs)`: each intent the source Portal published in a receipt's or rehearsal's logs (`routes.loggedIntents`).
  A field it does not take is refused; `then` refuses to be a promise's.
- `routes.chainHop(ref)`, `routes.HOP_FIELDS` / `HOP_STAGES` (the syntax as data, which the editor declarations are generated from), `routes.loggedIntents`, and the types `HopConfig`, `HostHop`, `HostIntent`, `HopOpened`, `PotTarget`.
- A chain export is a namespace, `{ chain, hop, Portal, contracts, tokens }`, not a function.

### CLI and MCP

- **Every publish is a cook.** `sauce intent publish <file>` cooks the file on the signer's Pot; each intent's hash and record come from the Portal's `IntentPublished` (the rehearsal's with `--dry-run`, then the receipt's). There is no offline hash.
- **Later steps take a published intent**: its stored hash, `--tx <hash> --chain <source>`, or MCP's `record` / `txHash`. A file is only a preview (`sauce intent fill <file>` without `--send`).
- **`--fund` with `await`**: the wrapper writes a program that awaits in its `.then` form (`funding.ts#thenForm`, the compiler's own reading, byte for byte, AST-only), so the sweep runs where the intent opens. A program whose `await` the compiler refuses is left untouched and fails with the compiler's error at the file's line.
- **Diagnostics**: a compiler error that draws a span over several lines is placed at the file's own line.
- `sauce intent publish` with no file writes an `await` file. `--intent-creator` / `--intent-refundee` and MCP's `intentCreator` / `intentRefundee` are refused, naming the hop's `refundee`.

### Removed (unreleased or replaced)

- The chained `Chain.Portal.send(…).refundee(…).receive(…)` form; `Dest(body, delivery).reward(reward)`; `Base.route`; `openRoute`, `.nest()` (`nest.ts`, `nest-dynamic.ts`) and `BuiltIntent`; `available(X)`.
- Every source rewrite: `token-rewrite.ts`, `protocol-rewrite.ts`, `intent-sugar.ts`, `intent-body.ts`, `intent-dsl.ts`. The compiler reads the program as written.
- The host `declare` / records / endings of the first host-API design: the chain's names are SauceScript modules now.
- The CCTP recipe builders `buildCctpSplitTransfer` / `buildPlainTransfer` (`recipes/cctp-transfer.ts`, `cctp-split.sauce.ts`, `plain-transfer.sauce.ts`): no consumer.
- Actions' `programIntent`.

## What it needs

**Compiler** (eco-incorp/v12), all generic, with no SDK vocabulary:
- #549: host entry (diagnostic codes, `entryParams`, closure entry).
- #550: classes and static values the compiler runs, `[Symbol.dispose]`, compile-time `throw`, `instanceof`, unknown dotted names as zero with `absentPaths`.
- #551: `program(closure, scope)` and the `programOptions` callback.
- #552: `try { } catch { }`.
- #553: `catch (e)`; an arrow called in place drops the arguments it does not name.
- #554: `await x; rest` as `x.then(() => { rest })`.
- Still pending, each held by an `it.failing` here:
  - #555: an unset argument to an annotated parameter, refused as `Unset`.
  - #557: `Object.keys` of a static object (to refuse an unknown hop field), `main`'s return type in `entrySignature`, a bare destination-only token, and folding bound arguments.

**Engine**: v12-evm 2.0.0 (#553's `CATCH_READS`) for a handler that reads `e`. Everything else runs on the pinned 1.2.0. The releases.json row for the compiler carrying #553 must pair with v12-evm 2.0.0.

## Tests

- `routes-intent-portal`:
  - every field is the option it names, byte for byte; the defaults; the nonce salt (two intents built alike, in sequence and in a loop);
  - the host builder's statement and cook, and that its cook publishes what the same statement in a file publishes;
  - `await` byte-identical to `.then`, and a `try` around 2 and 3 awaited hops byte-identical to the nested `.catch` desugaring; nested handled hops 2 and 3 deep;
  - each refusal; the syntax table held to the fields and steps the class reads.
- `routes-intent-bodies.e2e`, through eco-routes' real Portal and Executor on anvil:
  - bodies, cascades, SafeERC20 writes (USDT included), the shared Pot;
  - `.catch` handlers;
  - a `try` around 2 and 3 awaited hops: the last body reverts and the handler forwards, or every body succeeds.
  - The `e`-reading cases are `it.failing` on 1.2.0 and pass on a #553 engine.
- `routes-intent-chains.e2e`: names resolved per chain on three anvils whose USDC differ.
- `try-catch.e2e`: the block form on the released gated stack.
- CLI and MCP:
  - `cli-lifecycle.e2e` and MCP `intents.e2e`: publish, fill, prove and claim; refund; cancel; an intent made from flags; the nested-intents guide's file published with `--fund`;
  - `cli-funding`: `thenForm` byte identity, untouched refusals, and each refusal through `--fund` at the file's line;
  - `cli.test`: located diagnostics.
- Docs and skills: every executed example awaits its hops, and `skills:check` has nothing pending.
- Gates locally: jest 9331 pass, mcp 168, actions unit 370 and mainnet 141 (+14 `todo`, `main`'s return type), dev-tools 45, docs:check, skills:check.
