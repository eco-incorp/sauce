# DESIGN — Fluent cross-chain intent DSL over eco-routes **V2**

Status: design, untracked/local. Target: `/Users/er/Documents/Projects/eco-routes` branch **`main`**
(the deployed V2 shape). **V3 (`v3/02-reward-legs`) is explicitly OUT OF SCOPE** — its `Reward` has
`rate`/`flat` legs, an `IPolicy` prover and "Account" terminology, and nothing here targets it.

> **Ground-truth hazard (cost one grounding agent a redo).** The eco-routes working tree on disk is
> checked out on the **V3** branch. Any plain `Read`/`cat`/`grep` under that repo silently returns V3
> content. Every V2 fact in this document was read via `git -C …/eco-routes show main:PATH`. Keep
> doing that; never `git checkout` there.

> **AMENDED 2026-08-09 — two user decisions supersede parts of §2.1, §3.3, §9 and §10.**
> (1) **Go chain-global now.** The surface is `Base.route(sauce).reward(reward)` on the chain
> GLOBALS, plus a callable alias `Base(sauce) === Base.route(sauce)`. This REPLACES the old
> `ChainOrigin.route(reward)` builder — what §2.1 deferred to S7 is brought forward to _this_ pass,
> and the provisional `intentOn` name is retired before `main` ever sees it. (2) **Hold and build
> coherent** — everything stays on `feat/xchain-intent-dsl`; no merge until the surface is whole.
> The authoritative spec for this pass is **§13**; §2.1/§9/§10 are kept for the record and marked
> where they are superseded.

---

## 0. What we are building, in one line

```ts
Base.route(() => {
  /* SauceScript main() body, runs on Base */
}).reward({/* what a solver earns */});
```

`Chain.route(sauce)` = "run this Sauce program on `Chain`". `.reward(reward)` = "make it solvable".
Nesting a `Other.route(...)` **inside** a route body is the _only_ way to cross a chain. Everything
else — swaps, deposits, protocol calls, token moves — is single-chain library code compiled into the
body.

Two things this is **not**: it is not a replacement for direct `compile()`/`cook()` (that stays
first-class — the intent wrapper is purely the _solver/funding_ layer), and it is not a rewrite of
`sdk/src/routes/` (types/encode/intent/sauce-calls are already V2-correct and get reused verbatim).

---

## 1. Ground truth — eco-routes V2 (`main`), verbatim

### 1.1 Structs (`contracts/types/Intent.sol`)

```solidity
struct Call        { address target; bytes data; uint256 value; }
struct TokenAmount { address token; uint256 amount; }
struct Route  { bytes32 salt; uint64 deadline; address portal; uint256 nativeAmount;
                TokenAmount[] tokens; Call[] calls; }
struct Reward { uint64 deadline; address creator; address prover; uint256 nativeAmount;
                TokenAmount[] tokens; }
struct Intent { uint64 destination; Route route; Reward reward; }   // NO sourceChainId on-chain
```

Rewards are **absolute amounts**. There is no rate leg, no escape hatch — this is the single hardest
constraint on the whole design (see §7).

`sdk/src/routes/types.ts` is a field-for-field match, plus one SDK-only convenience field
`sourceChainId: bigint`. On-chain the source chain is _implicit_: it is whichever chain's Portal you
called `publish` on. The SDK models it explicitly; nothing on-chain reads it back.

### 1.2 Hashing (`contracts/IntentSource.sol::getIntentHash`)

```
routeHash  = keccak256(route_bytes)                 // bytes, never the decoded struct
rewardHash = keccak256(abi.encode(reward))
intentHash = keccak256(abi.encodePacked(uint64 destination, bytes32 routeHash, bytes32 rewardHash))
```

`route` crosses the `publish` boundary as **opaque `bytes`** — `abi.encode(route)` for an EVM
destination, hand-rolled **Borsh** for an SVM destination. The contract only ever `keccak256`s it.
This is exactly why `sdk/src/routes/encode.ts`'s per-destination-kind fork is the correct shape, and
`hashIntent(intent)` (encode.ts:485) already implements the formula including the dest/source kind
asymmetry.

### 1.3 Entry points (`contracts/interfaces/IIntentSource.sol`, all permissionless)

```solidity
function publish(Intent calldata intent) external returns (bytes32 intentHash, address vault);
function publish(uint64 destination, bytes memory route, Reward memory reward)
    external returns (bytes32 intentHash, address vault);
function publishAndFund(Intent calldata intent, bool allowPartial)
    external payable returns (bytes32 intentHash, address vault);
function publishAndFund(uint64 destination, bytes memory route, Reward memory reward, bool allowPartial)
    external payable returns (bytes32 intentHash, address vault);
function fund(uint64 destination, bytes32 routeHash, Reward calldata reward, bool allowPartial)
    external payable returns (bytes32 intentHash);
function withdraw(uint64 destination, bytes32 routeHash, Reward calldata reward) external;
function refund / refundTo / recoverToken / batchWithdraw …
function intentVaultAddress(Intent calldata intent) external view returns (address);
event IntentPublished(bytes32 indexed intentHash, uint64 destination, bytes route,
    address indexed creator, address indexed prover, uint64 rewardDeadline,
    uint256 rewardNativeAmount, TokenAmount[] rewardTokens);
```

Destination side (`IInbox`): `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)`
— note it takes only the _rewardHash_, not the reward. `Portal is IntentSource, Inbox, Semver` — one
contract, both roles, deployed per chain.

**The `bytes`-route overload is load-bearing for this design**: it is what lets a _parent Sauce
program_ pass a precomputed route blob (EVM ABI or SVM Borsh) without the compiler ever having to
build a nested `Route` tuple on-chain (§7).

### 1.4 Vault (escrow) derivation — fully off-chain reproducible

```solidity
// IntentSource.sol
function _getVault(bytes32 intentHash) internal view returns (address) {
    return VAULT_IMPLEMENTATION.predict(intentHash, CREATE2_PREFIX);
}
// vault/Clones.sol
predicted = address(uint160(uint256(keccak256(abi.encodePacked(
    prefix, address(this), salt,
    keccak256(abi.encodePacked(type(Proxy).creationCode, abi.encode(implementation)))
)))));
// Portal.sol — the whole file
contract Portal is IntentSource, Inbox, Semver {
    constructor() IntentSource(address(new Vault()), bytes1(0xff)) {}
}
// vault/Vault.sol
constructor() { portal = msg.sender; }   // ZERO constructor args
```

So, in SDK terms:

```
vault = CREATE2( deployer = <Portal address>,
                 salt     = intentHash,
                 initCodeHash = keccak256( Proxy.creationCode ++ abi.encode(vaultImplementation) ),
                 prefix   = 0xff )        // 0x41 on Tron (PortalTron), out of scope
```

The vault is **predictable before deployment** (`_getOrDeployVault` clones lazily, only when
`vault.code.length == 0`), which is precisely the property the nested/runtime-reward flow needs.

Two consequences worth stating plainly:

- `intentHash` does **not** depend on the source chain, and Portal is deployed via a CREATE2
  `SingletonFactory` (`0xce0042B868300000d44A59004Da54A005ffdcf9f`) in `scripts/Deploy.s.sol`, with
  `VAULT_IMPLEMENTATION` being a plain nonce-1 `CREATE` from inside Portal's constructor. Given a
  consistent deploy salt, Portal _and_ the Vault implementation have the **same address on every EVM
  chain** — so the predicted vault address is chain-invariant too. (Verify the salt was actually
  consistent for the live deployments before hardcoding anything — see openQuestions.)
- **`initCodeHash` is not derivable from Solidity source.** `type(Proxy).creationCode` depends on the
  solc version and optimizer settings, and eco-routes commits no `out/`/artifact JSON on `main`. The
  SDK therefore must **accept `vaultInitCodeHash` (or the raw proxy creation code) as configuration**,
  never invent it. Design rule: `predictVaultAddress` takes it as an explicit parameter, and we ship
  no baked constant until one is verified against a live `intentVaultAddress()` call.

> **Do NOT copy `utils/intent.ts`'s `intentVaultAddress()` helper.** It models a superseded scheme
> (salt = `routeHash`; Vault deployed _directly_ with `(intentHash, reward)` constructor args). The
> real `Vault` constructor takes zero args. That helper is stale; the Solidity is the only truth.

### 1.5 Cross-VM, as actually implemented on `main`

`contracts/deposit/DepositAddress_USDCTransfer_Solana.sol` is the only EVM→SVM path on `main`. It
calls the ordinary EVM `Portal.publishAndFund(destChain, routeBytes, reward, allowPartial)` with:

- an ordinary Solidity `Reward` funded in USDC **on the EVM source chain** — confirming reward escrow
  is always source-chain-side and VM-local, regardless of destination VM; and
- `routeBytes` = **hand-rolled Borsh** (LE u64s, u32-length-prefixed vecs, 32-byte pubkeys, the
  `CalldataWithAccounts` envelope) for a single hardcoded SPL `transfer_checked`.

It is a single-purpose USDC bridge-deposit factory, not a general mechanism. But it validates two
things this design depends on: the generic `bytes` route parameter is the right hook for Borsh, and
an EVM-sourced reward is unaffected by an SVM destination. The Solana Portal _program_ is not in this
repo — `git ls-tree -r main` has zero `.rs`. Our SVM-side ground truth is `sdk/src/routes/encode.ts`

- `sdk/src/routes/sauce-calls.ts` + `sdk/src/svm`, with the honest parity caveat already recorded in
  encode.ts's module doc (the Borsh golden vector pins the schema, it does **not** prove on-chain
  parity).

---

## 2. The primitive

```ts
Chain.route(sauce).reward(reward);
```

