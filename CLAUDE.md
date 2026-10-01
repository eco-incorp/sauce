# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The current consumer manual starts at [docs/README.md](docs/README.md). Compiler integration is in
[docs/api/compiler.md](docs/api/compiler.md). Keep that manual focused on external SDK users;
repository maintenance instructions belong here.

## What this repo is

**Sauce** — the developer-facing package for the **Sauce protocol**, whose on-chain bytecode engines
execute atomic scripts in EVM and Solana transactions. This is the whole `sauce`
repo (`eco-incorp/sauce`, **renamed from `eco-incorp/sauce-sdk`** — the old name still redirects). The
runtime **engine** it _targets_ lives in the separate private **`eco-incorp/v12`** repo (**renamed
from `eco-incorp/sauce`**; the engine, not this package, is what took the `v12` name — often checked
out at `../v12`).

A **pnpm monorepo** of four workspace packages (`pnpm-workspace.yaml`: `dev-tools`, `sdk`,
`actions`, `mcp`), all `private: true`, bundled and published as a **single npm package
`@eco-incorp/sauce`** via subpath exports and bins — only the root `package.json` publishes. This
bundling is the key mental model: code lives in four packages for development, consumers import
everything from one name.

| Workspace    | Internal name                 | Published as                                                                                                                                          | Role                                                                                                      |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sdk/`       | `@eco-incorp/sauce-source`    | `.` and most subpaths (`/compiler`, `/protocols/*`, `/chains`, `/recipes`, `/skills`, `/svm*`, `/evm/engine`, `/verify`, `/deployments`); bin `sauce` | 135-protocol registry, chains, recipes, SVM/EVM engine clients, the `/skills` loader, the `sauce` command |
| `actions/`   | `@eco-incorp/sauce-actions`   | `/actions`, `/actions/action-program.schema.json`                                                                                                     | JSON action programs → SauceScript, intents                                                               |
| `mcp/`       | `@eco-incorp/sauce-mcp`       | `sauce mcp` (loaded by the `sauce` bin)                                                                                                               | The Sauce MCP server: the `sauce` command's read-only tools, the agent skills as resources                |
| `dev-tools/` | `@eco-incorp/sauce-dev-tools` | not published                                                                                                                                         | Dev harness: compile helpers, local SVM Kitchen runner, legacy recipe runner                              |

This repo was **extracted from the engine repo** (now `eco-incorp/v12`, checked out at `../v12`),
which may still carry older copies of these packages. The packages here are **siblings, not
generations**: `dev-tools` is a dev harness, not a legacy `sdk`.

## Build, test, lint

Use Node.js **24 or newer**, matching the Solana dependencies and CI.

Run from the repo root. `build` is `pnpm -r --filter './sdk' --filter './actions' --filter
'./mcp' build`, and **`actions` and `mcp` read the SDK's `dist/`**: `actions/src/registry.ts` and
`compose.ts` import `../../sdk/dist/...` by relative path, the one spelling that resolves both in the repo and in the
published tarball (where `actions/dist` and `sdk/dist` are siblings; the workspace name
`@eco-incorp/sauce-source` is not published). `mcp/src/sdk.ts` does the same, the one module
through which the MCP server reaches the SDK. So build the SDK before typechecking, building or
testing `actions` or `mcp`. `pnpm build` orders them — both declare `@eco-incorp/sauce-source` as a
workspace devDependency for exactly that — and CI builds the SDK first. The compiler is an ordinary
npm dependency, already built; nothing in this repo builds it.

```sh
pnpm install
pnpm build          # sdk + actions + mcp
pnpm typecheck      # all workspaces
pnpm test           # all workspaces
pnpm lint           # eslint, whole repo
pnpm lint:fix       # ...with --fix
pnpm format         # prettier --write, whole repo
pnpm format:check   # prettier --check, what CI runs
pnpm docs:check     # manual links, README snippet, and executable examples; build first
pnpm skills:check   # the agent skills: programs, command lines, runners, wording; build first
```

`lint` and `format:check` gate every PR (`.github/workflows/lint.yml`) and both run over the
WHOLE tree, so there is no backlog to work around — a new file has to be clean. Prettier and
ESLint are pinned to exact versions rather than caret ranges: a formatter that drifts between
minors would start failing CI on a PR that changed nothing.

**What the two tools deliberately do not see.** ESLint ignores SauceScript (`**/*.sauce.ts`,
`dev-tools/sauce`, `dev-tools/test/fixtures`, `sdk/src/std`) because every finding there is a false
positive: `main` is the entry point the Sauce compiler calls, so `no-unused-vars` fires on every
program, and `require(cond)` is SauceScript's ASSERTION, which `no-require-imports` reads as a
module import. Prettier's list is different and narrower — generated output (`**/*.generated.ts`,
the two `settle.sauce.ts` recipes) and captured fixtures. Everything else, SauceScript included, is
formatted; `.prettierrc.json` names the `typescript` parser for `sdk/src/std`, whose `.js` files
carry type annotations Prettier's default parser rejects.

Per-workspace (`--filter`):

```sh
pnpm --filter './sdk' test               # SDK tests, including protocol SauceScript compilation
pnpm --filter './actions' test:unit      # no mainnet state
pnpm --filter './actions' test:mainnet   # real mainnet contracts, replayed locally
pnpm --filter './sdk' gen-route-globals  # regenerate the per-chain named exports
pnpm --filter './sdk' gen-source-globals # regenerate source-only token/protocol declarations
```

Single test file: jest (sdk) → `pnpm --filter './sdk' test -- routes-void-main.test.ts`.
Actions and dev-tools use the **node test runner**, not jest → `pnpm --filter './actions' exec tsx
--test tests/split-swap.unit.test.ts`.

Actions test layout: `*.unit.test.ts` need nothing; `*.exec.test.ts` EXECUTE programs on a local
anvil through the released engine and a real Kitchen-minted Pot (`tests/anvil.ts`) — they are in
`test:unit`, skip locally without the engine artifact and throw under `CI`. `calldata.exec` runs
every action against contracts that log the call they receive and compares the calldata with an
independent viem encoding. `actions.mainnet` (every action type, and it fails if one did not run),
`quote.mainnet` and `split-swap.mainnet` (`test:mainnet`) run against real Ethereum contracts on a
LOCAL anvil booted from mainnet state captured at a pinned block — no RPC, no secret, and they run
in CI. See "Mainnet state" below. An action type that cannot execute there does not ship.
After changing an action's fields in `actions/src/spec.ts`, run `pnpm --filter './actions'
gen-schema`; `program.unit.test.ts` fails while `actions/action-program.schema.json` is stale.

## Toolchain gotchas (why a fresh clone may fail)

- **There is no engine git dep.** Every v12 artifact comes from a RELEASE of the private
  `eco-incorp/v12` repo, pinned in `sdk/scripts/sync-engine-artifacts.mjs` by tag **and** by a
  sha256/keccak digest committed there. The digest is the guarantee — a git tag is movable on
  GitHub — and there is deliberately no commit pin, because FOUR components release independently:
  `v12-svm` (engine + wire artifact), `v12-evm` (runtime creation code), `kitchen-svm` (kitchen
  program + Anchor IDL) and `kitchen-evm` (the Solidity ABIs). Do not look for `abis.json`,
  `kitchen.so` or `kitchen-idl.json` under a `v12-*` tag — they moved to the `kitchen-*` releases.
  The tags MAY be cut from different commits (`v12-evm-v0.4.0` and `v12-svm-v0.5.0` were), so a
  shared commit is not a property to rely on even while all four happen to share one after a
  coordinated re-release. To bump: change the tag, run the script, paste the digest it reports.
  **Fetching needs no PAT.** Each release publishes its assets as a PRIVATE npm package on GitHub
  Packages (`@eco-incorp/<package>` at `npm.pkg.github.com`, one per independently-released
  component). Read access is granted per package to the CONSUMING REPOSITORY (package settings ->
  Manage Actions access -> add `eco-incorp/sauce`, Read), so CI authenticates with the `GITHUB_TOKEN`
  every workflow already has and a developer with whatever `gh` is logged in as. Nothing is published
  publicly. There is deliberately **no `gh release` or REST fallback**: a fallback would let a
  developer and CI fetch by different routes, so the route CI depends on could rot unseen.

  The sync fetches the packument and tarball **straight from the registry** rather than declaring a
  dependency, DELIBERATELY. Installing would need an `@eco-incorp` scope mapping in `.npmrc`, and a
  scope registry governs PUBLISHING as well as resolution — the hazard the Publishing section below
  records. Do not "simplify" this into a devDependency.

  The release tag maps to the package as `<package>-v<version>` -> `@eco-incorp/<package>@<version>`,
  files land under `package/` in the tarball, and the committed digest is still the guarantee — this
  changed the TRANSPORT, not the trust model. A failed `curl` must never have its own message
  surfaced: `execFileSync` puts the command line in it and these commands carry the credential, which
  printed a live token into output before this was fixed.

  **If this repository is ever made public**, note that granting a public repository access to a
  private package lets FORKS of it read that package.

- **Foundry is required only to RUN things, never to build artifacts.** The sync no longer compiles
  anything: the ABIs arrive as a release asset. What still needs Foundry is `anvil` on `PATH` for
  `sdk/test/std/token/evm.e2e.test.ts` and other EVM execution suites. They deploy the pinned creation
  code and run through real Kitchen-created Pots; CI no longer derives a runtime with `cast` for
  tests to etch at another address. **A tree where the
  sync has not run is not green**: with no `sdk/{src,dist}/artifacts/`, the tests that import
  `./artifacts/*.json` fail. Run `pnpm --filter './sdk' sync-engine-artifacts`.
- **Mainnet state (`actions/tests/state/*.genesis.json.gz`)** — no test forks a live chain. The
  actions mainnet suites replay Ethereum at `PINNED_BLOCK` (`actions/tests/mainnet.ts`) from one
  gzipped anvil genesis per suite: every account and storage slot that suite read, at their values
  in that block. Replay pins the block number, its timestamp, chain id 1 and a 12-second block
  interval, refuses to fork, and makes any non-loopback `fetch` throw, so a suite that starts reading
  something new FAILS (a missing slot reads as zero) rather than reaching the network. Blob sizes at
  capture: actions ~680 KB, quote ~270 KB, split-swap ~80 KB.

  **Recapture** only when a suite needs state it does not have — a new test, a new venue, or a moved
  `PINNED_BLOCK` (then recapture all three, and revisit every pinned figure: pools, strategy ids,
  the live Rocket Pool deposit pool, expected outputs). With an Ethereum archive RPC:

  ```sh
  FORK_URL=<archive rpc> pnpm --filter './actions' capture-mainnet
  ```

  Capture forks at `PINNED_BLOCK` through a local recording proxy (`tests/mainnet-recorder.mjs`, its
  own process, retrying an upstream request that hangs) and rewrites each suite's blob from what it
  answered. Anvil's own mechanisms cannot do this: a fork's `anvil_dumpState` holds only
  locally modified accounts, and Foundry's RPC cache drops whatever was fetched after a snapshot when
  the suite reverts it. Capture a WHOLE suite — a `--test-name-pattern` run writes a blob with only
  those tests' state. Never print the RPC; `stop()` refuses to write a blob that mentions it, and
  grep the blobs for the host before committing anyway.

- **`SAUCE_ENGINE_SO` / `SAUCE_RUST_ENGINE_SO`** — the path to the Solana engine, fetched by
  `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines`, which digest-verifies it against
  the pin and prints `SAUCE_RUST_ENGINE_SO=<path>`. **The tests read these variables; the SDK never
  does.** Each `svm/engine-artifacts.ts` resolver takes an optional explicit path
  (`svmEnginePath(cluster, path)`, `svmKitchenPath(path)`, `svmKitchenIdlPath(path)`) and otherwise
  returns the packaged binary; `sdk/test/svm/engine-harness.ts` and `dev-tools/test/svm-local.test.ts`
  read CI's `SAUCE_*` paths and pass them in. Shipped code reads no environment at all: configuration
  is passed by the developer, and a browser has no `process.env`. **Nothing about the engine is
  source-controlled.**
  There used to be a vendored `artifacts/svm/engine.so` — a `release/beta` build predating every
  v12-svm release, with no `JUMP`/`JUMP_I` — and it was the DEFAULT, so anything with control flow was
  rejected with `InvalidInstructionData` while straight-line programs ran, silently, just from not
  setting a variable. It is deleted, along with the staging surface only it could run
  (`init_buffer`/`write_buffer`/`finalize_buffer`/`execute_and_close`, `client.stageBuffer`), which no
  released engine implements. Staging is the kitchen's now (`kitchen.ts`). The engine-gated suites
  skip locally when the variable is unset and hard-fail in CI.

- **`SAUCE_V12_RUNTIME_CREATION_HEX`** — a file containing the pinned EVM runtime's **creation**
  hex, printed by `sync-engine-artifacts --fetch-v12-engines` and exported into CI's environment.
  The EVM execution suites deploy that creation code directly. The constructor embeds the engine's
  own address, which `EVAL` uses: copying deployed runtime to another address leaves a dangling
  self-reference. Do not reintroduce the old deploy/read/etch flow. Some tests accept the old
  `SAUCE_RUST_V12_RUNTIME` variable as a fallback name, but the current input is creation code.
  Released engines also enforce the Kitchen/Pot gate: use `sdk/test/evm/gated-engine.ts` or the
  actions harness, not direct engine calls. `ctx.self()` and token ownership refer to the Pot.

- **EVM engine artifacts** (`sdk/{src,dist}/artifacts/` — `Router`, `ISauceRouter`, `V12Pot`,
  `V12Kitchen`, `V12RuntimeBytecode`, `V12EngineGate`, `IERC20`, `IUniswapV3Pool`) ship to downstream SDK consumers,
  which read them for local tests/deploys. **Nothing is tracked** — an `artifacts/` directory at any
  depth is gitignored, as is every `dist/` — so they exist only where a sync has run, and `tsc` does
  not emit them: **after any repin run `pnpm --filter './sdk' sync-engine-artifacts`**. Four ABIs
  come from the `kitchen-evm` release's `abis.json`, `IERC20` is declared in the script (the ERC-20 standard is
  never v12's), `IUniswapV3Pool` comes from `@uniswap/v3-core`, and `V12RuntimeBytecode` wraps the
  release's creation code. `V12EngineGate` records the released engine's Kitchen/Pot gate anchors.
  CI asserts all 8 landed, so a broken generation fails there rather than
  shipping an empty dir. No generated file is committed and drift-checked any more:
  `engine-abi.generated.ts` went with the engine that produced it.
  The RELEASE ADDRESSES ship too: the sync assembles `V12Deployments.json` from the `addresses.json`
  each of the four releases publishes (EVM engine/router/kitchen/impl + Pot derivation, SVM engine/kitchen
  program ids), and `src/deployments/v12-addresses.ts` reads it at runtime behind the `./deployments`
  export (`v12EngineAddress()`, `v12KitchenAddress()`, `v12SvmEngineProgramId()`, …). These are the
  deterministic (CREATE3 / fixed-keypair) addresses — chain/cluster-independent, so they are ADDRESSES,
  not liveness. Legacy `v12.generated.ts` constants and the `isV12Live`/`v12LiveChainIds` roster describe the old
  deployment generation, not proof that these release addresses are live on a chain. EVM address
  lookup helpers use `V12Deployments.json`; verify live code separately. The EVM engine and Kitchen are **1.1.0**, SVM engine **1.3.0**, and
  SVM Kitchen **1.0.0**; `V12Deployments.json.releases` records each source commit/version.
- **`V12RuntimeBytecode.json` comes from a pinned release asset.**
  The engine deleted its committed `engine-v12/snapshots/` copy (`chore(v12): compile the runtime
at deploy time`) because a second source of truth rotted — six changed `.huff` handlers once
  shipped with a snapshot built from pre-change source, through green CI.
  `sync-engine-artifacts.mjs` wraps the pinned EVM release's `runtime.creation.hex` in the JSON
  shape consumers already read. No Huff toolchain is involved in producing it.
- **A tag is not a pin.** A GitHub tag is movable, so each asset is checked against a digest
  committed in the script itself (`keccak256` of the _decoded_ creation code; `sha256` of the
  `.so`), cross-checked against the release manifest's `creationCodeKeccak`/`soSha256`, **and**
  against `manifest.commit`. A moved tag throws rather than silently supplying a different engine.
  Assets cache under `node_modules/.cache/sauce-engine-releases/<tag>/`, so a warm tree needs no
  network, and a corrupt cache is caught by re-hashing and refetched.
- **`hnc` (the Huff compiler) is no longer needed.** The suites that compiled `v12/Runtime.huff`
  themselves lived in the deleted `compiler/` workspace, and nothing in CI installs a Huff
  toolchain. The one surviving caller is `dev-tools/test/e2e.test.ts`, which shells out to
  `hnc -b engine-v12/v12/V12Compiler.huff` — that is `test:e2e`, which neither `pnpm test` nor CI
  runs.

## Architecture

**SauceScript** is compiled by the published Rust/wasm compiler `@eco-incorp/sauce-compiler`,
aliased to the short name `sauce-compiler` in every `package.json`. **There is no in-repo
compiler**: the `compiler/` workspace was deleted, and `sdk/src/compiler.ts` re-exports the
published one as the `./compiler` subpath (through `sdk/src/wasm-compiler.ts`, a plain ESM import
that lets the package's `node`/`browser` conditions pick its build).

The compiler entry point is one function — source text in, bytecode out, no opcode-level builder, no
`Saucer`/`CompilerContext`/`OPS`:

```ts
compile(options: CompileOptions): CompileResult
```

`target` (`'evm' | 'svm'`) and `resolve` are required; `entry` (default `"main.js"`),
`resolvePackage`, `contracts`, `inlineContracts`, `ambient`, `defines`, `optimize` (default
`true`), `cache` (default `true`), and `compactArgs` (default `false`) are optional. All four manifests pin the
compiler exactly to **2.4.0**, matching the lockfile. `CompileResult` contains `bytecode: Uint8Array`,
`isaRevision: "stack-compact-v2"`, `entryEncoding: "abi-v1" | "compact-v1"`, optional
`entrySchema: Uint8Array`, and optional `manifest: AccountManifest`. `manifest` is the SVM account
contract, absent on EVM. Compile-time values affect bytecode; runtime entry arguments are encoded
and appended separately. With `compactArgs: true`, pass the returned schema and positional values
to `encodeCompactArguments` from `@eco-incorp/sauce/compiler`; its strict inverse is
`decodeCompactArguments`. Pair the artifact with a compatible engine; an ISA label does not query
the deployed runtime. There is no `argsLayout` and no `staged`/`args` compile option; the SDK owns
its SVM layout types (`sdk/src/svm/layout.ts`).

SVM settlement execution verification defaults to `wireFormat: "gated-v1"`: raw engine CPI
data with the 65-byte owner/salt/bump gate header and the full accounts including the trailing Pot
(and leading code account when staged). `legacy-ungated` is explicit historical inspection only.
Kitchen cook envelopes need separate decoding. A `genuine` result verifies program identity under
the caller's staged-pin evidence; it does not validate the gate, callee, account roles, or execution success.
Compile and resolution failures throw JavaScript errors. Frontend diagnostics usually carry source
locations; resolver and target-capability errors need not contain a source span.

The route adapter is a separate contract: `compileSauceRoute` returns one program in
`compiled.bytecode: Uint8Array[]`, an empty `warnings` array, rewritten source, and encoded calls.
It does not expose `compactArgs` or retain the raw compiler's metadata/schema/manifest. Use the raw
`/compiler` export for those. Both `/compiler` and route compilation run in Node and in a browser
through one code path, `sdk/src/wasm-compiler.ts`: in a browser `await ready()` (from the root or
`/compiler`, forwarding to the compiler's `/ready`) before compiling; in Node nothing needs it.
Nothing browser-facing reads the filesystem. The std sources, recipe programs, protocol ABI twins
and skill docs the SDK reads are embedded at build time by `scripts/gen-embedded-sources.mjs` into
the gitignored `src/embedded/*.generated.ts` (regenerated by `build`, `typecheck` and `test`;
`embedded-sources.test.ts` fails when they are stale) and served by `src/embedded/resolve.ts`. Do
not add a `node:*` import or `Buffer` to shipped code: `svm/engine-artifacts` (file paths for a
local LiteSVM harness) is the one Node-only module, on its own subpath and in no barrel. CI bundles
every export for the browser and compiles in headless Chromium, so a regression fails there.

**The authoritative description of that surface is the package's own typings**
(`node_modules/sauce-compiler/node/sauce_wasm.d.ts`), which document each option in detail —
`ambient` precedence, `defines` precedence and their program-wide scope, the resolver contract
(returning `undefined` means "nothing here" and falls back; a throw propagates). Read them rather
than a paraphrase. Compiler _behavior_ — language features, constant folding, per-target lowering —
must be verified against the pinned compiler implementation and executable probes; the runtime
repository's documentation is not an independent correctness check.

**The language reference is held to the compiler, and there is one.**
`skills/sauce-script/references/builtins.md` (the SauceScript reference) and its `builtins.json`
(every builtin, with an example program per target and the error on a target that lacks it) are the
`sauce-script` skill's reference and the manual's: `docs/` links to them rather than keeping a copy.
`pnpm skills:check` (`sdk/scripts/skills-check/builtins.mjs`) holds them: every builtin example
compiles on each target it lists, every table example compiles on each target its row claims, and
every error the page quotes (`…` and `N` as wildcards) is produced by a rejected program — a
builtin's `unavailable` entry or a program in `skills-check/builtins-rejections.mjs`. A new example
or quoted error needs a program behind it, and a compiler bump that changes a message fails there
first. Keep the page version-free, free of engine internals and free of placeholder addresses (the
skills' wording rules).

Compiler migration inventories and implementation plans have been removed. Git history retains
those investigations; do not add them back to the public SDK manual.

**`sdk/`** — registries plus executable SDK logic. `src/protocols/<slug>/` holds per-protocol `info`,
`addresses`, `abis` as-const, and `functions` SauceScript templates; `src/protocols/index.ts` is the
query registry. `src/routes/` implements namespace rewrites, compiler integration, intents, and
Portal encoding; token/swap/deposit builders and EVM/SVM clients construct executable programs,
account plans, and transactions. `src/skills/loader.ts` is the `/skills` export, which serves the
per-protocol documents; those documents are the `sauce-protocols` agent skill's
`skills/sauce-protocols/references/*.md` (see "Agent skills" below), embedded at build time. `src/chains/`, `src/recipes/`, `src/core/types.ts` hold shared
chain and recipe definitions. **SDK tests compile every protocol's
`sauceFunctions` through the real compiler**, which is the installed npm package — there is nothing
to build first, but the suites that import `./artifacts/*.json` need `sync-engine-artifacts` to have
run (see the Foundry gotcha above).

**Every route rewrite parses with `src/routes/parse.ts`**: acorn extended by
`@sveltejs/acorn-typescript`, both pinned exactly (the plugin extends acorn's parser class). A route
source is SauceScript, annotations included, so the rewrites must take what the compiler takes; a
JavaScript-only parse rejected every typed helper. `ast-walk.ts#walk` steps over annotations and
type-only declarations, so no rewrite reads a type name as a value. Do not add a second parser, and
do not reintroduce a "rewrites cannot parse annotations" workaround: the compile seam's one remaining
insertion is `ensureVoidMain`.

**Every registry ABI is pinned against the deployed contract, offline.** `test/registry-abi.test.ts`
checks each function, event and custom error of each `abis.ts` export against
`test/fixtures/registry-abi/evidence.json`: the
deployed code must dispatch its selector (after resolving EIP-1167 clones, EIP-1967/beacon/legacy
proxy slots, `implementation()` getters, and diamond or selector routers), and where a verified ABI
exists, its outputs, mutability and struct field names must match. An event's topic and an
error's selector must be carried by the deployed code (a PUSH32 before its LOG, a constant before
its REVERT), an event's `indexed` flags must match the verified ABI, and each event's captured real
log (`logs` in the fixture, where a deployment has emitted one) must decode, strictly, with the
registry's own declaration. `targets.json` beside it is the
hand-written half: which deployments evidence which export (`roles` from `addresses.ts`, narrowed
by `chains` where one role's deployments run different releases, or representative `instances` for
interface ABIs), `probes` (extra signatures to ask a selector router about), and every exception
with its reason — `exempt` (a deployment that legitimately differs),
`unverified` (no verified source on any keyless source; the selector is still checked) and
`unverifiable`. An
exception that stops applying fails the test. `required` names an overload a consumer binds (with
the consumer): the registry need not declare every overload a contract has, but it must keep
declaring those, and removing one fails the test. So does a new export with no target, a deployment
of a targeted role the evidence does not cover (an `addresses.ts` edit not yet recaptured, or one
no export's `chains` includes), and a `<X>ABI.json` twin that is missing or no longer matches
`abis.ts` (regenerate with `bun run scripts/generate-abi-json.ts`, then prettier). The widened-type workaround the registry
used to carry (`uint32` for `uint24`, `uint256` for `bytes32`/`int*`) is gone: the pinned compiler
takes every ABI type, so declare the deployed one.

A target may name a protocol this tree does not have yet (one another branch adds): the suite skips
it and the capture carries its evidence over untouched, so the evidence can land before the
protocol does. Deployments whose address is not a 20-byte EVM address (Solana program ids) are not
captured: no EVM ABI applies to them.

Recapture only on explicit request — it reads live chains: `pnpm --filter './sdk' build` (the script
reads `dist/`), then
`node scripts/capture-registry-abi.mjs --recapture --rpc-config rpc.config.json [--chains <id>,…] [slug ...]`
from `sdk/`, with no slugs for everything (about 540 deployments; responses cache under
`node_modules/.cache/registry-abi/`, and `--no-cache` bypasses that). Without `--recapture` it
refuses to run. `--chains` narrows the run to those chains' deployments and keeps every other
chain's evidence as captured. RPC endpoints come only from the `--rpc-config` file, a JSON object of
chain id to URL. Keep yours at `sdk/rpc.config.json`, which is gitignored, starting from the
committed `sdk/rpc.config.example.json`, which holds `<…>` placeholders and never a real URL. The
script reads nothing from the environment and has no public fallback: before its first request it
fails, listing each chain id the selected deployments need that the file does not give. Verified
ABIs come from Sourcify, Blockscout and keyless Etherscan-compatible APIs. The fixture must never hold an endpoint
or key; the suite greps it. Review the fixture diff before committing it: a changed selector map is
a contract upgrade to look at, not noise.

`src/std/` is the SauceScript **standard library** — source shipped for the compiler to consume, not
TypeScript. `src/std/token/` is `@sauce/token` (an ERC20/SPL token interface behind one import), and
**the SDK owns it**: this directory is the source of truth, edited here like any other source. The
engine (`v12`) repo has a package of the same name under its compiler's test fixtures, but that is
v12's own INTEGRATION fixture — independent, not kept in sync, and not a reference for this one. Do
not port changes from it or treat a difference between the two as drift. It used to be the other
way round (this was a byte-identical copy, left unformatted to stay one); it no longer is.

The EVM arm's writes are OpenZeppelin `SafeERC20`: a raw `evm.call`, then empty returndata accepted
only from an address with code and anything else decoded as a word that must equal 1, with `approve`
as `forceApprove` (read the allowance, reset a non-zero one first). **Every token write the SDK
offers has these semantics** — a standing rule, not a default. The route-body syntax (`<Sym>.transfer(...)`,
`Token(addr).transfer(...)`, see below) compiles to calls into this library, and the registry
templates (`protocols/{erc20,gho,frax,crvusd,cbeth,liquity-v2}/functions.ts`) import it;
`compile.test.ts` fails any template that issues an ERC-20 write through a typed `.at(...)` binding.
The ONE unchecked spelling is an `IERC20.at(addr).transfer(...)` a user writes explicitly: the raw
ABI call, which decodes the declared `bool` — reverting on USDT, accepting `false` — kept as the
escape hatch and documented as not `SafeERC20`. `src/token/safe.ts` emits the
same semantics INLINE into routes, deliberately not as calls into this library: the settle recipe
is compiled by partners whose resolver serves only `./artifacts/IERC20.json`. What keeps every
spelling on one behaviour is `test/std/token/evm.e2e.test.ts`, which runs OpenZeppelin's own
`SafeERC20`, this library, `safe.ts` and the three route-body spellings (each through
`compileSauceRoute`) over one matrix of tokens (false, empty, no code, a word of 2, 1/31/64-byte
returns, USDT's standing allowance, honest refusals) and requires identical outcomes, with the raw
`IERC20.at` binding beside them as the contrast and the plain-transfer recipe executed too.
CI also pins what a wrong digit would break silently: `test/std/token/compile.test.ts` derives the
SPL Token program id the SVM arm guards on from its base58 address, and each selector the EVM writes
spell out by hand from `keccak256` of its signature, and counts them in the emitted bytecode. It has
two per-target arms (`token.evm.js`, `token.svm.js`) and
**deliberately no neutral `token.js`**: a token program is inherently target-specific, and a neutral
file would turn a missing arm into a confusing missing-EXPORT error instead of a clear failure to
import the package (`package.json`'s `main` names the neutral BASE the compiler suffixes per target).
The per-arm signatures genuinely differ where the account models force it — SVM `totalSupply`/
`decimals` take the mint as an `Account` while the EVM takes an `Address`, and the SVM writes take
6 args to the EVM's 3–4. Verified in `sdk/test/std/token/`: `compile.test.ts` (both targets, all seven
shared methods plus the SVM-only `ownerOf`, which reads a token account's owner and has no EVM arm,
the SVM account manifest, and the no-neutral-arm packaging invariant — always runs, no engine
needed) plus `svm.e2e.test.ts`/`evm.e2e.test.ts`, which EXECUTE the compiled bytecode against real SPL
accounts and a real deployed ERC20 — see `SAUCE_RUST_ENGINE_SO`/`SAUCE_V12_RUNTIME_CREATION_HEX` above for why
those two are gated. `src/std/token` **ships** two ways: embedded in
`src/embedded/sources.generated.ts`, which is what the SDK's own compiles resolve (see the next
paragraph), and as files under `dist/std/token` (`copy-verify-assets.mjs`) for a consumer that
resolves it off disk.

`@sauce/token` is the **default ambient MODULE** on the route path. `manifest.json`'s `ambient`
list (`["@sauce/token"]`) is handed by `chainAmbient()` to every `openRoute` compile, so its
exported functions (`approve`/`transfer`/`balanceOf`/…) are callable in any route body opened that
way with **zero import**. `openRoute` and no further: `chainAmbient` has exactly one call site
(`intent-dsl.ts`), and `compileSauceRoute` passes its caller's `ambient` straight through without
merging this list in — so a direct `compileSauceRoute(..., {})` gets no ambient module at all. This resolves because `embedded/resolve.ts`'s `resolveSdkPackage` maps the bare
`@sauce/token` specifier to the embedded copy of `src/std/token`, ahead of any caller
`resolvePackage` — an ambient module the compile can't resolve makes EVERY route throw, so that
list must only ever name modules the SDK resolves itself. Two DISTINCT mechanisms
share the word "ambient": ambient **DEFINES** (`chainDefines` — chain-scoped SCALARS: chainId,
protocol addresses, token symbols) vs ambient **MODULES** (this — whole library exports).

**Chain-scoped names are resolved per level.** In `Chain(() => …).reward(…)` (`intent-sugar.ts`)
the body and the delivery argument resolve on the destination and the reward on the enclosing
chain, which escrows and approves it. `sauce-route.ts#levelOn` gives each level on another chain
its own values (`NESTED_SCOPE`, the registry's `chainDefines`) and DROPS every caller `defines`
entry named like a chain-scoped value of the enclosing chain or the destination, and every `tokens`
override — by name, not value, so `defines: chainDefines(base)` and a hand-picked `USDC` are
treated alike. Caller names no chain uses (`RECIPIENT`) hold at every depth. Protocol accessors
never had the problem: they fold each chain's literal address in. `openRoute` passes its own
chain's ambient defines as `RouteScope.chainDefines` beside the options rather than in
`compile.defines`, so its `defines` stay the caller's; `compileScopedRoute` takes the scope and
`compileSauceRoute` is that with an empty one. Two defects came from mixing these up (Arbitrum's
USDC as a reward on Base, Base's in an Arbitrum body). `routes-intent-reward-chain.test.ts` records
every level's compile on three paths and decodes each level's `publishAndFund`;
`routes-intent-chains.e2e.test.ts` runs them on three anvils whose USDC differs. A test that gives a
symbol one address everywhere (a `tokens` override, a define) cannot see either defect.

The **`Token(addr)` global wrapper** (`Token(addr).approve(spender, amt)` / `const t = Token(addr);
t.approve(...)`, zero import) and the **`<Sym>.transfer(...)` symbol syntax** are TEXTUAL rewrites in
`token-rewrite.ts`, run in `compileSauceRoute` before the compiler, and both lower a WRITE
(`transfer`/`approve`/`transferFrom`) to the `@sauce/token` function of the same name with the
token first: `USDC.transfer(to, amt)` → `__sauce_transfer(USDC, to, amt)`, with
`import { transfer as __sauce_transfer } from "@sauce/token"` prepended (`tokenImportLines`). So a
write has ONE implementation however it is spelled, and it is the library's SafeERC20 one. The import
is ALIASED (the pinned compiler, 2.3.0 and 2.4.0 alike, accepts `import { a as b }` and emits
byte-identical code), which is what keeps a program's own `transfer`/`approve` from colliding; the `__sauce_<method>` names are reserved
and a program declaring one is refused by name. It is an explicit import, not the ambient module,
because `compileSauceRoute` never merges `chainAmbient()` in. A READ (`balanceOf`, and any other
method on `Token(...)`) stays on the typed `IERC20.at(...)` binding — a `uint256` is always there.
A write returns nothing, so one whose result is read (`const ok = USDC.transfer(...)`) is refused,
and the source-global and `TokenBinding` types declare the writes `void`. A bound `Token(...)` is
lowered only when the name is declared once in the whole program, never reassigned and only ever
called as `t.<method>(...)`: the binding then holds the ADDRESS and each call is lowered by name.
Any other `Token(...)` — an argument, a value, a reassigned or passed binding — is REFUSED with an
error naming the safe spellings, never passed through as the typed call (which would be the
unchecked write again). Both rewrites are shadow-safe (a program that binds `Token` or a symbol owns
the name) and svm-rejected: the SVM arm's writes need SPL account slots the sugar has nowhere to put.
The compiler therefore never sees a method call on a `Token(...)` result, and no compiler feature is
needed — the earlier "`Token(addr)` needs a compiler feature" framing only applied to making
`@sauce/token` _export_ a real `Token` value (blocked by the M1 subset). A token-only INTENT body
(`Base(() => { USDC.transfer(...) })` inside a program, every statement a `transfer`/`approve` on a
symbol or literal `Token(...)` — `intent-sugar.ts#isDirectCallBody`) is different again: it lowers
to plain `route.calls` the Portal's Executor runs raw, not to a Sauce program, so it gets the
Executor's checks (revert, code) and not SafeERC20's. USDT is supported there: no-return transfers
work, and every approve is emitted as `approve(spender, 0)` then `approve(spender, amount)` (one
Executor serves every intent, so a standing allowance is realistic). A `false`-returning token is
caught only at delivery (the Portal's `safeTransferFrom`); the Executor's own `false` transfer or
approve fulfils with nothing moved. `routes-nest-dynamic.e2e.test.ts` runs all of that through a
real Portal and Executor and PINS the gap. Any non-token statement makes the body a program, whose
writes are SafeERC20 — that is the documented way to get the checks.

**The host surface and compiled-source declarations are separate — and only one of them is
global.** The HOST surface is IMPORTS ONLY: `routes/chain-exports.generated.ts` exports one named
value per canonical chain (`Base`, `Solana`, …) plus `chain` and `Token`, re-exported from the
package root, each composed in `routes/composed.ts` (callable + `.chain`/`.route` + the lazy
contract tree, + the svm venue tree on an svm chain). **Importing the SDK touches nothing on
`globalThis`**; `installRouteGlobals()`/`uninstallRouteGlobals()` (`routes/globals.ts`) remain as an
opt-in for a host that wants the bare-name spelling at run time, hand out the SAME memoised objects,
and install no types. `routeGlobals` is a live view of the last install, empty until one happens.
Globals are a SAUCESCRIPT concept: the generated `routes/source-globals.generated.ts` declares bare
token symbols and protocol namespaces such as `USDC` and `Uniswap` for TypeScript route closures.
Those are **type-only declarations**: no host `USDC` or `Uniswap` runtime object is installed. They describe source the
SDK extracts with `Function.prototype.toString`; the closure is never invoked and captures no
outer JavaScript values. Use `compile.defines` for external scalar values.

`pnpm --filter './sdk' gen-source-globals` derives these declarations from descriptor/token
registries. Regenerate after changing descriptor ABI shapes, namespace aliases, or token symbols;
do not hand-edit the generated file. Type declarations describe known names and call shapes across
the registry, not availability on every chain. Compilation still enforces the selected chain's
deployments, the SauceScript subset, and ABI fidelity. The public root type graph must keep the
generated ambient declaration import so downstream typed closures see the same declarations.

The language's own builtins (`ctx`, `crypto.keccak256`, `hex`, `Math.mulDiv`, `require(c, msg)`,
value methods, …) are declared beside them in `routes/builtins.generated.ts`, generated by
`pnpm --filter './sdk' gen-builtins` from the reference's `builtins.json` — its data, not a
second list. `crypto`, `Math`, `require` and `eval` are host names: the builtins MERGE into the
host's declarations (DOM `Crypto`, Node's `webcrypto.Crypto` and `NodeJS.Require`, lib `Math`)
rather than redeclaring them, which would clash under Node. `routes-builtins-types.test.ts`
typechecks a closure using every builtin with DOM, Node, both and neither.

**`actions/`** — JSON action programs (`{ version, chainId, actions }`) lowered to one SauceScript
program. The public surface is deliberately small — `parseProgram`, `serializeProgram`,
`programSchema`, `compileProgram`, `programIntent`, `quoteAction`, `compileSplitSwap`,
`ProgramError` and the types — and the types ARE the JSON (no per-action chain, one `amount`, one
`amountOutMin`, `recipient` everywhere); keep it that way rather than adding parallel entry points.
`spec.ts` is the single field table: `program.ts` parses/validates against it (located issues,
canonical serialization, no defaults filled in), `schema.ts` generates the committed JSON Schema from
it, and `tests/docs.unit.test.ts` holds the guide's action list and outputs to it; `semantics.ts`
holds the cross-action rules. `to-sauce.ts` emits every protocol call as an ABI binding
(`IBinding.at(addr).method(...)`) from the catalogue in `abis.ts`: a binding takes the registry ABI
wherever the registry declares the function exactly (same canonical signature, so same selector),
and a method declares an output ONLY when an action reads it: compiler 2.3.0 decodes declared
outputs even when discarded, and decoding empty return data reverts (3pool-era Curve). A local
fragment, with its reason, remains only for a contract or method the registry does not carry
(`abis.unit.test.ts` fails if one ever appears there). ERC-20 `approve`/`transfer` are not
bindings: they go through the SDK's `token/safe` (USDT returns no `bool`; `SafeERC20` semantics, with
`forceApprove`'s reset), the lowering every SDK token write uses — one path, so do not add a second. Native-value calls stay raw
`evm.call` because a binding cannot attach value; the Stargate and Hyperlane fees are quoted by a
`view` binding (a STATICCALL) just before. Actions **chain**: output feeds the next implicitly (no
amount) or via `saveOutputAs`/`amountRef`; an output is what the action delivered to the Pot (a
return value or a balance delta) or its own amount, per `spec.ts`. `compose.ts` opens intents
(`programIntent`, on the program's own chain) and compiles standalone programs with runtime
arguments (ABI-v1, or compact-v1 with fixed-width offsets). `to-quote.ts` builds the `eth_call`
quotes and, for the split swap, the same quoter calls as SauceScript over fixed amount offsets.
`AMM_SWAP_INTERFACES.md` is third-party interface reference; only its sections marked Verified have
been checked.

**The `sauce` bin** (`sdk/src/cli/`, built to `sdk/dist/cli/main.js`) is the package's command
line: `compile`, `simulate`, `run`, `publish`, `tx`, `pot`, `globals`, `inspect`, `verify`,
`init` and `skills install|update|status`, on EVM chains and (`solana.ts`) Solana. It adds no
compile path of its own — `compileSauceProgram` (the compile half of `compileSauceRoute`, with the
chain bundle `openRoute` uses: `chainAmbient`'s modules and the chain's names as a `RouteScope`, so
an intent the file opens resolves its body on its own chain) — and no encoder or decoder: the cook is
`buildSauceEvmCall`, the Pot `v12PredictPot`/`potSalt`/`sauceEvmDeployPotCall`, arguments
`encodeEntryArguments`/`decodeEntryArguments`, names `sourceGlobals`, settles
`validateSettleProgram`/`verifySvmSettleExecution`, and Solana cooks `createSauceSvmClient`
(`cookTransaction`). It is Node-only and deliberately in no `exports` entry and no barrel
(`cli.test.ts` fails if a barrel exports it), reads no environment, reaches a network only through
`--rpc-url` or a `--config` file, and signs only with `--keystore`, `--private-key` or
`--keypair`, scrubbing any key it was given from everything it prints. `run --fund` (`funding.ts`)
wraps the file's source before that compile — a new `main` with the same signature that pulls
through `@sauce/token` (`permitTransferFrom`, `permit`, `transferFrom`), calls the original
renamed, and sweeps; in a script, the pulls after its imports and the sweeps after its last
statement — signing Permit2 or EIP-2612 locally; `cli-funding.e2e.test.ts` runs every
mode against canonical Permit2's runtime (`test/fixtures/cli/Permit2.json`). `cli.e2e.test.ts` runs the
EVM commands against anvils with the released gated stack (and one `cast send` line verbatim);
`cli-solana.e2e.test.ts` runs the Solana ones against the released Kitchen and engine in LiteSVM
through a JSON-RPC shim; the packed check runs the installed bin through `npx`. The agent skills
`sauce skills` installs (to `.claude/skills/` and `.agents/skills/`) live in the top-level
`skills/<name>/` and ship in the package (see "Agent skills" below).

What a command's input MEANS — the chain a program runs on, whether its defines reach it, the Pot a
cook names, its funding and assumed balances — lives in `inputs.ts`, taking plain values, so a
second front end applies the same rules: `run.ts` reads flags into it, and the MCP server reads
tool arguments into it.

**`sauce mcp`** is the MCP server (`mcp/`, built to `mcp/dist`). It is a CLI command, not a bin
of its own, so `npx -y @eco-incorp/sauce mcp` self-hosts it in one command. `sdk/src/cli/mcp.ts`
owns its flags and imports `mcp/dist/entry.js` LAZILY, by a specifier TypeScript does not follow
(so the SDK builds before `mcp/`), and only when the command runs (so no other command loads the
MCP SDK); `entry.ts` exports `mcpEntry` typed by the CLI's `McpEntry`, so the two cannot drift.
Its tools are the `sauce` command's read-only half — `sauce_compile`, `sauce_actions`, `sauce_tx`,
`sauce_pot`, `sauce_simulate`, `sauce_publish`, `sauce_inspect`, `sauce_verify`, `sauce_globals`,
`sauce_price`, `sauce_chains` — plus the skills as tools (`sauce_skills`, `sauce_skill`,
`sauce_dev`, `sauce_install_skills`), because many clients never read resources. Each command tool
calls the function the matching command calls (`compileCommand`, `txCommand`, `simulateCommand`, …)
and returns its JSON as structured content, so a change to a command reaches its tool with no edit
in `mcp/`; do not reimplement command logic there. `sauce_actions` lowers a document with
`actions/src/source.ts#actionSource`, the one function a CLI command for actions should share.

It never signs and takes no key under any name (`tools.test.ts` fails a tool input that looks like
one), and reads no environment. A tool reads a chain through the call's own `rpcUrl`, else the
`--config` endpoint, else refuses (`reach.ts`); a caller's URL is a secret for that call only, and
the server's are registered with `signer.ts#secret` at start — all scrubbed from every result,
error and log (`secrets.test.ts`). Over HTTP a caller's URL goes only through `guard.ts`: https,
no private/ULA/link-local/CGNAT/metadata address, checked again at each connection (rebinding),
no redirects, bounded; `--allow-private-rpc` relaxes it. Over stdio there is no guard. A program's
relative imports are served only from the call's `modules`, never from the server's disk; skill
files only by exact match against what `skills/` ships. Nothing in `mcp/` names a particular skill
except the prompts and `sauce_dev` (sauce-typescript), which degrade when it is missing. `sauce mcp
setup` writes each coding agent's documented project config (`.mcp.json`, `.codex/config.toml`,
`.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`). Its tests use the node test runner
(`pnpm --filter './mcp' test`, which builds `mcp/dist` first, since `transports.test.ts` runs the
built `sauce mcp`); `chain.e2e.test.ts` runs the tools against an anvil with the released stack
through `sdk/test/cli-anvil.ts`, gated on `SAUCE_V12_RUNTIME_CREATION_HEX` like the CLI's chain
suites. The consumer guide is `docs/guides/mcp.md`.

## Agent skills

`skills/` holds the Agent Skills (agentskills.io) the package ships and `sauce skills install`
copies into a project: `sauce-overview` (the entry point), `sauce-script`, `sauce-globals`,
`sauce-protocols`, `sauce-swaps`, `sauce-distributed-swap`, `sauce-intents`, `sauce-solana`,
`sauce-run`, `sauce-typescript` and the `sauce-examples` index. Each is a `SKILL.md` plus
`examples/` (`.sauce.ts` programs and `.mts` runners) and, for three of them, `references/`.

- **One set of protocol documents.** `skills/sauce-protocols/references/*.md` is the only copy of
  the per-protocol documents. `gen-embedded-sources.mjs` embeds them for `src/skills/loader.ts`, so
  the `/skills` export (`getProtocolSkill`, unchanged API) returns exactly what an agent reads.
  Edit them there; `skills-loader.test.ts` pins the count.
- **The index of globals is generated.** `sdk/scripts/gen-skills-globals.mjs` writes
  `skills/sauce-globals/references/{tokens,protocols,chains}.md` from `routes.sourceGlobals` — the
  function `sauce globals` prints, never a second derivation — at the end of every SDK `build`. The
  files are committed and prettier-ignored; CI fails when the build changed `skills/`, so commit
  the regenerated files with any registry change (`pnpm --filter './sdk' gen-skills-globals`).
- **The checker.** `pnpm skills:check` (`sdk/scripts/check-skills.mjs`, build SDK and actions
  first) runs in CI after `docs:check`, and the packed check reruns it (`--skills <dir>`) on the
  copy `sauce skills install` writes into a project from the tarball — a project, because Node does
  not strip TypeScript from a runner under `node_modules`. It holds: the frontmatter to the spec; the `sauce-examples` index
  to the example files on disk, both ways; every program compiled through the `sauce` bin
  (in-process `runCli`) on each chain its index row names, running the `//   sauce …` usage line in
  its header offline (`compile`, then `tx` with `main`'s arguments sampled from its declared types);
  every `sauce …` command line in a skill to the flags that command's `--help` lists; ` ```sauce
chain=a,b [define=X,Y] ` blocks compiled the same way, ` ```sauce fails ` refused;
  ` ```ts ` blocks and runners typechecked, and runners executed with
  `skills-check/offline-guard.mjs` preloaded; the globals index fresh, compilable and covering
  every name a program uses; the SauceScript reference
  (`sauce-script/references/builtins.{md,json}`, with `skills-check/builtins*.mjs`) to the
  compiler; and the wording rules below.
- **Wording rules, enforced.** No version numbers or release talk; no agent's name, install path or
  instructions file (the skills reach every agent); no engine internals (opcodes, mnemonics, stack
  effects, bytecode bytes); no placeholder or unrecorded address (every `0x` address must be one the
  SDK records; developer inputs are `<placeholders>`); the Portal and provers only in
  `sauce-intents`; no RPC endpoint; Sauce never described as a multicall. The protocol documents
  are third-party facts and are exempt from the address, Portal and multicall rules only.
- **Program conventions.** A program names no chain (`--chain <chain>` in its usage line, no
  `// @chain` header): runtime inputs are typed `main(...)` parameters passed with `--args`, and an
  intent file is top-level statements whose values are defines left undeclared.
- **They describe this tree, and their runners pin it.** Where the SDK's behaviour shapes how a
  skill tells agents to write something, a runner asserts that behaviour, so the change that moves
  it fails `skills:check` and the skill is rewritten with it. Today that covers, among others: on
  which chain each part of an intent resolves its names, the body and delivery on the destination
  and the reward on the source (`sauce-intents/examples/intents.mts`), and that a program for a
  chain compiles as written — annotations anywhere, `interface`, a script's helpers and imports
  (`sauce-script/examples/saucescript.mts`).

**`dev-tools/`** — compiler/argument helpers and a local SVM Kitchen execution harness, for
developing the SDK; nothing of it ships in the package. Its `start:local`/`start:fork` scripts and
its `sauce` npm script (`scripts/run.ts`, not the package's `sauce` bin) still depend on the retired
`SauceRouter` deployment and `cook(bytes[])` execution path; they do not boot the released gated
EVM stack. `compileScript` and its tests remain useful independently. Current EVM execution tests
use `sdk/test/evm/gated-engine.ts`; current SVM local execution uses `dev-tools/src/svm-local.ts`.

## The swap Router

Lives in the **private engine repo**, not here, but recipes target it (its `Router` artifact is what
`cook()` runs against). Recipes import the minimal `ISauceRouter` ABI from `dev-tools/artifacts/` —
gitignored build output, copied from `sdk/src/artifacts/` by
`pnpm --filter './dev-tools' sync-artifacts`, so it does not exist until that has run. **There is no
`SauceRouter` artifact any more**: it came from the engine repo's Solidity tree and no v12 release
publishes it, which is what blocks `dev-tools/scripts/deploy.ts` and `dev-tools/test/e2e.test.ts`
(see their headers).

**Entry points** (all the `swap*` ones are `onlySelf` — callable only via `cook()` from the same
contract, so a recipe calls them as `ISauceRouter.at(address.self).swapX(...)`):

- `swap(SwapParams)` — unified swap; dispatches on `params.poolType` to `_swapV2/_swapV3/_swapV4/
_swapCurve/_swapBalancerV2/_swapDODOV2/_swapTraderJoeLB/_swapMaverickV2/_swapWOOFi`.
  `SwapParams` embeds a `PoolKey` struct (`currency0,currency1,fee,tickSpacing,hooks`) used by V4 and,
  for its `fee` field only, by V2 (see the fee note below); ignored for V3. Calling this from
  SauceScript requires the compiler to order object-literal
  struct fields by the ABI's declared component order at the call boundary (recursively for nested
  tuples); sorting them alphabetically scrambles the nested `PoolKey` into an empty revert. The TS
  compiler was fixed to do this, and its unit pin went away with it — **nothing in this repo pins the
  behavior against the current compiler**, so verify before relying on the unified `swap()` path. The
  flat methods below remain valid alternatives.
- `swapV3(pool, tokenIn, tokenOut, amountSpecified, sqrtPriceLimitX96, payer, recipient)` and
  `swapV4(...)` — **flat** legacy methods (no nested struct), verified working from SauceScript.
- `quote(QuoteParams)` — off-chain simulation; performs the swap and reverts with `QuoteRevert(amountIn,
amountOut, sqrtPriceAfter, gas)`, which the caller decodes. Never lands a swap. **Nothing in this
  repo uses it** — `actions/src/to-quote.ts` calls each protocol's own quoter contract instead.

**`amountSpecified` sign is inconsistent by path** (this bit us): the flat `swapV3` passes through to
Uniswap, where **positive = exact input** (verified on fork). The unified `swap()`/V4 path and the
`SwapParams`/`QuoteParams` doc say **negative = exact input** (Uniswap-V4/quote convention). For
recipes using flat `swapV3`, pass a **positive** amount.

**`SwapPoolType` enum** (`engine/src/interfaces/IRouter.sol`, must match recipe constants):
`UniV2=0, UniV3=1, UniV4=2, Curve=3, BalancerV2=4, DODOV2=5, TraderJoeLB=6, MaverickV2=7, WOOFi=8,
PancakeInfinityCL=9, PancakeInfinityBin=10`. The last two are **flat-method only**
(`swapInfinityCL`/`swapInfinityBin`) — `SwapParams` can't carry the 6-field `InfinityPoolKey`, so
unified `swap()` does not dispatch them.

**Callbacks vs callback-free** — the key architectural split for "where does swap logic live":

- **V2/Solidly/Curve/DODO** are _callback-free_: `_swapV2` reads reserves, computes out (the V2 LP fee
  is **parameterizable**, read from `params.poolKey.fee` as ppm — 3000 = 0.30%, 2500 = 0.25%; `0`
  defaults to 3000, which reproduces the legacy hardcoded `997/1000` math byte-for-byte, and `>=
1_000_000` is rejected), transfers tokenIn to the pool, calls
  `pair.swap(...)`. A recipe can replicate this **entirely in SauceScript** (transfer + `pool.swap`),
  bypassing the router — so new callback-free sources need only new SauceScript, no engine change.
- **V3/V4 (and Maverick)** use _callbacks_: the pool re-enters the contract mid-swap
  (`uniswapV3SwapCallback`/`pancakeV3SwapCallback`/`unlockCallback`/`maverickV2SwapCallback`) to pull
  input, reading transient-storage context set by `_swapV3`. A reentrant call during `cook()` hits the
  contract's Solidity dispatcher, **not** the paused bytecode interpreter — so callbacks can only be
  serviced by the router's compiled code. These swaps **must** go through the router (`swapV3`/`swapV4`).

## Publishing

Tag-driven (`.github/workflows/publish.yml`): `git tag v1.2.3 && git push origin v1.2.3` (or manual
`workflow_dispatch`). Builds all areas, fetches the SVM engine binaries, stamps the **root**
`package.json` version, and publishes the single `@eco-incorp/sauce` to **public npmjs.com only**
(`NPM_TOKEN`). GitHub Packages was dropped deliberately — `publish.yml:12` records why. Only the root
version is published; workspace packages stay `private`.

The package ships `docs/**/*.md` and `docs/examples/*.ts`. README and scaffold links are **relative
paths**, so one spelling renders in the repository, on the npm page and inside the published
tarball. They were absolute version-pinned UNPKG URLs while the repository was private — the only
way to serve docs to consumers who could not see the repo — but UNPKG returns raw Markdown, and
that reason ends when the repository goes public with the official release. `docs:check` resolves
each link against the file that contains it and checks any `#fragment` against that file's
headings; `check-packed-package.mjs` reruns the same checks and examples on the installed tarball,
which is what proves the relative targets also ship. An absolute
`github.com/eco-incorp/sauce/blob/…/docs/…` URL is rejected: it pins a branch and breaks in the
tarball. New public doc links must target files shipped in the package.

**The root `publishConfig.registry` pin (npmjs.com) is kept as a defensive, explicit anchor.** It used to be load-bearing: a committed root `.npmrc` mapped the whole `@eco-incorp` scope to `https://npm.pkg.github.com` (to fetch the `@eco-incorp/sauce-compiler-wasm` devDependency), and a scope registry governs PUBLISHING as well as resolution — so without the pin this repo's own `@eco-incorp/sauce` could have published to GitHub Packages instead of npmjs.com. That `.npmrc` is now GONE, and the wasm compiler is a public npmjs package (`@eco-incorp/sauce-compiler`, imported as `sauce-compiler`) resolved from the default registry — so the pin is no longer strictly required, but it is kept as an explicit npmjs.com anchor. If a scoped `@eco-incorp` registry mapping is ever reintroduced, this pin becomes load-bearing again.