**Orientation (say it out loud, it is the #1 source of confusion):** `Chain` is the **destination** —
the chain the Sauce program _executes_ on. The **reward escrows on the source chain**, which is where
the user funds. For a depth-1 intent the source is supplied explicitly (it belongs to the reward, not
the route — the reward _is_ the source-chain-side object). Under nesting it is filled automatically:
**a parent's execution chain is its child's source chain.**

### 2.1 Naming collision with the existing builder — ~~resolved ADDITIVELY~~ **SUPERSEDED 2026-08-09: resolved by REPLACEMENT (see §13)**

`sdk/src/routes/builder.ts` today has `ChainOrigin.route(reward: RewardInput): PendingLeg` — i.e.
`.route()` currently takes the **reward**, and the _destination selector_ (`.Solana(routeInput)`)
takes the route. That is the confusing shape this epic is fixing, and it is installed as a **default
global** (`Base.route(...)`, `sdk/src/routes/globals.ts`).

Decision: **do not flip the existing method in stage 1.** The new DSL ships as its own named surface
alongside it:

```ts
import { routes } from "@eco-incorp/sauce";
routes.intentOn("base").route(spec).reward(spec);
```

Flipping the global `Chain.route()` to the new semantics is a **separate, user-gated, breaking stage**
(S7). Everything before it is purely additive; existing exports and the ~39 ambient chain globals keep
working byte-for-byte.

> **SUPERSEDED.** The user gate was opened on 2026-08-09 and S7 was pulled forward into this pass.
> The old `ChainOrigin.route(reward)` builder, its leg-pipeline stages (`PendingLeg`/`ChainStage`/
> `DestinationSelectors`) and the `intentOn` entry point are **removed**, not deprecated — they exist
> only on unpublished `main` (npm is frozen at 0.8.0), so there is no real consumer to break, and
> leaving two conflicting meanings of `Chain.route` would be strictly worse than one clean break.
> `PascalOf`/`pascalOfSlug` are the only names `builder.ts` keeps byte-identical (imported by
> `descriptors/accessors.ts` and `svm/accessors.ts`). See §13.

### 2.2 Affordances on the finalized value

| affordance                        | stage | implementation                                                        |
| --------------------------------- | ----- | --------------------------------------------------------------------- |
| `.intent` / `.root()`             | S1    | the head `Intent` (outermost = what the user funds)                   |
| `.intents()`                      | S1    | `Intent[]`, head first; length 1 until nesting (S5)                   |
| `.hash()`                         | S1    | `hashIntent()` — existing, verbatim                                   |
| `.encodeEVM()` / `.encodeSVM()`   | S1    | `encodeRouteEvm/Svm`, `encodeRewardEvm/Svm` — existing                |
| `.vault(cfg)`                     | S1    | new pure CREATE2 predictor, §1.4, explicit `vaultInitCodeHash`        |
| `.compiled`                       | S1    | the raw `CompileResult` (bytecode/warnings/accountPlan) for debugging |
| `.publishCalldata(opts)`          | S2    | `encodeFunctionData` over a minimal Portal ABI fragment               |
| `.fundCalldata()`, `.approvals()` | S2    | derived from `reward.tokens`                                          |

`.hash()`/`.vault()` are **undefined for a runtime-computed child** (§7) — those must _throw with a
reason_, never return a plausible-but-wrong value.

---

## 3. The route body: closure vs. source

### 3.1 Verified, not assumed

Both halves were probed against the committed `compiler/dist` in this repo (scratch script, nothing
written into the tree):

```
TOSTRING: "() => { let x = USDC + 1n; return x; }"
PROGRAM : function main() { let x = USDC + 1n; return x; }
compile(program, { target:'v12', defines:{ USDC: 0x1234n } })  ->  OK, 13 bytes
```

and the closure-capture negative case:

```js
const outer = 5n;
const body2 = () => {
  return outer + 1n;
};
// -> COMPILE ERROR: "undefined variable: outer"
```

and the tsc-emit question (does the SDK's own build mangle the arrow?):

```
tsc target ES2022 emit of `(): bigint => { const amt: bigint = USDC_BAL; return amt * 2n; }`
  ->  `() => { const amt = USDC_BAL; return amt * 2n; }`
```

Types are stripped, the body is preserved verbatim, arrows are **not** downleveled at ES2022 (the
sdk's `tsconfig.json` target). `Function.prototype.toString()` returning source text is ES2018
spec-guaranteed.

### 3.2 The mechanism

1. `fn.toString()` → the declared source text.
2. Parse **that string** with `acorn` (already a compiler dependency; the SDK can parse the arrow
   standalone) to locate the body precisely — do **not** hand-slice on `=>`/braces in production
   (a `=>` inside a string literal or a default parameter breaks naive slicing).
3. Block body → splice its statements; concise body (`() => expr`) → synthesize `return expr;`.
4. Emit `function main(<params>) { <body> }` and hand that to `compile()`.

**There is no closure capture, by construction, and that fails closed**: a free identifier that is
neither an injected global nor a declared local is a hard `undefined variable: X` compile error. That
is the right failure mode — it can never silently bake a stale JS value into bytecode.

### 3.3 Decision

**Accept BOTH, with the source form as the stage-1 primitive.**

```ts
type SauceBody = string | (() => void);
```

- `string` — a complete `function main(){…}` program, or a bare body (detected and wrapped). This is
  the form every existing SDK emitter already produces (`swapSource()`, `tokenSource()`,
  `swapCallStatement()`), so it needs **zero new mechanism** and is what S1 ships.
- `() => {…}` — the sugar, added in **S3** once the acorn extraction is properly tested (concise
  bodies, params, nested arrows, comments, minifier hostility). **Brought forward into this pass as
  build unit U2 (§13.3); the string form stays primary and is still the documented escape hatch.**

Rationale for not leading with the closure: the toString path is spec-sound _in this repo's build_
but is genuinely fragile under a **consumer's** bundler/minifier (Terser will rename free identifiers
and can drop a body it proves unused). That risk is acceptable as opt-in sugar, unacceptable as the
only way to express a route. The string form is also what makes the DSL composable with the existing
library (§4) with no adapter at all.

Mitigation for S3, when it lands: a `NO_SIDE_EFFECTS`-style marker is not enough; document the
minifier hazard, and consider a build-time (unplugin/ts-transform) alternative that lifts the arrow's
text into a string literal at compile time — deferred, noted in openQuestions.

---

## 4. Chain-scoped ambient globals

Goal: inside `Base.route(() => { … })`, bare `USDC` / `self` / `Uniswap` resolve to **that chain's**
address book and execution context; nesting rebinds; a qualified `Base.USDC` reaches an ancestor.

Two very different sub-problems, and conflating them is a trap (the existing
`routes/globals.ts` solves a _third_, JS-level one — installing `Base`/`Solana` onto `globalThis` so
you can write the builder chain without imports. That is unrelated to what's visible _inside_ the
compiled SauceScript).

### 4.1 Scalars — `CompileOptions.defines`. Zero compiler change. **VERIFIED.**

`compiler/src/processor/index.ts`'s bare-`Identifier` case:

```ts
const constant = ctx.getConstant(expr.name);
if (constant !== undefined && !ctx.getVar(expr.name)) return saucer.int(constant);
return saucer.read(expr.name);
```

`getConstant` is backed by `ctx.defines` (`context.ts`), seeded from
`CompileOptions.defines?: Record<string, bigint | boolean | number>`. This resolves an unshadowed
identifier to a literal **in any expression position**, on the core acorn path (not ts-frontend-only),
on **v1, v12 and svm** alike. Probed with a real 20-byte address:

```
compile('function main(){ return USDC; }', { target:'v12',  defines:{ USDC: 0x8335…2913n } })  -> OK
compile('function main(){ return USDC; }', { target:'svm',  defines:{ USDC: 0x8335…2913n } })  -> OK
```

So: the SDK builds a per-chain `defines` map (token addresses, protocol addresses, chain id, …) from
the canonical chain registry + `sdk/src/descriptors` + `sdk/src/protocols`, and passes it into
`compile()`. Nesting = the inner `compile()` call simply gets the inner chain's map. A **qualified**
`Base.USDC` inside a nested body is resolved _at DSL level_, before compilation: the SDK rewrites the
member expression to a fresh injected name (`__Base_USDC`) with its own define. `self` maps to the
compiler's existing `address.self` global (no define needed).

Shadowing is already correct: `getConstant` is only consulted when `ctx.getVar(name)` is undefined, so
a user's own `let USDC = …` wins, exactly as a reader expects.

### 4.2 Contract accessors — SDK-local **source rewrite**, still compiler-untouching

`Uniswap.UniversalRouter.exactInput(...)` cannot be a `defines` entry: `defines`' value space is
`bigint | boolean | number`, and the compiler's _only_ contract-call surface is the
`import { X } from "./X.json"` ABI import (`compiler/src/contracts.ts`) plus `.at()/.view()/.lib()`
binding, which requires the address in the **source text**.

Chosen mechanism, in order of preference:

1. **(S4, recommended) SDK-side acorn source rewrite + import-line injection.** Before `compile()`,
   the SDK parses the emitted body, finds member chains rooted at a known accessor name, and rewrites
   `Uniswap.UniversalRouter.exactInput(args)` → `IUniversalRouter.at(UNISWAP_UNIVERSAL_ROUTER).exactInput(args)`,
   emitting the matching `import { IUniversalRouter } from "./artifacts/IUniversalRouter.json";` line
   and the matching `defines` entry for the address. The name→(artifact, address) mapping is exactly
   what E2's `sdk/src/descriptors/accessors.ts` registry already holds. This is **entirely inside
   `sdk/src`**, reuses landed machinery, and mirrors what `swap/source.ts` and `token/source.ts`
   already do by hand (`ISauceRouter.at(address.self).swap({…})` + `swapImportLines` +
   `SWAP_BASE_DIRS`).
2. **(fallback) No rewrite at all** — the user writes the qualified form themselves and the SDK only
   supplies import lines + `baseDirs`. This is the status quo and it _works today_; option 1 is pure
   ergonomics on top.
3. **(rejected for now) A compiler change** — e.g. a `CompileOptions.contracts` binding a bare name to
   `(abi, address)`. Strictly more powerful and probably where this ends up eventually, but it drags
   in the committed-`compiler/dist` rebuild ritual and a cross-workspace commit. Not needed to ship
   any of S1–S5.

**Answer to the open question: SDK-injected consts (`defines`) + SDK-side source rewrite. No compiler
change.**

> **CORRECTION (2026-08-10, §17).** Option 3's premise is FALSE and was never checked: a
> `CompileOptions.contracts?: Record<name, { abi }>` **already exists and already ships** in the
> pinned compiler — `compiler/src/index.ts:153`, consumed by `new CompilerContext(options.baseDirs,
options.contracts, target)` (`index.ts:316`), which loops `registerContract(name, config.abi)` in
> the constructor (`context.ts:334`), and keyed into the compile cache (`cache.ts:87`). It needs **no
> compiler change, no `compiler/dist` rebuild, and no cross-workspace commit** — verified by
> compiling `IUniswapV4_UniversalRouter.at(<addr>n).execute(...)` against `compiler/dist` with a
> registry ABI passed through `contracts` and **no import line and no `baseDirs` at all**, on both
> `target: 'v12'` (53 bytes) and `'v1'` (52 bytes). §17 therefore supersedes option 1's
> "inject an import line + serve a `.json` from `baseDirs`" plumbing for the PROTOCOL-accessor
> rewrite; U4's landed ERC20 arm keeps its import line untouched.

---

## 5. Library layering — the route body is a `main()`, everything else is `function`s

The route body is a `main()`. Plain SauceScript `function`s are the **reusable, non-intent standard
library**. Cross-chain is _strictly_ an intent-layer concern: **a library function is always
single-chain; the only way to cross a chain is to nest a route.**

The library already exists — it just needs to be reachable from a `main()` by the compiler's
helper/imported-function model rather than only by whole-program templating:

| existing module       | what it contributes                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sdk/src/swap`        | `swapSource()` (a whole `main()`), `swapCallStatement()` (one splice-able statement), `swapImportLines()`, `SWAP_BASE_DIRS` |
| `sdk/src/deposit`     | same pattern for deposits                                                                                                   |
| `sdk/src/descriptors` | EVM protocol accessor tree (name → ABI artifact + per-chain address)                                                        |
| `sdk/src/svm`         | SVM venue adapters + `/svm/engine` builders, `sdk/src/svm/accessors.ts`                                                     |
| `sdk/src/token`       | the universal `Token` global: `tokenCallStatement()`, `tokenExpression()`, `tokenImportLines()`, `TOKEN_BASE_DIRS`          |

Composition rule for a route body, already the de-facto convention in `swap/index.ts`'s own module doc:

> **union the import lines, union the `baseDirs`, splice the statements, emit one `main()`.**

The one upgrade this design asks for (S4) is to _also_ expose these as real SauceScript **source
files** compiled through the compiler's landed **source-import** machinery
(`import { swapExactIn } from "@sauce/swap"`), so a body can call them as ordinary helpers with
treeshaking dropping the unused ones — instead of the SDK textually inlining a statement. That is
strictly an ergonomics/codegen improvement over a mechanism that already works; it is **not** on the
critical path and is not in S1.

Anti-goal, stated explicitly: no library function ever takes a "chain" parameter, ever emits a
`publishAndFund`, or ever knows an intent exists.

---

## 6. Nesting = the cross-chain cascade

```ts
Base.route(() => {
  swapExactIn(USDC, WETH, amountIn);              // library, single-chain, runs on Base
  Arbitrum.route(() => {                          // nested → a CHILD intent
    deposit(WETH, self);                          // runs on Arbitrum
  }).reward({ tokens: [{ token: WETH, amount: /* runtime */ }] , … });
}).reward({ … });                                  // the HEAD reward — the user funds THIS one
```

### 6.1 Semantics

- **Outermost executes first**, and is the **head** — the only intent the user funds. Its own source
  chain is supplied explicitly.
- Each nested `Other.route(...).reward(...)` compiles, at that position in the parent body, to a
  `Portal.publishAndFund(childDestination, childRouteBytes, childReward, allowPartial)` call **inside
  the parent's Sauce program**.
- Therefore **the parent's execution chain IS the child's source chain**, and the child's vault is
  deployed and funded on the parent's chain. That is not a convention we invented — it falls straight
  out of §1.1: the source chain is _whoever calls publish_, and here that is the parent's Pot.
- **Fund the head only; execution self-funds the cascade.** The parent's own route brings tokens onto
  its chain (`route.tokens` — the solver delivers them), the parent body earns/holds the child's
  reward tokens, approves Portal, and calls `publishAndFund`. Depth _n_ is _n_ sequential
  publish-and-fund events, each paid for by the preceding leg's output.
- ~~On EVM the parent body executes inside the **V12 Pot** (`cook()`), so `msg.sender` at the Portal is
  the Pot: the Pot must hold and approve the child's reward tokens.~~ **WRONG — corrected 2026-08-10,
  see §15.3.** A static child's publish is a `route.calls` **sibling** of the Sauce `cook()` call, not
  something issued from inside the program, so `msg.sender` at the Portal is the eco-routes
  **`Executor`** — which is also where `Inbox._fulfill` deposits `route.tokens` and
  `route.nativeAmount`. The checkable invariant survives, just against the right actor: the parent's
  `route.tokens`/`route.nativeAmount` must cover every child's reward (§15.4 invariant 5).

### 6.2 What the parent actually emits, per child

Two flavors, and the distinction is the whole of §7:

- **STATIC child** — every reward field is known off-chain. Then the child's `intentHash`,
  `routeHash`, `rewardHash` and vault are all computable at build time; the parent's call is a plain
  pre-encoded `Call` (viem `encodeFunctionData` on `publishAndFund`), and the SDK can hand the caller
  the child's hash and vault immediately. This flavor needs **no runtime SauceScript beyond issuing
  the call**, and it is the one S5 should land first.
- **RUNTIME child** — some reward amount depends on parent output. §7.

Note the shape that makes both tractable: `publishAndFund(uint64, bytes route, Reward, bool)`.
The **route** may always be a precomputed literal blob (ABI or Borsh — the contract only hashes it),
so the compiler never has to construct a `Route` tuple, a `Call[]`, or nested dynamic bytes on-chain.
Only the `Reward` needs to be live.

---

## 7. Runtime compute — a child reward that depends on parent output

V2 rewards are **absolute**. There is no rate leg (that is a V3 feature and V3 is out of scope). So
"give the solver 99.5% of whatever this swap produced" cannot be expressed statically.

**Quote-and-bake was REJECTED** (baking an off-chain quote into an absolute amount makes the whole
cascade fail or leak value the moment the market moves between quote and execution).

**The design: the reward amount is a runtime SauceScript expression the parent computes and injects
into the published child.**

```ts
Arbitrum.route(...).reward({
  tokens: [{ token: WETH, amount: runtime`USDC.balanceOf(self) * 995n / 1000n` }],
  …
})
```

### 7.1 Consequences — state them, do not paper over them

1. The child's `rewardHash` is **not known off-chain**, therefore neither is its `intentHash`,
   therefore neither is its **vault address**. `.hash()`/`.vault()` on a runtime child must **throw**
   with a message naming the runtime field. They must never return a guess.
2. A solver **learns the child from the `IntentPublished` event** (which carries `destination`, the
   full `route` bytes, `creator`, `prover`, `rewardDeadline`, `rewardNativeAmount` and
   `rewardTokens` — i.e. everything needed to reconstruct the reward and re-derive the hash). This is
   sufficient; no extra indexing surface is required from us.
3. Everything _static_ about the child is still knowable at build time — the route bytes, the route
   hash, the destination. Expose those (`.routeHash()` works even when `.hash()` cannot).
4. Only the head is user-funded, so a runtime child never blocks the user's own signing flow.

### 7.2 The compiler shape this needs — a genuine open risk

The parent must build a `Reward` argument on-chain: a struct whose 5th field is a **dynamic array of
2-field structs** (`TokenAmount[]`). The compiler's ABI-argument path (`processAbiArg` /
`orderedStructTuple`, `compiler/src/processor/expression.ts`) does order struct fields by declared ABI
component order, recursively for nested tuples — that part is landed and unit-pinned. What is **not**
verified is an array-of-structs literal in argument position, and CLAUDE.md records a v12/svm
compile-time rejection for **nested array literals** (`assertNoNestedArrayLiteral`) and a rejection
for an object-literal field reading an existing dynamic variable (`assertNoDynamicVariableObjectField`).

Two fallbacks if the direct shape does not compile, both compiler-untouching:

- **(a) Single-token rewards only, first cut.** Restrict a runtime child to exactly one reward token
  (plus optional native), the overwhelmingly common case. `TokenAmount[]` of length 1 is a much
  smaller ask than the general case, and may compile today.
- **(b) Byte-splice the pre-encoded reward.** `abi.encode(Reward)` places a single dynamic
  `TokenAmount[]`'s `amount` at a **fixed, statically-known offset**. The SDK emits the reward blob as
  a literal with a placeholder word, and the parent program writes the runtime amount into that word
  before calling `publish`. Ugly, but purely mechanical and completely avoids on-chain struct
  construction. **However** — `publish`'s `Reward` parameter is a _typed struct_, not `bytes`, so this
  needs the raw-calldata escape (build the whole `publishAndFund` calldata as bytes and issue a
  low-level call), which the engine supports.

**Probing (a) and (b) with a real `compile()` is a prerequisite for S6 and is deliberately not
attempted in this design.** It is listed in openQuestions.

---

## 8. Reuse map — what is touched and what is not

| file                                         | stage 1                                                                                                                                                        | later                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `routes/types.ts`                            | **unchanged** (already V2)                                                                                                                                     | unchanged                 |
| `routes/normalize.ts`                        | **unchanged** (`normalizeRoute`/`normalizeReward`/`toUniversalAddress`/`toBigInt`)                                                                             | unchanged                 |
| `routes/encode.ts`                           | **unchanged**, consumed (`encodeRouteEvm/Svm`, `encodeRewardEvm/Svm`, `hashIntent`, `routeHash`, `rewardHash`, `kindOf`)                                       | unchanged                 |
| `routes/intent.ts`                           | **unchanged** (`assembleIntent` is reused as-is for the head)                                                                                                  | unchanged                 |
| `routes/sauce-calls.ts`                      | **unchanged**, consumed (`buildSauceEvmCall`, `buildSauceSvmCall`, `buildSauceCall`, `sauceEvmDeployPotCall`)                                                  | unchanged                 |
| `routes/builder.ts`                          | ~~unchanged~~ **REWRITTEN in U1 (§13.2)** — the callable chain-global replaces the leg-pipeline builder; only `PascalOf`/`pascalOfSlug` survive byte-identical | —                         |
| `routes/globals.ts` / `globals.generated.ts` | ~~unchanged~~ **EDITED / REGENERATED in U1** — each chain global becomes a callable function object carrying the same lazy namespaces                          | —                         |
| `routes/index.ts`                            | **+ additive re-exports**                                                                                                                                      | additive                  |
| **new** `routes/sauce-route.ts`              | compile-and-slot                                                                                                                                               | grows                     |
| **new** `routes/vault.ts`                    | CREATE2 vault predictor                                                                                                                                        | + registry constants      |
| **new** `routes/intent-dsl.ts`               | the fluent surface                                                                                                                                             | grows                     |
| `routes/portal.ts`                           | —                                                                                                                                                              | S2 (publish calldata)     |
| `routes/ambient.ts`                          | —                                                                                                                                                              | S3/S4 (defines + rewrite) |
| `routes/nest.ts`                             | —                                                                                                                                                              | S5/S6                     |

No file outside `sdk/src` is touched by S1–S5. The compiler is not touched at all under the
recommended path.

---

## 9. Staged plan

> **REVISED 2026-08-09.** S7 (the global flip) and S3 (closures) are pulled forward and merged into
> ONE coherent surface pass, together with the scalar half of S4. The revised sequence is:
>
> | pass    | content                                                                                                                                                                                            | state                 |
> | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
> | **S1**  | `intentOn(dest).route(sauceSource).reward(reward)` → V2 `Intent`, depth-1, EVM+SVM                                                                                                                 | **landed** (81eec11)  |
> | **S1b** | chain-global surface + `Base(…)` callable alias (replaces the old builder and retires `intentOn`), closure route bodies, chain-scoped scalar ambient defines, ERC20 token member rewrite. **§13.** | **landed** (c1c785f)  |
> | **S2**  | `.publishCalldata()` / `.publishAndFundCalldata(allowPartial)` / `.fundCalldata()` / `.approvals()` + the `Portal.intentVaultAddress` read-call. **§14** (units A1, A2).                           | **this pass, part A** |
> | **S5**  | nesting, STATIC children only, EVM parent, via `publishAndFund`. **§15** (units B1, B2).                                                                                                           | **landed**            |
> | **S5b** | **transfer-to-vault + declared cap becomes the DEFAULT nesting mechanism**; `publishAndFund` becomes an opt-in. **§16** (units B3, B4).                                                            | **designed, next**    |
> | **S4′** | the FULL protocol-accessor rewrite (`Uniswap.UniversalRouter.exactInput(…)` → `IX.at(ADDR)…`), `self` sugar, qualified cross-scope `Base.USDC`, library-as-source-imports                          | deferred              |
> | **S6**  | runtime-computed child rewards                                                                                                                                                                     | deferred              |
>
> The original table follows, for the record.

| stage  | content                                                                                                                                                                                                                                                                                             | breaks anything? |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **S1** | Depth-1 `intentOn(dest).route(sauceSource).reward(reward)` → V2 `Intent`; compile + slot into `route.calls`; `.hash()/.encodeEVM()/.encodeSVM()/.vault(cfg)/.intents()/.root()`. EVM + SVM. **No nesting, no ambient globals, no runtime compute, no compiler change.**                             | no               |
| **S2** | `.publishCalldata()` / `.publishAndFundCalldata(allowPartial)` / `.approvals()` — minimal Portal ABI fragment + `encodeFunctionData`; `sourceChainId` guard (EVM source only, for now).                                                                                                             | no               |
| **S3** | Closure sugar: `() => {…}` accepted as the route body via acorn extraction (block + concise, params). Minifier hazard documented.                                                                                                                                                                   | no               |
| **S4** | Chain-scoped ambient globals: per-chain `defines` from the registry (scalars, verified), + SDK-side source rewrite of accessor member-chains into `IX.at(ADDR)` + import-line/`baseDirs` injection; qualified `Base.USDC` cross-scope resolution. Expose the library as real source-import helpers. | no               |
| **S5** | **Nesting, STATIC children only**: a nested `.route().reward()` with a fully-known reward compiles to a pre-encoded `publishAndFund` `Call` in the parent body; `.intents()` returns head-first; cascade invariants asserted (approval, token availability, deadline monotonicity).                 | no               |
| **S6** | **Runtime-computed child rewards**: `runtime\`…\``expressions; the compiler-shape probe from §7.2 decides direct-struct vs. single-token vs. byte-splice;`.hash()/.vault()`throw on a runtime child; document the`IntentPublished` discovery contract.                                              | no               |
| **S7** | _(gated, breaking, user decision)_ Flip the global `Chain.route()` to the new `route(sauce)` semantics; migrate/deprecate `ChainOrigin.route(reward)`.                                                                                                                                              | **yes**          |

Each stage is independently committable and independently mergeable. S1–S6 are additive.

---

## 10. STAGE 1 — exact spec (LANDED at 81eec11; the `intentOn` surface is superseded by §13)

**Scope: a depth-1, single-chain, V2-correct `Chain.route(sauceSource).reward(reward)` producing an
`Intent`, with the Sauce program compiled and slotted into `route.calls`. Additive. No compiler
change. No nesting, no ambient globals, no runtime compute, no closures.**

### 10.1 Files

```
sdk/src/routes/sauce-route.ts     NEW   compile a SauceScript main() and slot it into route.calls
sdk/src/routes/vault.ts           NEW   pure CREATE2 vault-address prediction (§1.4)
sdk/src/routes/intent-dsl.ts      NEW   the fluent surface
sdk/src/routes/index.ts           EDIT  additive re-exports only
sdk/test/routes-intent-dsl.test.ts NEW  tests
```

### 10.2 API

```ts
// ---- sauce-route.ts -------------------------------------------------------
export interface SauceCompileOptions {
  /** Defaults per destination kind: 'v12' for evm, 'svm' for svm. Overridable. */
  target?: "v1" | "v12" | "svm";
  baseDirs?: readonly string[];
  tsSource?: boolean;
  treeshake?: boolean;
  defines?: Record<string, bigint | boolean | number>; // scalars only; S4 populates it automatically
}

/** EVM execution envelope — one `cook()` on a Pot. */
export interface SauceEvmExecutionInput {
  pot: AddressInput;
  value?: bigint | number | string;
}

/** SVM execution envelope — the caller must have STAGED the buffer (see sauce-calls.ts's module doc). */
export interface SauceSvmExecutionInput extends Omit<SauceSvmExecution, never> {
  programId?: SvmAddressInput;
  executor?: SvmAddressInput;
}

export interface CompiledSauceRoute {
  readonly calls: readonly CallInput[];
  readonly compiled: CompileResult; // bytecode / warnings / accountPlan, surfaced for debugging
  readonly source: string; // the exact program text handed to compile()
}

/**
 * Compiles `sauce` for `destination`'s VM and returns the CallInput(s) that execute it.
 * `sauce` may be a complete `function main(){…}` program or a bare body (wrapped automatically).
 */
export function compileSauceRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options?: SauceCompileOptions,
): CompiledSauceRoute;

// ---- vault.ts -------------------------------------------------------------
export interface VaultConfig {
  /** The Portal/IntentSource contract — the CREATE2 deployer. */
  readonly portal: AddressInput;
  /** keccak256(Proxy.creationCode ++ abi.encode(vaultImplementation)). NOT derivable from source —
   *  supply it from the deployment's artifacts, or verify against Portal.intentVaultAddress(). */
  readonly vaultInitCodeHash: Hex;
  /** 0xff standard EVM (default); 0x41 Tron. */
  readonly prefix?: Hex;
}

/** The exact off-chain twin of IntentSource._getVault → Clones.predict (see the design doc §1.4). */
export function predictVaultAddress(intentHash: Hex, config: VaultConfig): Hex;

/** Convenience: keccak256(concat(proxyCreationCode, abi.encode(address implementation))). */
export function vaultInitCodeHash(proxyCreationCode: Hex, implementation: AddressInput): Hex;

// ---- intent-dsl.ts --------------------------------------------------------
export interface SauceRouteSpec {
  readonly sauce: string;
  readonly execution: SauceEvmExecutionInput | SauceSvmExecutionInput;
  readonly compile?: SauceCompileOptions;
  // --- the V2 Route envelope (everything except `calls`, which this DSL produces) ---
  readonly salt?: Hex;
  readonly deadline: bigint | number | string;
  readonly portal: AddressInput;
  readonly nativeAmount?: bigint | number | string;
  readonly tokens?: readonly TokenAmountInput[];
  /** Extra calls the solver must run BEFORE the compiled program (e.g. an approval). */
  readonly precalls?: readonly CallInput[];
}

/** The reward is the SOURCE-chain-side object, so the source chain lives here. */
export interface SauceRewardSpec extends RewardInput {
  readonly source: ChainRef;
}

export interface BuiltIntent {
  readonly intent: Intent;
  readonly destination: CanonicalChain;
  readonly source: CanonicalChain;
  readonly compiled: CompileResult;
  root(): Intent; // == intent; forward-compatible with nesting
  intents(): Intent[]; // [intent]; head first
  hash(): IntentHashes; // hashIntent(intent)
  encodeEVM(): { route: Hex; reward: Hex };
  encodeSVM(): { route: Hex; reward: Hex };
  vault(config: VaultConfig): Hex;
}

export interface PendingSauceRoute {
  reward(spec: SauceRewardSpec): BuiltIntent;
}
export interface SauceIntentOrigin {
  readonly chain: CanonicalChain;
  route(spec: SauceRouteSpec): PendingSauceRoute;
}

/** Entry point. `dest` is the chain the Sauce program EXECUTES on. */
export function intentOn(dest: ChainRef): SauceIntentOrigin;
```

### 10.3 Behavior notes (the parts that are easy to get wrong)

- `route.calls = [...precalls, ...compiledCalls]`; everything then flows through the **existing**
  `normalizeRoute` → `Route`, and the head `Intent` is assembled by the **existing** `assembleIntent`
  (`source`, `destination`, routeInput, rewardInput). Nothing about the schema is re-implemented.
- Target defaults by `requireChain(dest).kind`: `evm` → `'v12'` + `buildSauceEvmCall`; `svm` → `'svm'`
  - `buildSauceSvmCall`. Use the existing `kindOf`/`buildSauceCall` fork rather than a new one.
- SVM requires a **staged buffer** — that is a solver-side prerequisite documented in
  `sauce-calls.ts`; S1 surfaces it as a required input and does not attempt staging.
- Bare-body detection: if the trimmed source contains no top-level `function main`, wrap it. Keep this
  rule dumb and documented; the smart version arrives with the acorn extraction in S3.
- `encodeEVM()` / `encodeSVM()` are explicit _kind_ selectors (they let a caller inspect either
  encoding); `hash()` uses the automatic per-side kind asymmetry already in `hashIntent`.
- `vault(config)` throws if `config.vaultInitCodeHash` is absent/malformed. **Ship no baked constant.**
- One `cook()` = one program (`V12Pot.cook` executes `ingredients[0]` only) — a multi-step body is ONE
  program with N statements, not N cooks. Do not "helpfully" split.

### 10.4 Tests — `sdk/test/routes-intent-dsl.test.ts`

1. **EVM happy path** — a trivial `function main(){ return 1n; }` on `base`: produces exactly one
   call; `call.target === toUniversalAddress(pot)`; `call.data` equals
   `v12Pot.encodeCook([bytesToHex(bytecode[0])])` computed independently in the test; `call.value === 0n`.
2. **Bare-body wrapping** — passing `return 1n;` yields byte-identical bytecode to the explicit
   `function main(){ return 1n; }` form.
3. **`precalls` ordering** — precalls precede the compiled call, in order.
4. **Assembled intent shape** — `destination`/`sourceChainId` are the two chains' ids as bigints;
   `route`/`reward` match `normalizeRoute`/`normalizeReward` of the same inputs (so the DSL adds
   nothing and drops nothing).
5. **`hash()` agrees with `hashIntent`** on the same `Intent`, and `routeHash` changes when the sauce
   source changes (non-vacuous: the program is genuinely in the hash preimage).
6. **`encodeEVM()`/`encodeSVM()`** equal the direct `encodeRouteEvm`/`encodeRouteSvm` +
   `encodeRewardEvm`/`encodeRewardSvm` calls.
7. **SVM path** — `solana` destination compiles with `target: 'svm'` and routes through
   `buildSauceSvmCall`; a nonzero `value` is rejected (SVM `Call` has no `value`).
8. **`vault()`** — pinned against a hand-computed CREATE2 (viem `getCreate2Address` with an explicit
   `bytecodeHash`) using a fixture portal/initCodeHash; a _different_ intent hash yields a different
   vault; a missing/short `vaultInitCodeHash` throws.
9. **Additive-ness guard** — the existing `chainAccessors.Base.route(reward)` builder and the ambient
   globals still behave exactly as `routes.test.ts` asserts (import both in one file; no clobber).
10. **Fail-closed** — unknown chain throws (`requireChain`); an SVM destination without a staged
    buffer throws with a message pointing at `sauce-calls.ts`'s staging note.

### 10.5 Gate

```
pnpm --filter ./sdk exec tsc --noEmit                        # 0 errors
pnpm --filter ./sdk exec tsc -p tsconfig.test.json --noEmit  # 0 errors
pnpm --filter ./sdk test                                     # jest, incl. the new file
```

`git status compiler/dist` must stay empty (compiler untouched). `docs/plans/*.md` stays untracked.
No publish, no tag, no PR.

---

## 11. Open questions

1. **`vaultInitCodeHash` / Portal address constants.** ~~critical path~~ **OFF the critical path as of
   2026-08-10 (user correction 1, §14).** `type(Proxy).creationCode` is solc-version and optimizer
   dependent and eco-routes commits no artifacts on `main` — so the PRIMARY vault path is now the
   on-chain `Portal.intentVaultAddress` read-call (`.vaultCall()`), which needs no constant at all.
   The offline predictor survives as `.predictVault(config)` and is still the thing that would _answer_
   this question: compare it to one live `intentVaultAddress` result.
2. **Was the live Portal deployed with an identical `portalSalt` on every chain?** The deploy script
   _supports_ chain-invariant CREATE2 addressing; that it was _used_ consistently is unverified. The
   "same vault address everywhere" claim in §1.4 depends on it. **Also off the critical path now** —
   no baked Portal address ships; `IntentOptions.sourcePortal` / an explicit `PortalTarget` is always
   caller-supplied (§14.4).
3. **Runtime-reward compiler shape (§7.2).** Does `Portal.publishAndFund(uint64, bytes, Reward, bool)`
   with a live single-element `TokenAmount[]` actually compile on v12? Needs a real `compile()` probe
   before S6 is planned in detail. Fallbacks (single-token restriction; byte-splice + raw call) are
   sketched but unverified.
4. **SVM Portal program.** Not in eco-routes on `main` (zero `.rs`). The SVM Borsh route encoding is
   schema-pinned but has **never been proven byte-parity against a deployed program** (encode.ts says
   so itself). Any SVM-destination intent this DSL builds inherits that caveat verbatim.
5. **SVM `publishAndFund` equivalent** — is there one, for a Solana-sourced parent publishing a child?
   Unknown from this repo. Until answered, nesting is EVM-parent only.
6. **`sourceChainDomainID`** in `fulfillAndProve`/`prove` is a bridge-provider domain id, _not_ a chain
   id. If the cascade ever needs to emit a prove call, this needs its own grounding.
7. **Prover selection.** `reward.prover` is caller-supplied today. For a cascade, does each leg pick
   its own prover, or does the head's choice constrain the children? Product decision.
8. **Closure sugar under a consumer's bundler.** `Function.prototype.toString()` is spec-sound and
   verified through _this repo's_ tsc emit, but a consumer's minifier can rename free identifiers or
   drop the body. Is a build-time transform (lifting the arrow text to a string literal) worth it, or
   is "document it and keep the string form as the escape hatch" enough?
9. **Naming / global flip (S7).** Does `Chain.route()` eventually change meaning (breaking, one clean
   API) or does the new surface keep its own name forever? User decision; nothing before S7 depends
   on it.
10. **`utils/intent.ts` in eco-routes.** Its `intentVaultAddress()` helper is stale w.r.t. the Clones
    scheme. Whether it is genuinely dead code there was not confirmed (call sites not grepped) — if
    anything downstream still uses it, that is an eco-routes bug worth reporting, not our problem.

---

## 12. Risks

1. **Absolute rewards are the structural constraint of the whole epic.** Everything awkward in §7 is
   downstream of V2 having no rate leg. If V3 lands, S6 gets much simpler — but V3 is out of scope and
   the design must not lean on it. Keeping `intent.ts`/`types.ts` as the sole schema-aware files (the
   existing, deliberate v3-swappable seam) is the hedge; the new DSL must respect it and never
   reference a V2 field name outside those files.
2. **A runtime child has no off-chain identity.** No hash, no vault, until it is published. Any UX that
   assumes "I can show the user every leg's vault before signing" is wrong for runtime children. The
   `.hash()`-throws rule is what keeps this honest instead of silently wrong.
3. **Cascade atomicity.** The head is one transaction; each child is a _separate_ intent fulfilled by a
   _separate_ solver. A cascade can stall halfway (child published+funded, never fulfilled) and then
   the child's `refund` path is the only recovery. ~~Deadlines must decrease outward-in~~ —
   **CORRECTED 2026-08-10, this was backwards**: deadlines must **INCREASE with nesting depth**. The
   child is published _during_ the parent's fulfillment, so the child's clock starts at whatever
   moment the parent was fulfilled, which can be as late as the parent's own `route.deadline`
   (`Inbox._fulfill` only reverts when `block.timestamp > route.deadline`). A child whose deadlines
   are _earlier_ than the parent's is therefore publishable-but-already-dead. §15.4 states the
   assertion the DSL enforces.
4. ~~**The Pot is the funder.**~~ **CORRECTED 2026-08-10 — the EXECUTOR is the funder, not the Pot.**
   `Inbox._fulfill` (read verbatim, §14.1) `safeTransferFrom`s every `route.tokens` entry from the
   solver to **`address(executor)`** and then calls `executor.execute{value: route.nativeAmount}(route.calls)`;
   `Executor.execute` does a plain `call.target.call{value}(call.data)` per entry. So `msg.sender` at
   the Portal for a child's `publishAndFund` is the **Executor**, and it is the Executor that must hold
   the child's reward tokens and grant the allowance. This is _better_ than the Pot story it replaces:
   a static child needs **no on-chain struct construction and no Sauce-program involvement at all** —
   the child publish is a sibling pre-encoded `Call` in the parent's own `route.calls` (§15.3).
5. **`toString()` fragility** (§3.3, openQuestion 8) — mitigated by making the string form primary.
6. **SVM byte-parity** (openQuestion 4) — a wrong Borsh layout produces a _plausible_ intentHash that
   no Solana solver can match. Nothing in the SDK can detect this; only one real on-chain vector can.
7. **Committed-`dist` discipline** — if any stage ever does touch the compiler, the same commit must
   rebuild and `git add -f` `compiler/dist` (CI rebuilds and therefore _masks_ a stale committed dist).
   The recommended path avoids this entirely; deviating from it re-introduces the hazard.
8. **Global-namespace pressure.** The ambient chain globals already cost a consumer TS2451 if they
   declare their own `const Base`. S4's ambient _SauceScript_ globals are a different namespace and do
   not add to that, but S7's flip would. Keep them mentally separate.
9. **Scope creep into V3.** The eco-routes working tree sitting on the V3 branch makes accidental V3
   grounding a standing hazard for every future agent on this epic. §0's warning is load-bearing.

---

## 13. STAGE 1b — the coherent chain-global surface (THIS PASS)

Mandate, 2026-08-09: go chain-global now, replace the old builder, hold on `feat/xchain-intent-dsl`
until the surface is whole. Four independently-committable build units, in order. U1–U3 are the
mandated core; U4 is the tail that makes the literal headline shape compile and is the clean cut
line if the pass runs long.

### 13.1 The target shapes, and exactly what each one needs

```ts
Base(() => USDC.transfer(to, amount), opts).reward(amount + 10n); // U1 alias + U2 closure + U3 defines + U4 rewrite
Base.route(() => USDC.transfer(to, amount), opts).reward(reward); // same, explicit .route
Solana.route(sauceString, opts).reward(reward); // U1 only (stage-1 string form, preserved)
```

Three honesty notes, decided here rather than discovered during build:

1. **`to` / `amount` inside a closure are NOT captured.** `Function.prototype.toString()` gives text,
   not scope; SauceScript has no closures. A free identifier that is neither a chain-scoped ambient
   name nor a caller-supplied define is a hard `undefined variable: X` compile error — the correct,
   fail-closed behavior (§3.2). The caller supplies them through `opts.defines` (U3 threads the
   chain map underneath). U2 catches that compiler error and re-throws it naming the mechanism, so
   the failure reads as guidance instead of a compiler internal.
2. **`.reward(amount + 10n)` means a NATIVE reward.** A bare `bigint` shorthand can only be read one
   way without inventing semantics; a token reward must name its token
   (`.reward({ tokens: [{ token: USDC, amount }] })`). The remaining required V2 reward fields
   (`source`, `creator`, `prover`, reward `deadline`) come from the SAME per-call `opts` bag — no
   ambient mutable config, no invented addresses (see 13.2's `IntentOptions`).
3. **`USDC` is not a built-in address.** The SDK has **no EVM token address registry** (checked:
   `protocols/erc20/addresses.ts` is deliberately empty, and the only in-repo token constants are
   SVM mints inside `svm/venues/*`). U3 therefore seeds token symbols **only** from a caller-supplied
   map; shipping unverified token addresses is a value-loss hazard and this pass ships none. A
   curated, separately-verified token registry is its own later unit.

### 13.2 U1 — chain-global surface, callable alias, and the old-builder replacement

**The callable-alias typing** (the exact shape; the call signature and `.route` are one type by
construction, so they can never drift):

```ts
// routes/builder.ts
export interface ChainRoute {
  (sauce: SauceBody, options?: IntentOptions): PendingSauceRoute;
}
export interface ChainGlobal extends ChainRoute {
  // inherits the call signature
  readonly chain: CanonicalChain;
  readonly route: ChainRoute; // === the call signature, same interface
}
export type ChainGlobals = { readonly [S in ChainSlug as PascalOf<S>]: ChainGlobal };
```

Ambient install (`globals.generated.ts`, regenerated by `scripts/gen-route-globals.mjs`):

```ts
const Base: ChainGlobals["Base"] & ChainContracts;
const Solana: ChainGlobals["Solana"] & ChainContracts & SvmVenueAccessors;
```

Runtime: `makeChainGlobal(chain)` builds an **arrow function** (arrows have no own `prototype`, so
one fewer name to collide with) and `Object.defineProperties` `chain`/`route` onto it as
`enumerable: true` — `Object.keys(chainAccessors.Base)` stays exactly `["chain","route"]`, which is
what the existing globals test already pins.

`routes/globals.ts#composeChainGlobal` changes shape: it can no longer build a plain
`Object.defineProperties({}, …)` (that would silently drop callability). It now allocates a FRESH
callable that forwards to `origin.route`, then defines `chain`/`route` plus the lazy `ChainContracts`
(and, for `kind === "svm"`, `SvmVenueAccessors`) getter descriptors onto it — laziness preserved,
`origin` still never mutated. Its collision throw is extended with a hard denylist of function
intrinsics (`length`, `name`, `prototype`, `arguments`, `caller`, `bind`, `call`, `apply`,
`toString`, `constructor`), because a namespace key landing on one of those would corrupt the
callable rather than merely shadow a property.

**`IntentOptions`** — one bag carrying the destination-execution envelope, the V2 route envelope
minus `calls`, and the reward defaults the shorthand resolves against:

```ts
export interface IntentOptions {
  execution?: SauceEvmExecutionInput | SauceSvmExecutionInput;   // EVM: { pot, value? }; SVM: staged buffer
  pot?: AddressInput;                    // shorthand for execution.pot on an EVM destination
  compile?: SauceCompileOptions;         // target/baseDirs/tsSource/treeshake/defines
  defines?: Record<string, bigint | boolean | number>;   // merged over the chain-scoped map (U3)
  salt?: Hex; deadline: …; portal: AddressInput; nativeAmount?: …; tokens?: …; precalls?: …;
  source?: ChainRef; creator?: AddressInput; prover?: AddressInput; rewardDeadline?: …;
}
export type RewardArg = SauceRewardSpec | bigint | readonly TokenAmountInput[];
export interface PendingSauceRoute { reward(reward: RewardArg): BuiltIntent; }
```

`BuiltIntent` is unchanged from §10.2 (`intent`/`destination`/`source`/`compiled`/`root()`/
`intents()`/`hash()`/`encodeEVM()`/`encodeSVM()`/`vault(cfg)`).

**Replacement, precisely.** `routes/builder.ts` is REWRITTEN in place (not deleted — two other
modules import `PascalOf`/`pascalOfSlug` from it and those stay byte-identical): out go
`ChainOrigin`, `PendingLeg`, `ChainStage`, `DestinationMethod`, `DestinationSelectors`, `Assembler`,
`createChainAccessors`, `makeChainOrigin`, `ChainAccessors`; in come `ChainRoute`, `ChainGlobal`,
`ChainGlobals`, `makeChainGlobal`, `createChainGlobals`. `builder.ts`'s own narrow `ChainRef` is
dropped in favour of the canonical registry's (`chains/canonical.ts`, which also accepts `bigint`),
re-exported from `routes/index.ts` so the public name survives — this also removes the
`builder.ts ↔ sauce-route.ts` type-import cycle. `accessors.ts` keeps its exported names
(`chainAccessors`, `chain`) with the new types, so `globals.ts`'s enumeration is a one-line retype.
`intent-dsl.ts` loses `intentOn`/`SauceIntentOrigin`/`SauceRouteSpec` and gains
`IntentOptions`/`RewardArg`/`openRoute(chain, sauce, options)`. `routes/index.ts` re-exports the new
names and drops the removed ones. Nothing outside `sdk/src/routes` + `sdk/test` referenced any
removed name (verified by grep across all four workspaces).

Tests: `routes.test.ts` is rewritten for the new surface (alias/`.route` identity, registry-derived
key set, per-chain `.chain`, stage immutability, unknown-chain throw); `routes-globals.test.ts`
swaps its leg-pipeline end-to-end case for the chain-global one and adds callability + intrinsic-
collision cases; `routes-globals-ambient-types.test.ts` swaps the `Base.route(reward)` probe for
`Base(sauce)` / `Base.route(sauce)` probes **plus a negative control that the OLD reward-first call
no longer typechecks** (the type-level proof there is exactly one meaning of `Chain.route`);
`routes-globals-drift.test.ts` is mechanism-unchanged against the regenerated file;
`routes-intent-dsl.test.ts` is retargeted from `intentOn` to the chain global.

### 13.3 U2 — closure route bodies

`routes/closure.ts`: `type SauceBody = string | (() => unknown)`, and
`sauceBodyToSource(body): string` returning a complete `function main(){…}`.

Mechanism (§3.2, verified): `Function.prototype.toString.call(fn)` → parse `(${text})` with **acorn**
(already a runtime dependency of the published root package; add it to `sdk/package.json` for
workspace hygiene) → take the `ArrowFunctionExpression`/`FunctionExpression` → for a `BlockStatement`
body, slice the ORIGINAL text between its braces; for a concise body, synthesize `return <slice>;`.
Never hand-slice on `=>`. Fail closed with named errors on: a parse failure, `[native code]`, an
`async` or generator function, any parameter (`main(args)` support is a deliberate later unit), or a
`toString` result that is not a function at all. A compiler `undefined variable: X` raised while
compiling a closure body is caught and re-thrown explaining that closures cannot capture and that `X`
must come from the chain-scoped ambient names or `options.defines`.

The string form is untouched and stays the escape hatch (the minifier hazard of §3.3/openQuestion 8
is real for a consumer's bundler, not for this repo's ES2022 tsc emit).

### 13.4 U3 — chain-scoped scalar ambient defines

`routes/ambient.ts`: `chainDefines(chain, opts): Record<string, bigint | boolean | number>`, threaded
into `compileSauceRoute`'s `defines` **underneath** the caller's own `options.defines` (caller wins;
a user's `let USDC = …` inside the body already wins over both, since `getConstant` is only consulted
when `ctx.getVar` is undefined — §4.1).

Seeded from data the SDK already owns, nothing invented:

- `chainId` (and `CHAIN_ID`) = `BigInt(chain.id)`, from the canonical registry.
- EVM protocol contract addresses from `descriptors/registry.ts`, keyed `<PascalProtocol>_<Contract>`
  (e.g. `UniswapV4_UniversalRouter`), emitted only where that chain actually has an address.
- Caller-supplied token symbols (`opts.tokens` / `IntentOptions.tokens` symbol map) — see 13.1(3).
  **SUPERSEDED by §18.4**: caller symbols are now the OVERRIDE layer over the per-chain token-address
  registry (§18.2), which is the default source.

Explicitly NOT in this unit, each named so it is not mistaken for an oversight: `self` (it is a
runtime intrinsic, not a constant — `defines` cannot carry it; the working spelling stays
`address.self`, and the bare-`self` sugar rides with the S4′ rewrite that already needs an identifier
pass); SVM venue program ids (base58 → bigint decode, trivial but unneeded here); family-alias
spellings (`Uniswap_UniversalRouter`); qualified cross-scope `Base.USDC` (needs nesting).

### 13.5 U4 — ERC20 token member rewrite (tail unit; cut line)

> **EXTENDED by §18** — the ambient TOKEN map is now registry-backed by default (no `tokenDefines`
> required), and the same pass gained the `<holder>.<TOKEN>` balance sugar. Read §18.4–18.7 alongside
> this section; the U4 emission shape itself is unchanged.

What makes `USDC.transfer(to, amount)` real. A **token-only** acorn source rewrite: a member call
`<Sym>.transfer|approve|balanceOf(args)` where `<Sym>` is a name in the chain's ambient TOKEN map is
rewritten to `IERC20.at(<Sym>).<method>(args)`, with `ERC20_IMPORT_LINE` prepended and
`TOKEN_BASE_DIRS` unioned into `baseDirs` — byte-identical to what `token/evm.ts` already emits, so
nothing new reaches the compiler. Shadowing-aware (a local binding of `<Sym>` suppresses the
rewrite); EVM destinations only (SPL needs an account plan — a named error on `svm`).

This is deliberately NOT the S4′ protocol-accessor rewrite: no descriptor tree walk, no per-protocol
artifacts, one hardcoded interface. If this pass runs long, cut U4 — U1–U3 stand alone and the
`Token.transfer(…)` emitter remains the working spelling.

### 13.6 Gate (unchanged from §10.5) and freeze

```
pnpm --filter ./sdk exec tsc --noEmit                        # 0
pnpm --filter ./sdk exec tsc -p tsconfig.test.json --noEmit  # 0
pnpm --filter ./sdk test                                     # jest
```

`git status compiler/dist` stays empty (no compiler change — the surface, closures and scalar defines
are all achievable SDK-side; if a compiler change ever looks unavoidable, STOP and report). Commit
each unit on green, understated messages, no AI-attribution trailer. No publish, no tag, no push, no
PR. `docs/plans/*.md` stays untracked.

---

## 14. STAGE 2 — submission calldata, the vault read-call, and `.approvals()` (LANDED, part A)

> **Landed 2026-08-10.** Unit A1 (`routes/portal.ts` + `routes-portal.test.ts`) at `dd8cd4f`; unit A2
> (`intent-dsl.ts` submission surface + `sourcePortal`) in the same commit. Full SDK gate green (both
> `tsc --noEmit` checks 0 errors, jest all suites green), `compiler/dist` untouched. No deviations from
> the spec below — `.vault()` stayed the deprecated alias exactly as flagged, `.vaultCall()` is primary.

Mandate, 2026-08-10 (two user grounding corrections, both now verified against
`git -C …/eco-routes show main:…` and both **confirmed correct**):

> 1. `.vault()` should use the ON-CHAIN getter `Portal.intentVaultAddress(intent)` (an `eth_call`) —
>    no need to bake the CREATE2 init-code-hash / Portal-address constants. Keep the existing offline
>    CREATE2 predictor as an OPTION; the primary path is a read-call helper the caller `eth_call`s.
> 2. `publishAndFund(intent, allowPartial)` publishes AND funds — it escrows the reward from the
>    caller. So the cross-hop link is simply a `publishAndFund(child, allowPartial)` call inside the
>    parent route; the parent's execution funds the child. Confirm HOW `reward.tokens` are pulled so
>    `.approvals()` emits the correct ERC20 approvals.

Correction (1) also **retires openQuestions 1 and 2 from the critical path**: nothing in the primary
flow needs `vaultInitCodeHash` or a chain-invariant Portal address any more. The offline predictor
(`vault.ts`, unchanged) survives as an _option_ for a caller who wants a vault address with zero RPC,
and as the cross-check that would _answer_ openQuestion 1 (compare it to one live `intentVaultAddress`
result).

### 14.1 Grounding — exactly how a reward is pulled (`IntentSource.sol`, verbatim)

```solidity
function _publishAndFund(uint64 destination, bytes memory route, Reward memory reward,
                         bool allowPartial, address funder) internal override … {
    (intentHash, vault) = publish(destination, route, reward);
    _fundIntent(intentHash, vault, reward, funder, allowPartial);
    Refund.excessNative();
}
// publishAndFund(...) passes funder = msg.sender

function _fundIntent(bytes32 intentHash, address vault, Reward memory reward,
                     address funder, bool allowPartial) internal onlyFundable(intentHash) {
    bool fullyFunded = _fundNative(vault, reward.nativeAmount);
    for (uint256 i; i < reward.tokens.length; ++i)
        fullyFunded = fullyFunded && _fundToken(vault, funder, IERC20(reward.tokens[i].token),
                                               reward.tokens[i].amount);
    if (!allowPartial && !fullyFunded) revert InsufficientFunds(intentHash);
    if (fullyFunded) rewardStatuses[intentHash] = Status.Funded;
    emit IntentFunded(intentHash, funder, fullyFunded);
}

function _fundToken(address vault, address funder, IERC20 token, uint256 rewardAmount)
        internal returns (bool funded) {
    uint256 balance = token.balanceOf(vault);
    if (balance >= rewardAmount) return true;                       // vault already covered -> NO transfer
    uint256 remaining = rewardAmount - balance;
    uint256 transferAmount = remaining.min(token.allowance(funder, address(this)))
                                      .min(token.balanceOf(funder));
    if (transferAmount > 0) token.safeTransferFrom(funder, vault, transferAmount);
    return balance + transferAmount >= rewardAmount;
}

function _fundNative(address vault, uint256 rewardAmount) internal returns (bool funded) {
    uint256 balance = vault.balance;
    if (balance >= rewardAmount) return true;
    uint256 transferAmount = (rewardAmount - balance).min(msg.value);
    if (transferAmount > 0) payable(vault).transfer(transferAmount);
    return transferAmount >= rewardAmount - balance;
}
```

**Therefore, stated flatly, with no inference left implicit:**

| question                | answer, grounded                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| who is the funder?      | `msg.sender` of `publishAndFund`/`fund` (`funder` is only a separate address on the `*For` permit variants, out of scope)                                                                                        |
| approve **whom**?       | **the Portal itself** — `token.allowance(funder, address(this))`, and `address(this)` _is_ the Portal (`Portal is IntentSource, Inbox, Semver`). **NOT the vault.**                                              |
| tokens move where?      | `safeTransferFrom(funder, vault, amount)` — funder → vault, pulled _by_ the Portal                                                                                                                               |
| plain `approve` enough? | yes — `SafeERC20.safeTransferFrom`, no Permit2, no signature. `fundFor`/`publishAndFundFor` take an `IPermit` contract; deliberately out of scope.                                                               |
| native?                 | `msg.value` on the call; `_fundNative` takes only what's short, and `Refund.excessNative()` returns the remainder to `msg.sender`. So `value = reward.nativeAmount` exactly is correct and over-sending is safe. |
| already-funded vault?   | `_fundToken`/`_fundNative` short-circuit on `balanceOf(vault) >= amount`. So an approval is _sufficient_ but not always _consumed_; approving the full amount is never wrong.                                    |

`Inbox._fulfill` (the destination side, load-bearing for §15):

```solidity
for (…) IERC20(route.tokens[i].token).safeTransferFrom(msg.sender, address(executor), token.amount);
return executor.execute{value: route.nativeAmount}(route.calls);
// Executor.execute -> per call: call.target.call{value: call.value}(call.data), onlyPortal,
//                     reverting CallToEOA when target.code.length == 0 && data.length > 0
```

So on the destination chain the **Executor holds `route.tokens` and `route.nativeAmount`, and is
`msg.sender` for every `route.calls` entry.**

### 14.2 The ABI fragment — the `bytes`-route overloads ONLY, and why

`publish`/`publishAndFund`/`intentVaultAddress`/`getIntentHash`/`isIntentFunded` each exist in an
`Intent`-tuple form and a `(uint64 destination, bytes route, Reward reward, …)` form. **This design
uses the `bytes` form exclusively**, for two independent reasons:

1. **Correctness across VMs.** For an SVM destination the route crosses `publish` as hand-rolled
   **Borsh** (§1.5). The `Intent`-tuple overload would make the Portal `abi.encode(intent.route)`
   itself — a _different_ `routeHash` than the one `hashIntent` computed, i.e. a silently
   unfulfillable intent. The `bytes` overload lets us hand over exactly the blob we hashed. One code
   path, both destination kinds.
2. **No viem overload ambiguity.** A minimal ABI carrying one overload per name means
   `encodeFunctionData({ abi, functionName })` can never resolve to the wrong signature.

```ts
// routes/portal.ts
export const PORTAL_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "vault", type: "address" },
    ],
  },
  {
    type: "function",
    name: "publishAndFund",
    stateMutability: "payable",
    inputs: [/* destination, route, reward, */ { name: "allowPartial", type: "bool" }],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "vault", type: "address" },
    ],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "payable",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "routeHash", type: "bytes32" },
      EVM_REWARD_PARAM,
      { name: "allowPartial", type: "bool" },
    ],
    outputs: [{ name: "intentHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "intentVaultAddress",
    stateMutability: "view",
    inputs: [/* destination, route, reward */],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getIntentHash",
    stateMutability: "pure",
    inputs: [/* destination, route, reward */],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "routeHash", type: "bytes32" },
      { name: "rewardHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "isIntentFunded",
    stateMutability: "view",
    inputs: [/* destination, route, reward */],
    outputs: [{ type: "bool" }],
  },
] as const;
```

`EVM_REWARD_PARAM` is **imported from `encode.ts`, not re-declared** — it is already the pinned
`(uint64,address,address,uint256,(address,uint256)[])` tuple used by `encodeRewardEvm`, so the
calldata's reward encoding and the `rewardHash` that `hashIntent` computed are the same bytes by
construction, not by coincidence. Same for the route: the `bytes` argument is
`encodeRoute(intent.route, intent.destination)` — literally the function `routeHash` calls.

### 14.3 API — `routes/portal.ts` (NEW, pure; no `BuiltIntent` knowledge)

```ts
/** A submittable transaction request. `value` is always explicit, never omitted. */
export interface PortalTx {
  readonly to: Hex;
  readonly data: Hex;
  readonly value: bigint;
}

/** An `eth_call` request plus its own decoder — the caller does the RPC, this module never does. */
export interface PortalReadCall<T> {
  readonly to: Hex;
  readonly data: Hex;
  decode(result: Hex): T;
}

/** Where to submit. `portal` is the SOURCE-chain Portal (never defaulted, never invented). */
export interface PortalTarget {
  readonly portal: AddressInput;
}

export function publishTx(intent: Intent, target: PortalTarget): PortalTx; // value 0n
export function publishAndFundTx(
  intent: Intent,
  allowPartial: boolean,
  target: PortalTarget,
): PortalTx;
// value = reward.nativeAmount
export function fundTx(intent: Intent, allowPartial: boolean, target: PortalTarget): PortalTx;
// value = reward.nativeAmount

/** One `approve(portal, amount)` per reward token — §14.1's table, row 2. `value` 0n. */
export function approvalTxs(intent: Intent, target: PortalTarget): readonly PortalTx[];

export function intentVaultAddressCall(intent: Intent, target: PortalTarget): PortalReadCall<Hex>;
export function intentHashCall(intent: Intent, target: PortalTarget): PortalReadCall<IntentHashes>;
export function isIntentFundedCall(intent: Intent, target: PortalTarget): PortalReadCall<boolean>;
```

Details that are decisions, not incidentals:

- **EVM-SOURCE GUARD.** Every one of these throws a named error when `kindOf(intent.sourceChainId) !==
"evm"`: these are EVM Portal calldata, and the Solana Portal _program_ is not in eco-routes on
  `main` (zero `.rs` — openQuestions 4/5). The **destination** may be `svm` and is fully supported —
  that is exactly the `DepositAddress_USDCTransfer_Solana.sol` shape (§1.5): EVM-sourced reward,
  Borsh route bytes.
- `approvalTxs` reuses the existing **`ERC20ABI`** (`protocols/erc20/abis.ts`) — the same ABI
  `token/api.ts#toCall` already encodes `approve` with. No second ERC20 fragment enters the SDK.
- A reward token whose `UniversalAddress` is not EVM-representable throws via the existing
  `denormalizeToEvm` (which rejects rather than truncating) — an SVM mint can never silently become a
  20-byte spender.
- `approvalTxs` emits **exact-amount** approvals in reward-token order, and emits **nothing** for
  `reward.nativeAmount` (native needs `value`, not an approval). Zero-amount reward tokens are
  emitted as-is rather than filtered — the caller asked for that reward shape; silently dropping a
  leg of it is worse than a useless-but-harmless approve.
  - SUPERSEDED as shipped: one-per-entry meant a duplicate token's later entry replaced the earlier
    allowance. `approvalTxs` now emits one approve per DISTINCT token, for the largest of its
    amounts, in first-seen order. See `portal.ts#approvalTxs`.
- We do **not** emit `allowance`/`balanceOf` read-calls to let a caller skip a redundant approve. The
  module doc says so and points at `isIntentFundedCall` for the "is this already funded?" question.

### 14.4 API — the `BuiltIntent` surface (`intent-dsl.ts`)

```ts
export interface IntentOptions {
  /* … unchanged … */
  /** The SOURCE-chain Portal — where this intent is PUBLISHED. Distinct from `portal`, which is the
   *  DESTINATION-chain Portal that goes into `route.portal`. Used as the default target for every
   *  submission/read helper below. */
  sourcePortal?: AddressInput;
}

export interface BuiltIntent {
  /* … unchanged … */
  publishCalldata(target?: Partial<PortalTarget>): PortalTx;
  publishAndFundCalldata(allowPartial: boolean, target?: Partial<PortalTarget>): PortalTx;
  fundCalldata(allowPartial: boolean, target?: Partial<PortalTarget>): PortalTx;
  /** HEAD reward tokens only — see the note below. */
  approvals(target?: Partial<PortalTarget>): readonly PortalTx[];

  /** PRIMARY vault path: the on-chain `Portal.intentVaultAddress` read-call (user correction 1). */
  vaultCall(target?: Partial<PortalTarget>): PortalReadCall<Hex>;
  /** OPTION: the offline CREATE2 predictor — zero RPC, needs `vaultInitCodeHash` (see `vault.ts`). */
  predictVault(config: VaultConfig): Hex;
  /** @deprecated alias of `predictVault`, kept so the landed surface + its test stay working. */
  vault(config: VaultConfig): Hex;

  /** Cross-check helpers: our off-chain `hash()` vs the chain's own, and funded status. */
  hashCall(target?: Partial<PortalTarget>): PortalReadCall<IntentHashes>;
  fundedCall(target?: Partial<PortalTarget>): PortalReadCall<boolean>;
}
```

`target.portal ?? options.sourcePortal`, and a named throw when neither is present. No baked Portal
address ships (openQuestion 2 is unresolved and this design does not depend on it either way).

**`approvals()` is head-only, on purpose.** The user funds the head; every _child_ is funded by the
parent's own execution, and its approvals are `route.calls` entries executed by the **Executor**, not
by the user (§15.3). Emitting a child's approvals here would tell the user to approve tokens they are
never asked to spend. `BuiltIntent.intents()` gives a caller every leg if they want to inspect them.

**`.vault()` naming — flagged for user review.** The correction says `.vault()` should _be_ the
on-chain getter. `.vault(config)` is already landed and unit-tested as the offline predictor, and the
pass constraint is "keep the surface working", so the on-chain getter lands as **`.vaultCall()`** and
the docs make it the primary path, with `.predictVault(config)` as the named option and `.vault()`
kept as a deprecated alias. If you would rather have `.vault()` itself return the read-call (and the
offline one live only at `.predictVault()`), that is a one-line flip plus one test edit — say so.

### 14.5 Units (each independently committable, each green on the full gate)

| unit   | files                                                                                                        | content                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | `sdk/src/routes/portal.ts` (NEW), `routes/index.ts` (EDIT, additive), `sdk/test/routes-portal.test.ts` (NEW) | `PORTAL_ABI`, `PortalTx`/`PortalReadCall`/`PortalTarget`, `publishTx`/`publishAndFundTx`/`fundTx`/`approvalTxs`, the three read-calls, the EVM-source guard. Pure — takes a plain `Intent`, no DSL. |
| **A2** | `routes/intent-dsl.ts` (EDIT), `routes/index.ts` (EDIT), `sdk/test/routes-intent-dsl.test.ts` (EDIT)         | `IntentOptions.sourcePortal`; the eight `BuiltIntent` methods above wired to A1; `predictVault` + the deprecated `vault` alias.                                                                     |

**A1 tests** (hand-built `Intent`s, no compiler needed): selector + decoded-args round-trip for each
tx (decode with the same ABI and assert the route `bytes` equals `encodeRoute(route, destination)` and
the reward tuple round-trips through `decodeRewardEvm`); `publishAndFundTx.value === reward.nativeAmount`
and `publishTx.value === 0n`; `approvalTxs` — one per reward token, in order, spender is the **Portal**
(an explicit negative assertion that it is _not_ the vault address), amount exact, `value === 0n`,
empty array for a native-only reward; `intentVaultAddressCall.decode` against a hand-built 32-byte
ABI word; `intentHashCall.decode` shape; **an SVM-destination intent produces valid calldata whose
route bytes are the Borsh blob** (the cross-VM case, pinned); an SVM-_source_ intent throws the named
guard error for every helper.

**A2 tests**: `sourcePortal` defaulting and the named throw when absent; `target.portal` overriding it;
each method delegates to A1 (equality against the direct A1 call on `built.intent`); `approvals()`
covers head reward tokens only; `vault(cfg) === predictVault(cfg)` (the alias is byte-identical);
`vaultCall().to` is the source Portal.

---

## 15. STAGE 5 — STATIC nesting (LANDED, part B)

> **Landed 2026-08-10.** Unit B1 (`routes/nest.ts` + `routes-nest.test.ts`) at `6ab0731`; unit B2
> (`PendingSauceRoute.nest()` + `BuiltIntent.children`/pre-order `intents()`) at `b15939c`. Full SDK
> gate green throughout, `compiler/dist` untouched. No deviations — the thunk form, the
> BuiltIntent-form source-mismatch throw, `position: "before"|"after"` (default `"after"`), and all
> six `assertNestingInvariants` checks landed exactly as specified below.

> **DEFAULT FLIPPED 2026-08-11 — see §16.** Everything in this section stays exactly as landed, but
> the `publishAndFund` splice it describes is now reached via `.nest(child, { via: "publishAndFund" })`;
> the DEFAULT mechanism is transfer-to-vault (§16). Read §15 for the opt-in path and §16 for the
> default one.

**Scope: an EVM-parent cascade whose children are fully known off-chain.** Runtime-computed child
rewards (§7/S6) stay out; so does SVM-parent nesting, and so does the full protocol-accessor rewrite.

### 15.1 The language seam — the aspirational syntax cannot work, and why (USER REVIEW REQUIRED)

§6's headline shape is:

```ts
Base.route(() => {
  swapExactIn(USDC, WETH, amountIn);
  Arbitrum.route(() => { deposit(WETH, self); }).reward({ … });   // <- a nested TS call?
}).reward({ … });
```

**It cannot be made to work honestly, and the reason is structural, not an implementation gap.** The
parent closure is **never executed as JavaScript**. `sauceBodyToSource` (`closure.ts`) takes
`Function.prototype.toString()` and hands the _text_ between the braces to the SauceScript compiler.
So a nested `Arbitrum.route(...)` inside that text is not a TS call at all — it is SauceScript source
the compiler reads, and it fails with `undefined variable: Arbitrum`. Three separate walls, any one
of which is fatal:

1. **No evaluation.** To turn that text back into a child intent we would need to _evaluate_ a JS
   expression that we only have as source. That means shipping an evaluator, and re-introducing
   exactly the "silently bake a stale JS value into bytecode" hazard that `closure.ts`'s
   fail-closed-on-free-identifier rule exists to prevent.
2. **No capture, so no operands.** Even with an evaluator, the child's `reward` object references
   caller-scope values (`WETH`, `amount`, `creator`, `prover`) — and a closure body captures nothing
   by construction. Every child field would have to be a source-level literal.
3. **No compiler seam for it.** Even if 1 and 2 were solved, the nested call sits _between two
   statements of the parent program_, and a static child is a `route.calls` sibling of the whole
   compiled program (§15.3) — there is no position "between statement 2 and 3 of one `cook()`".

**The API this design proposes instead — `.nest()`, a real, executed TS composition:**

```ts
Base.route(parentBody, parentOpts) // parentBody: closure or string, unchanged
  .nest((on) => Arbitrum.route(childBody, { ...childOpts, source: on }).reward(childReward))
  .reward(headReward);
```

`.nest()` takes either a already-built `BuiltIntent` **or** a thunk `(parentChain: CanonicalChain) =>
BuiltIntent`. The thunk form is the documented preferred one, for one concrete reason: the child's
**`source` IS the parent's destination** (§6.1 — the source chain is whoever calls `publish`, and that
is the parent's execution), so the thunk hands it to you and there is nothing to get wrong. The
`BuiltIntent` form is accepted for a pre-built child and asserts `child.source.id ===
parent.destination.id` rather than silently accepting a mismatched leg.

**Divergences from the aspirational syntax, stated plainly for review:**

| aspiration                                                         | what `.nest()` actually gives                                                                                                                                                                     | severity                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| child sits _lexically inside_ the parent body                      | child sits in a sibling `.nest(...)` position; indentation still reads as nesting                                                                                                                 | cosmetic                                       |
| child can be positioned _between statements_ of the parent program | child runs **before or after the parent's whole program** (`{ position: "before" \| "after" }`, default `"after"`) — one `cook()` is atomic and cannot be interleaved                             | real, and the only genuine expressiveness loss |
| child's operands come from enclosing JS scope                      | they do — the thunk is real, executed TS, so `WETH`/`amount`/`creator` are ordinary captured variables. **This is strictly better than the aspiration**, where they could not have worked at all. | improvement                                    |

If you want the lexical form regardless, the only honest route is a **build-time transform** (a
codemod / TS transformer lifting nested `Chain.route(...)` calls out of closure bodies before they are
ever `toString()`d) — a genuinely separate tool, not an SDK runtime feature, and openQuestion 8's
minifier hazard applies to it doubled. Not proposed here.

_(Naming note: `.then(child)` was considered and **rejected** — an object with a `.then` method is a
thenable, so any `await` or `Promise.resolve` anywhere near a `PendingSauceRoute` would try to unwrap
it. `.nest()` says what it does and cannot be mistaken for a promise.)_

### 15.2 What crosses the hop — the child needs NO on-chain struct construction

Because a static child's every field is known off-chain, the child's `publishAndFund` call is a
**fully pre-encoded `Call`** (viem `encodeFunctionData`, i.e. unit A1's `publishAndFundTx`) appended
to the parent's own `route.calls`. Nothing about it touches the compiler: the parent's Sauce program
is unchanged and unaware. This is what makes §7.2's unverified `TokenAmount[]`-in-argument-position
compiler shape a **non-blocker for this stage** — it is only needed for a _runtime_ child (S6).

Consequence worth stating: the child's `intentHash`, `routeHash`, `rewardHash` and vault are all
computable at build time, so `.intents()` / each child's `.hash()` / `.vaultCall()` all work
immediately, and a caller can show every leg of the cascade before the user signs anything.

### 15.3 The mechanism, per static child (grounded on §14.1's `_fulfill`/`Executor` reading)

The parent's `route.calls` becomes, in order:

```
[ ...options.precalls,
  ...(children with position "before" -> their approve+publishAndFund calls),
  <the compiled Sauce cook() call>,
  ...(children with position "after"  -> their approve+publishAndFund calls) ]
```

and each child contributes:

```
approve(P, amount)   on each child reward token      value 0     // one Call per token
publishAndFund(childDestination, childRouteBytes, childReward, allowPartial)
                     on P                            value = childReward.nativeAmount
```

where **`P` = the parent's own `route.portal`** — not new configuration. The child's source chain is
the parent's destination chain, so the Portal the child publishes on is the Portal _on the chain the
parent executes on_, and `Inbox._fulfill` already requires `route.portal == address(this)`. So `P` is
forced, derivable, and assertable. (An explicit override is accepted for completeness and defaults to
`options.portal`.)

Why each piece is right, tied to §14.1:

- **`msg.sender` for both calls is the Executor** (`Executor.execute` → `call.target.call{...}`), and
  `_fundToken` reads `token.allowance(funder=msg.sender, address(this)=Portal)` → the approve must be
  **from the Executor, to the Portal**. An `approve` issued as a `route.calls` entry is exactly that.
- **The Executor holds the tokens** — `_fulfill` `safeTransferFrom`s `route.tokens` from the solver to
  `address(executor)` _before_ `executor.execute`. So a child's reward tokens arrive by being listed
  in the **parent's `route.tokens`**.
- **The Executor holds the native** — `executor.execute{value: route.nativeAmount}`, and `Executor`
  has a `receive()`. So `value = childReward.nativeAmount` is spendable, provided the parent's
  `route.nativeAmount` covers the sum.
- **`Refund.excessNative()`** at the end of `_publishAndFund` returns the Portal's leftover balance to
  `msg.sender` — the Executor. Over-sending is safe; under-sending fails `!allowPartial` loudly.
- **`Executor._isCallToEoa`** reverts a call with data to a codeless target — both the token and the
  Portal have code, so this is a non-issue, but it is why a child publish can never be "silently
  skipped".

### 15.4 Invariants the DSL asserts at build time (all fail closed)

1. **EVM parent.** `parent.destination.kind === "evm"`, else a named throw citing openQuestion 5 (no
   SVM Portal program in eco-routes on `main`). The **child's destination may be `svm`** — EVM-source
   reward + Borsh route bytes, the `DepositAddress_USDCTransfer_Solana.sol` shape, fully supported.
2. **Source match.** `child.source.id === parent.destination.id` (auto-satisfied by the thunk form).
3. **Static child.** Every child reward field concrete. A guard that is vacuous today and is the seam
   where an S6 runtime child will be rejected rather than silently mis-encoded.
4. **Deadline direction — INCREASING with depth** (§12.3's correction): `child.route.deadline >=
parent.route.deadline` **and** `child.reward.deadline >= parent.route.deadline`. Grounded in
   `_fulfill`'s `block.timestamp > route.deadline` revert: the child is published at _some_ moment
   before the parent's own deadline, so anything earlier is publishable-but-dead. Non-strict `>=` is
   asserted; the module doc advises a real margin.
5. **Funding coverage.** Per token, `Σ children reward amounts <= Σ parent route.tokens amounts` for
   that token; and `Σ children reward nativeAmount <= parent route.nativeAmount`. Throws naming the
   token and the shortfall. **Escape hatch, per child: `fundedByBody: true`** — the legitimate case
   where the parent's Sauce program _earns_ the child's reward tokens and forwards them to the
   Executor (its `cook()` caller) rather than the solver delivering them via `route.tokens`. Opt-in,
   so the default is the checkable one.
6. **No duplicate intent hash in one cascade.** `normalizeRoute` defaults `salt` to 32 zero bytes, so
   two structurally identical children are the _same intent_ — a silent collapse. A duplicate
   `intentHash` anywhere in `intents()` throws, pointing at `options.salt`.

### 15.5 Units

| unit   | files                                                                                             | content                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | `sdk/src/routes/nest.ts` (NEW), `routes/index.ts` (EDIT), `sdk/test/routes-nest.test.ts` (NEW)    | Pure, DSL-free: `nestedChildCalls(child, { portal, allowPartial })` → `readonly CallInput[]` (`[...approves, publishAndFund]`, reusing A1's `approvalTxs`/`publishAndFundTx` and mapping `PortalTx` → `CallInput`); `assertStaticChild`; `assertNestingInvariants({ parentChain, parentRoute, children })` implementing 15.4's 1–6. Hand-built `Intent`s only. |
| **B2** | `routes/intent-dsl.ts` (EDIT), `routes/index.ts` (EDIT), `sdk/test/routes-nest-dsl.test.ts` (NEW) | `PendingSauceRoute.nest(childOrThunk, opts?)` (chainable, ordered, `{ allowPartial?, position?, fundedByBody?, portal? }`); `.reward()` splices per 15.3; `BuiltIntent.children` + `intents()` as **pre-order DFS, head first**; each child stays a full `BuiltIntent` (its own `hash()`/`vaultCall()`/`encodeEVM()`).                                         |

**B1 tests**: call order and count for a 2-token child; the approve spender is the **parent's**
`route.portal` (explicit assertion, plus a negative assertion that it is neither the child's
`route.portal` nor the child's vault); `publishAndFund` `value` equals the child's reward
`nativeAmount`; decoding the appended call's calldata reproduces the child's own `routeHash`/`hash()`
(the end-to-end proof that the spliced call publishes _exactly_ the child we handed out); each of
15.4's six invariants red/green, including a passing `fundedByBody: true` case for the one that would
otherwise throw; a `svm`-destination child accepted with Borsh route bytes; an `svm`-destination
_parent_ rejected.

**B2 tests**: thunk form receives the parent's `CanonicalChain` and needs no explicit `source`;
`BuiltIntent` form with a mismatched `source` throws; depth-2 (`head → child → grandchild`) gives
`intents().length === 3` in pre-order with each hash distinct; two children preserve `.nest()` order
in `route.calls`; `position: "before"` puts them ahead of the cook call; `precalls` still lead;
a depth-1 build with no `.nest()` is **byte-identical** to the current landed output (the
no-regression control); the string-body form nests identically to the closure form.

### 15.6 Explicitly deferred out of this pass

- **Runtime-computed child rewards** (§7, S6) — needs the §7.2 compiler probe. Invariant 3 is where it
  will land.
- **The full protocol-accessor rewrite** (S4′) and the curated **token-address registry** (§13.1(3)).
- **`main(args)`** route bodies (`closure.ts` rejects parameters today).
- **SVM-parent nesting** — openQuestion 5, unanswerable from eco-routes `main`.
- **`fundFor`/`publishAndFundFor` + `IPermit`** gasless funding.
- **A lexical nested-closure syntax** — §15.1; only a build-time transform could do it.

---

## 16. STAGE 5b — **TRANSFER-TO-VAULT becomes the default nesting mechanism** (USER DIRECTIVE 2026-08-11)

> **Status: designed, not yet implemented.** §15's `publishAndFund` splice stays exactly as landed
> and becomes an **opt-in** (`via: "publishAndFund"`); a new **transfer-to-vault** mechanism becomes
> the **default** (`via: "transfer"`). Nothing in §15 is deleted or rewritten — read this section as
> a second mechanism plus a flipped default, not a replacement.

### 16.1 The finding this is built on (VERIFIED against eco-routes `main`, do not re-litigate)

Read via `git -C …/eco-routes show main:PATH`, verbatim:

- **`Vault.withdraw(reward, claimant)` pays a BALANCE-based `min`, capped by the declaration**
  (`contracts/vault/Vault.sol`):
  ```solidity
  uint256 amount = reward.tokens[i].amount.min(token.balanceOf(address(this)));
  if (amount > 0) { _transferToken(token, claimant, amount); }
  ...
  uint256 nativeAmount = address(this).balance.min(reward.nativeAmount);
  if (nativeAmount > 0) { claimant.call{value: nativeAmount}(""); }
  ```
  There is no funded-flag gate: `_validateWithdraw` (`IntentSource.sol`) accepts the DEFAULT
  `Status.Initial` (`if (status != Status.Initial && status != Status.Funded) revert`), so an intent
  funded ONLY by a raw transfer — never `publishAndFund`, never `fund` — is fully claimable after a
  valid proof.
- **Publication is not required.** The destination `Inbox.fulfill` recomputes the intent hash from the
  passed-in route + rewardHash; nothing reads the source-chain `rewardStatuses` mapping. So the child
  intent can be shared **off-chain**.
- **The vault is a lazy CREATE2 minimal proxy deployed at claim time**, identically in both
  mechanisms — `publishAndFund` does not deploy it either (`_getVault` → `Clones.predict`;
  `VAULT_IMPLEMENTATION.clone(intentHash)` happens on the withdraw/refund path). An ERC20 balance and
  a native balance both sit at the address fine before any code exists there.
- **Refund is balance-based and deadline-gated** (`_validateRefund`): with no valid proof it reverts
  until `reward.deadline`, so a pre-deadline griefing refund is impossible. AFTER a valid claim
  (status `Withdrawn`) `refund` passes immediately — which is the recovery path for anything
  transferred ABOVE the declared cap (it goes to `reward.creator`).

### 16.2 The mechanism

The CHILD declares its reward amounts as a **CAP**. The child stays fully **STATIC** — its
`intentHash`, `routeHash`, `rewardHash` and vault address are all known off-chain, exactly as in §15
— and it is **never published on-chain**; the caller shares it off-chain (`.intents()` surfaces it,
each child keeps its own `.hash()`/`.vault(cfg)`/`.encodeEVM()`).

The PARENT, instead of splicing `approve` + `publishAndFund`, **transfers to the child's vault
address**, per child reward token, an amount read at RUNTIME:

```
amount_i = min( token_i.balanceOf(POT) , cap_i )     // clamp: true, the default
native   = min( POT.balance            , nativeCap ) // when the child declares a native reward
```

and the child's solver is then paid `min(cap_i, vaultBalance)` = exactly what the parent delivered.
**Auto-scaling reward with static hashes.**

**Why the clamp to `cap` is the right default, not a restriction.** `Vault.withdraw` pays
`min(cap, balance)` regardless, so anything transferred above the cap is _provably unpayable_ — it
strands in the vault until someone calls `refund` (post-claim, to `reward.creator`). Clamping in the
emitted Sauce makes the payout bit-identical (`min(cap, min(bal, cap)) == min(cap, bal)`) while never
creating stranded value, and it bounds how much of the Pot's **pre-existing, unrelated** balance a
sweep can take. `clamp: false` is offered for the raw-sweep spelling; it can only ever strand value.

**Who "self" is, and where the money comes from.** The parent's Sauce program executes inside the
**V12 Pot** (`cook()`), so `address.self` is the **Pot** — NOT the eco-routes `Executor` (which is
where `Inbox._fulfill` deposits `route.tokens`/`route.nativeAmount`, per §15.3). Therefore transfer
mode funds the child from **what the parent's own program earned into the Pot** — the intended
auto-scaling case, and precisely the case §15's static funding-coverage invariant could not check.
Two adjacent fundings, both already expressible with **zero new API**, documented so nobody
re-invents them:

- _solver-delivered tokens (on the Executor) → the Pot_: add an `IntentOptions.precalls` entry
  `token.transfer(pot, amount)` (`msg.sender` is the Executor, per §15.3), then the sweep sees them.
- _solver-delivered NATIVE → the vault_: `fundNativeFromRoute: true` puts `value =
child.reward.nativeAmount` on the transfer `cook()` call itself (`V12Pot.cook(bytes[])` is
  `payable`, verified in the shipped `sdk/src/artifacts/V12Pot.json` ABI); the Executor forwards it
  into the Pot and the emitted program forwards it on. This opt-in is the ONE case that re-enables a
  coverage check (§16.6 T5).
- _a fully static transfer from the Executor_ (no runtime amount, no Pot involvement) is already just
  a hand-built `CallInput` in `precalls` — `{ target: token, data: erc20.transfer(vault, amount) }`.
  No mechanism needed.

### 16.3 The integration seam — a SIBLING `cook()`, **not** an append to the parent body

The transfer must be Sauce source (the amount is a runtime `balanceOf`, so it can never be a
pre-encoded `Call` the way §15's `publishAndFund` is). Two places to put it, and the choice is forced:

|                                               | append into the parent's own `main()` body                                                                                                                                                                                                                                                                                                                                                                                 | **a sibling `cook()` `Call` (CHOSEN)**                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| a parent body ending in `return …;`           | **SILENTLY DEAD.** Verified: `compile()` accepts statements after a top-level `return` with no error or warning (`function main(){ return 1n; <transfer tail> }` compiles to 110 bytes, vs 3 for the `return` alone — the tail is emitted, just unreachable). The DSL's own bare-body sugar (`wrapSauceBody`) makes `return …;` bodies the norm, so this would silently no-op the funding of a cascade that _looks_ built. | unaffected — its own program                                                                          |
| `position: "before" \| "after"` (§15, landed) | only "after" is expressible                                                                                                                                                                                                                                                                                                                                                                                                | both, naturally                                                                                       |
| parent bytecode                               | changes whenever nesting is used                                                                                                                                                                                                                                                                                                                                                                                           | **byte-identical** — the landed no-regression control and every existing `intent-dsl` test stay valid |
| compile timing                                | forces `openRoute`'s eager `compileSauceRoute` (and its closure `undefined variable:` remap) to move into `.reward()`                                                                                                                                                                                                                                                                                                      | unchanged                                                                                             |
| name/scope collisions                         | generated locals share the user's `main()` scope (and SauceScript shares scope across `if`/`while`)                                                                                                                                                                                                                                                                                                                        | isolated                                                                                              |
| cost                                          | one `cook()`                                                                                                                                                                                                                                                                                                                                                                                                               | one extra `cook()` (~one extra CALL + interpreter entry)                                              |

So: **one extra `Call` per position group** — `v12Pot.encodeCook([transferProgram])` on the parent's
own Pot, ordered `[...precalls, (before-group), <parent cook>, (after-group)]`, default `"after"`
(load-bearing here: an "after" transfer is the only one that can see what the body earned). All
transfer children at one position are merged into **ONE** program (one `cook()`, shared `IERC20`
import, `.nest()` order preserved), so `route.calls` grows by at most 2 entries no matter how many
children. The parent's Pot is already Executor-owned for its own `cook()` (`onlyOwner`), so the
sibling cook needs no new authority.

_Deferred, not discarded_: `emit: "append-body"` remains a sound future option for the S6 case where
the transfer amount must reference a value computed IN the body — it needs a real acorn-level hoist
above the body's `return`, so it is not a flag flip. The codegen below is shared either way.

### 16.4 The emitted source — exact shape, compile-verified

Per transfer child `n`, per reward token `i` (addresses as bigint literals, the existing
`token/evm.ts` + `deposit/format.ts` convention — `formatAddressField`/`formatBigint`, reused, no new
formatter):

```js
import { IERC20 } from "./artifacts/IERC20.json";   // ERC20_IMPORT_LINE, once per program

function main() {
  // -- vault target, path A (runtime read) only:
  const n0_vault = abi.decode(contract.static(<PARENT_PORTAL>, <CALLDATA_LITERAL>), 'address');

  // -- per reward token:
  const n0_bal0 = IERC20.at(<TOKEN_i>).balanceOf(address.self);
  // requireCap: true (opt-in) inserts, here:
  //   if (n0_bal0 < <CAP_i>) { throw 'nest: child underfunded'; }
  const n0_amt0 = n0_bal0 > <CAP_i> ? <CAP_i> : n0_bal0;   // omitted when clamp: false
  if (n0_amt0 > 0n) {
    IERC20.at(<TOKEN_i>).transfer(<VAULT>, n0_amt0);
  }

  // -- native leg, only when child.reward.nativeAmount > 0 and native !== "skip":
  const n0_nbal = address.balance;
  const n0_namt = n0_nbal > <NATIVE_CAP> ? <NATIVE_CAP> : n0_nbal;
  if (n0_namt > 0n) {
    contract.call(<VAULT>, n0_namt, Uint8Array.from([]));   // contract.call(target, value, calldata)
  }
}
```

`baseDirs` = `TOKEN_BASE_DIRS` (`sdk/src/token/source.ts`, the same `./artifacts/IERC20.json`
resolution the token arm already uses). Target is the **parent's** destination kind — always `v12`
(the parent is EVM by invariant 1), never the child's.

**Every shape above was compile-probed against the real `compile()` (target `v12`), not assumed**:
the clamped+guarded ERC20 leg (129 B), the unclamped spelling (95 B), the `requireCap` `throw`
variant (164 B), the path-A `abi.decode(contract.static(...), 'address')` read with a `Uint8Array`
calldata literal (124 B), the native leg with `Uint8Array.from([])` (36 B) **and** with `''` (57 B —
the `Uint8Array` spelling is smaller, so it is the one specified), and a merged 4-token + native
program (551 B). Path A's literal cost is linear and benign: a 260/1000/4000-byte calldata literal
gives a 381/1121/4121-byte program.

Load-bearing SauceScript facts, all from `compiler/README.md` + `compiler/src/globals.ts`:
`contract.call(target, value, calldata)` — **value is the SECOND argument** (the svm dialect reorders
it, irrelevant here); `contract.static(target, calldata)`; `abi.decode(data, 'address')`;
`address.balance` / `address.self`; `throw '…'` reverts; there is **no `math.min`**, hence the
ternary (legal — a ternary is accepted directly in declaration position).

Notes that will otherwise be re-discovered the hard way: the ERC20 `transfer` **return value is
discarded** (a `false`-returning non-standard token silently under-funds → the child is simply
unsolvable and refundable, never a revert); the `if (amt > 0n)` guard exists so a zero balance cannot
revert the parent's whole fulfillment on a token that rejects zero-value transfers; per-child,
per-token variable names are index-prefixed (`n<child>_bal<i>`) because merged children share one
program scope.

### 16.5 Child vault address resolution — a 3-rung ladder, default = the zero-config rung

Precedence: **explicit `vault` > `vaultConfig` (static predict) > runtime read (default)**.

**(A) RUNTIME READ — the default.** `contract.static(PARENT_PORTAL, CALLDATA)` where `CALLDATA` is
the **pre-encoded, fully static** `intentVaultAddress(uint64 destination, bytes route, Reward reward)`
calldata — i.e. literally `intentVaultAddressCall(child, { portal }).data` (`portal.ts`, already
landed and tested), emitted as a byte-array literal. Both `IIntentSource` overloads need the full
route (`git show main:contracts/interfaces/IIntentSource.sol` — there is **no**
`vaultAddress(bytes32 intentHash)` public view), so this is the only runtime form. Chosen as the
default because it needs **zero deployment config** and **cannot be wrong**: the Portal itself
computes the address it will later deploy to. Two honest costs, both stated rather than hidden:

- **it embeds the child's route+reward bytes in the parent's program**, which is inside the parent's
  `route.calls`, which the user publishes on the parent's source chain — so with path A the child is
  **fully reconstructible from public calldata** (only _unpublished as an intent_, not private). If
  privacy is the reason for choosing transfer mode, use rung B or the explicit rung.
- parent bytecode grows by ≈ |child route bytes| + ~400 B (measured, linear).

**The target is the PARENT's own `route.portal`** (defaulted from `IntentOptions.portal`, overridable
via `NestOptions.portal`) — the child's source chain IS the parent's execution chain, and
`Clones.predict` derives the vault from `address(this)` = that Portal. It is **NOT** the child's
`route.portal` (that is the child's DESTINATION Portal) — the single easiest thing to get wrong here.

**(B) STATIC PREDICT — when `vaultConfig` is supplied.** `predictVaultAddress(hashIntent(child)
.intentHash, config)` (`vault.ts`, landed) baked as a 20-byte constant: leanest program, and the only
rung that keeps the child's bytes off-chain. Requires `vaultInitCodeHash`, which is **not derivable
from source** — confirmed again here: `Clones.predict` hashes `type(Proxy).creationCode ++
abi.encode(implementation)`, i.e. solc/optimizer-dependent, and eco-routes commits no artifacts on
`main`. `vaultConfig.portal`/`prefix` default to the resolved nest portal / `0xff`, so callers supply
only the hash. **Risk, stated bluntly: a wrong hash sends real funds to a dead address, irrecoverably.**
Mitigation is already shipped — cross-check once per deployment with `child.vaultCall()`
(`Portal.intentVaultAddress` `eth_call`; this SDK never does RPC, the caller performs it).

**(C) EXPLICIT `vault`.** The caller passes an address it already verified (typically the result of
that same `child.vaultCall()` at build time). Zero config, zero on-chain leak, one build-time RPC —
**the recommended production rung**, and the reason (A) is a _default_ rather than a _recommendation_.

_(A note on a fourth option, rejected: the compiler exposes `contract.predictCreate2(deployer, salt,
codeHash)`, so the CREATE2 derivation could be done on-chain — but it needs the same
`vaultInitCodeHash` as rung B while emitting more bytecode than baking the final address. Strictly
dominated.)_

### 16.6 API

```ts
export type NestVia = "transfer" | "publishAndFund";

export interface NestOptions {
  via?: NestVia; // DEFAULT "transfer"
  position?: "before" | "after"; // unchanged, default "after"
  portal?: AddressInput; // unchanged: parent's route.portal by default.
  //   publishAndFund: the publish target. transfer/rung A: the staticcall target.

  // ---- transfer mode only (any of these with via:"publishAndFund" is a named THROW) ----
  vault?: AddressInput; // rung C
  vaultConfig?: { vaultInitCodeHash: Hex; portal?: AddressInput; prefix?: Hex }; // rung B
  clamp?: boolean; // default true  — transfer min(balance, cap)
  requireCap?: boolean; // default false — `throw` when balance < cap (fail loud instead of stalling)
  native?: "balance" | "skip"; // default "balance" when the child declares a native reward
  fundNativeFromRoute?: boolean; // default false — put value = child.reward.nativeAmount on the transfer cook
  pot?: AddressInput; // default: the parent's own execution pot
  compile?: SauceCompileOptions; // for the transfer program only (rare)

  // ---- publishAndFund mode only (any of these with via:"transfer" is a named THROW) ----
  allowPartial?: boolean; // unchanged, default false
  fundedByBody?: boolean; // unchanged — invariant-5 opt-out, and invariant 5 does not exist in transfer mode
}
```

Mode-mismatched options **throw** rather than being silently ignored — a silently-ignored
`allowPartial` or `fundedByBody` would read as "this was considered" when nothing consumed it.

**Pure module (`routes/nest.ts`) — stays compiler-free**, exactly like `token/source.ts`:

```ts
export type ChildVaultResolution =
  | { readonly mode: "explicit"; readonly vault: AddressInput }
  | { readonly mode: "predicted"; readonly config: VaultConfig }
  | { readonly mode: "runtime"; readonly portal: AddressInput }; // DEFAULT

export interface TransferChildOptions {
  readonly vault: ChildVaultResolution;
  readonly clamp?: boolean;
  readonly requireCap?: boolean;
  readonly native?: "balance" | "skip";
}

/** The statements for ONE child, index-prefixed. Pure text; no compiler import. */
export function nestedTransferStatements(
  child: Intent,
  index: number,
  opts: TransferChildOptions,
): readonly string[];
/** N children merged into ONE compilable program + the imports/baseDirs it needs. */
export function nestedTransferProgram(
  children: readonly { intent: Intent; opts: TransferChildOptions }[],
): {
  readonly source: string;
  readonly imports: readonly string[];
  readonly baseDirs: readonly string[];
};
```

`intent-dsl.ts` (which already imports `compileSauceRoute`) compiles that program for the parent's
destination and slots the resulting single `CallInput` — so the compiler dependency does not leak
into `nest.ts`, and the emitted text is unit-testable as text.

**Invariants (`assertNestingInvariants`), transfer mode.** `NestChild` gains `via?: NestVia`, whose
**pure-module default is `"publishAndFund"`** (so every landed `nest.ts` test keeps its meaning) while
the **DSL default is `"transfer"`** (the directive). Deliberate asymmetry, documented at both sites.

- KEPT: **1** EVM parent, **2** source match, **3** static child, **4** deadline monotone, **6** no
  duplicate intent hash (which also gives distinct vaults — no separate vault-collision check).
- **DROPPED: 5** funding coverage. The transfer _is_ the funding, and it is balance-based; the parent
  earns into the Pot rather than the solver delivering via `route.tokens`, so there is nothing
  static to compare. Consequence stated plainly: **nothing checks at build time that the child will
  actually be funded** — `requireCap: true` is the way to turn a shortfall into a loud fulfillment
  revert instead of a quietly stalled leg.
- ADDED, transfer-only, all fail closed:
  - **T1** non-empty reward — ≥1 reward token or `nativeAmount > 0`, else the emitted program is
    empty; named throw suggesting `via: "publishAndFund"`. (This is why §15's landed
    `.reward(0n)` DSL tests must declare `via: "publishAndFund"` explicitly.)
  - **T2** every reward token address must denormalize to a 20-byte EVM address — the transfer runs
    on the parent's EVM chain. (An `svm`-**destination** child is still fine: its reward/vault live
    on the parent's EVM source chain, exactly as in §15.)
  - **T3** the parent must have an EVM Pot execution (`IntentOptions.pot`/`execution.pot`) — the
    transfer is a `cook()`.
  - **T4** mode-mismatched options rejected (above).
  - **T5** `fundNativeFromRoute: true` re-enables a NATIVE-only coverage check: Σ over opted-in
    children of `reward.nativeAmount` ≤ `parentRoute.nativeAmount` — that native genuinely does come
    from `route.nativeAmount`, so it is checkable and therefore checked.

### 16.7 How `publishAndFund` stays an isolated opt-in

`nestedChildCalls` / `publishAndFundTx` / `approvalTxs` / invariant 5 / `fundedByBody` are **untouched**.
The only change on that path is that the DSL reaches it via `via: "publishAndFund"` instead of by
default. Isolation is asserted, not assumed: a `via: "publishAndFund"` build must produce
`route.calls` **byte-identical** to the landed §15 output (the existing `routes-nest-dsl.test.ts`
cases, adapted only by adding the explicit `via`), and a no-`.nest()` build stays byte-identical to
the pre-nesting output (the landed regression control, unchanged). Choose `publishAndFund` when you
WANT public on-chain discovery (an `IntentPublished` event solvers already index) and exact-amount
funding pulled by the Portal; choose `transfer` (default) for off-chain sharing and auto-scaling
amounts.

### 16.8 Cap / auto-scaling model — the caveats, in full

1. **Payout is `min(cap, vault balance at claim)`, per token, native separately.** Scaling is
   **downward only**: set the cap to an optimistic upper bound (quote + slack) and price the solver
   incentive against the _realistic_ amount, not the cap.
2. **Above-cap excess is unpayable** and strands in the vault until `refund` (post-claim: immediate;
   otherwise deadline-gated) → to `reward.creator`. Default `clamp: true` means we never create it.
3. **Under-delivery stalls the leg, it does not lose it.** A rational solver reads the real vault
   balance and simply does not fulfill; the funds return to `reward.creator` via `refund` after
   `reward.deadline`. ⇒ **set the child's `reward.creator` to a user-controlled address** — a child
   whose creator is the Pot or the Executor has an unrecoverable refund path.
4. **The Pot is long-lived and shared** (per-owner CREATE2, `onlyOwner` `cook`), so a sweep can pick
   up pre-existing/unrelated balance of the same token — bounded by the cap under the default clamp.
   The precise fix (deferred) is a _delta_ mode: a `position: "before"` cook writes
   `storage.tWrite(k, balanceOf(self))` and the "after" cook transfers `min(cap, bal - pre)`;
   transient storage is already in the language, this is only an extra option + invariants.
5. **Fee-on-transfer / rebasing tokens** deliver less than the measured amount; `min()` absorbs it
   silently (under-funded, still claimable).
6. **Solver discovery is off-chain by construction** — no `IntentPublished` event for the child. The
   operational sequence is: share the child (`.intents()` + `.encodeEVM()` + `.hash()`) off-chain →
   the solver watches the parent's fulfillment (or the vault balance) → fulfills the child and
   withdraws. This is a _feature_ of transfer mode (privacy), and its cost.
7. **No proof shortcut**: the child still needs a real prover and a real proof — `withdraw` is
   permissionless but proof-gated. Transfer mode changes funding, nothing else.

### 16.9 Units, tests, gate

| unit   | files                                                                                                                                                                            | content                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B3** | `routes/nest.ts` (EDIT), `routes/index.ts` (EDIT), `sdk/test/routes-nest-transfer.test.ts` (NEW)                                                                                 | Pure: `NestVia`, `ChildVaultResolution`, `nestedTransferStatements`, `nestedTransferProgram`, T1–T5 + `via` threading in `assertNestingInvariants`. |
| **B4** | `routes/intent-dsl.ts` (EDIT), `sdk/test/routes-nest-dsl.test.ts` (EDIT: declare `via: "publishAndFund"` on the landed cases), `sdk/test/routes-nest-transfer-dsl.test.ts` (NEW) | `NestOptions.via` (default `"transfer"`) + the sibling-cook wiring, per-position merge, `fundNativeFromRoute` value, rung resolution.               |

**B3 tests** — exact emitted text for a 1-token child (balanceOf/clamp/zero-guard/transfer target);
`clamp: false` drops the ternary; `requireCap: true` inserts the `throw` before it; the native leg
appears only for a native-declaring child and `native: "skip"` suppresses it; **rung A's calldata
literal equals `intentVaultAddressCall(child, { portal }).data` byte-for-byte** (the end-to-end
grounding proof) and its target is the PARENT portal (plus a negative assertion that it is neither
the child's `route.portal` nor its vault); **rung B's baked address equals
`predictVaultAddress(hashIntent(child).intentHash, config)`**; rung C bakes verbatim; the emitted
program **actually compiles** for `v12` with `TOKEN_BASE_DIRS` (mirroring `token.compile.test.ts`),
including a 2-children × 2-tokens merge (proving no duplicate-declaration collision — see CLAUDE.md's
`collidesWithSurroundingDeclarations` family); T1–T5 red/green, including that a child reward
EXCEEDING the parent's `route.tokens` builds fine in transfer mode and still throws in
`publishAndFund` mode (the dropped-invariant control).

**B4 tests** — the DEFAULT is transfer: `.nest(child)` emits **no** `publishAndFund` call and exactly
one extra `cook` whose target is the pot; `via: "publishAndFund"` reproduces the landed `route.calls`
byte-identically; `position: "before"` puts the transfer cook ahead of the body cook; two transfer
children merge into ONE cook in `.nest()` order; the child stays static
(`.hash()`/`.vault(cfg)`/`.encodeEVM()`/`.intents()`); a depth-2 transfer cascade; `fundNativeFromRoute`
sets the cook call's `value` and enforces T5; the no-`.nest()` regression control unchanged.

**Gate** (unchanged): `pnpm --filter ./sdk exec tsc --noEmit` + `tsc -p tsconfig.test.json --noEmit`

- the sdk jest suite. Freeze holds: no publish, no tag, no push, no PR.

### 16.10 Explicitly out of this pass

- **On-chain execution proof.** Everything above is Solidity-read + `compile()`-verified; the real
  end-to-end proof is an anvil run (Pot `cook` → vault balance → `withdraw` pays `min`), out of scope
  here and the top item in §16.11.
- **`emit: "append-body"`** (§16.3) and **delta-mode sweeping** (§16.8(4)).
- **Runtime-computed child rewards** (§7/S6) — largely SUBSUMED for the common case: transfer mode
  gives runtime-scaled _funding_ with a static hash, which is what §7 wanted `runtime\`…\`` for. A
  genuinely runtime _cap_ still needs §7.2.
- SVM-parent nesting, `fundFor`/`IPermit`, the lexical nested-closure syntax — as §15.6.

### 16.11 New risks this mechanism introduces

1. **No execution proof yet** (above) — in particular the native leg's zero-length-calldata
   `contract.call(vault, amt, Uint8Array.from([]))` compiles, but a zero-length CALL with value to a
   codeless address is unverified on the v12 runtime. If it misbehaves, `native: "skip"` +
   `fundNativeFromRoute` + a static Executor value-`Call` (allowed: `Executor._isCallToEoa` only
   rejects code-less targets _with_ data) is the fallback.
2. **Build-time under-funding is now unchecked** (invariant 5 dropped) — mitigated by `requireCap`.
3. **Rung B's `vaultInitCodeHash` is a loss-of-funds-grade config input** — mitigated by defaulting
   to rung A and by `child.vaultCall()`.
4. **Rung A publishes the child in the parent's calldata** — mitigated by rungs B/C.
5. **Pot balance sweeping** and **`reward.creator` refund reachability** (§16.8(3)/(4)).
6. **Two cooks per route** — both need the Pot Executor-owned; already true for one.

---

## 17. STAGE 1c — the FULL PROTOCOL-ACCESSOR REWRITE (USER DIRECTIVE 2026-08-11)

> "Chain selection unlocks its namespace as globals."
>
> ```js
> Base.route(() => {
>   Uniswap.UniversalRouter.execute(cmds, ins, 0n);
> }, opts).reward(r);
> //                 ==> IUniswapV4_UniversalRouter.at(637...643n).execute(cmds, ins, 0n)
> ```
>
> Generalizes U4 (§13.5) from ONE hardcoded interface (`IERC20`, three methods) to every
> (protocol, contract, method) the E2.3 descriptor registry actually holds an **address + ABI** for
> on the enclosing chain. Plus bare `self` → `address.self` in the same pass.

Everything in this section is **measured against `compiler/dist` and `sdk/dist`**, not reasoned from
the source. Where a number appears, it was computed; where an error string appears, it was produced.

### 17.1 The crux, and why it is NOT the plumbing the directive assumed — ARTIFACT SERVING

The directive asked for an injected `import { I<Contract> } from "<key>.json"` line plus a
`baseDirs`/`transformModule` seam serving the ABI out of the descriptor registry, mirroring U4. That
route is **not viable as specified, and not necessary**. Three findings, in order:

1. **`transformModule` provably cannot serve an ABI.** `CompilerContext.transformModule`
   (`compiler/src/context.ts:258-268`) is documented and implemented as consulted "ONLY for
   source-file imports (a `.json` contract ABI is never passed through it)", and
   `resolveModuleSource` short-circuits `if (source.endsWith('.json')) return undefined;`
   (`context.ts:673`) before any transform hook is reachable. A `.json` specifier is routed to
   `resolveImport`, which is **pure filesystem**: `JSON.parse(fs.readFileSync(path.resolve(root,
source)))` across `baseDirs` (`context.ts:624-637`). There is no in-memory hook on that path.
2. **So the import route would require materialising temp files.** The only correct shape would be a
   content-addressed directory (`<os.tmpdir()>/sauce-sdk-abi/<sha256 of the whole bundle>/I<X>.json`
   - that dir appended to `baseDirs`) — content-addressed specifically so `baseDirs` stays STABLE
     across compiles and the compile cache still hits (`compileCacheKey` absolutises every `baseDir`,
     `cache.ts:90`). That is real I/O, real cleanup, a real read-only-filesystem failure mode, and a
     real cache-correctness argument to maintain. **Rejected.**
3. **`CompileOptions.contracts` already does exactly this, in memory, and already ships.** See the
   §4.2 CORRECTION block above for the four call sites. The chosen plumbing is therefore:

```
SDK                                                        compiler
---                                                        --------
rewriteProtocolAccessors(source, chain)                    compile(source, {
  -> source':  IUniswapV4_UniversalRouter.at(637..n)          target,
                 .execute(cmds, ins, 0n)                      contracts: {           <-- THE SEAM
  -> contracts: {                                               IUniswapV4_UniversalRouter: { abi },
       IUniswapV4_UniversalRouter: { abi: descriptor.abi }       IAaveV3_Pool: { abi },
     }                                                        },
                                                              defines, baseDirs, ... })
                                                             |
                                                             +-> new CompilerContext(baseDirs, contracts, target)
                                                                   -> for ([name, {abi}]) registerContract(name, abi)
                                                                        -> module.contracts: Map<name, {abi, methods}>
                                                             +-> resolveContractCallTarget (processor/expression.ts:239)
                                                                   -> ctx.lookupContract("IUniswapV4_UniversalRouter")  HIT
```

**Zero import lines. Zero `baseDirs`. Zero temp files. Zero compiler change.** Verified end to end
(§17.11 M1). Cost, stated honestly: the ABI JSON is serialised verbatim into the compile-cache key
(`cache.ts:87` → `stableStringify`) — measured **5581 bytes for a 3-contract bundle vs 199 bytes for
none**. Only _referenced_ contracts are bundled, and the largest starter-set ABI has 7 methods, so
this is a few KB of key per compile: acceptable, and it buys exactness (a differing ABI can only
MISS, never mis-hit).

**U4 is untouched.** The ERC20 arm keeps `ERC20_IMPORT_LINE` + `TOKEN_BASE_DIRS` byte-for-byte. The
two mechanisms cannot collide because the synthesized binding names are protocol-qualified
(§17.4) and never spell `IERC20`; if they ever did, `processImportDeclaration`'s existing idempotence
check (`processor/index.ts:88-101`) compares ABIs and throws `Conflicting ABIs registered for "X"`,
so the failure mode is loud, not silent.

### 17.2 Recognition — what the pass claims, and what it refuses to claim

One acorn parse of the (already `wrapSauceBody`-wrapped) route body; purely **textual splice over the
ORIGINAL source** driven by node ranges, reverse-ordered so earlier offsets stay valid — U4's exact
technique (`token-rewrite.ts:128-135`), so comments/formatting/unrelated code survive byte-for-byte.
`walk` and `collectDeclaredNames` are reused from `token-rewrite.ts` verbatim (extracted to a shared
module, not re-derived).

Four recognised callee shapes, all `CallExpression` with a non-computed `MemberExpression` callee:

| #   | Shape                                       | Example                                   | Resolves against                                    |
| --- | ------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| A   | `<Protocol>.<Contract>.<method>(…)`         | `Uniswap.UniversalRouter.execute(…)`      | enclosing chain                                     |
| B   | `<Protocol>.<method>(…)`                    | `Permit2.approve(…)`, `AaveV3.supply(…)`  | enclosing chain, protocol's single default contract |
| C   | `<Chain>.<Protocol>.<Contract>.<method>(…)` | `Base.Uniswap.UniversalRouter.execute(…)` | the NAMED chain                                     |
| D   | `<Chain>.<Protocol>.<method>(…)`            | `Base.Permit2.approve(…)`                 | the NAMED chain, default contract                   |

`<Protocol>` is a **canonical namespace key** (`pascalOfSlug(descriptor.protocol)`) or a **family
alias** (`pascalOfSlug` of the `-v<N>`-stripped stem) — the identical key set `descriptors/
accessors.ts#chainContracts` composes onto a chain global, walked from `DESCRIPTORS`, not a second
hand-maintained list. `<Chain>` is `pascalOfSlug(chain.slug)` over `canonicalChains`.

**A vs D are provably unambiguous:** chain keys and namespace keys are disjoint — measured
`chain-key ∩ namespace-key = []` across all 39 chains and all 20 namespace keys (14 canonical + 5
families + `Erc20`/`Erc4626`). This is asserted at module init (fail closed) rather than assumed, in
the same spirit as `chainContracts`' own duplicate-namespace throw.

**Shadowing — U4's rule, reused verbatim, not re-derived.** If a name is `let`/`const`/`var`-declared
or is a function parameter **anywhere in the whole program**, EVERY occurrence of it is left
un-rewritten. Deliberately coarser than real scoping because SauceScript shares scope across
`if`/`while`/bare-block bodies (this repo's CLAUDE.md documents the family of bugs that come from
getting this wrong), and it fails in the safe direction: a user's own `let Uniswap = …` always wins.

**Refused claims (leave completely untouched, silently):** a computed member (`P["m"](…)`); a head
that is not a registry namespace or chain key; a shadowed head; a bare accessor NOT in call position
(`const r = Uniswap.UniversalRouter;` — the compiler's variable-bound-contract shape is a plausible
later extension, explicitly deferred); an explicit in-body `.at()` on an interface descriptor
(`Erc20.ERC20.at(x).balanceOf(y)` — deferred, U4 already covers the ERC20 case).

### 17.3 The rewrite shape

```
<Protocol>.<Contract>.<method>(a, b)   ->   I<Ns>_<Contract>.at(<ADDR>n).<method>(a, b)
                                            I<Ns>_<Contract>.view(<ADDR>n).<method>(a, b)   // view/pure
```

Only the **callee range** is spliced (`callee.start..callee.end`), exactly as U4 does — the argument
list is never touched, so a `self`, a nested accessor call, or any expression inside the arguments
survives and is handled independently by its own site.

`<ADDR>` is the **decimal `bigint` literal** of `descriptor.perChainAddress[chain.id]`, via the
already-landed `formatAddressField` (`deposit/format.ts`) — the same spelling `token/evm.ts` and
`swap/source.ts` already emit. Chosen over referencing U3's ambient define name
(`UniswapV4_UniversalRouter`) for three reasons: shapes C/D need an address the ambient map does not
contain (a foreign chain's); an inlined literal cannot be broken by a user shadowing the define name;
and it is **byte-identical anyway** — measured, `IAaveV3_Pool.at(<lit>n)` and
`IAaveV3_Pool.at(AaveV3_Pool)` with the matching `defines` entry compile to identical bytecode.

### 17.4 The binding name — protocol-qualified, and why `I<Contract>` cannot work

`I<Ns>_<Contract>`, e.g. `IUniswapV4_UniversalRouter`, `IAaveV3_Pool`, `ICompoundV3_CometUSDC`.

Bare `I<Contract>` is **unusable**, measured: contract names collide hard across the starter set —
`Factory` is claimed by UniswapV2, UniswapV3, SushiswapV2 and PancakeswapV2; `Router` by UniswapV2,
SushiswapV2, PancakeswapV2, Aerodrome and Pendle. A program touching two of them would register two
different ABIs under one name. `I<Ns>_<Contract>` is collision-free **by construction** (namespace
keys are already unique — `chainContracts` throws on a duplicate) and is deliberately `"I" +` the
EXACT key U3's `chainDefines` already uses for the address (`${pascalOfSlug(protocol)}_${contract}`,
`ambient.ts:49`), so the ABI binding and the address define share one naming rule.

For shapes C/D the chain is **not** part of the binding name: the ABI is chain-independent, only the
inlined address differs. A body calling the same contract on two chains produces two `.at()` sites
and ONE `contracts` entry.

**Collision with user code fails closed:** the pass collects every `Identifier` in the program while
it walks, and a synthesized binding name that already occurs there throws a named error instead of
silently mis-binding. Same for a caller-supplied `compile.contracts` entry under the same name with a
different ABI.

### 17.5 `.at()` vs `.view()` vs `.lib()`

**Rule: `.view()` iff `method.stateMutability` is `view`/`pure`; `.at()` otherwise; `.lib()` NEVER
inferred.**

The honest framing: **`.at()` already auto-detects.** `BINDING_METHODS`
(`processor/expression.ts:174`) maps `at -> undefined` (auto), `view -> 'static'`, `lib ->
'delegate'`, and `processContractCall` computes `callTypeOverride ?? (stateMutability === 'view' ||
'pure' ? 'static' : undefined)` (`expression.ts:449`) — so `.at()` on a view method **already emits
STATICCALL**. Measured: `.at()` and `.view()` on `AaveV3.Pool.getUserAccountData` produce
**byte-identical 43-byte** bytecode. `.view()` is therefore chosen not for codegen but because the
rewritten source is a debuggable artifact a user reads, and because it pins STATIC explicitly rather
than depending on a compiler default staying put.

`.lib()` is **never** inferred and has no automatic path. Measured: it produces genuinely different
bytecode (DELEGATECALL). Delegatecalling a third-party protocol router with the Pot's own storage and
authority is a value-loss primitive; nothing in the descriptor data distinguishes a library from a
router. Reachable only by writing `.lib()` by hand in the body.

### 17.6 Chain-scoped resolution, and one thing that is NOT enforceable

**Inner chain (shapes A/B):** the pass takes the resolved `CanonicalChain` `compileSauceRoute`
already has. **Nesting rebinds for free:** a nested child is its own `openRoute` → its own
`compileSauceRoute` → its own chain, so a child body's bare accessors resolve to the CHILD's
deployment with zero new threading. This reuses U3's chain-context path exactly (`chainDefines` is
called from the same place with the same `destination`).

**Ancestor qualification (shapes C/D) resolves against the NAMED chain, and ancestry is NOT
checked.** It cannot be: `.nest(child)` receives an **already-built** child, so the child's own
compile has completed before the parent object exists — there is no lineage to consult at
child-compile time, in either the direct or the thunk form. Rather than fake it, the semantics are
stated plainly: **a chain-qualified accessor names a chain, not an ancestor.** This is also strictly
more useful (a route legitimately needs a foreign chain's address as a constant, e.g. a bridge
parameter). A caller who wants ancestry enforced gets an explicit allowlist
(`accessors: { chainScope: [...] }`), defaulting to "any canonical chain".

### 17.7 Bare `self` → `address.self`, in the same pass

Same parse, same reverse-ordered splice, disjoint ranges (an accessor site replaces a _callee_; a
`self` site replaces a bare _Identifier_). Rewritten only in genuine **read position**: skipped as
the non-computed `property` of a MemberExpression (`x.self`), as a non-computed object-literal `key`,
as any binding id (declarator/param), and as an assignment/update target — and suppressed entirely by
U4's whole-program shadow rule if `self` is declared anywhere. `address.self` compiles today
(measured, 2 bytes).

### 17.8 HONEST COVERAGE — the actual numbers, not "127 protocols"

The registry holds **29 descriptors across 15 protocols** (`CONTRACT_LINKS`), a deliberate starter
set, _not_ the 127-protocol `protocols/` registry. Of those 29:

- **25 are eligible** (≥1 ABI method **and** ≥1 per-chain address).
- 2 are `kind:"address-only"` (`AaveV3.PoolAddressesProvider`, `MorphoBlue.Bundler3`) — real address,
  **no ABI**, zero methods.
- 2 are `kind:"interface"` (`Erc20.ERC20`, `Erc4626.ERC4626Vault`) — real ABI, **no address**.

Of the 25 eligible, **5 carry `typeFidelity: "widened"`** — a vendored ABI using a wider-than-real
type, so the computed selector **does not match the deployed contract**: `UniswapV3.Factory`,
`UniswapV3.SwapRouter`, `UniswapV3.SwapRouter02`, `UniswapV3.QuoterV2`, `UniswapV4.PoolManager`.
`links.ts` records the hand-verified proof (`getPool(address,address,uint32) -> 0x71c54fc9` vs the
real `…uint24) -> 0x1698ee82`); `SwapRouter02` is wrong for a second, independent reason (a dropped
`deadline` field).

**Decision: a widened descriptor is REFUSED by default**, with a named error quoting
`coverage.caveats`, opt-out via `accessors: { allowWidenedSelectors: true }`. Rewriting it would
compile cleanly and then revert on chain inside a value-carrying intent — a compile-time error is
strictly better, and this is the one place the DSL's convenience must not paper over registry data
that already says "this is wrong".

**So the DEFAULT-usable surface is 20 descriptors / 13 protocols / 75 callable methods** (14 of them
view/pure):

| Namespace     | Contracts usable by default      |
| ------------- | -------------------------------- |
| UniswapV2     | Factory, Router                  |
| UniswapV3     | NonfungiblePositionManager       |
| UniswapV4     | UniversalRouter, PositionManager |
| SushiswapV2   | Factory, Router                  |
| PancakeswapV2 | Factory, Router                  |
| Aerodrome     | Router, PoolFactory              |
| AaveV3        | Pool                             |
| AaveV2        | LendingPool                      |
| Permit2       | Permit2                          |
| Oneinch       | AggregationRouterV6              |
| Pendle        | Router                           |
| MorphoBlue    | Morpho                           |
| CompoundV3    | CometUSDC, CometWETH, CometUSDT  |

Per chain (exact / +widened-behind-the-flag): **Ethereum 18/+5, Base 15/+3, Arbitrum 15/+3,
Polygon 12/+3, Optimism 11/+3, Bsc 11/+3, Avalanche 10/+3, Fantom 3, Blast 2/+1, Opbnb 2, Linea 2,
Scroll 2, Zora 2, Gnosis 1, Metis 1, Celo 0/+2.** **22 of the 39 canonical EVM chains have ZERO
eligible descriptors** (cronos, fuse, manta, boba, zksync, pulsechain, core, moonbeam, sei, kava,
mantle, zetachain, klaytn, evmos, mode, berachain, aurora, unichain, sonic, ronin, plasma, ink) — on
those chains every bare accessor is a named "not deployed" error, by data, not by bug.

**Shape B (`<Protocol>.<method>`) is available for exactly 6 namespaces** — the ones with exactly one
eligible contract: `AaveV3`→Pool, `AaveV2`→LendingPool, `Permit2`→Permit2, `Oneinch`→
AggregationRouterV6, `Pendle`→Router, `MorphoBlue`→Morpho. A contract name always wins over a method
name on a tie.

**Family aliases, measured:** `Uniswap` (v2/v3/v4) resolves 8 contracts uniquely and is **ambiguous
for exactly one — `Factory` (UniswapV2 | UniswapV3)**, which reuses `chainContracts`' own error text
verbatim. `Sushiswap`, `Pancakeswap`, `Aave` (Pool→v3, LendingPool→v2), `Compound` have **no**
ambiguity. `MorphoBlue`/`Permit2`/`Oneinch`/`Pendle`/`Aerodrome` have no family alias (no trailing
`-v<N>` stem).

**SVM is out.** Measured: `target: 'svm'` rejects contract bindings outright —
`contract bindings are not supported on target 'svm'; use contract.call(target, calldata, accounts)`.
The pass throws a named SDK-level error for an svm destination **only when a site was actually
found** (U4's `if (rewrote)` gate), so an svm route with no accessors is completely unaffected.

### 17.9 The unresolvable-accessor fallback — HYBRID, and the measurement that decides it

Leave-untouched was measured and is **actively misleading**: an untouched `Uniswap.UniversalRouter
.execute(1n)` fails with

```
property 'UniversalRouter' access not supported, use array indexing arr[i]
```

— which points a user at array indexing for what is really a missing deployment. (And a 4-segment
`Base.Uniswap.X.m()` produces the identical message.) So:

**Named DSL errors for everything the registry OWNS; leave-untouched only for heads it does not.**

| Condition                                                                                       | Behavior                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| head not a namespace/chain key                                                                  | **leave untouched** (isolation: the pass must not claim identifiers it doesn't own)                                                                                     |
| head shadowed anywhere in the program                                                           | **leave untouched**, silently (U4's rule)                                                                                                                               |
| known protocol, unknown contract                                                                | named error — reuse `requireContract`'s `Unknown contract 'X' in protocol 'p' (known: …)`                                                                               |
| known contract, no address on this chain                                                        | named error — reuse `requireContract`'s `… is not deployed on 'c' (available: …)`                                                                                       |
| family-ambiguous contract                                                                       | named error — reuse `chainContracts`' own ambiguity text                                                                                                                |
| `kind:"address-only"`                                                                           | named error naming the "no ABI vendored for this role" caveat                                                                                                           |
| `kind:"interface"` (no address)                                                                 | named error pointing at U4's `<TOKEN>.balanceOf(…)` / `Token` emitter                                                                                                   |
| method not on the descriptor's ABI                                                              | named error listing `descriptor.methods` names — **not** left to the compiler, whose `Unknown method "m" on contract "IAaveV3_Pool"` leaks the synthesized binding name |
| `typeFidelity: "widened"`                                                                       | named error quoting `coverage.caveats` + the `allowWidenedSelectors` opt-out                                                                                            |
| svm destination, ≥1 site                                                                        | named error (see §17.8)                                                                                                                                                 |
| synthesized binding name collides with a user identifier / a differing caller `contracts` entry | named error                                                                                                                                                             |

Arity is deliberately **left to the compiler** — its message is already precise and names the real
contract (`IAaveV3_Pool.supply() expects 4 argument(s), got 1`).

### 17.10 API and wiring — additive, SDK-local

**NEW `sdk/src/routes/accessor-index.ts`** — the registry-derived name index, built once at module
eval from `DESCRIPTORS` + `canonicalChains`: namespace key → protocol slugs, family alias → members +
per-contract owners, chain key → `CanonicalChain`, plus the disjointness assertion (§17.2). No data of
its own.

**NEW `sdk/src/routes/protocol-rewrite.ts`**

```ts
export interface ProtocolRewriteOptions {
  readonly allowWidenedSelectors?: boolean; // default false (§17.8)
  readonly chainScope?: readonly ChainRef[]; // default: any canonical chain (§17.6)
  readonly selfSugar?: boolean; // default true (§17.7)
}
export interface ProtocolRewriteResult {
  readonly source: string;
  readonly rewrote: boolean; // ≥1 accessor site (gates the svm error)
  readonly contracts: Readonly<Record<string, { abi: Abi }>>; // -> CompileOptions.contracts
  readonly sites: readonly {
    protocol: string;
    contract: string;
    method: string;
    chain: ChainSlug;
  }[];
}
export function rewriteProtocolAccessors(
  source: string,
  chain: CanonicalChain,
  opts?: ProtocolRewriteOptions,
): ProtocolRewriteResult;
```

**`sauce-route.ts`** — `SauceCompileOptions` gains `contracts?: ContractsConfig` (forwarded to
`compile()`; the file builds its `compile()` call explicitly today, so this is a one-line add) and
`accessors?: boolean | ProtocolRewriteOptions`. `compileSauceRoute` order:

1. `wrapSauceBody(sauce)`
2. `rewriteProtocolAccessors` — accessor sites **and** bare `self`, one parse, one splice
3. `rewriteTokenMembers` — unchanged; cannot interfere (a token symbol is a single identifier, an
   accessor head is a registry namespace, and the emitted `I<Ns>_<C>.at(<lit>n).m(…)` head is
   neither)
4. `compile(source, { …, contracts: { …options.contracts, …accessorContracts } })`

**`intent-dsl.ts`** — threads `options.compile?.accessors` through; nothing else changes.

**Default ON**, and that is isolation-safe _by measurement_: the only shapes it newly claims are
3-and-4-segment member calls rooted at a registry namespace, which **do not compile today at all**
(the `property '…' access not supported` error above). Default ON can only turn a hard error into a
success or into a better error — it cannot break a currently-green program. Opt out with
`accessors: false`.

### 17.11 Tests — `sdk/test/routes-protocol-rewrite.test.ts` (+ a case in `routes-intent-dsl.test.ts`)

Mirrors `routes-token-rewrite.test.ts`'s structure: rewrite-text assertions plus a
**byte-identity-against-hand-written-source** compile for every shape.

M1 (the crux) `Uniswap.UniversalRouter.execute(…)` compiles byte-identically to hand-written
`IUniswapV4_UniversalRouter.at(<lit>n).execute(…)` + `contracts`, with **no import line and no
baseDirs** · M2 all four shapes A–D · M3 `.view()` chosen for a view/pure method, and byte-identical
to `.at()` · M4 `.lib()` never emitted · M5 chain-qualified `Base.…` inside an `Optimism` route
inlines the BASE address (and differs from the Optimism one) · M6 nesting rebinds — a nested child's
body resolves to the child's chain · M7 bare `self` → `address.self`, byte-identical; and every
skip position (`x.self`, `{ self: 1n }`, a declared `self`) · M8 whole-program shadow suppression for
an accessor head · M9 every fallback row of §17.9's table, each asserted on its own named message ·
M10 widened refused by default, allowed under `allowWidenedSelectors` · M11 svm destination throws
only when a site exists · M12 binding-name collision with a user identifier throws · M13 negative
controls: U4's ERC20 rewrite still byte-identical; a body with no accessors compiles byte-identically
with `accessors` on and off · M14 registry-derived invariants: chain/namespace key disjointness, and
the coverage counts of §17.8 pinned so a `CONTRACT_LINKS` change fails here rather than silently
widening or narrowing the surface.

Gate = §13.6, unchanged. `git status compiler/dist` stays empty.

### 17.12 Explicitly out of this pass

- **The TS type surface of the DSL body — a named follow-up (U5c), with a measured reason.** A route
  body's accessor call does **not** typecheck today: `Base.Uniswap.UniversalRouter.execute(…)` →
  `TS18046 'Base.Uniswap.UniversalRouter.execute' is of type 'unknown'` (E2.3's `ContractAccessor`
  deliberately types method names as `unknown` via its index signature), and a bare `Uniswap` in a
  closure → `TS2304 Cannot find name 'Uniswap'`. Both are **pre-existing**, neither is introduced
  here, and the rewrite is text-level so it works identically for a **string** body — which is what
  every rewrite test uses today. Fixing the bare form is cheap and conflict-free (a `declare global`
  block for the namespace keys typed as a DSL-only loose accessor tree, since those names have no
  host-API meaning to collide with); fixing the chain-QUALIFIED form is not, because
  `Base.Uniswap.X.m(…)` legitimately returns a `ContractCall` in host TS and a SauceScript value in a
  route body, and TS cannot tell the two contexts apart — an intersection widening would silently
  change E2.3's public return type. Deliberately separated rather than bundled.
  Also measured while probing this: bare `self` **cannot** be ambient-typed as a `bigint` — the
  default lib set (no `lib` in `sdk/tsconfig.json`, target ES2022 ⇒ DOM included) already declares
  `self: Window & typeof globalThis` and wins.
- A bare accessor **not** in call position (`const r = Uniswap.UniversalRouter;` → the compiler's
  variable-bound-contract shape).
- An explicit in-body `.at()` for `kind:"interface"` descriptors (`Erc20.ERC20.at(x).balanceOf(y)`).
- Widening `CONTRACT_LINKS` itself (new protocols, the excluded bridge/token-role families, the
  6 name-mismatch protocols §links.ts lists) — a registry-data unit, not a rewrite unit.
- Fixing the 5 widened ABIs (real `uint24`/`int24` types) — an upstream `protocols/*/abis.ts` fix
  that would move 5 descriptors into the default surface at zero cost to this pass.
- SVM venue accessors in a route body (`Solana.RaydiumCpSwap.swap(…)`) — needs an account plan, a
  different mechanism entirely (§17.8).
- An on-chain execution proof of a rewritten accessor call (anvil `cook()` against a real router).

### 17.13 IMPLEMENTATION STATUS — LANDED on `feat/xchain-intent-dsl`

Built as designed, with two corrections found only while implementing (recorded here so a future
reader doesn't re-derive them from scratch):

- **Shape B's "single default contract" excludes `kind:"address-only"` contracts.** `AaveV3` links
  TWO descriptors (`Pool` singleton + `PoolAddressesProvider` address-only, no ABI) — naively
  requiring exactly one descriptor for a default would have made `AaveV3.getUserAccountData(...)`
  (§17.8's own worked example) unavailable. `accessor-index.ts`'s `defaultContract` is computed over
  `descriptors.filter(d => d.kind !== "address-only")`, so `AaveV3` (1 _callable_ contract) still gets
  a default while a genuinely multi-callable protocol (`UniswapV3`, `UniswapV4`) correctly does not.
- **The acorn parse needs `sourceType: "module"`.** This pass runs unconditionally (default ON,
  before `rewriteTokenMembers`), and `nest.ts#nestedTransferProgram` can hand `compileSauceRoute` a
  source that ALREADY carries a leading `import { IERC20 } from "./artifacts/IERC20.json";` line
  (the native-transfer-needs-ERC20 case) — `token-rewrite.ts`'s own `acorn.parse` never hit this
  because it's gated behind `tokenSymbols.length > 0` and that transfer path never sets `.tokens`.
  Caught by the full `sdk` suite (`routes-nest-transfer-dsl.test.ts`), not by this pass's own tests —
  a reminder that "default ON" needs the FULL suite, not just the new file, as its regression gate.

Files: `sdk/src/routes/{ast-walk,accessor-index,protocol-rewrite}.ts` (new); `sdk/src/routes/
sauce-route.ts` (+`contracts`/`accessors` options, wired between `wrapSauceBody` and
`rewriteTokenMembers`); `sdk/src/routes/token-rewrite.ts` (edited only to import the extracted
`walk`/`collectDeclaredNames` from `ast-walk.ts` instead of duplicating them — behavior unchanged).
`intent-dsl.ts` needed NO edit: `IntentOptions.compile` is spread verbatim into `SauceCompileOptions`
already, so `options.compile.accessors`/`.contracts` thread through for free.

THE DECISIVE STEP, verified (`routes-protocol-rewrite.test.ts`): `Uniswap.UniversalRouter.execute(
"0x0a", ["0x00"], 0n)` compiled for Base rewrites to `IUniswapV4_UniversalRouter.at(
637313816462073854932122270836018162031803339n).execute(...)` (the real, deployed Base
UniversalRouter address) and `compile()`s to bytecode byte-identical to the hand-written equivalent —
with NO import line and NO baseDirs, exactly as §17.1 predicted from the compiler's already-shipped
`contracts` option.

Gate: `tsc --noEmit` (src + test) both 0; full `sdk` jest suite 73/73 suites, 2482/2482 tests green
(2482 = the pre-existing 2452 + 30 new — `routes-protocol-rewrite.test.ts` covers shapes A-D, `.view`
vs `.at`, chain-scoped/qualified-ancestor addressing, `self` sugar, every fallback-table row, and the
U4/isolation negative controls). `compiler/dist` untouched (`CompileOptions.contracts` was already
shipped).

---

## 18. STAGE 1d — TOKEN-ADDRESS REGISTRY + `<holder>.<TOKEN>` BALANCE SUGAR (USER DIRECTIVE 2026-08-11)

Two paired features. They are paired because they need the _same_ missing thing: a per-chain
`symbol -> address` fact. U4 (§13.5) already rewrites `USDC.transfer(to, amt)` but only when the
CALLER hands the address in (`IntentOptions.tokenDefines`); the balance sugar `self.USDC` cannot even
be _spelled_ without an address, because the token symbol appears only as a member name — there is no
identifier for a `defines` entry to resolve. One registry unblocks both.

### 18.1 DISCOVERY — where per-chain token addresses live in this SDK today

Answer, measured, not assumed: **nowhere.** The full sweep (`sdk/src`):

- `protocols/erc20/addresses.ts` — `deployments: ChainDeployment[] = []`, with the comment "ERC20 is a
  standard interface, not a specific deployment". This is what `ambient.ts`'s own HARD FINDING block
  already records; it is still true.
- `protocols/*/addresses.ts` (127 protocols) — role-keyed CONTRACT addresses. A minority of role keys
  are genuinely tokens (`cbeth`→`cbETH` on 1 + 8453, `gho`→`gho` on 1, plus `wstETH`/`weETH`/`usds`/
  `susde`/`rai`/`mim`/`rswETH` singletons). **None of them is USDC, USDT, or WETH**, and the keys are
  role keys, not ticker symbols, sitting beside non-token roles (`pufferVault`, `lrtDepositPool`) in
  the same map — so this is not a derivable symbol table, only a hand-curatable one.
- `descriptors/registry.ts` — derived from the above; its only USDC/WETH-shaped entries are
  `CometUSDC`/`CometWETH` (Compound v3 markets, not the tokens).
- `chains/canonical.ts` — identity only, deliberately carries no `nativeCurrency`; `core/types.ts`'s
  `Chain` has `nativeCurrency` but no token addresses.
- `token/*`, `swap/*`, `deposit/*` — emitters and params; every token address is a CALLER input
  (`toAddressBigint(spec.token)`), never a lookup.
- `verify/vectors.ts` — the ONLY in-repo, pinned token addresses:
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base USDC) and
  `0x4200000000000000000000000000000000000006` (Base WETH), both used as golden-vector fixtures and
  re-derived by `verify.compile.test.ts`. `sdk/test/routes-token-rewrite.test.ts` already re-pins the
  first one verbatim.
- `svm/venues/**` — mentions USDC constantly, but as SPL **mints** (base58, a different address
  space). Not usable for an EVM registry, and the ERC20 rewrite is EVM-only anyway.

So there is nothing to re-export. The registry is therefore option (2) of the directive: **a small
curated map, from VERIFIED addresses, with the verification gate stated as part of the unit** — not
a table typed from memory. Shipping an unverified token address is the exact value-loss hazard
`ambient.ts`'s doc block refuses, and that refusal stands; this unit does not relax it, it discharges
it with a probe.

### 18.2 The registry — `sdk/src/routes/token-registry.ts`

```ts
export interface TokenRegistryRow {
  readonly symbol: string; // uppercase ticker, EXACTLY what the chain's own symbol() returns
  readonly address: Address; // EIP-55 checksummed
  readonly decimals: number; // verification metadata (see the probe); NOT consumed by the rewrite
  readonly source: string; // provenance: "sdk:verify/vectors.ts" | "probe:<chain>@<date>"
}

export const TOKEN_REGISTRY: Readonly<Record<number, readonly TokenRegistryRow[]>>;

export function registryTokenAddress(chain: CanonicalChain, symbol: string): Address | undefined;
export function knownTokenSymbols(chain: CanonicalChain): ReadonlySet<string>;
/** THE one precedence resolver — see §18.4. */
export function resolveTokenMap(
  chain: CanonicalChain,
  callerTokens?: Readonly<Record<string, AddressInput>>,
): ReadonlyMap<string, bigint>;
```

Fails closed at **module eval** (the `accessor-index.ts` convention — measured invariants, not
documented ones): every key is a canonical chain id AND `kind === "evm"`; every `symbol` matches
`^[A-Z][A-Z0-9]{1,10}$`; every address is a checksummed 20-byte address; symbol unique per chain;
address unique per chain; no symbol equal to any name in `token-rewrite.ts`'s `REWRITABLE_METHODS`
(`transfer`/`approve`/`balanceOf` — the one collision that would make §18.6's partition ambiguous).

**The provenance gate (part of this unit, not a later nicety).** A row lands only if it is either
(a) already pinned in-repo (`verify/vectors.ts`), or (b) confirmed by a network probe the implementer
runs ONCE against the paid Alchemy key already in the gitignored `sdk/.env`:
`getCode(addr) !== "0x"`, `symbol()` string-equals the row's `symbol`, `decimals()` equals the row's
`decimals`. The probe is a script / an env-gated test, **never** part of the jest gate — the committed
table is static data and the suite stays offline. The `symbol()` check is the load-bearing one: it is
exactly what stops a bridged variant (`USDC.e`, `USDbC`) from being registered under the plain
`USDC` key.

### 18.3 HONEST COVERAGE — what the registry actually claims

Coverage is **self-describing**: `knownTokenSymbols(chain)` is derived from the committed rows, so the
feature never claims more than the data. A pinned coverage-matrix test (§18.12) makes adding a row a
deliberate act.

- **Tier 0, guaranteed, zero new trust — `base`: `USDC`, `WETH`.** Both already in-repo and pinned.
  This alone satisfies the directive's motivating sentence (a bare `USDC.transfer(to, amt)` inside a
  `Base.route(...)` compiling with no `tokenDefines`).
- **Tier 1, the target for this cut, each row probe-verified before landing —
  `ethereum`, `optimism`, `arbitrum`, `polygon`, `base`: `USDC`, `USDT`, `WETH`** (+ the wrapped
  native where it is not WETH: `polygon`'s `WPOL`/`WMATIC`, registered only under whatever the
  deployed `symbol()` actually returns). Any row that fails the probe simply does not land — the
  feature degrades to "that symbol is unknown on that chain", i.e. §18.10's untouched fallback, never
  to a wrong address.
- **NOT claimed** (each named so it reads as scope, not oversight): every other canonical chain
  (`bsc`, `celo`, `avalanche`, `unichain`, `sonic`, `ink`, `plasma`, `ronin`, and the 26
  `chains`-only EVM ids); `DAI`/`WBTC`/`USDS`/`cbETH`/LST symbols; bridged-variant symbols under a
  plain key; SVM/SPL mints (`resolveTokenMap` returns registry-free results for `kind !== "evm"`);
  decimals-aware amount sugar (`USDC(1.5)`); anything derived automatically from
  `protocols/*/addresses.ts` role keys (§18.1 — not a symbol table).

### 18.4 Default vs override — ONE resolver, per-key caller precedence

`resolveTokenMap(chain, callerTokens)` is the single place the two sources meet:

1. registry rows for `chain` (skipped entirely when `chain.kind !== "evm"`), then
2. `callerTokens` merged **per key** on top.

Per-key, not wholesale: a caller overriding `USDC` keeps registry `WETH`/`USDT`. The existing
`intent-dsl.ts` line `tokens: options.compile?.tokens ?? options.tokenDefines` keeps its current
meaning (`compile.tokens` wins over `tokenDefines` as a unit) and whichever survives becomes
`callerTokens`. Every consumer of "which token symbols exist here, and at what address" goes through
this one function:

- `ambient.ts#chainDefines` — so registry symbols become `defines` **underneath** the caller's
  (`chainDefines`'s existing `opts.tokens` argument is now the OVERRIDE layer, not the only layer).
  Its HARD FINDING doc block gets rewritten to point here.
- `sauce-route.ts` — computes the map once and hands it to `rewriteTokenMembers`, and seeds the same
  symbols into `defines` **under** `options.defines`. That second part closes a latent gap: today a
  direct `compileSauceRoute(dest, src, exec, { tokens })` caller gets `IERC20.at(USDC)` emitted with
  no `USDC` define at all (it only works because `openRoute` happens to supply both). Same values from
  the same resolver, so this is idempotent with `openRoute`'s own merge and caller-supplied defines
  still win.

Precedence, top wins: user's own `let USDC = …` in the body (the compiler's `getVar`-before-
`getConstant` rule) > `compile.defines` > `IntentOptions.defines` > `compile.tokens ?? tokenDefines`

> registry. **One documented asymmetry:** the balance sugar inlines the address it resolves from the
> `resolveTokenMap` layer, so a raw `compile.defines: { USDC: … }` entry does NOT retarget `self.USDC`
> (it retargets U4's `USDC.balanceOf(...)`, which emits the symbol). That is consistent with what
> already happens today — `defines` has never been a _symbol-set_ source for U4 either (an unknown
> symbol is not rewritten even if `defines` carries it); the token map is the token-address channel,
> `defines` is the scalar channel.

### 18.5 The balance sugar — `<holder>.<TOKEN>` in value position

Emission, byte-identical to `token/evm.ts#evmBalanceExpression` (the landed `Token.balanceOf`
emitter), so nothing new reaches the compiler:

```
<holder>.<TOKEN>   ==>   IERC20.at(<ADDR>n).balanceOf(<holder-expr>)
```

`<ADDR>n` via `deposit/format.ts#formatAddressField(BigInt(address))` (decimal + `n`, the accessor
rewrite's own spelling). `.at(`, not `.view(` — U4 already uses `.at` for `balanceOf` and
`evmBalanceExpression` does too; `.view` would be a semantic change (staticcall) and is deliberately
not introduced by a sugar unit.

**Three authorized holders**, an allowlist — anything else is not a candidate:

| Holder                              | AST                                    | Emitted arg                                                                                                                                                 |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self`                              | `Identifier{name:"self"}`              | `address.self` — emitted DIRECTLY (`formatAddressField("self")`), not left for the accessor pass's `self` sugar, so the sugar works with `accessors: false` |
| `0x…22` (20-byte hex literal)       | `Literal` (number, or bigint with `n`) | `formatAddressField(BigInt(raw))`                                                                                                                           |
| `x` (a variable / a `defines` name) | any other `Identifier`                 | the identifier verbatim                                                                                                                                     |

The hex-literal holder rests on a measured parse fact: `0x1111…1122.USDT` really does parse as a
`MemberExpression` (a hex literal cannot take `.` as a fraction), **and its `.value` is a lossy
float64** — `0x1111111111111111111111111111111111111122` comes back as `9.743344248872686e+46`. So the
address MUST be read from the literal's own raw source text (`source.slice(object.start, object.end)`,
accepted only against `/^0x[0-9a-fA-F]{40}n?$/`), never from `.value`. This is the same
`literal.raw`-vs-`Number()` trap the compiler's own `const-eval` fix documents in CLAUDE.md; the
`n`-suffixed spelling parses losslessly but is validated identically.

A holder identifier is **rejected** (site left untouched) when it is: a token symbol in the same map
(`USDC.WETH` — ambiguous, claimed by neither feature), a registry namespace/family key or a canonical
chain key (`Uniswap.USDC`, `Base.USDC` — owned by §17's pass and by the deferred qualified-token
spelling respectively), or `address` (the compiler intrinsic namespace). Note a holder is NOT required
to be program-declared: a `defines`-supplied address name is a legitimate holder.

**VALUE-POSITION GUARD.** A candidate `MemberExpression` is claimed only if it appears in NONE of
these five parent roles, collected by node identity exactly like `protocol-rewrite.ts`'s
`collectSelfExclusions`:

1. `CallExpression.callee` — `self.USDC(...)` (the holder-scoped token-handle overload, explicitly out
   of this cut)
2. `NewExpression.callee`
3. `MemberExpression.object` — `self.USDC.transfer(a,b)`, `x.USDC[0]` (same handle overload)
4. anywhere inside an `AssignmentExpression.left` subtree — `self.USDC = 1n`, `[self.USDC] = arr`,
   `({k: self.USDC} = o)`
5. `UpdateExpression.argument` — `self.USDC++`

Excluded ⇒ untouched, and untouched fails closed (§18.10). Shadowing reuses U4's existing coarse
whole-program rule on the TOKEN name (`let USDC = …` anywhere suppresses every site); the holder name
is deliberately NOT shadow-checked — a local variable _is_ the intended holder.

### 18.6 Disambiguation — the three-feature partition, and recognition order

The three features are disjoint on the triple **(what the head is, what the member is, what the parent
role is)**:

| Shape                                  | Head                                                             | Member                           | Parent                     | Claimed by                            |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------- | -------------------------- | ------------------------------------- |
| `USDC.transfer(to, amt)`               | token symbol                                                     | `transfer`/`approve`/`balanceOf` | is a call callee           | U4 (`token-rewrite.ts`)               |
| `self.USDC`                            | authorized holder (never a token symbol / namespace / chain key) | token symbol                     | NOT one of §18.5's 5 roles | balance sugar (`token-rewrite.ts`)    |
| `Uniswap.UniversalRouter.execute(...)` | namespace / family / chain key                                   | vendored method name             | is a call callee           | accessor pass (`protocol-rewrite.ts`) |

Order within `token-rewrite.ts`: **U4 first, sugar second**, and the two can never contend for one
node — U4 needs the symbol as the _head_ with a method-name member under a call parent; the sugar
needs the symbol as the _member_ with a non-symbol head and a non-call parent. `USDC.balanceOf(self)`
is U4's (member is a method, and the module-eval guard forbids a token symbol named `balanceOf`);
`self.USDC` is the sugar's; `USDC.WETH` is nobody's. Across modules the token pass never claims a
namespace/chain-key head (new holder rejection) and the accessor pass never claims a non-call member
chain, so the partition holds in both directions.

### 18.7 ORDERING FINDING — the token pass must now run BEFORE the accessor pass

`sauce-route.ts` currently runs `rewriteProtocolAccessors` first, then `rewriteTokenMembers` (§17.13).
That order **breaks `self.USDC`**: `collectSelfExclusions` excludes a member _property_ named `self`
but not a member _object_, so the accessor pass rewrites `self.USDC` → `address.self.USDC`, after
which the sugar's holder is no longer a bare `Identifier` and the site is silently lost. Fix by
swapping: token pass → (prepend `ERC20_IMPORT_LINE` / union `TOKEN_BASE_DIRS` as today) → accessor
pass. Safe in both directions, by the §18.6 partition plus two specifics: the accessor pass cannot
claim the token pass's output (`IERC20` is neither a namespace nor a chain key, and
`IERC20.at(<n>).balanceOf` has a call in the middle of the chain so `decomposeMemberChain` declines),
and its synthesized `I<Ns>_<Contract>` binding-collision check cannot trip on `IERC20`
(`pascalOfSlug("erc20")` ⇒ `IErc20_*`). The emitted `address.self` is likewise immune to the
accessor pass's own `self` sugar (there, `self` IS a member property ⇒ excluded).

**Second implementation finding, the §17.13 lesson recurring:** `token-rewrite.ts` parses with acorn's
default `sourceType: "script"`, which was fine only because it was gated behind
`tokenSymbols.length > 0` and nothing set `.tokens` on the nesting path. With the registry as a
DEFAULT source the pass runs on every EVM route — including `nest.ts#nestedTransferProgram`, whose
source ALREADY carries a leading `import { IERC20 } from "./artifacts/IERC20.json";`. It must switch
to `sourceType: "module"`. The regression gate for this is the FULL sdk suite
(`routes-nest-transfer-dsl.test.ts`), not this unit's own file.

### 18.8 Chain scoping and nesting

Zero new threading. `resolveTokenMap` takes the `CanonicalChain` that `compileSauceRoute` already
resolved from the DESTINATION, so a `Base.route(...)` body resolves Base's USDC, and a nested child —
which is compiled through the same `compileSauceRoute`/`openRoute` seam with its OWN destination —
rebinds automatically. The parent's own body (including the emitted transfer-to-vault statements)
stays on the parent's chain, which is what §16.3's sibling-`cook()` design already guarantees.
Cross-chain qualified `Base.USDC` remains unimplemented (§18.14) and, per §18.5's holder rejection,
untouched rather than guessed at.

### 18.9 KEEP BOTH — and why the two spellings are provably the same program

`self.USDC` and `USDC.balanceOf(self)` both stay valid, and compile to **byte-identical** bytecode:
after rewriting, the first is `IERC20.at(<addr>n).balanceOf(address.self)` and the second is
`IERC20.at(USDC).balanceOf(address.self)` with `USDC` a `defines` bigint — and
`routes-token-rewrite.test.ts`'s existing case already MEASURES that a define-backed
`IERC20.at(USDC)` and a literal `IERC20.at(<addr>n)` compile to identical bytes. U4 deliberately keeps
emitting the SYMBOL (byte-identical to today, existing test untouched); only the sugar inlines the
literal, because its token name exists only as a member and is never a referencable identifier.

### 18.10 Fallback — unresolvable is UNTOUCHED, and why that is the right call here

An unresolvable `<holder>.<TOKEN>` (TOKEN not a known symbol for this chain, or the holder rejected,
or the site not in value position) is left byte-for-byte alone, and a bare `<TOKEN>` U4 shape with no
registry row and no caller entry stays the compiler's own `undefined variable: TOKEN`. This is the
`isolation` half of §17.9's hybrid rule, not a departure from it: §17.9 escalates to a named error
only once a head is _recognized as owned_ by the pass, and a token symbol in MEMBER position is
indistinguishable from an ordinary struct-field read — the pass does not own it. Clobbering a genuine
member access would be strictly worse than the base compiler's own error. The one case where a named
error is tempting, `<ChainKey>.<KNOWN_TOKEN>` (`Base.USDC`), is deliberately left untouched too, to
keep one uniform rule ("claim only what fully resolves") rather than two.

### 18.11 API + wiring — additive, SDK-local, no compiler change

- `sdk/src/routes/token-registry.ts` **(new)** — §18.2. Data + invariants + `resolveTokenMap`.
- `sdk/src/routes/token-rewrite.ts` — second recognizer + widened parameter:
  `rewriteTokenMembers(source, tokens: ReadonlyMap<string, bigint> | ReadonlySet<string>)`. The `Set`
  form keeps every existing direct caller/test compiling unchanged and runs U4 ONLY (no addresses ⇒ no
  sugar) — a documented degradation, not a silent one. Result grows
  `{ source, rewrote, memberSites, balanceSites }`; `rewrote` keeps its exact current meaning (drives
  the import line + `TOKEN_BASE_DIRS`), so `sauce-route.ts`'s existing branch is untouched.
  `sourceType: "module"` (§18.7).
- `sdk/src/routes/ambient.ts` — `chainDefines` resolves tokens via `resolveTokenMap`; `opts.tokens`
  becomes the override layer. Doc block rewritten (the HARD FINDING is now discharged, and should say
  so plus where the addresses come from).
- `sdk/src/routes/sauce-route.ts` — resolve the map once; token pass BEFORE accessor pass (§18.7);
  seed token symbols into `defines` under `options.defines` (§18.4).
- `sdk/src/routes/intent-dsl.ts` — **no change needed**; `tokenDefines`/`compile.tokens` already
  thread through, and they are now the override layer for free.
- `sdk/src/index.ts` — export the registry query surface (`registryTokenAddress`,
  `knownTokenSymbols`, `TOKEN_REGISTRY`) alongside the existing routes exports.

### 18.12 Tests — `sdk/test/routes-token-registry.test.ts` (+ cases in `routes-token-rewrite.test.ts`)

Registry: module-eval invariants (canonical+EVM ids, symbol/address shape, per-chain uniqueness, no
`REWRITABLE_METHODS` collision); Base `USDC`/`WETH` string-equal `verify/vectors.ts`'s pinned
constants (one source of truth, so a drift in either turns red); the **coverage matrix pinned exactly**
(chain → sorted symbols), making a new row a deliberate edit.

Default source: `openRoute("base", "USDC.transfer(TO, 5n);", opts)` with **no** `tokenDefines`
compiles to one `cook()` call (this is the behavior change). Override: the same body with
`tokenDefines: { USDC: <other> }` compiles to the hand-written program at `<other>`, and NOT to the
registry-address program. Both `tokenDefines`-path tests already in the suite stay green untouched.

Sugar: `return self.USDC;` → contains `IERC20.at(<decimal>n).balanceOf(address.self)`, and its
bytecode is byte-identical to `return USDC.balanceOf(self);` (§18.9). Hex holder: `0x…22.USDT` emits
the EXACT address (the assertion that catches a float64 round-trip — see §18.5). Variable holder:
`let x = 0x…; return x.USDC;`. Value-position negatives, source unchanged for each: `self.USDC(...)`,
`self.USDC = 1n`, `self.USDC++`, `self.USDC.transfer(a,b)`, `[self.USDC] = arr`. Unresolvable:
`self.NOTATOKEN`, `x.USDC` on a chain with no `USDC` row, `let USDC = 1n; return self.USDC;`,
`Uniswap.USDC`, `Base.USDC` — all untouched. Composition: a body using BOTH
`Uniswap.UniversalRouter.execute(...)` and `self.USDC` compiles, both rewritten, import line exactly
once (this is the §18.7 ordering regression test). SVM: a `solana` route using `self.USDC` with no
`tokenDefines` does NOT throw and does NOT rewrite (registry is EVM-only); the existing
`tokenDefines`-on-svm named error stays green.

Gate: §13.6, plus the full sdk suite (not just the new files — §18.7).

### 18.13 Risks

1. **A wrong address is a silent value-loss bug, not a compile error.** Mitigated by the §18.2 probe
   gate (`symbol()` + `decimals()` + code presence), by keeping Tier 0 = already-pinned in-repo data,
   and by refusing bridged variants under plain keys. The residual risk is a row that passes the probe
   against a _proxy_ whose implementation later changes — out of scope for any static table.
2. **Bridged-vs-native ambiguity** (`USDC` vs `USDC.e`/`USDbC` on optimism/arbitrum/polygon/base) is a
   real semantic trap for users: the registry deliberately registers only the token whose own
   `symbol()` is the plain key, so a user wanting the bridged one must pass `tokenDefines` — which
   still works, per-key.
3. **A new default `defines` key can only turn a hard error into a success, but it does change
   behavior**: a body reading a bare `USDC` that previously failed `undefined variable: USDC` now
   silently resolves to the registry address. Nothing previously _compiling_ can break (a `defines`
   bigint has no members, so a `USDC.transfer(...)` on a define was never a compiling program), but
   this is the one place to look if an existing consumer's expectations shift.
4. **The pass now runs on every EVM route** (one more acorn parse per compile, and a wider claim
   surface on bodies that never opted in). The §18.5 allowlist + 5-role value guard are what keep that
   safe; the full-suite gate is what proves it.
5. **Ordering coupling between the two rewrite passes is now load-bearing** (§18.7) and is enforced
   only by a composition test — a future reorder would silently drop `self.USDC` sites. Worth a
   comment at the call site saying why the order is what it is.
6. **`Set`-form callers silently get no sugar** — documented in the signature, and the only in-repo
   `Set` callers are tests asserting U4 behavior.

### 18.14 Explicitly out of this pass

- The **holder-scoped token handle** (`self.USDC.transfer(to, amt)`, `x.USDC.approve(...)`) — the
  directive scopes this cut to the `= balance` reading; §18.5's guard leaves every handle-shaped site
  untouched rather than half-supporting it.
- **Qualified cross-chain tokens** (`Base.USDC` inside an `Arbitrum` body) — needs the chain-key head
  to become a token namespace, which collides with §17's shapes C/D and wants its own unit.
- **Decimals-aware amount sugar** (`USDC(1.5)`, `1.5 USDC`) — the registry records `decimals` as
  verification metadata precisely so this unit is cheap later, but nothing consumes it here.
- **`native.balance` / `self.ETH`** (a native-balance reading — a different opcode path, not ERC20).
- **SPL/SVM token symbols** and any registry row for a non-EVM chain.
- **Auto-deriving rows** from `protocols/*/addresses.ts` token-role keys (§18.1) or widening coverage
  to the remaining canonical chains — a registry-data unit, not a rewrite unit.
- An on-chain `cook()` proof of a rewritten `self.USDC` read against a real token (anvil).

### 18.15 BUILT — status + findings from implementation (2026-08-11)

Landed on `feat/xchain-intent-dsl`: `sdk/src/routes/token-registry.ts` (new),
`sdk/src/routes/token-rewrite.ts` (widened + balance sugar), `sdk/src/routes/ambient.ts` and
`sdk/src/routes/sauce-route.ts` (wired to the registry, pass order swapped per §18.7),
`sdk/src/routes/index.ts` (exports). Tests: `sdk/test/routes-token-registry.test.ts` (new), plus
cases in `routes-token-rewrite.test.ts` and `routes-ambient.test.ts`. Gate green: `tsc --noEmit`
(src + `tsconfig.test.json`) both 0, full sdk jest suite 74/74 suites, 2524/2524 tests.

**The real probe (via `sdk/.env`'s Alchemy RPC keys) ran, and it changed coverage from what §18.3
assumed.** `getCode` + `symbol()` + `decimals()` checked live for ethereum/optimism/arbitrum/
polygon/base USDC/USDT/WETH(+wrapped-native) candidates. Two USDT candidates FAILED the `symbol()`
gate exactly as the mechanism is designed to catch: Arbitrum's USDT deployment's own `symbol()`
returns `"USD₮0"` (a Tether-migrated rename), and Polygon's returns `"USDT0"` — neither string-equals
`"USDT"`, so neither is registered under the plain `USDT` key. Final landed coverage:

| chain            | symbols                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ethereum (1)     | USDC, USDT, WETH                                                                                                                                                       |
| optimism (10)    | USDC, USDT, WETH                                                                                                                                                       |
| arbitrum (42161) | USDC, WETH _(USDT excluded — symbol() mismatch, see above)_                                                                                                            |
| polygon (137)    | USDC, WETH, WPOL _(USDT excluded — same reason)_                                                                                                                       |
| base (8453)      | USDC, WETH _(Tier 0, re-probed to confirm the pinned `verify/vectors.ts` constants still match a live read; USDT not independently verified this cut, so not claimed)_ |

Pinned exactly in `routes-token-registry.test.ts`'s coverage-matrix test, so a future row is a
deliberate edit.

**A genuine module-eval import cycle, found and fixed.** `token-rewrite.ts` importing
`accessor-index.ts` (for the balance sugar's namespace/chain-key holder rejection) closes a cycle
back to `token-registry.ts`: `token-rewrite → accessor-index → builder → intent-dsl → sauce-route →
token-registry`. That cyclic SHAPE alone is harmless (the identical shape already existed for
`protocol-rewrite.ts` before this pass, and works fine, because nothing at that module's own
top-level touches an import synchronously) — but `token-registry.ts`'s own module-eval validation
loop originally imported and synchronously read `token-rewrite.ts`'s `REWRITABLE_METHODS` at the
top level, which — being on the cyclic path — was not yet initialized (still a TDZ binding) at the
moment `token-registry.ts`'s own top-level code ran. Confirmed via a real
`ReferenceError: Cannot access 'REWRITABLE_METHODS' before initialization` (not a hypothetical).
Fixed by duplicating the three-name list locally in `token-registry.ts` (with a comment
cross-referencing `token-rewrite.ts` and explaining why it's not imported) rather than restructuring
the `builder.ts`/`accessor-index.ts` import graph — a much smaller, lower-risk fix for a three-item
literal.

**An interaction with the (pre-existing, unrelated) protocol-accessor self-sugar, found and
documented (not a bug — a real, safe outcome).** `collectSelfExclusions`
(`protocol-rewrite.ts`) excludes a member EXPRESSION's PROPERTY named `self` but not its OBJECT — so
on an **svm** destination, where the token/balance-sugar pass never fires (the registry has no svm
rows and, per §18.10, an unresolved site is left untouched), a bare `self.USDC` left over from that
skip is then seen by the accessor pass's self-sugar (default ON) as a plain `self` identifier in
object position, and gets rewritten to `address.self.USDC` — which trips the existing
svm-guard throw in `compileSauceRoute` (`options.accessors` is EVM-only). This means the directive's
literal framing ("solana + `self.USDC` does NOT throw") only holds with `accessors: false`; with the
default (accessors ON), it throws a SAFE, named error — never a silent drop — which is arguably the
better outcome anyway. Both shapes are pinned in `routes-token-rewrite.test.ts`'s svm describe
block; the pre-existing `tokenDefines`-on-svm named error (an explicit caller `options.tokens`
actually rewriting) is unaffected and stays green.
